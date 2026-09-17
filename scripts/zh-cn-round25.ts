// Round 25 — continuing down the CSV (Scarlet & Violet) chain past round
// 24's CSV3C. Same track as rounds 13-24 (see src/lib/cnBoosterSetImport.ts
// and claude/spec.md for the full mechanism/history).
//
// This round's target is NOT a guess — it came directly from CSV3C's own
// {{ExpansionPrevNext|...}} chain reference, captured byte-for-byte in
// data/wiki-raw/fearless-terastal-round24-raw.txt:
//   `prev=奇迹启程, next=嘉奖回合, other=嗨皮组合 路卡利欧&甲贺忍蛙&藏玛然特&獒教父,
//    other2=宝石包 第二弹`
// (the two "other" fields are a Happy Set combo and a second Gem Pack
// wave — real but out of core-family scope, same as round 22's "收集啦151
// 旅"; this script does NOT chase those, only the direct `next=` chain.)
//
//   "嘉奖回合（TCG）" — plausibly CSV4C. Genuinely unconfirmed until fetched.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round25.ts > round25-raw.txt
// Then send round25-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "嘉奖回合（TCG）", // named directly by CSV3C's own chain ref (next=)
];

function checkBulkTables(text: string): string {
  const jpCount = (text.match(/\{\{卡牌列表\/entryjp\|/g) ?? []).length;
  const plainCount = (text.match(/\{\{卡牌列表\/entry\|/g) ?? []).length;
  const themeCount = (text.match(/\{\{主题牌组列表\/entry\|/g) ?? []).length;
  const parts: string[] = [];
  if (jpCount > 0) parts.push(`{{卡牌列表/entryjp|...}} x${jpCount}`);
  if (plainCount > 0) parts.push(`{{卡牌列表/entry|...}} x${plainCount}`);
  if (themeCount > 0) parts.push(`{{主题牌组列表/entry|...}} x${themeCount}`);
  return parts.length > 0 ? `USES: ${parts.join(", ")}` : "no known bulk-table template found";
}

function findCsCode(text: string): string {
  const matches = text.match(/CS[0-9A-Za-z.]*/g);
  if (!matches) return "(no CS-looking token found in page text)";
  const unique = Array.from(new Set(matches));
  return unique.join(", ");
}

function findPrevNext(text: string): string {
  const m = text.match(/\{\{ExpansionPrevNext\|[^}]*\}\}/);
  return m ? m[0] : "(no ExpansionPrevNext template found)";
}

async function printPage(title: string) {
  console.log(`\n=== ${title} ===`);
  const content = await fetchFullContent([title]);
  const text = content.get(title);
  if (!text) {
    console.log("(page not found)");
    return;
  }
  console.log(`[${checkBulkTables(text)}]`);
  console.log(`[CS code(s) mentioned in page text: ${findCsCode(text)}]`);
  console.log(`[chain reference: ${findPrevNext(text)}]`);
  console.log(text);
}

async function main() {
  for (let i = 0; i < TITLES.length; i++) {
    await printPage(TITLES[i]);
    if (i < TITLES.length - 1) await sleep(800);
  }
  console.log("\nDone. Save this whole output to a file and send it back.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
