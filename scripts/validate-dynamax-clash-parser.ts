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

import { readFileSync } from "fs";
import { join } from "path";
import { countRawEntryLines, parseBoosterSetEntries } from "../src/lib/cnBoosterSetImport";

const RAW_FILE = join(process.cwd(), "data", "wiki-raw", "dynamax-clash-round13-raw.txt");
const RAW_FILE_CS2 = join(process.cwd(), "data", "wiki-raw", "vivid-portrayals-round14-raw.txt");
const RAW_FILE_CS25 = join(process.cwd(), "data", "wiki-raw", "brilliant-counterattack-round15-raw.txt");

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
  const fullText = readFileSync(RAW_FILE, "utf-8");
  let allOk = true;

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

  // Round 14 — CS2 line (Vivid Portrayals), separate raw capture.
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

  // Round 15 — CS2.5C, separate raw capture.
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

  console.log(`\n${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED — do not ship this parser as-is"}`);
  console.log(
    `\nNote: CS1bC ("极巨争锋 焰（TCG）") was NOT in the CS1 capture (the scout script's original` +
      ` title guess 404'd) — but WAS separately confirmed live by Ross (199 cards) and is already` +
      ` committed. Not re-validated here since there's no raw capture for it — that's fine, it went` +
      ` through the real import script, not this offline check, before being committed.` +
      `\nCS2.1C ("Meowth's Little Tricks") is still pending — no confirmed title yet, not in BOOSTER_SETS.`
  );
  process.exit(allOk ? 0 : 1);
}

main();
