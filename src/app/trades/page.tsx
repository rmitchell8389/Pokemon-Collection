import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TCGDEX_LANGUAGES, type TcgdexLanguage } from "@/lib/tcgdex";
import { advanceTrade, cancelTrade } from "./actions";

const LANGUAGE_LABELS: Record<TcgdexLanguage, string> = {
  en: "English",
  ja: "Japanese",
  "zh-tw": "Traditional Chinese",
  "zh-cn": "Simplified Chinese",
};

const STATUS_STYLES: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  cancelled: "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50",
};

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_BORDERS: Record<string, string> = {
  proposed: "border-l-4 border-l-amber-400",
  in_progress: "border-l-4 border-l-blue-400",
  completed: "border-l-4 border-l-emerald-400",
  cancelled: "border-l-4 border-l-black/10 dark:border-l-white/10",
};

export default async function TradesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: friendships } = await supabase
    .from("friendships")
    .select("user_id, friend_user_id")
    .eq("status", "accepted")
    .or(`user_id.eq.${user.id},friend_user_id.eq.${user.id}`);

  const friendIds = (friendships ?? []).map((f) =>
    f.user_id === user.id ? f.friend_user_id : f.user_id
  );
  const { data: friendProfiles } =
    friendIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", friendIds)
      : { data: [] as { id: string; display_name: string }[] };

  const { data: trades } = await supabase
    .from("trades")
    .select("id, proposer_id, recipient_id, status, created_at")
    .or(`proposer_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  const tradeIds = (trades ?? []).map((t) => t.id);
  const { data: tradeItems } =
    tradeIds.length > 0
      ? await supabase
          .from("trade_items")
          .select("trade_id, card_id, language, offered_by_user_id")
          .in("trade_id", tradeIds)
      : { data: [] as { trade_id: string; card_id: string; language: string; offered_by_user_id: string }[] };

  // Manual join against `cards` keyed on (id, language) rather than relying
  // on PostgREST to resolve the composite foreign key automatically —
  // simpler to reason about and avoids a dependency on embed behavior that
  // wasn't verified against a live project. See README for what to test.
  const cardKeysNeeded = Array.from(new Set((tradeItems ?? []).map((i) => i.card_id)));
  const { data: cardRowsForTrades } =
    cardKeysNeeded.length > 0
      ? await supabase.from("cards").select("id, language, name, set_name, card_number").in("id", cardKeysNeeded)
      : { data: [] as { id: string; language: string; name: string; set_name: string; card_number: string }[] };
  const cardByKey = new Map(
    (cardRowsForTrades ?? []).map((c) => [`${c.id}::${c.language}`, c])
  );
  const itemsByTrade = new Map<string, typeof tradeItems>();
  for (const item of tradeItems ?? []) {
    const list = itemsByTrade.get(item.trade_id) ?? [];
    list.push(item);
    itemsByTrade.set(item.trade_id, list);
  }

  const participantIds = Array.from(
    new Set((trades ?? []).flatMap((t) => [t.proposer_id, t.recipient_id]))
  );
  const { data: participantProfiles } =
    participantIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", participantIds)
      : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((participantProfiles ?? []).map((p) => [p.id, p.display_name]));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">Trades</h1>

      <section>
        <h2 className="mb-2 font-semibold">Find matches with a friend</h2>
        {friendProfiles && friendProfiles.length > 0 ? (
          <div className="flex flex-col gap-2">
            {friendProfiles.map((f) => (
              <div key={f.id} className="panel flex flex-wrap items-center gap-2">
                <span className="mr-2 font-medium">{f.display_name}</span>
                {TCGDEX_LANGUAGES.map((l) => (
                  <Link key={l} href={`/trades/find?friend=${f.id}&lang=${l}`} className="pill-inactive text-xs">
                    {LANGUAGE_LABELS[l]}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-black/60 dark:text-white/60">
            Add friends first — see the Friends page.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          Your trades
          {trades && trades.length > 0 && <span className="badge bg-black/5 dark:bg-white/10">{trades.length}</span>}
        </h2>
        {!trades || trades.length === 0 ? (
          <p className="panel text-sm text-black/60 dark:text-white/60">
            No trades yet. Find a match above and propose one.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {trades.map((t) => {
              const otherId = t.proposer_id === user.id ? t.recipient_id : t.proposer_id;
              return (
                <li key={t.id} className={`panel ${STATUS_BORDERS[t.status] ?? ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      With {nameById.get(otherId) ?? "Unknown"}
                    </span>
                    <span className={`badge ${STATUS_STYLES[t.status] ?? "bg-black/5 dark:bg-white/10"}`}>
                      {STATUS_LABELS[t.status] ?? t.status}
                    </span>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-black/70 dark:text-white/70">
                    {(itemsByTrade.get(t.id) ?? []).map((item, i) => {
                      const card = cardByKey.get(`${item.card_id}::${item.language}`);
                      return (
                        <li key={i}>
                          {card?.name ?? item.card_id} {card && `(${card.set_name} #${card.card_number})`} —
                          offered by {item.offered_by_user_id === user.id ? "you" : "them"}
                        </li>
                      );
                    })}
                  </ul>
                  {t.status === "proposed" && (
                    <div className="mt-3 flex items-center gap-2">
                      {t.recipient_id === user.id ? (
                        <form action={advanceTrade}>
                          <input type="hidden" name="tradeId" value={t.id} />
                          <input type="hidden" name="currentStatus" value={t.status} />
                          <button className="btn-success btn-sm">Accept</button>
                        </form>
                      ) : (
                        // Only the recipient can accept — see actions.ts. The
                        // proposer just waits, so no button here for them.
                        <span className="text-xs text-black/50 dark:text-white/50">
                          Waiting for {nameById.get(t.recipient_id) ?? "them"} to accept
                        </span>
                      )}
                      <form action={cancelTrade}>
                        <input type="hidden" name="tradeId" value={t.id} />
                        <button className="btn-secondary btn-sm">Cancel</button>
                      </form>
                    </div>
                  )}

                  {t.status === "in_progress" && (
                    <div className="mt-3 flex gap-2">
                      <form action={advanceTrade}>
                        <input type="hidden" name="tradeId" value={t.id} />
                        <input type="hidden" name="currentStatus" value={t.status} />
                        <button className="btn-success btn-sm">Mark as completed</button>
                      </form>
                      <form action={cancelTrade}>
                        <input type="hidden" name="tradeId" value={t.id} />
                        <button className="btn-secondary btn-sm">Cancel</button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
