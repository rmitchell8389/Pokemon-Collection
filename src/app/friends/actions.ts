"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function sendFriendRequest(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: target } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (!target) {
    redirect(`/friends?error=${encodeURIComponent("No account found with that email.")}`);
  }
  if (target!.id === user.id) {
    redirect(`/friends?error=${encodeURIComponent("That's your own account.")}`);
  }

  const { error } = await supabase
    .from("friendships")
    .insert({ user_id: user.id, friend_user_id: target!.id, status: "pending" });

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
