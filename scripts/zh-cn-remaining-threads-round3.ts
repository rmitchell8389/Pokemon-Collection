// Round 3 — direct fetches of specific pages identified by round 2's
// searches, not more blind guessing. See claude/spec.md "zh-cn round 7" for
// the full context once written.
//
// Six known targets:
//   1. S-P简体中文版特典卡（TCG）  — a Black Star Promo sibling to SM-P/SV-P,
//      named in SV-P's own {{ExpansionPrevNext|...|prev=S-P简体中文版特典卡}}
//      navigation template but never directly checked.
//   2. M-P简体中文版特典卡（TCG）  — same navigation template's "next" sibling
//      after SV-P — likely the newest generation's promo line.
//   3. GX起始卡组 交相辉映（TCG） — CSM2DC's own dedicated article (357-card
//      starter deck, only 49 currently covered via the per-card reprint
//      pattern) — checking whether it uses the same bulk-table template
//      Gem Packs/SM-P/SV-P use, which would close the other ~300 cards.
//   4. GX起始卡组 横空出世（TCG） — same check for CSM1DC (336 total, 59 covered).
//   5. 大师战略卡组构筑套装 猛雷鼓ex · 多龙巴鲁托ex · 赛富豪ex（TCG） — the second
//      Master Strategy Deck wave's container article (CSVM2/CSVM2C in TCG
//      Collector's scheme) — CSVM2a/b/c are all at 0 rows currently, this
//      checks whether it's a bulk-table page and what the real per-deck
//      codes are (batch2.ts guessed CSVM2aC/bC/cC — may not be exact).
//   6. Also a generalSearch("嗨皮组合") — the REAL Chinese name for "Happy
//      Set" (a phonetic transliteration, not a translation — every
//      alternate-translation guess in round 2 missed it for this reason).
//      Should surface CSVH5C (currently 0 rows, missing entirely) and any
//      other Happy Set article not yet in the DB.
//
// Needs live wiki access — will NOT work from this sandbox. Run from a
// real machine, same as every other zh-cn scout script.
//
// Usage: npx tsx scripts/zh-cn-remaining-threads-round3.ts > round3-raw.txt

import { fetchFullContent, fetchJsonWithRetry, sleep, WIKI_API_BASE } from "../src/lib/cnReprintImport";

interface WikiSearchResponse {
  query?: { search?: { title: string }[] };
}

async function generalSearch(query: string, limit = 20): Promise<string[]> {
  const url = new URL(WIKI_API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("format", "json");
  const data = await fetchJsonWithRetry<WikiSearchResponse>(url.toString());
  return (data?.query?.search ?? []).map((h) => h.title);
}

function checkBulkTable(text: string): string {
  const count = (text.match(/\{\{卡牌列表\/entryjp\|/g) ?? []).length;
  return count > 0 ? `USES bulk-table template — ${count} {{卡牌列表/entryjp|...}} entries found` : "no {{卡牌列表/entryjp|...}} template found";
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
  console.log(text);
}

async function main() {
  await printPage("S-P简体中文版特典卡（TCG）");
  await sleep(800);
  await printPage("M-P简体中文版特典卡（TCG）");
  await sleep(800);
  await printPage("GX起始卡组 交相辉映（TCG）");
  await sleep(800);
  await printPage("GX起始卡组 横空出世（TCG）");
  await sleep(800);
  await printPage("大师战略卡组构筑套装 猛雷鼓ex · 多龙巴鲁托ex · 赛富豪ex（TCG）");
  await sleep(800);

  console.log("\n=== generalSearch(\"嗨皮组合\") — real 'Happy Set' name ===");
  console.log((await generalSearch("嗨皮组合")).join(", ") || "(0 hits)");

  console.log("\nDone. Paste this whole output back (or better, save to a file and send it).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
