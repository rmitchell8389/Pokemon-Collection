"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { matchAndImportRow, type NormalizedImportRow, type ImportRowSuccess, type ImportRowFailure } from "@/lib/csvCardMatching";
import { decodeDexCsv, parseDexCsv, toNormalizedRow as toDexNormalizedRow } from "@/lib/dexImport";
import {
  decodePulseTcgCsv,
  parsePulseTcgCsv,
  toNormalizedRow as toPulseTcgNormalizedRow,
} from "@/lib/pulseTcgImport";
import { parseSimpleCsv, toNormalizedRow as toSimpleNormalizedRow, isValidLanguage } from "@/lib/simpleImport";
import {
  parseCollectrExport,
  aggregateDuplicateRows,
  toNormalizedRow as toCollectrNormalizedRow,
} from "@/lib/collectrImport";
import type { CardVariantLanguage } from "@/lib/cardVariants";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ImportSummary {
  totalRows: number;
  skippedZeroQuantity: number;
  malformedLines: number;
  imported: ImportRowSuccess[];
  lowConfidence: ImportRowSuccess[];
  failures: ImportRowFailure[];
}

const EXAMPLE_CAP = 12;

function buildRedirectUrl(source: "dex" | "pulsetcg" | "simple" | "collectr", summary: ImportSummary): string {
  const params = new URLSearchParams();
  params.set("source", source);
  params.set("total", String(summary.totalRows));
  params.set("skipped", String(summary.skippedZeroQuantity));
  params.set("malformed", String(summary.malformedLines));
  params.set("imported", String(summary.imported.length));
  params.set("lowConfidenceCount", String(summary.lowConfidence.length));
  params.set("failedCount", String(summary.failures.length));

  const lowConfExamples = summary.lowConfidence.slice(0, EXAMPLE_CAP).map((r) => `${r.name} (${r.sourceRef})`);
  if (lowConfExamples.length > 0) params.set("lowConfExamples", lowConfExamples.join(" | "));
  if (summary.lowConfidence.length > EXAMPLE_CAP) {
    params.set("lowConfMore", String(summary.lowConfidence.length - EXAMPLE_CAP));
  }

  const failExamples = summary.failures
    .slice(0, EXAMPLE_CAP)
    .map((f) => `${f.name} (${f.setName}, "${f.variantText}"): ${f.reason}`);
  if (failExamples.length > 0) params.set("failExamples", failExamples.join(" | "));
  if (summary.failures.length > EXAMPLE_CAP) {
    params.set("failMore", String(summary.failures.length - EXAMPLE_CAP));
  }

  return `/import?${params.toString()}`;
}

// Shared row-processing loop: given rows already normalized by a
// source-specific parser (dexImport.ts / pulseTcgImport.ts), match and
// import every one with bounded concurrency. Identical regardless of
// which service the rows came from — matchAndImportRow (see
// csvCardMatching.ts) is where the actual card/variant logic lives.
async function processRows(
  supabase: SupabaseServerClient,
  userId: string,
  candidateRows: Array<NormalizedImportRow | { skipReason: string }>
): Promise<{ imported: ImportRowSuccess[]; lowConfidence: ImportRowSuccess[]; failures: ImportRowFailure[] }> {
  const imported: ImportRowSuccess[] = [];
  const lowConfidence: ImportRowSuccess[] = [];
  const failures: ImportRowFailure[] = [];

  const CONCURRENCY = 5;
  let next = 0;
  async function worker() {
    while (next < candidateRows.length) {
      const row = candidateRows[next++];
      if ("skipReason" in row) {
        failures.push({ sourceRef: "", name: "", setName: "", variantText: "", reason: row.skipReason });
        continue;
      }

      const outcome = await matchAndImportRow(supabase, userId, "en", row);
      if (outcome.type === "failure") {
        failures.push(outcome.result);
        continue;
      }
      if (outcome.result.confidence === "low") lowConfidence.push(outcome.result);
      else imported.push(outcome.result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidateRows.length) }, worker));

  return { imported, lowConfidence, failures };
}

