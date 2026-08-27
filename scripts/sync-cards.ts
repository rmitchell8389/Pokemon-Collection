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

import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { pickCardPrice, convertToGbp, type GbpRates } from "../src/lib/cardPricing";
import { getGbpRates } from "../src/lib/exchangeRates";
import { lookupVariants, pickPrimaryVariant, type CardVariantLanguage } from "../src/lib/cardVariants";
import { isPricingEnabled } from "../src/lib/appSettings";
import { stripUnsetImageUrls } from "../src/lib/dbUpsertSafety";

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

  // Master pricing switch — see src/lib/appSettings.ts and the
  // "app_settings" table in supabase/schema.sql. Checked once, up front,
  // for the whole run. When off: the Frankfurter exchange-rate fetch is
  // skipped entirely (no point calling it for nothing), no card's price_*
  // columns are touched by this run's upsert at all (see priceFields
  // below in the per-card loop — omitted from the payload, not zeroed
  // out), so whatever prices are already stored stay exactly as they
  // were. Flipping pricing_enabled back to true and re-running picks up
  // pricing again with no other change needed.
  const pricingEnabled = await isPricingEnabled(supabase);
  if (!pricingEnabled) {
    console.log(
      "\nPricing is OFF (app_settings.pricing_enabled = false) — skipping exchange rates and all price fields this run. Existing price_* data on already-synced cards is left untouched."
    );
  }

  // Fetched once for the whole run, not per card or per language — a GBP
  // conversion rate doesn't meaningfully change over the course of one
  // sync. See src/lib/exchangeRates.ts for the fallback behavior if this
  // fails (reuses the last cached rate rather than aborting pricing for
  // the run).
  let gbpRates: GbpRates | null = null;
  if (pricingEnabled) {
    console.log("\nFetching exchange rates...");
    gbpRates = await getGbpRates(supabase);
    if (!gbpRates) {
      console.warn("  proceeding without GBP conversion this run — price_gbp will stay unset on every card.");
    }
  }

  // Variant-row pricing (added 2026-08-25, see the long comment inside the
  // per-card loop below) needs the same local index file
  // scripts/import-card-variants.ts reads — src/lib/cardVariants.ts throws
  // if it's missing, which would otherwise take down EVERY card in this
  // sync, not just skip pricing, since that call happens inside each
  // card's own try/catch and would make every single one look like a
  // failed TCGdex fetch. Checked once, up front, instead: if the file
  // isn't there, variant-row pricing is skipped for the whole run with one
  // clear warning, and everything else (primary-row pricing, card data)
  // proceeds completely normally. Also gated on pricingEnabled — no point
  // checking for (or warning about) this file at all when pricing is
  // intentionally off.
  const variantIndexAvailable =
    pricingEnabled && existsSync(join(process.cwd(), "data", "card-variants-index.json"));
  if (pricingEnabled && !variantIndexAvailable) {
    console.warn(
      "\n! data/card-variants-index.json not found — variant-row pricing (the holo/reverse-holo/1st-edition/etc rows import-card-variants.ts adds) will be SKIPPED this entire run. This is expected if that file was never committed to the repo; check with `git ls-files data/card-variants-index.json` — if it prints nothing, commit it (it's what import-card-variants.ts itself needs too, so it should already be safe to add). Primary-row card data and pricing are unaffected either way."
    );
  }

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

      let variantRowsPriced = 0;

      const rows = await mapWithConcurrency(fullSet.cards, CONCURRENCY, async (brief) => {
        try {
          const card = await getCard(language, brief.id);
          // `card.id` here is always TCGdex's own native card id, which
          // always corresponds to the variant=null "primary print" row —
          // scripts/import-card-variants.ts is what adds the
          // "<id>-<variant>" rows for a card's OTHER prints (holo, reverse
          // holo, etc.), from a local index file with no live TCGdex fetch
          // of its own. See src/lib/cardPricing.ts for the variant ->
          // TCGdex-pricing-bucket mapping this uses (here, the `null`/
          // "normal" bucket, for this row specifically).
          //
          // priceFields is spread into the returned row below rather than
          // always including price_usd/eur/gbp/source/updated_at directly
          // — when pricing is off (see pricingEnabled above), it stays an
          // empty object, so those columns are simply absent from this
          // run's upsert payload and Postgres leaves whatever's already
          // stored there completely untouched, rather than overwriting
          // real prices with nulls just because pricing was paused.
          let priceFields: Record<string, unknown> = {};
          if (pricingEnabled) {
            const price = pickCardPrice(card.pricing, null);
            const priceGbp = convertToGbp(price, gbpRates);
            priceFields = {
              price_usd: price.usd,
              price_eur: price.eur,
              price_gbp: priceGbp,
              price_source: price.source,
              price_updated_at: price.source !== null ? new Date().toISOString() : null,
            };

            // Also price every OTHER variant row for this same physical
            // card (holo, reverse holo, 1st edition, etc.), reusing the
            // SAME pricing object just fetched above — zero extra TCGdex
            // requests. Added 2026-08-25: turned out to be the dominant
            // cause of "too many cards missing a price" — Ross sampled 15
            // real "missing" cards and 14 of the 15 were variant rows this
            // sync script had never touched at all, only ever pricing the
            // plain/primary row. A plain `.update()` per row (not part of
            // the main upsert below) — these rows may not exist yet if
            // import-card-variants.ts hasn't been run for this
            // set/language, in which case this is just a no-op (0 rows
            // affected), not an error; re-running this script after that
            // script has created them picks the prices up on the next
            // sync.
            const variants = variantIndexAvailable
              ? lookupVariants(language as CardVariantLanguage, card.set.id, card.localId)
              : null;
            if (variants && variants.length > 1) {
              const primary = pickPrimaryVariant(variants);
              for (const variantKey of variants) {
                if (variantKey === primary) continue; // that's this same card.id row, priced above
                const vPrice = pickCardPrice(card.pricing, variantKey);
                const vGbp = convertToGbp(vPrice, gbpRates);
                const { error: vError, count } = await supabase
                  .from("cards")
                  .update(
                    {
                      price_usd: vPrice.usd,
                      price_eur: vPrice.eur,
                      price_gbp: vGbp,
                      price_source: vPrice.source,
                      price_updated_at: vPrice.source !== null ? new Date().toISOString() : null,
                    },
                    { count: "exact" }
                  )
                  .eq("id", `${card.id}-${variantKey}`)
                  .eq("language", language);
                if (vError) {
                  console.error(`    ! failed to price variant row ${card.id}-${variantKey}: ${vError.message}`);
                } else if (count) {
                  variantRowsPriced += count;
                }
              }
            }
          }

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
            ...priceFields,
            synced_at: new Date().toISOString(),
          };
        } catch (err) {
          console.error(`    ! failed to load card ${brief.id}:`, (err as Error).message);
          return null;
        }
      });

      if (variantRowsPriced > 0) {
        console.log(`    priced ${variantRowsPriced} additional variant row(s) for this set`);
      }

      const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null);
      if (validRows.length === 0) continue;

      // Same "omit rather than null out" principle this file already uses
      // for price_* fields (see priceFields above), applied to image_url:
      // TCGdex's own `card.image` is null for plenty of real cards (that's
      // the entire reason the manual-backfill workflows — English and
      // zh-cn — exist), and re-syncing shouldn't silently erase an image a
      // manual pass already filled in for the same row id. Fixed
      // 2026-08-27 after a real incident wiped 1,426 zh-cn images this
      // exact way via a different script (see src/lib/dbUpsertSafety.ts
      // and claude/spec.md's "zh-cn round 18 continued").
      const rowsToCommit = stripUnsetImageUrls(validRows);

      const { error } = await supabase.from("cards").upsert(rowsToCommit, { onConflict: "id,language" });
      if (error) {
        // A single bad row (seen in practice: TCGdex returning a
        // non-integer national dex number like "384.1" for a handful of
        // Japanese cards) fails the WHOLE batch — Postgres rejects the
        // entire multi-row upsert, silently dropping every other good card
        // in the set along with it. Fall back to inserting one row at a
        // time so only the actual bad row(s) get skipped and reported.
        console.error(`  ! batch upsert failed for set ${fullSet.id} (${error.message}) — retrying row by row`);
        let ok = 0;
        for (const row of rowsToCommit) {
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
