// Round 2 of the reprint-pattern batch scan — see
// import-cn-reprint-sets-batch.ts (round 1, 36/44 covered, 3668 cards,
// committed 2026-08-20) for the mechanism. That round's candidate list was
// TCGdex's own declared zh-cn set list. This round's candidate list instead
// comes from TCG Collector's full 139-set China listing (confirmed live via
// WebFetch against tcgcollector.com/sets/cn, respecting robots.txt — that
// page and individual set pages are NOT disallowed, only pagination params
// and /api/ are), which is a materially bigger picture: TCGdex's declared
// 57 sets undercounts what's actually been physically released.
//
// Ross gave the real target for this: TCG Collector shows 12,508 total
// cards for the China region. Running total after round 1 + Gem Packs is
// nowhere near that — most of the gap is this long tail of accessory SKUs
// (Deck Building Gift Boxes, Card Display Set Gift Boxes, Starter Decks,
// Gym Event Promo Packs) plus several substantial real sets TCGdex doesn't
// register at all (Chasing Glory at 287 cards, the SVP promo catch-all at
// 443, Collect 151 at 192, Battle Party sets, Happy Set lines, Theme Packs).
//
// This list does NOT include:
//   - Gem Packs (CBB1C-CBB6C) — separate importer, see cnGemPackImport.ts
//   - The 18 codes already scanned+committed in round 1 (CS1.5C..CS6bC line)
//   - "Gym Event Promo Pack Vol. 2-6" — TCG Collector's page didn't show a
//     short code for these, only the display name. Skipped until a real
//     code is found (not guessed).
//   - "30th Celebration" (30thC) — TCG Collector marks it "Coming soon",
//     not released yet, nothing to import.
//
// Several CSVH* (Happy Set) and CSVM* (Master Strategy Deck) codes below are
// EDUCATED GUESSES at the numbering pattern (only CSVH5C's exact code was
// visible in the source; CSVH1C-CSVH4C follow the same "5th release = most
// recent" pattern TCG Collector's list implies). Wrong guesses are harmless
// here — scoutReprintSet just reports "no wiki coverage found" for a code
// that doesn't exist, same as any other miss.
//
// Usage: identical to import-cn-reprint-sets-batch.ts
//   npx tsx scripts/import-cn-reprint-sets-batch2.ts               # report only
//   npx tsx scripts/import-cn-reprint-sets-batch2.ts --commit       # report + write
//   npx tsx scripts/import-cn-reprint-sets-batch2.ts CSV10C SVP     # subset
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { scoutReprintSet, type CardRow } from "../src/lib/cnReprintImport";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CANDIDATE_SET_IDS = [
  // Large standalone sets TCGdex doesn't register at all
  "CSV10C", // Chasing Glory, 287 cards
  "151C", // Collect 151, 192 cards
  "SVP", // Scarlet & Violet Promos, 443 cards
  "30thP", // 30th Anniversary Celebration, 29 cards

  // Battle Party / Theme Pack / Special Pack / Battle Academy lines
  "CSVE1C", "CSVE1pC", // Battle Party: Dream Together (+ reward pack)
  "CSVE2C", "CSVE2pC", // Battle Party: Shining Dream (+ reward pack)
  "CSVL1C", // Journey Theme Pack
  "CSVL2C", // Travel Theme Pack
  "CSVNC", // Kitakami Special Pack
  "CSVSC", // Battle Academy

  // Master Strategy Deck Building Sets
  "CSVM1aC", "CSVM1bC", "CSVM1cC",
  "CSVM2aC", "CSVM2bC", "CSVM2cC",

  // Happy Set line — CSVH5C confirmed exact; CSVH1C-CSVH4C + e/a/p variant
  // suffixes are pattern guesses (see file header note).
  "CSVH1C", "CSVH1eC", "CSVH1aC", "CSVH1pC",
  "CSVH2C", "CSVH2eC", "CSVH2aC", "CSVH2pC",
  "CSVH3C", "CSVH3eC", "CSVH3aC", "CSVH3pC",
  "CSVH4C", "CSVH4eC", "CSVH4aC", "CSVH4pC",
  "CSVH5C", "CSVH5eC", "CSVH5aC", "CSVH5pC",

  // Sword & Shield-China accessory/gift-box/starter-deck tail
  "CSXC", "CSYC", "CS0LC", "CSZC", "CS6.1C", "CSUC",
  "CSOC", "CS5.1C", "CSJC", "CSNC", "CS5DC",
  "CS4DaC", "CSIC", "CSHC", "CS4.1C", "CSFC", "CSEC",
  "CSDC", "CS2DaC", "CS2.1C", "CSBC", "CSCC", "CS3DC", "CSGC",

  // Cross-series promo catch-all
  "MP", // Mega Evolution Promos, 1 card
];

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const requested = args.filter((a) => !a.startsWith("--"));
  const setIds = requested.length > 0 ? requested : CANDIDATE_SET_IDS;

  console.log(`Scoping ${setIds.length} candidate set code(s)${commit ? " — will WRITE covered sets to the DB" : " — report only, no DB writes"}.\n`);

  const results: {
    setId: string;
    setName: string | null;
    pages: number;
    parsed: number;
    images: number;
    rows: CardRow[];
  }[] = [];

  for (let i = 0; i < setIds.length; i++) {
    const setId = setIds[i];
    process.stdout.write(`${setId}... `);
    try {
      const result = await scoutReprintSet(setId);
      console.log(
        result.candidatePages === 0
          ? "no wiki coverage found"
          : `${result.parsedEntries} card(s), ${result.verifiedImages} image(s) — "${result.setName ?? "(name unknown)"}"`
      );
      results.push({
        setId,
        setName: result.setName,
        pages: result.candidatePages,
        parsed: result.parsedEntries,
        images: result.verifiedImages,
        rows: result.rows,
      });
    } catch (err) {
      console.log(`! error: ${(err as Error).message}`);
      results.push({ setId, setName: null, pages: 0, parsed: 0, images: 0, rows: [] });
    }
    if (i < setIds.length - 1) await sleep(1500);
  }

  const covered = results.filter((r) => r.parsed > 0);
  const uncovered = results.filter((r) => r.parsed === 0);
  const totalCards = covered.reduce((sum, r) => sum + r.parsed, 0);
  const totalImages = covered.reduce((sum, r) => sum + r.images, 0);

  console.log(`\n=== SUMMARY ===`);
  console.log(`${covered.length}/${results.length} set(s) have wiki coverage via this pattern.`);
  console.log(`Total cards available to import: ${totalCards} (${totalImages} with a verified image so far).`);

  if (covered.length > 0) {
    console.log(`\nCovered sets:`);
    for (const r of covered) {
      console.log(`  ${r.setId}  ${r.parsed} card(s)  ${r.images} image(s)  "${r.setName ?? "?"}"`);
    }
  }

  if (uncovered.length > 0) {
    console.log(`\nNo coverage found (may use a different wiki format, may be a guessed code that doesn't exist, or aren't documented yet):`);
    for (const r of uncovered) {
      console.log(`  ${r.setId}`);
    }
  }

  if (!commit) {
    console.log(`\nReport only — nothing written. Re-run with --commit to write the ${totalCards} card(s) above to the database.`);
    return;
  }

  if (covered.length === 0) {
    console.log(`\nNothing to commit.`);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  console.log(`\nCommitting ${totalCards} row(s) across ${covered.length} set(s)...`);

  for (const r of covered) {
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

  // NOTE: this round has already proven prone to the same silent-duplicate
  // collision bug round 1 hit (see fix-cn-reprint-duplicates.ts) whenever a
  // batch upsert falls back to row-by-row. If any set above shows a
  // "batch upsert failed" line, run debug-cn-reprint-duplicates.ts against
  // it afterward before assuming the recovered count is the true count.
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
