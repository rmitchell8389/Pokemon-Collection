"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

  // Both pages show owned/wishlist/for-trade status on the same cards
  // table, so a toggle from either one needs to refresh both — otherwise
  // whichever page you didn't act from shows stale badges until a manual
  // reload.
  revalidatePath("/collection");
  revalidatePath("/search");
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
  revalidatePath("/search");
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
  revalidatePath("/search");
}

// ---------------------------------------------------------------------------
// Bulk "danger zone" actions (added 2026-08-26) — unlike every action above,
// these affect every card at once rather than one at a time, so both
// require a real typed confirmation ("REMOVE", checked server-side) rather
// than trusting a single button click. Both are scoped by `language`
// (whichever language tab the person is on when they act, not their whole
// account) — see the "Danger zone" section on src/app/collection/page.tsx
// for the two-step UI (a plain link reveals the confirm form, no client JS
// needed) that drives these. `redirect()` is used explicitly in both
// (rather than just returning, like the actions above) so a wrong/missing
// confirmation text sends the person back to the SAME confirm panel with an
// error, and a successful action lands back on the plain view with the
// panel closed, instead of silently re-rendering the confirm form either
// way.
const REQUIRED_CONFIRM_TEXT = "REMOVE";

function requireConfirmed(formData: FormData, language: string, dangerZone: "owned" | "trade") {
  const confirmText = String(formData.get("confirmText") ?? "").trim();
  if (confirmText !== REQUIRED_CONFIRM_TEXT) {
    redirect(
      `/collection?lang=${encodeURIComponent(language)}&confirmDanger=${dangerZone}&dangerError=${encodeURIComponent(
        `Type "${REQUIRED_CONFIRM_TEXT}" exactly (all caps) to confirm — nothing was removed.`
      )}`
    );
  }
}

// Permanently deletes every collection_entries row the signed-in user has
// in `language` — a full reset for that language, not a filtered subset.
// Never touches wishlist_entries (a separate, explicitly NOT-in-scope
// decision, not an oversight) or any other language.
export async function removeAllOwned(formData: FormData) {
  const language = String(formData.get("language"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  requireConfirmed(formData, language, "owned");

  await supabase.from("collection_entries").delete().eq("user_id", user.id).eq("language", language);

  revalidatePath("/collection");
  revalidatePath("/search");
  redirect(`/collection?lang=${encodeURIComponent(language)}`);
}

// Clears the for_trade flag on every card currently marked for trade in
// `language`, without removing them from the owned collection — the
// smaller, less-destructive sibling of removeAllOwned above.
export async function removeAllForTrade(formData: FormData) {
  const language = String(formData.get("language"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  requireConfirmed(formData, language, "trade");

  await supabase
    .from("collection_entries")
    .update({ for_trade: false })
    .eq("user_id", user.id)
    .eq("language", language)
    .eq("for_trade", true);

  revalidatePath("/collection");
  revalidatePath("/search");
  redirect(`/collection?lang=${encodeURIComponent(language)}`);
}
