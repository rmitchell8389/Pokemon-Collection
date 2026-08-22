// Imports the SM-P and SV-P Simplified Chinese "Black Star Promos" lines —
// see src/lib/cnBlackStarPromoImport.ts for the full mechanism explanation
// and the round-4-was-wrong correction this closes out.
//
// Usage:
//   npx tsx scripts/import-cn-black-star-promos.ts                # report only, both sets
//   npx tsx scripts/import-cn-black-star-promos.ts --commit        # report + write to DB
//   npx tsx scripts/import-cn-black-star-promos.ts SM-P            # subset
//   npx tsx scripts/import-cn-black-star-promos.ts SM-P --commit   # subset + write
//
// Default is report-only, no DB writes, no .env/Supabase needed. This
// script fetches live from wiki.52poke.com — will NOT work from this
// project's cloud sandbox (confirmed 2026-08-22: the sandbox can't reach
// the domain at all, not just rate-limited). Run from a real machine, same
// as every other zh-cn scout/import script in this project.
//
// Watch the "raw entry lines vs parsed" and any duplicate-number warning —
// this is a LIVE, still-growing promo line (SV-P's source text runs through
// 2025 event dates), so re-running this later is expected to find MORE
// cards. A duplicate warning means the wiki's own numbering collided
// (happened once already for SV-P's unnumbered basic-energy trophy cards,
// where "FIG" is reused for both a Fire and a Fighting card — that's a real
// wiki inconsistency, not a parser bug, and doesn't affect numbered rows).

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  scoutBlackStarPromoSet,
  scoutAllBlackStarPromoSets,
  BLACK_STAR_PROMO_SETS,
  type BlackStarPromoResult,
} from "../src/lib/cnBlackStarPromoImport";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const requested = args.filter((a) => !a.startsWith("--"));

  console.log(
    `Scoping Black Star Promo set(s)${requested.length ? `: ${requested.join(", ")}` : " (both SM-P and SV-P)"}${
      commit ? " — will WRITE to the DB" : " — report only, no DB writes"
    }.\n`
  );

  let results: BlackStarPromoResult[];
  if (requested.length > 0) {
    results = [];
    for (const setId of requested) {
      const def = BLACK_STAR_PROMO_SETS.find((s) => s.setId === setId);
      if (!def) {
        console.log(`${setId}: not a known code (expected one of ${BLACK_STAR_PROMO_SETS.map((s) => s.setId).join(", ")})`);
        continue;
      }
      results.push(await scoutBlackStarPromoSet(def));
    }
  } else {
    results = await scoutAllBlackStarPromoSets();
  }

  console.log(`=== SUMMARY ===`);
  let totalCards = 0;
  let anyDuplicates = false;
  for (const r of results) {
    if (!r.found) {
      console.log(`${r.setId}: page not found — nothing to import.`);
      continue;
    }
    const mismatchNote =
      r.rawEntryLines !== r.parsedEntries
        ? `  [!] raw lines=${r.rawEntryLines} vs parsed=${r.parsedEntries} — parser missed some, check manually`
        : "";
    const dupeNote = r.duplicateNumbers.length > 0 ? `  [!] duplicate card_number(s): ${r.duplicateNumbers.join(", ")} — review before committing` : "";
    if (dupeNote) anyDuplicates = true;
    console.log(`${r.setId} "${r.setName}": ${r.parsedEntries} card(s) parsed.${mismatchNote}${dupeNote}`);
    totalCards += r.parsedEntries;
  }
  console.log(`\nTotal: ${totalCards} card(s) across ${results.filter((r) => r.found).length} set(s).`);

  console.log(`\nSample (first 5 and last 5 of first covered set):`);
  const firstCovered = results.find((r) => r.rows.length > 0);
  if (firstCovered) {
    for (const row of firstCovered.rows.slice(0, 5)) {
      console.log(`  ${row.card_number}  ${row.name}`);
    }
    console.log(`  ...`);
    for (const row of firstCovered.rows.slice(-5)) {
      console.log(`  ${row.card_number}  ${row.name}`);
    }
  }

  if (anyDuplicates) {
    console.log(`\n[!] At least one set has duplicate card_number(s) — review the list above before running --commit.`);
    console.log(`    A duplicate means two rows would upsert to the same id and one would silently overwrite the other.`);
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
