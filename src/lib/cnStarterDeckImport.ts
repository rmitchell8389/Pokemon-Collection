// Importer for the "GX起始卡组" (GX Starter Deck) line — CSM2DC "Shining
// Synergy" and CSM1DC "Storming Emergence" in TCG Collector's scheme. The
// per-card reprint pattern already covers a fraction of each (49/357 and
// 59/336, confirmed real via a live DB check — see claude/spec.md "zh-cn
// round 7"), but each deck has its OWN dedicated bulk-table article:
//   GX起始卡组 交相辉映（TCG） (CSM2DC, 357 unique cards)
//   GX起始卡组 横空出世（TCG） (CSM1DC, 336 unique cards)
// which closes the rest. Confirmed live 2026-08-22 via the wiki's raw API.
//
// Uses the SAME {{卡牌列表/entryjp|...}} template as Gem Packs and the
// Black Star Promo lines (cnGemPackImport.ts / cnBlackStarPromoImport.ts),
// but a THIRD distinct field shape — not guessed, read directly from the
// real captured wikitext (data/wiki-raw/round3-raw.txt):
//
//   {{卡牌列表/entryjp|POS/TOTAL|{{C|NAME|ORIGIN}}|TYPE||RARITY}}
//   {{卡牌列表/entryjp|POS/TOTAL|{{TCG|NAME}}|CATEGORY||RARITY}}
//   {{卡牌列表/entryjp|POS/TOTAL|{{TCG|NAME}}|能量卡|ENERGY-TYPE|RARITY}}   (Energy — same 5 fields, energy type goes in the slot that's blank for everything else, not a dropped-field shape like the promo lines have)
//
// Only 5 fields normally: [0]=position/total (TOTAL is NOT the real card
// count — CSM2DC's box says "342+" but the real unique count is 357; TOTAL
// isn't used for anything here, only POS matters), [1]=name template,
// [2]=type/category, [3]=blank (or energy type for Energy cards), [4]=
// rarity (almost always the literal "—" em-dash, meaning "no rarity
// marked" — real rarity values are rare in this data but the field is
// captured honestly when present, not defaulted to null out of laziness).
// A 6th field appears on ~30 cards per deck (the highest-numbered ones,
// past the base set) carrying a holo/full-art marker ("H"/"全") — not
// parsed into anything here (this project doesn't have that granularity
// for these cards yet), but doesn't break the 5-field extraction since it
// only ever APPENDS a field, never shifts earlier ones.
//
// Some POS values are the literal "-" (unnumbered basic energy cards) —
// handled the same way cnBlackStarPromoImport.ts handles its own
// unnumbered section: sequential synthetic ids in source order.
//
// Real duplicate POS numbers exist (confirmed ~40 for CSM2DC, ~36 for
// CSM1DC) — same holo/non-holo-pair pattern already found and fixed in
// cnBlackStarPromoImport.ts's parser. Handled identically here:
// auto-disambiguate on repeat ("232", "232-2", ...) rather than silently
// collide at the DB upsert stage.

import { fetchFullContent, sleep } from "./cnReprintImport";
import type { CardRow } from "./cnReprintImport";

export interface StarterDeckDef {
  setId: string; // TCG Collector's scheme, e.g. "CSM2DC"
  pageTitle: string;
}

// Confirmed live 2026-08-22 via the raw wikitext capture.
export const STARTER_DECK_SETS: StarterDeckDef[] = [
  { setId: "CSM2DC", pageTitle: "GX起始卡组 交相辉映（TCG）" },
  { setId: "CSM1DC", pageTitle: "GX起始卡组 横空出世（TCG）" },
];

const ENTRY_MARKER = "{{卡牌列表/entryjp|";

// Same brace-depth block finder as cnGemPackImport.ts/cnBlackStarPromoImport.ts.
function findEntryBlocks(text: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = text.indexOf(ENTRY_MARKER, searchFrom);
    if (start === -1) break;
    let depth = 1;
    let p = start + 2;
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
    const inner = text.slice(start + ENTRY_MARKER.length, p - 2);
    blocks.push(inner);
    searchFrom = p;
  }
  return blocks;
}

