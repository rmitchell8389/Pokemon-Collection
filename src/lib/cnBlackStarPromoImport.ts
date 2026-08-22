// Importer for the SM-P and SV-P Simplified Chinese "Black Star Promos"
// lines — TCG Collector calls these "Sun and Moon Promos" (SM-P, 63 cards)
// and (unnamed so far, SV-P) under its China region tab. Round 4 of the
// zh-cn research wrongly concluded these weren't real closable products —
// see claude/spec.md "zh-cn round 5" for the correction. They ARE real:
// each has ONE dedicated wiki article using the SAME `卡牌列表/entryjp`
// bulk-table template Gem Packs use (see cnGemPackImport.ts), fetched and
// confirmed byte-for-byte via the wiki's raw API, not a WebFetch summary —
// full raw wikitext captured 2026-08-22 in data/wiki-raw/sm-p-sv-p-raw.txt.
//
// Real counts confirmed from that raw capture (article's own zh-cn
// sections only — NOT the zh-tw sibling articles on the same page dump,
// which use an unrelated, larger, independently-numbered card list and are
// out of scope here):
//   SM-P: 50 numbered entries (001-050/SM-P) + 13 unnumbered trophy items
//         (a dedicated "没有编号"/"no number" table) = 63 total. Matches
//         Ross's originally-pasted TCG Collector list exactly (50 numbered
//         + "No. 051"-"No. 063" — TCG Collector auto-numbers the trophy
//         items for display; the wiki leaves them formally unnumbered).
//   SV-P: 367 numbered entries (001-434/SV-P, with real gaps in the
//         numbering — highest printed number is 434, not the count) + 34
//         unnumbered items = 401 total. This is an ongoing promo line
//         still being added to as of the 2025 event dates in the source
//         text, so re-running this importer later is expected to find MORE
//         cards, not a fixed final count.
//
// Field layout (verified against every entry in the raw capture, not
// guessed from one example — this project has been burned twice already by
// building a parser off partial/summarized wikitext, see cnGemPackImport.ts
// header):
//
//   Pokemon/Trainer:
//     {{卡牌列表/entryjp|NNN/CODE|{{C|NAME|ORIGIN}}|TYPE||||SOURCE|ICON}}
//     {{卡牌列表/entryjp|NNN/CODE|{{TCG|NAME}}|CATEGORY||||SOURCE|ICON}}
//   Energy (drops 2 fields, same quirk documented in cnGemPackImport.ts):
//     {{卡牌列表/entryjp|NNN/CODE|{{TCG|NAME}}|能量卡|ENERGY-TYPE|SOURCE|ICON}}
//
// TYPE/CATEGORY at field index 2 distinguishes the two shapes — "能量卡"
// (Energy) routes to the 6-field parse, anything else routes to the 8-field
// parse. The ICON field (last) is frequently omitted entirely rather than
// left blank, so field count is 7 or 8 for Pokemon/Trainer, 5 or 6 for
// Energy — never assume a fixed length, search from the correct end.
//
// Unnumbered ("没有编号") entries have a synthetic/non-card value in the
// number field instead of a real "NNN/CODE" — literally "SM-P"/"SV-P" for
// most, but SV-P's 8 basic-energy trophy cards reuse 3-letter codes
// (GRA/FIG/WAT/LIG/PSY/DAR/MET) as a pseudo-number, and "FIG" is used for
// BOTH a Fire and a Fighting energy card (a genuine wiki inconsistency, not
// a parsing bug here) — so that field can't be trusted as a stable id for
// this section. Given synthetic ids instead, "U01", "U02", ... in the
// article's own top-to-bottom order, honestly documented as
// source-order-derived rather than a real printed number (same honesty
// tradeoff cnGemPackImport.ts already made for its pack-slot card_number).
//
// IMPORTANT BRACKET-NESTING FIX vs cnGemPackImport.ts's splitTopLevelFields:
// this data contains internal wikilinks with a pipe-separated display text,
// e.g. [[WCS2024|2024宝可梦世界锦标赛]] and [[File:X.png|18px]] — a plain
// {{ }}-depth-only splitter (as Gem Packs used, since Gem Pack fields never
// contained one) would incorrectly treat that pipe as a field separator and
// shift every field after it. The splitter below also tracks [[ / ]] depth
// for exactly this reason. Single-bracket external links ([http://url text]
// — space-separated, not pipe-separated) don't need this and are untouched.
//
// No rarity data exists in this template (no {{RarityCBB|...}} or
// equivalent field the way Gem Packs have) — rarity ships null, not
// guessed. No per-card image source is exposed on these pages either (the
// only <gallery> sections are wave/pack graphics, not per-card images,
// unlike Gem Packs' confirmed {CODE}{pack}{slot}.png convention) — image_url
// ships null for every row. national_dex_no ships null, same precedent as
// Gem Packs (would need a further per-card wiki fetch to resolve from the
// {{C|NAME|ORIGIN}} template's ORIGIN reference, not attempted here).

