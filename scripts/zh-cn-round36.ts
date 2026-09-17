// Round 36 — direct fetch of all 8 real titles round 35 turned up for the
// CSM1/CSM2 family, using the same simple, reliable fixed-title pattern
// every prior round in this chain has used (e.g. round 34's two-title
// fetch), rather than round 35's own two-phase search script, which
// completed the search step fine but crashed silently partway through its
// variable-length phase 2 fetch loop twice in a row (once from an unguarded
// exception, once for a reason still unclear — possibly a slow/blocked
// response on one of the ~23 raw search-result candidates, several of which
// were generic unrelated glossary pages like 闪卡（TCG）or 名词列表（TCG）).
// Rather than debug that further, this round just targets the 8 titles that
// actually matter, confirmed real by two independent sources already:
//   - The CSM1/CSM2 hub pages named every sub-code directly in plain text:
//     CSM1aC=横空出世 赫, CSM1bC=横空出世 苍, CSM1cC=横空出世 泽;
//     CSM2aC=交相辉映 沐, CSM2bC=交相辉映 魁, CSM2cC=交相辉映 唤.
//   - CSM1aC's own {{ExpansionPrevNext}} (already confirmed via alt=CSM1aC
//     in round 35's partial run) names 横空出世 苍/泽 directly via
//     other=/other2= — the same real-chain-reference mechanism every other
//     set in this whole 34-round chain has been validated through.
//   - 对战精英（TCG）and 炫奇争胜（TCG）carry the shortcuts "CSM1.5" and
//     "CSM2.5" respectively (seen directly in round 35's raw search
//     snippets) — the CSM1.5C/CSM2.5C bridge sets `claude/spec.md`'s own
//     round-18 breakdown already listed as untouched targets.
//
// CSM1aC (横空出世 赫) and CSM2aC (交相辉映 沐) were already confirmed via a
// real alt= fetch in round 35 (cards=211 and cards=150+ respectively, both
// using the same {{卡牌列表/entryjp|...}} bulk template already parsed by
// cnBoosterSetImport.ts) — refetched here too, for a single complete,
// self-contained raw capture covering the whole family in one file.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again every round: direct fetch from the sandbox to wiki.52poke.com times
// out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round36.ts > round36-raw.txt
// Then send round36-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "横空出世 赫（TCG）", // CSM1aC — already confirmed in round 35, re-confirming here
  "横空出世 苍（TCG）", // CSM1bC — named by CSM1 hub + CSM1aC's own chain ref
  "横空出世 泽（TCG）", // CSM1cC — named by CSM1 hub + CSM1aC's own chain ref
  "交相辉映 沐（TCG）", // CSM2aC — already confirmed in round 35, re-confirming here
  "交相辉映 魁（TCG）", // CSM2bC — named by CSM2 hub + CSM2aC's own chain ref
  "交相辉映 唤（TCG）", // CSM2cC — named by CSM2 hub + CSM2aC's own chain ref
  "对战精英（TCG）", // CSM1.5C candidate — carries shortcut "CSM1.5" per round 35
  "炫奇争胜（TCG）", // CSM2.5C candidate — carries shortcut "CSM2.5" per round 35
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

function findAlt(text: string): string {
  const m = text.match(/alt\s*=\s*([A-Za-z0-9.]+)/);
  return m ? m[1] : "(none found)";
}

function findCards(text: string): string {
  const m = text.match(/cards\s*=\s*([^\n|]*)/);
  return m ? m[1].trim() : "(no cards= field found)";
}

function findPrevNext(text: string): string {
  const m = text.match(/\{\{ExpansionPrevNext\|[^}]*\}\}/);
  return m ? m[0] : "(no ExpansionPrevNext template found)";
}

async function printPage(title: string) {
  console.log(`\n=== ${title} ===`);
  try {
    const content = await fetchFullContent([title]);
    const text = content.get(title);
    if (!text) {
      console.log("(page not found)");
      return;
    }
    console.log(`[alt= field: ${findAlt(text)}]`);
    console.log(`[cards= field: ${findCards(text)}]`);
    console.log(`[${checkBulkTables(text)}]`);
    console.log(`[chain reference: ${findPrevNext(text)}]`);
    console.log(text);
  } catch (err) {
    console.log(`[fetch error: ${String(err)}]`);
  }
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
