// Read-only safety check, run BEFORE any variant-data reconciliation.
//
// Of the ~1,801 real cards affected by the stamp-quote/size/foil
// extraction bugs (see claude/spec.md and the 2026-08-21 session notes),
// all but 3 only affect SUFFIXED rows (the extra print-variant rows
// scripts/import-card-variants.ts adds) — safe to rename/re-key, since
// nothing depended on their exact id staying stable except the labeling.
//
// These 3 are different: the fix changes which physical print the
// UNSUFFIXED base row (id = just "<setId>-<cardNumber>", the row that's
// existed since before variant tracking and is what every plain
// "mark as owned" click, trade, etc. has always pointed at) actually
// represents:
//
//   - hgss4-96 (Magnezone, HeartGold & SoulSilver: Triumphant): the OLD
//     data's "bare normal" entry was actually a player-stamped World
//     Championships promo (misread as bare due to the stamp-quote bug) —
//     the base row currently represents ONE of two different signed promo
//     cards, not an ordinary print.
//   - base1-58 (Pikachu, Base Set): the OLD data's "bare normal" entry was
//     actually a JUMBO promotional print (misread due to the size bug the
//     OLD extraction never captured at all) — the base row currently
//     represents the jumbo promo, not the ordinary Unlimited print most
//     collectors would expect. This is the highest-stakes one simply
//     because Base Set Pikachu is about as commonly-owned as cards get.
//   - ex1-5 (Delcatty, EX Ruby & Sapphire): same pattern as hgss4-96 —
//     the base row currently represents one of three different signed
//     World Championships promos, not an ordinary print.
//
// This script does NOT change anything. It just reports whether anyone's
// collection_entries or trade_items currently reference these 3 base card
// ids, so we know before reconciling whether special handling (e.g.
// notifying whoever owns them, or a manual review) is needed for these
// specific 3, versus the other ~1,798 which are safe to migrate
// mechanically.
//
// Usage: npx tsx scripts/check-primary-risk-cards.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const RISK_CARD_IDS = ["hgss4-96", "base1-58", "ex1-5"];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  for (const cardId of RISK_CARD_IDS) {
    console.log(`\n=== ${cardId} ===`);

    const { data: cardRow } = await supabase
      .from("cards")
      .select("id, name, set_name, card_number")
      .eq("id", cardId)
      .eq("language", "en")
      .maybeSingle();
    console.log(`  cards row: ${cardRow ? `"${cardRow.name}" (${cardRow.set_name} #${cardRow.card_number})` : "NOT FOUND"}`);

    const { data: owners, error: ownersErr } = await supabase
      .from("collection_entries")
      .select("user_id, quantity, added_at")
      .eq("card_id", cardId)
      .eq("language", "en");
    if (ownersErr) console.log(`  ! collection_entries query failed: ${ownersErr.message}`);
    else console.log(`  collection_entries referencing this exact id: ${owners?.length ?? 0}`);
    for (const o of owners ?? []) {
      console.log(`    user_id=${o.user_id} quantity=${o.quantity} added_at=${o.added_at}`);
    }

    const { data: tradeItems, error: tradeErr } = await supabase
      .from("trade_items")
      .select("id, trade_id, offered_by_user_id, giver_kept_duplicate")
      .eq("card_id", cardId)
      .eq("language", "en");
    if (tradeErr) console.log(`  ! trade_items query failed: ${tradeErr.message}`);
    else console.log(`  trade_items referencing this exact id: ${tradeItems?.length ?? 0}`);
    for (const t of tradeItems ?? []) {
      console.log(`    trade_id=${t.trade_id} offered_by=${t.offered_by_user_id} giver_kept_duplicate=${t.giver_kept_duplicate}`);
    }
  }

  console.log("\nDone. Paste this whole output back — it decides whether these 3 cards need manual handling before the rest of the reconciliation runs.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
