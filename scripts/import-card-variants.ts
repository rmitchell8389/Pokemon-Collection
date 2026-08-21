// Adds real print-variant rows (holo / reverse holo / 1st edition / etc.)
// for every already-synced card that has more than one, sourced from
// data/card-variants-index.json (built from TCGdex's own open-source
// cards-database repo — see src/lib/cardVariants.ts's header for the full
// explanation of why that source is used instead of the live API).
//
// ZERO-RISK migration design: an existing card's row (id, and every
// collection_entries row pointing at it) is NEVER modified — it keeps
// representing whichever variant is "primary" for that card (see
// pickPrimaryVariant), with `variant` staying null exactly like every row
// meant before this feature existed. Only NEW rows get inserted, one per
// additional (non-primary) variant, with a suffixed id ("<id>-<variant>"),
// a suffixed display name ("<name> (<Label>)"), and `variant` set to the
// raw variant key. Nothing is ever deleted or updated by this script.
//
// Usage:
//   npx tsx scripts/import-card-variants.ts --lang=en --set=sv01        # dry run, one set
//   npx tsx scripts/import-card-variants.ts --lang=en --set=sv01 --commit
//   npx tsx scripts/import-card-variants.ts --lang=en                   # dry run, whole language
//   npx tsx scripts/import-card-variants.ts --lang=en --commit          # write, whole language
//   npx tsx scripts/import-card-variants.ts --commit                    # write, ALL 4 languages
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local, same as every other
// importer in this project. Safe to re-run — upserts are idempotent
// (onConflict id,language), so a repeat run just re-writes the same new
// rows rather than duplicating them.
//
// Coverage is NOT 100%: data/card-variants-index.json only has entries for
// cards actually present in the cards-database repo as of the 2026-08-21
// clone, which doesn't perfectly overlap every card this app has synced
// from the live TCGdex API. Cards with no index entry are counted and
// reported, not treated as an error — see the "no variant data" count in
// the summary.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { lookupVariants, pickPrimaryVariant, labelVariant, type CardVariantLanguage } from "../src/lib/cardVariants";

const LANGUAGES: CardVariantLanguage[] = ["en", "ja", "zh-tw", "zh-cn"];
const PAGE_SIZE = 1000;
const BATCH_SIZE = 500;

interface CardRow {
  id: string;
  language: string;
  set_id: string;
  set_name: string;
  card_number: string;
  name: string;
  national_dex_no: number | null;
  rarity: string | null;
  image_url: string | null;
  variant: string | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const langArg = args.find((a) => a.startsWith("--lang="))?.split("=")[1];
  const setArg = args.find((a) => a.startsWith("--set="))?.split("=")[1];

  const languages: CardVariantLanguage[] = langArg ? [langArg as CardVariantLanguage] : [...LANGUAGES];
  for (const l of languages) {
    if (!LANGUAGES.includes(l)) {
      throw new Error(`Unknown language "${l}". Expected one of: ${LANGUAGES.join(", ")}`);
    }
  }

  return { commit, languages, setFilter: setArg };
}

async function main() {
  const { commit, languages, setFilter } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in."
    );
  }
  const supabase = createClient(url, serviceKey);

  console.log(`${commit ? "COMMIT" : "DRY RUN"} — variant import for ${languages.join(", ")}${setFilter ? ` (set=${setFilter} only)` : ""}\n`);

  let grandTotalNewRows = 0;

  for (const language of languages) {
    console.log(`=== ${language} ===`);

    const existing: CardRow[] = [];
    let from = 0;
    for (;;) {
      let query = supabase
        .from("cards")
        .select("id, language, set_id, set_name, card_number, name, national_dex_no, rarity, image_url, variant")
        .eq("language", language)
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (setFilter) query = query.eq("set_id", setFilter);

      const { data, error } = await query;
      if (error) {
        console.error(`  ! failed to read existing cards: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;
      existing.push(...(data as CardRow[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    console.log(`  ${existing.length} existing card(s) loaded`);

    // Only look at rows that still represent the pre-variant-tracking
    // "one row per physical card" state (variant is null) — a row that
    // already has a variant set is itself one of this script's own
    // additions from a prior run, not a card to re-expand.
    const candidates = existing.filter((r) => r.variant === null);

    let noIndexData = 0;
    let singleVariant = 0;
    let multiVariant = 0;
    const newRows: CardRow[] = [];
    const sampleLines: string[] = [];

    for (const row of candidates) {
      const variants = lookupVariants(language, row.set_id, row.card_number);
      if (!variants || variants.length === 0) {
        noIndexData++;
        continue;
      }
      if (variants.length === 1) {
        singleVariant++;
        continue;
      }

      multiVariant++;
      const primary = pickPrimaryVariant(variants);
      const others = variants.filter((v) => v !== primary);

      for (const variantKey of others) {
        const label = labelVariant(variantKey);
        newRows.push({
          id: `${row.id}-${variantKey}`,
          language: row.language,
          set_id: row.set_id,
          set_name: row.set_name,
          card_number: row.card_number,
          name: `${row.name} (${label})`,
          national_dex_no: row.national_dex_no,
          rarity: row.rarity,
          image_url: row.image_url,
          variant: variantKey,
        });
        if (sampleLines.length < 5) {
          sampleLines.push(`    ${row.id} -> ${newRows[newRows.length - 1].id}  "${newRows[newRows.length - 1].name}"`);
        }
      }
    }

    console.log(
      `  ${noIndexData} card(s) with no variant data in the index, ${singleVariant} single-variant (no new rows needed), ${multiVariant} multi-variant card(s)`
    );
    console.log(`  ${newRows.length} new row(s) to add`);
    if (sampleLines.length > 0) {
      console.log("  sample:");
      for (const line of sampleLines) console.log(line);
    }

    grandTotalNewRows += newRows.length;

    if (!commit || newRows.length === 0) continue;

    for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
      const batch = newRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("cards").upsert(batch, { onConflict: "id,language" });
      if (error) {
        console.error(`  ! batch upsert failed (${error.message}) — retrying row by row`);
        let ok = 0;
        for (const row of batch) {
          const { error: rowError } = await supabase.from("cards").upsert(row, { onConflict: "id,language" });
          if (rowError) console.error(`    ! skipped ${row.id}: ${rowError.message}`);
          else ok++;
        }
        console.log(`    recovered ${ok}/${batch.length} row(s) individually`);
      }
    }
    console.log(`  committed ${newRows.length} new row(s)`);
  }

  console.log(`\n${commit ? "Committed" : "[DRY RUN] Would add"} ${grandTotalNewRows} new row(s) total across ${languages.length} language(s).`);
  if (!commit) {
    console.log("Re-run with --commit to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
