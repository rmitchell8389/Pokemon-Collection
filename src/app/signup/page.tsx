import Link from "next/link";
import { signUp } from "../auth/actions";
import { PokeballMark } from "@/components/PokeballMark";
import { PasswordField } from "@/components/PasswordField";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-8">
      <PokeballMark className="h-10 w-10" />
      <div className="panel w-full">
        <h1 className="mb-6 text-xl font-bold tracking-tight">Create an account</h1>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <form action={signUp} className="flex flex-col gap-3">
          <input name="displayName" type="text" placeholder="Display name" className="input" />
          <input name="email" type="email" placeholder="Email" required className="input" />
          <PasswordField name="password" placeholder="Password (min 6 characters)" required minLength={6} />
          <button type="submit" className="btn-primary mt-1">
            Sign up
          </button>
        </form>

        <p className="mt-4 text-sm text-black/60 dark:text-white/60">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-red-600 hover:underline dark:text-red-400">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
