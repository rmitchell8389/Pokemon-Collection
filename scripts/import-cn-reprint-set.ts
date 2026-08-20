// CLI wrapper around src/lib/cnReprintImport.ts's scoutReprintSet — see that
// file for the full mechanism explanation. Imports zh-cn card ROWS for a
// single set TCGdex has no card data for, sourced from 52poke wiki's
// per-card reprint pattern (confirmed for CSMPiC and CS1aC).
//
// Usage:
//   npx tsx scripts/import-cn-reprint-set.ts --set=CS1aC
//   npx tsx scripts/import-cn-reprint-set.ts --set=CS1aC --dry-run
//   npx tsx scripts/import-cn-reprint-set.ts --set=CS1aC --name="Override name"
//
// --name overrides the auto-derived set name (normally pulled from the
// wiki's own cnexpansion field — more trustworthy than TCGdex's declared
// name for these codes, which has already proven unreliable).
//
// --dry-run prints what would be written without touching the DB.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (skipped in --dry-run
// mode). Upserts are idempotent (onConflict id,language) — safe to re-run.
// For scoping many codes at once, see import-cn-reprint-sets-batch.ts.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { scoutReprintSet } from "../src/lib/cnReprintImport";

function parseArgs() {
  const args = process.argv.slice(2);
  const setId = args.find((a) => a.startsWith("--set="))?.split("=")[1];
  const name = args.find((a) => a.startsWith("--name="))?.split("=")[1];
  const dryRun = args.includes("--dry-run");

  if (!setId) {
    throw new Error(
      "Usage: npx tsx scripts/import-cn-reprint-set.ts --set=CODE [--name=\"override\"] [--dry-run]"
    );
  }

  return { setId, name, dryRun };
}

async function main() {
  const { setId, name, dryRun } = parseArgs();

  console.log(`=== ${setId} ${dryRun ? "[DRY RUN]" : ""} ===`);
  console.log("Searching wiki and fetching full wikitext for every reprinted card...");

  const result = await scoutReprintSet(setId, { name });

  console.log(`Candidate pages: ${result.candidatePages}`);
  if (result.candidatePages === 0) {
    console.log("Nothing found — this set may use a different wiki documentation pattern (e.g. a Gem Pack-style bulk table), or isn't documented at all.");
    return;
  }

  console.log(`Set name (derived): ${result.setName ?? "(none found — will fall back to the code itself)"}`);
  console.log(`Parsed: ${result.parsedEntries}/${result.candidatePages} card(s).`);
  console.log(`Checked ${result.candidateImages} candidate image file(s) against the wiki — ${result.verifiedImages} verified real.`);

  console.log(`\nSummary: ${result.rows.length} card row(s) built, ${result.verifiedImages} with a verified image.`);
  console.log("Sample:");
  for (const r of result.rows.slice(0, 5)) {
    console.log(`  ${r.card_number}  ${r.name}  rarity=${r.rarity ?? "?"}  image=${r.image_url ? "yes" : "no"}`);
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Not writing to the database. Re-run without --dry-run to commit.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  const { error } = await supabase.from("cards").upsert(result.rows, { onConflict: "id,language" });
  if (error) {
    console.error(`! batch upsert failed (${error.message}) — retrying row by row`);
    let ok = 0;
    for (const row of result.rows) {
      const { error: rowError } = await supabase.from("cards").upsert(row, { onConflict: "id,language" });
      if (rowError) console.error(`  ! skipped ${row.id}: ${rowError.message}`);
      else ok++;
    }
    console.log(`Recovered ${ok}/${result.rows.length} row(s) individually.`);
  } else {
    console.log(`Upserted ${result.rows.length} row(s) into the cards table.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
