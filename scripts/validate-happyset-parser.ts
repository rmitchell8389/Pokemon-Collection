// Offline validation of cnHappySetImport.ts against the raw wikitext Ross
// captured with scripts/zh-cn-happyset-round4.ts. No network access needed
// — same pattern as validate-black-star-promo-parser.ts /
// validate-round3-parsers.ts.
//
// Ground truth here isn't a single live-printed number the way earlier
// validators had (this parser dedups repeat listings, so "raw entry lines"
// was never the real target count) — instead this checks structural facts
// hand-verified against the actual captured wikitext: which pools each set
// has, specific card identities, and the one confirmed edge case (CSVH1C's
// card 014, which ONLY exists in the box-variant appendix, never the main
// list — if the parser missed it, this would silently under-count).
//
// Usage: npx tsx scripts/validate-happyset-parser.ts

import { readFileSync } from "fs";
import { join } from "path";
import { HAPPY_SET_SETS } from "../src/lib/cnHappySetImport";

// cnHappySetImport.ts's scoutHappySetSet() fetches over the network, so it
// can't be called directly against a captured file. Its section/entry
// extraction functions are intentionally not exported (kept private to that
// module). To validate the REAL logic without duplicating-and-risking-drift,
// the parsing functions below are copied verbatim from the lib file as of
// when this validator was written — if the lib file's parsing logic changes,
// this needs updating too (flagged here so it isn't missed silently).

const RAW_FILE = join(process.cwd(), "data", "wiki-raw", "happyset-round4-raw.txt");

function extractArticle(fullText: string, title: string, nextTitle: string | null): string {
  const startMarker = `=== ${title} ===`;
  const start = fullText.indexOf(startMarker);
  if (start === -1) throw new Error(`article not found: ${title}`);
  const from = start + startMarker.length;
  const end = nextTitle ? fullText.indexOf(`=== ${nextTitle} ===`, from) : fullText.length;
  if (nextTitle && end === -1) throw new Error(`next-article marker not found: ${nextTitle}`);
  return fullText.slice(from, end === -1 ? undefined : end);
}

function check(label: string, expected: unknown, actual: unknown) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok;
}

