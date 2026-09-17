// Round 21 — continuing the booster-set row-import chain past round 20's
// CS6aC/CS6bC. Same track as rounds 13-20 (see src/lib/cnBoosterSetImport.ts
// and claude/spec.md for the full mechanism/history) — the 29-code
// plain-numbered-booster-set gap.
//
// This round's single target is NOT a guess — it came directly from BOTH
// CS6aC's and CS6bC's own {{ExpansionPrevNext|...}} chain references,
// captured byte-for-byte in data/wiki-raw/shadow-blue-sea-round20-raw.txt:
//   CS6aC: `prev=暗影夺辉, other=碧海暗影 逐, next=胜象星引`
//   CS6bC: `prev=暗影夺辉, other=碧海暗影 啸, next=胜象星引`
// Both name the exact same next title, so this is a strong lead.
//
//   "胜象星引（TCG）" — first title in the chain past the entire CS1-CS6
//     (Sword & Shield line) family. Plausibly the start of the CSM
//     (Storming Emergence) or CSV (Scarlet & Violet) line the round-12
//     reconciliation still needs a way into — but genuinely unconfirmed
//     until fetched. If this page has an `other=` sibling in its own
//     ExpansionPrevNext template, that sibling is likely this same set's
//     other half (an aC/bC pair, matching every prior CS-family release).
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round21.ts > round21-raw.txt
// Then send round21-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "胜象星引（TCG）", // named directly by BOTH CS6aC's and CS6bC's own chain refs
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
