import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "./actions";
import { PokeballMark } from "@/components/PokeballMark";
import { PasswordField } from "@/components/PasswordField";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Getting here without a valid recovery session (link expired, already
  // used, or just visited directly) means updatePassword would have
  // nothing to act on — say so plainly instead of showing a form that's
  // guaranteed to fail.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-8">
      <PokeballMark className="h-10 w-10" />
      <div className="panel w-full">
        <h1 className="mb-6 text-xl font-bold tracking-tight">Set a new password</h1>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {user ? (
          <form action={updatePassword} className="flex flex-col gap-3">
            <PasswordField name="password" placeholder="New password" required minLength={6} />
            <PasswordField name="confirmPassword" placeholder="Confirm new password" required minLength={6} />
            <button type="submit" className="btn-primary mt-1">
              Update password
            </button>
          </form>
        ) : (
          <p className="text-sm text-black/60 dark:text-white/60">
            This link is invalid or has expired.{" "}
            <Link href="/forgot-password" className="font-medium text-red-600 hover:underline dark:text-red-400">
              Request a new one
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
