// Turns TCGdex's raw `pricing` object (see src/lib/tcgdex.ts) into the
// single price this app actually stores and shows, per `cards` row.
//
// Why per ROW and not per card: `cards.variant` already means "the specific
// print this row represents" (see the long comment on that column in
// supabase/schema.sql) — a card with a normal print AND a reverse holo
// print is already two separate rows, added by
// scripts/import-card-variants.ts. TCGdex's pricing object has the same
// idea, just with its own set of variant buckets, so the job here is
// picking the right bucket for a given row's `variant` value, not picking
// a single "the" price for a card.
//
// ONLY TCGplayer is used to price a card right now — Cardmarket data is
// still fetched and stored (`cards.price_eur`) but is NOT trusted into
// `price_gbp` or `source`. See the "2026-08-25 pricing bug" note near
// pickCardPrice below for why: on real cards, TCGdex's `pricing.cardmarket`
// values turned out to be wrong by roughly 90x against Cardmarket's own
// live site, not just "thin market, a bit high" — and this integration's
// field-name assumptions for that object were never verified against a
// real live response to begin with (same standing gap as the rest of the
// TCGdex integration). A wrong price is worse than no price for something
// labeled "collection value", so Cardmarket is disabled as a price source
// until it can actually be verified.
import type { TcgdexCardPricing, TcgdexTcgplayerPriceVariant } from "./tcgdex";

type TcgplayerVariantKey = keyof Omit<
  NonNullable<TcgdexCardPricing["tcgplayer"]>,
  "updated" | "unit"
>;

// Every bucket TCGplayer's pricing object can have, in a fixed fallback
// order used by pickCardPrice below.
const TCGPLAYER_KEY_ORDER: TcgplayerVariantKey[] = [
  "normal",
  "holofoil",
  "reverse-holofoil",
  "1st-edition",
  "1st-edition-holofoil",
  "unlimited",
  "unlimited-holofoil",
];

// Best-effort mapping from a `cards.variant` value to the TCGplayer bucket
// that SHOULD hold this print's price. `cards.variant` is free text sourced
// from src/lib/cardVariants.ts, which — for vintage cards especially —
// produces long compound keys TCGdex's pricing object has no matching
// bucket for (e.g. "holo-1st-shadowless"). Rather than guess wrong, this
// only maps the handful of clean, common cases and falls back to treating
// anything else that still contains "holo" as a holofoil print (the
// closest real bucket) or "1st" as a 1st edition print — still a
// simplification for the vintage long tail, but a defensible one.
//
// This is only a STARTING GUESS, not the only bucket checked — see
// pickCardPrice, which falls through every other bucket too when this one
// is empty. That fallthrough is the actual fix for the 2026-08-25 bug
// below; this function alone was never enough, because `sync-cards.ts`
// only ever calls it with variant=null (see that script for why), and a
// huge share of real cards — anything EX/GX/V, secret rare, full art,
// promo-only — were NEVER printed as a plain "normal" card at all, so
// guessing "normal" and stopping there just came up empty for them.
export function mapVariantToTcgplayerKey(variant: string | null): TcgplayerVariantKey {
  if (!variant || variant === "normal") return "normal";

  const is1st = variant.startsWith("1st") || variant.includes("-1st");
  const isUnlimited = variant.startsWith("unlimited");
  const isHolo = variant.includes("holo") && !variant.includes("reverse");
  const isReverse = variant.includes("reverse");

  if (isReverse) return "reverse-holofoil";
  if (is1st) return isHolo ? "1st-edition-holofoil" : "1st-edition";
  if (isUnlimited) return isHolo ? "unlimited-holofoil" : "unlimited";
  if (isHolo) return "holofoil";
  return "normal";
}

// Cardmarket only ever distinguishes foil vs non-foil, nothing finer.
function isCardmarketFoil(variant: string | null): boolean {
  return Boolean(variant && variant.includes("holo") && !variant.includes("reverse"));
}

export interface CardPriceResult {
  usd: number | null;
  eur: number | null;
  source: "tcgplayer" | "cardmarket" | null;
}

