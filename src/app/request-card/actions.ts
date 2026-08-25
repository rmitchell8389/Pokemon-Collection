"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyNewCardRequest } from "@/lib/notify";
import { isValidLanguage } from "@/lib/simpleImport";

export async function submitCardRequest(formData: FormData) {
  const setName = String(formData.get("setName") ?? "").trim();
  const cardNumber = String(formData.get("cardNumber") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const variant = String(formData.get("variant") ?? "").trim();
  const languageRaw = String(formData.get("language") ?? "en").trim();
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!setName || !name) return;

  // Falls back to English on anything unrecognized rather than rejecting
  // the submission outright — the language select only ever sends one of
  // the four known values anyway, this just guards against a tampered
  // request.
  const language = isValidLanguage(languageRaw) ? languageRaw : "en";

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

  const { error } = await supabase.from("card_requests").insert({
    user_id: user.id,
    set_name: setName,
    card_number: cardNumber || null,
    name,
    variant: variant || null,
    language,
    image_url: imageUrl || null,
    notes: notes || null,
  });

  if (!error) {
    // Best-effort, same as submitFeatureRequest — a missing/failed email
    // notification should never stop the request itself from being saved.
    await notifyNewCardRequest({
      setName,
      cardNumber,
      name,
      variant,
      language,
      imageUrl,
      notes,
      submittedBy: profile?.display_name ?? user.email ?? "someone",
    }).catch((err) => console.error("Card request email notification failed:", err));
  }

  revalidatePath("/request-card");
}
