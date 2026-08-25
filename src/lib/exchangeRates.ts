// Fetches USD->GBP and EUR->GBP conversion rates from Frankfurter
// (frankfurter.dev — free, open-source, no API key, ECB reference rates),
// used to turn TCGdex's raw TCGplayer (USD) / Cardmarket (EUR) card prices
// into the single GBP figure the app displays (see src/lib/cardPricing.ts).
//
// Verified live from this sandbox (unlike most of the TCGdex integration,
// which could only be checked against documentation) —
// `https://api.frankfurter.dev/v2/rate/USD/GBP` returned
// `{"date":"...","base":"USD","quote":"GBP","rate":0.7499}` on a real
// request. The `/v2/latest?base=..&symbols=..` shape some third-party
// write-ups describe does NOT work on this host (404) — only the
// `/v2/rate/{base}/{quote}` path does.
//
// Frankfurter's own uptime hasn't been as consistently solid as TCGdex's in
// third-party monitoring (roughly high-80s% over 30/90 days at the time
// this was built, vs TCGdex just working throughout this whole project) —
// so a failed fetch here is NOT allowed to break pricing for a whole sync
// run. It falls back to the last successfully-cached rate in
// `exchange_rates` (see supabase/schema.sql) instead.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GbpRates } from "./cardPricing";

const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v2/rate";

async function fetchRate(base: string, quote: string): Promise<number | null> {
  try {
    const res = await fetch(`${FRANKFURTER_BASE_URL}/${base}/${quote}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Frankfurter request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { rate?: number };
    return typeof data.rate === "number" ? data.rate : null;
  } catch (err) {
    console.error(`  ! failed to fetch ${base}->${quote} rate from Frankfurter:`, (err as Error).message);
    return null;
  }
}

// Fetches both rates once and caches them in the single-row `exchange_rates`
// table, for use across an entire sync run — NOT refetched per card, since
// the rate doesn't meaningfully change within one run. Falls back to
// whatever's already cached from a previous successful run if Frankfurter
// fails or returns an incomplete result this time; only returns null (no
// GBP pricing at all this run) if there's no cached rate to fall back to
// either — e.g. the very first run, before this table has ever been
// written.
export async function getGbpRates(supabase: SupabaseClient): Promise<GbpRates | null> {
  const [usdToGbp, eurToGbp] = await Promise.all([fetchRate("USD", "GBP"), fetchRate("EUR", "GBP")]);

  if (usdToGbp !== null && eurToGbp !== null) {
    const { error } = await supabase.from("exchange_rates").upsert({
      id: 1,
      usd_to_gbp: usdToGbp,
      eur_to_gbp: eurToGbp,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      // Still usable for THIS run even if caching it for next time failed —
      // only log, don't drop the rate we just successfully fetched.
      console.error("  ! failed to cache fresh exchange rates in Supabase:", error.message);
    }
    console.log(
      `  exchange rates: 1 USD = £${usdToGbp.toFixed(4)}, 1 EUR = £${eurToGbp.toFixed(4)} (fresh from Frankfurter)`
    );
    return { usdToGbp, eurToGbp };
  }

  console.warn("  ! Frankfurter fetch failed or incomplete this run — falling back to last cached rate");
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("usd_to_gbp, eur_to_gbp, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    console.error(
      "  ! no cached exchange rate available either (first run, or the exchange_rates table isn't set up yet) — GBP prices will be skipped this run"
    );
    return null;
  }

  console.log(
    `  exchange rates: 1 USD = £${data.usd_to_gbp}, 1 EUR = £${data.eur_to_gbp} (cached from ${data.updated_at})`
  );
  return { usdToGbp: data.usd_to_gbp, eurToGbp: data.eur_to_gbp };
}
