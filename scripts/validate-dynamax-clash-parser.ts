// Offline validation of cnBoosterSetImport.ts against the raw wikitext Ross
// captured with scripts/zh-cn-dynamax-clash-round13.ts. No network access
// needed — same pattern as every other validate-*.ts script in this
// project. Imports the REAL exported parser functions directly (countRawEntryLines,
// parseBoosterSetEntries) rather than duplicating them, since this is the
// first zh-cn importer where those happen to be exported already.
//
// Ground truth: the captured file's own per-section bracket summary lines
// (e.g. "[USES: {{卡牌列表/entryjp|...}} x217]") are diagnostic output THIS
// SESSION printed, not part of the wiki page — and each one contains a
// literal example occurrence of the marker substring it's describing,
// which inflates a naive regex count by exactly 1 per section if left in.
// Same bug validate-round3-parsers.ts hit and fixed — fixed the same way
// here (strip bracket-wrapped "[...]" lines before handing the text to the
// real parser functions).
//
// Usage: npx tsx scripts/validate-dynamax-clash-parser.ts

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { countRawEntryLines, parseBoosterSetEntries } from "../src/lib/cnBoosterSetImport";

const RAW_FILE = join(process.cwd(), "data", "wiki-raw", "dynamax-clash-round13-raw.txt");
const RAW_FILE_CS2 = join(process.cwd(), "data", "wiki-raw", "vivid-portrayals-round14-raw.txt");
const RAW_FILE_CS25 = join(process.cwd(), "data", "wiki-raw", "brilliant-counterattack-round15-raw.txt");
const RAW_FILE_CS3 = join(process.cwd(), "data", "wiki-raw", "primordial-arts-round16-raw.txt");
const RAW_FILE_CS4 = join(process.cwd(), "data", "wiki-raw", "nine-colors-gathering-round18-raw.txt");
const RAW_FILE_CS5 = join(process.cwd(), "data", "wiki-raw", "gallant-galaxy-round19-raw.txt");
const RAW_FILE_CS6 = join(process.cwd(), "data", "wiki-raw", "shadow-blue-sea-round20-raw.txt");
const RAW_FILE_CS65 = join(process.cwd(), "data", "wiki-raw", "victory-lodestar-round21-raw.txt");
const RAW_FILE_CSV1 = join(process.cwd(), "data", "wiki-raw", "ancient-times-future-progress-round22-raw.txt");
const RAW_FILE_CSV2 = join(process.cwd(), "data", "wiki-raw", "miracle-journey-round23-raw.txt");
const RAW_FILE_CSV3 = join(process.cwd(), "data", "wiki-raw", "fearless-terastal-round24-raw.txt");
const RAW_FILE_CSV4 = join(process.cwd(), "data", "wiki-raw", "bonus-round-round25-raw.txt");
const RAW_FILE_CSV5 = join(process.cwd(), "data", "wiki-raw", "ardent-obsidian-round26-raw.txt");
const RAW_FILE_CSV6 = join(process.cwd(), "data", "wiki-raw", "arcane-truth-round27-raw.txt");
const RAW_FILE_CSV7 = join(process.cwd(), "data", "wiki-raw", "blade-awakening-round28-raw.txt");
const RAW_FILE_CSV8 = join(process.cwd(), "data", "wiki-raw", "sparkling-fable-round29-raw.txt");
const RAW_FILE_CSV9 = join(process.cwd(), "data", "wiki-raw", "stellar-crystal-round30-raw.txt");
const RAW_FILE_CSV95 = join(process.cwd(), "data", "wiki-raw", "terastal-gathering-round31-raw.txt");
const RAW_FILE_CSV10 = join(process.cwd(), "data", "wiki-raw", "together-in-pursuit-of-glory-round32-raw.txt");
const RAW_FILE_CSM36 = join(process.cwd(), "data", "wiki-raw", "round36-raw.txt");

function extractArticle(fullText: string, title: string, nextTitle: string | null): string {
  const startMarker = `=== ${title} ===`;
  const start = fullText.indexOf(startMarker);
  if (start === -1) throw new Error(`article not found: ${title}`);
  const from = start + startMarker.length;
  const end = nextTitle ? fullText.indexOf(`=== ${nextTitle} ===`, from) : fullText.length;
  if (nextTitle && end === -1) throw new Error(`next-article marker not found: ${nextTitle}`);
  const raw = fullText.slice(from, end === -1 ? undefined : end);
  // Strip this session's own diagnostic "[...]" summary lines — see header.
  return raw.split("\n").filter((line) => !/^\[.*\]$/.test(line.trim())).join("\n");
}

function check(label: string, expected: unknown, actual: unknown) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok;
}

