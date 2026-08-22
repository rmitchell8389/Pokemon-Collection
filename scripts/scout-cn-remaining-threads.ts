// Read-only wiki research for the four remaining zh-cn coverage threads
// (SVP/SMP promo catch-alls, Sun & Moon box-set bulk-table check, Gym Event
// Promo Pack codes, Happy Set/CSVM2 leftovers). NO DB access, NO writes —
// pure diagnostic, prints raw findings to interpret afterward.
//
// Run from a real machine, not this project's cloud sandbox — wiki.52poke.com
// rate-limits the sandbox's shared proxy IP much harder than a normal
// connection (same thing already documented in cnimages.ts/cnReprintImport.ts
// from the original zh-cn work: ~1 request per 10-15 min from the sandbox,
// fine from a real machine even at real volume).
//
// Usage: npx tsx scripts/scout-cn-remaining-threads.ts
//
// === Part A background — the actual finding that prompted this script ===
// Checked from the sandbox before hitting the rate limit: the wiki's own
// "SVP" disambiguation page (https://wiki.52poke.com/wiki/SVP) does NOT
// describe one unified China-region SVP product. It lists SVP as covering
// several distinct, small Japan-origin promo sub-boxes: SVP1 ("ex特别组合",
// 7 cards), SVP2 ("ex特别组合ver.2"), SVPN and SVPS (single-card promos).
// None of those total anywhere near TCG Collector's stated 443 cards for
// "SVP" under the China region tab.
//
// Checked one real card from SVP1 ("墓扬犬ex" was rate-limited before
// fetching, but "巴布土拨ex（SVP1）" came back first): its wikitext has a
// REAL cnicon=CSV4C block (China release, already-covered set) alongside a
// separate zhicon=SVP1F block (Taiwan/zh-tw release, matching the already-
// established "TCGdex set_id + F" pattern from Phase 1) and a jaicon=SVP1
// block (the actual Japan-origin promo box this card is FROM). There is no
// cnicon=SVP-anything anywhere on this card.
//
// Working hypothesis, NOT yet confirmed at scale: TCG Collector's "SVP"
// 443-card China-region listing is very likely mirroring the shared
// English/universal SVP promo checklist (TCGdex's own "svp" set, ~440+
// cards by now) rather than representing a real, distinct Simplified-
// Chinese-market product — and whatever SVP-line cards DO have a genuine
// China release get folded into whichever numbered CS*/CSM*/CSV* set
// reprinted them (like CSV4C above), which may already be imported. If
// true, "SVP" isn't a 443-card gap to close with a new importer at all —
// it's mostly cards with no Chinese release, already reflected correctly
// by their absence. Part A below checks this at real scale instead of
// guessing from one card.

import {
  fetchJsonWithRetry,
  sleep,
  WIKI_API_BASE,
  fetchFullContent,
} from "../src/lib/cnReprintImport";

interface WikiSearchResponse {
  query?: { search?: { title: string }[] };
  continue?: { sroffset?: number };
}

async function insourceSearch(literal: string, limit = 500): Promise<string[]> {
  const titles: string[] = [];
  let sroffset: number | undefined;
  for (;;) {
    const url = new URL(WIKI_API_BASE);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", `insource:"${literal}"`);
    url.searchParams.set("srlimit", String(limit));
    url.searchParams.set("format", "json");
    if (sroffset !== undefined) url.searchParams.set("sroffset", String(sroffset));
    const data = await fetchJsonWithRetry<WikiSearchResponse>(url.toString());
    const hits = data?.query?.search ?? [];
    for (const h of hits) titles.push(h.title);
    const next = data?.continue?.sroffset;
    if (next === undefined || hits.length === 0) break;
    sroffset = next;
    await sleep(400);
  }
  return Array.from(new Set(titles));
}

async function generalSearch(query: string, limit = 30): Promise<string[]> {
  const url = new URL(WIKI_API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("format", "json");
  const data = await fetchJsonWithRetry<WikiSearchResponse>(url.toString());
  return (data?.query?.search ?? []).map((h) => h.title);
}

// Pulls every `cnicon=CODE` occurrence out of a card's full wikitext (a
// card can have more than one — reprinted into multiple China products).
function extractCniconCodes(fullText: string): string[] {
  const codes: string[] = [];
  const re = /cnicon=([A-Za-z0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText))) codes.push(m[1]);
  return codes;
}

