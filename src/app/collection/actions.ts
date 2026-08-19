"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleOwned(formData: FormData) {
  const cardId = String(formData.get("cardId"));
  const language = String(formData.get("language"));
  const owned = String(formData.get("owned")) === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (owned) {
    // Currently owned -> remove the entry ("don't have" it anymore).
    await supabase
      .from("collection_entries")
      .delete()
      .eq("user_id", user.id)
      .eq("card_id", cardId)
      .eq("language", language);
  } else {
    // Currently not owned -> add it ("have" it now).
    await supabase.from("collection_entries").upsert(
      { user_id: user.id, card_id: cardId, language },
      { onConflict: "user_id,card_id,language" }
    );
  }

  revalidatePath("/collection");
}
