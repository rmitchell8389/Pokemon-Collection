// Imports the plain numbered zh-cn booster sets — see
// src/lib/cnBoosterSetImport.ts for the full mechanism and claude/spec.md
// "zh-cn round 12" for why this exists. Despite the filename (kept as-is
// once Ross already had it saved locally), this now covers whatever's in
// BOOSTER_SETS — CS1 (Dynamax Clash, all 5 sub-sets, committed round 13)
// plus CS2aC/CS2bC (Vivid Portrayals, added round 14) so far. New sets get
// added to that one array as their real wiki titles get confirmed — this
// script and cnBoosterSetImport.ts's parsing logic don't need to change.
//
// Usage:
//   npx tsx scripts/import-cn-dynamax-clash.ts                # report only, all sets
//   npx tsx scripts/import-cn-dynamax-clash.ts --commit        # report + write to DB
//   npx tsx scripts/import-cn-dynamax-clash.ts CS2aC CS2bC      # subset
//
// Default is report-only, no DB writes, no .env/Supabase needed. Fetches
// live from wiki.52poke.com — run from a real machine, not this sandbox.
// Already-committed sets (CS1 line) are safe to re-run — upsert just
// overwrites with the same data, doesn't duplicate.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { scoutBoosterSet, scoutAllBoosterSets, BOOSTER_SETS, type BoosterSetResult } from "../src/lib/cnBoosterSetImport";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const requested = args.filter((a) => !a.startsWith("--"));

  console.log(
    `Scoping Dynamax Clash set(s)${requested.length ? `: ${requested.join(", ")}` : ` (${BOOSTER_SETS.map((s) => s.setId).join(", ")})`}${
      commit ? " — will WRITE to the DB" : " — report only, no DB writes"
    }.\n`
  );

  let results: BoosterSetResult[];
  if (requested.length > 0) {
    results = [];
    for (const setId of requested) {
      const def = BOOSTER_SETS.find((s) => s.setId === setId);
      if (!def) {
        console.log(`${setId}: not a known code (expected one of ${BOOSTER_SETS.map((s) => s.setId).join(", ")})`);
        continue;
      }
      results.push(await scoutBoosterSet(def));
    }
  } else {
    results = await scoutAllBoosterSets();
  }

  console.log(`=== SUMMARY ===`);
  let totalCards = 0;
  for (const r of results) {
    if (!r.found) {
      console.log(`${r.setId}: page not found — nothing to import.`);
      continue;
    }
    console.log(`${r.setId} "${r.setName}": ${r.parsedEntries} unique card(s) (${r.rawEntryLines} raw listing(s) before dedup).`);
    totalCards += r.parsedEntries;
  }
  console.log(`\nTotal: ${totalCards} card(s) across ${results.filter((r) => r.found).length} set(s).`);

  console.log(`\nSample (first 10 of first covered set):`);
  const firstCovered = results.find((r) => r.rows.length > 0);
  if (firstCovered) {
    for (const row of firstCovered.rows.slice(0, 10)) {
      console.log(`  ${row.card_number}  ${row.name}${row.rarity ? `  [${row.rarity}]` : ""}`);
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
