// Thin helper for building/checking Japanese card image URLs on pcg-search.com
// — a fallback image source specifically for the pre-2011 vintage Japanese
// sets that limitlesstcg.com doesn't carry (see src/lib/limitlesstcg.ts for
// that source, which covers the modern sets instead). Found via TCG
// Collector's own public "Card image sources" page, which lists pcg-search
// as one of the sites they use for Japan-region card images.
//
// How the URL scheme was found and verified (2026-08-19, real checks against
// live pages, not guessed from memory):
//   - pcg-search.com's own set-list page groups sets into named families
//     ("PMCG", "neo", "VS", "WEB", "e", "ADV", "PCG") that closely mirror
//     TCGdex's own set_id prefixes for the same eras.
//   - Checked several real card pages directly and confirmed both the page
//     URL and image URL follow: /{folder}/{folder}{index}{cardNumber}.php
//     and /{folder}/{folder}{index}{cardNumber}.png, where `index` is the
//     set's ordinal within its family and `cardNumber` is zero-padded to 3
//     digits — e.g. neo1001.png for card "001" of TCGdex's "neo1"
//     ("金、銀、新世界へ...", confirmed matching set name), pcg1001.png for
//     card "001" of "PCG1" ("伝説の飛翔", confirmed matching), e1001.png for
//     "E1" ("基本拡張パック", confirmed matching).
//   - One family doesn't map by simple lowercasing: TCGdex's "PMCG" prefix
//     corresponds to pcg-search's "1st" folder, not "pmcg" — confirmed
//     directly (1st1001.png = Bulbasaur, TCGdex's PMCG1 "拡張パック";
//     1st3001.png = Arbok, TCGdex's PMCG3 "化石の秘密", both name matches).
//   - Unlike limitlesstcg.com's scheme, card_number here did NOT need any
//     zero-padding adjustment — pcg-search's 3-digit padded numbers matched
//     TCGdex's own card_number format directly in every case checked.
//   - UPDATE, round 2: a real run filled 1,930/2,235 (86%) on the first try
//     — every neo/E/PCG set hit 100%, but PMCG5/PMCG6 and VS1/web1 stayed at
//     0. Checked each directly rather than guess further:
//       - PMCG5 ("リーダーズスタジアム") and PMCG6 ("闇からの挑戦") are the
//         two "Gym" sub-series, filed under a DIFFERENT slug shape entirely:
//         "1stgym1<number>" / "1stgym2<number>" — NOT "1st5<number>" /
//         "1st6<number>" like the family's other 4 sets. Confirmed directly
//         (1stgym1062.png = Erika's Clefairy, PMCG5's real card 062/096;
//         1stgym2001.png = Erika's Ivysaur, PMCG6's real card 001).
//       - VS1 ("ポケモンカード★VS") and web1 ("ポケモンカード★web") are both
//         single non-numbered-series sets with NO set-index digit at all,
//         and — unlike every other family — the card number is zero-padded
//         to 4 digits, not 3 (e.g. "vs0043.png", "web0035.png", both
//         confirmed against real pages matching the DB's card numbers
//         043/141 and 035/048 respectively).
//     SET_ID_OVERRIDES below handles all four as exact, full overrides
//     rather than trying to generalize a rule from a sample of two oddball
//     sub-families — simpler and doesn't risk over-fitting to guesses about
//     sets that haven't been checked.
//
// Same safety philosophy as limitlesstcg.ts: never trust a constructed URL
// without a real HTTP check first.

const PCG_SEARCH_IMG_BASE = "https://pcg-search.com/img";

// TCGdex prefix -> pcg-search folder, for the one confirmed exception.
// Everything else defaults to the prefix lowercased (see buildFolder below).
const FAMILY_FOLDER_OVERRIDES: Record<string, string> = {
  PMCG: "1st",
};

// Full TCGdex set_id -> exact pcg-search slug-building rule, for sets that
// don't follow the generic "<folder><index><cardNumber, 3-digit>" shape at
// all. See the "round 2" comment above for how each was confirmed.
const SET_ID_OVERRIDES: Record<string, { folder: string; slugPrefix: string; padWidth: number }> = {
  PMCG5: { folder: "1st", slugPrefix: "1stgym1", padWidth: 3 },
  PMCG6: { folder: "1st", slugPrefix: "1stgym2", padWidth: 3 },
  VS1: { folder: "vs", slugPrefix: "vs", padWidth: 4 },
  web1: { folder: "web", slugPrefix: "web", padWidth: 4 },
};

// Splits a TCGdex vintage-era set id like "neo3" or "PCG12" into its letter
// prefix and numeric index. Returns null for ids that don't fit this shape
// (nothing in the vintage bucket didn't, but this is defensive rather than
// assumed) — callers should skip cards whose set doesn't parse rather than
// build a nonsensical URL.
export function parseVintageSetId(setId: string): { family: string; index: string } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(setId);
  if (!match) return null;
  return { family: match[1], index: match[2] };
}

function padCardNumber(cardNumber: string, width: number): string {
  // Only re-pads plain all-digit numbers — anything else (a letter-suffixed
  // card number, which hasn't turned up in the vintage bucket at all) is
  // passed through as-is rather than guessed at.
  if (!/^\d+$/.test(cardNumber)) return cardNumber;
  return cardNumber.padStart(width, "0");
}

export function buildPcgSearchJpImageUrl(setId: string, cardNumber: string): string | null {
  const override = SET_ID_OVERRIDES[setId];
  if (override) {
    const slug = `${override.slugPrefix}${padCardNumber(cardNumber, override.padWidth)}`;
    return `${PCG_SEARCH_IMG_BASE}/${override.folder}/${slug}.png`;
  }

  const parsed = parseVintageSetId(setId);
  if (!parsed) return null;

  const folder = FAMILY_FOLDER_OVERRIDES[parsed.family] ?? parsed.family.toLowerCase();
  const slug = `${folder}${parsed.index}${cardNumber}`;
  return `${PCG_SEARCH_IMG_BASE}/${folder}/${slug}.png`;
}

export async function pcgSearchImageExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    try {
      const res = await fetch(url, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }
}
