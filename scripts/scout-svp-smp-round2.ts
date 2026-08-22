// Follow-up to scout-cn-remaining-threads.ts — that script checked the
// UNHYPHENATED titles "SVP" and "SMP" and concluded neither had a real
// Simplified Chinese product. Turned out to be checking the wrong title
// convention: the wiki's real disambiguation pages use a HYPHEN ("SM-P",
// presumably "SV-P" too), and "SM-P简体中文版特典卡（TCG）" ("SM-P Simplified
// Chinese Promo Cards") — a DEDICATED article for exactly this — genuinely
// exists. Confirmed live 2026-08-21 from the sandbox before hitting the
// rate limit again. This script is pure diagnostic — prints raw content,
// does not parse or write anything yet, since the article's format hasn't
// been seen. Run from a real machine, not the sandbox (same rate-limit
// situation documented in cnReprintImport.ts).
//
// Usage: npx tsx scripts/scout-svp-smp-round2.ts

import { fetchFullContent, sleep } from "../src/lib/cnReprintImport";

async function printPage(title: string) {
  console.log(`\n=== ${title} ===`);
  const content = await fetchFullContent([title]);
  const text = content.get(title);
  if (!text) {
    console.log("(page not found)");
    return;
  }
  console.log(text);
}

async function main() {
  // The confirmed real one — the actual target.
  await printPage("SM-P简体中文版特典卡（TCG）");
  await sleep(800);

  // Cross-check: does SV-P (hyphenated) have the same structure SM-P did?
  // The original "SVP" (no hyphen) check found only small Japan-origin
  // sub-boxes with no regional-variant siblings — but that may have been
  // the same wrong-title mistake as "SMP" vs "SM-P".
  await printPage("SV-P");
  await sleep(800);
  await printPage("SV-P简体中文版特典卡（TCG）");
  await sleep(800);

  // For comparison — the Traditional Chinese sibling of SM-P, already
  // presumably covered via the zh-tw image backlog, but useful to see the
  // format either way since it's the same article shape.
  await printPage("SM-P繁体中文版特典卡（TCG）");

  console.log("\nDone. Paste this whole output back.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
