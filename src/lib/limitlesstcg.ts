// Thin helper for building/checking Japanese card image URLs on Limitless
// TCG's (limitlesstcg.com) public asset CDN — used as a fallback image
// source for Japanese cards TCGdex has no image for at all, the same role
// pokemontcgio.ts plays for English.
//
// Why this exists: a real run of scripts/report-missing-images.ts against
// the live database found 4,862 of 8,159 Japanese cards (59.6%) with no
// TCGdex image, across 42 sets. Manually sourcing that many one at a time
// (the McDonald's-promo approach used for the much smaller English gap)
// doesn't scale here.
//
// How the URL scheme was found and verified (2026-08-19, real checks, not
// guessed from memory):
//   - Ross saved several pages of limitlesstcg.com's Japanese Standard-format
//     card search as HTML and uploaded them. The saved HTML's <img> tags
//     pointed at a local folder that wasn't included in the upload, so no
//     image bytes were recoverable from those files directly — but the
//     FILENAMES survived: "<SET>_<NUMBER>_<TOKEN>_JP_SM.png" per card, e.g.
//     "M4_75_R_JP_SM.png". Extracted all 4,488 filenames from the 5 uploaded
//     pages and checked the <TOKEN> position across every single one — it
//     was "R" 4,488/4,488 times, with real card rarities varying across
//     that set (commons, uncommons, rares, etc. all mixed together). So "R"
//     is a fixed part of the URL scheme, not the card's actual rarity —
//     confirmed empirically, not assumed.
//   - Fetching a real card page (limitlesstcg.com/cards/jp/M4/75) directly
//     confirmed the live CDN URL for the large image:
//     https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/M4/M4_75_R_JP_LG.png
//   - Cross-checked TCGdex's own `set_id` field (what scripts/sync-cards.ts
//     stores per card) against Limitless's set codes for several modern
//     sets — they match exactly (TCGdex's "M4", "M5", "SV11B", "SV11W",
//     "SM12a", "SM12" all correspond to the same-named sets on Limitless).
//     So no separate set-id mapping table is needed for sets from roughly
//     the Black & White era (2011) onward.
//   - Limitless's Japanese coverage does NOT go back further than that —
//     spot-checked several of TCGdex's vintage-era set ids (neo1, E1, PCG1,
//     PMCG1, VS1) directly against limitlesstcg.com/cards/jp/<id> and every
//     one 404'd. Those sets (mostly Neo/EX-era and original Base-era
//     Japanese prints, ~1,591 of the 4,862 missing cards) are a genuine gap
//     this source can't fill — same situation as the English McDonald's
//     Collection years being a dead end for pokemontcg.io.
//
// Because of that gap, this module deliberately does NOT assume every card
// has an image here — scripts/backfill-images-jp.ts checks each constructed
// URL with a real HTTP request before trusting it, per-card, rather than
// trusting a static "these sets are covered" list. That's slower but never
// silently wrong, and self-corrects if Limitless adds more historical sets
// later.
//
// UPDATE 2026-08-19: a real run filled only 1,583/4,862 — far short of what
// the "modern sets should just work" theory predicted. Root cause, confirmed
// by querying the database directly (scripts/debug-jp-card-numbers.ts):
// TCGdex zero-pads `card_number` to 3 digits ("001", "002", ... "156"), but
// Limitless's own URLs use the plain, unpadded number ("1", "2", ... "156").
// This is exactly why sets partially filled rather than all-or-nothing —
// any card numbered 100+ doesn't need padding stripped, so those matched by
// coincidence; 1-99 (rendered "001"-"099") didn't. buildLimitlessJpImageUrl
// now returns every distinct candidate form (raw, then leading-zeros
// stripped) instead of a single URL, in most-likely-first order — the
// caller tries each with a real HTTP check and stops at the first hit, so
// this still never writes an unverified guess.
//
// UPDATE 2026-08-19, round 2: after the padding fix, every modern set hit
// 100% except "M-P" (TCGdex's id for "Mega Promo Card"), which stayed at
// 0/103. Checked directly: limitlesstcg.com/cards/jp/M-P is a real 404, but
// the same set exists at .../cards/jp/MP (no hyphen) — "Mega Promotional
// Cards (MP)", CDN images confirmed live under .../tpc/MP/MP_<n>_R_JP_*.png.
// A genuine set-id spelling mismatch between the two sources, not a
// numbering issue. SET_ID_OVERRIDES exists for exactly this — add an entry
// here (TCGdex's set_id -> Limitless's set code) if another set turns up
// with the same kind of mismatch, rather than guessing at variations live.
const SET_ID_OVERRIDES: Record<string, string> = {
  "M-P": "MP",
};

const LIMITLESS_CDN_BASE = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc";

function stripLeadingZeros(cardNumber: string): string | null {
  // Only touches plain all-digit numbers ("001" -> "1") — anything with a
  // non-digit character (letter prefix/suffix, "TG03", "1/2" split numbering,
  // etc.) is left alone rather than guessed at, since TCGdex's padding
  // behavior for those irregular formats hasn't been confirmed against
  // Limitless at all.
  if (!/^\d+$/.test(cardNumber)) return null;
  const stripped = String(Number(cardNumber));
  return stripped === cardNumber ? null : stripped;
}

export function buildLimitlessJpImageCandidates(
  setId: string,
  cardNumber: string,
  size: "LG" | "SM" = "LG"
): string[] {
  const set = encodeURIComponent(SET_ID_OVERRIDES[setId] ?? setId);
  const candidateNumbers = [cardNumber, stripLeadingZeros(cardNumber)].filter(
    (n): n is string => n !== null
  );

  return candidateNumbers.map(
    (number) => `${LIMITLESS_CDN_BASE}/${set}/${set}_${encodeURIComponent(number)}_R_JP_${size}.png`
  );
}

// HEAD is enough to confirm the object exists without downloading it, and
// DigitalOcean Spaces (what this CDN runs on) supports HEAD on public
// objects. Falls back to a real GET only if HEAD itself errors (network
// issue, not a 404) — a 404 either way is a clean "doesn't exist", not an
// error to retry.
export async function limitlessImageExists(url: string): Promise<boolean> {
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
