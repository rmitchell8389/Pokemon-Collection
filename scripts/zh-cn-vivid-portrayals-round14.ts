// Round 14 — second pilot on the round-12 finding, continuing the CS-line
// walk after CS1 (Dynamax Clash) closed clean (766 cards, see claude/spec.md
// "zh-cn round 13").
//
// No more Bulbapedia guessing needed: CS1.5C's own captured wikitext
// (data/wiki-raw/dynamax-clash-round13-raw.txt line 629) carries its own
// {{ExpansionPrevNext|...}} template naming the NEXT sets in the same
// 剑&盾 chronological chain directly:
//   {{ExpansionPrevNext|草|虫|prev=极巨争锋 雷|prev2=极巨争锋 焰|next=浓墨重彩 黎|next2=浓墨重彩 靛}}
// "浓墨重彩 黎"/"浓墨重彩 靛" are a strong-but-not-yet-independently-confirmed
// lead for CS2aC/CS2bC ("Vivid Portrayals (Obsidian)/(Indigo)" per TCG
// Collector's English name) — this script is exactly how round 13 confirmed
// CS1's titles, so if either guess is wrong it'll just report "page not
// found" and the chain (this same page's OWN ExpansionPrevNext, once
// fetched) will very likely point at the correct sibling title directly,
// same fix CS1bC needed.
//
// Also fetching two more CS2-line codes from the round-12 gap table
// (CS2.1C "Meowth's Little Tricks", CS2.5C "Brilliant Counterattack") —
// titles guessed by the same naming pattern CS1.5C/CSAC used (a short
// standalone product name, no "剑&盾"/"极巨争锋" prefix) since neither has
// been found via a chain reference yet. Expect some 404s here; that's the
// scout step doing its job, not a failure.
//
// Needs live wiki access — will NOT work from this sandbox. Run from a real
// machine, same as every other zh-cn scout script.
//
// Usage: npx tsx scripts/zh-cn-vivid-portrayals-round14.ts > vivid-portrayals-round14-raw.txt

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "浓墨重彩 黎（TCG）", // CS2aC candidate, Vivid Portrayals (Obsidian) — from CS1.5C's own chain ref
  "浓墨重彩 靛（TCG）", // CS2bC candidate, Vivid Portrayals (Indigo) — from CS1.5C's own chain ref
  "猫铃奇计（TCG）", // CS2.1C candidate, Meowth's Little Tricks — guessed, unconfirmed
  "光辉出击（TCG）", // CS2.5C candidate, Brilliant Counterattack — guessed, unconfirmed
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
