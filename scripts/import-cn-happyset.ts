// Imports the "嗨皮组合" (Happy Set) articles — see
// src/lib/cnHappySetImport.ts for the full mechanism and the round-8-was-
// wrong correction this closes out.
//
// Usage:
//   npx tsx scripts/import-cn-happyset.ts                # report only, all 5 sets
//   npx tsx scripts/import-cn-happyset.ts --commit        # report + write to DB
//   npx tsx scripts/import-cn-happyset.ts CSVH1C           # subset
//
// Default is report-only, no DB writes, no .env/Supabase needed. Fetches
// live from wiki.52poke.com — run from a real machine, not this sandbox.
//
// Coverage is genuinely uneven per set (see the lib file's header) — a
// "raw entryjp lines vs parsed" style mismatch note is NOT printed here the
// way other importers do, because raw > parsed is EXPECTED (repeat/pull-
// order listings get deduped, not a parser bug). Watch poolsCovered instead
// to see which of 卡组/改造包/奖赏包 the wiki has actually documented for
// each set — CSVH5C is expected to show nothing at all right now.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { scoutHappySetSet, scoutAllHappySets, HAPPY_SET_SETS, type HappySetResult } from "../src/lib/cnHappySetImport";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const requested = args.filter((a) => !a.startsWith("--"));

  console.log(
    `Scoping Happy Set(s)${requested.length ? `: ${requested.join(", ")}` : ` (${HAPPY_SET_SETS.map((s) => s.setId).join(", ")})`}${
      commit ? " — will WRITE to the DB" : " — report only, no DB writes"
    }.\n`
  );

  let results: HappySetResult[];
  if (requested.length > 0) {
    results = [];
    for (const setId of requested) {
      const def = HAPPY_SET_SETS.find((s) => s.setId === setId);
      if (!def) {
        console.log(`${setId}: not a known code (expected one of ${HAPPY_SET_SETS.map((s) => s.setId).join(", ")})`);
        continue;
      }
      results.push(await scoutHappySetSet(def));
    }
  } else {
    results = await scoutAllHappySets();
  }

  console.log(`=== SUMMARY ===`);
  let totalCards = 0;
  for (const r of results) {
    if (!r.found) {
      console.log(`${r.setId}: page not found — nothing to import.`);
      continue;
    }
    const poolNote = r.poolsCovered.length > 0 ? `pools documented: ${r.poolsCovered.join(", ")}` : "no pools documented yet";
    console.log(`${r.setId} "${r.setName}": ${r.parsedEntries} unique card(s) (${r.rawEntryLines} raw listing(s) before dedup) — ${poolNote}.`);
    totalCards += r.parsedEntries;
  }
  console.log(`\nTotal: ${totalCards} card(s) across ${results.filter((r) => r.found).length} set(s).`);

  console.log(`\nSample (first 10 of first covered set):`);
  const firstCovered = results.find((r) => r.rows.length > 0);
  if (firstCovered) {
    for (const row of firstCovered.rows.slice(0, 10)) {
      console.log(`  ${row.card_number}  ${row.name}`);
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