// Same shared loop as processRows above, except each row can carry its OWN
// language (the Simple format has a Language column; Dex/PulseTCG exports
// are English-only, confirmed, so processRows hardcodes "en" for those
// two). Kept as a separate function rather than adding an optional
// per-row-language parameter to processRows — that would mean every call
// site threading a language through even though only this one varies it.
async function processSimpleRows(
  supabase: SupabaseServerClient,
  userId: string,
  candidateRows: Array<{ row: NormalizedImportRow; language: CardVariantLanguage } | { skipReason: string }>
): Promise<{ imported: ImportRowSuccess[]; lowConfidence: ImportRowSuccess[]; failures: ImportRowFailure[] }> {
  const imported: ImportRowSuccess[] = [];
  const lowConfidence: ImportRowSuccess[] = [];
  const failures: ImportRowFailure[] = [];

  const CONCURRENCY = 5;
  let next = 0;
  async function worker() {
    while (next < candidateRows.length) {
      const item = candidateRows[next++];
      if ("skipReason" in item) {
        failures.push({ sourceRef: "", name: "", setName: "", variantText: "", reason: item.skipReason });
        continue;
      }

      const outcome = await matchAndImportRow(supabase, userId, item.language, item.row);
      if (outcome.type === "failure") {
        failures.push(outcome.result);
        continue;
      }
      if (outcome.result.confidence === "low") lowConfidence.push(outcome.result);
      else imported.push(outcome.result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidateRows.length) }, worker));

  return { imported, lowConfidence, failures };
}

// Collectr rows can't be assigned a single language up front the way Dex/
// PulseTCG (English-only) or Simple (an explicit Language column) can —
// see the "LANGUAGE ISN'T UNIFORM" note in src/lib/collectrImport.ts. Each
// row instead carries an ORDERED list of language candidates, and this
// tries each in turn, stopping at the first one that actually finds a
// matching card. A "no matching card found" failure moves on to the next
// candidate language; any OTHER outcome (success, or a failure that means
// the card WAS found — ambiguous set-name match, unrecognized variant)
// means the right language was already identified, so it stops there
// rather than needlessly trying the rest and possibly reporting a
// confusing second failure for the same row.
async function matchAndImportWithLanguageCandidates(
  supabase: SupabaseServerClient,
  userId: string,
  languages: CardVariantLanguage[],
  row: NormalizedImportRow
): Promise<Awaited<ReturnType<typeof matchAndImportRow>>> {
  let last: Awaited<ReturnType<typeof matchAndImportRow>> | null = null;
  for (const language of languages) {
    const outcome = await matchAndImportRow(supabase, userId, language, row);
    last = outcome;
    if (outcome.type === "success") return outcome;
    if (outcome.type === "failure" && outcome.result.reason.startsWith("no matching card found")) {
      continue;
    }
    return outcome;
  }
  // languages is never empty in practice (toNormalizedRow always returns at
  // least ["en"]), but keep this exhaustive rather than assuming.
  return last as Awaited<ReturnType<typeof matchAndImportRow>>;
}

async function processCollectrRows(
  supabase: SupabaseServerClient,
  userId: string,
  candidateRows: Array<{ row: NormalizedImportRow; languages: CardVariantLanguage[] } | { skipReason: string }>
): Promise<{ imported: ImportRowSuccess[]; lowConfidence: ImportRowSuccess[]; failures: ImportRowFailure[] }> {
  const imported: ImportRowSuccess[] = [];
  const lowConfidence: ImportRowSuccess[] = [];
  const failures: ImportRowFailure[] = [];

  const CONCURRENCY = 5;
  let next = 0;
  async function worker() {
    while (next < candidateRows.length) {
      const item = candidateRows[next++];
      if ("skipReason" in item) {
        failures.push({ sourceRef: "", name: "", setName: "", variantText: "", reason: item.skipReason });
        continue;
      }

      const outcome = await matchAndImportWithLanguageCandidates(supabase, userId, item.languages, item.row);
      if (outcome.type === "failure") {
        failures.push(outcome.result);
        continue;
      }
      if (outcome.result.confidence === "low") lowConfidence.push(outcome.result);
      else imported.push(outcome.result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidateRows.length) }, worker));

  return { imported, lowConfidence, failures };
}

