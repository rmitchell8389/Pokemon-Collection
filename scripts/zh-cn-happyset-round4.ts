// Round 4 — Happy Set (CSVH1C-5C) deep check.
//
// The report Ross just ran (import-cn-reprint-sets-batch2.ts CSVH4C CSVH5C)
// only found 3 cards for CSVH4C (unchanged from what was already in the DB)
// and 0 for CSVH5C — meaning round 8's "no new code needed, just re-run the
// existing per-card reprint importer" conclusion was WRONG. The per-card
// cnicon= search mechanism isn't finding the real card lists.
//
// Why: round 3's generalSearch("嗨皮组合") turned up FIVE dedicated deck
// articles, each named after its 4 headline Pokemon:
//   嗨皮组合 狙射树枭&美录梅塔&故勒顿&密勒顿（TCG）  <- this is the one
//     batch2.ts's search actually landed on for CSVH4C, with only 3 hits
//   嗨皮组合 路卡利欧&甲贺忍蛙&藏玛然特&獒教父（TCG）
//   嗨皮组合 快龙&超梦&喷火驼&来悲粗茶（TCG）
//   嗨皮组合 七夕青鸟&拉帝欧斯&烈焰猴&一家鼠（TCG）
//   嗨皮组合 皮卡丘&皮皮&草苗龟&索财灵（TCG）
// plus a bare umbrella page: 嗨皮组合（TCG）
//
// This is the exact same shape as the GX起始卡组 (Starter Deck) container
// articles that turned out to hold a FULL {{卡牌列表/entryjp|...}} bulk
// table apiece (357/336 real cards vs. 49/59 the per-card search alone
// found). Working theory: these 5 Happy Set articles are the same kind of
// container, and the per-card cnicon= mechanism is only catching a handful
// of stray individual card-page references, not the real list.
//
// This script fetches all 5 named articles + the umbrella page directly,
// checks each for the bulk-table template, and prints which CSVH code each
// one names itself as (via {{快捷方式|...}} or any CSVH-looking token in the
// text) so the real code-to-article mapping doesn't have to be guessed.
//
// Needs live wiki access — will NOT work from this sandbox. Run from a real
// machine, same as every other zh-cn scout script.
//
// Usage: npx tsx scripts/zh-cn-happyset-round4.ts > happyset-round4-raw.txt

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const DECK_TITLES = [
  "嗨皮组合 狙射树枭&美录梅塔&故勒顿&密勒顿（TCG）",
  "嗨皮组合 路卡利欧&甲贺忍蛙&藏玛然特&獒教父（TCG）",
  "嗨皮组合 快龙&超梦&喷火驼&来悲粗茶（TCG）",
  "嗨皮组合 七夕青鸟&拉帝欧斯&烈焰猴&一家鼠（TCG）",
  "嗨皮组合 皮卡丘&皮皮&草苗龟&索财灵（TCG）",
  "嗨皮组合（TCG）",
];

function checkBulkTable(text: string): string {
  const count = (text.match(/\{\{卡牌列表\/entryjp\|/g) ?? []).length;
  return count > 0
    ? `USES bulk-table template — ${count} {{卡牌列表/entryjp|...}} entries found`
    : "no {{卡牌列表/entryjp|...}} template found";
}

function findCsvhCode(text: string): string {
  const matches = text.match(/CSVH\d[A-Za-z]*/g);
  if (!matches) return "(no CSVH-looking token found in page text)";
  const unique = Array.from(new Set(matches));
  return unique.join(", ");
}

async function printPage(title: string) {
  console.log(`\n=== ${title} ===`);
  const content = await fetchFullContent([title]);
  const text = content.get(title);
  if (!text) {
    console.log("(page not found)");
    return;
  }
  console.log(`[${checkBulkTable(text)}]`);
  console.log(`[CSVH code(s) mentioned in page text: ${findCsvhCode(text)}]`);
  console.log(text);
}

async function main() {
  for (let i = 0; i < DECK_TITLES.length; i++) {
    await printPage(DECK_TITLES[i]);
    if (i < DECK_TITLES.length - 1) await sleep(800);
  }
  console.log("\nDone. Save this whole output to a file and send it back.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
