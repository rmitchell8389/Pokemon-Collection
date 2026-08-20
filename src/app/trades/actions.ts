"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function proposeTrade(formData: FormData) {
  const friendId = String(formData.get("friendId"));
  const language = String(formData.get("language"));
  const wantCardIds = formData.getAll("wantCardIds").map(String).filter(Boolean);
  const offerCardIds = formData.getAll("offerCardIds").map(String).filter(Boolean);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // A trade needs something from both sides — the original version of this
  // action only ever recorded the single card being requested, with no way
  // to record what the proposer was offering back. That made every "trade"
  // actually a one-sided ask. Now both lists are required.
  if (wantCardIds.length === 0 || offerCardIds.length === 0) {
    redirect(
      `/trades/find?friend=${friendId}&lang=${language}&error=${encodeURIComponent(
        "Pick at least one card you want AND one card you're offering — a trade needs something from both sides."
      )}`
    );
  }

  const { data: trade, error } = await supabase
    .from("trades")
    .insert({ proposer_id: user.id, recipient_id: friendId, status: "proposed" })
    .select("id")
    .single();

  if (error || !trade) return;

  const items = [
    // Cards the friend has that the proposer is asking for.
    ...wantCardIds.map((cardId) => ({
      trade_id: trade.id,
      card_id: cardId,
      language,
      offered_by_user_id: friendId,
    })),
    // Cards the proposer has and is offering in return.
    ...offerCardIds.map((cardId) => ({
      trade_id: trade.id,
      card_id: cardId,
      language,
      offered_by_user_id: user.id,
    })),
  ];

  await supabase.from("trade_items").insert(items);

  revalidatePath("/trades");
  redirect("/trades");
}

const NEXT_STATUS: Record<string, string> = {
  proposed: "in_progress",
  in_progress: "completed",
};

export async function advanceTrade(formData: FormData) {
  const tradeId = String(formData.get("tradeId"));
  const currentStatus = String(formData.get("currentStatus"));
  const next = NEXT_STATUS[currentStatus];
  if (!next) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Needed either way: the proposed -> in_progress check below, and (for
  // in_progress -> completed) proposer_id/recipient_id to work out who
  // receives what when auto-adding cards to collections further down.
  const { data: trade } = await supabase
    .from("trades")
    .select("proposer_id, recipient_id")
    .eq("id", tradeId)
    .maybeSingle();
  if (!trade) return;

  // Moving proposed -> in_progress is "accepting" the trade. Only the
  // recipient can do that — otherwise the proposer could immediately
  // advance (and even complete) their own offer with zero involvement from
  // the other person, which is exactly what real Postgres testing showed
  // was possible before this check existed. The row-level security policy
  // deliberately stays permissive for either participant (that's the
  // "can a stranger touch this trade" boundary); this is an app-level rule
  // on top of it for "which participant can do what."
  //
  // in_progress -> completed has no such restriction: either side
  // confirming the physical exchange happened is enough for a light
  // workflow between friends who already trust each other.
  if (currentStatus === "proposed" && trade.recipient_id !== user.id) return;

  await supabase
    .from("trades")
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq("id", tradeId);

  // Completing a trade means both sides now own whatever the OTHER side
  // offered — added to each participant's collection automatically and
  // immediately, regardless of which of them clicked "Mark as completed".
  // This is safe to do without asking: owning a card you didn't have
  // before has no downside. It's allowed past RLS by the
  // "trade completion adds the received card for both sides" policy on
  // collection_entries (see schema.sql) — the normal
  // "users manage their own collection" policy alone wouldn't allow
  // writing a row for the OTHER participant.
  //
  // The other half of a trade — REMOVING the traded card from the GIVING
  // side's collection — deliberately does NOT happen here. See
  // resolveGivenCard below for why: this app has no concept of
  // quantity-owned, so an automatic removal here could silently un-own a
  // card someone actually has a spare of. That's a per-card decision only
  // the giver can make, asked separately once the trade is completed.
  if (next === "completed") {
    const { data: items } = await supabase
      .from("trade_items")
      .select("card_id, language, offered_by_user_id")
      .eq("trade_id", tradeId);

    const receivedRows = (items ?? []).map((item) => ({
      user_id: item.offered_by_user_id === trade.proposer_id ? trade.recipient_id : trade.proposer_id,
      card_id: item.card_id,
      language: item.language,
    }));

    if (receivedRows.length > 0) {
      // ignoreDuplicates: true so a card the receiver already owned (e.g.
      // traded for a second copy) doesn't get its added_at bumped or
      // error out — this is purely additive, never destructive.
      await supabase
        .from("collection_entries")
        .upsert(receivedRows, { onConflict: "user_id,card_id,language", ignoreDuplicates: true });
    }
  }

  revalidatePath("/trades");
  revalidatePath("/collection");
}

// Lets the person who GAVE a card away in a completed trade decide, per
// card, whether to remove it from their own collection or keep it marked
// owned because they had a spare. Deliberately separate from advanceTrade
// (which only ever ADDS cards, automatically) — see the comment there and
// in schema.sql for why removal needs a human decision instead of being
// automatic.
export async function resolveGivenCard(formData: FormData) {
  const tradeItemId = String(formData.get("tradeItemId"));
  const keepDuplicate = formData.get("keepDuplicate") === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: item } = await supabase
    .from("trade_items")
    .select("id, trade_id, card_id, language, offered_by_user_id, giver_kept_duplicate")
    .eq("id", tradeItemId)
    .maybeSingle();
  // Only the giver can resolve their own item (also enforced by the
  // "giver can record their own duplicate decision" RLS policy), and only
  // once — giver_kept_duplicate starts null and this is a one-way action.
  if (!item || item.offered_by_user_id !== user.id || item.giver_kept_duplicate !== null) return;

  const { data: trade } = await supabase
    .from("trades")
    .select("status")
    .eq("id", item.trade_id)
    .maybeSingle();
  if (!trade || trade.status !== "completed") return;

  if (!keepDuplicate) {
    await supabase
      .from("collection_entries")
      .delete()
      .eq("user_id", user.id)
      .eq("card_id", item.card_id)
      .eq("language", item.language);
  }

  await supabase.from("trade_items").update({ giver_kept_duplicate: keepDuplicate }).eq("id", tradeItemId);

  revalidatePath("/trades");
  revalidatePath("/collection");
}

export async function cancelTrade(formData: FormData) {
  const tradeId = String(formData.get("tradeId"));

  const supabase = await createClient();
  await supabase
    .from("trades")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", tradeId);

  revalidatePath("/trades");
}
