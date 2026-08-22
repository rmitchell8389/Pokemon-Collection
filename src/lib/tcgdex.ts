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
}

export interface TcgdexSerieFull {
  id: string;
  name: string;
  sets: TcgdexSetBrief[];
}

export interface TcgdexCardFull {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category: string; // "Pokemon" | "Trainer" | "Energy"
  rarity?: string;
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

async function tcgdexFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${TCGDEX_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      // Without a real browser-like User-Agent, TCGdex's edge (Cloudflare)
      // returned a bare 403 in testing — Node's default fetch UA looks
      // enough like a bot to get blocked.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`TCGdex request failed: ${res.status} ${res.statusText} for ${path}`);
  }

  return (await res.json()) as T;
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
