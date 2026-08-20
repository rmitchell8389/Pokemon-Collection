import Link from "next/link";
import { signIn } from "../auth/actions";
import { PokeballMark } from "@/components/PokeballMark";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; justSignedUp?: string }>;
}) {
  const { error, justSignedUp } = await searchParams;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-8">
      <PokeballMark className="h-10 w-10" />
      <div className="panel w-full">
        <h1 className="mb-6 text-xl font-bold tracking-tight">Sign in</h1>

        {justSignedUp && (
          <p className="mb-4 rounded-lg bg-black/5 p-3 text-sm dark:bg-white/10">
            Account created. If your Supabase project has email confirmation on, check your inbox
            before signing in.
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <form action={signIn} className="flex flex-col gap-3">
          <input name="email" type="email" placeholder="Email" required className="input" />
          <input name="password" type="password" placeholder="Password" required className="input" />
          <button type="submit" className="btn-primary mt-1">
            Sign in
          </button>
        </form>

        <p className="mt-4 text-sm text-black/60 dark:text-white/60">
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-red-600 hover:underline dark:text-red-400">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
