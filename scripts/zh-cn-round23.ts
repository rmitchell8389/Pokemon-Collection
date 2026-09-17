// Round 23 — first target inside the CSV (Scarlet & Violet) line, now that
// round 22 confirmed CSV1C ("亘古开来") is real and IS one of the 10-code
// CSV1C-CSV10C family named in the original gap list. Same track as
// rounds 13-22 (see src/lib/cnBoosterSetImport.ts and claude/spec.md for
// the full mechanism/history).
//
// This round's target is NOT a guess — it came directly from CSV1C's own
// {{ExpansionPrevNext|...}} chain reference, captured byte-for-byte in
// data/wiki-raw/ancient-times-future-progress-round22-raw.txt:
//   `prev=胜象星引, next=奇迹启程, other=收集啦151 旅, other2=宝石包 第一弹`
//
//   "奇迹启程（TCG）" — plausibly CSV2C (literally "Miracle Journey Begins"
//     — matches the "Journey"/"beginning" framing Scarlet & Violet's own
//     first-wave sets used). Genuinely unconfirmed until fetched.
//
// Note: CSV1C's OWN "other"/"other2" fields point to two side-line
// products ("收集啦151 旅" already confirmed in round 22 as alt=151C, out
// of the core 29-code scope; "宝石包 第一弹" not yet investigated) — this
// script does NOT chase those, only the direct "next=" chain into CSV2C.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round23.ts > round23-raw.txt
// Then send round23-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "奇迹启程（TCG）", // named directly by CSV1C's own chain ref (next=)
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
