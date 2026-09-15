// Thin wrapper around the TCGdex REST API (https://tcgdex.dev).
//
// IMPORTANT — verify before relying on this: TCGdex's own docs site
// (tcgdex.dev) render most of their concrete request/response examples via
// client-side JS, which the research tooling used to build this file
// couldn't execute, so the exact paths below are TCGdex's documented v2 REST
// convention (used by their official SDKs) rather than something verified
// byte-for-byte against a live response. Before running the sync script for
// real, hit one of these URLs directly in a browser or `curl` and confirm
// the shape matches what's assumed here — flagged in the README too.

export const TCGDEX_LANGUAGES = ["en", "ja", "zh-tw", "zh-cn"] as const;
export type TcgdexLanguage = (typeof TCGDEX_LANGUAGES)[number];

const TCGDEX_BASE_URL = "https://api.tcgdex.net/v2";

export interface TcgdexSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount: { total: number; official: number };
}

export interface TcgdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface TcgdexSetFull extends TcgdexSetBrief {
  cards: TcgdexCardBrief[];
  // Which broader era/serie this set belongs to (e.g. "Scarlet & Violet",
  // "Sword & Shield") — TCGdex's documented v2 convention, same
  // not-live-verified caveat as the rest of this file. Used to populate
  // `cards.series` for the /search page's Series filter — see
  // scripts/sync-cards.ts. If this turns out to be absent/wrong shape on a
  // real response, that filter just stays empty (same graceful-degradation
  // handling as category/types already have) rather than breaking anything.
  serie?: { id: string; name: string };
}

export interface TcgdexSerieFull {
  id: string;
  name: string;
  sets: TcgdexSetBrief[];
}

// One price point (TCGplayer's shape) — all optional since not every field
// is populated for every listing. Same "documented, not live-verified from
// this sandbox" caveat as the rest of this file.
export interface TcgdexTcgplayerPriceVariant {
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  marketPrice?: number;
  directLowPrice?: number;
}

// TCGplayer's pricing keys are per PRINT variant, not per card — a card
// can have several of these present at once (e.g. both `normal` and
// `reverse-holofoil` for a common that was also printed reverse holo).
// See src/lib/cardPricing.ts for how a `cards.variant` value picks which
// one of these applies to that specific row.
export interface TcgdexTcgplayerPricing {
  updated?: number;
  unit?: string; // "USD"
  normal?: TcgdexTcgplayerPriceVariant;
  holofoil?: TcgdexTcgplayerPriceVariant;
  "reverse-holofoil"?: TcgdexTcgplayerPriceVariant;
  "1st-edition"?: TcgdexTcgplayerPriceVariant;
  "1st-edition-holofoil"?: TcgdexTcgplayerPriceVariant;
  unlimited?: TcgdexTcgplayerPriceVariant;
  "unlimited-holofoil"?: TcgdexTcgplayerPriceVariant;
}

// Cardmarket only distinguishes non-foil vs foil (the "-holo" suffixed
// fields), not TCGplayer's finer print-variant buckets.
export interface TcgdexCardmarketPricing {
  updated?: number;
  unit?: string; // "EUR"
  avg?: number;
  low?: number;
  trend?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  "avg-holo"?: number;
  "low-holo"?: number;
  "trend-holo"?: number;
  "avg1-holo"?: number;
  "avg7-holo"?: number;
  "avg30-holo"?: number;
}

export interface TcgdexCardPricing {
  tcgplayer?: TcgdexTcgplayerPricing;
  cardmarket?: TcgdexCardmarketPricing;
}

