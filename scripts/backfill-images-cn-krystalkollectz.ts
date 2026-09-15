// Backfills `cards.image_url` for Simplified Chinese (zh-cn) cards by
// scraping card-list articles from krystalkollectz.com — a fan/reseller blog
// (Shopify-hosted) that publishes per-set card lists with real photos. This
// is the automated counterpart to scripts/backfill-images-cn-manual.ts,
// found after the two other candidate sources hit real walls: the
// 52poke.com wiki (scripts/backfill-images-cn.ts) genuinely doesn't have
// most of these cards uploaded, and TCG Collector has the images but is
// actively protected by a Cloudflare bot challenge (not something this
// project will build around). See the 2026-08-26 investigation notes in the
// project spec doc for the full trail, including how this source was
// confirmed to be plain, unprotected, server-rendered HTML — verified with
// a real `curl` from outside this environment, not just a WebFetch guess.
//
// Usage:
//   npm run backfill:images-cn-krystalkollectz
//
// How it works, per set:
//   1. Fetch the set's article page (URL from SET_URL_MAP below).
//   2. Pull every <img> tag pointing at Shopify's CDN out of the raw HTML.
//   3. Try to read a real card number off each image, from ONE of two
//      places — never guessed, never inferred from position on the page:
//        a) the image filename, when it follows either of the two numbered
//           conventions KrystalKollectz actually uses:
//             "001_135R_KRYSTALKOLLECTZ_CS1AC.png"   (number first)
//             "krystalkollectz.com_001_<uuid>.png"   (number after the
//                                                      site-name prefix)
//        b) the image's alt text, when it carries the site's own
//           "{Name} {Rarity} {number}/{total} {Set} Card List
//           Krystalkollectz" caption — used for cards whose filename is a
//           generic camera-roll name (IMG_1234.jpg) with no number in it.
//      If neither yields a number, or the two disagree with each other,
//      the image is skipped and logged — not guessed from where it sits on
//      the page. This means real coverage per set is partial (roughly a
//      third to a half of a set's cards on the one page checked so far,
//      CS1aC) — that's expected and fine; re-running scripts/
//      backfill-images-cn-manual.ts on whatever's left afterward, or
//      widening this script's regexes once real skip logs show a pattern
//      worth adding, are both reasonable next steps.
//   4. Match the number against this set's still-missing DB rows. Only an
//      exact, unambiguous (set_id, card_number) match gets written — same
//      policy as every other backfill script here.
//
// SET_URL_MAP only lists sets where the article URL is confirmed to encode
// the right set unambiguously (either the DB set_id literally appears in
// the URL slug, or — for CS1aC and CSM2aC — the article's own image
// filenames were checked directly and contain that exact set code). Sets
// like the Gem Pack volumes, the Collect 151 tiers, the small "gift box"
// products (Lillie's Support, Eevee GX Binder, etc.), and one ambiguous
// Storming Emergence article are deliberately left out for now — ROSS: if
// you want any of those included, tell me the exact DB set_id (from
// `npm run report:missing-images`'s "Across N set(s)" breakdown) for each
// and I'll add it. Adding an entry is just one more line in the map below.
//
// NOT covered by this source at all (no KrystalKollectz articles found for
// these as of 2026-08-26): the "*DC"/"*DaC" starter-deck sets (CS1DC,
// CS3DC, CSM1DC, CSM2DC, CS4DaC), the promo pools (SV-P, S-P), and the CBB
// Black Star Promo line (CBB1C-CBB6C). Those still need either the manual
// script or another source.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "card-images";
const REQUEST_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; DexMate personal backfill script)" };
const PAGE_DELAY_MS = 400; // be a polite, slow, single-threaded visitor to their article pages
const IMAGE_DELAY_MS = 150;

