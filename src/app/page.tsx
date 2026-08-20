import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PokeballMark } from "@/components/PokeballMark";
import { TCGDEX_LANGUAGES, type TcgdexLanguage } from "@/lib/tcgdex";

// Each tile gets its own color wash rather than one flat white panel repeated
// three times — not tied to real Pokemon-type data (we don't sync per-card
// type info), just a deliberate, distinct palette per section so the
// dashboard doesn't read as three identical boxes.
const DASHBOARD_TILES = [
  {
    href: "/collection",
    title: "Collection",
    description: "Search a Pokemon, see what you have and what you're missing.",
    icon: "🗂️",
    wash: "from-amber-400/15 to-amber-400/0 hover:border-amber-500/40",
    iconBg: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  {
    href: "/friends",
    title: "Friends",
    description: "Connect with friends to see trade matches.",
    icon: "🤝",
    wash: "from-violet-400/15 to-violet-400/0 hover:border-violet-500/40",
    iconBg: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  {
    href: "/trades",
    title: "Trades",
    description: "See matches and track trades in progress.",
    icon: "🔁",
    wash: "from-emerald-400/15 to-emerald-400/0 hover:border-emerald-500/40",
    iconBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
] as const;

const LANGUAGE_LABELS: Record<TcgdexLanguage, string> = {
  en: "English",
  ja: "Japanese",
  "zh-tw": "Traditional Chinese",
  "zh-cn": "Simplified Chinese",
};
const LANGUAGE_FLAGS: Record<TcgdexLanguage, string> = {
  en: "🇺🇸",
  ja: "🇯🇵",
  "zh-tw": "🇹🇼",
  "zh-cn": "🇨🇳",
};
const LANGUAGE_BAR_COLORS: Record<TcgdexLanguage, string> = {
  en: "bg-red-500",
  ja: "bg-amber-500",
  "zh-tw": "bg-violet-500",
  "zh-cn": "bg-emerald-500",
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="relative flex flex-col items-start gap-6 overflow-hidden py-8">
        <PokeballMark className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 -rotate-12 opacity-[0.06]" />
        <PokeballMark className="h-12 w-12" />
        <div className="flex flex-col gap-3">
          <h1 className="bg-gradient-to-r from-red-600 to-orange-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            DexMate
          </h1>
          <p className="max-w-md text-black/70 dark:text-white/70">
            Track what you own across English, Japanese, Traditional Chinese and Simplified
            Chinese, see what you&apos;re missing, and find trades with friends.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/signup" className="btn-primary">
            Get started
          </Link>
          <Link href="/login" className="btn-secondary">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // Everything below is real data, not filler — the dashboard felt bare with
  // just three nav tiles on a wide screen, and "how much have I actually
  // collected" is a genuinely useful thing to see at a glance rather than
  // only inside a specific language/set search.
  const [{ data: profile }, { count: totalOwned }, { data: incomingRequests }, { data: activeTradeRows }] =
    await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      supabase.from("collection_entries").select("*", { count: "exact", head: true }).eq("user_id", user.id),
      supabase
        .from("friendships")
        .select("id")
        .eq("friend_user_id", user.id)
        .eq("status", "pending"),
      supabase
        .from("trades")
        .select("status")
        .or(`proposer_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .in("status", ["proposed", "in_progress"]),
    ]);

  const pendingRequestCount = incomingRequests?.length ?? 0;
  const activeTradeCount = activeTradeRows?.length ?? 0;

  const progressByLanguage = await Promise.all(
    TCGDEX_LANGUAGES.map(async (l) => {
      const [{ count: total }, { count: owned }] = await Promise.all([
        supabase.from("cards").select("*", { count: "exact", head: true }).eq("language", l),
        supabase
          .from("collection_entries")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("language", l),
      ]);
      return { language: l, total: total ?? 0, owned: owned ?? 0 };
    })
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="relative overflow-hidden">
        <PokeballMark className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rotate-12 opacity-[0.06]" />
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {totalOwned ?? 0} card{(totalOwned ?? 0) === 1 ? "" : "s"} tracked across every language.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.3fr_1fr]">
        <div className="panel">
          <h2 className="mb-3 font-semibold">Your progress</h2>
          <div className="flex flex-col gap-3">
            {progressByLanguage.map(({ language, total, owned }) => {
              const pct = total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0;
              return (
                <div key={language} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      {LANGUAGE_FLAGS[language]} {LANGUAGE_LABELS[language]}
                    </span>
                    <span className="text-black/50 dark:text-white/50">
                      {owned}/{total} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <div
                      className={`h-full rounded-full ${LANGUAGE_BAR_COLORS[language]} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Link
            href="/friends"
            className={`panel flex items-center justify-between transition-all hover:-translate-y-0.5 hover:shadow-md ${
              pendingRequestCount > 0 ? "border-amber-400/50 bg-amber-400/5" : ""
            }`}
          >
            <div>
              <div className="text-sm text-black/60 dark:text-white/60">Friend requests</div>
              <div className="text-2xl font-bold">{pendingRequestCount}</div>
            </div>
            <span className="text-2xl">📬</span>
          </Link>
          <Link
            href="/trades"
            className={`panel flex items-center justify-between transition-all hover:-translate-y-0.5 hover:shadow-md ${
              activeTradeCount > 0 ? "border-blue-400/50 bg-blue-400/5" : ""
            }`}
          >
            <div>
              <div className="text-sm text-black/60 dark:text-white/60">Active trades</div>
              <div className="text-2xl font-bold">{activeTradeCount}</div>
            </div>
            <span className="text-2xl">🔁</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {DASHBOARD_TILES.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className={`panel flex flex-col gap-3 bg-gradient-to-br transition-all hover:-translate-y-0.5 hover:shadow-md ${tile.wash}`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-full text-xl ${tile.iconBg}`}>
              {tile.icon}
            </span>
            <div>
              <div className="font-semibold">{tile.title}</div>
              <div className="text-sm text-black/60 dark:text-white/60">{tile.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
