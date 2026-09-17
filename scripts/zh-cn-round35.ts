// Round 35 (fixed) — new discovery approach for the last 6 codes of the
// 29-code core-pack family from round 12: CSM1aC, CSM1bC, CSM1cC, CSM2aC,
// CSM2bC, CSM2cC (TCG Collector's own translated names: "Storming Emergence"
// and "Shining Synergy"). Unlike every other set in this whole 34-round
// chain (CS1 through CSV10C), NOT ONE of these six codes has ever been named
// by a real {{ExpansionPrevNext}} chain reference anywhere in this project's
// history — chain-chasing has hit a real wall here, not a temporary gap.
//
// FIX from the first version of this script: it hit HTTP 404 on every
// search because it guessed the wiki's API path as
// `https://wiki.52poke.com/w/api.php` instead of reusing the real, already-
// proven base URL this project's own `src/lib/cnReprintImport.ts` exports:
// `https://wiki.52poke.com/api.php` (no `/w/`). This version imports
// `WIKI_API_BASE`, `HEADERS`, and `fetchJsonWithRetry` directly from that
// file instead of hand-rolling a second, unverified fetch path — same
// endpoint, same browser-like User-Agent, same 429 retry/backoff every
// scout script in this project already relies on.
//
// Two phases, both automatic in one run:
//   1. Full-text search the wiki (MediaWiki's action=query&list=search) for
//      each of the 6 raw codes directly, plus the two broader family roots
//      "CSM1" and "CSM2" (in case a hub/list page names all three sub-codes
//      of a wave without any one sub-code's own article surfacing
//      individually). This is the same technique that originally found
//      CS1aC/CS1bC/CS1DC/CSAC in round 13, before any chain reference
//      existed to name them — just never tried against the CSM family
//      before now (every prior CSM attempt tried guessing a Chinese title
//      instead). For any code phase 1 finds zero hits for, also tries an
//      `insource:"<code>"` raw-wikitext search as a fallback, since a plain
//      search only matches text the wiki actually renders, and an infobox
//      field's raw value might not always be rendered as visible text.
//   2. For every distinct candidate title any search turns up, fetch the
//      page directly and check whether its own infobox `alt=` field really
//      matches one of the 6 codes — a mention in running text alone is not
//      enough to add anything to BOOSTER_SETS, same discipline as every
//      round before this one. Nothing gets added to real code from this
//      script's own output; that happens only after Ross sends the raw
//      capture back and it's parsed/validated the same as every prior
//      round.
//
// Needs live wiki access — will NOT work from the cloud sandbox (confirmed
// again every round: direct fetch from the sandbox to wiki.52poke.com times
// out with no route). Run from a real machine.
//
// Usage: npx tsx scripts/zh-cn-round35.ts > round35-raw.txt
// Then send round35-raw.txt back (paste the content or attach the file).

import {
  fetchFullContent,
  fetchJsonWithRetry,
  sleep,
  WIKI_API_BASE,
} from "../src/lib/cnReprintImport";

const CODES = ["CSM1aC", "CSM1bC", "CSM1cC", "CSM2aC", "CSM2bC", "CSM2cC"];
const FAMILY_ROOTS = ["CSM1", "CSM2"];

interface WikiSearchResponse {
  query?: { search?: { title: string; snippet?: string }[] };
}

async function searchWiki(query: string): Promise<{ title: string; snippet: string }[]> {
  const url = new URL(WIKI_API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", "10");
  url.searchParams.set("format", "json");

  let data: WikiSearchResponse;
  try {
    data = await fetchJsonWithRetry<WikiSearchResponse>(url.toString());
  } catch (err) {
    console.log(`  [request error searching "${query}": ${String(err)}]`);
    return [];
  }
  const hits = data.query?.search ?? [];
  return hits.map((h) => ({
    title: h.title,
    snippet: (h.snippet ?? "").replace(/<[^>]+>/g, ""),
  }));
}

function findAlt(text: string): string | null {
  const m = text.match(/alt\s*=\s*([A-Za-z0-9.]+)/);
  return m ? m[1] : null;
}

function findCards(text: string): string {
  const m = text.match(/cards\s*=\s*([^\n|]*)/);
  return m ? m[1].trim() : "(no cards= field found)";
}

function checkBulkTables(text: string): string {
  const jpCount = (text.match(/\{\{卡牌列表\/entryjp\|/g) ?? []).length;
  const plainCount = (text.match(/\{\{卡牌列表\/entry\|/g) ?? []).length;
  const themeCount = (text.match(/\{\{主题牌组列表\/entry\|/g) ?? []).length;
  const parts: string[] = [];
  if (jpCount > 0) parts.push(`{{卡牌列表/entryjp|...}} x${jpCount}`);
  if (plainCount > 0) parts.push(`{{卡牌列表/entry|...}} x${plainCount}`);
  if (themeCount > 0) parts.push(`{{主题牌组列表/entry|...}} x${themeCount}`);
  return parts.length > 0
    ? `USES: ${parts.join(", ")}`
    : "no known bulk-table template found";
}

function findPrevNext(text: string): string {
  const m = text.match(/\{\{ExpansionPrevNext\|[^}]*\}\}/);
  return m ? m[0] : "(no ExpansionPrevNext template found)";
}

async function main() {
  const candidateTitles = new Set<string>();

  console.log("=== PHASE 1: full-text search for each raw code + family root ===\n");
  for (const term of [...CODES, ...FAMILY_ROOTS]) {
    console.log(`--- searching (plain): "${term}" ---`);
    let hits = await searchWiki(term);
    if (hits.length === 0) {
      console.log("  (no results)");
      // Fallback: raw-wikitext search, in case the field value isn't
      // rendered as visible page text.
      const insourceQuery = `insource:"${term}"`;
      console.log(`--- searching (insource fallback): ${insourceQuery} ---`);
      hits = await searchWiki(insourceQuery);
      if (hits.length === 0) {
        console.log("  (no results)");
      }
    }
    for (const hit of hits) {
      console.log(`  ${hit.title} :: ${hit.snippet}`);
      candidateTitles.add(hit.title);
    }
    await sleep(800);
  }

  console.log(
    `\n=== PHASE 2: fetching ${candidateTitles.size} distinct candidate title(s), checking alt= ===\n`
  );
  for (const title of candidateTitles) {
    console.log(`\n=== ${title} ===`);
    try {
      const content = await fetchFullContent([title]);
      const text = content.get(title);
      if (!text) {
        console.log("(page not found on direct fetch, despite showing up in search)");
      } else {
        const alt = findAlt(text);
        console.log(`[alt= field: ${alt ?? "(none found)"}]`);
        console.log(`[cards= field: ${findCards(text)}]`);
        console.log(`[${checkBulkTables(text)}]`);
        console.log(`[chain reference: ${findPrevNext(text)}]`);
      }
    } catch (err) {
      // A single bad fetch (rate limit exhausted, transient network error,
      // etc.) must not kill the rest of the batch — round 35's first full
      // run died silently partway through phase 2 for exactly this reason:
      // an uncaught error went to stderr, not the redirected output file,
      // and the whole script exited before printing "Done." or any of the
      // remaining candidates. Logging the error to stdout here means it
      // survives the `> file.txt` redirect and the loop keeps going.
      console.log(`[fetch error for "${title}": ${String(err)}]`);
    }
    await sleep(800);
  }

  console.log("\nDone. Save this whole output to a file and send it back.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