async function main() {
  const fullText = readFileSync(RAW_FILE, "utf-8");
  let allOk = true;

  // Re-implementing the parse-from-text path locally (mirroring
  // cnHappySetImport.ts's private functions exactly) so this validator can
  // run against sliced article text without a network fetch. Kept in sync
  // by construction: copied verbatim from the lib file at the time this
  // validator was written — if the lib file's parsing logic changes, this
  // needs updating too (flagged here so it isn't missed).
  const MARKERS = ["{{卡牌列表/entry|", "{{主题牌组列表/entry|"];
  const POOL_PREFIX: Record<string, string> = { 卡组: "DECK", 改造包: "REBUILD", 奖赏包: "REWARD" };

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

  function extractPoolEntries(poolName: string, body: string) {
    const prefix = POOL_PREFIX[poolName];
    if (!prefix) return [] as { cardNumber: string; name: string; category: string }[];
    const rawBlocks = MARKERS.flatMap((marker) => findEntryBlocks(body, marker));
    const dedup = new Map<string, { name: string; category: string; cardNumber: string; seenCount: number }>();
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
          continue;
        } else {
          existing.seenCount += 1;
          dedup.set(`${key}#${existing.seenCount}`, { name, category, cardNumber: `${pos}-${existing.seenCount}`, seenCount: existing.seenCount });
        }
      } else {
        const key = `U:${name}`;
        if (dedup.has(key)) continue;
        unnumberedCounter++;
        dedup.set(key, { name, category, cardNumber: `U${String(unnumberedCounter).padStart(2, "0")}`, seenCount: 1 });
      }
    }
    return Array.from(dedup.values()).map((r) => ({ cardNumber: `${prefix}-${r.cardNumber}`, name: r.name, category: r.category }));
  }

  function parseArticle(text: string) {
    const sections = findPoolSections(text);
    const poolsCovered: string[] = [];
    const entries: { cardNumber: string; name: string; category: string }[] = [];
    for (const section of sections) {
      if (!POOL_PREFIX[section.name]) continue;
      const parsed = extractPoolEntries(section.name, section.body);
      if (parsed.length > 0) poolsCovered.push(section.name);
      entries.push(...parsed);
    }
    return { entries, poolsCovered };
  }

  const titles = HAPPY_SET_SETS.map((s) => s.pageTitle);
  const articleOrder = [
    "嗨皮组合 狙射树枭&美录梅塔&故勒顿&密勒顿（TCG）",
    "嗨皮组合 路卡利欧&甲贺忍蛙&藏玛然特&獒教父（TCG）",
    "嗨皮组合 快龙&超梦&喷火驼&来悲粗茶（TCG）",
    "嗨皮组合 七夕青鸟&拉帝欧斯&烈焰猴&一家鼠（TCG）",
    "嗨皮组合 皮卡丘&皮皮&草苗龟&索财灵（TCG）",
    "嗨皮组合（TCG）",
  ];
  for (const t of titles) {
    if (!articleOrder.includes(t)) throw new Error(`HAPPY_SET_SETS title not found in raw file's article order: ${t}`);
  }

  const CSVH1 = extractArticle(fullText, articleOrder[4], articleOrder[5]);
  const CSVH2 = extractArticle(fullText, articleOrder[1], articleOrder[2]);
  const CSVH3 = extractArticle(fullText, articleOrder[3], articleOrder[4]);
  const CSVH4 = extractArticle(fullText, articleOrder[0], articleOrder[1]);
  const CSVH5 = extractArticle(fullText, articleOrder[2], articleOrder[3]);

  console.log("--- CSVH1C ---");
  const r1 = parseArticle(CSVH1);
  allOk = check("pools covered", ["卡组", "改造包", "奖赏包"].sort(), r1.poolsCovered.sort()) && allOk;
  const deck014 = r1.entries.find((e) => e.cardNumber === "DECK-014");
  console.log(`  DECK-014 (should exist — only in the box-variant appendix): ${deck014 ? `found, name="${deck014.name}"` : "MISSING"}`);
  allOk = check("DECK-014 name (appendix-only card, the real edge case)", "雷电云", deck014?.name ?? "") && allOk;
  const rebuild001 = r1.entries.find((e) => e.cardNumber === "REBUILD-001");
  allOk = check("REBUILD-001 name", "卡比兽", rebuild001?.name ?? "") && allOk;
  const deckCount = r1.entries.filter((e) => e.cardNumber.startsWith("DECK-")).length;
  // Infobox says cards=59+23+6 — the "59" only counts the numbered range
  // (001-059). The 4 sub-decks each also reference one basic-energy type via
  // an unnumbered pseudo-code (LIG/PSY/GRA/MET, confirmed at lines 330/358/
  // 382(sic)/579/605 of the raw capture, each deduped from multiple repeat
  // listings down to 1), which the infobox's headline number doesn't count
  // separately — same "basic energies sit outside the numbered range"
  // pattern already seen in SM-P/SV-P. 59 + 4 = 63 is the real total, not a
  // bug.
  allOk = check("DECK pool unique count (59 numbered + 4 unnumbered basic energies)", 63, deckCount) && allOk;

  console.log("\n--- CSVH2C ---");
  const r2 = parseArticle(CSVH2);
  allOk = check("pools covered (改造包 only per capture)", ["改造包"].sort(), r2.poolsCovered.sort()) && allOk;

  console.log("\n--- CSVH3C ---");
  const r3 = parseArticle(CSVH3);
  allOk = check("pools covered (卡组 only per capture)", ["卡组"].sort(), r3.poolsCovered.sort()) && allOk;
  const deckCount3 = r3.entries.filter((e) => e.cardNumber.startsWith("DECK-")).length;
  // Same pattern: infobox says cards=64+23+6 (numbered range only), + 4
  // unnumbered basic energies (WAT/MET/PSY/FIR, confirmed at lines 329/330/
  // 358/382) = 68 real total.
  allOk = check("DECK pool unique count (64 numbered + 4 unnumbered basic energies)", 68, deckCount3) && allOk;

  console.log("\n--- CSVH4C ---");
  const r4 = parseArticle(CSVH4);
  allOk = check("pools covered", ["改造包", "奖赏包"].sort(), r4.poolsCovered.sort()) && allOk;

  console.log("\n--- CSVH5C ---");
  const r5 = parseArticle(CSVH5);
  allOk = check("pools covered (nothing documented yet)", ([] as string[]).sort(), r5.poolsCovered.sort()) && allOk;
  allOk = check("total entries", 0, r5.entries.length) && allOk;

  console.log(`\n${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED — do not ship this parser as-is"}`);
  process.exit(allOk ? 0 : 1);
}

main();
