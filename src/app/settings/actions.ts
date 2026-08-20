"use server";

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
