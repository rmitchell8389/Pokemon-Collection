// Importer for "嗨皮组合" (Happy Set) — CSVH1C-CSVH5C in this project's
// internal code scheme. Round 8 said this needed no new code, just a re-run
// of the existing per-card cnicon= reprint importer — that was WRONG. Ross
// ran it live: CSVH4C stayed at 3 cards (unchanged), CSVH5C found 0. The
// per-card search mechanism only catches stray individual-page references,
// not the real lists. See claude/spec.md "zh-cn round 9" for the full
// correction writeup.
//
// Each of the 5 Happy Set articles (one per numbered wave, each named after
// its 4 headline Pokemon, e.g. "嗨皮组合 皮卡丘&皮皮&草苗龟&索财灵（TCG）")
// documents up to THREE separate card pools, each its own POS/TOTAL
// numbering namespace that restarts from 001:
//   ===卡组===     the 4 starter decks themselves, using a template NEVER
//                  before parsed in this project: {{主题牌组列表/entry|...}}
//                  (same template CSVM2's container article uses — see
//                  cnStarterDeckImport.ts's header for why CSVM2 itself was
//                  deferred; Happy Set gave us real, complete sample data to
//                  actually build this against instead of guessing).
//   ===改造包===   the "rebuild pack" booster, using {{卡牌列表/entry|...}}
//                  — note: NOT {{卡牌列表/entryjp|...}}, the "jp" suffix is
//                  missing. A different marker string from every other
//                  importer in this project, confirmed byte-for-byte in the
//                  raw capture, not assumed from the similar name.
//   ===奖赏包===   the "reward pack" booster, same {{卡牌列表/entry|...}}
//                  marker as 改造包.
//   ===嗨皮包===   present in the wikitext but empty in every article
//                  checked (header/footer only, zero entries) — packs
//                  reward cards already counted in the pools above.
//                  Deliberately not processed; would find nothing anyway.
//
// Field shape for BOTH markers matches what cnStarterDeckImport.ts already
// found for GX起始卡组 (POS/TOTAL, name template, category, blank-or-energy-
// type, rarity — usually empty here rather than the "—" em-dash starter
// decks use, handled the same way either way). The 主题牌组列表/entry shape
// additionally carries a deck-quantity count and an optional holo marker at
// the same field positions where rarity sits for the other marker — neither
// is captured here, this importer only needs card identity for a have/
// don't-have catalog, not deck-construction quantities.
//
// THE REAL COMPLICATION, confirmed from real data, not guessed: within
// ===卡组=== specifically, some cards are listed TWICE — once in the main
// per-sub-deck list, and again in a "box variant" appendix carrying a
// circled-number annotation (①②③... ⑱～㉓ etc.) as a trailing extra field.
// Checked every repeat in the captured data: when the same POS number
// appears twice, the name always matches (confirmed across CSVH1C's
// duplicated entries) — these are the same physical card documented twice
// for a different purpose (pull-order reference), not two prints. One
// exception found: CSVH1C's card 014 (雷电云) appears ONLY in the appendix,
// never in the main list — so the appendix can't just be ignored either, it
// sometimes carries a card the main list omits.
//
// Handled with a real dedup pass, not a blind "first wins" or "always
// append": entries are grouped by POS within each pool. A repeat with the
// SAME name is silently deduped (one catalog row, not two). A repeat with a
// DIFFERENT name at the same POS — never observed in this data, but a real
// possibility in principle — falls back to the same auto-disambiguation
// safety net used everywhere else in this project (append "-2", "-3", ...)
// rather than silently colliding.
//
// Cross-pool collisions are real and expected — 卡组/改造包/奖赏包 each
// restart their own POS numbering from 001, so "001" appears once per pool,
// not once per article. card_number is prefixed by pool ("DECK-001",
// "REBUILD-001", "REWARD-001") so these never collide at the DB id level.
//
// Coverage is genuinely uneven across the 5 articles, confirmed from the
// real capture, not padded to look consistent:
//   CSVH1C — full 卡组 (59) + 改造包 (23) + 奖赏包 (14, incl. 8 energies)
//   CSVH2C — 改造包 (23) only; no 卡组 or 奖赏包 entries documented yet
//   CSVH3C — full 卡组 only; no 改造包/奖赏包 entries documented yet
//   CSVH4C — 改造包 (23) + 奖赏包 (14); no 卡组 entries documented yet
//   CSVH5C — nothing at all yet (empty shell article, released 2026-07-16,
//            about 5 weeks before this capture — same recency pattern as
//            CSVM2's incompleteness)
// Ships exactly what's documented per set, honestly — no padding to a
// guessed final total.
//
// rarity/image_url/national_dex_no ship null, same precedent as every
// other zh-cn bulk-table importer in this project — no rarity template and
// no per-card image convention exist in this data.

