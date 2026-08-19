import Link from "next/link";
import { signUp } from "../auth/actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-xl font-semibold">Create an account</h1>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form action={signUp} className="flex flex-col gap-3">
        <input
          name="displayName"
          type="text"
          placeholder="Display name"
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
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
          placeholder="Password (min 6 characters)"
          required
          minLength={6}
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
        <button
          type="submit"
          className="rounded bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700"
        >
          Sign up
        </button>
      </form>

      <p className="mt-4 text-sm text-black/60 dark:text-white/60">
        Already have an account? <Link href="/login" className="underline">Sign in</Link>
      </p>
    </div>
  );
}
