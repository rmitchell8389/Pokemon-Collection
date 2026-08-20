// Importer for the Gem Pack line (CBB1C-CBB6C) — the sets Ross's original
// "pivot to include them" directive was about. These do NOT use the
// per-card reprint pattern in cnReprintImport.ts (only a small minority of
// Gem Pack cards — the chase/foil variants — have their own reprint page
// with a cnicon=CBBxC block; confirmed live 2026-08-20 by searching
// insource:"cnicon=CBB2C", which returned only ~10 hits against a real
// 140-card set). Instead, each Gem Pack has ONE dedicated wiki article
// ("宝石包 第N弹（TCG）") containing a bulk card-list table using the
// template `卡牌列表/entryjp` (card LIST, 卡牌 — NOT 卡片, a one-character
// difference that broke the first version of this parser; see below).
//
//   {{卡牌列表/entryjp|PACK SLOT/TOTAL|{{C|NAME|ORIGIN}}|TYPE||{{RarityCBB|RARITY}}|...}}      (Pokémon)
//   {{卡牌列表/entryjp|PACK SLOT/TOTAL|{{TCG|NAME}}|CATEGORY||{{RarityCBB|RARITY}}|...}}        (Trainer/Item)
//   {{卡牌列表/entryjp|PACK SLOT/TOTAL|{{TCG|NAME}}|能量卡|ENERGY-TYPE|{{RarityCBB|RARITY}}}}   (Energy — no blank field)
//
// Confirmed live against the REAL raw wikitext for 宝石包 第二弹（TCG）(CBB2C,
// pageid 285986, fetched directly via debug-gempack-raw.ts, not through
// WebFetch's summarizer — see below for why that distinction mattered):
// all 140 entries, all three shapes above.
//
// PACK is a 2-digit group number (each Pokémon/trainer/energy group in the
// pack gets its own group, e.g. "01" = Eevee, "02" = Vaporeon, ..., "10" =
// items/supporters, "11" = energy), SLOT is that card's 2-digit position
// within its group, TOTAL is the group size.
//
// IMPORTANT LESSON (2026-08-20): the first version of this file used
// `卡片列表` (one character off — 片 vs 牌) and a fixed-field-position regex,
// both wrong, both sourced from a WebFetch call that was explicitly asked
// to "quote verbatim" but subtly didn't. That call returned 0/6 packs
// parsed on Ross's real run despite `entryjp` appearing 140 times in the
// actual content — proof the earlier "verbatim" text wasn't. The fix below
// was built entirely from raw wikitext Ross fetched directly and pasted
// back, not from any further WebFetch summarization. General rule going
// forward for this wiki (already noted once in Phase 1, worth repeating):
// treat ANY WebFetch-summarized quote of wikitext as unverified until a
// real `action=query&prop=revisions` fetch confirms it byte-for-byte.
//
// The parser below splits each entry on real brace-depth rather than a
// fixed field position — necessary because Pokémon/Trainer entries have a
// blank field before RarityCBB and Energy entries don't, which shifts
// every position after the name field. It finds whichever field is the
// `{{RarityCBB|...}}` template rather than assuming an index.
//
// Image filenames are directly derivable — NOT guessed, confirmed live via
// the article's own <gallery> section: {CODE}{pack}{slot}.png, e.g.
// CBB2C0715.png for pack 07 slot 15. Only a subset of cards have an actual
// uploaded file (same "documented but not delivered" pattern as everywhere
// else in this zh-cn effort) — every candidate still goes through the same
// resolve-then-verify pipeline as everywhere else, nothing gets written
// without a live check.
//
// card_number is set to "{pack}-{slot}" (e.g. "07-15"). This is an honest
// choice, not a guess at the physical card's own printed number: the wiki's
// bulk table only gives per-group position, never an overall set-wide
// NNN/TTT the way the per-card reprint pattern's cnno= field does. Using
// the same value that derives the image filename keeps the row traceable
// back to its wiki source.