export interface TcgdexCardFull {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category: string; // "Pokemon" | "Trainer" | "Energy"
  rarity?: string;
  // Market pricing, sourced from TCGplayer (USD) and/or Cardmarket (EUR).
  // Added 2026-08-25, same "documented v2 convention, not fetched live
  // from this sandbox" caveat as the rest of this file — TCGdex's own docs
  // say it's "independent of language" (i.e. the same pricing data
  // attaches to a card regardless of which language row it's synced as,
  // not that there's a separate JA/ZH market price), and admit real gaps
  // for older EX/full-art cards, very recent releases, and regional
  // exclusives. Absent entirely — `pricing` itself undefined — when TCGdex
  // has nothing for either source. See src/lib/cardPricing.ts for how this
  // gets turned into the single price_gbp value the app actually shows.
  pricing?: TcgdexCardPricing;
  // Illustrator credit — same "documented v2 convention, not fetched live
  // from this sandbox" caveat as the rest of this file (see the top-of-file
  // note). Absent on a handful of very old/promo cards TCGdex hasn't
  // credited, per their own docs.
  illustrator?: string;
  set: { id: string; name: string };
  dexId?: number[]; // National Pokedex numbers — absent for Trainer/Energy cards
  // Energy color(s) for a Pokemon card, e.g. ["Fire"] — absent for
  // Trainer/Energy cards. Same "documented v2 convention, not fetched live
  // from this sandbox" caveat as the rest of this file. Whether TCGdex
  // localizes these strings per language (e.g. returns something other than
  // English "Fire" for a ja/zh-cn card) is unverified — the search page that
  // filters on this (src/app/search/page.tsx) deliberately builds its
  // checkbox options from whatever's actually in the synced data instead of
  // a hardcoded English list, so it doesn't matter which way that turns out.
  types?: string[];
}

const TCGDEX_MAX_RETRIES = 3;
const TCGDEX_RETRY_BASE_DELAY_MS = 1000;

// Status codes worth retrying — transient server-side issues, not "this
// genuinely doesn't exist" (404) or a real client error, which retrying
// would never fix and which some callers rely on failing immediately (a
// guessed set id that legitimately 404s, e.g. CS1.5C elsewhere in this
// project, must still fail fast).
const TCGDEX_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tcgdexFetch<T>(path: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= TCGDEX_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s before retries 1, 2, 3.
      await sleep(TCGDEX_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }

    let res: Response;
    try {
      res = await fetch(`${TCGDEX_BASE_URL}${path}`, {
        headers: {
          Accept: "application/json",
          // Without a real browser-like User-Agent, TCGdex's edge (Cloudflare)
          // returned a bare 403 in testing — Node's default fetch UA looks
          // enough like a bot to get blocked.
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset, etc.) — same retry
      // treatment as a 5xx.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < TCGDEX_MAX_RETRIES) continue;
      throw lastError;
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    if (!TCGDEX_RETRYABLE_STATUSES.has(res.status) || attempt === TCGDEX_MAX_RETRIES) {
      // Not worth retrying (e.g. a real 404) or out of attempts — same
      // error message shape every existing caller (sync-cards.ts's
      // per-set catch block) already expects and parses.
      throw new Error(`TCGdex request failed: ${res.status} ${res.statusText} for ${path}`);
    }

    console.log(
      `  ! ${path} returned ${res.status}, retrying (attempt ${attempt + 1}/${TCGDEX_MAX_RETRIES})...`
    );
    lastError = new Error(`TCGdex request failed: ${res.status} ${res.statusText} for ${path}`);
  }

  throw lastError ?? new Error(`TCGdex request failed for ${path}`);
}

export function listSets(language: TcgdexLanguage) {
  return tcgdexFetch<TcgdexSetBrief[]>(`/${language}/sets`);
}

export function getSet(language: TcgdexLanguage, setId: string) {
  // Some TCGdex set ids contain characters like "+" (e.g. Japanese "SM1+") —
  // encode defensively so those don't get misinterpreted in the URL path.
  return tcgdexFetch<TcgdexSetFull>(`/${language}/sets/${encodeURIComponent(setId)}`);
}

export function getCard(language: TcgdexLanguage, cardId: string) {
  return tcgdexFetch<TcgdexCardFull>(`/${language}/cards/${encodeURIComponent(cardId)}`);
}

// Pokemon TCG Pocket (the mobile-only digital game) is a separate product
// from the physical trading card game this app tracks, but TCGdex catalogs
// both. Per TCGdex's own docs (tcgdex.dev/tcg-pocket): "All TCG Pocket cards
// are organized under the tcgp series in our API," across every language.
// NOT verified against a live response — TCGdex's API host isn't reachable
// from the sandbox this was built in (network egress is allowlisted and
// api.tcgdex.net isn't on it), so this is built from the documented
// behavior only. The sync script logs exactly what this returns and what it
// excludes each run — check that log after a real run to confirm the shape
// matches (a SerieFull with a `sets` array is the assumed shape, mirroring
// how a full Set nests its cards).
export const TCG_POCKET_SERIE_ID = "tcgp";

export function getSerie(language: TcgdexLanguage, serieId: string) {
  return tcgdexFetch<TcgdexSerieFull>(`/${language}/series/${encodeURIComponent(serieId)}`);
}
