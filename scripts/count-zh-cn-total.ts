// One-off: total zh-cn card count in the live DB, for comparing against
// TCG Collector's stated 12,508-card zh-cn target. Read-only, no writes.
//
// Usage: npx tsx scripts/count-zh-cn-total.ts

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

  const { count, error } = await supabase
    .from("cards")
    .select("*", { count: "exact", head: true })
    .eq("language", "zh-cn");

  if (error) throw error;

  console.log(`Total zh-cn cards in DB: ${count}`);

  // Also a per-set-prefix breakdown for the sets touched this session, so
  // it's easy to see at a glance that everything landed.
  const prefixes = ["SM-P", "S-P", "SV-P", "M-P", "CSM2DC", "CSM1DC", "CSVH1C", "CSVH2C", "CSVH3C", "CSVH4C", "CSVH5C"];
  console.log(`\nPer-set breakdown (this session's sets):`);
  for (const prefix of prefixes) {
    const { count: setCount, error: setError } = await supabase
      .from("cards")
      .select("*", { count: "exact", head: true })
      .eq("language", "zh-cn")
      .eq("set_id", prefix);
    if (setError) {
      console.log(`  ${prefix}: error (${setError.message})`);
      continue;
    }
    console.log(`  ${prefix}: ${setCount}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