import { fetchFullContent, sleep } from "./cnReprintImport";
import type { CardRow } from "./cnReprintImport";

export interface HappySetDef {
  setId: string; // CSVH1C .. CSVH5C
  pageTitle: string;
}

// Confirmed live 2026-08-22 via data/wiki-raw/happyset-round4-raw.txt — each
// title's real CSVH code cross-checked against its own {{快捷方式|CSVH|...}}
// shortcut template and its infobox's `alt=` field, not guessed from title
// order.
export const HAPPY_SET_SETS: HappySetDef[] = [
  { setId: "CSVH1C", pageTitle: "嗨皮组合 皮卡丘&皮皮&草苗龟&索财灵（TCG）" },
  { setId: "CSVH2C", pageTitle: "嗨皮组合 路卡利欧&甲贺忍蛙&藏玛然特&獒教父（TCG）" },
  { setId: "CSVH3C", pageTitle: "嗨皮组合 七夕青鸟&拉帝欧斯&烈焰猴&一家鼠（TCG）" },
  { setId: "CSVH4C", pageTitle: "嗨皮组合 狙射树枭&美录梅塔&故勒顿&密勒顿（TCG）" },
  { setId: "CSVH5C", pageTitle: "嗨皮组合 快龙&超梦&喷火驼&来悲粗茶（TCG）" },
];

// The 3 pools worth extracting, and the prefix each gets in card_number.
// Anything else (嗨皮包, or any other heading) is deliberately skipped.
const POOL_PREFIX: Record<string, string> = {
  卡组: "DECK",
  改造包: "REBUILD",
  奖赏包: "REWARD",
};

const MARKERS = ["{{卡牌列表/entry|", "{{主题牌组列表/entry|"];

// Same brace-depth block finder used throughout this project's cn*Import.ts
// files, parameterized on the marker string since this file needs two.
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
    const inner = text.slice(start + marker.length, p - 2);
    blocks.push(inner);
    searchFrom = p;
  }
  return blocks;
}

// Same [[ ]]-aware + {{ }}-aware splitter as cnBlackStarPromoImport.ts /
// cnStarterDeckImport.ts.
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

// Splits a full page into its "===Heading===" chunks (level-3), bounded by
// the next level-2-or-3 heading. Only chunks matching POOL_PREFIX are worth
// keeping; everything else (intro prose, ==图册==, ==细节==, etc.) is noise
// this importer doesn't need.
function findPoolSections(text: string): { name: string; body: string }[] {
  const headingRe = /^(={2,3})([^=\n]+?)\1\s*$/gm;
  const marks: { level: number; name: string; start: number; headerEnd: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text))) {
    marks.push({ level: m[1].length, name: m[2].trim(), start: m.index, headerEnd: m.index + m[0].length });
  }
  const sections: { name: string; body: string }[] = [];
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].level !== 3) continue;
    const bodyStart = marks[i].headerEnd;
    const bodyEnd = i + 1 < marks.length ? marks[i + 1].start : text.length;
    sections.push({ name: marks[i].name, body: text.slice(bodyStart, bodyEnd) });
  }
  return sections;
}

export interface HappySetEntry {
  cardNumber: string; // pool-prefixed, e.g. "DECK-001", "REBUILD-001-2"
  name: string;
  category: string;
  pool: string;
}

