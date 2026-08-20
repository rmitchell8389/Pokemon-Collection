// Round 3 of the reprint-pattern batch scan — see import-cn-reprint-sets-batch.ts
// (round 1) and import-cn-reprint-sets-batch2.ts (round 2) for the mechanism.
//
// This round's candidate list comes from the "Sun & Moon Series" and
// "Unnumbered Energies" sections of TCG Collector's China set list — the
// two sections that WebFetch could never reach directly (confirmed 3
// separate ways: page-length truncation regardless of prompt, no per-series
// URL exists, sorting/series-jump links are client-side JS only). Ross
// pasted screenshots of both sections directly instead.
//
// IMPORTANT: 8 codes from the Sun & Moon Series screenshot are NOT included
// below because they're already committed from round 1 without us
// realizing they were the "Sun & Moon Series" ones at the time:
//   CSM1.5C (Battle Elite, 88), CSM1aC/CSM1bC/CSM1cC (Storming Emergence
//   Radiant/Verdant/Abundant, 211/204/212), CSM2.5C (Striking Competition,
//   99), CSM2aC/CSM2bC/CSM2cC (Shining Synergy Shower/Supreme/Summon,
//   194/193/192). CSMPiC (Battle Party Set Reward Pack, 48) is also already
//   in from Phase 1. Re-running these here would just re-upsert the same
//   rows (harmless — upserts are idempotent — but wasteful), so they're
//   deliberately left out of the candidate list.
//
// Also NOT included: "Scarlet & Violet Energies" (Unnumbered Energies
// section, 8 cards) — TCG Collector's own page shows no short code for it
// (just a dash), same problem as the 5 Gym Event Promo Pack volumes from
// round 2. Not guessed at.
//
// SVP ("Scarlet & Violet Promos", 443 cards) was investigated directly
// (2026-08-20) and is NOT in this list either: insource:"cnicon=SVP" and
// insource:"cnicon=SVPC" (a guessed China-suffix variant) both returned 0
// hits — a real, confirmed gap via this mechanism, not a wrong-code guess.
// Whatever documents SVP on the wiki (if anything), it isn't this pattern.
//
// Usage: identical to the other batch scripts
//   npx tsx scripts/import-cn-reprint-sets-batch3.ts               # report only
//   npx tsx scripts/import-cn-reprint-sets-batch3.ts --commit       # report + write
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { scoutReprintSet, type CardRow } from "../src/lib/cnReprintImport";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CANDIDATE_SET_IDS = [
  // Sun & Moon Promos catch-all (SVP's sibling — SVP itself has no coverage,
  // worth checking whether SMP fares any better; untested due to a wiki
  // rate-limit hit mid-research, cheap to just let the real run answer it)
  "SMP",

  // Battle Party Set line — 16 codes (Reward Pack / CSMPiC already done)
  "CSMPgC", "CSMPpC", // Darkness Deck / Modification Pack
  "CSMPfC", "CSMPoC", // Fighting Deck / Modification Pack
  "CSMPbC", "CSMPkC", // Fire Deck / Modification Pack
  "CSMPaC", "CSMPjC", // Grass Deck / Modification Pack
  "CSMPdC", "CSMPmC", // Lightning Deck / Modification Pack
  "CSMPhC", "CSMPqC", // Metal Deck / Modification Pack
  "CSMPeC", "CSMPnC", // Psychic Deck / Modification Pack
  "CSMPcC", "CSMPlC", // Water Deck / Modification Pack

  // Everything else new from the Sun & Moon Series screenshot
  "CSM2.1C", // Golden Energy, 54 cards
  "CSMAC",   // Arceus & Dialga & Palkia-GX Advanced Deck Building Gift Box, 28
  "CSMJC",   // Shining Pokémon Poké Ball Gift Box, 15
  "CSM2DC",  // Shining Synergy GX Starter Deck, 357
  "CSMYC",   // Eevee-GX Box Set, 8
  "CSMLC",   // Lillie's Support Box, 5
  "CSM1DC",  // Storming Emergence GX Starter Deck, 336
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

  // NOTE: watch for the same silent-duplicate-collision failure mode rounds
  // 1 and 2 both hit — if any "batch upsert failed" line appears above, run
  // debug-cn-reprint-duplicates.ts / fix-cn-reprint-duplicates.ts against
  // that set_id afterward rather than trusting the "recovered N/N" line.
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
