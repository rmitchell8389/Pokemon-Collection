// Round 34 — round 33's target, "雳焰激荡" (CSV11C, confirmed by title/alt
// but page is an unpublished stub — see below), branches into TWO next
// titles in its own {{ExpansionPrevNext}} chain reference, captured
// byte-for-byte in the round-33 raw output:
//   `prev=共逐荣光, next=黑雷奔流, next2=白雷迸涌, other=, other2=`
// This looks like a paired-set release (echoing the CS1aC/CS1bC dual-
// starter pattern from the very start of this whole chain, rounds ago).
// Fetching both in one pass since they're both directly named, not
// guesses.
//
// IMPORTANT CONTEXT: round 33's own target page, "雳焰激荡（TCG）", turned
// out to be an unpublished/incomplete stub on the wiki — alt=CSV11C is
// confirmed, but `cards=` is empty, `release=` is empty, `official=` is
// empty, and the card-list section has zero entries (no known bulk-table
// template found at all). That set was NOT added to BOOSTER_SETS this
// round because there is no real card data yet to validate against —
// only the code identity is confirmed. If 黑雷奔流 and/or 白雷迸涌 are
// ALSO still-stub pages, do not add them either; just report what's on
// each page (title, alt code if present, chain reference, entry count)
// so the next round can be planned from real information.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round34.ts > round34-raw.txt
// Then send round34-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "黑雷奔流（TCG）", // named directly by CSV11C's own chain ref (next=)
  "白雷迸涌（TCG）", // named directly by CSV11C's own chain ref (next2=)
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