// ---------------------------------------------------------------------------
// 2026-08-25 pricing bug, for the record — two separate real problems found
// on the same 3 real cards Ross checked by hand (Greninja EX XY20 promo,
// Dragonite EX Evolutions full art, Greninja & Zoroark GX secret rare):
//
// 1. This used to look up EXACTLY ONE TCGplayer bucket
//    (mapVariantToTcgplayerKey's guess), and since sync-cards.ts always
//    calls this with variant=null, that guess was always "normal" — which
//    doesn't exist for most cards people actually check the value of
//    (EX/GX/V, secret rare, full art, promos are never printed "normal").
//    All 3 test cards had price_usd = NULL as a result. FIXED below: check
//    every TCGplayer bucket, not just the guessed one.
//
// 2. With TCGplayer empty, all 3 fell back to Cardmarket — and Cardmarket
//    turned out to be flatly WRONG, not just noisy: Ross pulled up
//    Cardmarket's own live page for the Greninja EX promo and its real
//    trend price is £9.12. What's stored from TCGdex for that same field
//    is €850 — off by roughly 90x. That's not "thin EU market for a US
//    card", that's bad data (either TCGdex's own `pricing.cardmarket`
//    values are wrong, or this file's field-name assumptions for that
//    object are — those assumptions came from a documentation summary,
//    never a real live response, same standing gap as the rest of this
//    TCGdex integration). Either way it can't be trusted right now.
//    FIXED below: Cardmarket is no longer used as a price source at all,
//    `eur` is still computed and stored for later investigation, but
//    never becomes `source` or feeds price_gbp.
// ---------------------------------------------------------------------------

// Picks the raw USD (TCGplayer) price for a given row's variant, checking
// EVERY TCGplayer bucket (starting from mapVariantToTcgplayerKey's guess,
// falling through the rest in TCGPLAYER_KEY_ORDER) rather than giving up
// the moment the guessed one is empty — see bug #1 above. Also returns
// Cardmarket's raw EUR figure for transparency (`cards.price_eur`), but it
// is NEVER used as `source` or converted into `price_gbp` — see bug #2
// above. `source` is therefore only ever "tcgplayer" or null right now.
export function pickCardPrice(
  pricing: TcgdexCardPricing | undefined,
  variant: string | null
): CardPriceResult {
  const guessedKey = mapVariantToTcgplayerKey(variant);
  const keyOrder = [guessedKey, ...TCGPLAYER_KEY_ORDER.filter((k) => k !== guessedKey)];

  let usd: number | null = null;
  for (const key of keyOrder) {
    const bucket: TcgdexTcgplayerPriceVariant | undefined = pricing?.tcgplayer?.[key];
    const price = bucket?.marketPrice ?? bucket?.midPrice ?? null;
    if (price !== null) {
      usd = price;
      break;
    }
  }

  const cardmarket = pricing?.cardmarket;
  const foilFirst = isCardmarketFoil(variant);
  const eur = cardmarket
    ? (foilFirst
        ? (cardmarket["trend-holo"] ?? cardmarket["avg-holo"] ?? cardmarket.trend ?? cardmarket.avg)
        : (cardmarket.trend ?? cardmarket.avg ?? cardmarket["trend-holo"] ?? cardmarket["avg-holo"])
      ) ?? null
    : null;

  // Cardmarket deliberately excluded from `source` — see bug #2 above.
  const source: CardPriceResult["source"] = usd !== null ? "tcgplayer" : null;

  return { usd, eur, source };
}

export interface GbpRates {
  usdToGbp: number;
  eurToGbp: number;
}

// Converts the preferred `source`'s price into GBP — the one figure the
// app actually displays (see src/app/search/page.tsx and
// src/app/collection/page.tsx). Returns null if there's no (trusted) price
// at all. Only handles "tcgplayer" right now — `source` is never
// "cardmarket" as of the 2026-08-25 fix (see the bug note on
// pickCardPrice above), this still checks for it explicitly rather than
// falling through by accident, so re-enabling Cardmarket later is just
// deleting that bug note and this comment, not re-deriving this logic.
export function convertToGbp(price: CardPriceResult, rates: GbpRates | null): number | null {
  if (!rates) return null;
  if (price.source === "tcgplayer" && price.usd !== null) return price.usd * rates.usdToGbp;
  if (price.source === "cardmarket" && price.eur !== null) return price.eur * rates.eurToGbp;
  return null;
}