import { fetchFullContent, sleep } from "./cnReprintImport";
import type { CardRow } from "./cnReprintImport";

export interface BlackStarPromoDef {
  setId: "SM-P" | "S-P" | "SV-P" | "M-P";
  pageTitle: string;
}

// Confirmed live 2026-08-22 via the raw wikitext capture — these are the
// zh-cn-specific article titles (hyphenated "SM-P"/"SV-P", NOT the
// unhyphenated "SMP"/"SVP" that round 4 wrongly checked). S-P and M-P
// added in round 7, found via SM-P/SV-P's own {{ExpansionPrevNext|...}}
// navigation template (prev/next sibling links), not from any search — the
// real sequence is SM-P → S-P → SV-P → M-P, matching the Sun&Moon → Sword
// &Shield → Scarlet&Violet → (newest generation) progression. S-P is a
// real, large line (250 cards) — confirmed byte-for-byte the same as
// SM-P/SV-P. M-P is real but tiny so far (1 card) — the newest generation's
// promo line has barely started as of this capture, expected to grow.
export const BLACK_STAR_PROMO_SETS: BlackStarPromoDef[] = [
  { setId: "SM-P", pageTitle: "SM-P简体中文版特典卡（TCG）" },
  { setId: "S-P", pageTitle: "S-P简体中文版特典卡（TCG）" },
  { setId: "SV-P", pageTitle: "SV-P简体中文版特典卡（TCG）" },
  { setId: "M-P", pageTitle: "M-P简体中文版特典卡（TCG）" },
];

const ENTRY_MARKER = "{{卡牌列表/entryjp|";

// Same brace-depth block finder as cnGemPackImport.ts — this part of the
// template shape didn't change, only the fields inside each block did.
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

// Splits on "|" at depth 0 only — tracking BOTH {{ }} template nesting
// (like cnGemPackImport.ts) AND [[ ]] wikilink nesting (new here — see file
// header for why this data needs it and Gem Pack's didn't).
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

