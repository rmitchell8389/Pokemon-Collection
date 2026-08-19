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
  if (currentStatus === "proposed") {
    const { data: trade } = await supabase
      .from("trades")
      .select("recipient_id")
      .eq("id", tradeId)
      .maybeSingle();
    if (!trade || trade.recipient_id !== user.id) return;
  }

  await supabase
    .from("trades")
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq("id", tradeId);

  revalidatePath("/trades");
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