async function partA_svpSmp() {
  console.log("\n=== A. SVP / SMP real coverage check ===");

  for (const disambigTitle of ["SVP", "SMP"]) {
    console.log(`\n--- ${disambigTitle} disambiguation page (raw wikitext) ---`);
    const content = await fetchFullContent([disambigTitle]);
    console.log(content.get(disambigTitle) ?? "(page not found)");
    await sleep(600);
  }

  // Every card whose JAPAN-origin promo box is SVP1/SVP2/SVPN/SVPS —
  // confirmed sub-codes from the disambig page above (re-derive from the
  // printed disambig text if the wiki has since added more).
  const jpBoxCodes = ["SVP1", "SVP2", "SVPN", "SVPS"];
  const allCardTitles = new Set<string>();
  for (const code of jpBoxCodes) {
    console.log(`\n--- searching jaicon=${code} ---`);
    const titles = await insourceSearch(`jaicon=${code}`);
    console.log(`  ${titles.length} card page(s): ${titles.join(", ")}`);
    for (const t of titles) allCardTitles.add(t);
    await sleep(600);
  }

  console.log(`\n--- fetching full content for ${allCardTitles.size} SVP-line card(s), checking for cnicon= ---`);
  const contentByTitle = await fetchFullContent(Array.from(allCardTitles));
  let withCnicon = 0;
  const codesSeen = new Map<string, number>();
  for (const [title, text] of contentByTitle) {
    const codes = extractCniconCodes(text);
    if (codes.length > 0) {
      withCnicon++;
      for (const c of codes) codesSeen.set(c, (codesSeen.get(c) ?? 0) + 1);
      console.log(`  ${title}: cnicon codes = ${codes.join(", ")}`);
    } else {
      console.log(`  ${title}: NO cnicon field (no China release documented)`);
    }
  }
  console.log(`\n  Summary: ${withCnicon}/${contentByTitle.size} SVP-line cards have a documented China release.`);
  console.log(`  Codes seen: ${Array.from(codesSeen.entries()).map(([c, n]) => `${c}(${n})`).join(", ")}`);
  console.log(`  (Cross-reference these codes against what's already been imported — see spec doc / prior batch scripts' candidate lists.)`);

  console.log("\n--- general search for any other 'SMP'-adjacent or 'SVP'-adjacent promo article ---");
  console.log("SMP-related:", (await generalSearch("SMP promo 朱紫 OR 太阳 月亮")).join(", "));
}

async function partB_sunMoonBoxSets() {
  console.log("\n=== B. Sun & Moon box/starter-deck sets — bulk-table format check ===");
  // Codes known to be only partially covered via the per-card reprint
  // pattern (see spec doc Phase 3 round 3). Searching for the code as
  // plain text tends to surface the set's own dedicated article (which
  // Gem Packs had, one per pack) if one exists.
  const candidates = ["CSM2DC", "CSM1DC", "CSMPgC", "CSMPhC", "CSMPiC", "CSMPjC", "CSMPkC"];
  for (const code of candidates) {
    console.log(`\n--- searching for "${code}" ---`);
    const titles = await generalSearch(code, 10);
    console.log(`  ${titles.length} hit(s): ${titles.join(", ")}`);
    await sleep(600);
  }
  console.log(
    "\n  For any promising article title above, fetch its full content next " +
      "(action=query&prop=revisions&titles=<title>&rvprop=content&rvslots=main&format=json) " +
      "and check for a 卡牌列表/entryjp-style bulk table like Gem Packs used, or paste the title back so it can be checked."
  );
}

async function partC_gymEventPromoPack() {
  console.log("\n=== C. Gym Event Promo Pack — code search ===");
  console.log((await generalSearch("道馆 活动 促销包 TCG", 20)).join(", "));
  console.log((await generalSearch("Gym Event Promo Pack", 20)).join(", "));
}

async function partD_happySetCsvm2() {
  console.log("\n=== D. Happy Set / CSVM2 leftovers ===");
  for (const code of ["CSVM2", "CSVM2C"]) {
    console.log(`\n--- searching jaicon/cnicon=${code} ---`);
    console.log((await insourceSearch(`cnicon=${code}`)).join(", ") || "(0 hits)");
    await sleep(600);
  }
  console.log("\n--- general search for 'Happy Set' article names ---");
  console.log((await generalSearch("Happy Set TCG 快乐礼盒", 20)).join(", "));
}

async function main() {
  await partA_svpSmp();
  await partB_sunMoonBoxSets();
  await partC_gymEventPromoPack();
  await partD_happySetCsvm2();
  console.log("\nDone. Paste this whole output back.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
