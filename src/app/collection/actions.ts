"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleOwned(formData: FormData) {
  const cardId = String(formData.get("cardId"));
  const language = String(formData.get("language"));
  const owned = String(formData.get("owned")) === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (owned) {
    // Currently owned -> remove the entry ("don't have" it anymore).
    await supabase
      .from("collection_entries")
      .delete()
      .eq("user_id", user.id)
      .eq("card_id", cardId)
      .eq("language", language);
  } else {
    // Currently not owned -> add it ("have" it now). Also clear any
    // wishlist entry for this card — you can't still "want" something you
    // just marked as owned, and leaving the row around would show a stale
    // "Wanted" badge to friends browsing your collection.
    await supabase.from("collection_entries").upsert(
      { user_id: user.id, card_id: cardId, language },
      { onConflict: "user_id,card_id,language" }
    );
    await supabase
      .from("wishlist_entries")
      .delete()
      .eq("user_id", user.id)
      .eq("card_id", cardId)
      .eq("language", language);
  }

  revalidatePath("/collection");
}

// Marks an already-owned card as available to trade away, or clears that
// flag. Only meaningful for a card you own — there's no row to flag
// otherwise, so this only ever updates an existing collection_entries row
// (never inserts one).
export async function toggleForTrade(formData: FormData) {
  const cardId = String(formData.get("cardId"));
  const language = String(formData.get("language"));
  const forTrade = String(formData.get("forTrade")) === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("collection_entries")
    .update({ for_trade: !forTrade })
    .eq("user_id", user.id)
    .eq("card_id", cardId)
    .eq("language", language);

  revalidatePath("/collection");
}

// Adds or removes a card from the caller's wishlist. Refuses to add a card
// that's already owned — see the cleanup note in toggleOwned above for why
// "want" and "owned" are meant to be mutually exclusive in this first
// version.
export async function toggleWishlist(formData: FormData) {
  const cardId = String(formData.get("cardId"));
  const language = String(formData.get("language"));
  const wanted = String(formData.get("wanted")) === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (wanted) {
    await supabase
      .from("wishlist_entries")
      .delete()
      .eq("user_id", user.id)
      .eq("card_id", cardId)
      .eq("language", language);
  } else {
    const { data: owned } = await supabase
      .from("collection_entries")
      .select("card_id")
      .eq("user_id", user.id)
      .eq("card_id", cardId)
      .eq("language", language)
      .maybeSingle();
    if (owned) return;

    await supabase.from("wishlist_entries").upsert(
      { user_id: user.id, card_id: cardId, language },
      { onConflict: "user_id,card_id,language" }
    );
  }

  revalidatePath("/collection");
}
