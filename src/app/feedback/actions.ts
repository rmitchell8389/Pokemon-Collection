"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyNewFeatureRequest } from "@/lib/notify";

export async function submitFeatureRequest(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!title) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase.from("feature_requests").insert({
    user_id: user.id,
    title,
    description: description || null,
  });

  if (!error) {
    // Best-effort — a missing/failed email notification should never stop
    // the request itself from being saved. See src/lib/notify.ts: this is
    // a no-op (just a console warning) until RESEND_API_KEY is set.
    await notifyNewFeatureRequest({
      title,
      description,
      submittedBy: profile?.display_name ?? user.email ?? "someone",
    }).catch((err) => console.error("Feature request email notification failed:", err));
  }

  revalidatePath("/feedback");
  revalidatePath("/coming-soon");
}
