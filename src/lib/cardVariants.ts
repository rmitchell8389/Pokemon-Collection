// Loads a pre-built lookup of real print-variant data per card — normal,
// holo, reverse holo, 1st edition, and a long tail of vintage-specific
// categories (shadowless, unlimited, individual tournament stamps, etc.) —
// sourced from TCGdex's own open-source data repository
// (github.com/tcgdex/cards-database), NOT the live TCGdex API.
//
// Why not the live API: TCGdex's own docs (tcgdex.dev/reference/set,
// checked 2026-08-21) confirm the `variants` field only exists on the
// per-card DETAIL endpoint — cards nested inside a full Set response are
// "CardBrief" objects (id/image/localId/name only, no variants). Getting
// this data live would mean one request per card across every set in every
// language this app tracks — tens of thousands of rate-limited requests.
// The cards-database repo is what TCGdex's own API is generated FROM, so
// cloning it directly (git clone --depth 1
// https://github.com/tcgdex/cards-database.git) gets the same data with no
// rate limit and no per-card request at all. Same pattern already used for
// zh-tw images (see tcimageindex.ts and the type-null/PTCG-database repo).
//
// data/card-variants-index.json structure:
//   { [language]: { "<set_id>_<card_number>": string[] } }
// where each string is a variant KEY built by the extraction script, e.g.
// "normal", "holo", "reverse", "unlimited", "lenticular", "metal",
// "firstEdition", or (for vintage cards with stamps/subtypes) a compound
// key like "holo-1st-shadowless" or "holo-25th-celebration". A card with
// two literal same-type variant entries the source data doesn't otherwise
// distinguish gets a "-dup1"/"-dup2" suffix so index keys stay unique —
// see labelVariant below for why that suffix is stripped before display.
//
// Card-number key format is NOT consistently zero-padded between the
// source repo's own file naming and TCGdex's live-synced `card_number`
// field per language. Confirmed during the earlier zh-tw image-backlog
// work (tcimageindex.ts) that TCGdex's own field is sometimes unpadded
// ("56") even where a scrape/source file is zero-padded ("056") for the
// exact same card — so lookupVariants tries the raw number, a zero-padded
// (3-digit) form, and a zero-stripped form in turn, same
// "try-candidates-first-hit-wins" approach as tcimageindex.ts and
// limitlesstcg.ts use for the equivalent image-URL problem.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type CardVariantLanguage = "en" | "ja" | "zh-tw" | "zh-cn";

type VariantIndex = Record<CardVariantLanguage, Record<string, string[]>>;

let cachedIndex: VariantIndex | null = null;

function loadIndex(): VariantIndex {
  if (cachedIndex) return cachedIndex;
  const path = join(process.cwd(), "data", "card-variants-index.json");
  const raw = readFileSync(path, "utf-8");
  cachedIndex = JSON.parse(raw) as VariantIndex;
  return cachedIndex;
}

// Only touches plain all-digit numbers — anything with a letter prefix/
// suffix (TG03, split numbering, promo codes) is left alone rather than
// guessed at, same rule tcimageindex.ts / limitlesstcg.ts use.
//
// Exported (2026-08-21) so scripts/dexImport.ts can reuse the exact same
// tolerant candidate-list approach when matching a Dex CSV row's card
// number against our own card_number field, instead of re-implementing it.
export function zeroPadCardNumber(cardNumber: string, width = 3): string | null {
  if (!/^\d+$/.test(cardNumber)) return null;
  if (cardNumber.length >= width) return null;
  const padded = cardNumber.padStart(width, "0");
  return padded === cardNumber ? null : padded;
}

export function stripLeadingZeros(cardNumber: string): string | null {
  if (!/^\d+$/.test(cardNumber)) return null;
  const stripped = String(Number(cardNumber));
  return stripped === cardNumber ? null : stripped;
}

// Returns the list of real variant keys for a card, or null if this exact
// card isn't in the index (expected — the source repo doesn't have 100%
// overlap with every set this app has synced from the live TCGdex API;
// see scripts/import-card-variants.ts's summary output for real coverage
// numbers per language).
export function lookupVariants(
  language: CardVariantLanguage,
  setId: string,
  cardNumber: string
): string[] | null {
  const index = loadIndex()[language];
  if (!index) return null;

  const candidates = [cardNumber, zeroPadCardNumber(cardNumber), stripLeadingZeros(cardNumber)].filter(
    (n): n is string => n !== null
  );

  for (const number of candidates) {
    const hit = index[`${setId}_${number}`];
    if (hit) return hit;
  }
  return null;
}

