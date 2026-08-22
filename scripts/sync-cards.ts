// Pulls the card catalog from TCGdex for each supported language and
// upserts it into the local Supabase `cards` table (see supabase/schema.sql).
//
// Usage:
//   npm run sync                       # all 4 languages, all sets
//   npm run sync -- --lang=ja          # just Japanese
//   npm run sync -- --lang=en --set=base1   # one set, for testing
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local — the service role key
// bypasses row-level security, which regular users' anon-key sessions can't
// (the `cards` table has no insert/update policy for authenticated users on
// purpose, see supabase/schema.sql).
//
// Runs card detail fetches with limited concurrency to be a considerate
// citizen of TCGdex's free, no-key-required API (their docs ask callers not
// to hammer it) — see the CONCURRENCY constant below.

// Plain `dotenv/config` only reads a file literally named `.env`. Next.js
// itself auto-loads `.env.local` (which is why that's the filename used
// throughout this project's setup instructions), but this script runs
// standalone via tsx, outside Next.js, so it has to be told explicitly.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  TCGDEX_LANGUAGES,
  TCG_POCKET_SERIE_ID,
  type TcgdexLanguage,
  listSets,
  getSet,
  getCard,
  getSerie,
} from "../src/lib/tcgdex";

const CONCURRENCY = 5;

function parseArgs() {
  const args = process.argv.slice(2);
  const langArg = args.find((a) => a.startsWith("--lang="))?.split("=")[1];
  const setArg = args.find((a) => a.startsWith("--set="))?.split("=")[1];

  const languages: TcgdexLanguage[] = langArg
    ? [langArg as TcgdexLanguage]
    : [...TCGDEX_LANGUAGES];

  for (const l of languages) {
    if (!TCGDEX_LANGUAGES.includes(l)) {
      throw new Error(`Unknown language "${l}". Expected one of: ${TCGDEX_LANGUAGES.join(", ")}`);
    }
  }

  return { languages, setFilter: setArg };
}

// Tiny concurrency-limited map — avoids pulling in a dependency for this.
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
  const { languages, setFilter } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in."
    );
  }

  const supabase = createClient(url, serviceKey);

  for (const language of languages) {
    console.log(`\n=== ${language} ===`);

    const allSets = setFilter
      ? [{ id: setFilter, name: setFilter, cardCount: { total: 0, official: 0 } }]
      : await listSets(language);

    // Skip Pokemon TCG Pocket sets — this app tracks the physical TCG only.
    // See the comment on TCG_POCKET_SERIE_ID in src/lib/tcgdex.ts for the
    // (docs-sourced, not live-verified) basis for this. Only applied on a
    // full/language-wide sync, not a `--set=` run, since that's an explicit
    // request for one specific set.
    let pocketSetIds = new Set<string>();
    if (!setFilter) {
      try {
        const pocketSerie = await getSerie(language, TCG_POCKET_SERIE_ID);
        pocketSetIds = new Set(pocketSerie.sets.map((s) => s.id));
        console.log(`  found ${pocketSetIds.size} TCG Pocket set(s) for ${language} — excluding from sync`);
      } catch (err) {
        console.error(
          `  ! couldn't fetch the "tcgp" series for ${language} (${(err as Error).message}) — Pocket sets will NOT be excluded this run`
        );
      }
    }

    const sets = allSets.filter((s) => !pocketSetIds.has(s.id));
    console.log(`${sets.length} set(s) to process${pocketSetIds.size > 0 ? ` (${allSets.length - sets.length} Pocket set(s) skipped)` : ""}`);

    // Self-healing cleanup: if a previous run (before this fix) already
    // synced Pocket cards into this language, remove them now rather than
    // requiring a manual SQL step.
    if (pocketSetIds.size > 0) {
      const { error: delError, count } = await supabase
        .from("cards")
        .delete({ count: "exact" })
        .eq("language", language)
        .in("set_id", Array.from(pocketSetIds));
      if (delError) {
        console.error(`  ! failed to remove previously-synced Pocket cards for ${language}: ${delError.message}`);
      } else if (count) {
        console.log(`  removed ${count} previously-synced Pocket card(s) for ${language}`);
      }
    }

    for (const setBrief of sets) {
      let fullSet;
      try {
        fullSet = await getSet(language, setBrief.id);
      } catch (err) {
        console.error(`  ! failed to load set ${setBrief.id}:`, (err as Error).message);
        continue;
      }

      console.log(`  ${fullSet.id} (${fullSet.name}) — ${fullSet.cards.length} card(s)`);

      // Belongs to the set, not the individual card — read once per set
      // rather than refetched per card. See the `serie` field comment on
      // TcgdexSetFull in src/lib/tcgdex.ts.
      const seriesName = fullSet.serie?.name ?? null;

      const rows = await mapWithConcurrency(fullSet.cards, CONCURRENCY, async (brief) => {
        try {
          const card = await getCard(language, brief.id);
          return {
            id: card.id,
            language,
            set_id: card.set.id,
            set_name: card.set.name,
            card_number: card.localId,
            name: card.name,
            national_dex_no: card.dexId?.[0] ?? null,
            rarity: card.rarity ?? null,
            artist: card.illustrator ?? null,
            category: card.category ?? null,
            types: card.types ?? null,
            series: seriesName,
            image_url: card.image ?? null,
            synced_at: new Date().toISOString(),
          };
        } catch (err) {
          console.error(`    ! failed to load card ${brief.id}:`, (err as Error).message);
          return null;
        }
      });

      const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null);
      if (validRows.length === 0) continue;

      const { error } = await supabase.from("cards").upsert(validRows, { onConflict: "id,language" });
      if (error) {
        // A single bad row (seen in practice: TCGdex returning a
        // non-integer national dex number like "384.1" for a handful of
        // Japanese cards) fails the WHOLE batch — Postgres rejects the
        // entire multi-row upsert, silently dropping every other good card
        // in the set along with it. Fall back to inserting one row at a
        // time so only the actual bad row(s) get skipped and reported.
        console.error(`  ! batch upsert failed for set ${fullSet.id} (${error.message}) — retrying row by row`);
        let ok = 0;
        for (const row of validRows) {
          const { error: rowError } = await supabase
            .from("cards")
            .upsert(row, { onConflict: "id,language" });
          if (rowError) {
            console.error(`    ! skipped ${row.id}: ${rowError.message}`);
          } else {
            ok++;
          }
        }
        console.log(`    recovered ${ok}/${validRows.length} card(s) from this set individually`);
      }
    }
  }

  console.log("\nSync complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