interface DedupRecord {
  name: string;
  category: string;
  cardNumber: string;
  seenCount: number;
}

// Extracts + dedups entries from one pool's raw text (both markers tried;
// only one will ever actually match given the real data, but trying both is
// harmless and avoids hardcoding which marker belongs to which pool name).
function extractPoolEntries(poolName: string, body: string): HappySetEntry[] {
  const prefix = POOL_PREFIX[poolName];
  if (!prefix) return [];

  const rawBlocks = MARKERS.flatMap((marker) => findEntryBlocks(body, marker));
  const dedup = new Map<string, DedupRecord>();
  let unnumberedCounter = 0;

  for (const inner of rawBlocks) {
    const fields = splitTopLevelFields(inner);
    if (fields.length < 3) continue;

    const name = extractName(fields[1]);
    if (!name) continue;
    const category = fields[2].trim();

    const posMatch = fields[0].trim().match(/^(\d+)\/(\d+)$/);

    if (posMatch) {
      const pos = posMatch[1];
      const key = `N:${pos}`;
      const existing = dedup.get(key);
      if (!existing) {
        dedup.set(key, { name, category, cardNumber: pos, seenCount: 1 });
      } else if (existing.name === name) {
        // Same card re-listed (box-variant/pull-order appendix) — not a new row.
        continue;
      } else {
        // Real collision: a different card at the same POS. Auto-disambiguate
        // rather than silently overwrite, same safety net used everywhere
        // else in this project.
        existing.seenCount += 1;
        dedup.set(`${key}#${existing.seenCount}`, {
          name,
          category,
          cardNumber: `${pos}-${existing.seenCount}`,
          seenCount: existing.seenCount,
        });
      }
    } else {
      const key = `U:${name}`;
      if (dedup.has(key)) continue; // same unnumbered card (usually basic energy) re-listed
      unnumberedCounter++;
      dedup.set(key, {
        name,
        category,
        cardNumber: `U${String(unnumberedCounter).padStart(2, "0")}`,
        seenCount: 1,
      });
    }
  }

  return Array.from(dedup.values()).map((r) => ({
    cardNumber: `${prefix}-${r.cardNumber}`,
    name: r.name,
    category: r.category,
    pool: poolName,
  }));
}

export interface HappySetResult {
  setId: string;
  setName: string;
  found: boolean;
  rawEntryLines: number; // includes intentional repeat listings — expected to exceed parsedEntries
  parsedEntries: number; // after dedup — the real unique-card count
  poolsCovered: string[]; // which of 卡组/改造包/奖赏包 actually had content
  rows: CardRow[];
}

export async function scoutHappySetSet(def: HappySetDef): Promise<HappySetResult> {
  const content = await fetchFullContent([def.pageTitle]);
  const text = content.get(def.pageTitle);
  const setName = def.pageTitle.replace(/（[^（）]*）$/, "").trim();

  if (!text) {
    return { setId: def.setId, setName, found: false, rawEntryLines: 0, parsedEntries: 0, poolsCovered: [], rows: [] };
  }

  const rawEntryLines = MARKERS.reduce((sum, marker) => sum + findEntryBlocks(text, marker).length, 0);

  const sections = findPoolSections(text);
  const allEntries: HappySetEntry[] = [];
  const poolsCovered = new Set<string>();
  for (const section of sections) {
    if (!POOL_PREFIX[section.name]) continue;
    const entries = extractPoolEntries(section.name, section.body);
    if (entries.length > 0) poolsCovered.add(section.name);
    allEntries.push(...entries);
  }

  const rows: CardRow[] = allEntries.map((e) => ({
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
    parsedEntries: allEntries.length,
    poolsCovered: Array.from(poolsCovered),
    rows,
  };
}

export async function scoutAllHappySets(): Promise<HappySetResult[]> {
  const results: HappySetResult[] = [];
  for (let i = 0; i < HAPPY_SET_SETS.length; i++) {
    results.push(await scoutHappySetSet(HAPPY_SET_SETS[i]));
    if (i < HAPPY_SET_SETS.length - 1) await sleep(1500);
  }
  return results;
}