// Which variant an EXISTING card row (added before variant tracking
// existed) keeps representing, so that row's id and `variant` column
// (left null) never has to change — see the `variant` column comment in
// supabase/schema.sql for the full migration-safety reasoning.
//
// UPDATE 2026-08-21, caught by Ross pasting a real dry-run sample before
// committing: the original version of this function only ever matched a
// variant key EXACTLY against PRIMARY_PRIORITY (e.g. the bare string
// "holo"). That works for modern cards, but pre-2003 vintage sets (Base
// Set and friends, before reverse holo existed) NEVER have a bare "holo"
// key at all — every holo card's variants are always qualified with a
// print-run stamp ("holo-unlimited", "holo-1st-shadowless",
// "holo-shadowless", sometimes also "holo-1999-2000-copyright"). For those
// cards the exact-match loop below always missed and silently fell back to
// `[...variantKeys].sort()[0]` — plain alphabetical order, which is
// arbitrary and picked "holo-1999-2000-copyright" (not a card's regular/
// default print by any normal definition) as the primary for real cards
// like base1-1 Alakazam. Confirmed via a real dry run
// (`--lang=en --set=base1`) before this ever reached --commit. Affects 195
// multi-variant English cards (checked: 0 in ja/zh-tw/zh-cn) — all
// pre-reverse-holo vintage, i.e. exactly the cards most likely to already
// be in someone's collection.
//
// Fixed by picking the TYPE first (via TYPE_PRIORITY, matching on the
// leading segment of the key, e.g. "holo-unlimited"'s type is "holo"), then
// within that type preferring the bare type itself, then a plain
// "<type>-unlimited" key (the closest thing to "the regular version" for a
// vintage card whose prints are always print-run-qualified — "Unlimited"
// is the common, low-value default a collector means when they don't say
// otherwise, unlike "1st Edition" or "Shadowless" which are specifically
// sought-out short prints), then whichever remaining candidate has the
// fewest extra qualifier segments (closest to the bare type), with
// alphabetical order only as a final, deterministic tiebreak — never the
// first thing tried.
const TYPE_PRIORITY = [
  "normal",
  "holo",
  "reverse",
  "unlimited",
  "lenticular",
  "metal",
  "firstEdition",
  "jumbo",
  "preRelease",
  "wPromo",
];

