// One-off diagnostic — NOT wired into any npm script on purpose, run
// directly. Fetches RAW HTML (no summarizing/paraphrasing layer) from
// limitlesstcg.com for one set-list page and one individual card page, saves
// the full response to disk, and prints a bounded excerpt to the console.
//
// Why this exists: this sandbox can't reach limitlesstcg.com directly (a
// direct curl from here times out — not in the network allowlist, same
// situation as api.tcgdex.net), and this project has already been burned
// TWICE building a parser off an AI-summarized "quote verbatim" web fetch
// that turned out not to be verbatim (see the Simplified Chinese Gem Pack
// bug in the spec doc — cost a full wasted run before the real wikitext
// template name was found). Not repeating that here. This prints real raw
// HTML so the actual DOM structure (class names, tag layout) can be seen
// before any parser gets written, exactly the same discipline as
// debug-gempack-raw.ts used for the wiki importer.
//
// Usage:
//   npx tsx scripts/debug-limitless-jp-raw.ts
//
// No Supabase/env vars needed — this only talks to limitlesstcg.com, doesn't
// touch the DB. Paste the FULL console output back, and if asked, also open
// the saved .html files in a text editor and paste specific sections —
// they're saved next to this script's output so nothing is lost even if the
// console excerpt below isn't enough to see the real structure.

import { writeFileSync } from "fs";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchRaw(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.text();
}

function printExcerpt(label: string, html: string, savedPath: string) {
  console.log(`\n=== ${label} (${html.length} bytes, saved to ${savedPath}) ===\n`);
  // Print the raw HTML in full if it's small, otherwise a bounded chunk —
  // no summarizing, this is the literal response text.
  const MAX_CHARS = 20000;
  if (html.length <= MAX_CHARS) {
    console.log(html);
  } else {
    console.log(html.slice(0, MAX_CHARS));
    console.log(`\n... [truncated at ${MAX_CHARS} chars — full response saved to ${savedPath}, open it if more is needed]`);
  }
}

async function main() {
  // Individual card page — known values to cross-check against (Dragapult
  // VMAX, Shiny Star V #318, confirmed "Shiny Ultra Rare" via an earlier
  // fetch): does the real HTML actually contain this in a parseable form?
  const cardUrl = "https://limitlesstcg.com/cards/jp/S4a/318";
  const cardHtml = await fetchRaw(cardUrl);
  writeFileSync("debug-limitless-card.html", cardHtml);
  printExcerpt(`Card page: ${cardUrl}`, cardHtml, "debug-limitless-card.html");

  // Set list page — need the real total-card-count text ("326 Cards" was
  // reported via a summarized fetch earlier, not confirmed raw) and whether
  // card names/numbers are present anywhere in the actual HTML (even if not
  // visibly rendered as a table) versus purely in image alt text or data
  // attributes.
  const setUrl = "https://limitlesstcg.com/cards/jp/S4a";
  const setHtml = await fetchRaw(setUrl);
  writeFileSync("debug-limitless-set.html", setHtml);
  printExcerpt(`Set list page: ${setUrl}`, setHtml, "debug-limitless-set.html");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
