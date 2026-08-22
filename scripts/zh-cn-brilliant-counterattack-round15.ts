// Round 15 — continuing the CS-line walk. CS2aC's own captured wikitext
// (data/wiki-raw/vivid-portrayals-round14-raw.txt line 5) names the next
// set in the chain directly:
//   {{ExpansionPrevNext|银|LE|prev=极巨攻防|next=璀璨反击|next2=|other=浓墨重彩 靛}}
// "璀璨反击" is a strong lead for CS2.5C ("Brilliant Counterattack" per TCG
// Collector, target 126 cards) — round 14's guessed title for this same set
// ("光辉出击") was wrong and 404'd; this is the real one, straight from the
// wiki's own cross-reference, same fix pattern as CS1bC in round 13.
//
// CS2.1C ("Meowth's Little Tricks", target 10 cards) still has no known
// real title — not guessed again here, will come from whatever chain
// reference this page (or CS3's, once found) turns up.
//
// Needs live wiki access — will NOT work from this sandbox. Run from a real
// machine, same as every other zh-cn scout script.
//
// Usage: npx tsx scripts/zh-cn-brilliant-counterattack-round15.ts > brilliant-counterattack-round15-raw.txt

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = ["璀璨反击（TCG）"];

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
  const matches = text.match(/CS2[A-Za-z0-9.]*/g);
  if (!matches) return "(no CS2-looking token found in page text)";
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
  console.log(`[CS2 code(s) mentioned in page text: ${findCsCode(text)}]`);
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
