// Importer for the plain numbered zh-cn booster sets — the round-12 finding
// (see claude/spec.md "zh-cn round 12") that the 28 main numbered expansions
// account for a combined 6,838-card gap and have never had a dedicated
// importer, unlike starter decks/promos/Happy Sets/Gem Packs which all
// already have one.
//
// Round 13 piloted this on the CS1 (Dynamax Clash) line and confirmed real
// wiki articles exist using the SAME bulk-table field shape
// cnStarterDeckImport.ts already parses:
//
//   {{卡牌列表/entryjp|POS/TOTAL|{{C|NAME|ORIGIN}}|TYPE||RARITY}}
//   {{卡牌列表/entry|POS/TOTAL|{{C|NAME|ORIGIN}}|TYPE||RARITY}}    (same shape, different marker string)
//   {{卡牌列表/entryjp|POS/TOTAL|{{TCG|NAME}}|CATEGORY||RARITY}}
//   {{卡牌列表/entry|—|{{TCG|NAME}}|能量卡|ENERGY-TYPE|RARITY}}    (unnumbered energy: literal em-dash "—" position, not a real number)
//
// Confirmed via real captured wikitext (data/wiki-raw/dynamax-clash-round13-raw.txt):
//   CS1aC "极巨争锋 雷（TCG）" — uses {{卡牌列表/entryjp|...}}, 217 raw entries
//   CSAC  "极巨争锋 卡组构筑礼盒（TCG）" — uses {{卡牌列表/entryjp|...}}, 24 raw entries
//   CS1.5C "极巨攻防（TCG）" — uses {{卡牌列表/entryjp|...}}, 96 raw entries
//   CS1DC "V起始卡组 极巨争锋（TCG）" — uses {{卡牌列表/entry|...}} (NO jp — different
//         marker, but the SAME field shape, confirmed byte-for-byte), 230 raw entries
// CS1bC "极巨争锋 炎（TCG）" 404'd — round 13's title guess used the wrong
// character (炎 vs 焰). CS1aC's own page names its sibling directly via
// {{ExpansionPrevNext|...|other=极巨争锋 焰}} — corrected here to
// "极巨争锋 焰（TCG）", NOT independently fetched/confirmed yet (this
// session's WebFetch hit a hard rate limit against wiki.52poke.com partway
// through round 13 and never recovered) — first thing to check when this
// runs live.
//
// Both marker strings are searched independently — "{{卡牌列表/entry|" as a
// literal substring does NOT match inside "{{卡牌列表/entryjp|" (the
// character after "entry" differs, "j" vs "|"), so there's no double-count
// risk searching for both.
//
// Same duplicate-position auto-disambiguation as every other zh-cn importer
// in this project (CS1DC's own data confirms printed positions run past its
// own TOTAL — 221/207 — meaning real position reuse happens here too, same
// holo/non-holo-pair pattern as everywhere else).

import { fetchFullContent, sleep } from "./cnReprintImport";
import type { CardRow } from "./cnReprintImport";

export interface BoosterSetDef {
  setId: string; // TCG Collector's scheme, e.g. "CS1aC"
  pageTitle: string;
}

