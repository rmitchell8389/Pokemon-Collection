// Imports the GX起始卡组 (GX Starter Deck) bulk-table articles for CSM2DC
// and CSM1DC — see src/lib/cnStarterDeckImport.ts for the mechanism and the
// round-7 discovery this closes out. These decks already have PARTIAL
// coverage in the DB via the per-card reprint pattern (49/357 and 59/336)
// — this importer's rows will upsert on top of those (same id scheme,
// `${setId}-${cardNumber}`), so re-running this is safe and idempotent,
// not additive-on-top-of-additive.
//
// Usage:
//   npx tsx scripts/import-cn-starter-decks.ts                # report only, both decks
//   npx tsx scripts/import-cn-starter-decks.ts --commit        # report + write to DB
//   npx tsx scripts/import-cn-starter-decks.ts CSM2DC           # subset
//
// Default is report-only, no DB writes, no .env/Supabase needed. Fetches
// live from wiki.52poke.com — run from a real machine, not this sandbox.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  scoutStarterDeckSet,
  scoutAllStarterDecks,
  STARTER_DECK_SETS,
  type StarterDeckResult,
} from "../src/lib/cnStarterDeckImport";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const requested = args.filter((a) => !a.startsWith("--"));

  console.log(
    `Scoping starter deck set(s)${requested.length ? `: ${requested.join(", ")}` : " (both CSM2DC and CSM1DC)"}${
      commit ? " — will WRITE to the DB" : " — report only, no DB writes"
    }.\n`
  );

  let results: StarterDeckResult[];
  if (requested.length > 0) {
    results = [];
    for (const setId of requested) {
      const def = STARTER_DECK_SETS.find((s) => s.setId === setId);
      if (!def) {
        console.log(`${setId}: not a known code (expected one of ${STARTER_DECK_SETS.map((s) => s.setId).join(", ")})`);
        continue;
      }
      results.push(await scoutStarterDeckSet(def));
    }
  } else {
    results = await scoutAllStarterDecks();
  }

  console.log(`=== SUMMARY ===`);
  let totalCards = 0;
  for (const r of results) {
    if (!r.found) {
      console.log(`${r.setId}: page not found — nothing to import.`);
      continue;
    }
    const mismatchNote =
      r.rawEntryLines !== r.parsedEntries
        ? `  [!] raw lines=${r.rawEntryLines} vs parsed=${r.parsedEntries} — parser missed some, check manually`
        : "";
    console.log(`${r.setId} "${r.setName}": ${r.parsedEntries} card(s) parsed.${mismatchNote}`);
    totalCards += r.parsedEntries;
  }
  console.log(`\nTotal: ${totalCards} card(s) across ${results.filter((r) => r.found).length} set(s).`);

  console.log(`\nSample (first 5 and last 5 of first covered set):`);
  const firstCovered = results.find((r) => r.rows.length > 0);
  if (firstCovered) {
    for (const row of firstCovered.rows.slice(0, 5)) {
      console.log(`  ${row.card_number}  ${row.name}  rarity=${row.rarity ?? "?"}`);
    }
    console.log(`  ...`);
    for (const row of firstCovered.rows.slice(-5)) {
      console.log(`  ${row.card_number}  ${row.name}  rarity=${row.rarity ?? "?"}`);
    }
  }

  if (!commit) {
    console.log(`\nReport only — nothing written. Re-run with --commit to write ${totalCards} card(s) to the database.`);
    return;
  }

  if (totalCards === 0) {
    console.log(`\nNothing to commit.`);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  console.log(`\nCommitting ${totalCards} row(s)...`);
  for (const r of results) {
    if (r.rows.length === 0) continue;
    const { error } = await supabase.from("cards").upsert(r.rows, { onConflict: "id,language" });
    if (error) {
      console.error(`  ! ${r.setId}: batch upsert failed (${error.message}) — retrying row by row`);
      let ok = 0;
      for (const row of r.rows) {
        const { error: rowError } = await supabase.from("cards").upsert(row, { onConflict: "id,language" });
        if (rowError) console.error(`    ! skipped ${row.id}: ${rowError.message}`);
        else ok++;
      }
      console.log(`    recovered ${ok}/${r.rows.length} row(s) individually for ${r.setId}`);
    } else {
      console.log(`  ${r.setId}: upserted ${r.rows.length} row(s)`);
    }
  }

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
