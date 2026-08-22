// Sends Ross a one-line email via Resend's HTTP API whenever a new feature
// request comes in (see src/app/feedback/actions.ts).
//
// This is deliberately NOT the same thing as the Supabase custom SMTP setup
// described in the README for fixing the signup email rate limit — that
// controls Supabase Auth's own emails (confirmations, password resets).
// This calls Resend's REST API directly from app code instead, which only
// needs an API key, no SMTP config and no verified sending domain, AS LONG
// AS the recipient is the same email address the Resend account itself was
// signed up with. That's exactly the case here — Ross notifying himself —
// so no domain verification step is needed to get this working. (If a
// custom domain is ever verified in Resend for the SMTP fix, the "from"
// address below could be upgraded to something like
// "DexMate <notifications@yourdomain.com>" instead, but that's optional.)
//
// Requires RESEND_API_KEY in .env.local, and in Vercel's project env vars
// for production. Missing key -> logs a warning and does nothing, so
// submitting a feature request still works fine before this is configured.

const RESEND_API_URL = "https://api.resend.com/emails";

// Where the notification goes. Change this if requests should ever be
// routed elsewhere.
const ADMIN_EMAIL = "rmitchell8389@gmail.com";

export async function notifyNewFeatureRequest(details: {
  title: string;
  description: string;
  submittedBy: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY not set — skipping feature request email notification. See README for setup."
    );
    return;
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "DexMate <onboarding@resend.dev>",
      to: [ADMIN_EMAIL],
      subject: `New DexMate feature request: ${details.title}`,
      text: `${details.submittedBy} just requested a feature on DexMate:\n\n${details.title}\n\n${
        details.description || "(no extra description given)"
      }\n\nReview and update its status any time in the Supabase table editor (feature_requests table).`,
    }),
  });

  if (!res.ok) {
    // Best-effort — the caller (submitFeatureRequest) already saved the
    // request before calling this, and deliberately swallows this error
    // rather than letting a bad/missing email config block someone's
    // feature request from being recorded.
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API request failed: ${res.status} ${res.statusText} ${body}`);
  }
}
