// Offline validation of the round 7 parsers (S-P/M-P added to
// cnBlackStarPromoImport.ts; cnStarterDeckImport.ts for CSM2DC/CSM1DC)
// against the raw wikitext Ross captured with
// scripts/zh-cn-remaining-threads-round3.ts. No network access needed —
// same pattern as validate-black-star-promo-parser.ts.
//
// Ground truth for the raw/parsed entry counts below is the LIVE count
// scripts/zh-cn-remaining-threads-round3.ts itself printed when it fetched
// each page for real ("[USES bulk-table template — N entries found]") —
// not a hand-count, so this is checking the real parser against a real,
// independently-confirmed number.
//
// Usage: npx tsx scripts/validate-round3-parsers.ts

import { readFileSync } from "fs";
import { join } from "path";
import { parseBlackStarPromoEntries, countRawEntryLines as countBSP } from "../src/lib/cnBlackStarPromoImport";
import { parseStarterDeckEntries, countRawEntryLines as countSD } from "../src/lib/cnStarterDeckImport";

const RAW_FILE = join(process.cwd(), "data", "wiki-raw", "round3-raw.txt");

function extractSection(fullText: string, startMarker: string, endMarker: string | null): string {
  const start = fullText.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const from = start + startMarker.length;
  const end = endMarker ? fullText.indexOf(endMarker, from) : fullText.length;
  if (endMarker && end === -1) throw new Error(`end marker not found: ${endMarker}`);
  const raw = fullText.slice(from, end === -1 ? undefined : end);

  // round3-raw.txt has the scout script's own console summary line right
  // after each "===" header — e.g. "[USES bulk-table template — 250
  // {{卡牌列表/entryjp|...}} entries found]". That's a human-readable NOTE,
  // not wikitext, but it contains one literal example occurrence of the
  // marker substring, which inflates countRawEntryLines()/countSD() by
  // exactly 1 if left in. Strip any line that's wrapped in [ ] before
  // counting/parsing, so both raw and parsed counts are checked against
  // the real wikitext only.
  return raw
    .split("\n")
    .filter((line) => !/^\[.*\]$/.test(line.trim()))
    .join("\n");
}

function check(label: string, expected: number | string, actual: number | string) {
  const ok = expected === actual;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: expected ${expected}, got ${actual}`);
  return ok;
}

function main() {
  const fullText = readFileSync(RAW_FILE, "utf-8");
  let allOk = true;

  const spSection = extractSection(fullText, "=== S-P简体中文版特典卡（TCG） ===", "=== M-P简体中文版特典卡（TCG） ===");
  const mpSection = extractSection(fullText, "=== M-P简体中文版特典卡（TCG） ===", "=== GX起始卡组 交相辉映（TCG） ===");
  const csm2Section = extractSection(fullText, "=== GX起始卡组 交相辉映（TCG） ===", "=== GX起始卡组 横空出世（TCG） ===");
  const csm1Section = extractSection(fullText, "=== GX起始卡组 横空出世（TCG） ===", "=== 大师战略卡组构筑套装");

  console.log("--- S-P ---");
  const spRaw = countBSP(spSection);
  const spEntries = parseBlackStarPromoEntries(spSection);
  allOk = check("raw entryjp lines", 250, spRaw) && allOk;
  allOk = check("parsed total", 250, spEntries.length) && allOk;

  const sp001 = spEntries.find((e) => e.numbered && e.cardNumber === "001");
  console.log(`  S-P 001: name="${sp001?.name}" category="${sp001?.category}"`);
  allOk = check("S-P 001 name", "毒蔷薇", sp001?.name ?? "") && allOk;

  // The real, confirmed-in-production duplicate-number case: 066/S-P
  // appears twice (plain + holo). Auto-disambiguation should produce BOTH
  // "066" and "066-2" as distinct entries, not one overwriting the other.
  const sp066 = spEntries.filter((e) => e.numbered && (e.cardNumber === "066" || e.cardNumber === "066-2"));
  console.log(`  S-P 066 duplicate pair: found ${sp066.length} distinct row(s): ${sp066.map((e) => `${e.cardNumber}="${e.name}"`).join(", ")}`);
  allOk = check("S-P 066 duplicate pair auto-disambiguated", 2, sp066.length) && allOk;

  console.log("\n--- M-P ---");
  const mpRaw = countBSP(mpSection);
  const mpEntries = parseBlackStarPromoEntries(mpSection);
  allOk = check("raw entryjp lines", 1, mpRaw) && allOk;
  allOk = check("parsed total", 1, mpEntries.length) && allOk;
  console.log(`  M-P 001: name="${mpEntries[0]?.name}" category="${mpEntries[0]?.category}"`);
  allOk = check("M-P 001 name", "皮卡丘", mpEntries[0]?.name ?? "") && allOk;

  console.log("\n--- CSM2DC (GX起始卡组 交相辉映) ---");
  const csm2Raw = countSD(csm2Section);
  const csm2Entries = parseStarterDeckEntries(csm2Section);
  allOk = check("raw entryjp lines", 406, csm2Raw) && allOk;
  allOk = check("parsed total", 406, csm2Entries.length) && allOk;

  const csm2_001 = csm2Entries.find((e) => e.numbered && e.cardNumber === "001");
  console.log(`  CSM2DC 001: name="${csm2_001?.name}" category="${csm2_001?.category}" rarity=${csm2_001?.rarity ?? "null"}`);
  allOk = check("CSM2DC 001 name", "时拉比&妙蛙花GX", csm2_001?.name ?? "") && allOk;
  allOk = check("CSM2DC 001 rarity is null (— means none)", "null", String(csm2_001?.rarity ?? "null")) && allOk;

  const csm2Unnumbered = csm2Entries.filter((e) => !e.numbered);
  console.log(`  CSM2DC unnumbered ("-" position) entries: ${csm2Unnumbered.length}`);

  console.log("\n--- CSM1DC (GX起始卡组 横空出世) ---");
  const csm1Raw = countSD(csm1Section);
  const csm1Entries = parseStarterDeckEntries(csm1Section);
  allOk = check("raw entryjp lines", 381, csm1Raw) && allOk;
  allOk = check("parsed total", 381, csm1Entries.length) && allOk;

  console.log(`\n${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED — do not ship this parser as-is"}`);
  process.exit(allOk ? 0 : 1);
}

main();
