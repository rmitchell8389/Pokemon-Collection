import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TCGDEX_LANGUAGES, type TcgdexLanguage } from "@/lib/tcgdex";
import { proposeTrade } from "../actions";

const LANGUAGE_LABELS: Record<TcgdexLanguage, string> = {
  en: "English",
  ja: "Japanese",
  "zh-tw": "Traditional Chinese",
  "zh-cn": "Simplified Chinese",
};

export default async function FindMatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; lang?: string; error?: string }>;
}) {
  const { friend, lang, error } = await searchParams;
  const language: TcgdexLanguage = TCGDEX_LANGUAGES.includes(lang as TcgdexLanguage)
    ? (lang as TcgdexLanguage)
    : "en";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!friend) redirect("/trades");

  const { data: friendProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", friend)
    .maybeSingle();

  // Trade-match math: since every collection_entries row references a real
  // card, "cards they have that I need" is just their have-list minus mine —
  // no need to enumerate the full language catalog to compute this.
  const [{ data: myHave }, { data: theirHave }] = await Promise.all([
    supabase.from("collection_entries").select("card_id").eq("user_id", user.id).eq("language", language),
    supabase.from("collection_entries").select("card_id").eq("user_id", friend).eq("language", language),
  ]);

  const myHaveIds = new Set((myHave ?? []).map((r) => r.card_id));
  const theirHaveIds = new Set((theirHave ?? []).map((r) => r.card_id));

  const iNeedIds = [...theirHaveIds].filter((id) => !myHaveIds.has(id));
  const theyNeedIds = [...myHaveIds].filter((id) => !theirHaveIds.has(id));

  const allIds = [...new Set([...iNeedIds, ...theyNeedIds])];
  const { data: cardRows } =
    allIds.length > 0
      ? await supabase
          .from("cards")
          .select("id, name, set_name, card_number")
          .eq("language", language)
          .in("id", allIds)
      : { data: [] as { id: string; name: string; set_name: string; card_number: string }[] };
  const cardById = new Map((cardRows ?? []).map((c) => [c.id, c]));

  // A trade needs something from both sides — see actions.ts. Only render
  // the propose form when both lists have at least one card in them.
  const canProposeTrade = iNeedIds.length > 0 && theyNeedIds.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">
        Matches with {friendProfile?.display_name ?? "friend"} — {LANGUAGE_LABELS[language]}
      </h1>

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {iNeedIds.length === 0 && theyNeedIds.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">No matches here right now.</p>
      )}

      {!canProposeTrade && (iNeedIds.length > 0 || theyNeedIds.length > 0) && (
        <p className="rounded bg-black/5 p-3 text-sm dark:bg-white/10">
          {iNeedIds.length === 0
            ? "They don't have anything you need right now, so there's nothing to propose yet."
            : "You don't have anything they need right now, so there's nothing to propose yet — a trade needs something from both sides."}
        </p>
      )}

      {canProposeTrade ? (
        <form action={proposeTrade} className="flex flex-col gap-6">
          <input type="hidden" name="friendId" value={friend} />
          <input type="hidden" name="language" value={language} />

          <section>
            <h2 className="mb-2 font-medium">They have, you need — pick what you want</h2>
            <ul className="flex flex-col gap-2">
              {iNeedIds.map((id) => {
                const card = cardById.get(id);
                if (!card) return null;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-3 rounded border border-black/10 p-3 dark:border-white/10"
                  >
                    <input type="checkbox" name="wantCardIds" value={id} className="h-4 w-4" />
                    <span>
                      {card.name}{" "}
                      <span className="text-black/50 dark:text-white/50">
                        ({card.set_name} #{card.card_number})
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-medium">You have, they need — pick what you&apos;re offering</h2>
            <ul className="flex flex-col gap-2">
              {theyNeedIds.map((id) => {
                const card = cardById.get(id);
                if (!card) return null;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-3 rounded border border-black/10 p-3 dark:border-white/10"
                  >
                    <input type="checkbox" name="offerCardIds" value={id} className="h-4 w-4" />
                    <span>
                      {card.name}{" "}
                      <span className="text-black/50 dark:text-white/50">
                        ({card.set_name} #{card.card_number})
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <button type="submit" className="self-start rounded bg-red-600 px-4 py-2 font-medium text-white">
            Propose trade
          </button>
        </form>
      ) : (
        <>
          {iNeedIds.length > 0 && (
            <section>
              <h2 className="mb-2 font-medium">They have, you need</h2>
              <ul className="flex flex-col gap-2">
                {iNeedIds.map((id) => {
                  const card = cardById.get(id);
                  if (!card) return null;
                  return (
                    <li key={id} className="rounded border border-black/10 p-3 dark:border-white/10">
                      {card.name}{" "}
                      <span className="text-black/50 dark:text-white/50">
                        ({card.set_name} #{card.card_number})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {theyNeedIds.length > 0 && (
            <section>
              <h2 className="mb-2 font-medium">You have, they need</h2>
              <ul className="flex flex-col gap-2">
                {theyNeedIds.map((id) => {
                  const card = cardById.get(id);
                  if (!card) return null;
                  return (
                    <li key={id} className="rounded border border-black/10 p-3 dark:border-white/10">
                      {card.name}{" "}
                      <span className="text-black/50 dark:text-white/50">
                        ({card.set_name} #{card.card_number})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
