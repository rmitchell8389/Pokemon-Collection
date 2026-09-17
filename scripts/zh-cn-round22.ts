// Round 22 — continuing the booster-set row-import chain past round 21's
// CS6.5C. Same track as rounds 13-21 (see src/lib/cnBoosterSetImport.ts and
// claude/spec.md for the full mechanism/history) — the 29-code
// plain-numbered-booster-set gap.
//
// Both targets this round are NOT guesses — they came directly from
// CS6.5C's own {{ExpansionPrevNext|...}} chain reference, captured
// byte-for-byte in data/wiki-raw/victory-lodestar-round21-raw.txt:
//   `prev=碧海暗影 啸, prev2=碧海暗影 逐, next=收集啦151 旅, next2=亘古开来`
//
// Unlike every prior round, this one names TWO DIFFERENT next titles, not
// a single aC/bC pair sharing a name stem — this is the first branch point
// past the entire CS1-CS6 (Sword & Shield line) family:
//   "收集啦151 旅" — plausibly a Scarlet & Violet-era "151" crossover
//     product ("收集啦151" reads like "Collect 'em All 151").
//   "亘古开来" — plausibly an "ancient"-themed Scarlet & Violet set
//     ("亘古" = "since time immemorial" / "ancient").
// Both genuinely unconfirmed until fetched. This may be the doorway into
// the CSM (Storming Emergence) or CSV (Scarlet & Violet) line the
// round-12 reconciliation still needs a way into — but that's a working
// bet, not a confirmed fact, until this capture comes back.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round22.ts > round22-raw.txt
// Then send round22-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "收集啦151 旅（TCG）", // named directly by CS6.5C's own chain ref (next=)
  "亘古开来（TCG）", // named directly by CS6.5C's own chain ref (next2=)
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
