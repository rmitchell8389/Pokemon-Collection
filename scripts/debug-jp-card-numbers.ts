// One-off diagnostic: prints the raw card_number value TCGdex gave us for a
// handful of cards in specific Japanese sets, so we can see exactly how it
// differs from Limitless's own numbering (e.g. "001" vs "1") instead of
// guessing. Read-only — no writes.
//
// Usage:
//   npx tsx scripts/debug-jp-card-numbers.ts M1L SM11b M-P

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
  const setIds = process.argv.slice(2);

  if (setIds.length === 0) {
    throw new Error("Pass one or more set ids, e.g. npx tsx scripts/debug-jp-card-numbers.ts M1L SM11b M-P");
  }

  for (const setId of setIds) {
    const { data, error } = await supabase
      .from("cards")
      .select("card_number, name, image_url")
      .eq("language", "ja")
      .eq("set_id", setId)
      .order("card_number")
      .limit(10);

    if (error) {
      console.log(`! ${setId}: ${error.message}`);
      continue;
    }

    console.log(`\n=== ${setId} (first ${data?.length ?? 0} card(s), sorted by card_number) ===`);
    for (const row of data ?? []) {
      console.log(`  card_number=${JSON.stringify(row.card_number)}  image_url=${row.image_url ? "SET" : "null"}  name=${row.name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
