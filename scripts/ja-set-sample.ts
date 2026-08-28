// Diagnostic for the JP reconciliation's first real anomaly: a handful of
// `ja` set_ids that DO have a code matching a TCG Collector entry directly
// are showing DB row counts 1.15x-1.9x ABOVE that set's TCG Collector
// "anyCardVariant" target -- a much bigger overshoot than round-12's zh-cn
// pass ever saw for a genuinely complete/well-covered set (which ran maybe
// a few percent over, consistent with both sides just counting variants).
// That gap is big enough to suggest something's actually wrong, not just
// variant-counting -- e.g. rows from an unrelated set/language bleeding
// into these set_ids, the same class of issue round-12 found for zh-cn's
// SV8a (a Traditional Chinese set mistagged into the zh-cn report) and the
// 7 zh-cn set_ids with no TCG Collector match at all.
//
// Spot-checked (DB count vs TCG Collector target, 2026-08-27):
//   SV11W  326 vs 174  (1.87x)   SV11B  326 vs 174  (1.87x, identical to SV11W -- suspicious)
//   SV8a   382 vs 237  (1.61x)   S12a   347 vs 262  (1.32x)
//   S8b    395 vs 293  (1.35x)   M2a    458 vs 250  (1.83x)
//   SV2a   516 vs 210  (2.46x)   -- the worst of the bunch
//   (S4a 326 vs 330 is the control -- within 1%, looks like a real clean match)
//
// This script dumps every row for a small set of set_ids so the actual
// card_number/name/variant contents can be eyeballed -- looking for
// duplicate card_numbers, names that don't belong to the set, or a variant
// column that explains the multiplier cleanly (e.g. if every card_number
// legitimately has 2-3 variant rows, that's normal, not a bug).
//
// Usage: npx tsx scripts/ja-set-sample.ts
//   (edit SET_IDS below to check a different/smaller/larger list)

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SET_IDS = ["SV11W", "SV11B", "SV8a", "S12a", "S8b", "M2a", "SV2a", "S4a"];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  for (const setId of SET_IDS) {
    const { data, error } = await supabase
      .from("cards")
      .select("card_number, name, set_name, variant")
      .eq("language", "ja")
      .eq("set_id", setId)
      .order("card_number", { ascending: true });
    if (error) throw error;
    const rows = data ?? [];

    const distinctCardNumbers = new Set(rows.map((r) => (r as { card_number: string }).card_number));
    const distinctSetNames = new Set(rows.map((r) => (r as { set_name: string }).set_name));
    const distinctVariants = new Set(rows.map((r) => (r as { variant: string | null }).variant ?? "(none)"));

    console.log(`\n=== ${setId} ===`);
    console.log(`Total rows: ${rows.length}. Distinct card_numbers: ${distinctCardNumbers.size}.`);
    console.log(`Distinct set_name value(s) seen: ${[...distinctSetNames].join(" | ")}`);
    console.log(`Distinct variant value(s) seen: ${[...distinctVariants].join(", ")}`);
    console.log(`rows_per_card_number ratio: ${(rows.length / Math.max(distinctCardNumbers.size, 1)).toFixed(2)}`);
    console.log(`First 15 rows:`);
    for (const r of rows.slice(0, 15)) {
      const row = r as { card_number: string; name: string; set_name: string; variant: string | null };
      console.log(`  ${row.card_number}\t${row.name}\t[${row.set_name}]\t${row.variant ?? ""}`);
    }
    console.log(`Last 5 rows:`);
    for (const r of rows.slice(-5)) {
      const row = r as { card_number: string; name: string; set_name: string; variant: string | null };
      console.log(`  ${row.card_number}\t${row.name}\t[${row.set_name}]\t${row.variant ?? ""}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
