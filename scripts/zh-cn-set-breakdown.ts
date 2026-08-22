// Dumps every zh-cn set_id in the DB with its row count, sorted by count
// descending. Read-only. Meant to be eyeballed side-by-side against TCG
// Collector's own per-set zh-cn listing (https://www.tcgcollector.com/sets/cn)
// to find which specific sets have the biggest real gaps — same manual
// comparison method used to find every thread closed this session, just
// applied to the other ~130 sets nobody's looked at yet.
//
// Usage: npx tsx scripts/zh-cn-set-breakdown.ts

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

  // Pull set_id for every zh-cn row, paginated (Supabase default caps a
  // single select at 1000 rows) — 9,400+ rows needs several pages.
  const counts = new Map<string, number>();
  const PAGE_SIZE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("cards")
      .select("set_id")
      .eq("language", "zh-cn")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const id = (row as { set_id: string }).set_id ?? "(null)";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, c]) => sum + c, 0);

  console.log(`Total zh-cn rows: ${total} across ${sorted.length} distinct set_id(s).\n`);
  console.log(`set_id\tcount`);
  for (const [id, count] of sorted) {
    console.log(`${id}\t${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
