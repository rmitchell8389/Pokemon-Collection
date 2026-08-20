// Read-only diagnostic: reports how many cards are missing image_url, broken
// down by language and then by set within each language. Doesn't write
// anything to the database — this exists purely to get a real, current
// picture of scope before deciding how to backfill Japanese (and later
// Traditional/Simplified Chinese) card images, the way backfill-images.ts's
// own summary logging did for English.
//
// Usage:
//   npx tsx scripts/report-missing-images.ts
//   npx tsx scripts/report-missing-images.ts ja        (single language only)

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ALL_LANGUAGES = ["en", "ja", "zh-tw", "zh-cn"] as const;
type Language = (typeof ALL_LANGUAGES)[number];

type CardRow = { set_id: string; set_name: string; card_number: string };

// PostgREST caps a single request at 1000 rows — paginate with .range()
// until a page comes back short, same lesson learned the hard way in
// backfill-images.ts.
async function fetchAllMissingCards(supabase: SupabaseClient, language: Language): Promise<CardRow[]> {
  const PAGE_SIZE = 1000;
  const all: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("set_id, set_name, card_number")
      .eq("language", language)
      .is("image_url", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load missing-image cards for "${language}": ${error.message}`);
    }
    if (!data || data.length === 0) break;

    all.push(...(data as CardRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

async function fetchTotalCount(supabase: SupabaseClient, language: Language): Promise<number> {
  const { count, error } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("language", language);

  if (error) {
    throw new Error(`Failed to count cards for "${language}": ${error.message}`);
  }
  return count ?? 0;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in."
    );
  }

  const supabase = createClient(url, serviceKey);

  const requested = process.argv[2] as Language | undefined;
  const languages: Language[] = requested ? [requested] : [...ALL_LANGUAGES];

  if (requested && !ALL_LANGUAGES.includes(requested)) {
    throw new Error(`Unknown language "${requested}" — expected one of: ${ALL_LANGUAGES.join(", ")}`);
  }

  for (const language of languages) {
    const [total, missing] = await Promise.all([
      fetchTotalCount(supabase, language),
      fetchAllMissingCards(supabase, language),
    ]);

    const pct = total > 0 ? ((missing.length / total) * 100).toFixed(1) : "0.0";
    console.log(`\n=== ${language} ===`);
    console.log(`${missing.length} / ${total} card(s) missing an image (${pct}%)`);

    if (missing.length === 0) continue;

    // Group by set_id (TCGdex's own set identifier, e.g. "sv11b") rather
    // than set_name — this is what we need to check against other card
    // databases' own set codes for a possible image-source mapping, and
    // it's stable/ASCII where set_name may be in the local script.
    const bySet = new Map<string, { name: string; count: number }>();
    for (const card of missing) {
      const entry = bySet.get(card.set_id) ?? { name: card.set_name, count: 0 };
      entry.count++;
      bySet.set(card.set_id, entry);
    }

    const sorted = Array.from(bySet.entries()).sort((a, b) => b[1].count - a[1].count);
    console.log(`Across ${sorted.length} set(s):`);
    for (const [setId, { name, count }] of sorted) {
      console.log(`  ${count.toString().padStart(4)}  ${setId.padEnd(12)}  ${name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});