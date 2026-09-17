// Round 19 — continuing the booster-set row-import chain past round 18's
// CS4.5C. Same track as round 13-18 (see src/lib/cnBoosterSetImport.ts and
// claude/spec.md "zh-cn round 18" for the full mechanism/history) — this is
// the 29-code plain-numbered-booster-set gap (5,475 cards as of the last
// fresh reconciliation), NOT the separate manual-image-backfill track.
//
// This round's targets, all sourced from CS4.5C's own chain reference
// (`other=伊布进阶礼盒|next=勇魅群星 魅|next2=勇魅群星 勇`, already recorded in
// cnBoosterSetImport.ts's round-18 comment) plus one light-lookup step taken
// THIS session via WebFetch (unreliable for bulk card data, but treated as
// reliable enough for existence/infobox/chain-ref checks per this project's
// established discipline — see round 18's own header comment):
//
//   "勇魅群星 魅（TCG）" — CS5aC candidate. WebFetch light-lookup this session
//     confirmed real, alt=CS5aC, infobox cards=127+49 (decorative
//     undercount as always). Its own chain: prev=终末炎舞,
//     other=勇魅群星 勇, next=暗影夺辉.
//   "勇魅群星 勇（TCG）" — CS5bC candidate. Same light-lookup, confirmed
//     real, alt=CS5bC, cards=128+50. Chain: prev=终末炎舞,
//     other=勇魅群星 魅, next=暗影夺辉.
//
//   IMPORTANT CHARACTER-TRANSCRIPTION FLAG, not yet resolved: two different
//   WebFetch calls this session disagreed on the middle character —
//   one read "勇魅群星" (魅), a second, separate API-formatted fetch read
//   "勇魂群星" (魂) for the same two pages. Both fetches otherwise agreed on
//   alt=/cards=/chain fields, and the direct page-title fetch using "魅"
//   DID resolve to real content (a wrong title would 404, per this
//   project's own repeated experience with title guesses) — so "魅" is the
//   better-supported reading and is what's used below, but this is a
//   light-lookup call, not a raw-capture confirmation. If this script 404s
//   on either title, the FIRST thing to try is swapping 魅 for 魂 (or vice
//   versa) before assuming the set doesn't exist.
//
//   "暗影夺辉（TCG）" — CS5.5C candidate (a bridge set, following the exact
//     same pattern as CS3.5C/CS4.5C before it — a single lead article whose
//     OWN chain reference should name the next pair, CS6aC/CS6bC). Named as
//     "next=" by BOTH CS5aC's and CS5bC's chain refs. A wiki search this
//     session confirmed the page exists (one search hit, title verbatim),
//     but WebFetch hit a hard rate limit (429, same wall round 18 hit)
//     before its own infobox/chain fields could be read — genuinely
//     unconfirmed beyond "the page exists," not guessed at.
//
//   "伊布进阶礼盒（TCG）" — named as "other=" by CS4.5C's own chain reference
//     (Eevee starter kit / gift box). NOT the same family as the 29
//     plain-numbered booster codes (round-12's reconciliation doesn't
//     include an Eevee starter kit in that 29-code list) — likely belongs
//     with the starter-deck/gift-box importers instead if real, but
//     capturing it here since it's a zero-extra-cost chain-ref freebie.
//     Completely unconfirmed — not even a light-lookup done yet this
//     session.
//
// Genuinely NOT yet reached by this chain at all: CSM1aC/bC/cC (Storming
// Emergence), CSM2aC/bC/cC (Shining Synergy), CSV1C-CSV10C (Eternal Birth
// through Chasing Glory) — the other 14 of the 29 still-uncommitted codes.
// No chain reference found so far points at any of them; the working
// assumption (not confirmed) is that continuing this same forward chain
// past CS6aC/CS6bC will eventually reach them, the same way CS1's chain
// eventually reached CS4/CS5 several rounds later. Round 20 picks this back
// up once CS5.5C's (暗影夺辉's) own chain reference is in hand.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again, same as every prior round: direct curl/fetch from the sandbox to
// wiki.52poke.com times out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round19.ts > round19-raw.txt
// Then send round19-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "勇魅群星 魅（TCG）", // CS5aC candidate — light-lookup confirmed real this session, need full raw text
  "勇魅群星 勇（TCG）", // CS5bC candidate — light-lookup confirmed real this session, need full raw text
  "暗影夺辉（TCG）", // CS5.5C candidate — confirmed to exist via wiki search this session, content unconfirmed (rate limited)
  "伊布进阶礼盒（TCG）", // unconfirmed gift-box lead from CS4.5C's other=
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
