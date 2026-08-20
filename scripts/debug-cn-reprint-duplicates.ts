// One-off diagnostic: the batch commit for CS/CSM/CSV reprint sets hit
// "ON CONFLICT DO UPDATE command cannot affect row a second time" on 12 of
// 36 sets — meaning multiple parsed entries within the same set resolved to
// the SAME card_number, colliding on id (`${setId}-${cardNumber}`). The
// row-by-row fallback that recovered those sets doesn't error on a
// duplicate id, it just silently overwrites — so the "recovered N/N" counts
// reported by the batch script do NOT mean N distinct cards ended up in the
// database. This script checks the real damage for a given set:
//   1. Re-scouts the set from the wiki (read-only, no DB writes) and finds
//      which parsed card_numbers actually collided, printing every entry in
//      each colliding group so we can see WHY (multiple rarities of the same
//      slot? different cards sharing a number? a parsing bug?).
//   2. Queries the actual current row count in the DB for that set_id and
//      compares it to how many cards SHOULD be there (distinct card_numbers
//      from the wiki) — the gap is exactly how many cards got silently
//      dropped by the overwrite.
//
// Usage:
//   npx tsx scripts/debug-cn-reprint-duplicates.ts CSV1C CSM1aC CS2.5C
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { searchReprintPages, fetchFullContent, parsePage } from "../src/lib/cnReprintImport";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  const setIds = process.argv.slice(2);
  if (setIds.length === 0) {
    throw new Error("Pass one or more set ids, e.g. npx tsx scripts/debug-cn-reprint-duplicates.ts CSV1C CSM1aC");
  }

  for (const setId of setIds) {
    console.log(`\n=== ${setId} ===`);

    const titles = await searchReprintPages(setId);
    const contentByTitle = await fetchFullContent(titles);

    const byCardNumber = new Map<string, { title: string; name: string; rarity: string | null; cnimg: string | null }[]>();
    for (const title of titles) {
      const text = contentByTitle.get(title);
      if (!text) continue;
      const entry = parsePage(title, text, setId);
      if (!entry || !entry.cardNumber) continue;
      const list = byCardNumber.get(entry.cardNumber) ?? [];
      list.push({ title: entry.title, name: entry.name, rarity: entry.rarity, cnimg: entry.cnimg });
      byCardNumber.set(entry.cardNumber, list);
    }

    const distinctCount = byCardNumber.size;
    const duplicates = Array.from(byCardNumber.entries()).filter(([, list]) => list.length > 1);

    console.log(`Wiki says: ${distinctCount} distinct card_number(s) across ${titles.length} page(s).`);
    if (duplicates.length > 0) {
      console.log(`${duplicates.length} card_number(s) have MORE THAN ONE entry (these collided during commit):`);
      for (const [cardNumber, list] of duplicates) {
        console.log(`  ${cardNumber}:`);
        for (const e of list) {
          console.log(`    "${e.title}" -> name="${e.name}" rarity=${e.rarity ?? "?"} cnimg=${e.cnimg ?? "(none)"}`);
        }
      }
    } else {
      console.log(`No duplicate card_numbers found in a fresh parse — if the commit still errored, something else is going on (or this reflects a since-edited wiki page).`);
    }

    const { count, error } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("language", "zh-cn")
      .eq("set_id", setId);

    if (error) {
      console.log(`  ! failed to query current DB row count: ${error.message}`);
    } else {
      const gap = distinctCount - (count ?? 0);
      console.log(`DB currently has ${count} row(s) for ${setId}. Expected ${distinctCount} distinct. ${gap > 0 ? `${gap} card(s) may have been silently overwritten/lost.` : "Matches — no data loss from this."}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
