// One-off diagnostic: dumps every still-missing zh-cn card (card_number +
// name) for the given set_id(s), no wiki calls, no 10-row cap — unlike
// debug-cn-card-images.ts, this is meant to produce a full list to paste
// back for cross-referencing against the wiki's reprint-template data by
// hand/by Claude, not to test resolution itself. Read-only on the database.
//
// Usage:
//   npx tsx scripts/list-cn-missing-cards.ts SV8a CSMPiC

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const supabase = createClient(url, serviceKey);
  const setIds = process.argv.slice(2);

  if (setIds.length === 0) {
    throw new Error("Pass one or more set ids, e.g. npx tsx scripts/list-cn-missing-cards.ts SV8a CSMPiC");
  }

  for (const setId of setIds) {
    console.log(`\n=== ${setId} ===`);

    const rows: { card_number: string; name: string }[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("cards")
        .select("card_number, name")
        .eq("language", "zh-cn")
        .eq("set_id", setId)
        .is("image_url", null)
        .order("card_number")
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.log(`  ! ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    console.log(`  ${rows.length} missing card(s)`);
    for (const row of rows) {
      console.log(`${setId}\t${row.card_number}\t${row.name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
