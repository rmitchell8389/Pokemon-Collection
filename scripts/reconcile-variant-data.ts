// Fixes the ~2,253 real card/language entries whose variant KEYS were
// computed wrong by the original extraction script (three separate bugs,
// all found and fixed 2026-08-21 — see claude/spec.md and
// src/lib/cardVariants.ts / scripts/import-card-variants.ts for the
// history): a stamp regex that only matched double-quoted strings (missed
// every single-quoted stamp), a missing `size` field (jumbo/oversized
// prints got silently folded into the plain "normal" key), and a missing
// `foil` field (some foil-pattern prints did the same). data/
// variant-migration-map.json is the fix: built by re-parsing the whole
// TCGdex cards-database repo and computing OLD-style and NEW-style keys for
// the SAME source entries in the SAME pass, so which physical print maps to
// which key is provably correct, not inferred by diffing two independently
// -built lists. See build_migration_map.py (run outside this repo) for how
// it was built.
//
// What this script does, per affected (set_id, card_number, language):
//   1. Resolves the live base card row (tries raw/zero-padded/stripped
//      card_number candidates against `cards`, same tolerant approach as
//      lookupVariants in cardVariants.ts — the migration map's card_number
//      comes from source-repo filenames, which don't always match TCGdex's
//      own live card_number field exactly).
//   2. For each variant ENTRY (by position — old_keys[i] and new_keys[i]
//      are the SAME physical print), computes what id it had
//      (old_id = i is old-primary ? base id : "<base id>-<old_keys[i]>")
//      and what id it should have (same logic with new_keys/new_primary).
//   3. Where old_id !== new_id, migrates that entry: ensures a `cards` row
//      exists at new_id (never touches the base row's own fields — it
//      keeps meaning "the primary print" the same way it always has,
//      per import-card-variants.ts's zero-risk design), reassigns any real
//      collection_entries/trade_items rows pointing at old_id over to
//      new_id, then deletes the old_id row IF nothing still references it.
//
// Safety rules, not just aspirations — enforced in code:
//   - The base row (id with no suffix) is NEVER deleted, regardless of
//     which entry is "primary" under the new scheme.
//   - A `cards` row is only ever deleted after confirming (by live query,
//     right before the delete) that no collection_entries or trade_items
//     row still references it — `cards` has ON DELETE CASCADE from both,
//     so deleting a still-referenced row would silently destroy someone's
//     real ownership/trade record, not just a label.
//   - If reassigning a collection_entries row would collide with a row the
//     same user already has at the target id (both id, language) — the
//     table's primary key is (user_id, card_id, language) — this script
//     does NOT guess how to merge them (e.g. sum quantities). It leaves
//     both rows untouched, reports the collision by name for manual
//     review, and consequently leaves the corresponding stale `cards` row
//     in place too (since it's still referenced), rather than delete data.
//   - For any one card, a change that VACATES the base id (entry that was
//     primary before, isn't anymore) is always applied before a change
//     that FILLS the base id (a different entry becomes primary) — so a
//     user who happens to own both ids involved never hits a spurious
//     mid-migration collision.
//
// Usage:
//   npx tsx scripts/reconcile-variant-data.ts                  # dry run, everything
//   npx tsx scripts/reconcile-variant-data.ts --set=base1      # dry run, one set
//   npx tsx scripts/reconcile-variant-data.ts --commit         # write, everything
//
// ALWAYS run without --commit first and read the full report before
// re-running with --commit. Idempotent and safe to re-run either way — an
// entry with old_id === new_id already (nothing left to do) is skipped, and
// a stale row that's already been deleted just won't be found again.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local, same as every other
// script in this project.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zeroPadCardNumber, stripLeadingZeros, labelVariant } from "../src/lib/cardVariants";

type Language = "en" | "ja" | "zh-tw" | "zh-cn";

interface MigrationEntry {
  old_keys: string[];
  new_keys: string[];
  old_primary: string;
  new_primary: string;
  primary_entry_changed: boolean;
}

interface CardRow {
  id: string;
  language: string;
  set_id: string;
  set_name: string;
  card_number: string;
  name: string;
  national_dex_no: number | null;
  rarity: string | null;
  image_url: string | null;
  variant: string | null;
}

interface EntryChange {
  entryIndex: number;
  oldId: string;
  newId: string;
  newVariantKey: string | null; // null means newId is the base row
}

function parseArgs() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const setFilter = args.find((a) => a.startsWith("--set="))?.split("=")[1];
  return { commit, setFilter };
}