import { fetchJsonWithRetry, sleep, WIKI_API_BASE } from "./cnReprintImport";
import { resolveCnImageUrls, cnImageExists } from "./cnimages";
import type { CardRow } from "./cnReprintImport";

export interface GemPackDef {
  setId: string; // e.g. "CBB2C"
  pageTitle: string; // e.g. "宝石包 第二弹（TCG）"
}

// Confirmed live via a wiki search for intitle:宝石包 intitle:TCG
// (2026-08-20) — all 6 packs exist as of this writing, matching TCG
// Collector's CBB1C-CBB6C listing (115/140/136/196/196/196 cards).
export const GEM_PACKS: GemPackDef[] = [
  { setId: "CBB1C", pageTitle: "宝石包 第一弹（TCG）" },
  { setId: "CBB2C", pageTitle: "宝石包 第二弹（TCG）" },
  { setId: "CBB3C", pageTitle: "宝石包 第三弹（TCG）" },
  { setId: "CBB4C", pageTitle: "宝石包 第四弹（TCG）" },
  { setId: "CBB5C", pageTitle: "宝石包 第五弹（TCG）" },
  { setId: "CBB6C", pageTitle: "宝石包 第六弹（TCG）" },
];

interface WikiRevisionsResponse {
  query?: {
    pages?: Record<string, { title?: string; revisions?: { slots?: { main?: { "*"?: string } } }[] }>;
  };
}

async function fetchPageContent(pageTitle: string): Promise<string | null> {
  const url = new URL(WIKI_API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", pageTitle);
  url.searchParams.set("prop", "revisions");
  url.searchParams.set("rvprop", "content");
  url.searchParams.set("rvslots", "main");
  url.searchParams.set("format", "json");

  const data = await fetchJsonWithRetry<WikiRevisionsResponse>(url.toString());
  const pages = data?.query?.pages ?? {};
  for (const page of Object.values(pages)) {
    const text = page?.revisions?.[0]?.slots?.main?.["*"];
    if (typeof text === "string") return text;
  }
  return null;
}

export interface GemPackEntry {
  pack: string; // "01".."11"-ish, 2 digits as printed in the wikitext
  slot: string; // 2 digits
  total: string;
  name: string;
  rarity: string | null;
}

const ENTRY_MARKER = "{{卡牌列表/entryjp|";

// Finds every {{卡牌列表/entryjp|...}} block in the text by tracking real
// brace depth from each marker to its matching closing "}}" — not a regex
// with an assumed field count, since Pokémon/Trainer/Energy entries have
// different numbers of fields (see file header). Returns the INNER content
// of each block (marker and final "}}" stripped).
function findEntryBlocks(text: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = text.indexOf(ENTRY_MARKER, searchFrom);
    if (start === -1) break;
    let depth = 1; // the marker itself opened one "{{"
    let p = start + 2; // past the marker's own opening "{{"
    while (p < text.length && depth > 0) {
      if (text[p] === "{" && text[p + 1] === "{") {
        depth++;
        p += 2;
      } else if (text[p] === "}" && text[p + 1] === "}") {
        depth--;
        p += 2;
      } else {
        p++;
      }
    }
    // text[start .. p) is the full "{{卡牌列表/entryjp|...}}" block.
    const inner = text.slice(start + ENTRY_MARKER.length, p - 2);
    blocks.push(inner);
    searchFrom = p;
  }
  return blocks;
}

// Splits a block's inner content on "|" at brace-depth 0 only, so nested
// templates like {{C|伊布|S6a}} or {{RarityCBB|UR}} don't get split apart.
function splitTopLevelFields(inner: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "{" && inner[i + 1] === "{") {
      depth++;
      cur += "{{";
      i++;
    } else if (inner[i] === "}" && inner[i + 1] === "}") {
      depth--;
      cur += "}}";
      i++;
    } else if (inner[i] === "|" && depth === 0) {
      fields.push(cur);
      cur = "";
    } else {
      cur += inner[i];
    }
  }
  fields.push(cur);
  return fields;
}

