// One-off diagnostic — NOT wired into any npm script on purpose, run
// directly. Generalizes list-tcgdex-zhcn-sets.ts (which stays as-is, still
// works, kept for history) to any language.
//
// Lists every set TCGdex's own API currently declares for a language, AND
// actually fetches each set's full card list to check whether TCGdex backs
// that declaration with real per-card data. This is the exact check that
// found the zh-cn problem: TCGdex declared 57 sets but only had real card
// data for 8 of them — the other 49 returned 0 cards from the per-set
// endpoint despite a non-zero declared cardCount. Worth checking the same
// way for every language rather than assuming only zh-cn has this issue.
//
// This sandbox can't reach api.tcgdex.net directly (network egress here is
// allowlisted and doesn't include it), so this has to be run from your own
// machine, same as every other script in this project.
//
// Usage:
//   npx tsx scripts/list-tcgdex-sets.ts --lang=en
//   npx tsx scripts/list-tcgdex-sets.ts --lang=ja
//   npx tsx scripts/list-tcgdex-sets.ts --lang=zh-tw
//   npx tsx scripts/list-tcgdex-sets.ts --lang=zh-cn
//
// No Supabase/env vars needed — this only talks to TCGdex, doesn't touch the
// DB, so it can't tell you what's already synced locally, only what TCGdex
// itself claims to have. Paste the full output back.

import { TCGDEX_LANGUAGES, TCG_POCKET_SERIE_ID, type TcgdexLanguage, listSets, getSet, getSerie } from "../src/lib/tcgdex";

const CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseLang(): TcgdexLanguage {
  const arg = process.argv.find((a) => a.startsWith("--lang="))?.split("=")[1];
  if (!arg || !TCGDEX_LANGUAGES.includes(arg as TcgdexLanguage)) {
    throw new Error(`Pass --lang=<one of ${TCGDEX_LANGUAGES.join(", ")}>`);
  }
  return arg as TcgdexLanguage;
}

async function main() {
  const language = parseLang();
  const allSets = await listSets(language);

  // Same exclusion sync-cards.ts applies before writing to the DB — Pokemon
  // TCG Pocket (the mobile-only digital game) is catalogued by TCGdex under
  // a shared "tcgp" series across every language, but this app tracks the
  // physical TCG only. Without this, this script's "actual" sum includes
  // real TCGdex card data for a product that was NEVER meant to be synced,
  // which makes it look like there's free content sitting unsynced when
  // there isn't — caught this the hard way comparing a first unfiltered run
  // against the local DB total and finding the "actual" sum higher than
  // what's synced, purely because of Pocket-only sets like Genetic Apex /
  // Mega Rising / Mega Evolution that were correctly excluded from the DB.
  let pocketSetIds = new Set<string>();
  try {
    const pocketSerie = await getSerie(language, TCG_POCKET_SERIE_ID);
    pocketSetIds = new Set(pocketSerie.sets.map((s) => s.id));
    console.log(`Excluding ${pocketSetIds.size} TCG Pocket set(s) for ${language} (not in scope for this app)\n`);
  } catch (err) {
    console.error(`! couldn't fetch the "tcgp" series for ${language} (${(err as Error).message}) — Pocket sets will NOT be excluded this run, treat totals below with caution\n`);
  }

  const sets = allSets.filter((s) => !pocketSetIds.has(s.id));
  console.log(`TCGdex ${language} sets declared (excluding Pocket): ${sets.length} total`);

  const declaredCardSum = sets.reduce((sum, s) => sum + (s.cardCount?.total ?? 0), 0);
  console.log(`Sum of declared cardCount.total across all sets: ${declaredCardSum}\n`);

  console.log(`Fetching each set's actual card list from TCGdex (this can take a while for large languages)...\n`);

  const results = await mapWithConcurrency(sets, CONCURRENCY, async (s) => {
    try {
      const full = await getSet(language, s.id);
      return { id: s.id, name: s.name, declared: s.cardCount?.total ?? 0, actual: full.cards.length, error: null as string | null };
    } catch (err) {
      return { id: s.id, name: s.name, declared: s.cardCount?.total ?? 0, actual: 0, error: (err as Error).message };
    }
  });

  const actualCardSum = results.reduce((sum, r) => sum + r.actual, 0);
  const emptyOrFailed = results.filter((r) => r.actual === 0);

  console.log(`Sum of ACTUAL cards.length TCGdex returned per set: ${actualCardSum}`);
  console.log(`Sets with 0 actual cards despite being declared: ${emptyOrFailed.length} / ${results.length}\n`);

  if (emptyOrFailed.length > 0) {
    console.log(`These sets are declared but TCGdex has no real per-card data for them (same pattern as zh-cn's 49-of-57 finding):`);
    for (const r of emptyOrFailed.sort((a, b) => b.declared - a.declared)) {
      console.log(`  ${r.id.padEnd(14)} declared=${r.declared.toString().padStart(4)}  ${r.name}${r.error ? `  [fetch error: ${r.error}]` : ""}`);
    }
    console.log();
  }

  console.log(`Full set list, sorted by id:`);
  const sorted = [...results].sort((a, b) => a.id.localeCompare(b.id));
  for (const r of sorted) {
    const flag = r.actual === 0 ? "  <-- EMPTY" : r.actual < r.declared ? "  <-- partial" : "";
    console.log(`${r.id.padEnd(14)} declared=${r.declared.toString().padStart(4)}  actual=${r.actual.toString().padStart(4)}  ${r.name}${flag}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
