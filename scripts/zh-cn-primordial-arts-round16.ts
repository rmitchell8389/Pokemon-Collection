// Round 16 — continuing the CS-line walk. CS2.5C's own captured wikitext
// (data/wiki-raw/brilliant-counterattack-round15-raw.txt line 5) names the
// next sets in the chain directly:
//   {{ExpansionPrevNext|斗C|白|prev=浓墨重彩 黎|prev2=浓墨重彩 靛|next=洪荒演武 茂|next2=洪荒演武 激}}
// "洪荒演武 茂"/"洪荒演武 激" are a strong lead for CS3aC/CS3bC ("Primordial
// Arts (Overgrow)/(Torrent)" per TCG Collector, targets 290/283) — same
// chain-reference method that already confirmed CS2aC/CS2bC/CS2.5C.
//
// Also probing two more CS3-line codes from the round-12 gap table by the
// same short-name guessing pattern CS1.5C/CSAC/CS2.5C used (expect some
// 404s, that's normal):
//   CS3DC "Primordial Arts V Starter Deck" (target 183) — guessed as a
//     "V起始卡组 {name}" title, same pattern as CS1DC
//   CSBC/CSCC "Primordial Arts Deck Building Gift Box (Overgrow/Torrent)"
//     (targets 19/19) — guessed as "{name} 卡组构筑礼盒", same pattern as CSAC
//
// Needs live wiki access — will NOT work from this sandbox. Run from a real
// machine, same as every other zh-cn scout script.
//
// Usage: npx tsx scripts/zh-cn-primordial-arts-round16.ts > primordial-arts-round16-raw.txt

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "洪荒演武 茂（TCG）", // CS3aC candidate, Primordial Arts (Overgrow) — from CS2.5C's own chain ref
  "洪荒演武 激（TCG）", // CS3bC candidate, Primordial Arts (Torrent) — from CS2.5C's own chain ref
  "V起始卡组 洪荒演武（TCG）", // CS3DC candidate — guessed, unconfirmed
  "洪荒演武 卡组构筑礼盒（TCG）", // CSBC/CSCC candidate — guessed, unconfirmed (may be one shared article or two)
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
  const matches = text.match(/CS3[A-Za-z0-9.]*/g);
  if (!matches) return "(no CS3-looking token found in page text)";
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
  console.log(`[CS3 code(s) mentioned in page text: ${findCsCode(text)}]`);
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
