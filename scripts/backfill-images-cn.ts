// Backfills `cards.image_url` for Simplified Chinese (zh-cn) cards using
// the 52poke.com wiki as an image source — the zh-cn counterpart to
// scripts/backfill-images-tc.ts (Traditional Chinese). See
// src/lib/cnimages.ts for how the set-code mapping was found and verified,
// and why (unlike every other backfill script here) this one resolves
// image URLs live against the wiki's API rather than a pre-built index.
//
// Usage:
//   npm run backfill:images-cn
//
// Safe to re-run — only touches rows where image_url is currently null.
// Every candidate URL is checked with a real HTTP request before it's
// trusted; nothing is written on a guess. Sets with no confirmed wiki-code
// mapping are skipped entirely and reported clearly, not guessed at.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildWikiSetCode, buildCnImageFileTitle, resolveCnImageUrls, cnImageExists } from "../src/lib/cnimages";

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
      .eq("language", "zh-cn")
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

  console.log("Fetching Simplified Chinese cards with no image...");
  const missingCards = await fetchAllMissingCards(supabase);

  if (missingCards.length === 0) {
    console.log("No Simplified Chinese cards with a missing image — nothing to do.");
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

  // Build candidate File: titles for every card whose set maps to a known
  // wiki code. Sets with no mapping are tallied separately and skipped
  // entirely rather than guessed at.
  const cardToFileTitle = new Map<string, string>();
  const unmappedSetIds: string[] = [];
  let totalUnmappedCards = 0;

  for (const [setId, cards] of bySet.entries()) {
    if (!buildWikiSetCode(setId)) {
      unmappedSetIds.push(setId);
      totalUnmappedCards += cards.length;
      continue;
    }
    for (const card of cards) {
      const fileTitle = buildCnImageFileTitle(setId, card.card_number);
      if (fileTitle) cardToFileTitle.set(card.id, fileTitle);
    }
  }

  const allFileTitles = Array.from(new Set(cardToFileTitle.values()));
  console.log(`Resolving ${allFileTitles.length} candidate image(s) via the 52poke.com wiki API...`);
  const resolvedUrls = await resolveCnImageUrls(allFileTitles);
  console.log(`Wiki resolved ${resolvedUrls.size} of ${allFileTitles.length} candidate file(s) to a real URL.\n`);

  let totalFilled = 0;
  let totalNotFound = 0;
  let totalUpdateFailed = 0;

  for (const [setId, cards] of bySet.entries()) {
    if (!buildWikiSetCode(setId)) continue; // already tallied above

    let filledThisSet = 0;

    await mapWithConcurrency(cards, CONCURRENCY, async (card) => {
      const fileTitle = cardToFileTitle.get(card.id);
      const candidateUrl = fileTitle ? resolvedUrls.get(fileTitle) : undefined;

      if (!candidateUrl) {
        totalNotFound++;
        return;
      }

      const exists = await cnImageExists(candidateUrl);
      if (!exists) {
        totalNotFound++;
        return;
      }

      const { error: updateError } = await supabase
        .from("cards")
        .update({ image_url: candidateUrl })
        .eq("id", card.id)
        .eq("language", "zh-cn");

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

  if (unmappedSetIds.length > 0) {
    console.log(`\nUnmapped set(s), skipped entirely (no confirmed 52poke.com wiki code): ${unmappedSetIds.join(", ")}`);
    console.log(`  (${totalUnmappedCards} card(s) — genuinely not sourced yet, not a bug.)`);
  }

  console.log(`\nDone. Filled ${totalFilled} image(s).`);
  console.log(
    `Not found (no file on the wiki at the expected name, or a real HTTP check on the resolved URL failed): ${totalNotFound}`
  );
  if (totalUpdateFailed > 0) {
    console.log(`Database update failed for: ${totalUpdateFailed}`);
  }
  console.log(
    "If a mapped set filled far short of expectations, the card-number zero-padding assumption (3-digit) may be wrong for that specific set — see the comment in src/lib/cnimages.ts."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
