// Corrected version of ja-set-breakdown.ts. That script counted every ROW
// per set_id, which double- or triple-counts cards that have reverse-holo /
// pokeball / masterball variant rows -- this project's DB convention is one
// row per (card_number, variant) pair, not one row per card.
//
// data/tcgcollector-jp-sets-raw.md was captured with
// cardCountMode=anyCardVariant, which (confirmed 2026-08-27 by sampling 8
// sets with scripts/ja-set-sample.ts) counts DISTINCT cards, not variant
// prints -- e.g. SV11W's card_number range runs 001-174 with up to 3 rows
// per number (base + 2 reverse-holo prints), and TCG Collector's own target
// for SV11W is exactly 174, matching the DISTINCT card_number count, not
// the 326 raw rows. Comparing raw row totals against these targets (as the
// first version of this reconciliation did) systematically distorts the
// picture: well-covered modern sets look artificially closer to (or over)
// target than they really are in distinct-card terms, while sets with zero
// variant rows aren't affected at all -- not an apples-to-apples comparison
// either way.
//
// This version counts DISTINCT card_number values per set_id instead of
// raw rows, which is the correct basis for comparison against
// data/tcgcollector-jp-sets-raw.md's N values.
//
// Usage: npx tsx scripts/ja-set-breakdown-distinct.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  // set_id -> Set<card_number>
  const cardNumbersBySet = new Map<string, Set<string>>();
  // set_id -> raw row count, kept alongside for comparison
  const rowCounts = new Map<string, number>();

  const PAGE_SIZE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("cards")
      .select("set_id, card_number")
      .eq("language", "ja")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const r = row as { set_id: string; card_number: string };
      const id = r.set_id ?? "(null)";
      rowCounts.set(id, (rowCounts.get(id) ?? 0) + 1);
      if (!cardNumbersBySet.has(id)) cardNumbersBySet.set(id, new Set());
      cardNumbersBySet.get(id)!.add(r.card_number ?? "(null)");
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const sorted = Array.from(cardNumbersBySet.entries())
    .map(([id, set]) => ({ id, distinct: set.size, rows: rowCounts.get(id) ?? 0 }))
    .sort((a, b) => b.distinct - a.distinct);

  const totalDistinct = sorted.reduce((sum, s) => sum + s.distinct, 0);
  const totalRows = sorted.reduce((sum, s) => sum + s.rows, 0);

  console.log(
    `Total ja rows: ${totalRows}. Total DISTINCT card_numbers: ${totalDistinct}. Across ${sorted.length} distinct set_id(s).\n`
  );
  console.log(`set_id\tdistinct_cards\traw_rows`);
  for (const s of sorted) {
    console.log(`${s.id}\t${s.distinct}\t${s.rows}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
