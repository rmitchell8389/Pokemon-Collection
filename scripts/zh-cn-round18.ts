// Round 18 — continuing the booster-set row-import chain past round 16/17.
// This is a DIFFERENT track from the manual-image-backfill rounds (round
// 1-10 in claude/spec.md's "Feature completion" numbering) — this one
// builds real card ROWS for the 28 plain numbered zh-cn booster sets that
// round 12's reconciliation found sitting at 1-30% coverage (a 6,838-card
// combined gap, see claude/spec.md "zh-cn round 12"). Rounds 13-16 already
// closed CS1/CS2/CS2.5C and confirmed-but-not-committed CS3aC/CS3bC/CS3DC.
//
// Claude confirmed 3 new real titles this round via WebFetch (which turned
// out to reach wiki.52poke.com fine, but summarizes/truncates large pages —
// not trustworthy for exact card data, only for confirming a page exists
// and reading its short infobox/chain-reference fields):
//   CS3.5C "怒炎灼天（TCG）" — CS3aC's AND CS3bC's own chain refs both name
//     this as next. Confirmed real, alt=CS3.5C, infobox cards=66+24 (as
//     always, decorative/undercounted vs the real gallery count — round 12
//     shows this set's real TCG Collector target is 147). Its own chain:
//     next=九彩汇聚 朋, next2=九彩汇聚 源.
//   CS4aC "九彩汇聚 朋（TCG）" — confirmed real, alt=CS4aC, ~184 entries
//     (001/132 through 184/132 — matches Nine Colors Gathering's already-
//     known code from round 12). Chain: next=终末炎舞, other=九彩汇聚 谱.
//   CS4bC "九彩汇聚 源（TCG）" — confirmed real, alt=CS4bC, ~177 entries
//     (001/132 through 177/132). Chain: next=终末炎舞, other=九彩汇聚 谱.
//
// Two more leads from those chain refs, NOT yet confirmed (page existence
// unchecked — WebFetch hit a rate limit before these could be tried):
//   CS4.5C candidate: "终末炎舞（TCG）" (Final Flame Dance per round 12's
//     translation, target 136) — named as "next" by BOTH CS4aC and CS4bC,
//     strong lead.
//   Unknown CS4-family candidate: "九彩汇聚 谱（TCG）" — named as "other" by
//     both CS4aC and CS4bC but not otherwise identified. Could be a starter
//     deck, gift box, or third booster variant — genuinely unknown, worth
//     a look even though it might 404 or turn out irrelevant.
//
// Also retrying two round-17 guesses that never got checked (round 17's
// script was built but not yet run):
//   CSBC/CSCC "洪荒演武 双人对战卡组（TCG）" — Primordial Arts gift box guess.
//   CS2.1C "猫铃奇计 卡组构筑礼盒（TCG）" — Meowth's Little Tricks guess.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again this round: direct curl/fetch from the sandbox to wiki.52poke.com
// times out with no route, same as every prior round's note). Run from a
// real machine.
//
// Usage: npx tsx scripts/zh-cn-round18.ts > round18-raw.txt
// Then send round18-raw.txt back (paste the content or attach the file).

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

const TITLES = [
  "怒炎灼天（TCG）", // CS3.5C — confirmed real via WebFetch this round, need full raw text
  "九彩汇聚 朋（TCG）", // CS4aC — confirmed real via WebFetch this round, need full raw text
  "九彩汇聚 源（TCG）", // CS4bC — confirmed real via WebFetch this round, need full raw text
  "终末炎舞（TCG）", // CS4.5C candidate — named by both CS4aC's and CS4bC's own chain refs, unconfirmed
  "九彩汇聚 谱（TCG）", // unknown CS4-family candidate — named by both CS4aC's and CS4bC's "other=", unconfirmed
  "洪荒演武 双人对战卡组（TCG）", // CSBC/CSCC candidate — carried over from round 17, unconfirmed
  "猫铃奇计 卡组构筑礼盒（TCG）", // CS2.1C candidate — carried over from round 17, unconfirmed
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
