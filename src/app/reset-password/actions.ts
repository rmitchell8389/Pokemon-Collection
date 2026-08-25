"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 6) {
    redirect("/reset-password?error=" + encodeURIComponent("Password needs to be at least 6 characters."));
  }
  if (password !== confirmPassword) {
    redirect("/reset-password?error=" + encodeURIComponent("Those two passwords don't match."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // The recovery link's session (set by /auth/confirm) has expired or
    // was never established — send them to request a fresh one rather
    // than showing a form that can't actually work.
    redirect(
      "/forgot-password?error=" +
        encodeURIComponent("That reset link has expired — request a new one below.")
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/reset-password?error=" + encodeURIComponent(error.message));
  }

  redirect("/collection?passwordReset=1");
}
