// Loads a pre-built lookup of Traditional Chinese card images: "SET_NUMBER"
// (both uppercased/trimmed) -> a real image URL on the official Pokémon
// Asia (Taiwan) site. Used as a fallback image source for zh-tw cards
// TCGdex has no image for — the Traditional Chinese counterpart to
// limitlesstcg.ts (Japanese modern) and pcgsearch.ts (Japanese vintage).
//
// Where this data came from (2026-08-20, real check, not guessed):
// `data/tc-image-index.json` in this repo was built by cloning the
// actively-maintained open-source project github.com/type-null/PTCG-database
// (12,079 individually-scraped card JSON files under `data_tc/`, sourced
// from https://asia.pokemon-card.com/tw/card-search/ — the OFFICIAL regional
// Pokémon card database, not a fan site) and reducing each file to just its
// `set_name` + `number` + `img` fields. That repo does NOT cover Simplified
// Chinese (zh-cn) at all — its own README says so explicitly, and mainland
// China has a separate official distributor/site. zh-cn needs its own
// source, not this one.
//
// Spot-checked: `set_name` matched TCGdex's own `set_id` exactly for every
// sampled set (e.g. "SV8", "SPZ") except case (a few, like "SC1B" vs
// TCGdex's "SC1b") and one set with cards split across "SV2a" and "SV2a F"
// folders (secret-rare / alt-art cards, apparently) — both handled by the
// normalization in buildTcImageIndexKey below.
//
// UPDATE 2026-08-20, after a real run (812/1165 filled): a diagnostic query
// against the still-missing SV-P cards found TCGdex's `card_number` is NOT
// always zero-padded the way the Japanese sources were — e.g. TCGdex gives
// "56" for a card the scrape files as "056.json" (confirmed the same card
// by name: "摩托蜥" on both sides). So `number` sometimes needs zero-padding
// to 3 digits before it matches. lookupTcImageUrl now tries the raw number
// first, then a zero-padded (3-digit) form — same "try candidates in order,
// first real hit wins" approach limitlesstcg.ts uses for the opposite
// direction (stripping zeros instead of adding them).
//
// Also found in that same diagnostic run and deliberately left unresolved
// rather than guessed at: SV-P's basic-energy cards ("DAR"/"FIG"/"FIR"/
// "GRA"/"LIG"/"MET"/"PSY"/"WAT") and trophy/stadium promos ("no0"-"no3",
// TCGdex's own numbering for those) aren't cleanly resolvable from this
// scrape. The energy cards aren't scraped under SV-P's own folder at all —
// a folder that looks like a match (containing the same DAR/FIG/etc names)
// is actually a *different*, mislabeled set upstream (its `set_full_name`
// doesn't match SV-P's), a scraper artifact in the source repo, not a real
// hit. The trophy/stadium cards for SV-P *are* present, but filed under a
// broken `set_name` ("-1"), and each trophy name has several duplicate
// entries with different image URLs (different tournament-year reprints,
// presumably) — picking one would be guessing which year's card this is,
// not a real match, so these stay unfilled rather than risk a wrong image.
//
// One real data-quality wrinkle, checked rather than ignored: 437 of the
// 12,079 scraped entries share a normalized key with a DIFFERENT image
// (collector-number reuse across variant printings). 354 of those 437 are
// in a generically-named "EXpansion" folder and ~170 more in "SVI" — neither
// of those set names appears among TCGdex's zh-tw set ids at all, so they
// never get looked up. The build script (see below) takes first-seen-wins
// for any real collision and doesn't attempt to be clever about picking the
// "right" one — this is why the real HTTP check in the backfill script
// still matters, it just doesn't fully rule out an occasional
// wrong-but-real card image slipping through for a genuinely ambiguous
// case. Not verified image-by-image; flag it to Ross if a filled zh-tw
// image looks visually wrong so this can be tightened.
//
// To regenerate this file if the upstream repo updates: clone
// github.com/type-null/PTCG-database, walk every data_tc/**/*.json, and for
// each with a set_name/number/img, write index[buildTcImageIndexKey(set_name, number)] = img
// (first-seen-wins on collision), then JSON.stringify the result.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedIndex: Record<string, string> | null = null;

function loadIndex(): Record<string, string> {
  if (cachedIndex) return cachedIndex;
  const path = join(process.cwd(), "data", "tc-image-index.json");
  const raw = readFileSync(path, "utf-8");
  cachedIndex = JSON.parse(raw) as Record<string, string>;
  return cachedIndex;
}

export function buildTcImageIndexKey(setName: string, cardNumber: string): string {
  let normSet = setName.trim();
  if (/\sF$/i.test(normSet)) {
    normSet = normSet.replace(/\sF$/i, "").trim();
  }
  return `${normSet.toUpperCase()}_${cardNumber.trim()}`;
}

// Only re-pads plain all-digit numbers ("56" -> "056") — anything with a
// non-digit character (the "DAR"/"no1"/etc special cases noted above) is
// left alone rather than guessed at, since padding a non-numeric code
// wouldn't mean anything.
function zeroPadCardNumber(cardNumber: string, width = 3): string | null {
  if (!/^\d+$/.test(cardNumber)) return null;
  if (cardNumber.length >= width) return null;
  const padded = cardNumber.padStart(width, "0");
  return padded === cardNumber ? null : padded;
}

export function lookupTcImageUrl(setId: string, cardNumber: string): string | null {
  const index = loadIndex();

  const raw = index[buildTcImageIndexKey(setId, cardNumber)];
  if (raw) return raw;

  const padded = zeroPadCardNumber(cardNumber);
  if (padded) {
    const paddedHit = index[buildTcImageIndexKey(setId, padded)];
    if (paddedHit) return paddedHit;
  }

  return null;
}

export async function tcImageExists(url: string): Promise<boolean> {
  // Real check before trusting anything from the index — the scrape could
  // be stale, or (rarely) a wrong image from the collision cases noted
  // above. A realistic browser User-Agent is included because TCGdex's own
  // API needed the same treatment to avoid a bare 403 from bot detection
  // (see src/lib/tcgdex.ts) — untested against this specific site from this
  // environment (asia.pokemon-card.com isn't reachable from this sandbox's
  // network allowlist), so this is a reasonable precaution, not a confirmed
  // requirement.
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  try {
    const res = await fetch(url, { method: "HEAD", headers });
    return res.ok;
  } catch {
    try {
      const res = await fetch(url, { method: "GET", headers });
      return res.ok;
    } catch {
      return false;
    }
  }
}
