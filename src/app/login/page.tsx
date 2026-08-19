import Link from "next/link";
import { signIn } from "../auth/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; justSignedUp?: string }>;
}) {
  const { error, justSignedUp } = await searchParams;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-xl font-semibold">Sign in</h1>

      {justSignedUp && (
        <p className="mb-4 rounded bg-black/5 p-3 text-sm dark:bg-white/10">
          Account created. If your Supabase project has email confirmation on, check your inbox
          before signing in.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form action={signIn} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
        <button
          type="submit"
          className="rounded bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700"
        >
          Sign in
        </button>
      </form>

      <p className="mt-4 text-sm text-black/60 dark:text-white/60">
        No account yet? <Link href="/signup" className="underline">Sign up</Link>
      </p>
    </div>
  );
}
