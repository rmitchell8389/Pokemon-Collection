// Offline validation of cnBlackStarPromoImport.ts's parser against the raw
// wikitext Ross already captured (data/wiki-raw/sm-p-sv-p-raw.txt) — no
// network access, no wiki fetch. This sandbox can't reach wiki.52poke.com
// at all (confirmed 2026-08-22, not just rate-limited), so this is the only
// way to check the parser here before handing it to Ross to run for real.
//
// Checks against counts confirmed by hand from the same raw file (see
// cnBlackStarPromoImport.ts header): SM-P zh-cn = 63 (50 numbered + 13
// unnumbered), SV-P zh-cn = 401 (367 numbered + 34 unnumbered).
//
// Usage: npx tsx scripts/validate-black-star-promo-parser.ts

import { readFileSync } from "fs";
import { join } from "path";
import { parseBlackStarPromoEntries, countRawEntryLines } from "../src/lib/cnBlackStarPromoImport";

const RAW_FILE = join(process.cwd(), "data", "wiki-raw", "sm-p-sv-p-raw.txt");

function extractSection(fullText: string, startMarker: string, endMarker: string | null): string {
  const start = fullText.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const from = start + startMarker.length;
  const end = endMarker ? fullText.indexOf(endMarker, from) : fullText.length;
  if (endMarker && end === -1) throw new Error(`end marker not found: ${endMarker}`);
  return fullText.slice(from, end === -1 ? undefined : end);
}

function check(label: string, expected: number, actual: number) {
  const ok = expected === actual;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: expected ${expected}, got ${actual}`);
  return ok;
}

function main() {
  const fullText = readFileSync(RAW_FILE, "utf-8");

  // Isolate just the zh-cn SM-P section (between its own header and the
  // next "===" article boundary) so the zh-tw sibling article's identical
  // "NNN/SM-P" numbering doesn't get counted too — a real risk ONLY in this
  // offline test, since scoutBlackStarPromoSet() fetches one article's
  // wikitext at a time in production, never the concatenated dump.
  const smpSection = extractSection(fullText, "=== SM-P简体中文版特典卡（TCG） ===", "=== SV-P ===");
  const svpSection = extractSection(fullText, "=== SV-P简体中文版特典卡（TCG） ===", "=== SM-P繁体中文版特典卡（TCG） ===");

  let allOk = true;

  console.log("--- SM-P (zh-cn) ---");
  const smpRaw = countRawEntryLines(smpSection);
  const smpEntries = parseBlackStarPromoEntries(smpSection);
  const smpNumbered = smpEntries.filter((e) => e.numbered).length;
  const smpUnnumbered = smpEntries.filter((e) => !e.numbered).length;
  allOk = check("raw entryjp lines", 63, smpRaw) && allOk;
  allOk = check("parsed total", 63, smpEntries.length) && allOk;
  allOk = check("numbered", 50, smpNumbered) && allOk;
  allOk = check("unnumbered", 13, smpUnnumbered) && allOk;

  console.log("\n--- SV-P (zh-cn) ---");
  const svpRaw = countRawEntryLines(svpSection);
  const svpEntries = parseBlackStarPromoEntries(svpSection);
  const svpNumbered = svpEntries.filter((e) => e.numbered).length;
  const svpUnnumbered = svpEntries.filter((e) => !e.numbered).length;
  allOk = check("raw entryjp lines", 401, svpRaw) && allOk;
  allOk = check("parsed total", 401, svpEntries.length) && allOk;
  allOk = check("numbered", 367, svpNumbered) && allOk;
  allOk = check("unnumbered", 34, svpUnnumbered) && allOk;

  // Spot-check a few real entries by exact expected content, not just
  // counts — a parser can get the count right and the fields wrong.
  console.log("\n--- spot checks ---");
  const smp001 = smpEntries.find((e) => e.numbered && e.cardNumber === "001");
  allOk = check("SM-P 001 name", 1, smp001?.name === "谢米" ? 1 : 0) && allOk;
  console.log(`  SM-P 001: name="${smp001?.name}" category="${smp001?.category}"`);

  const smp012 = smpEntries.find((e) => e.numbered && e.cardNumber === "012");
  console.log(`  SM-P 012 (Trainer): name="${smp012?.name}" category="${smp012?.category}"`);
  allOk = check("SM-P 012 name", 1, smp012?.name === "退货标签" ? 1 : 0) && allOk;

  const smp047 = smpEntries.find((e) => e.numbered && e.cardNumber === "047");
  console.log(`  SM-P 047 (Energy): name="${smp047?.name}" category="${smp047?.category}"`);
  allOk = check("SM-P 047 category is Energy", 1, smp047?.category === "能量卡" ? 1 : 0) && allOk;

  // This is the entry with a [[WCS2024|display text]] wikilink in the
  // source field — the real test of the [[ ]] bracket-depth fix. If the
  // splitter broke on that pipe, this card's fields would misalign and
  // either the name extraction would fail or a later field would leak into
  // an earlier one (e.g. category no longer "雷", or the entry would be
  // silently dropped by `fields.length < 3`).
  const svp001 = svpEntries.find((e) => e.numbered && e.cardNumber === "001");
  console.log(`  SV-P 001 (contains [[WCS2024|...]] wikilink): name="${svp001?.name}" category="${svp001?.category}"`);
  allOk = check("SV-P 001 name", 1, svp001?.name === "皮卡丘" ? 1 : 0) && allOk;
  allOk = check("SV-P 001 category unaffected by wikilink", 1, svp001?.category === "雷" ? 1 : 0) && allOk;

  const dupes = new Map<string, number>();
  for (const e of [...smpEntries, ...svpEntries]) {
    const key = `${e.numbered ? "N" : "U"}${e.cardNumber}`;
    dupes.set(key, (dupes.get(key) ?? 0) + 1);
  }
  const realDupes = Array.from(dupes.entries()).filter(([, c]) => c > 1);
  console.log(`\nDuplicate card_number check (within each set, not across): ${realDupes.length === 0 ? "none" : realDupes.map(([k, c]) => `${k}x${c}`).join(", ")}`);

  console.log(`\n${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED — do not ship this parser as-is"}`);
  process.exit(allOk ? 0 : 1);
}

main();