export async function importSimpleCsv(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=" + encodeURIComponent("Choose a CSV file first."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const text = await (file as File).text();
  const { rows, malformedLines } = parseSimpleCsv(text);

  const ownedRows = rows.filter((r) => r.quantity > 0);
  const skippedZeroQuantity = ownedRows.length === rows.length ? 0 : rows.length - ownedRows.length;

  const candidateRows: Array<{ row: NormalizedImportRow; language: CardVariantLanguage } | { skipReason: string }> =
    ownedRows.map((row) => {
      if (!isValidLanguage(row.language)) {
        return {
          skipReason: `"${row.language}" isn't a supported language for ${row.setName} #${row.cardNumber} — use en, ja, zh-tw, or zh-cn`,
        };
      }
      return { row: toSimpleNormalizedRow(row), language: row.language };
    });

  const { imported, lowConfidence, failures } = await processSimpleRows(supabase, userId, candidateRows);

  const summary: ImportSummary = {
    totalRows: rows.length,
    skippedZeroQuantity,
    malformedLines: malformedLines.filter((n) => n !== 0).length,
    imported,
    lowConfidence,
    failures,
  };

  redirect(buildRedirectUrl("simple", summary));
}

export async function importDexCsv(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=" + encodeURIComponent("Choose a Dex export CSV file first."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  const text = decodeDexCsv(buffer);
  const { rows, malformedLines } = parseDexCsv(text);

  // v1 only handles the English/International export Ross's real sample
  // used — not guessed at for other locales.
  const ownedRows = rows.filter((r) => r.quantity > 0);
  const skippedZeroQuantity = rows.length - ownedRows.length;

  const candidateRows: Array<NormalizedImportRow | { skipReason: string }> = ownedRows.map((row) => {
    if (row.locale && row.locale !== "International") {
      return { skipReason: `locale "${row.locale}" isn't supported yet — only International/English exports are handled` };
    }
    return toDexNormalizedRow(row) ?? { skipReason: `couldn't parse Id column "${row.id}"` };
  });

  const { imported, lowConfidence, failures } = await processRows(supabase, userId, candidateRows);

  const summary: ImportSummary = {
    totalRows: rows.length,
    skippedZeroQuantity,
    malformedLines: malformedLines.filter((n) => n !== 0).length,
    imported,
    lowConfidence,
    failures,
  };

  redirect(buildRedirectUrl("dex", summary));
}

export async function importPulseTcgCsv(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=" + encodeURIComponent("Choose a PulseTCG export CSV file first."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  const text = decodePulseTcgCsv(buffer);
  const { rows, malformedLines } = parsePulseTcgCsv(text);

  const ownedRows = rows.filter((r) => r.quantity > 0);
  const skippedZeroQuantity = rows.length - ownedRows.length;

  const candidateRows: Array<NormalizedImportRow | { skipReason: string }> = ownedRows.map(toPulseTcgNormalizedRow);

  const { imported, lowConfidence, failures } = await processRows(supabase, userId, candidateRows);

  const summary: ImportSummary = {
    totalRows: rows.length,
    skippedZeroQuantity,
    malformedLines: malformedLines.filter((n) => n !== 0).length,
    imported,
    lowConfidence,
    failures,
  };

  redirect(buildRedirectUrl("pulsetcg", summary));
}

export async function importCollectrCsv(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=" + encodeURIComponent("Choose a Collectr export file first."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  let rows, malformedLines;
  try {
    ({ rows, malformedLines } = await parseCollectrExport(buffer));
  } catch (err) {
    // The real export is a genuine .xlsx workbook, not delimited text —
    // an upload that isn't actually a valid spreadsheet (wrong file
    // entirely, corrupted download) throws while being parsed rather than
    // silently returning zero rows. Reported as a normal user-facing
    // error rather than a 500, same as the "choose a file first" checks
    // above.
    redirect(
      "/import?error=" +
        encodeURIComponent(
          `Couldn't read that file as a Collectr export: ${(err as Error).message}. Make sure it's the unmodified export from Collectr.`
        )
    );
  }

  const ownedRows = rows.filter((r) => r.quantity > 0);
  const skippedZeroQuantity = rows.length - ownedRows.length;

  // Real duplicate rows (same print split across two lines instead of one
  // Quantity=2 line) are summed BEFORE matching — see aggregateDuplicateRows
  // in src/lib/collectrImport.ts for why this matters here specifically.
  const deduped = aggregateDuplicateRows(ownedRows);

  const candidateRows: Array<{ row: NormalizedImportRow; languages: CardVariantLanguage[] } | { skipReason: string }> =
    deduped.map(toCollectrNormalizedRow);

  const { imported, lowConfidence, failures } = await processCollectrRows(supabase, userId, candidateRows);

  const summary: ImportSummary = {
    totalRows: rows.length,
    skippedZeroQuantity,
    malformedLines: malformedLines.filter((n) => n !== 0).length,
    imported,
    lowConfidence,
    failures,
  };

  redirect(buildRedirectUrl("collectr", summary));
}