// set_id -> article URL. See the header comment above for what's excluded
// and why. Confirmed against the site's own sitemap.xml + the two
// directly-verified articles (CS1aC via a real curl test, CSM2aC via a
// direct HTML check of this session).
const SET_URL_MAP: Record<string, string> = {
  // Sword & Shield line
  CS1aC: "https://krystalkollectz.com/blogs/news/gigantamax-battle-set-a-cs1ac-pokemon-card-list-simplified-chinese",
  CS1bC: "https://krystalkollectz.com/blogs/news/gigantamax-battle-set-b-cs1bc-pokemon-card-list-simplified-chinese",
  "CS1.5C": "https://krystalkollectz.com/blogs/news/max-attack-defense-cs1-5c-pokemon-card-list-simplified-chinese",
  CS2aC: "https://krystalkollectz.com/blogs/news/vivid-portrayals-set-a-cs2ac-pokemon-card-list-simplified-chinese",
  CS2bC: "https://krystalkollectz.com/blogs/news/vivid-portrayals-set-b-cs2bc-pokemon-card-list-simplified-chinese",
  "CS2.5C": "https://krystalkollectz.com/blogs/cardlists/brilliant-counterattack-card-list-simplified-chinese",
  CS3aC: "https://krystalkollectz.com/blogs/cardlists/primordial-martial-arts-set-a-card-list",
  CS3bC: "https://krystalkollectz.com/blogs/cardlists/primordial-martial-arts-set-b-cs3bc-card-list-simplified-chinese",
  "CS3.5C":
    "https://krystalkollectz.com/blogs/cardlists/raging-flames-scorching-the-skies-card-list-cs3-5c-simplified-chinese",
  CS4aC: "https://krystalkollectz.com/blogs/cardlists/nine-colors-gathering-set-a-cs4ac-card-list-simplified-chinese",
  CS4bC: "https://krystalkollectz.com/blogs/cardlists/nine-colors-gathering-set-b-cs4bc-card-list-simplified-chinese",
  "CS4.5C": "https://krystalkollectz.com/blogs/cardlists/final-flame-dance-cs4-5c-card-list",
  CS5aC: "https://krystalkollectz.com/blogs/news/charming-stars-pokemon-card-list-simplified-chinese-krystalkollectz",
  CS5bC: "https://krystalkollectz.com/blogs/cardlists/brave-stars-set-b-pokemon-card-list-simplified-chinese-krystalkollectz",
  "CS5.5C": "https://krystalkollectz.com/blogs/cardlists/shadowofglorycardlist",
  CS6aC: "https://krystalkollectz.com/blogs/cardlists/dark-shadow-of-the-blue-sea-set-a-card-list",
  CS6bC: "https://krystalkollectz.com/blogs/cardlists/dark-shadow-of-the-blue-sea-set-b-card-list",
  "CS6.5C": "https://krystalkollectz.com/blogs/cardlists/victory-star-guide-card-list-simplified-chinese-krystalkollectz",

  // Sun & Moon line
  CSM1aC: "https://krystalkollectz.com/blogs/cardlists/storming-emergence-set-a-csm1ac-card-list-simplified-chinese",
  // CSM1bC deliberately omitted — the only candidate URL
  // ("stormingemergencecardlist") doesn't encode a set letter, so it's not
  // confirmed to be Set B specifically rather than a general hub page.
  CSM1cC: "https://krystalkollectz.com/blogs/cardlists/storming-emergence-set-c-csm1cc-card-list-simplified-chinese",
  "CSM1.5C": "https://krystalkollectz.com/blogs/cardlists/battle-elite-csm1-5c-card-list-simplified-chinese",
  CSM2aC: "https://krystalkollectz.com/blogs/cardlists/shining-together-set-a-card-list-simplified-chinese",
  CSM2bC: "https://krystalkollectz.com/blogs/cardlists/shining-together-set-b-card-list-simplified-chinese",
  CSM2cC: "https://krystalkollectz.com/blogs/cardlists/shining-together-set-c-card-list-simplified-chinese",
  "CSM2.5C": "https://krystalkollectz.com/blogs/cardlists/dazzling-victory-card-list-simplified-chinese",

  // Scarlet & Violet line
  CSV1C: "https://krystalkollectz.com/blogs/news/eternal-birth-pokemon-card-list-simplified-chinese",
  CSV2C: "https://krystalkollectz.com/blogs/news/miracle-journey-pokemon-card-list-simplified-chinese",
  CSV3C: "https://krystalkollectz.com/blogs/news/fearless-terastal-pokemon-card-list-simplified-chinese-krystalkollectz",
  CSV4C: "https://krystalkollectz.com/blogs/cardlists/reward-round-pokemon-card-list-simplified-chinese-krystalkollectz",
  CSV5C: "https://krystalkollectz.com/blogs/news/black-crystal-blazing-simplified-chinese-pokemon-card-list-krystalkollectz",
  CSV6C: "https://krystalkollectz.com/blogs/news/true-mystery-pokemon-csv6c-card-list-simplified-chinese",
  CSV7C: "https://krystalkollectz.com/blogs/news/sharp-blade-awakening-pokemon-card-list-csv7c",
  CSV8C: "https://krystalkollectz.com/blogs/news/brilliant-illusions-pokemon-card-list-csv8c",
  CSV9C: "https://krystalkollectz.com/blogs/news/stellar-crystal-pokemon-card-list-csv9c-simplified-chinese",
  "CSV9.5C": "https://krystalkollectz.com/blogs/news/terastal-gathering-pokemon-card-list-simplified-chinese",
  CSV10C: "https://krystalkollectz.com/blogs/news/chasing-glory-pokemon-card-list-simplified-chinese",
};

