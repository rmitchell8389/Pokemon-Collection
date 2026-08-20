// Scopes ALL the remaining candidate zh-cn set codes at once, using the same
// wiki reprint-pattern mechanism confirmed for CSMPiC and CS1aC (see
// src/lib/cnReprintImport.ts).
//
// The list below is every zh-cn set_id TCGdex's own set-list endpoint knows
// about (confirmed via scripts/list-tcgdex-zhcn-sets.ts) that ISN'T one of
// the 8 sets we already have real TCGdex card data for, and ISN'T a Gem
// Pack-style set (CBB2C, CBB3C, CBB4C, CBB5C — those use a different,
// bulk-table wiki format and need a separate importer, not this one).
//
// Usage:
//   npx tsx scripts/import-cn-reprint-sets-batch.ts               # report only
//   npx tsx scripts/import-cn-reprint-sets-batch.ts --commit       # report + write covered sets to the DB
//   npx tsx scripts/import-cn-reprint-sets-batch.ts CS1aC CS1bC    # subset only
//   npx tsx scripts/import-cn-reprint-sets-batch.ts CS1aC --commit # subset + write
//
// Default is report-only, no DB writes, no .env/Supabase needed at all.
// --commit additionally upserts every row from every set that had coverage
// (parsedEntries > 0) — same idempotent upsert (onConflict id,language) as
// the single-set script, same never-write-unverified-image rule per row.
//
// UPDATE 2026-08-20: a first real run hit a 429 partway through (8/44 codes
// succeeded, then every remaining code failed instantly) — a real rate
// limit exists even from a normal machine, it just takes real request
// volume to trip it. cnReprintImport.ts now retries with backoff on 429,
// and this script adds a proactive pause between codes on top of that so
// it hopefully never gets there in the first place. A second real run after
// that fix cleared 36/44 codes, 3668 cards, 0 images (expected — same
// documented-but-not-uploaded pattern as CSMPiC/SV8a all day).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { scoutReprintSet, type CardRow } from "../src/lib/cnReprintImport";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CANDIDATE_SET_IDS = [
  // Sword & Shield-China line
  "CS1.5C", "CS1aC", "CS1bC",
  "CS2.5C", "CS2aC", "CS2bC",
  "CS3.5C", "CS3aC", "CS3bC",
  "CS4.5C", "CS4aC", "CS4bC",
  "CS5.5C", "CS5aC", "CS5bC",
  "CS6.5C", "CS6aC", "CS6bC",
  // Sun & Moon-China line — the lowercase codes (csm1a, csm1b, ...) came
  // back with no coverage on a real run; almost certainly duplicate
  // listings of the same sets under a second ID casing in TCGdex's own
  // list, since the uppercase CSM*C versions all resolved fine. Kept here
  // (harmless, cheap to re-check) rather than assumed dead.
  "csm1.5", "CSM1.5C", "csm1a", "CSM1aC", "csm1b", "CSM1bC", "csm1c", "CSM1cC",
  "csm2.5", "CSM2.5C", "csm2a", "CSM2aC", "csm2b", "CSM2bC", "csm2c", "CSM2cC",
  // Scarlet & Violet-China line
  "CSV1C", "CSV2C", "CSV3C", "CSV4C", "CSV5C", "CSV6C", "CSV7C", "CSV8C", "CSV9C", "CSV9.5C",
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
    console.log(`\nNo coverage found (may use a different wiki format, or aren't documented yet):`);
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

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});