// {{C|NAME|ORIGIN}} (Pokémon) or {{TCG|NAME}} (Trainer/Item/Energy) — both
// just need the first parameter.
function extractName(field: string): string | null {
  const m = field.match(/^\{\{(?:C|TCG)\|([^|}]+)/);
  return m ? m[1].trim() : null;
}

export function parseGemPackEntries(fullText: string): GemPackEntry[] {
  const entries: GemPackEntry[] = [];
  for (const inner of findEntryBlocks(fullText)) {
    const fields = splitTopLevelFields(inner);
    if (fields.length < 3) continue;

    const posMatch = fields[0].match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (!posMatch) continue;
    const name = extractName(fields[1]);
    if (!name) continue;

    let rarity: string | null = null;
    for (const field of fields.slice(2)) {
      const rarityMatch = field.match(/^\{\{RarityCBB\|([^}]+)\}\}$/);
      if (rarityMatch) {
        rarity = rarityMatch[1].trim();
        break;
      }
    }

    entries.push({
      pack: posMatch[1],
      slot: posMatch[2],
      total: posMatch[3],
      name,
      rarity,
    });
  }
  return entries;
}

// Counts raw {{卡牌列表/entryjp occurrences so callers can see if the parser
// above failed to extract some blocks (a parse gap), rather than silently
// under-reporting — same honesty pattern used for the duplicate-collision
// bug found earlier in this project.
export function countRawEntryLines(fullText: string): number {
  const matches = fullText.match(/\{\{卡牌列表\/entryjp\|/g);
  return matches ? matches.length : 0;
}

export interface GemPackResult {
  setId: string;
  setName: string;
  found: boolean;
  rawEntryLines: number;
  parsedEntries: number;
  candidateImages: number;
  verifiedImages: number;
  rows: CardRow[];
}

function deriveSetName(pageTitle: string): string {
  return pageTitle.replace(/（[^（）]*）$/, "").trim();
}

export async function scoutGemPackSet(def: GemPackDef): Promise<GemPackResult> {
  const setName = deriveSetName(def.pageTitle);
  const text = await fetchPageContent(def.pageTitle);
  if (!text) {
    return {
      setId: def.setId,
      setName,
      found: false,
      rawEntryLines: 0,
      parsedEntries: 0,
      candidateImages: 0,
      verifiedImages: 0,
      rows: [],
    };
  }

  const rawEntryLines = countRawEntryLines(text);
  const entries = parseGemPackEntries(text);

  const candidateTitles = entries.map((e) => `File:${def.setId}${e.pack}${e.slot}.png`);
  const resolved = await resolveCnImageUrls(candidateTitles);

  const verifiedByKey = new Map<string, string>();
  for (const e of entries) {
    const key = `${e.pack}${e.slot}`;
    const fileTitle = `File:${def.setId}${e.pack}${e.slot}.png`;
    const url = resolved.get(fileTitle);
    if (!url) continue;
    const exists = await cnImageExists(url);
    if (exists) verifiedByKey.set(key, url);
  }

  const rows: CardRow[] = entries.map((e) => {
    const cardNumber = `${e.pack}-${e.slot}`;
    const key = `${e.pack}${e.slot}`;
    return {
      id: `${def.setId}-${cardNumber}`,
      language: "zh-cn",
      set_id: def.setId,
      set_name: setName,
      card_number: cardNumber,
      name: e.name,
      national_dex_no: null,
      rarity: e.rarity || null,
      image_url: verifiedByKey.get(key) ?? null,
      synced_at: new Date().toISOString(),
    };
  });

  return {
    setId: def.setId,
    setName,
    found: true,
    rawEntryLines,
    parsedEntries: entries.length,
    candidateImages: candidateTitles.length,
    verifiedImages: verifiedByKey.size,
    rows,
  };
}

export async function scoutAllGemPacks(): Promise<GemPackResult[]> {
  const results: GemPackResult[] = [];
  for (let i = 0; i < GEM_PACKS.length; i++) {
    results.push(await scoutGemPackSet(GEM_PACKS[i]));
    if (i < GEM_PACKS.length - 1) await sleep(1500);
  }
  return results;
}