type CardRow = { id: string; set_id: string; card_number: string; name: string };
type ExtractedImage = { src: string; alt: string; cardNumber: string | null };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same normalization every other backfill script here uses — strips
// leading zeros, keeps any letter prefix/suffix.
function normalizeCardNumber(number: string): string {
  const match = number.match(/^([a-zA-Z]*)0*(\d+)([a-zA-Z]*)$/);
  if (!match) return number.toUpperCase().trim();
  const [, prefix, digits, suffix] = match;
  return `${prefix.toUpperCase()}${digits}${suffix.toUpperCase()}`;
}

function guessContentType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

// Reads a card number off one image, from its filename OR its alt text —
// never from page position. Returns null (skip) on no match or a
// filename/alt disagreement.
function extractCardNumber(src: string, alt: string): string | null {
  let filename = "";
  try {
    filename = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "");
  } catch {
    filename = src.split("/").pop() ?? "";
  }

  let fromFilename: string | null = null;
  const leadingNumber = filename.match(/^0*(\d{1,4})_/);
  const krystalPrefixed = filename.match(/krystalkollectz\.?(?:com)?_0*(\d{1,4})_/i);
  // A third real convention, confirmed 2026-08-27 against the actual live
  // CSV1C page (not just the two patterns this file's header comment
  // originally documented): "KRYSTALKOLLECTZ_<SETCODE>_<NUM>_<TOTAL>.png",
  // e.g. "KRYSTALKOLLECTZ_CSV1C_008_127.png". Neither of the two patterns
  // above matches this — leadingNumber requires digits at the very start
  // of the filename, and krystalPrefixed requires a number immediately
  // after "krystalkollectz_", but here the set code sits in between. This
  // is very likely why the first real run of this script filled 0 cards
  // despite parsing thousands of numbers total: most base-set images on
  // these pages use exactly this filename shape with NO alt text at all,
  // so neither existing pattern nor the alt-text fallback could reach them.
  const numBeforeTotal = filename.match(/_0*(\d{1,4})_\d{1,4}\.\w+$/);
  if (leadingNumber) fromFilename = leadingNumber[1];
  else if (krystalPrefixed) fromFilename = krystalPrefixed[1];
  else if (numBeforeTotal) fromFilename = numBeforeTotal[1];

  let fromAlt: string | null = null;
  const altMatch = alt.match(/(\d{1,4})\s*\/\s*\d{1,4}/);
  if (altMatch) fromAlt = altMatch[1];

  if (fromFilename && fromAlt) {
    return fromFilename === fromAlt ? fromFilename : null; // disagreement — skip, don't guess
  }
  return fromFilename ?? fromAlt;
}