export function pickPrimaryVariant(variantKeys: string[]): string {
  const presentTypes = new Set(variantKeys.map((k) => k.split("-")[0]));

  let chosenType: string | null = null;
  for (const t of TYPE_PRIORITY) {
    if (presentTypes.has(t)) {
      chosenType = t;
      break;
    }
  }
  // Every real variant key from the extraction script starts with a known
  // type (see TYPE_LABELS below) — this fallback only guards against a
  // genuinely unrecognized type never seen in a real run.
  if (chosenType === null) {
    return [...variantKeys].sort()[0];
  }

  const candidates = variantKeys.filter((k) => k.split("-")[0] === chosenType);

  if (candidates.includes(chosenType)) return chosenType;

  const unlimitedKey = `${chosenType}-unlimited`;
  if (candidates.includes(unlimitedKey)) return unlimitedKey;

  const sorted = [...candidates].sort((a, b) => {
    const segCountA = a.split("-").length;
    const segCountB = b.split("-").length;
    if (segCountA !== segCountB) return segCountA - segCountB;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted[0];
}

// Base variant "type" values TCGdex's own source data uses (confirmed via
// interfaces.d.ts and a real extraction run: normal/holo/reverse dominate,
// lenticular and metal are rare-but-real, firstEdition/jumbo/preRelease/
// wPromo only ever show up via the older boolean-object variant form).
const TYPE_LABELS: Record<string, string> = {
  normal: "Normal",
  holo: "Holo",
  reverse: "Reverse Holo",
  unlimited: "Unlimited",
  lenticular: "Lenticular",
  metal: "Metal",
  firstEdition: "1st Edition",
  jumbo: "Jumbo",
  preRelease: "Pre-Release",
  wPromo: "Promo",
};

// Stamp/subtype suffix segments seen in real vintage data during the
// 2026-08-21 extraction run (Base Set "shadowless"/"1st-edition", e-Reader-
// era "no-e-reader", 25th Anniversary tournament stamps, etc.) — not
// exhaustive, since vintage sets have a long tail of one-off combinations,
// but covers what actually turned up. Anything not listed here falls back
// to a plain title-cased word so a row never ends up with a blank or raw
// snake-case label.
const SEGMENT_LABELS: Record<string, string> = {
  "1st": "1st Edition",
  unlimited: "Unlimited",
  shadowless: "Shadowless",
  "1999-2000-copyright": "1999-2000 Copyright",
  "set-logo": "Set Logo Stamp",
  "set-logo-staff": "Staff Stamp",
  "no-rarity": "No Rarity Symbol",
  "no-e-reader": "No e-Reader Code",
  "25th-celebration": "25th Celebration Stamp",
  "pre-release": "Pre-Release Stamp",
  "pre-release-staff": "Pre-Release Staff Stamp",
  "player-rewards-program": "Player Rewards Program Stamp",
  "professor-program": "Professor Program Stamp",
  "pokemon-center": "Pokémon Center Stamp",
  "jason-klaczynski": "Jason Klaczynski Stamp",
  "michael-pramawat": "Michael Pramawat Stamp",
  "david-cohen": "David Cohen Stamp",
  "missing-expansion-symbol": "Missing Expansion Symbol",
};

function titleCaseWord(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);
}

// Human-readable label for a variant key, e.g. "reverse" -> "Reverse Holo",
// "holo-1st-shadowless" -> "Holo, 1st Edition, Shadowless". Used to build
// the display-name suffix for the extra rows scripts/import-card-variants.ts
// creates for non-primary variants (e.g. "Pikachu" -> "Pikachu (Reverse
// Holo)").
//
// The stamp tail is a long, not-fully-catalogued tail on vintage/promo
// cards — real examples found in the 2026-08-21 extraction include
// individual World Championships player names ("ross-cawthorn",
// "igor-costa", "zachary-bokhari", dozens more) that aren't worth hard-
// coding one by one. Anything not in SEGMENT_LABELS falls back to the raw
// hyphenated words, space-joined and title-cased (e.g. "ross-cawthorn" ->
// "Ross Cawthorn"), which reads fine even though it isn't specifically
// labeled "Stamp".
//
// UPDATE 2026-08-21: a real dry run against zh-cn's SV8a surfaced two rows
// that would have gotten the EXACT SAME label — "含羞苞 (Reverse Holo)"
// twice for one card — because the source repo's own data has two literal
// "reverse" variant entries for that card it doesn't otherwise distinguish
// (see the "-dupN" disambiguator this function used to just silently
// strip). Checked the scope across the whole index: 1,843 cards / 2,202
// rows total hit this across all four languages — real enough to be worth
// a label change, not an edge case. Rather than leave two indistinguishable
// have/don't-have entries in the UI (which would read as a software bug,
// not a genuine "the source data can't tell these apart either" gap), a
// "-dupN" key now gets " (Print N+1)" appended — e.g. "reverse-dup1" ->
// "Reverse Holo (Print 2)" — so it's visibly a second, otherwise-identical
// print rather than a mystery duplicate.
export function labelVariant(variantKey: string): string {
  const dupMatch = variantKey.match(/-dup(\d+)$/);
  const base = variantKey.replace(/-dup\d+$/, "");

  const segments = base.split("-");
  const labeled: string[] = [];

  // The first segment is always the variant "type" (normal/holo/reverse/
  // etc.) — everything after it is stamps/subtype, appended by the
  // extraction script's own key_parts.join("-").
  const [type, ...rest] = segments;
  labeled.push(TYPE_LABELS[type] ?? titleCaseWord(type));

  // Stamp/subtype segments can themselves contain hyphens (e.g.
  // "25th-celebration" is one stamp, not two words), so try progressively
  // shorter joins of the remaining segments against SEGMENT_LABELS before
  // falling back to a plain word. Consecutive unmatched words are batched
  // into one space-joined phrase rather than one comma entry per word, so
  // an unrecognized name like "ross-cawthorn" reads as "Ross Cawthorn",
  // not "Ross, Cawthorn".
  let i = 0;
  let unmatchedBuffer: string[] = [];
  const flushBuffer = () => {
    if (unmatchedBuffer.length > 0) {
      labeled.push(unmatchedBuffer.map(titleCaseWord).join(" "));
      unmatchedBuffer = [];
    }
  };
  while (i < rest.length) {
    let matched = false;
    for (let len = rest.length - i; len >= 1; len--) {
      const candidate = rest.slice(i, i + len).join("-");
      if (SEGMENT_LABELS[candidate]) {
        flushBuffer();
        labeled.push(SEGMENT_LABELS[candidate]);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      unmatchedBuffer.push(rest[i]);
      i += 1;
    }
  }
  flushBuffer();

  const label = labeled.join(", ");
  if (dupMatch) {
    // dup1 is the SECOND occurrence of an otherwise-identical variant (the
    // first has no suffix at all), so the print number is dupN's N + 1.
    const printNumber = Number(dupMatch[1]) + 1;
    return `${label} (Print ${printNumber})`;
  }
  return label;
}
