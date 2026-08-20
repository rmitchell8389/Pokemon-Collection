// Shared logic for importing zh-cn card ROWS (not just images) for sets
// TCGdex has no card data for at all, sourced from 52poke wiki's per-card
// REPRINT documentation pattern — see scripts/import-cn-reprint-set.ts and
// scripts/import-cn-reprint-sets-batch.ts for the two CLI entry points that
// use this. Confirmed for CSMPiC (cnimages.ts) and CS1aC (this session,
// 135/135 cards parsed cleanly on the first real run).
//
// Every card reprinted into one of these sets has ITS OWN wiki page (the
// original card), and that page's infobox has a
//   {{ExpansionList/main/zh|...|cnicon=CODE|cnexpansion=NAME|cnno=NNN/TTT|cnrar=...|cnimg=...}}
// block per product it was reprinted into. This module finds every page
// referencing a given CODE, pulls each page's FULL wikitext (not the search
// snippet, which truncates long field lists), and extracts what's needed to
// build a card row. Images still go through the same resolve-then-verify
// pipeline as everywhere else in this codebase — nothing gets written
// without a live check.
//
// Does NOT cover Gem Pack-style sets (CBB2C, CBB3C, ...) — those use a
// different, bulk pack-table wiki format and need a separate importer.

import { resolveCnImageUrls, cnImageExists } from "./cnimages";

