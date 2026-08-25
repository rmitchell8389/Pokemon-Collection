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
// TCGplayer is preferred over Cardmarket when both are present, purely
// because most of what's synced (see the session's zh-cn/ja sync work) skews
// non-English, and TCGplayer/Cardmarket coverage skews English regardless —
// TCGplayer's `marketPrice` is generally the more complete/trusted of the
// two for a Western-market print. When only one source has a price for a
// given variant bucket, that one is used regardless of preference.
import type { TcgdexCardPricing, TcgdexTcgplayerPriceVariant } from "./tcgdex";

type TcgplayerVariantKey = keyof Omit<
  NonNullable<TcgdexCardPricing["tcgplayer"]>,
  "updated" | "unit"
>;

// Best-effort mapping from a `cards.variant` value to one of TCGplayer's
// pricing buckets. `cards.variant` is free text sourced from
// src/lib/cardVariants.ts, which — for vintage cards especially — produces
// long compound keys TCGdex's pricing object has no matching bucket for
// (e.g. "holo-1st-shadowless", "holo-1999-2000-copyright"). Rather than
// guess wrong, this only maps the handful of clean, common cases and falls
// back to treating anything else that still contains "holo" as a holofoil
// print (the closest real bucket) or "1st" as a 1st edition print — still a
// simplification for the vintage long tail, but a defensible one, and NOT
// live-verified against a real TCGdex response (same standing caveat as the
// rest of the TCGdex integration — see the top of src/lib/tcgdex.ts).
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

// Picks the raw USD (TCGplayer) and/or EUR (Cardmarket) price for a given
// row's variant, plus which one `source`/the derived GBP figure should be
// attributed to (TCGplayer preferred — see the file header). Both usd and
// eur are returned when both sources have a value, even though only one
// becomes `source` — kept for transparency (`cards.price_usd`/`price_eur`
// alongside the derived `price_gbp`), not just to compute GBP.
export function pickCardPrice(
  pricing: TcgdexCardPricing | undefined,
  variant: string | null
): CardPriceResult {
  const tcgplayerKey = mapVariantToTcgplayerKey(variant);
  const tcgplayerVariant: TcgdexTcgplayerPriceVariant | undefined =
    pricing?.tcgplayer?.[tcgplayerKey];
  const usd = tcgplayerVariant?.marketPrice ?? tcgplayerVariant?.midPrice ?? null;

  const cardmarket = pricing?.cardmarket;
  const eur = cardmarket
    ? isCardmarketFoil(variant)
      ? (cardmarket["trend-holo"] ?? cardmarket["avg-holo"] ?? null)
      : (cardmarket.trend ?? cardmarket.avg ?? null)
    : null;

  const source: CardPriceResult["source"] = usd !== null ? "tcgplayer" : eur !== null ? "cardmarket" : null;

  return { usd, eur, source };
}

export interface GbpRates {
  usdToGbp: number;
  eurToGbp: number;
}

// Converts whichever of usd/eur is the preferred `source` into GBP — the
// one figure the app actually displays (see src/app/search/page.tsx and
// src/app/collection/page.tsx). Returns null if there's no price at all.
export function convertToGbp(price: CardPriceResult, rates: GbpRates | null): number | null {
  if (!rates) return null;
  if (price.source === "tcgplayer" && price.usd !== null) return price.usd * rates.usdToGbp;
  if (price.source === "cardmarket" && price.eur !== null) return price.eur * rates.eurToGbp;
  return null;
}
