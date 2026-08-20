// Backfills `cards.image_url` for Traditional Chinese (zh-tw) cards using a
// pre-built lookup of official asia.pokemon-card.com (Taiwan) image URLs —
// the zh-tw counterpart to scripts/backfill-images-jp.ts (Limitless, modern
// Japanese) and scripts/backfill-images-jp-vintage.ts (pcg-search, vintage
// Japanese). See src/lib/tcimageindex.ts for how the lookup data was built
// and verified.
//
// Usage:
//   npm run backfill:images-tc
//
// Safe to re-run — only touches rows where image_url is currently null.
// Every candidate URL is checked with a real HTTP request before it's
// trusted; nothing is written on a guess. Cards with no entry in the index
// at all (never scraped by the upstream project) are skipped outright.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { lookupTcImageUrl, tcImageExists } from "../src/lib/tcimageindex";

const CONCURRENCY = 8;

type CardRow = { id: string; set_id: string; set_name: string; card_number: string };

// PostgREST caps a single request at 1000 rows — paginate with .range()
// until a page comes back short (see scripts/backfill-images.ts for the
// real run that first surfaced this).
async function fetchAllMissingCards(supabase: SupabaseClient): Promise<CardRow[]> {
  const PAGE_SIZE = 1000;
  const all: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, set_id, set_name, card_number")
      .eq("language", "zh-tw")
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

  console.log("Fetching Traditional Chinese cards with no image...");
  const missingCards = await fetchAllMissingCards(supabase);

  if (missingCards.length === 0) {
    console.log("No Traditional Chinese cards with a missing image — nothing to do.");
    return;
  }

  console.log(`${missingCards.length} card(s) with no image in TCGdex`);

  const bySet = new Map<string, CardRow[]>();
  for (const card of missingCards) {
    const list = bySet.get(card.set_id) ?? [];
    list.push(card);
    bySet.set(card.set_id, list);
  }
  console.log(`Across ${bySet.size} set(s)\n`);

  let totalFilled = 0;
  let totalNotInIndex = 0;
  let totalNotFound = 0;
  let totalUpdateFailed = 0;

  const setEntries = Array.from(bySet.entries());

  for (const [setId, cards] of setEntries) {
    let filledThisSet = 0;

    await mapWithConcurrency(cards, CONCURRENCY, async (card) => {
      const candidateUrl = lookupTcImageUrl(setId, card.card_number);

      if (!candidateUrl) {
        totalNotInIndex++;
        return;
      }

      const exists = await tcImageExists(candidateUrl);
      if (!exists) {
        totalNotFound++;
        return;
      }

      const { error: updateError } = await supabase
        .from("cards")
        .update({ image_url: candidateUrl })
        .eq("id", card.id)
        .eq("language", "zh-tw");

      if (updateError) {
        console.log(`    ! failed to update ${card.id}: ${updateError.message}`);
        totalUpdateFailed++;
        return;
      }

      filledThisSet++;
      totalFilled++;
    });

    const setName = cards[0]?.set_name ?? setId;
    console.log(`  ${setId} (${setName}): filled ${filledThisSet}/${cards.length}`);
  }

  console.log(`\nDone. Filled ${totalFilled} image(s).`);
  if (totalNotInIndex > 0) {
    console.log(`Not in the scraped index at all (set/number never scraped): ${totalNotInIndex}`);
  }
  if (totalNotFound > 0) {
    console.log(`In the index but the URL didn't resolve on a real HTTP check: ${totalNotFound}`);
  }
  if (totalUpdateFailed > 0) {
    console.log(`Database update failed for: ${totalUpdateFailed}`);
  }
  console.log(
    "Anything still missing after this genuinely isn't in the PTCG-database scrape either right now — a real gap, not a bug. Re-running later may pick up more if that project's scrape gets updated."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
