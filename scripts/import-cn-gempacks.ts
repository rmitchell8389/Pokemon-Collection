// Imports the Gem Pack line (CBB1C-CBB6C) — see src/lib/cnGemPackImport.ts
// for the full mechanism explanation. This is the set Ross's original
// directive was specifically about: "If the Gem Packs aren't showing up we
// need to pivot to include them."
//
// Usage:
//   npx tsx scripts/import-cn-gempacks.ts                # report only, all 6 packs
//   npx tsx scripts/import-cn-gempacks.ts --commit        # report + write to DB
//   npx tsx scripts/import-cn-gempacks.ts CBB2C           # subset
//   npx tsx scripts/import-cn-gempacks.ts CBB2C --commit  # subset + write
//
// Default is report-only, no DB writes, no .env/Supabase needed.
// Watch the "raw entry lines vs parsed" numbers in the report — if they
// don't match for any pack, the parser missed some lines and that pack's
// count is an undercount, not a clean miss (should print a warning either
// way, but worth a human glance before committing).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { scoutGemPackSet, scoutAllGemPacks, GEM_PACKS, type GemPackResult } from "../src/lib/cnGemPackImport";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const requested = args.filter((a) => !a.startsWith("--"));

  console.log(
    `Scoping Gem Pack set(s)${requested.length ? `: ${requested.join(", ")}` : " (all 6)"}${
      commit ? " — will WRITE to the DB" : " — report only, no DB writes"
    }.\n`
  );

  let results: GemPackResult[];
  if (requested.length > 0) {
    results = [];
    for (let i = 0; i < requested.length; i++) {
      const def = GEM_PACKS.find((g) => g.setId === requested[i]);
      if (!def) {
        console.log(`${requested[i]}: not a known Gem Pack code (expected one of ${GEM_PACKS.map((g) => g.setId).join(", ")})`);
        continue;
      }
      const result = await scoutGemPackSet(def);
      results.push(result);
    }
  } else {
    results = await scoutAllGemPacks();
  }

  console.log(`=== SUMMARY ===`);
  let totalCards = 0;
  let totalImages = 0;
  for (const r of results) {
    if (!r.found) {
      console.log(`${r.setId}: page not found — nothing to import.`);
      continue;
    }
    const mismatchNote = r.rawEntryLines !== r.parsedEntries ? `  [!] raw lines=${r.rawEntryLines} vs parsed=${r.parsedEntries} — parser missed some, check manually` : "";
    console.log(`${r.setId} "${r.setName}": ${r.parsedEntries} card(s) parsed, ${r.verifiedImages}/${r.candidateImages} image(s) verified real.${mismatchNote}`);
    totalCards += r.parsedEntries;
    totalImages += r.verifiedImages;
  }
  console.log(`\nTotal: ${totalCards} card(s) across ${results.filter((r) => r.found).length} pack(s), ${totalImages} with a verified image.`);

  console.log(`\nSample (first 5 of first covered pack):`);
  const firstCovered = results.find((r) => r.rows.length > 0);
  if (firstCovered) {
    for (const row of firstCovered.rows.slice(0, 5)) {
      console.log(`  ${row.card_number}  ${row.name}  rarity=${row.rarity ?? "?"}  image=${row.image_url ? "yes" : "no"}`);
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