async function main() {
  let allOk = true;

  // Rounds 13-16's raw wiki captures (CS1, CS2, CS2.5C, CS3 lines) are
  // referenced by this script but do NOT actually exist on disk — confirmed
  // 2026-09-18 when Ross ran this script for the first time in a while and
  // it crashed immediately on the very first readFileSync (round13's file
  // missing). These are the earliest captures in the whole 36-round effort
  // and were apparently never saved (or lost before the "always save the
  // raw capture" discipline was firmly established around round 18 onward
  // — every round 18+ file IS present). This is a real, previously-unknown
  // gap in this project's provenance trail, not a guess or a parser bug:
  // those 5 sets (CS1aC, CS1DC, CSAC, CS1.5C, CS2aC, CS2bC, CS2.5C, CS3aC,
  // CS3bC, CS3DC) are already committed live in the database from their
  // original real import runs — they just can't be re-validated offline
  // here without their raw capture on disk. Guarding each block on
  // existsSync so a missing early file no longer takes down validation of
  // every later round (including this round's new CSM checks) — this is a
  // resilience fix, not a guess about what the missing files would contain.
  if (existsSync(RAW_FILE)) {
    const fullText = readFileSync(RAW_FILE, "utf-8");

    // Article order in the raw file, using the LITERAL titles the round-13
    // scout script printed as section headers — including "极巨争锋 炎（TCG）",
    // the wrong guessed title for CS1bC that 404'd (the raw file's boundary
    // marker is whatever the script actually searched for, not the corrected
    // title found afterward).
    const order = [
      "极巨争锋 雷（TCG）", // CS1aC
      "极巨争锋 炎（TCG）", // CS1bC guess — 404'd, page not found in the capture
      "V起始卡组 极巨争锋（TCG）", // CS1DC
      "极巨争锋 卡组构筑礼盒（TCG）", // CSAC
      "极巨攻防（TCG）", // CS1.5C
    ];

    console.log("--- CS1aC (极巨争锋 雷) ---");
    const cs1a = extractArticle(fullText, order[0], order[1]);
    const cs1aRaw = countRawEntryLines(cs1a);
    const cs1aEntries = parseBoosterSetEntries(cs1a);
    allOk = check("raw entry lines", 217, cs1aRaw) && allOk;
    allOk = check("parsed (unique) entries", 217, cs1aEntries.length) && allOk;
    const dupes1a = cs1aEntries.filter((e) => e.cardNumber.includes("-"));
    allOk = check("duplicate-position pairs found", 0, dupes1a.length) && allOk;
    const card001 = cs1aEntries.find((e) => e.cardNumber === "001");
    allOk = check("card 001 name (强颚鸡母虫)", "强颚鸡母虫", card001?.name ?? "") && allOk;
    const card217 = cs1aEntries.find((e) => e.cardNumber === "217");
    allOk = check("card 217 name (训练场地, last card)", "训练场地", card217?.name ?? "") && allOk;
    const card217Rarity = card217?.rarity ?? null;
    allOk = check("card 217 rarity (UR)", "UR", card217Rarity) && allOk;

    console.log("\n--- CS1DC (V起始卡组 极巨争锋) — uses the non-jp {{卡牌列表/entry|...}} marker ---");
    const cs1dc = extractArticle(fullText, order[2], order[3]);
    const cs1dcRaw = countRawEntryLines(cs1dc);
    const cs1dcEntries = parseBoosterSetEntries(cs1dc);
    allOk = check("raw entry lines", 230, cs1dcRaw) && allOk;
    allOk = check("parsed (unique) entries", 230, cs1dcEntries.length) && allOk;
    // 8 unnumbered basic-energy cards use a literal "—" position field — real
    // edge case confirmed in the raw capture (lines 526-533).
    const unnumbered = cs1dcEntries.filter((e) => !e.numbered);
    allOk = check("unnumbered (basic energy) entries", 8, unnumbered.length) && allOk;
    const energySample = cs1dcEntries.find((e) => e.name === "基本恶能量");
    allOk = check("基本恶能量 found and unnumbered", true, !!energySample && !energySample.numbered) && allOk;

    console.log("\n--- CSAC (极巨争锋 卡组构筑礼盒) ---");
    const csac = extractArticle(fullText, order[3], order[4]);
    const csacRaw = countRawEntryLines(csac);
    const csacEntries = parseBoosterSetEntries(csac);
    allOk = check("raw entry lines", 24, csacRaw) && allOk;
    allOk = check("parsed (unique) entries — exact match to TCG Collector's target", 24, csacEntries.length) && allOk;

    console.log("\n--- CS1.5C (极巨攻防) ---");
    const cs15 = extractArticle(fullText, order[4], null);
    const cs15Raw = countRawEntryLines(cs15);
    const cs15Entries = parseBoosterSetEntries(cs15);
    allOk = check("raw entry lines", 96, cs15Raw) && allOk;
    allOk = check("parsed (unique) entries", 96, cs15Entries.length) && allOk;
  } else {
    console.log(`--- CS1aC/CS1DC/CSAC/CS1.5C SKIPPED — raw capture missing from disk: ${RAW_FILE} ---`);
    console.log("    (already committed live from round 13's original import run; just not re-validatable here)");
  }

  // Round 14 — CS2 line (Vivid Portrayals), separate raw capture.
  if (existsSync(RAW_FILE_CS2)) {
    const fullTextCs2 = readFileSync(RAW_FILE_CS2, "utf-8");
    const cs2Order = [
      "浓墨重彩 黎（TCG）", // CS2aC
      "浓墨重彩 靛（TCG）", // CS2bC
      "猫铃奇计（TCG）", // CS2.1C guess — 404'd
    ];

    console.log("\n--- CS2aC (浓墨重彩 黎) ---");
    const cs2a = extractArticle(fullTextCs2, cs2Order[0], cs2Order[1]);
    const cs2aRaw = countRawEntryLines(cs2a);
    const cs2aEntries = parseBoosterSetEntries(cs2a);
    allOk = check("raw entry lines", 143, cs2aRaw) && allOk;
    allOk = check("parsed (unique) entries", 143, cs2aEntries.length) && allOk;
    const cs2aFirst = cs2aEntries.find((e) => e.cardNumber === "001");
    allOk = check("card 001 name (独角虫)", "独角虫", cs2aFirst?.name ?? "") && allOk;
    const cs2aLast = cs2aEntries.find((e) => e.cardNumber === "143");
    allOk = check("card 143 name (坚韧斗篷, last card)", "坚韧斗篷", cs2aLast?.name ?? "") && allOk;

    console.log("\n--- CS2bC (浓墨重彩 靛) ---");
    const cs2b = extractArticle(fullTextCs2, cs2Order[1], cs2Order[2]);
    const cs2bRaw = countRawEntryLines(cs2b);
    const cs2bEntries = parseBoosterSetEntries(cs2b);
    allOk = check("raw entry lines", 143, cs2bRaw) && allOk;
    allOk = check("parsed (unique) entries", 143, cs2bEntries.length) && allOk;
    const cs2bFirst = cs2bEntries.find((e) => e.cardNumber === "001");
    allOk = check("card 001 name (伽勒尔 达摩狒狒)", "伽勒尔 达摩狒狒", cs2bFirst?.name ?? "") && allOk;
  } else {
    console.log(`\n--- CS2aC/CS2bC SKIPPED — raw capture missing from disk: ${RAW_FILE_CS2} ---`);
    console.log("    (already committed live from round 14's original import run; just not re-validatable here)");
  }

  // Round 15 — CS2.5C, separate raw capture.
  if (existsSync(RAW_FILE_CS25)) {
    const fullTextCs25 = readFileSync(RAW_FILE_CS25, "utf-8");
    console.log("\n--- CS2.5C (璀璨反击) ---");
    const cs25 = extractArticle(fullTextCs25, "璀璨反击（TCG）", null);
    const cs25Raw = countRawEntryLines(cs25);
    const cs25Entries = parseBoosterSetEntries(cs25);
    allOk = check("raw entry lines", 79, cs25Raw) && allOk;
    allOk = check("parsed (unique) entries", 79, cs25Entries.length) && allOk;
    const cs25First = cs25Entries.find((e) => e.cardNumber === "001");
    allOk = check("card 001 name (时拉比)", "时拉比", cs25First?.name ?? "") && allOk;
    const cs25Last = cs25Entries.find((e) => e.cardNumber === "079");
    allOk = check("card 079 name (回忆胶囊, last card)", "回忆胶囊", cs25Last?.name ?? "") && allOk;
  } else {
    console.log(`\n--- CS2.5C SKIPPED — raw capture missing from disk: ${RAW_FILE_CS25} ---`);
    console.log("    (already committed live from round 15's original import run; just not re-validatable here)");
  }

  // Round 16 — CS3 line (Primordial Arts), separate raw capture.
  if (existsSync(RAW_FILE_CS3)) {
    const fullTextCs3 = readFileSync(RAW_FILE_CS3, "utf-8");
    const cs3Order = [
      "洪荒演武 茂（TCG）", // CS3aC
      "洪荒演武 激（TCG）", // CS3bC
      "V起始卡组 洪荒演武（TCG）", // CS3DC
      "洪荒演武 卡组构筑礼盒（TCG）", // CSBC/CSCC guess — 404'd
    ];

    console.log("\n--- CS3aC (洪荒演武 茂) ---");
    const cs3a = extractArticle(fullTextCs3, cs3Order[0], cs3Order[1]);
    const cs3aRaw = countRawEntryLines(cs3a);
    const cs3aEntries = parseBoosterSetEntries(cs3a);
    allOk = check("raw entry lines", 184, cs3aRaw) && allOk;
    allOk = check("parsed (unique) entries", 184, cs3aEntries.length) && allOk;
    const cs3aFirst = cs3aEntries.find((e) => e.cardNumber === "001");
    allOk = check("card 001 name (妙蛙花V)", "妙蛙花V", cs3aFirst?.name ?? "") && allOk;
    const cs3aLast = cs3aEntries.find((e) => e.cardNumber === "184");
    allOk = check("card 184 name (一击能量, last card)", "一击能量", cs3aLast?.name ?? "") && allOk;
    const dupes3a = cs3aEntries.filter((e) => e.cardNumber.includes("-"));
    allOk = check("duplicate-position pairs found", 0, dupes3a.length) && allOk;

    console.log("\n--- CS3bC (洪荒演武 激) ---");
    const cs3b = extractArticle(fullTextCs3, cs3Order[1], cs3Order[2]);
    const cs3bRaw = countRawEntryLines(cs3b);
    const cs3bEntries = parseBoosterSetEntries(cs3b);
    allOk = check("raw entry lines", 177, cs3bRaw) && allOk;
    allOk = check("parsed (unique) entries", 177, cs3bEntries.length) && allOk;
    const cs3bFirst = cs3bEntries.find((e) => e.cardNumber === "001");
    allOk = check("card 001 name (樱花宝)", "樱花宝", cs3bFirst?.name ?? "") && allOk;
    const cs3bLast = cs3bEntries.find((e) => e.cardNumber === "177");
    allOk = check("card 177 name (等级球, last card)", "等级球", cs3bLast?.name ?? "") && allOk;

    console.log("\n--- CS3DC (V起始卡组 洪荒演武) — includes 3 wiki-source lines with a varying TOTAL field (166/070, 167/132, 168/190) ---");
    const cs3dc = extractArticle(fullTextCs3, cs3Order[2], cs3Order[3]);
    const cs3dcRaw = countRawEntryLines(cs3dc);
    const cs3dcEntries = parseBoosterSetEntries(cs3dc);
    allOk = check("raw entry lines", 191, cs3dcRaw) && allOk;
    allOk = check("parsed (unique) entries", 191, cs3dcEntries.length) && allOk;
    const cs3dcFirst = cs3dcEntries.find((e) => e.cardNumber === "001");
    allOk = check("card 001 name (芭瓢虫)", "芭瓢虫", cs3dcFirst?.name ?? "") && allOk;
    // The 3 varying-TOTAL lines — confirm the position regex still extracts
    // just the numerator correctly despite the odd denominator.
    const card166 = cs3dcEntries.find((e) => e.cardNumber === "166");
    allOk = check("card 166 name (一击能量, from the '166/070' line)", "一击能量", card166?.name ?? "") && allOk;
    const card167 = cs3dcEntries.find((e) => e.cardNumber === "167");
    allOk = check("card 167 name (极光能量, from the '167/132' line)", "极光能量", card167?.name ?? "") && allOk;
    const card168 = cs3dcEntries.find((e) => e.cardNumber === "168");
    allOk = check("card 168 name (捕獲能量, from the '168/190' line)", "捕獲能量", card168?.name ?? "") && allOk;
    const unnumbered3dc = cs3dcEntries.filter((e) => !e.numbered);
    allOk = check("unnumbered (basic energy) entries", 8, unnumbered3dc.length) && allOk;
    const energySample3dc = cs3dcEntries.find((e) => e.name === "基本恶能量");
    allOk = check("基本恶能量 found and unnumbered", true, !!energySample3dc && !energySample3dc.numbered) && allOk;
    const dupes3dc = cs3dcEntries.filter((e) => e.cardNumber.includes("-"));
    allOk = check("duplicate-position pairs found", 0, dupes3dc.length) && allOk;
  } else {
    console.log(`\n--- CS3aC/CS3bC/CS3DC SKIPPED — raw capture missing from disk: ${RAW_FILE_CS3} ---`);
    console.log("    (already committed live from round 16's original import run; just not re-validatable here)");
  }

  // Round 18 — CS3.5C/CS4aC/CS4bC/CS4.5C (Nine Colors Gathering line +
  // CS3.5C bridge set), separate raw capture from Ross's own
  // scripts/zh-cn-round18.ts run. 3 of the round's 7 targeted titles
  // (九彩汇聚 谱, 洪荒演武 双人对战卡组, 猫铃奇计 卡组构筑礼盒) 404'd —
  // their section headers still exist in the raw file (used below as
  // extractArticle boundaries) but have no content to validate.
  const fullTextCs4 = readFileSync(RAW_FILE_CS4, "utf-8");
  const cs4Order = [
    "怒炎灼天（TCG）", // CS3.5C
    "九彩汇聚 朋（TCG）", // CS4aC
    "九彩汇聚 源（TCG）", // CS4bC
    "终末炎舞（TCG）", // CS4.5C — confirmed real this round (own page text
    // mentions "CS4.5C" directly, and its own chain reference names the
    // round-19 targets: other=伊布进阶礼盒, next=勇魅群星 魅, next2=勇魅群星 勇)
    "九彩汇聚 谱（TCG）", // unknown CS4-family guess — 404'd
    "洪荒演武 双人对战卡组（TCG）", // CSBC/CSCC guess — 404'd again
    "猫铃奇计 卡组构筑礼盒（TCG）", // CS2.1C guess — 404'd again
  ];

  console.log("\n--- CS3.5C (怒炎灼天) ---");
  const cs35 = extractArticle(fullTextCs4, cs4Order[0], cs4Order[1]);
  const cs35Raw = countRawEntryLines(cs35);
  const cs35Entries = parseBoosterSetEntries(cs35);
  allOk = check("raw entry lines", 90, cs35Raw) && allOk;
  allOk = check("parsed (unique) entries", 90, cs35Entries.length) && allOk;
  const cs35First = cs35Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (独角虫)", "独角虫", cs35First?.name ?? "") && allOk;
  const cs35Last = cs35Entries.find((e) => e.cardNumber === "090");
  allOk = check("card 090 name (通顶雪道, last card)", "通顶雪道", cs35Last?.name ?? "") && allOk;
  allOk = check("card 090 rarity (UR)", "UR", cs35Last?.rarity ?? null) && allOk;
  const dupes35 = cs35Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes35.length) && allOk;

  console.log("\n--- CS4aC (九彩汇聚 朋) ---");
  const cs4a = extractArticle(fullTextCs4, cs4Order[1], cs4Order[2]);
  const cs4aRaw = countRawEntryLines(cs4a);
  const cs4aEntries = parseBoosterSetEntries(cs4a);
  allOk = check("raw entry lines", 184, cs4aRaw) && allOk;
  allOk = check("parsed (unique) entries", 184, cs4aEntries.length) && allOk;
  const cs4aFirst = cs4aEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (绿毛虫)", "绿毛虫", cs4aFirst?.name ?? "") && allOk;
  const cs4aLast = cs4aEntries.find((e) => e.cardNumber === "184");
  allOk = check("card 184 name (基本恶能量, last card)", "基本恶能量", cs4aLast?.name ?? "") && allOk;
  const dupes4a = cs4aEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes4a.length) && allOk;

  console.log("\n--- CS4bC (九彩汇聚 源) ---");
  const cs4b = extractArticle(fullTextCs4, cs4Order[2], cs4Order[3]);
  const cs4bRaw = countRawEntryLines(cs4b);
  const cs4bEntries = parseBoosterSetEntries(cs4b);
  allOk = check("raw entry lines", 177, cs4bRaw) && allOk;
  allOk = check("parsed (unique) entries", 177, cs4bEntries.length) && allOk;
  const cs4bFirst = cs4bEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (毽子草)", "毽子草", cs4bFirst?.name ?? "") && allOk;
  const cs4bLast = cs4bEntries.find((e) => e.cardNumber === "177");
  allOk = check("card 177 name (基本超能量, last card)", "基本超能量", cs4bLast?.name ?? "") && allOk;
  const dupes4b = cs4bEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes4b.length) && allOk;

  console.log("\n--- CS4.5C (终末炎舞) ---");
  const cs45 = extractArticle(fullTextCs4, cs4Order[3], cs4Order[4]);
  const cs45Raw = countRawEntryLines(cs45);
  const cs45Entries = parseBoosterSetEntries(cs45);
  allOk = check("raw entry lines", 83, cs45Raw) && allOk;
  allOk = check("parsed (unique) entries", 83, cs45Entries.length) && allOk;
  const cs45First = cs45Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (炎帝)", "炎帝", cs45First?.name ?? "") && allOk;
  const cs45Last = cs45Entries.find((e) => e.cardNumber === "083");
  allOk = check("card 083 name (玩具捕捉器, last card)", "玩具捕捉器", cs45Last?.name ?? "") && allOk;
  const dupes45 = cs45Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes45.length) && allOk;

  // Round 19 — CS5aC/CS5bC (Brave Stars) and CS5.5C (bridge to CS6), from
  // Ross's own scripts/zh-cn-round19.ts run. All 4 targeted titles resolved
  // this round (no 404s) — CS5aC, CS5bC, CS5.5C, and a 4th, "伊布进阶礼盒"
  // (Eevee Advanced Gift Boxes), which is real but deliberately NOT part of
  // this validation or BOOSTER_SETS (not one of the 29 core booster codes —
  // see cnBoosterSetImport.ts's round-19 comment).
  const fullTextCs5 = readFileSync(RAW_FILE_CS5, "utf-8");
  const cs5Order = [
    "勇魅群星 魅（TCG）", // CS5aC
    "勇魅群星 勇（TCG）", // CS5bC
    "暗影夺辉（TCG）", // CS5.5C
    "伊布进阶礼盒（TCG）", // not a booster-family code, just the next section boundary
  ];

  console.log("\n--- CS5aC (勇魅群星 魅) ---");
  const cs5a = extractArticle(fullTextCs5, cs5Order[0], cs5Order[1]);
  const cs5aRaw = countRawEntryLines(cs5a);
  const cs5aEntries = parseBoosterSetEntries(cs5a);
  allOk = check("raw entry lines", 176, cs5aRaw) && allOk;
  allOk = check("parsed (unique) entries", 176, cs5aEntries.length) && allOk;
  const cs5aFirst = cs5aEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (小火龙)", "小火龙", cs5aFirst?.name ?? "") && allOk;
  const cs5aLast = cs5aEntries.find((e) => e.cardNumber === "176");
  allOk = check("card 176 name (双重涡轮能量, last card)", "双重涡轮能量", cs5aLast?.name ?? "") && allOk;
  const dupes5a = cs5aEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes5a.length) && allOk;

  console.log("\n--- CS5bC (勇魅群星 勇) ---");
  const cs5b = extractArticle(fullTextCs5, cs5Order[1], cs5Order[2]);
  const cs5bRaw = countRawEntryLines(cs5b);
  const cs5bEntries = parseBoosterSetEntries(cs5b);
  allOk = check("raw entry lines", 178, cs5bRaw) && allOk;
  allOk = check("parsed (unique) entries", 178, cs5bEntries.length) && allOk;
  const cs5bFirst = cs5bEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (妙蛙种子)", "妙蛙种子", cs5bFirst?.name ?? "") && allOk;
  const cs5bLast = cs5bEntries.find((e) => e.cardNumber === "178");
  allOk = check("card 178 name (神奥神殿, last card)", "神奥神殿", cs5bLast?.name ?? "") && allOk;
  const dupes5b = cs5bEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes5b.length) && allOk;

  console.log("\n--- CS5.5C (暗影夺辉) ---");
  const cs55 = extractArticle(fullTextCs5, cs5Order[2], cs5Order[3]);
  const cs55Raw = countRawEntryLines(cs55);
  const cs55Entries = parseBoosterSetEntries(cs55);
  allOk = check("raw entry lines", 89, cs55Raw) && allOk;
  allOk = check("parsed (unique) entries", 89, cs55Entries.length) && allOk;
  const cs55First = cs55Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (派拉斯)", "派拉斯", cs55First?.name ?? "") && allOk;
  const cs55Last = cs55Entries.find((e) => e.cardNumber === "089");
  allOk = check("card 089 name (大嘴沼泽, last card)", "大嘴沼泽", cs55Last?.name ?? "") && allOk;
  const dupes55 = cs55Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes55.length) && allOk;

  // Round 20 — CS6aC/CS6bC (Shadow of the Blue Sea), from Ross's own
  // scripts/zh-cn-round20.ts run. Both targeted titles resolved this round
  // (no 404s) — neither was a guess, both came directly from CS5.5C's own
  // chain reference.
  const fullTextCs6 = readFileSync(RAW_FILE_CS6, "utf-8");
  const cs6Order = [
    "碧海暗影 啸（TCG）", // CS6aC
    "碧海暗影 逐（TCG）", // CS6bC
  ];

  console.log("\n--- CS6aC (碧海暗影 啸) ---");
  const cs6a = extractArticle(fullTextCs6, cs6Order[0], cs6Order[1]);
  const cs6aRaw = countRawEntryLines(cs6a);
  const cs6aEntries = parseBoosterSetEntries(cs6a);
  allOk = check("raw entry lines", 169, cs6aRaw) && allOk;
  allOk = check("parsed (unique) entries", 169, cs6aEntries.length) && allOk;
  const cs6aFirst = cs6aEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (大针蜂V)", "大针蜂V", cs6aFirst?.name ?? "") && allOk;
  const cs6aLast = cs6aEntries.find((e) => e.cardNumber === "169");
  allOk = check("card 169 name (基本钢能量, last card)", "基本钢能量", cs6aLast?.name ?? "") && allOk;
  const dupes6a = cs6aEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes6a.length) && allOk;

  console.log("\n--- CS6bC (碧海暗影 逐) ---");
  const cs6b = extractArticle(fullTextCs6, cs6Order[1], null);
  const cs6bRaw = countRawEntryLines(cs6b);
  const cs6bEntries = parseBoosterSetEntries(cs6b);
  allOk = check("raw entry lines", 172, cs6bRaw) && allOk;
  allOk = check("parsed (unique) entries", 172, cs6bEntries.length) && allOk;
  const cs6bFirst = cs6bEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (小海狮)", "小海狮", cs6bFirst?.name ?? "") && allOk;
  const cs6bLast = cs6bEntries.find((e) => e.cardNumber === "172");
  allOk = check("card 172 name (基本斗能量, last card)", "基本斗能量", cs6bLast?.name ?? "") && allOk;
  const dupes6b = cs6bEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes6b.length) && allOk;

  // Round 21 — CS6.5C (胜象星引, "Victory Lodestar"), the bridge set after
  // CS6aC/CS6bC, from Ross's own scripts/zh-cn-round21.ts run. Named
  // directly by BOTH CS6aC's and CS6bC's own chain references — not a
  // guess. Single-title capture (no next-article boundary needed).
  const fullTextCs65 = readFileSync(RAW_FILE_CS65, "utf-8");

  console.log("\n--- CS6.5C (胜象星引) ---");
  const cs65 = extractArticle(fullTextCs65, "胜象星引（TCG）", null);
  const cs65Raw = countRawEntryLines(cs65);
  const cs65Entries = parseBoosterSetEntries(cs65);
  allOk = check("raw entry lines", 96, cs65Raw) && allOk;
  allOk = check("parsed (unique) entries", 96, cs65Entries.length) && allOk;
  const cs65First = cs65Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (阿罗拉 椰蛋树V)", "阿罗拉 椰蛋树V", cs65First?.name ?? "") && allOk;
  const cs65Last = cs65Entries.find((e) => e.cardNumber === "096");
  allOk = check("card 096 name (V防守能量, last card)", "V防守能量", cs65Last?.name ?? "") && allOk;
  const dupes65 = cs65Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupes65.length) && allOk;

  // Round 22 — CSV1C (亘古开来, "Ancient Times, Future Progress"), the
  // BREAKTHROUGH entry point into the CSV (Scarlet & Violet) line, from
  // Ross's own scripts/zh-cn-round22.ts run. Named directly by CS6.5C's own
  // chain reference — not a guess. Single-title extraction (the capture
  // also contains "收集啦151 旅（TCG）" first, which is real but out of
  // scope for BOOSTER_SETS — see the header comment in cnBoosterSetImport.ts).
  const fullTextCsv1 = readFileSync(RAW_FILE_CSV1, "utf-8");

  console.log("\n--- CSV1C (亘古开来) ---");
  const csv1 = extractArticle(fullTextCsv1, "亘古开来（TCG）", null);
  const csv1Raw = countRawEntryLines(csv1);
  const csv1Entries = parseBoosterSetEntries(csv1);
  allOk = check("raw entry lines", 167, csv1Raw) && allOk;
  allOk = check("parsed (unique) entries", 167, csv1Entries.length) && allOk;
  const csv1First = csv1Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (榛果球)", "榛果球", csv1First?.name ?? "") && allOk;
  const csv1Last = csv1Entries.find((e) => e.cardNumber === "167");
  allOk = check("card 167 name (宝可梦交替, last card)", "宝可梦交替", csv1Last?.name ?? "") && allOk;
  const dupesCsv1 = csv1Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv1.length) && allOk;

  // Round 23 — CSV2C (奇迹启程, "Miracle Journey"), from Ross's own
  // scripts/zh-cn-round23.ts run. Named directly by CSV1C's own chain
  // reference — not a guess.
  const fullTextCsv2 = readFileSync(RAW_FILE_CSV2, "utf-8");

  console.log("\n--- CSV2C (奇迹启程) ---");
  const csv2 = extractArticle(fullTextCsv2, "奇迹启程（TCG）", null);
  const csv2Raw = countRawEntryLines(csv2);
  const csv2Entries = parseBoosterSetEntries(csv2);
  allOk = check("raw entry lines", 163, csv2Raw) && allOk;
  allOk = check("parsed (unique) entries", 163, csv2Entries.length) && allOk;
  const csv2First = csv2Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (赫拉克罗斯)", "赫拉克罗斯", csv2First?.name ?? "") && allOk;
  const csv2Last = csv2Entries.find((e) => e.cardNumber === "163");
  allOk = check("card 163 name (深钵镇, last card)", "深钵镇", csv2Last?.name ?? "") && allOk;
  const dupesCsv2 = csv2Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv2.length) && allOk;

  // Round 24 — CSV3C (无畏太晶, "Fearless Terastal"), from Ross's own
  // scripts/zh-cn-round24.ts run. Named directly by CSV2C's own chain
  // reference — not a guess.
  const fullTextCsv3 = readFileSync(RAW_FILE_CSV3, "utf-8");

  console.log("\n--- CSV3C (无畏太晶) ---");
  const csv3 = extractArticle(fullTextCsv3, "无畏太晶（TCG）", null);
  const csv3Raw = countRawEntryLines(csv3);
  const csv3Entries = parseBoosterSetEntries(csv3);
  allOk = check("raw entry lines", 165, csv3Raw) && allOk;
  allOk = check("parsed (unique) entries", 165, csv3Entries.length) && allOk;
  const csv3First = csv3Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (毽子草)", "毽子草", csv3First?.name ?? "") && allOk;
  const csv3Last = csv3Entries.find((e) => e.cardNumber === "165");
  allOk = check("card 165 name (反转能量, last card)", "反转能量", csv3Last?.name ?? "") && allOk;
  const dupesCsv3 = csv3Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv3.length) && allOk;

  // Round 25 — CSV4C (嘉奖回合, "Bonus Round"), from Ross's own
  // scripts/zh-cn-round25.ts run. Named directly by CSV3C's own chain
  // reference — not a guess.
  const fullTextCsv4 = readFileSync(RAW_FILE_CSV4, "utf-8");

  console.log("\n--- CSV4C (嘉奖回合) ---");
  const csv4 = extractArticle(fullTextCsv4, "嘉奖回合（TCG）", null);
  const csv4Raw = countRawEntryLines(csv4);
  const csv4Entries = parseBoosterSetEntries(csv4);
  allOk = check("raw entry lines", 165, csv4Raw) && allOk;
  allOk = check("parsed (unique) entries", 165, csv4Entries.length) && allOk;
  const csv4First = csv4Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (飞天螳螂)", "飞天螳螂", csv4First?.name ?? "") && allOk;
  const csv4Last = csv4Entries.find((e) => e.cardNumber === "165");
  allOk = check("card 165 name (海滩场地, last card)", "海滩场地", csv4Last?.name ?? "") && allOk;
  const dupesCsv4 = csv4Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv4.length) && allOk;

  // Round 26 — CSV5C (黑晶炽诚, "Ardent Obsidian"), from Ross's own
  // scripts/zh-cn-round26.ts run. Named directly by CSV4C's own chain
  // reference — not a guess.
  const fullTextCsv5 = readFileSync(RAW_FILE_CSV5, "utf-8");

  console.log("\n--- CSV5C (黑晶炽诚) ---");
  const csv5 = extractArticle(fullTextCsv5, "黑晶炽诚（TCG）", null);
  const csv5Raw = countRawEntryLines(csv5);
  const csv5Entries = parseBoosterSetEntries(csv5);
  allOk = check("raw entry lines", 164, csv5Raw) && allOk;
  allOk = check("parsed (unique) entries", 164, csv5Entries.length) && allOk;
  const csv5First = csv5Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (走路草)", "走路草", csv5First?.name ?? "") && allOk;
  const csv5Last = csv5Entries.find((e) => e.cardNumber === "164");
  allOk = check("card 164 name (不服输头带, last card)", "不服输头带", csv5Last?.name ?? "") && allOk;
  const dupesCsv5 = csv5Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv5.length) && allOk;

  // Round 27 — CSV6C (真实玄虚, "Arcane Truth"), from Ross's own
  // scripts/zh-cn-round27.ts run. Named directly by CSV5C's own chain
  // reference — not a guess.
  const fullTextCsv6 = readFileSync(RAW_FILE_CSV6, "utf-8");

  console.log("\n--- CSV6C (真实玄虚) ---");
  const csv6 = extractArticle(fullTextCsv6, "真实玄虚（TCG）", null);
  const csv6Raw = countRawEntryLines(csv6);
  const csv6Entries = parseBoosterSetEntries(csv6);
  allOk = check("raw entry lines", 163, csv6Raw) && allOk;
  allOk = check("parsed (unique) entries", 163, csv6Entries.length) && allOk;
  const csv6First = csv6Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (溜溜糖球)", "溜溜糖球", csv6First?.name ?? "") && allOk;
  const csv6Last = csv6Entries.find((e) => e.cardNumber === "163");
  allOk = check("card 163 name (朋友手册, last card)", "朋友手册", csv6Last?.name ?? "") && allOk;
  const dupesCsv6 = csv6Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv6.length) && allOk;

  // Round 28 — CSV7C (利刃猛醒, "Blade Awakening"), from Ross's own
  // scripts/zh-cn-round28.ts run. Named directly by CSV6C's own chain
  // reference — not a guess. Note: this set's 259 total entries (204 base
  // + 55 AR/SR/SAR/UR chase tail) corrects the 204-only figure recorded
  // earlier via the separate image-backfill track in claude/spec.md.
  const fullTextCsv7 = readFileSync(RAW_FILE_CSV7, "utf-8");

  console.log("\n--- CSV7C (利刃猛醒) ---");
  const csv7 = extractArticle(fullTextCsv7, "利刃猛醒（TCG）", null);
  const csv7Raw = countRawEntryLines(csv7);
  const csv7Entries = parseBoosterSetEntries(csv7);
  allOk = check("raw entry lines", 259, csv7Raw) && allOk;
  allOk = check("parsed (unique) entries", 259, csv7Entries.length) && allOk;
  const csv7First = csv7Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (蔓藤怪)", "蔓藤怪", csv7First?.name ?? "") && allOk;
  const csv7Last = csv7Entries.find((e) => e.cardNumber === "259");
  allOk = check("card 259 name (紧急滑板, last card)", "紧急滑板", csv7Last?.name ?? "") && allOk;
  const dupesCsv7 = csv7Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv7.length) && allOk;

  // Round 29 — CSV8C (璀璨诡幻, "Sparkling Fable"), from Ross's own
  // scripts/zh-cn-round29.ts run. Named directly by CSV7C's own chain
  // reference — not a guess.
  const fullTextCsv8 = readFileSync(RAW_FILE_CSV8, "utf-8");

  console.log("\n--- CSV8C (璀璨诡幻) ---");
  const csv8 = extractArticle(fullTextCsv8, "璀璨诡幻（TCG）", null);
  const csv8Raw = countRawEntryLines(csv8);
  const csv8Entries = parseBoosterSetEntries(csv8);
  allOk = check("raw entry lines", 264, csv8Raw) && allOk;
  allOk = check("parsed (unique) entries", 264, csv8Entries.length) && allOk;
  const csv8First = csv8Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (蛋蛋)", "蛋蛋", csv8First?.name ?? "") && allOk;
  const csv8Last = csv8Entries.find((e) => e.cardNumber === "264");
  allOk = check("card 264 name (夜光能量, last card)", "夜光能量", csv8Last?.name ?? "") && allOk;
  const dupesCsv8 = csv8Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv8.length) && allOk;

  // Round 30 — CSV9C (星彩晶璃, "Stellar Crystal"), from Ross's own
  // scripts/zh-cn-round30.ts run. Named directly by CSV8C's own chain
  // reference — not a guess. UNLIKE every prior round in this chain, this
  // one has a genuine wiki source data error: position 136/208 is used
  // twice on the page itself (铝钢龙 then 铝钢桥龙, two different real
  // cards), and 137 is never used. Expecting exactly ONE duplicate-position
  // pair here, not zero — the real parser's existing dedup logic renames
  // the second occurrence to "136-2", which is the correct, expected
  // behavior for this set, not a parser failure.
  const fullTextCsv9 = readFileSync(RAW_FILE_CSV9, "utf-8");

  console.log("\n--- CSV9C (星彩晶璃) ---");
  const csv9 = extractArticle(fullTextCsv9, "星彩晶璃（TCG）", null);
  const csv9Raw = countRawEntryLines(csv9);
  const csv9Entries = parseBoosterSetEntries(csv9);
  allOk = check("raw entry lines", 266, csv9Raw) && allOk;
  allOk = check("parsed (unique) entries", 266, csv9Entries.length) && allOk;
  const csv9First = csv9Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (蛋蛋)", "蛋蛋", csv9First?.name ?? "") && allOk;
  const csv9Last = csv9Entries.find((e) => e.cardNumber === "266");
  allOk = check("card 266 name (零之大空洞, last card)", "零之大空洞", csv9Last?.name ?? "") && allOk;
  const dupesCsv9 = csv9Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found (expected: 1, wiki source error at 136)", 1, dupesCsv9.length) && allOk;
  const csv9Dup136 = csv9Entries.find((e) => e.cardNumber === "136");
  const csv9Dup136b = csv9Entries.find((e) => e.cardNumber === "136-2");
  allOk = check("card 136 name (铝钢龙)", "铝钢龙", csv9Dup136?.name ?? "") && allOk;
  allOk = check("card 136-2 name (铝钢桥龙, the collision)", "铝钢桥龙", csv9Dup136b?.name ?? "") && allOk;

  // Round 31 — CSV9.5C (太晶盛聚, "Terastal Gathering"), from Ross's own
  // scripts/zh-cn-round31.ts run. Named directly by CSV9C's own chain
  // reference — not a guess. NOTE: this is CSV9.5C, not CSV10C — the
  // scout script's speculation before the fetch was wrong, corrected
  // once the page's own infobox was read (alt=CSV9.5C).
  const fullTextCsv95 = readFileSync(RAW_FILE_CSV95, "utf-8");

  console.log("\n--- CSV9.5C (太晶盛聚) ---");
  const csv95 = extractArticle(fullTextCsv95, "太晶盛聚（TCG）", null);
  const csv95Raw = countRawEntryLines(csv95);
  const csv95Entries = parseBoosterSetEntries(csv95);
  allOk = check("raw entry lines", 259, csv95Raw) && allOk;
  allOk = check("parsed (unique) entries", 259, csv95Entries.length) && allOk;
  const csv95First = csv95Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (蛋蛋)", "蛋蛋", csv95First?.name ?? "") && allOk;
  const csv95Last = csv95Entries.find((e) => e.cardNumber === "259");
  allOk = check("card 259 name (太乐巴戈斯ex, last card)", "太乐巴戈斯ex", csv95Last?.name ?? "") && allOk;
  const dupesCsv95 = csv95Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv95.length) && allOk;

  // Round 32 — CSV10C (共逐荣光, "Together in Pursuit of Glory"), from
  // Ross's own scripts/zh-cn-round32.ts run. Named directly by CSV9.5C's
  // own chain reference — not a guess. This is the actual final set of
  // the originally-named CSV1C-CSV10C family.
  const fullTextCsv10 = readFileSync(RAW_FILE_CSV10, "utf-8");

  console.log("\n--- CSV10C (共逐荣光) ---");
  const csv10 = extractArticle(fullTextCsv10, "共逐荣光（TCG）", null);
  const csv10Raw = countRawEntryLines(csv10);
  const csv10Entries = parseBoosterSetEntries(csv10);
  allOk = check("raw entry lines", 287, csv10Raw) && allOk;
  allOk = check("parsed (unique) entries", 287, csv10Entries.length) && allOk;
  const csv10First = csv10Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (阿响的凯罗斯)", "阿响的凯罗斯", csv10First?.name ?? "") && allOk;
  const csv10Last = csv10Entries.find((e) => e.cardNumber === "287");
  allOk = check("card 287 name (尖钉能量, last card)", "尖钉能量", csv10Last?.name ?? "") && allOk;
  const dupesCsv10 = csv10Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsv10.length) && allOk;

  // Round 35/36 — CSM1/CSM2 family (Storming Emergence / Shining Synergy),
  // the last 6 codes of the original 29-code core-pack family from round 12,
  // plus the CSM1.5C/CSM2.5C bridge sets. Never named by a next=/other=
  // chain reference in 34 prior rounds — found instead via the CSM1/CSM2 hub
  // pages (round 35) and confirmed here via a single self-contained capture
  // covering all 8 titles in one file, from Ross's own scripts/zh-cn-round36.ts
  // run. Zero 404s, zero missing pages — the cleanest single-round batch of
  // the whole effort.
  const fullTextCsm36 = readFileSync(RAW_FILE_CSM36, "utf-8");
  const csm36Order = [
    "横空出世 赫（TCG）", // CSM1aC
    "横空出世 苍（TCG）", // CSM1bC
    "横空出世 泽（TCG）", // CSM1cC
    "交相辉映 沐（TCG）", // CSM2aC
    "交相辉映 魁（TCG）", // CSM2bC
    "交相辉映 唤（TCG）", // CSM2cC
    "对战精英（TCG）", // CSM1.5C
    "炫奇争胜（TCG）", // CSM2.5C
  ];

  console.log("\n--- CSM1aC (横空出世 赫) ---");
  const csm1a = extractArticle(fullTextCsm36, csm36Order[0], csm36Order[1]);
  const csm1aRaw = countRawEntryLines(csm1a);
  const csm1aEntries = parseBoosterSetEntries(csm1a);
  allOk = check("raw entry lines", 211, csm1aRaw) && allOk;
  allOk = check("parsed (unique) entries", 211, csm1aEntries.length) && allOk;
  const csm1aFirst = csm1aEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (飞天螳螂)", "飞天螳螂", csm1aFirst?.name ?? "") && allOk;
  const csm1aLast = csm1aEntries.find((e) => e.cardNumber === "211");
  allOk = check("card 211 name (彩虹能量, last card)", "彩虹能量", csm1aLast?.name ?? "") && allOk;
  const dupesCsm1a = csm1aEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm1a.length) && allOk;

  console.log("\n--- CSM1bC (横空出世 苍) ---");
  const csm1b = extractArticle(fullTextCsm36, csm36Order[1], csm36Order[2]);
  const csm1bRaw = countRawEntryLines(csm1b);
  const csm1bEntries = parseBoosterSetEntries(csm1b);
  allOk = check("raw entry lines", 204, csm1bRaw) && allOk;
  allOk = check("parsed (unique) entries", 204, csm1bEntries.length) && allOk;
  const csm1bFirst = csm1bEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (走路草)", "走路草", csm1bFirst?.name ?? "") && allOk;
  const csm1bLast = csm1bEntries.find((e) => e.cardNumber === "204");
  allOk = check("card 204 name (反击能量, last card)", "反击能量", csm1bLast?.name ?? "") && allOk;
  const dupesCsm1b = csm1bEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm1b.length) && allOk;

  console.log("\n--- CSM1cC (横空出世 泽) ---");
  const csm1c = extractArticle(fullTextCsm36, csm36Order[2], csm36Order[3]);
  const csm1cRaw = countRawEntryLines(csm1c);
  const csm1cEntries = parseBoosterSetEntries(csm1c);
  allOk = check("raw entry lines", 212, csm1cRaw) && allOk;
  allOk = check("parsed (unique) entries", 212, csm1cEntries.length) && allOk;
  const csm1cFirst = csm1cEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (阿罗拉 穿山鼠)", "阿罗拉 穿山鼠", csm1cFirst?.name ?? "") && allOk;
  const csm1cLast = csm1cEntries.find((e) => e.cardNumber === "212");
  allOk = check("card 212 name (双重无色能量, last card)", "双重无色能量", csm1cLast?.name ?? "") && allOk;
  const dupesCsm1c = csm1cEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm1c.length) && allOk;

  console.log("\n--- CSM2aC (交相辉映 沐) ---");
  const csm2a = extractArticle(fullTextCsm36, csm36Order[3], csm36Order[4]);
  const csm2aRaw = countRawEntryLines(csm2a);
  const csm2aEntries = parseBoosterSetEntries(csm2a);
  allOk = check("raw entry lines", 194, csm2aRaw) && allOk;
  allOk = check("parsed (unique) entries", 194, csm2aEntries.length) && allOk;
  const csm2aFirst = csm2aEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (盖盖虫)", "盖盖虫", csm2aFirst?.name ?? "") && allOk;
  const csm2aLast = csm2aEntries.find((e) => e.cardNumber === "194");
  allOk = check("card 194 name (回收利用能量, last card)", "回收利用能量", csm2aLast?.name ?? "") && allOk;
  const dupesCsm2a = csm2aEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm2a.length) && allOk;

  console.log("\n--- CSM2bC (交相辉映 魁) ---");
  const csm2b = extractArticle(fullTextCsm36, csm36Order[4], csm36Order[5]);
  const csm2bRaw = countRawEntryLines(csm2b);
  const csm2bEntries = parseBoosterSetEntries(csm2b);
  allOk = check("raw entry lines", 193, csm2bRaw) && allOk;
  allOk = check("parsed (unique) entries", 193, csm2bEntries.length) && allOk;
  const csm2bFirst = csm2bEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (时拉比&妙蛙花GX)", "时拉比&妙蛙花GX", csm2bFirst?.name ?? "") && allOk;
  const csm2bLast = csm2bEntries.find((e) => e.cardNumber === "193");
  allOk = check("card 193 name (抽出能量, last card)", "抽出能量", csm2bLast?.name ?? "") && allOk;
  const dupesCsm2b = csm2bEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm2b.length) && allOk;

  console.log("\n--- CSM2cC (交相辉映 唤) ---");
  const csm2c = extractArticle(fullTextCsm36, csm36Order[5], csm36Order[6]);
  const csm2cRaw = countRawEntryLines(csm2c);
  const csm2cEntries = parseBoosterSetEntries(csm2c);
  allOk = check("raw entry lines", 192, csm2cRaw) && allOk;
  allOk = check("parsed (unique) entries", 192, csm2cEntries.length) && allOk;
  const csm2cFirst = csm2cEntries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (莱希拉姆&喷火龙GX)", "莱希拉姆&喷火龙GX", csm2cFirst?.name ?? "") && allOk;
  const csm2cLast = csm2cEntries.find((e) => e.cardNumber === "192");
  allOk = check("card 192 name (三重加速能量, last card)", "三重加速能量", csm2cLast?.name ?? "") && allOk;
  const dupesCsm2c = csm2cEntries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm2c.length) && allOk;

  console.log("\n--- CSM1.5C (对战精英) ---");
  const csm15 = extractArticle(fullTextCsm36, csm36Order[6], csm36Order[7]);
  const csm15Raw = countRawEntryLines(csm15);
  const csm15Entries = parseBoosterSetEntries(csm15);
  allOk = check("raw entry lines", 88, csm15Raw) && allOk;
  allOk = check("parsed (unique) entries", 88, csm15Entries.length) && allOk;
  const csm15First = csm15Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (火斑喵)", "火斑喵", csm15First?.name ?? "") && allOk;
  const csm15Last = csm15Entries.find((e) => e.cardNumber === "088");
  allOk = check("card 088 name (组合能量斗恶妖, last card)", "组合能量斗恶妖", csm15Last?.name ?? "") && allOk;
  const dupesCsm15 = csm15Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm15.length) && allOk;

  console.log("\n--- CSM2.5C (炫奇争胜) ---");
  const csm25 = extractArticle(fullTextCsm36, csm36Order[7], null);
  const csm25Raw = countRawEntryLines(csm25);
  const csm25Entries = parseBoosterSetEntries(csm25);
  allOk = check("raw entry lines", 99, csm25Raw) && allOk;
  allOk = check("parsed (unique) entries", 99, csm25Entries.length) && allOk;
  const csm25First = csm25Entries.find((e) => e.cardNumber === "001");
  allOk = check("card 001 name (妙蛙花&藤藤蛇GX)", "妙蛙花&藤藤蛇GX", csm25First?.name ?? "") && allOk;
  const csm25Last = csm25Entries.find((e) => e.cardNumber === "099");
  allOk = check("card 099 name (弱点防守能量, last card)", "弱点防守能量", csm25Last?.name ?? "") && allOk;
  const dupesCsm25 = csm25Entries.filter((e) => e.cardNumber.includes("-"));
  allOk = check("duplicate-position pairs found", 0, dupesCsm25.length) && allOk;

  console.log(`\n${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED — do not ship this parser as-is"}`);
  console.log(
    `\nNote: CS1bC ("极巨争锋 焰（TCG）") was NOT in the CS1 capture (the scout script's original` +
      ` title guess 404'd) — but WAS separately confirmed live by Ross (199 cards) and is already` +
      ` committed. Not re-validated here since there's no raw capture for it — that's fine, it went` +
      ` through the real import script, not this offline check, before being committed.` +
      `\nCS2.1C ("Meowth's Little Tricks") is still pending — no confirmed title yet, not in BOOSTER_SETS.` +
      `\nCSBC/CSCC ("Primordial Arts Deck Building Gift Box") are also still pending — round 16's guessed` +
      ` title 404'd, real titles unknown, not in BOOSTER_SETS.` +
      `\nRound 18: CS3.5C/CS4aC/CS4bC/CS4.5C all confirmed real and validated above. The unknown CS4-family` +
      ` guess ("九彩汇聚 谱"), CSBC/CSCC, and CS2.1C all 404'd again this round — still unidentified.` +
      `\nRound 19: CS5aC/CS5bC/CS5.5C all confirmed real and validated above (a 4th title, "伊布进阶礼盒",` +
      ` also resolved real but is a separate small gift-box product, not one of the 29 core booster codes` +
      ` — not in BOOSTER_SETS). CS5.5C's own chain reference names CS6aC/CS6bC directly (碧海暗影 啸/逐) —` +
      ` round 20's target, not yet captured.` +
      `\nRound 20: CS6aC/CS6bC both confirmed real and validated above. Both name the same next title,` +
      ` "胜象星引（TCG）" — round 21's target, not yet fetched.` +
      `\nRound 21: CS6.5C (胜象星引) confirmed real and validated above. Its own chain reference names` +
      ` TWO next titles, "收集啦151 旅" and "亘古开来" — round 22's targets, both genuinely unconfirmed` +
      ` until fetched, but the first potential doorway past the entire CS1-CS6 family.` +
      `\nRound 22: BREAKTHROUGH. CSV1C (亘古开来, alt=CSV1C — the first of the CSV1C-CSV10C family named` +
      ` in the original gap list) confirmed real and validated above. "收集啦151 旅" (alt=151C) also` +
      ` confirmed real but does not match the "CS"-prefixed core-family naming convention — same category` +
      ` as CSHC, not added to BOOSTER_SETS. CSV1C's own chain reference names round 23's target directly:` +
      ` "奇迹启程（TCG）" — not yet fetched.` +
      `\nRound 23: CSV2C (奇迹启程) confirmed real and validated above. Straight single-strand chain this` +
      ` time (no side branches) — names round 24's target directly: "无畏太晶（TCG）" (plausibly CSV3C),` +
      ` not yet fetched.` +
      `\nRound 24: CSV3C (无畏太晶) confirmed real and validated above. Names round 25's target directly:` +
      ` "嘉奖回合（TCG）" (plausibly CSV4C), not yet fetched. Side leads (a Happy Set combo, a second Gem` +
      ` Pack wave) are real but out of core-family scope, same as round 22's "收集啦151 旅".` +
      `\nRound 25: CSV4C (嘉奖回合) confirmed real and validated above. Names round 26's target directly:` +
      ` "黑晶炽诚（TCG）" (plausibly CSV5C), not yet fetched.` +
      `\nRound 26: CSV5C (黑晶炽诚) confirmed real and validated above. Names round 27's target directly:` +
      ` "真实玄虚（TCG）" (plausibly CSV6C), not yet fetched.` +
      `\nRound 27: CSV6C (真实玄虚) confirmed real and validated above. Names round 28's target directly:` +
      ` "利刃猛醒（TCG）" — already independently confirmed as CSV7C via the separate image-backfill track` +
      ` (204 real cards, clean identity mapping). Two independent methods now agree.` +
      `\nRound 28: CSV7C (利刃猛醒) confirmed real and validated above with the actual card-row data this` +
      ` chain needed. CORRECTION: the real total is 259 entries (204 base + 55 AR/SR/SAR/UR chase tail,` +
      ` per the page's own \`cards=204+55\`), not the 204 recorded by the earlier image-backfill track —` +
      ` that number only ever covered the base count, not the full chase-card tail. Names round 29's` +
      ` target directly: "璀璨诡幻（TCG）" — not yet fetched.` +
      `\nRound 29: CSV8C (璀璨诡幻) confirmed real and validated above. Single-strand chain, no side` +
      ` branches — names round 30's target directly: "星彩晶璃（TCG）" — not yet fetched.` +
      `\nRound 30: CSV9C (星彩晶璃) confirmed real and validated above. First genuine wiki source data` +
      ` error in this entire chain: position 136/208 used twice on the page itself (铝钢龙, then` +
      ` 铝钢桥龙 — two different real cards), position 137 never used. Handled correctly by the existing` +
      ` dedup logic (second entry becomes "136-2"), recorded as-scraped rather than silently renumbered.` +
      ` Names round 31's target directly: "太晶盛聚（TCG）" — not yet fetched.` +
      `\nRound 31: CSV9.5C (太晶盛聚) confirmed real and validated above. CORRECTION: this is CSV9.5C, a` +
      ` bridge/half-set (same X.5C pattern as CS5.5C, CS6.5C), NOT CSV10C as speculated before the fetch.` +
      ` CSV10C is still ahead, unreached. Names round 32's target directly: "共逐荣光（TCG）" — plausibly` +
      ` the real CSV10C, not yet fetched.` +
      `\nRound 32: CSV10C (共逐荣光) confirmed real and validated above. This IS the actual final set of` +
      ` the originally-named CSV1C-CSV10C family — closes it out. Names round 33's target directly:` +
      ` "雳焰激荡（TCG）" — the first set past the original family, plausibly CSV11C, not yet fetched.` +
      ` Side branches this round (a deck-building gift box, a Happy Set combo) are real but out of` +
      ` core-family scope, same as every prior round's side branches.` +
      `\nRound 33/34: CSV11C (雳焰激荡) confirmed real (alt=CSV11C) but its page is an unpublished` +
      ` stub — no cards=, no card-list entries, nothing to validate. Its two branch titles, "黑雷奔流"` +
      ` and "白雷迸涌", return page-not-found entirely — genuinely unpublished, not a bad guess. Stalled` +
      ` here until the wiki catches up; none of these three are in BOOSTER_SETS.` +
      `\nRound 35/36: the CSM1/CSM2 family (CSM1aC/bC/cC, CSM2aC/bC/cC) plus the CSM1.5C/CSM2.5C` +
      ` bridge sets — the last 6 codes of the 29-code core family, never named by a chain reference in` +
      ` 34 prior rounds — all 8 confirmed real and validated above via a single self-contained capture.` +
      ` Zero 404s, zero missing pages, zero duplicate positions on any of the 8 — the cleanest batch of` +
      ` the whole effort. CSM2aC/bC/cC and CSM2.5C's own \`cards=\` infobox fields are genuinely` +
      ` incomplete on the wiki itself ("150+", "61+" with nothing after the plus sign) — the real raw` +
      ` entry count is authoritative, same handling as CSV7C-CSV10C's BASE+EXTRA fields. CSM2.5C's own` +
      ` chain reference names \`next=极巨争锋 雷, next2=极巨争锋 焰\` — the SAME CS1aC/CS1bC pair already` +
      ` at the top of BOOSTER_SETS, confirming the chain wraps back around: this is the true end of the` +
      ` 29-code core-pack family's chain-discovery effort.`
  );
  process.exit(allOk ? 0 : 1);
}

main();
