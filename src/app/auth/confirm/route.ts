import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Lands here from the link in a Supabase auth email (password reset,
// magic link, etc.) — `token_hash`/`type` come from Supabase itself,
// `next` is whatever redirectTo path the action that sent the email asked
// for (see requestPasswordReset in ../actions.ts, which sends people here
// then on to /reset-password). This is Supabase's own documented pattern
// for verifying these links in a cookie-based SSR app: verifyOtp both
// confirms the link and establishes the real session, so the page it
// redirects to (/reset-password) can just act as an already-signed-in
// user rather than needing to handle a token itself.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect(
    "/login?error=" +
      encodeURIComponent("That link is invalid or has expired — request a new one and try again.")
  );
}
