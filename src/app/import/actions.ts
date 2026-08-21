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

function buildRedirectUrl(source: "dex" | "pulsetcg", summary: ImportSummary): string {
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
