import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">Pokemon Collection Tracker</h1>
        <p className="text-black/70 dark:text-white/70">
          Track what you own across English, Japanese, Traditional Chinese and Simplified
          Chinese, see what you&apos;re missing, and find trades with friends.
        </p>
        <div className="flex gap-3">
          <Link href="/signup" className="rounded bg-red-600 px-4 py-2 font-medium text-white">
            Get started
          </Link>
          <Link href="/login" className="rounded border border-black/15 px-4 py-2 dark:border-white/20">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/collection"
          className="rounded border border-black/10 p-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <div className="font-medium">Collection</div>
          <div className="text-sm text-black/60 dark:text-white/60">
            Search a Pokemon, see what you have and what you&apos;re missing.
          </div>
        </Link>
        <Link
          href="/friends"
          className="rounded border border-black/10 p-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <div className="font-medium">Friends</div>
          <div className="text-sm text-black/60 dark:text-white/60">
            Connect with friends to see trade matches.
          </div>
        </Link>
        <Link
          href="/trades"
          className="rounded border border-black/10 p-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <div className="font-medium">Trades</div>
          <div className="text-sm text-black/60 dark:text-white/60">
            See matches and track trades in progress.
          </div>
        </Link>
      </div>
    </div>
  );
}
