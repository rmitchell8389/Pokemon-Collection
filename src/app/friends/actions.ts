"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function sendFriendRequest(formData: FormData) {
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Accept either an email or a display name — whichever the person typed —
  // rather than forcing email specifically. Two separate ilike queries
  // (not a single `.or()` filter string) so nothing from the input ever
  // gets interpolated into a PostgREST filter expression; ilike's own
  // parameter binding handles arbitrary characters safely either way.
  const [{ data: byEmail }, { data: byName }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, email").ilike("email", identifier),
    supabase.from("profiles").select("id, display_name, email").ilike("display_name", identifier),
  ]);
  const matchesById = new Map(
    [...(byEmail ?? []), ...(byName ?? [])].map((p) => [p.id, p])
  );
  const matches = Array.from(matchesById.values());

  if (matches.length === 0) {
    redirect(`/friends?error=${encodeURIComponent("No account found with that email or username.")}`);
  }
  if (matches.length > 1) {
    redirect(
      `/friends?error=${encodeURIComponent(
        "More than one account matches that username — try their exact email instead."
      )}`
    );
  }

  const target = matches[0];
  if (target.id === user.id) {
    redirect(`/friends?error=${encodeURIComponent("That's your own account.")}`);
  }

  const { error } = await supabase
    .from("friendships")
    .insert({ user_id: user.id, friend_user_id: target.id, status: "pending" });

  if (error) {
    const message =
      error.code === "23505" ? "You've already sent a request (or are already friends)." : error.message;
    redirect(`/friends?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/friends");
}

export async function respondToFriendRequest(formData: FormData) {
  const friendshipId = String(formData.get("friendshipId"));
  const accept = String(formData.get("accept")) === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("friendships")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", friendshipId)
    .eq("friend_user_id", user.id);

  revalidatePath("/friends");
}
