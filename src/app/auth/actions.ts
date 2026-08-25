"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
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

// Sends a "reset your password" email. Deliberately shows the SAME message
// on the /forgot-password page whether or not the address actually has an
// account — Supabase's own resetPasswordForEmail doesn't error for an
// unknown address either, which is the right, standard behavior (not
// letting this form be used to check who has an account here).
//
// Real caveat worth knowing: this email goes out through the exact same
// Supabase email sender as signup confirmations — see the README section
// "Fixing 'email rate limit exceeded' on signup". If that project is still
// on Supabase's default capped sender rather than custom SMTP, a burst of
// password reset requests can hit the same rate limit signups did.
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (email) {
    const supabase = await createClient();
    const origin = (await headers()).get("origin");
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent("/reset-password")}`,
    });
    // Intentionally not checking `error` here — surfacing it either
    // confirms/denies whether the address has an account (an enumeration
    // leak) or, for a real delivery failure, isn't something the person
    // submitting the form can do anything about anyway. The one exception
    // (Supabase's rate limit) is documented above rather than shown inline,
    // since it's an operator problem, not a user one.
  }

  redirect("/forgot-password?sent=1");
}
