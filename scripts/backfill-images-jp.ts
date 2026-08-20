// Backfills `cards.image_url` for Japanese cards that TCGdex has no image
// for at all, using limitlesstcg.com's public card image CDN as a fallback
// source — the Japanese-language counterpart to scripts/backfill-images.ts
// (which does the same job for English via pokemontcg.io). See
// src/lib/limitlesstcg.ts for how the URL scheme was found and verified.
//
// Usage:
//   npm run backfill:images-jp
//
// Safe to re-run — only touches rows where image_url is currently null. For
// every candidate card, the exact image URL is checked with a real HTTP
// request before it's trusted (see limitlessImageExists) — nothing is
// written on a guess. Anything that comes back 404 is logged as skipped,
// not silently dropped, so the final summary is an honest picture of what
// Limitless genuinely doesn't have (expected: Japan's Neo/EX-era and
// original Base-era sets, which Limitless's own coverage doesn't reach —
// see the comment block in src/lib/limitlesstcg.ts for how that was
// confirmed).

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildLimitlessJpImageCandidates, limitlessImageExists } from "../src/lib/limitlesstcg";

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
      .eq("language", "ja")
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

  console.log("Fetching Japanese cards with no image...");
  const missingCards = await fetchAllMissingCards(supabase);

  if (missingCards.length === 0) {
    console.log("No Japanese cards with a missing image — nothing to do.");
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
  let totalNotFound = 0;
  let totalUpdateFailed = 0;

  const setEntries = Array.from(bySet.entries());

  for (const [setId, cards] of setEntries) {
    let filledThisSet = 0;

    await mapWithConcurrency(cards, CONCURRENCY, async (card) => {
      // TCGdex zero-pads card_number ("001") but Limitless's URLs use the
      // plain number ("1") — try the raw value first, then the
      // zero-stripped form, and use whichever a real request confirms.
      // Never writes a URL that wasn't actually checked.
      const candidates = buildLimitlessJpImageCandidates(setId, card.card_number, "LG");

      let matchedUrl: string | null = null;
      for (const candidateUrl of candidates) {
        if (await limitlessImageExists(candidateUrl)) {
          matchedUrl = candidateUrl;
          break;
        }
      }

      if (!matchedUrl) {
        totalNotFound++;
        return;
      }

      const { error: updateError } = await supabase
        .from("cards")
        .update({ image_url: matchedUrl })
        .eq("id", card.id)
        .eq("language", "ja");

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
  console.log(`Not found on Limitless (real 404, checked per-card): ${totalNotFound}`);
  if (totalUpdateFailed > 0) {
    console.log(`Database update failed for: ${totalUpdateFailed}`);
  }
  console.log(
    "Anything still missing after this genuinely isn't on Limitless right now — most likely Japan's pre-2011 sets, which Limitless's own catalog doesn't go back to."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
