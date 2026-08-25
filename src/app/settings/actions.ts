"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Upsert-or-delete-on-empty: a blank submission clears the address rather
// than storing an empty string, so "no address saved" always means "no row"
// (matches how the trades page checks for a missing address — see
// trades/page.tsx).
export async function updateShippingAddress(formData: FormData) {
  const address = String(formData.get("address") ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (address.length === 0) {
    await supabase.from("shipping_addresses").delete().eq("user_id", user.id);
  } else {
    await supabase
      .from("shipping_addresses")
      .upsert({ user_id: user.id, address, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  }

  revalidatePath("/settings");
  revalidatePath("/trades");
}

// Changing password while already signed in — separate from the
// /forgot-password -> email link flow (src/app/auth/actions.ts,
// src/app/reset-password), which exists for someone who's locked out.
// Supabase's updateUser just needs an active session, no re-entry of the
// current password — acceptable here since reaching Settings already means
// a real signed-in session.
export async function changePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 6) {
    redirect("/settings?pwError=" + encodeURIComponent("Password needs to be at least 6 characters."));
  }
  if (password !== confirmPassword) {
    redirect("/settings?pwError=" + encodeURIComponent("Those two passwords don't match."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/settings?pwError=" + encodeURIComponent(error.message));
  }

  redirect("/settings?pwSuccess=1");
}