export const WIKI_API_BASE = "https://wiki.52poke.com/api.php";
export const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// UPDATE 2026-08-20 (batch-scoping run against ~44 codes): the "Ross's own
// machine doesn't get rate-limited" assumption from cnimages.ts held for
// low-volume runs (one set at a time), but a fast back-to-back loop across
// many codes DID trip a 429 partway through (8/44 codes succeeded, then
// every remaining code failed instantly with no recovery, since there was
// no backoff — a fixed rate limit exists, it just takes real volume to hit
// it). Fixed here with retry+backoff on 429 (respecting Retry-After when
// present) plus a small proactive delay between requests, rather than
// relying on request volume staying low forever.
export async function fetchJsonWithRetry<T>(url: string, maxAttempts = 5): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) {
      if (attempt === maxAttempts) {
        throw new Error(`rate limited (429) after ${maxAttempts} attempts`);
      }
      const retryAfterHeader = res.headers.get("retry-after");
      const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : attempt * 3000;
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) throw new Error(`request failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }
  throw new Error("unreachable");
}

interface WikiSearchResponse {
  query?: { search?: { title: string }[] };
  continue?: { sroffset?: number };
}

interface WikiRevisionsResponse {
  query?: {
    pages?: Record<string, { title?: string; revisions?: { slots?: { main?: { "*"?: string } } }[] }>;
  };
}

// Paginated insource: search — returns every page title containing the
// literal string `cnicon=CODE`.
export async function searchReprintPages(code: string): Promise<string[]> {
  const titles: string[] = [];
  let sroffset: number | undefined;

  for (;;) {
    const url = new URL(WIKI_API_BASE);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", `insource:"cnicon=${code}"`);
    url.searchParams.set("srlimit", "500");
    url.searchParams.set("format", "json");
    if (sroffset !== undefined) url.searchParams.set("sroffset", String(sroffset));

    const data = await fetchJsonWithRetry<WikiSearchResponse>(url.toString());

    const hits = data?.query?.search ?? [];
    for (const hit of hits) titles.push(hit.title);

    const nextOffset = data?.continue?.sroffset;
    if (nextOffset === undefined || hits.length === 0) break;
    sroffset = nextOffset;
    await sleep(400);
  }

  return Array.from(new Set(titles));
}

// Batch-fetches full wikitext for a list of page titles (50 per call, the
// MediaWiki multi-title limit for anonymous requests).
export async function fetchFullContent(titles: string[]): Promise<Map<string, string>> {
  const content = new Map<string, string>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const url = new URL(WIKI_API_BASE);
    url.searchParams.set("action", "query");
    url.searchParams.set("titles", batch.join("|"));
    url.searchParams.set("prop", "revisions");
    url.searchParams.set("rvprop", "content");
    url.searchParams.set("rvslots", "main");
    url.searchParams.set("format", "json");

    const data = await fetchJsonWithRetry<WikiRevisionsResponse>(url.toString());

    const pages = data?.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const title = page?.title;
      const text = page?.revisions?.[0]?.slots?.main?.["*"];
      if (title && typeof text === "string") content.set(title, text);
    }
    if (i + BATCH_SIZE < titles.length) await sleep(400);
  }

  return content;
}

// Extracts one field's value from a bounded wikitext chunk (a single
// ExpansionList template invocation, newline-delimited — confirmed
// single-line in every real example seen this session). Handles both a
// plain value and one level of nested {{Template|value}} (e.g.
// cnrar={{RarityCBB|UR}} -> "UR").
function extractField(chunk: string, field: string): string | null {
  const re = new RegExp(`\\|${field}=(\\{\\{[^}]*\\}\\}|[^|}]*)`);
  const m = chunk.match(re);
  if (!m) return null;
  let val = m[1].trim();
  const nested = val.match(/^\{\{[^|]*\|([^}]*)\}\}$/);
  if (nested) val = nested[1].trim();
  return val || null;
}

export interface ReprintEntry {
  title: string;
  name: string;
  cardNumber: string | null;
  rarity: string | null;
  cnimg: string | null;
  cnexpansion: string | null;
}

// Finds the ExpansionList/main/zh block matching this specific code within
// a page's full wikitext (a page can have multiple reprint blocks, one per
// product it appears in) and extracts the fields we need.
export function parsePage(title: string, fullText: string, code: string): ReprintEntry | null {
  const pieces = fullText.split("{{ExpansionList/main/zh");
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i];
    const newlineIdx = piece.indexOf("\n");
    const chunk = (newlineIdx === -1 ? piece : piece.slice(0, newlineIdx)).slice(0, 600);
    if (!chunk.includes(`cnicon=${code}|`) && !chunk.includes(`cnicon=${code}}}`)) continue;

    const cnno = extractField(chunk, "cnno");
    const cardNumber = cnno ? cnno.split("/")[0].trim() : null;
    const rarity = extractField(chunk, "cnrar");
    const cnimg = extractField(chunk, "cnimg");
    const cnexpansion = extractField(chunk, "cnexpansion");

    // Title looks like "NAME（ORIGIN_SET）" — strip the trailing
    // full-width-paren disambiguator to get the card's plain name.
    const name = title.replace(/（[^（）]*）$/, "").trim();

    return { title, name, cardNumber, rarity, cnimg, cnexpansion };
  }
  return null;
}

export interface CardRow {
  id: string;
  language: "zh-cn";
  set_id: string;
  set_name: string;
  card_number: string;
  name: string;
  national_dex_no: null;
  rarity: string | null;
  image_url: string | null;
  synced_at: string;
}

export interface ReprintSetResult {
  setId: string;
  setName: string | null;
  candidatePages: number;
  parsedEntries: number;
  candidateImages: number;
  verifiedImages: number;
  rows: CardRow[];
}

// Picks the most common non-null cnexpansion value across entries — the
// wiki's own name for this set, used instead of trusting TCGdex's (already
// proven unreliable for these codes — e.g. CS1aC's TCGdex-declared name
// didn't match what the wiki itself calls the set).
function deriveSetName(entries: ReprintEntry[], override?: string): string | null {
  if (override) return override;
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!e.cnexpansion) continue;
    counts.set(e.cnexpansion, (counts.get(e.cnexpansion) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

// Full scout+resolve pipeline for one set code. Does NOT touch the DB —
// callers decide whether/how to write the returned rows.
export async function scoutReprintSet(setId: string, opts?: { name?: string }): Promise<ReprintSetResult> {
  const titles = await searchReprintPages(setId);

  if (titles.length === 0) {
    return {
      setId,
      setName: opts?.name ?? null,
      candidatePages: 0,
      parsedEntries: 0,
      candidateImages: 0,
      verifiedImages: 0,
      rows: [],
    };
  }

  const contentByTitle = await fetchFullContent(titles);

  const entries: ReprintEntry[] = [];
  for (const title of titles) {
    const text = contentByTitle.get(title);
    if (!text) continue;
    const entry = parsePage(title, text, setId);
    if (!entry || !entry.cardNumber) continue;
    entries.push(entry);
  }

  const setName = deriveSetName(entries, opts?.name);

  const candidateTitles = entries
    .filter((e) => e.cnimg && e.cnimg !== "n")
    .map((e) => `File:${e.cnimg}.png`);
  const resolved = await resolveCnImageUrls(candidateTitles);

  const verifiedImageByCardNumber = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.cnimg || entry.cnimg === "n") continue;
    const fileTitle = `File:${entry.cnimg}.png`;
    const url = resolved.get(fileTitle);
    if (!url) continue;
    const exists = await cnImageExists(url);
    if (exists) verifiedImageByCardNumber.set(entry.cardNumber!, url);
  }

  const rows: CardRow[] = entries.map((e) => ({
    id: `${setId}-${e.cardNumber}`,
    language: "zh-cn",
    set_id: setId,
    set_name: setName ?? setId,
    card_number: e.cardNumber!,
    name: e.name,
    national_dex_no: null,
    rarity: e.rarity,
    image_url: verifiedImageByCardNumber.get(e.cardNumber!) ?? null,
    synced_at: new Date().toISOString(),
  }));

  return {
    setId,
    setName,
    candidatePages: titles.length,
    parsedEntries: entries.length,
    candidateImages: candidateTitles.length,
    verifiedImages: verifiedImageByCardNumber.size,
    rows,
  };
}
