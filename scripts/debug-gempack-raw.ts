// Diagnostic for the Gem Pack importer returning 0/6 parsed. The parser was
// built against wikitext I saw through WebFetch's "quote verbatim" prompt —
// which turned out to still not be truly raw (0 matches for
// "{{卡片列表/entryjp" against the REAL fetched content, via the same
// rvslots=main mechanism that already works fine for the reprint-pattern
// importer). This script fetches one Gem Pack page directly (no summarizing
// layer) and writes the actual raw wikitext to a file, plus prints some
// quick substring counts so we can see what's really in there before
// touching the parser again.
//
// Usage: npx tsx scripts/debug-gempack-raw.ts
// Writes: gempack-cbb2c-raw.txt (in the project root)
import { writeFileSync } from "fs";
import { fetchJsonWithRetry, WIKI_API_BASE } from "../src/lib/cnReprintImport";

interface WikiRevisionsResponse {
  query?: {
    pages?: Record<string, { title?: string; revisions?: { slots?: { main?: { "*"?: string } } }[] }>;
  };
}

async function main() {
  const pageTitle = "宝石包 第二弹（TCG）";
  const url = new URL(WIKI_API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", pageTitle);
  url.searchParams.set("prop", "revisions");
  url.searchParams.set("rvprop", "content");
  url.searchParams.set("rvslots", "main");
  url.searchParams.set("format", "json");

  console.log(`Fetching: ${url.toString()}\n`);

  const data = await fetchJsonWithRetry<WikiRevisionsResponse>(url.toString());
  const pages = data?.query?.pages ?? {};
  const pageEntries = Object.entries(pages);
  console.log(`Pages returned: ${pageEntries.length}`);
  for (const [pageId, page] of pageEntries) {
    console.log(`  pageid=${pageId} title=${page.title ?? "(none)"} revisions=${page.revisions?.length ?? 0}`);
  }

  let text: string | undefined;
  for (const page of Object.values(pages)) {
    const t = page?.revisions?.[0]?.slots?.main?.["*"];
    if (typeof t === "string") {
      text = t;
      break;
    }
  }

  if (!text) {
    console.log("\nNo content extracted at all — dumping raw JSON response instead:");
    console.log(JSON.stringify(data, null, 2).slice(0, 3000));
    return;
  }

  console.log(`\nContent length: ${text.length} characters`);

  const needles = ["卡片列表", "entryjp", "{{C|", "RarityCBB", "TCG版本信息框", "gallery"];
  for (const needle of needles) {
    const count = text.split(needle).length - 1;
    console.log(`  occurrences of "${needle}": ${count}`);
  }

  const firstCardListIdx = text.indexOf("卡片列表");
  if (firstCardListIdx >= 0) {
    console.log(`\nFirst "卡片列表" occurrence, with context:`);
    console.log(text.slice(Math.max(0, firstCardListIdx - 50), firstCardListIdx + 200));
  } else {
    console.log(`\n"卡片列表" not found anywhere in the content.`);
  }

  writeFileSync("gempack-cbb2c-raw.txt", text, "utf-8");
  console.log(`\nFull raw wikitext written to gempack-cbb2c-raw.txt (${text.length} chars) — open it directly and search for the card-list table.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
