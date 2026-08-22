// Round 13 — first pilot on the round-12 finding: the 28 plain numbered
// booster sets account for a combined 6,838-card gap and have never had a
// dedicated importer built. Starting with the Sword & Shield-era CS1 line
// (Dynamax Clash) as the pilot, same as every other zh-cn thread in this
// project — confirm the real wiki article(s) exist and use the bulk-table
// template before writing any parsing code.
//
// Real Chinese title found via Bulbapedia's "Dynamax Clash (ATCG)" page
// (Simplified Chinese: 剑&盾 极巨争锋, set itself 极巨争锋) plus a direct
// wiki.52poke.com search API hit confirming these exact titles exist:
//   极巨争锋 雷（TCG）   <- CS1aC "Dynamax Clash (Thunder)", 329 cards target
//   极巨争锋 炎（TCG）   <- CS1bC "Dynamax Clash (Flame)", 315 cards target
//   V起始卡组 极巨争锋（TCG）  <- CS1DC "Dynamax Clash V Starter Deck", 222 target
//   极巨争锋 卡组构筑礼盒（TCG）  <- CSAC "Dynamax Clash Deck Building Gift Box", 24 target
// One more candidate, NOT confirmed via search (found via a second
// Bulbapedia page, "Dynamax Tactics (ATCG)": Chinese name "强化包 极巨攻防"
// — guessing the real wiki title drops the "强化包" qualifier the same way
// the other titles above don't carry their own product-type prefix):
//   极巨攻防（TCG）  <- CS1.5C "Dynamax Tactics", 141 cards target — UNCONFIRMED, may 404
//
// This script fetches all 5, checks each for BOTH known bulk-table template
// shapes (the {{卡牌列表/entryjp|...}} shape SM-P/SV-P/S-P/M-P/Gem Packs use,
// and the {{卡牌列表/entry|...}} shape — no "jp" — starter decks/Happy Set
// sub-pools use), and reports which CS1-looking codes each page names
// itself as, so nothing has to be guessed twice.
//
// Needs live wiki access — will NOT work from this sandbox. Run from a real
// machine, same as every other zh-cn scout script.
//
// Usage: npx tsx scripts/zh-cn-dynamax-clash-round13.ts > dynamax-clash-round13-raw.txt

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "极巨争锋 雷（TCG）",
  "极巨争锋 炎（TCG）",
  "V起始卡组 极巨争锋（TCG）",
  "极巨争锋 卡组构筑礼盒（TCG）",
  "极巨攻防（TCG）",
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
  const matches = text.match(/CS1[A-Za-z0-9.]*/g);
  if (!matches) return "(no CS1-looking token found in page text)";
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
  console.log(`[${checkBulkTables(text)}]`);
  console.log(`[CS1 code(s) mentioned in page text: ${findCsCode(text)}]`);
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
