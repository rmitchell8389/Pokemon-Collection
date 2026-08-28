// Dumps every ja (Japanese) set_id in the DB with its row count, sorted by
// count descending. Read-only. Direct `ja`-language port of
// zh-cn-set-breakdown.ts (2026-08-27, round 10) — same method, applied to
// the Japan gap now that a real target list exists.
//
// Meant to be eyeballed side-by-side against TCG Collector's own per-set JP
// listing (https://www.tcgcollector.com/sets/jp), captured in
// data/tcgcollector-jp-sets-raw.md (453 sets, 2026-08-27 paste) — same
// reconciliation method the zh-cn round-12 pass used
// (data/zh-cn-round12-reconciliation.md), just for Japanese instead of
// Simplified Chinese.
//
// IMPORTANT caveat carried over from data/tcgcollector-jp-sets-raw.md: that
// file's short codes are TCG Collector's own, and are NOT guaranteed to
// match this DB's set_id values one-for-one — TCGdex (this project's card
// source) and TCG Collector don't necessarily use identical set codes for
// every JP set, the same kind of mismatch round-12 had to resolve by set
// NAME for a handful of zh-cn codes. Matching this script's output against
// that file's targets will need eyeballing by set name in some cases, not
// a blind code-to-code join.
//
// Usage: npx tsx scripts/ja-set-breakdown.ts

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

  // Pull set_id for every ja row, paginated (Supabase default caps a single
  // select at 1000 rows) — this pool is larger than zh-cn's, likely several
  // thousand rows across many more pages.
  const counts = new Map<string, number>();
  const PAGE_SIZE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("cards")
      .select("set_id")
      .eq("language", "ja")
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

  console.log(`Total ja rows: ${total} across ${sorted.length} distinct set_id(s).\n`);
  console.log(`set_id\tcount`);
  for (const [id, count] of sorted) {
    console.log(`${id}\t${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