// Pulls every Shopify-CDN <img> tag's src + alt out of raw article HTML.
// Regex-based rather than a full HTML parse — this project has no HTML
// parsing dependency yet, and Shopify's article template is consistent
// enough that a careful regex is reliable here. If a future set's page
// turns out to use a structure this doesn't catch, that'll show up as an
// oddly-low "images found" count in the run's summary, which is the signal
// to come back and widen this.
function extractImages(html: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const imgTagRe = /<img\b[^>]*>/gi;
  const tags = html.match(imgTagRe) ?? [];

  for (const tag of tags) {
    const srcMatch =
      tag.match(/data-src="([^"]*cdn\.shopify\.com[^"]*)"/i) ?? tag.match(/\bsrc="([^"]*cdn\.shopify\.com[^"]*)"/i);
    if (!srcMatch) continue;

    let src = srcMatch[1];
    if (src.startsWith("//")) src = `https:${src}`;

    const altMatch = tag.match(/\balt="([^"]*)"/i);
    const alt = altMatch ? altMatch[1] : "";

    images.push({ src, alt, cardNumber: extractCardNumber(src, alt) });
  }

  return images;
}

async function fetchAllMissingCards(supabase: SupabaseClient, setIds: string[]): Promise<CardRow[]> {
  const PAGE_SIZE = 1000;
  const all: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, set_id, card_number, name")
      .eq("language", "zh-cn")
      .is("image_url", null)
      .in("set_id", setIds)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load missing-image cards: ${error.message}`);
    if (!data || data.length === 0) break;

    all.push(...(data as CardRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
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

  console.log(`Ensuring Supabase Storage bucket "${STORAGE_BUCKET}" exists...`);
  const { error: bucketError } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
  if (bucketError && !/already exists/i.test(bucketError.message)) {
    throw new Error(`Failed to create/verify storage bucket: ${bucketError.message}`);
  }

  const setIds = Object.keys(SET_URL_MAP);
  console.log(`\nFetching still-missing zh-cn cards for ${setIds.length} mapped set(s)...`);
  const missingCards = await fetchAllMissingCards(supabase, setIds);
  console.log(`${missingCards.length} card(s) still missing an image across those set(s)\n`);

  const cardsByKey = new Map<string, CardRow[]>();
  for (const card of missingCards) {
    const key = `${card.set_id}::${normalizeCardNumber(card.card_number)}`;
    cardsByKey.set(key, [...(cardsByKey.get(key) ?? []), card]);
  }

  let totalUploaded = 0;
  let totalSkippedNoNumber = 0;
  let totalSkippedNoDbMatch = 0;
  let totalSkippedAmbiguous = 0;
  let totalSkippedError = 0;
  let totalSkippedDuplicateThisRun = 0;

  // Some article pages show the same card more than once (a checklist grid
  // plus a separate detail/showcase section further down, or a normal-print
  // + reverse-holo thumbnail pair) — each occurrence independently parses to
  // the same (set_id, card_number) key. Without this, every one of those
  // would re-download and re-upload the same card, each "counting" as a
  // fill even though only the first one changed anything. Track keys
  // already filled this run and skip the rest before touching the network.
  const filledThisRun = new Set<string>();

  for (const [setId, articleUrl] of Object.entries(SET_URL_MAP)) {
    console.log(`\n=== ${setId} — ${articleUrl} ===`);

    let html: string;
    try {
      const res = await fetch(articleUrl, { headers: REQUEST_HEADERS });
      if (!res.ok) {
        console.log(`  ! failed to fetch page: HTTP ${res.status}`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      console.log(`  ! failed to fetch page: ${(err as Error).message}`);
      continue;
    }

    const images = extractImages(html);
    const withNumbers = images.filter((img) => img.cardNumber !== null);
    console.log(`  ${images.length} card image(s) found on page, ${withNumbers.length} with a parseable number`);

    // Diagnostic sample, printed every run (cheap, and the first real run
    // of this script filled 0 cards despite parsing thousands of numbers
    // total — see the numBeforeTotal comment above). Shows the raw
    // (unnormalized) shape on both sides side by side so a format mismatch
    // is visible at a glance instead of requiring a fresh investigation
    // each time this needs re-checking.
    const missingForThisSet = missingCards.filter((c) => c.set_id === setId);
    if (withNumbers.length > 0) {
      console.log(
        `  sample extracted numbers (raw -> normalized): ${withNumbers
          .slice(0, 5)
          .map((img) => `"${img.cardNumber}"->"${normalizeCardNumber(img.cardNumber!)}"`)
          .join(", ")}`
      );
    }
    if (missingForThisSet.length > 0) {
      console.log(
        `  sample still-missing DB card_number (raw -> normalized): ${missingForThisSet
          .slice(0, 5)
          .map((c) => `"${c.card_number}"->"${normalizeCardNumber(c.card_number)}"`)
          .join(", ")}`
      );
    }

    for (const img of images) {
      if (!img.cardNumber) {
        totalSkippedNoNumber++;
        continue;
      }

      const cardNumber = normalizeCardNumber(img.cardNumber);
      const key = `${setId}::${cardNumber}`;

      if (filledThisRun.has(key)) {
        totalSkippedDuplicateThisRun++;
        continue;
      }

      const candidates = cardsByKey.get(key);

      if (!candidates || candidates.length === 0) {
        totalSkippedNoDbMatch++;
        continue;
      }
      if (candidates.length > 1) {
        console.log(`  ! ${setId} #${cardNumber}: ${candidates.length} DB rows match, ambiguous — skipped`);
        totalSkippedAmbiguous++;
        continue;
      }

      const card = candidates[0];

      try {
        const imageRes = await fetch(img.src, { headers: REQUEST_HEADERS });
        if (!imageRes.ok) {
          console.log(`  ! ${setId} #${cardNumber}: failed to download image (HTTP ${imageRes.status})`);
          totalSkippedError++;
          continue;
        }
        const fileBuffer = Buffer.from(await imageRes.arrayBuffer());
        const ext = guessContentType(img.src) === "image/png" ? "png" : guessContentType(img.src) === "image/webp" ? "webp" : "jpg";
        const storagePath = `zh-cn/krystalkollectz/${setId}/${cardNumber}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, fileBuffer, { contentType: guessContentType(img.src), upsert: true });

        if (uploadError) {
          console.log(`  ! ${setId} #${cardNumber}: failed to upload: ${uploadError.message}`);
          totalSkippedError++;
          continue;
        }

        const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

        const { error: updateError } = await supabase
          .from("cards")
          .update({ image_url: publicUrlData.publicUrl })
          .eq("id", card.id)
          .eq("language", "zh-cn");

        if (updateError) {
          console.log(`  ! ${setId} #${cardNumber}: failed to update DB row: ${updateError.message}`);
          totalSkippedError++;
          continue;
        }

        console.log(`  ${setId} #${cardNumber} (${card.name}): filled`);
        totalUploaded++;
        filledThisRun.add(key);
      } catch (err) {
        console.log(`  ! ${setId} #${cardNumber}: error: ${(err as Error).message}`);
        totalSkippedError++;
      }

      await sleep(IMAGE_DELAY_MS);
    }

    await sleep(PAGE_DELAY_MS);
  }

  console.log(`\nDone. Filled ${totalUploaded} distinct card(s).`);
  console.log(`Skipped — no parseable card number (filename/alt gave nothing usable, or the two disagreed): ${totalSkippedNoNumber}`);
  console.log(`Skipped — number parsed but no still-missing DB row matched: ${totalSkippedNoDbMatch}`);
  console.log(`Skipped — ambiguous (more than one DB row matched): ${totalSkippedAmbiguous}`);
  console.log(`Skipped — same card already filled earlier in this run (duplicate image on the page): ${totalSkippedDuplicateThisRun}`);
  console.log(`Skipped — download/upload/database error: ${totalSkippedError}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
