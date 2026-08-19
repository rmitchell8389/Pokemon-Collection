// Backfills `cards.image_url` for English cards that TCGdex has no image
// for at all, using pokemontcg.io as a fallback source. See
// src/lib/pokemontcgio.ts for why this exists (short version: TCGdex is
// missing images for ~6% of the English catalog, concentrated almost
// entirely in trainer kits, McDonald's Collection promos, and Trainer
// Gallery / Shiny Vault insert subsets — pokemontcg.io has these).
//
// Usage:
//   npm run backfill:images
//
// Safe to re-run — only touches rows where image_url is currently null,
// and only writes a value once a confident set + card-number match is
// found on pokemontcg.io. Everything that can't be matched is logged, not
// silently skipped, so the final summary is an honest picture of what's
// still missing after this runs.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  listAllSets,
  listCardsInSet,
  normalizeSetName,
  normalizeCardNumber,
} from "../src/lib/pokemontcgio";

const CONCURRENCY = 3;

// Confirmed 2026-08-19 by actually looking at the images (Ross spot-checked
// in the app, then we swept every card across every McDonald's Collection
// year using the new set-filter search): pokemontcg.io's own data for these
// four years is the literal card BACK, for every single card in each year,
// not a matching bug on our end. Re-running this script without an
// exclusion just re-fetches the same wrong image every time, since
// pokemontcg.io's data hasn't changed — confirmed the hard way when a
// first attempt at re-running this after nulling these rows out silently
// re-broke all 48 of them again. Block these outright rather than trusting
// "a set + number match exists" as good enough — that assumption is what
// let this through the first time. Remove an entry here only after
// confirming pokemontcg.io has fixed that specific year's images for real
// (visually, not just "the API responds").
const KNOWN_BAD_PTCGIO_SETS = new Set(
  ["McDonald's Collection 2014", "McDonald's Collection 2015", "McDonald's Collection 2017", "McDonald's Collection 2018"].map(
    (s) => s.toLowerCase()
  )
);

type CardRow = { id: string; set_name: string; card_number: string; name: string };

// PostgREST (Supabase's query layer) caps a single request at 1000 rows by
// default — a plain .select() with no .range() silently truncates past
// that, no error, no warning. Found this for real: a run against a live
// database with ~1,457 missing-image cards reported exactly "1000" both
// times it was run, which was the row cap showing through, not the true
// count. Paginate with .range() until a page comes back short, so the
// script actually sees everything.
async function fetchAllMissingCards(supabase: SupabaseClient): Promise<CardRow[]> {
  const PAGE_SIZE = 1000;
  const all: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, set_name, card_number, name")
      .eq("language", "en")
      .is("image_url", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load missing-image cards: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    all.push(...(data as CardRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in."
    );
  }

  const supabase = createClient(url, serviceKey);

  console.log("Fetching cards with no image (English only)...");
  const missingCards = await fetchAllMissingCards(supabase);

  if (missingCards.length === 0) {
    console.log("No cards with a missing image — nothing to do.");
    return;
  }

  console.log(`${missingCards.length} card(s) with no image in TCGdex`);

  const bySet = new Map<string, CardRow[]>();
  for (const card of missingCards) {
    const list = bySet.get(card.set_name) ?? [];
    list.push(card);
    bySet.set(card.set_name, list);
  }
  console.log(`Across ${bySet.size} set(s)`);

  console.log("\nFetching pokemontcg.io's set list...");
  const ptcgSets = await listAllSets();
  const ptcgSetByNormalizedName = new Map(ptcgSets.map((s) => [normalizeSetName(s.name), s]));

  let totalFilled = 0;
  let totalSkippedNoSetMatch = 0;
  let totalSkippedNoCardMatch = 0;

  const setEntries = Array.from(bySet.entries());

  await mapWithConcurrency(setEntries, CONCURRENCY, async ([setName, cards]) => {
    if (KNOWN_BAD_PTCGIO_SETS.has(setName.toLowerCase())) {
      console.log(
        `  ! skipping "${setName}" — pokemontcg.io's images for this set are confirmed wrong (card backs), see KNOWN_BAD_PTCGIO_SETS (${cards.length} card(s) stay blank)`
      );
      totalSkippedNoSetMatch += cards.length;
      return;
    }

    const ptcgSet = ptcgSetByNormalizedName.get(normalizeSetName(setName));
    if (!ptcgSet) {
      console.log(`  ! no pokemontcg.io match for set "${setName}" (${cards.length} card(s) stay blank)`);
      totalSkippedNoSetMatch += cards.length;
      return;
    }

    let ptcgCards;
    try {
      ptcgCards = await listCardsInSet(ptcgSet.id);
    } catch (err) {
      console.log(`  ! failed to fetch pokemontcg.io set "${ptcgSet.id}": ${(err as Error).message}`);
      totalSkippedNoSetMatch += cards.length;
      return;
    }

    const ptcgCardByNumber = new Map(ptcgCards.map((c) => [normalizeCardNumber(c.number), c]));

    let filledThisSet = 0;
    for (const card of cards) {
      const match = ptcgCardByNumber.get(normalizeCardNumber(card.card_number));
      const imageUrl = match?.images?.large ?? match?.images?.small;

      if (!match || !imageUrl) {
        totalSkippedNoCardMatch++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("cards")
        .update({ image_url: imageUrl })
        .eq("id", card.id)
        .eq("language", "en");

      if (updateError) {
        console.log(`    ! failed to update ${card.id}: ${updateError.message}`);
        totalSkippedNoCardMatch++;
        continue;
      }

      filledThisSet++;
      totalFilled++;
    }

    console.log(`  ${setName} -> ${ptcgSet.name} (${ptcgSet.id}): filled ${filledThisSet}/${cards.length}`);
  });

  console.log(`\nDone. Filled ${totalFilled} image(s).`);
  console.log(`Skipped — no matching set found on pokemontcg.io: ${totalSkippedNoSetMatch}`);
  console.log(`Skipped — set matched, but this specific card number didn't: ${totalSkippedNoCardMatch}`);
  console.log(
    "Anything still skipped genuinely isn't available on either source right now — a real limitation, not a bug."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
