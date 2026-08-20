// One-off diagnostic: prints the raw card_number TCGdex gave us for the
// still-missing-image zh-tw cards in specific sets, so we can see exactly
// why a set filled 0/N on backfill:images-tc instead of guessing. Modeled on
// scripts/debug-jp-card-numbers.ts (the tool that found the Limitless
// zero-padding bug) — read-only, no writes.
//
// Usage:
//   npx tsx scripts/debug-tc-card-numbers.ts SDL SV-P S11a SVF

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
    throw new Error("Pass one or more set ids, e.g. npx tsx scripts/debug-tc-card-numbers.ts SDL SV-P S11a");
  }

  for (const setId of setIds) {
    const { data, error } = await supabase
      .from("cards")
      .select("card_number, name, set_name, image_url")
      .eq("language", "zh-tw")
      .eq("set_id", setId)
      .is("image_url", null)
      .order("card_number")
      .limit(15);

    if (error) {
      console.log(`! ${setId}: ${error.message}`);
      continue;
    }

    console.log(`\n=== ${setId} (first ${data?.length ?? 0} still-missing card(s), sorted by card_number) ===`);
    if (!data || data.length === 0) {
      console.log("  (none missing — already fully filled)");
      continue;
    }
    console.log(`  set_name=${JSON.stringify(data[0].set_name)}`);
    for (const row of data) {
      console.log(`  card_number=${JSON.stringify(row.card_number)}  name=${row.name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
