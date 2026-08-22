// Round 2 of the zh-cn remaining-threads research (see
// scripts/scout-cn-remaining-threads.ts for round 1, and claude/spec.md
// "zh-cn round 4/5/6" for the full history — round 1's SVP/SMP conclusion
// was wrong because it only tried the UNHYPHENATED wiki title convention;
// the real SM-P/SV-P articles used a hyphen and were only found once that
// was tried).
//
// This round covers the three threads round 1 left open or wrongly closed:
//   A. Gym Event Promo Pack (5 volumes, ~60 cards) — never resolved, no
//      code found by any search tried so far.
//   B. Sun & Moon starter decks CSM2DC ("Shining Synergy GX Starter Deck",
//      357 total) and CSM1DC ("Storming Emergence GX Starter Deck", 336
//      total) — the per-card reprint pattern already covers SOME of these
//      (49/357 and 59/336, presumably already imported in an earlier
//      round), round 1 searched for a Gem-Pack-style bulk-table article to
//      close the rest and found nothing — but only tried the bare set code
//      as a search TERM (plain relevance search, not insource: exact-text
//      search), never tried real product-name search terms, and never
//      cross-checked what's actually live in the DB right now.
//   C. Happy Set / CSVM2 leftover codes — round 1 found zero hits for
//      insource:"cnicon=CSVM2"/"cnicon=CSVM2C" specifically (the per-card
//      REPRINT pattern), but never tried a bare insource:"CSVM2" search,
//      which would also catch a dedicated bulk-table article that doesn't
//      use the cnicon= tag at all (same as how Gem Packs and SM-P/SV-P
//      don't route through cnicon=).
//
// This script does two things per thread: (1) a live DB check of what's
// already imported for the relevant set_id(s), so we know the REAL current
// state instead of guessing from an earlier session's notes, and (2) fresh
// wiki searches using strategies round 1 didn't try.
//
// Needs BOTH a live Supabase connection (.env.local) AND live wiki access
// — will NOT work from this project's cloud sandbox (confirmed 2026-08-22:
// the sandbox can't reach wiki.52poke.com at all). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-remaining-threads-round2.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { fetchJsonWithRetry, sleep, WIKI_API_BASE, fetchFullContent } from "../src/lib/cnReprintImport";

interface WikiSearchResponse {
  query?: { search?: { title: string }[] };
  continue?: { sroffset?: number };
}

async function insourceSearch(literal: string, limit = 100): Promise<string[]> {
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

async function generalSearch(query: string, limit = 20): Promise<string[]> {
  const url = new URL(WIKI_API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("format", "json");
  const data = await fetchJsonWithRetry<WikiSearchResponse>(url.toString());
  return (data?.query?.search ?? []).map((h) => h.title);
}

async function dbCoverage(supabase: any, setIds: string[]) {
  const { data, error } = await supabase
    .from("cards")
    .select("set_id, set_name")
    .eq("language", "zh-cn")
    .in("set_id", setIds);
  if (error) {
    console.log(`  ! DB query failed: ${error.message}`);
    return;
  }
  const counts = new Map<string, { count: number; name: string | null }>();
  for (const row of (data ?? []) as { set_id: string; set_name: string | null }[]) {
    const existing = counts.get(row.set_id);
    if (existing) existing.count++;
    else counts.set(row.set_id, { count: 1, name: row.set_name });
  }
  for (const setId of setIds) {
    const c = counts.get(setId);
    console.log(`    ${setId}: ${c ? `${c.count} row(s) in DB, "${c.name}"` : "0 rows in DB"}`);
  }
}

async function partA_gymEventPromoPack() {
  console.log("\n=== A. Gym Event Promo Pack — broader search ===");

  const queries = [
    "道馆活动特典包",
    "道馆活动 特典包 TCG",
    "道馆赛事 特典 礼包",
    "Gym Event Promo Pack 简体中文",
  ];
  for (const q of queries) {
    console.log(`\n--- generalSearch("${q}") ---`);
    console.log((await generalSearch(q)).join(", ") || "(0 hits)");
    await sleep(600);
  }

  // New angle: search for the ICON KEY itself ("gymsc") rather than a
  // guessed product name. Confirmed real and recurring across SM-P/SV-P's
  // own "道馆活动"-sourced entries (data/wiki-raw/sm-p-sv-p-raw.txt) — if a
  // dedicated Gym Event Promo Pack article exists and uses the same
  // {{卡牌列表/entryjp|...}} template, it likely reuses this icon key too,
  // which insource: can find even without knowing the article's title.
  console.log(`\n--- insourceSearch("gymsc") — icon key reused across gym-activity-sourced entries ---`);
  const gymscHits = await insourceSearch("gymsc");
  console.log(`${gymscHits.length} page(s): ${gymscHits.join(", ")}`);
}

async function partB_starterDecks(supabase: any) {
  console.log("\n=== B. CSM2DC / CSM1DC starter decks + 16 Battle Party codes ===");

  const battlePartyCodes = [
    "CSMPgC", "CSMPpC", "CSMPfC", "CSMPoC", "CSMPbC", "CSMPkC",
    "CSMPaC", "CSMPjC", "CSMPdC", "CSMPmC", "CSMPhC", "CSMPqC",
    "CSMPeC", "CSMPnC", "CSMPcC", "CSMPlC",
  ];

  console.log("\n--- current live DB coverage ---");
  await dbCoverage(supabase, ["CSM2DC", "CSM1DC", ...battlePartyCodes]);

  console.log("\n--- insourceSearch (exact-text, not relevance) for the bare codes ---");
  for (const code of ["CSM2DC", "CSM1DC"]) {
    const hits = await insourceSearch(code);
    console.log(`  ${code}: ${hits.length} page(s): ${hits.join(", ")}`);
    await sleep(600);
  }

  console.log("\n--- generalSearch for likely product-name terms ---");
  const queries = [
    "高手对战套牌 简体中文 TCG",
    "起始套牌 GX 简体中文",
    "闪耀协力 套牌",
    "暴风来袭 套牌",
  ];
  for (const q of queries) {
    console.log(`  "${q}": ${(await generalSearch(q)).join(", ") || "(0 hits)"}`);
    await sleep(600);
  }
}

async function partC_happySetCsvm2(supabase: any) {
  console.log("\n=== C. Happy Set / CSVM2 ===");

  console.log("\n--- current live DB coverage (CSVH line + CSVM2) ---");
  await dbCoverage(supabase, [
    "CSVH1C", "CSVH2C", "CSVH3C", "CSVH4C", "CSVH5C", "CSVM2", "CSVM2C",
    "CSVM1aC", "CSVM1bC", "CSVM1cC", "CSVM2aC", "CSVM2bC", "CSVM2cC",
  ]);

  console.log("\n--- bare insource search (not scoped to cnicon=) ---");
  for (const code of ["CSVM2", "CSVM2C"]) {
    const hits = await insourceSearch(code);
    console.log(`  ${code}: ${hits.length} page(s): ${hits.join(", ")}`);
    await sleep(600);
  }

  console.log("\n--- alternate Chinese translations of 'Happy Set' ---");
  for (const q of ["欢乐礼盒 TCG", "开心礼盒 TCG", "幸福礼盒 TCG"]) {
    console.log(`  "${q}": ${(await generalSearch(q)).join(", ") || "(0 hits)"}`);
    await sleep(600);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  await partA_gymEventPromoPack();
  await partB_starterDecks(supabase);
  await partC_happySetCsvm2(supabase);

  console.log("\nDone. Paste this whole output back (or save to a file and send it — a file is more reliable for long output, same lesson as last time).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
