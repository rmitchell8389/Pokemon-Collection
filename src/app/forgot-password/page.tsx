import Link from "next/link";
import { requestPasswordReset } from "../auth/actions";
import { PokeballMark } from "@/components/PokeballMark";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-8">
      <PokeballMark className="h-10 w-10" />
      <div className="panel w-full">
        <h1 className="mb-2 text-xl font-bold tracking-tight">Reset your password</h1>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Enter the email you signed up with and we&apos;ll send a link to set a new password.
        </p>

        {sent ? (
          <p className="rounded-lg bg-black/5 p-3 text-sm dark:bg-white/10">
            If that email has an account, a reset link is on its way — check your inbox (and spam
            folder). The link expires after a while, so use it soon.
          </p>
        ) : (
          <form action={requestPasswordReset} className="flex flex-col gap-3">
            <input name="email" type="email" placeholder="Email" required className="input" />
            <button type="submit" className="btn-primary mt-1">
              Send reset link
            </button>
          </form>
        )}

        <p className="mt-4 text-sm text-black/60 dark:text-white/60">
          <Link href="/login" className="font-medium text-red-600 hover:underline dark:text-red-400">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
