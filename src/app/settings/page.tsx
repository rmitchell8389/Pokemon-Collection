import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateShippingAddress } from "./actions";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: shippingAddress } = await supabase
    .from("shipping_addresses")
    .select("address")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <section className="panel flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Shipping address</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            Only shown to a friend once you have an active postal trade with them — see
            the Trades page. Leave this blank and save to remove it.
          </p>
        </div>
        <form action={updateShippingAddress} className="flex flex-col gap-3">
          <textarea
            name="address"
            rows={4}
            defaultValue={shippingAddress?.address ?? ""}
            placeholder="Name&#10;Address line 1&#10;Town, postcode"
            className="w-full rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-red-500 dark:border-white/15"
          />
          <button type="submit" className="btn-primary self-start">
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
