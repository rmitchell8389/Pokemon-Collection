// Round 28 — continuing down the CSV (Scarlet & Violet) chain past round
// 27's CSV6C. Same track as rounds 13-27 (see src/lib/cnBoosterSetImport.ts
// and claude/spec.md for the full mechanism/history).
//
// This round's target is NOT a guess — it came directly from CSV6C's own
// {{ExpansionPrevNext|...}} chain reference, captured byte-for-byte in
// data/wiki-raw/arcane-truth-round27-raw.txt:
//   `prev=黑晶炽诚, next=利刃猛醒, other=游历专题包, other2=`
// (the `other` field is a side-product tour set — real but out of
// core-family scope; this script does NOT chase it, only the direct
// `next=` chain.)
//
//   "利刃猛醒（TCG）" — already INDEPENDENTLY confirmed as CSV7C via a
// completely separate work thread: claude/spec.md's "Feature completion:
// CSV7C zh-cn manual image backfill (2026-08-26)" section confirmed this
// title = CSV7C, 204 real cards, clean identity mapping, images already
// backfilled via that track. Two independent methods now agree on the
// identity. This round's fetch is mainly to obtain the actual card-row
// bulk-table data (which the image-backfill track never captured), plus
// to confirm the `alt=` code and chain reference directly from the page
// itself before committing anything to code.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round28.ts > round28-raw.txt
// Then send round28-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "利刃猛醒（TCG）", // named directly by CSV6C's own chain ref (next=); already known as CSV7C from image-backfill track
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