function loadMigrationMap(): Record<string, MigrationEntry> {
  const path = join(process.cwd(), "data", "variant-migration-map.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

// set_id never contains "_", card_number practically never does either —
// lang is always the last token and is one of the 4 known values, so
// splitting from the right is unambiguous even in the (unseen) case of an
// underscore elsewhere.
function parseKey(key: string): { setId: string; cardNumber: string; lang: Language } {
  const parts = key.split("_");
  const lang = parts[parts.length - 1] as Language;
  const setId = parts[0];
  const cardNumber = parts.slice(1, -1).join("_");
  return { setId, cardNumber, lang };
}

const CONCURRENCY = 5;
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
}

async function main() {
  const { commit, setFilter } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  const migrationMap = loadMigrationMap();
  const keys = Object.keys(migrationMap).filter((k) => !setFilter || k.startsWith(`${setFilter}_`));

  console.log(`${commit ? "COMMIT" : "DRY RUN"} — variant-data reconciliation${setFilter ? ` (set=${setFilter} only)` : ""}`);
  console.log(`${keys.length} card/language entr${keys.length === 1 ? "y" : "ies"} in the migration map\n`);

  // Stats for the closing report.
  let cardsNotFoundLive = 0;
  let cardsNoChangeNeeded = 0;
  let entriesUnchanged = 0;
  let entriesRenamed = 0;
  let rowsInserted = 0;
  let rowsDeleted = 0;
  let rowsLeftBehindDueToConflict = 0;
  let collectionEntriesReassigned = 0;
  let tradeItemsReassigned = 0;
  const collisions: string[] = [];
  const conflictLeftovers: string[] = [];
  let processed = 0;

  // Concurrent per-key worker (see runPool above) — each key does several
  // sequential DB round-trips of its own, so running keys one at a time
  // for all 2,253 of them would take a very long time. This is the pool
  // that was defined but never wired in before — fixed after a real dry
  // run against Ross's account sat on just the header for several minutes.
  async function processKey(key: string) {
    const entry = migrationMap[key];
    const { setId, cardNumber, lang } = parseKey(key);

    // 1. Resolve the live base row — tolerant candidate lookup, same
    // approach as lookupVariants.
    const candidates = [cardNumber, zeroPadCardNumber(cardNumber), stripLeadingZeros(cardNumber)].filter(
      (n): n is string => n !== null
    );
    let baseRow: CardRow | null = null;
    for (const c of candidates) {
      const { data } = await supabase
        .from("cards")
        .select("id, language, set_id, set_name, card_number, name, national_dex_no, rarity, image_url, variant")
        .eq("id", `${setId}-${c}`)
        .eq("language", lang)
        .maybeSingle();
      if (data) {
        baseRow = data as CardRow;
        break;
      }
    }
    if (!baseRow) {
      cardsNotFoundLive++;
      return;
    }
    const baseId = baseRow.id;

    // 2. Compute per-entry old/new ids.
    const oldPrimaryIdx = entry.old_keys.indexOf(entry.old_primary);
    const newPrimaryIdx = entry.new_keys.indexOf(entry.new_primary);
    const changes: EntryChange[] = [];
    for (let i = 0; i < entry.old_keys.length; i++) {
      const oldId = i === oldPrimaryIdx ? baseId : `${baseId}-${entry.old_keys[i]}`;
      const newId = i === newPrimaryIdx ? baseId : `${baseId}-${entry.new_keys[i]}`;
      if (oldId === newId) {
        entriesUnchanged++;
        continue;
      }
      entriesRenamed++;
      changes.push({ entryIndex: i, oldId, newId, newVariantKey: i === newPrimaryIdx ? null : entry.new_keys[i] });
    }
    if (changes.length === 0) {
      cardsNoChangeNeeded++;
      return;
    }
    // Any change that VACATES the base id must apply before one that FILLS
    // it, so a user owning both ids never hits a spurious mid-migration
    // collision (see header comment).
    changes.sort((a, b) => (a.oldId === baseId ? 0 : 1) - (b.oldId === baseId ? 0 : 1));

    // 3. Ensure every target new_id (other than the base id, which always
    // already exists and is never touched) has a `cards` row, BEFORE any
    // collection_entries/trade_items reassignment — those have a foreign
    // key on (cards.id, cards.language).
    for (const change of changes) {
      if (change.newId === baseId) continue; // base row's own fields never change
      const label = labelVariant(change.newVariantKey!);
      const newRow: CardRow = {
        id: change.newId,
        language: baseRow.language,
        set_id: baseRow.set_id,
        set_name: baseRow.set_name,
        card_number: baseRow.card_number,
        name: `${baseRow.name} (${label})`,
        national_dex_no: baseRow.national_dex_no,
        rarity: baseRow.rarity,
        image_url: baseRow.image_url,
        variant: change.newVariantKey,
      };
      rowsInserted++;
      if (commit) {
        const { error } = await supabase.from("cards").upsert(newRow, { onConflict: "id,language" });
        if (error) console.error(`  ! failed to upsert ${change.newId}: ${error.message}`);
      }
    }

    // 4. Reassign real references from old_id to new_id, per change, in
    // vacate-before-fill order established above.
    for (const change of changes) {
      const { data: owners } = await supabase
        .from("collection_entries")
        .select("user_id, quantity, added_at")
        .eq("card_id", change.oldId)
        .eq("language", lang);

      for (const owner of owners ?? []) {
        const { data: existingAtTarget } = await supabase
          .from("collection_entries")
          .select("user_id, quantity")
          .eq("user_id", owner.user_id)
          .eq("card_id", change.newId)
          .eq("language", lang)
          .maybeSingle();

        if (existingAtTarget) {
          collisions.push(
            `user ${owner.user_id}: owns BOTH ${change.oldId} (qty ${owner.quantity}) and ${change.newId} (qty ${existingAtTarget.quantity}) — ${change.oldId} should migrate to ${change.newId} but a row already exists there. Left both as-is, needs manual merge.`
          );
          continue;
        }

        collectionEntriesReassigned++;
        if (commit) {
          const { error } = await supabase
            .from("collection_entries")
            .update({ card_id: change.newId })
            .eq("user_id", owner.user_id)
            .eq("card_id", change.oldId)
            .eq("language", lang);
          if (error) console.error(`  ! failed to reassign collection_entries for ${owner.user_id}: ${error.message}`);
        }
      }

      const { data: tradeItems } = await supabase
        .from("trade_items")
        .select("id")
        .eq("card_id", change.oldId)
        .eq("language", lang);
      for (const ti of tradeItems ?? []) {
        tradeItemsReassigned++;
        if (commit) {
          const { error } = await supabase.from("trade_items").update({ card_id: change.newId }).eq("id", ti.id);
          if (error) console.error(`  ! failed to reassign trade_items ${ti.id}: ${error.message}`);
        }
      }
    }

    // 5. Delete stale old_id rows — never the base id, and only if nothing
    // still references them (re-checked live, right before deleting, in
    // case a collision above left something behind).
    const staleIds = [...new Set(changes.map((c) => c.oldId))].filter((id) => id !== baseId);
    for (const staleId of staleIds) {
      const { count: remainingOwners } = await supabase
        .from("collection_entries")
        .select("user_id", { count: "exact", head: true })
        .eq("card_id", staleId)
        .eq("language", lang);
      const { count: remainingTrades } = await supabase
        .from("trade_items")
        .select("id", { count: "exact", head: true })
        .eq("card_id", staleId)
        .eq("language", lang);

      if ((remainingOwners ?? 0) > 0 || (remainingTrades ?? 0) > 0) {
        rowsLeftBehindDueToConflict++;
        conflictLeftovers.push(
          `${staleId}: left in place — still referenced by ${remainingOwners ?? 0} collection_entries / ${remainingTrades ?? 0} trade_items after reassignment (see collisions above).`
        );
        continue;
      }

      rowsDeleted++;
      if (commit) {
        const { error } = await supabase.from("cards").delete().eq("id", staleId).eq("language", lang);
        if (error) console.error(`  ! failed to delete stale row ${staleId}: ${error.message}`);
      }
    }

    processed++;
    if (processed % 200 === 0) console.log(`  ...${processed}/${keys.length} processed`);
  }

  await runPool(keys, processKey);

  console.log("=== Summary ===");
  console.log(`  card/language entries with no live match: ${cardsNotFoundLive}`);
  console.log(`  card/language entries needing no change: ${cardsNoChangeNeeded}`);
  console.log(`  variant entries unchanged (old id === new id): ${entriesUnchanged}`);
  console.log(`  variant entries renamed: ${entriesRenamed}`);
  console.log(`  cards rows ${commit ? "inserted" : "to insert"}: ${rowsInserted}`);
  console.log(`  cards rows ${commit ? "deleted" : "to delete"}: ${rowsDeleted}`);
  console.log(`  collection_entries rows ${commit ? "reassigned" : "to reassign"}: ${collectionEntriesReassigned}`);
  console.log(`  trade_items rows ${commit ? "reassigned" : "to reassign"}: ${tradeItemsReassigned}`);
  console.log(`  stale rows left behind due to real ownership collisions: ${rowsLeftBehindDueToConflict}`);

  if (collisions.length > 0) {
    console.log(`\n=== Ownership collisions (need manual review, nothing auto-changed for these) ===`);
    for (const c of collisions) console.log(`  ${c}`);
  }
  if (conflictLeftovers.length > 0) {
    console.log(`\n=== Stale rows NOT deleted ===`);
    for (const c of conflictLeftovers) console.log(`  ${c}`);
  }

  if (!commit) {
    console.log("\nDry run only — nothing was written. Paste this whole output back before re-running with --commit.");
  } else {
    console.log("\nCommitted. Next step: swap in the corrected data/card-variants-index.json (only after this ran clean).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
