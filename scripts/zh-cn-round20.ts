// Round 20 — continuing the booster-set row-import chain past round 19's
// CS5aC/CS5bC/CS5.5C. Same track as rounds 13-19 (see
// src/lib/cnBoosterSetImport.ts and claude/spec.md for the full
// mechanism/history) — the 29-code plain-numbered-booster-set gap.
//
// This round's targets are NOT guesses — both titles came directly from
// CS5.5C's own {{ExpansionPrevNext|...}} chain reference, captured
// byte-for-byte in data/wiki-raw/gallant-galaxy-round19-raw.txt:
//   `prev=勇魅群星 魅, prev2=勇魅群星 勇, next=碧海暗影 啸, next2=碧海暗影 逐`
//
//   "碧海暗影 啸（TCG）" — CS6aC candidate (Shadow of the Blue Sea line,
//     matching this project's own translation for that code family from
//     round 18's fresh-reconciliation section — 碧海暗影 literally means
//     "blue sea shadow").
//   "碧海暗影 逐（TCG）" — CS6bC candidate, same line.
//
// Neither has been light-looked-up or raw-captured yet this session —
// genuinely unconfirmed beyond "this is what CS5.5C's own page says comes
// next," which is the same evidentiary bar every other title in this
// chain has been added to BOOSTER_SETS on.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round20.ts > round20-raw.txt
// Then send round20-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "碧海暗影 啸（TCG）", // CS6aC candidate — named directly by CS5.5C's own chain ref
  "碧海暗影 逐（TCG）", // CS6bC candidate — named directly by CS5.5C's own chain ref
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
