// Answers the single biggest open question hanging over the vintage JP
// import project: does TCGdex (this app's actual card source, via
// src/lib/tcgdex.ts) even HAVE data for pre-Black&White-era Japanese sets?
// Everything synced into this DB comes from TCGdex, not scraped directly
// from TCG Collector -- so if TCGdex's own catalog stops at some point
// (e.g. only goes back to Black & White, or only as far as Diamond &
// Pearl), the "6,610-card vintage gap" found in the 2026-08-27 JP
// reconciliation isn't a "just point sync-cards.ts at more set ids" fix --
// it needs a different card-data source entirely, same class of problem
// the zh-cn booster-set project solved by scraping wiki.52poke.com instead
// of relying on TCGdex.
//
// This script calls TCGdex's own listSets("ja") (the same helper
// sync-cards.ts already uses) and prints every Japanese set id/name/card
// count TCGdex knows about, sorted oldest-looking-first by cardCount as a
// rough proxy (real sort would need release dates TCGdex doesn't return in
// the brief listing). Cross-reference the output against
// data/tcgcollector-jp-sets-raw.md's Black & White/LEGEND/Platinum/Diamond
// & Pearl/PCG/ADV/Original/Neo/e-Card/VS/Web/Vending Machine/Movie
// Commemorations/Other era entries by set NAME (TCGdex set ids won't match
// TCG Collector's codes in general, per the round-18 findings above).
//
// Usage: npx tsx scripts/ja-tcgdex-vintage-check.ts
// No .env.local / Supabase needed -- this only talks to TCGdex, not the DB.

import { listSets } from "../src/lib/tcgdex";

async function main() {
  console.log("Fetching TCGdex's full ja set list (listSets(\"ja\"))...\n");
  const sets = await listSets("ja");

  console.log(`TCGdex reports ${sets.length} total Japanese sets.\n`);
  console.log(`id\tname\tcardCount.total\tcardCount.official`);
  for (const s of sets) {
    console.log(`${s.id}\t${s.name}\t${s.cardCount?.total ?? "?"}\t${s.cardCount?.official ?? "?"}`);
  }

  console.log(
    "\nManually eyeball the list above for anything that looks pre-2011 (Black & White era or older) --" +
      " e.g. names containing 'Neo', 'Gym', 'e-Card', 'Team Rocket', 'Jungle', 'Fossil', vintage starter" +
      " deck names, etc. If nothing older than 'Black Collection'/'White Collection'-ish names shows up," +
      " TCGdex's ja catalog likely doesn't reach back far enough and the vintage import needs a different" +
      " card-data source (same situation the zh-cn project solved with wiki.52poke.com scraping)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
