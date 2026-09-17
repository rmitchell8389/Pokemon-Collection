// Round 27 — continuing down the CSV (Scarlet & Violet) chain past round
// 26's CSV5C. Same track as rounds 13-26 (see src/lib/cnBoosterSetImport.ts
// and claude/spec.md for the full mechanism/history).
//
// This round's target is NOT a guess — it came directly from CSV5C's own
// {{ExpansionPrevNext|...}} chain reference, captured byte-for-byte in
// data/wiki-raw/ardent-obsidian-round26-raw.txt:
//   `prev=嘉奖回合, next=真实玄虚, other=嗨皮组合 七夕青鸟&拉帝欧斯&烈焰猴&一家鼠,
//    other2=`
// (the `other` field is a Happy Set combo — real but out of core-family
// scope; this script does NOT chase it, only the direct `next=` chain.)
//
//   "真实玄虚（TCG）" — plausibly CSV6C. Genuinely unconfirmed until fetched.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round27.ts > round27-raw.txt
// Then send round27-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "真实玄虚（TCG）", // named directly by CSV5C's own chain ref (next=)
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
