import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateShippingAddress, changePassword } from "./actions";
import { PasswordField } from "@/components/PasswordField";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ pwError?: string; pwSuccess?: string }>;
}) {
  const { pwError, pwSuccess } = await searchParams;

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
          <h2 className="font-semibold">Change password</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            Locked out instead? Sign out and use &ldquo;Forgot your password?&rdquo; on the sign-in
            page — this form only works while you&apos;re already signed in.
          </p>
        </div>
        {pwSuccess && (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Password updated.
          </p>
        )}
        {pwError && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {pwError}
          </p>
        )}
        <form action={changePassword} className="flex flex-col gap-3">
          <PasswordField name="password" placeholder="New password" required minLength={6} />
          <PasswordField name="confirmPassword" placeholder="Confirm new password" required minLength={6} />
          <button type="submit" className="btn-primary self-start">
            Update password
          </button>
        </form>
      </section>

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