// {{C|NAME|ORIGIN}} (Pokémon) or {{TCG|NAME}} (Trainer/Item/Energy).
function extractName(field: string): string | null {
  const m = field.match(/^\{\{(?:C|TCG)\|([^|}]+)/);
  return m ? m[1].trim() : null;
}

export interface BlackStarPromoEntry {
  numbered: boolean;
  cardNumber: string; // "001".."434" if numbered, "U01".."UNN" if not
  rawNumberField: string; // the raw field[0] value, kept for diagnostics
  name: string;
  category: string; // type char (草/火/...) or category text (物品卡/支援者卡/...) or "能量卡"
}

export function countRawEntryLines(fullText: string): number {
  const matches = fullText.match(/\{\{卡牌列表\/entryjp\|/g);
  return matches ? matches.length : 0;
}

export function parseBlackStarPromoEntries(fullText: string): BlackStarPromoEntry[] {
  const entries: BlackStarPromoEntry[] = [];
  let unnumberedCounter = 0;
  // Tracks how many times each numbered card_number has been seen so far,
  // so a legitimate collision (see below) gets auto-disambiguated instead
  // of silently colliding at the DB upsert stage.
  const numberSeenCount = new Map<string, number>();

  for (const inner of findEntryBlocks(fullText)) {
    const fields = splitTopLevelFields(inner);
    if (fields.length < 3) continue;

    const name = extractName(fields[1]);
    if (!name) continue;

    const category = fields[2].trim();
    // Generic "NNN/CODE" match — CODE varies by set (a literal promo-line
    // code like "SM-P"/"S-P"/"SV-P" for promo lines, or a numeric total
    // like "342" for starter decks) — not hardcoded to specific sets, since
    // this function is shared across both. A bare non-slash value (a
    // literal "SM-P", or "-" as some starter-deck energy cards use) falls
    // through to the unnumbered branch correctly either way.
    const numMatch = fields[0].trim().match(/^(\d+)\/([A-Za-z0-9-]+)$/);

    if (numMatch) {
      const baseNumber = numMatch[1];
      // REAL, CONFIRMED case (not hypothetical): S-P's raw wikitext has the
      // same printed number covering two distinct physical prints — e.g.
      // 066/S-P appears once plain and once with a holo marker. Both are
      // real, separate cards; letting them collide at the same id would
      // silently drop one. Auto-disambiguate on repeat rather than warn
      // and lose data — "066" for the first occurrence, "066-2" for the
      // second, etc., traceable back to the real printed number either way.
      const seenCount = (numberSeenCount.get(baseNumber) ?? 0) + 1;
      numberSeenCount.set(baseNumber, seenCount);
      const cardNumber = seenCount === 1 ? baseNumber : `${baseNumber}-${seenCount}`;

      entries.push({
        numbered: true,
        cardNumber,
        rawNumberField: fields[0].trim(),
        name,
        category,
      });
    } else {
      unnumberedCounter++;
      entries.push({
        numbered: false,
        cardNumber: `U${String(unnumberedCounter).padStart(2, "0")}`,
        rawNumberField: fields[0].trim(),
        name,
        category,
      });
    }
  }

  return entries;
}

export interface BlackStarPromoResult {
  setId: string;
  setName: string;
  found: boolean;
  rawEntryLines: number;
  parsedEntries: number;
  duplicateNumbers: string[];
  rows: CardRow[];
}

export async function scoutBlackStarPromoSet(def: BlackStarPromoDef): Promise<BlackStarPromoResult> {
  const content = await fetchFullContent([def.pageTitle]);
  const text = content.get(def.pageTitle);
  const setName = `${def.setId}特典卡`;

  if (!text) {
    return {
      setId: def.setId,
      setName,
      found: false,
      rawEntryLines: 0,
      parsedEntries: 0,
      duplicateNumbers: [],
      rows: [],
    };
  }

  const rawEntryLines = countRawEntryLines(text);
  const entries = parseBlackStarPromoEntries(text);

  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.cardNumber, (seen.get(e.cardNumber) ?? 0) + 1);
  const duplicateNumbers = Array.from(seen.entries())
    .filter(([, count]) => count > 1)
    .map(([num]) => num);

  const rows: CardRow[] = entries.map((e) => ({
    id: `${def.setId}-${e.cardNumber}`,
    language: "zh-cn",
    set_id: def.setId,
    set_name: setName,
    card_number: e.cardNumber,
    name: e.name,
    national_dex_no: null,
    rarity: null,
    image_url: null,
    synced_at: new Date().toISOString(),
  }));

  return {
    setId: def.setId,
    setName,
    found: true,
    rawEntryLines,
    parsedEntries: entries.length,
    duplicateNumbers,
    rows,
  };
}

export async function scoutAllBlackStarPromoSets(): Promise<BlackStarPromoResult[]> {
  const results: BlackStarPromoResult[] = [];
  for (let i = 0; i < BLACK_STAR_PROMO_SETS.length; i++) {
    results.push(await scoutBlackStarPromoSet(BLACK_STAR_PROMO_SETS[i]));
    if (i < BLACK_STAR_PROMO_SETS.length - 1) await sleep(1500);
  }
  return results;
}