// Same [[ ]]-aware splitter as cnBlackStarPromoImport.ts — this data also
// contains wikilinks (e.g. card origin references), same protection needed.
function splitTopLevelFields(inner: string): string[] {
  const fields: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "{" && inner[i + 1] === "{") {
      braceDepth++;
      cur += "{{";
      i++;
    } else if (inner[i] === "}" && inner[i + 1] === "}") {
      braceDepth--;
      cur += "}}";
      i++;
    } else if (inner[i] === "[" && inner[i + 1] === "[") {
      bracketDepth++;
      cur += "[[";
      i++;
    } else if (inner[i] === "]" && inner[i + 1] === "]") {
      bracketDepth--;
      cur += "]]";
      i++;
    } else if (inner[i] === "|" && braceDepth === 0 && bracketDepth === 0) {
      fields.push(cur);
      cur = "";
    } else {
      cur += inner[i];
    }
  }
  fields.push(cur);
  return fields;
}

function extractName(field: string): string | null {
  const m = field.match(/^\{\{(?:C|TCG)\|([^|}]+)/);
  return m ? m[1].trim() : null;
}

export interface StarterDeckEntry {
  numbered: boolean;
  cardNumber: string;
  rawPositionField: string;
  name: string;
  category: string;
  rarity: string | null; // null when the field is missing OR the literal "—" (no rarity marked)
}

export function countRawEntryLines(fullText: string): number {
  const matches = fullText.match(/\{\{卡牌列表\/entryjp\|/g);
  return matches ? matches.length : 0;
}

export function parseStarterDeckEntries(fullText: string): StarterDeckEntry[] {
  const entries: StarterDeckEntry[] = [];
  let unnumberedCounter = 0;
  const numberSeenCount = new Map<string, number>();

  for (const inner of findEntryBlocks(fullText)) {
    const fields = splitTopLevelFields(inner);
    if (fields.length < 3) continue;

    const name = extractName(fields[1]);
    if (!name) continue;

    const category = fields[2].trim();
    const rawRarity = fields.length >= 5 ? fields[4].trim() : "";
    const rarity = rawRarity && rawRarity !== "—" ? rawRarity : null;

    // "POS/TOTAL" — TOTAL is a box-level figure, not used. A bare "-" (no
    // slash) means unnumbered, same as cnBlackStarPromoImport.ts.
    const posMatch = fields[0].trim().match(/^(\d+)\/\d+$/);

    if (posMatch) {
      const baseNumber = posMatch[1];
      const seenCount = (numberSeenCount.get(baseNumber) ?? 0) + 1;
      numberSeenCount.set(baseNumber, seenCount);
      const cardNumber = seenCount === 1 ? baseNumber : `${baseNumber}-${seenCount}`;

      entries.push({
        numbered: true,
        cardNumber,
        rawPositionField: fields[0].trim(),
        name,
        category,
        rarity,
      });
    } else {
      unnumberedCounter++;
      entries.push({
        numbered: false,
        cardNumber: `U${String(unnumberedCounter).padStart(2, "0")}`,
        rawPositionField: fields[0].trim(),
        name,
        category,
        rarity,
      });
    }
  }

  return entries;
}

export interface StarterDeckResult {
  setId: string;
  setName: string;
  found: boolean;
  rawEntryLines: number;
  parsedEntries: number;
  rows: CardRow[];
}

export async function scoutStarterDeckSet(def: StarterDeckDef): Promise<StarterDeckResult> {
  const content = await fetchFullContent([def.pageTitle]);
  const text = content.get(def.pageTitle);
  const setName = def.pageTitle.replace(/（[^（）]*）$/, "").trim();

  if (!text) {
    return {
      setId: def.setId,
      setName,
      found: false,
      rawEntryLines: 0,
      parsedEntries: 0,
      rows: [],
    };
  }

  const rawEntryLines = countRawEntryLines(text);
  const entries = parseStarterDeckEntries(text);

  const rows: CardRow[] = entries.map((e) => ({
    id: `${def.setId}-${e.cardNumber}`,
    language: "zh-cn",
    set_id: def.setId,
    set_name: setName,
    card_number: e.cardNumber,
    name: e.name,
    national_dex_no: null,
    rarity: e.rarity,
    image_url: null,
    synced_at: new Date().toISOString(),
  }));

  return {
    setId: def.setId,
    setName,
    found: true,
    rawEntryLines,
    parsedEntries: entries.length,
    rows,
  };
}

export async function scoutAllStarterDecks(): Promise<StarterDeckResult[]> {
  const results: StarterDeckResult[] = [];
  for (let i = 0; i < STARTER_DECK_SETS.length; i++) {
    results.push(await scoutStarterDeckSet(STARTER_DECK_SETS[i]));
    if (i < STARTER_DECK_SETS.length - 1) await sleep(1500);
  }
  return results;
}
