"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Supabase's built-in email service (the one every project starts on before
// custom SMTP is configured) is capped to a handful of emails per hour —
// fine for one person testing, not fine for several friends signing up in
// the same evening. Once that cap is hit, auth.signUp returns the raw
// message "Email rate limit exceeded", which means nothing to someone
// hitting the signup form. Swap it for an explanation instead of passing
// the raw Supabase text straight into the UI.
//
// The real fix lives in the Supabase dashboard, not in this file — see the
// README section this links to ("Fixing 'email rate limit exceeded'") for
// the two options (custom SMTP, or turning off email confirmation for a
// small friends-only app like this one).
function friendlyAuthError(message: string): string {
  if (/rate limit/i.test(message)) {
    return "Too many signup emails have gone out in the last hour (Supabase's default email sender is heavily capped). Wait a bit and try again, or ask whoever runs this app to switch on custom email sending — see the README.";
  }
  return message;
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || email.split("@")[0] } },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(friendlyAuthError(error.message))}`);
  }

  // Supabase's default project settings require email confirmation before
  // the session is usable — send them to login with a note either way.
  redirect("/login?justSignedUp=1");
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/collection");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
