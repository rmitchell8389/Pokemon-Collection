// Populates the `pokemon_species_names` table (see supabase/schema.sql)
// from PokeAPI — a National Pokedex number -> official name, per language,
// lookup table used by the Collection page's cross-language search.
//
// This is a ONE-TIME (or very occasional — Pokemon species names don't
// change) sync, separate from `npm run sync` (which pulls card data from
// TCGdex). Run it once before relying on Chinese-language search:
//
//   npm run sync:species
//
// Why this exists: see the header comment in src/lib/pokeapi.ts. Short
// version — TCGdex doesn't reliably tag a dex number on every card (only
// 27% of synced Traditional Chinese cards have one), so cross-language
// search needs an independent, complete name lookup instead of relying on
// that field. PokeAPI provides one for free.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { listAllSpecies, getSpecies, namesByLanguage } from "../src/lib/pokeapi";

const CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

  console.log("Fetching species list from PokeAPI...");
  const list = await listAllSpecies();
  console.log(`${list.results.length} species to fetch`);

  const rows = await mapWithConcurrency(list.results, CONCURRENCY, async (item) => {
    try {
      const species = await getSpecies(item.name);
      const names = namesByLanguage(species);
      return {
        national_dex_no: species.id,
        name_en: names["en"] ?? null,
        name_ja: names["ja"] ?? null,
        name_zh_tw: names["zh-hant"] ?? null,
        name_zh_cn: names["zh-hans"] ?? null,
        synced_at: new Date().toISOString(),
      };
    } catch (err) {
      console.error(`  ! failed to load species ${item.name}:`, (err as Error).message);
      return null;
    }
  });

  const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  console.log(`Fetched ${validRows.length}/${list.results.length} species successfully`);

  const { error } = await supabase
    .from("pokemon_species_names")
    .upsert(validRows, { onConflict: "national_dex_no" });

  if (error) {
    // Same failure mode as the card sync — one bad row can fail the whole
    // batch. Retry row by row so a single oddity doesn't drop everything.
    console.error(`! batch upsert failed (${error.message}) — retrying row by row`);
    let ok = 0;
    for (const row of validRows) {
      const { error: rowError } = await supabase
        .from("pokemon_species_names")
        .upsert(row, { onConflict: "national_dex_no" });
      if (rowError) {
        console.error(`  ! skipped dex #${row.national_dex_no}: ${rowError.message}`);
      } else {
        ok++;
      }
    }
    console.log(`Recovered ${ok}/${validRows.length} species individually`);
  }

  console.log("\nSpecies name sync complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