// Round 13 pilot — the CS1 (Dynamax Clash) line. All 5 titles confirmed
// real and committed live (766 rows, zero errors) — see claude/spec.md
// "zh-cn round 13".
//
// Round 14 — CS2 (Vivid Portrayals) line. CS2aC/CS2bC titles came straight
// from CS1.5C's own {{ExpansionPrevNext|...}} template (no more guessing —
// see cnBoosterSetImport.ts's round-13 header note), confirmed real via the
// raw capture (data/wiki-raw/vivid-portrayals-round14-raw.txt): both use
// {{卡牌列表/entryjp|...}}, 143 entries each. CS2.1C ("Meowth's Little
// Tricks") and CS2.5C ("Brilliant Counterattack") guessed titles both
// 404'd — CS2.5C's real title was found afterward via CS2aC's OWN chain
// reference (`next=璀璨反击`) and is queued for round 15; CS2.1C's real
// title is still unknown.
export const BOOSTER_SETS: BoosterSetDef[] = [
  { setId: "CS1aC", pageTitle: "极巨争锋 雷（TCG）" },
  { setId: "CS1bC", pageTitle: "极巨争锋 焰（TCG）" },
  { setId: "CS1DC", pageTitle: "V起始卡组 极巨争锋（TCG）" },
  { setId: "CSAC", pageTitle: "极巨争锋 卡组构筑礼盒（TCG）" },
  { setId: "CS1.5C", pageTitle: "极巨攻防（TCG）" },
  { setId: "CS2aC", pageTitle: "浓墨重彩 黎（TCG）" },
  { setId: "CS2bC", pageTitle: "浓墨重彩 靛（TCG）" },
  // Round 15 — CS2.5C's real title ("璀璨反击") came from CS2aC's own chain
  // reference, confirmed real (79 cards) via
  // data/wiki-raw/brilliant-counterattack-round15-raw.txt. Its own chain
  // reference in turn names CS3aC/CS3bC directly: `next=洪荒演武 茂|next2=洪荒演武 激`.
  { setId: "CS2.5C", pageTitle: "璀璨反击（TCG）" },
];

const MARKERS = ["{{卡牌列表/entryjp|", "{{卡牌列表/entry|"];

// Same brace-depth block finder as every other zh-cn importer in this
// project, parameterized by marker (same pattern as cnHappySetImport.ts).
function findEntryBlocks(text: string, marker: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = text.indexOf(marker, searchFrom);
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
    blocks.push(text.slice(start + marker.length, p - 2));
    searchFrom = p;
  }
  return blocks;
}

// Same [[ ]]/{{ }}-depth-aware splitter as every other zh-cn importer.
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

export interface BoosterSetEntry {
  numbered: boolean;
  cardNumber: string;
  rawPositionField: string;
  name: string;
  category: string;
  rarity: string | null; // null when missing OR the literal "—" (no rarity marked)
}

export function countRawEntryLines(fullText: string): number {
  let count = 0;
  for (const marker of MARKERS) {
    const matches = fullText.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
    count += matches ? matches.length : 0;
  }
  return count;
}

export function parseBoosterSetEntries(fullText: string): BoosterSetEntry[] {
  const entries: BoosterSetEntry[] = [];
  let unnumberedCounter = 0;
  const numberSeenCount = new Map<string, number>();

  const rawBlocks = MARKERS.flatMap((marker) => findEntryBlocks(fullText, marker));

  for (const inner of rawBlocks) {
    const fields = splitTopLevelFields(inner);
    if (fields.length < 3) continue;

    const name = extractName(fields[1]);
    if (!name) continue;

    const category = fields[2].trim();
    const rawRarity = fields.length >= 5 ? fields[4].trim() : "";
    const rarity = rawRarity && rawRarity !== "—" ? rawRarity : null;

    // "POS/TOTAL" — TOTAL is a box-level figure, not used. Anything that
    // doesn't match (a bare "—" em-dash for unnumbered energy, or any other
    // non-numeric value) falls through to the unnumbered branch.
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

export interface BoosterSetResult {
  setId: string;
  setName: string;
  found: boolean;
  rawEntryLines: number;
  parsedEntries: number;
  rows: CardRow[];
}

export async function scoutBoosterSet(def: BoosterSetDef): Promise<BoosterSetResult> {
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
  const entries = parseBoosterSetEntries(text);

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

export async function scoutAllBoosterSets(): Promise<BoosterSetResult[]> {
  const results: BoosterSetResult[] = [];
  for (let i = 0; i < BOOSTER_SETS.length; i++) {
    results.push(await scoutBoosterSet(BOOSTER_SETS[i]));
    if (i < BOOSTER_SETS.length - 1) await sleep(1500);
  }
  return results;
}
