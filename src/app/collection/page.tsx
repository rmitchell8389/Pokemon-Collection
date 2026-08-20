import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TCGDEX_LANGUAGES, type TcgdexLanguage } from "@/lib/tcgdex";
import { toggleOwned } from "./actions";
import { PokeballMark } from "@/components/PokeballMark";
import { CardImageLightbox } from "@/components/CardImageLightbox";

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

// `cards.image_url` holds two different shapes depending on where it came
// from. TCGdex-sourced values are a base path with no file extension (e.g.
// "https://assets.tcgdex.net/en/sv/sv03/001") and need "/high.png" appended
// at render time — that's the original convention. Cards backfilled by
// scripts/backfill-images.ts from pokemontcg.io (for the ~6% of English
// cards TCGdex has no image for at all — trainer kits, McDonald's promos,
// Trainer Gallery subsets) already store a complete file URL (e.g.
// "https://images.pokemontcg.io/tk1a/1_hires.png"). Detect which shape it
// is by checking for a file extension rather than adding a second column.
function resolveImageSrc(imageUrl: string): string {
  return /\.(png|jpe?g|webp)$/i.test(imageUrl) ? imageUrl : `${imageUrl}/high.png`;
}

// Card numbers are strings but frequently numeric ("1", "10", "2") or
// numeric-with-suffix ("H13", "74a"). A plain localeCompare sorts "10"
// before "2"; passing `numeric: true` makes the comparator treat embedded
// digit runs as numbers, so sets display in real print order.
function compareCardNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; q?: string; set?: string; friend?: string }>;
}) {
  const { lang, q, set, friend } = await searchParams;
  const language: TcgdexLanguage = TCGDEX_LANGUAGES.includes(lang as TcgdexLanguage)
    ? (lang as TcgdexLanguage)
    : "en";
  const query = (q ?? "").trim();
  const setQuery = (set ?? "").trim();
  const friendParam = (friend ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Viewing a friend's collection (?friend=<id>) reuses this whole page —
  // same search, same grid — swapping only whose ownership the "owned"
  // badges reflect. Only accepted friends are viewable; collection_entries
  // RLS ("friends can view each other's collection" in schema.sql) already
  // enforces this at the database level too, so this check is about giving
  // a clear message rather than being the only thing standing in the way.
  let viewingFriend: { id: string; display_name: string } | null = null;
  if (friendParam && friendParam !== user.id) {
    const { data: myAcceptedFriendships } = await supabase
      .from("friendships")
      .select("user_id, friend_user_id")
      .eq("status", "accepted");
    const isFriend = (myAcceptedFriendships ?? []).some(
      (f) =>
        (f.user_id === user.id && f.friend_user_id === friendParam) ||
        (f.friend_user_id === user.id && f.user_id === friendParam)
    );
    if (isFriend) {
      const { data: friendProfile } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", friendParam)
        .maybeSingle();
      if (friendProfile) viewingFriend = friendProfile;
    }
  }
  const targetUserId = viewingFriend?.id ?? user.id;

  // Populate the set-search datalist with every set name that actually has
  // cards in the currently-selected language, so the field is a real
  // autocomplete rather than requiring Ross to remember exact spelling.
  const { data: setNameRows } = await supabase
    .from("cards")
    .select("set_name")
    .eq("language", language)
    .order("set_name");
  const setNames = Array.from(new Set((setNameRows ?? []).map((r) => r.set_name)));

  type CardRow = { id: string; name: string; set_name: string; card_number: string; image_url: string | null };
  let cards: CardRow[] = [];
  let notReleasedInThisLanguage = false;
  // When viewing a friend with no search typed yet, default to showing
  // everything they own instead of an empty "search to begin" prompt — the
  // whole point of opening someone's collection is browsing it, not
  // guessing what to search for first.
  let showingFriendsFullCollection = false;

  if (setQuery && !query) {
    // Set-only browsing: no Pokemon name to resolve across languages, so
    // this can go straight at the `cards` table for the selected language.
    const { data } = await supabase
      .from("cards")
      .select("id, name, set_name, card_number, image_url")
      .eq("language", language)
      .ilike("set_name", `%${setQuery}%`);
    cards = (data ?? []).sort((a, b) =>
      a.set_name === b.set_name
        ? compareCardNumbers(a.card_number, b.card_number)
        : a.set_name.localeCompare(b.set_name)
    );
  } else if (query) {
    // Card names are stored in each card's own language — a Japanese
    // Charizard's `name` is literally "リザードン", not "Charizard", so a
    // plain text search against non-English cards needs another way in.
    //
    // The obvious approach — resolve the query to a National Pokedex number
    // via the English catalog, then match the target language by that
    // number — turns out to be unreliable on its own: TCGdex doesn't
    // consistently tag every card with a dex number. Confirmed on a real
    // synced database that only ~27% of Traditional Chinese cards had one,
    // even though ~7,400 zh-tw cards were correctly synced — meaning most
    // Chinese cards were invisible to search despite being right there.
    //
    // So the dex-number path stays (it's free — cheap and still catches
    // whatever TCGdex did tag), but the primary path is now a name lookup:
    // `pokemon_species_names` (synced separately from PokeAPI, see
    // scripts/sync-species-names.ts) gives the official name of every
    // Pokemon in every target language regardless of what TCGdex tagged.
    // Resolve the query against that table, then search the target
    // language's cards by literal text, by dex number, AND by the
    // Pokemon's official localized name — whichever one actually hits.
    const cardsById = new Map<string, CardRow>();

    const { data: literalMatches } = await supabase
      .from("cards")
      .select("id, name, set_name, card_number, image_url")
      .eq("language", language)
      .ilike("name", `%${query}%`);
    for (const c of literalMatches ?? []) cardsById.set(c.id, c);

    let speciesMatchCount = 0;
    if (language !== "en") {
      const { data: speciesMatches } = await supabase
        .from("pokemon_species_names")
        .select("national_dex_no, name_en, name_ja, name_zh_tw, name_zh_cn")
        .or(
          `name_en.ilike.%${query}%,name_ja.ilike.%${query}%,name_zh_tw.ilike.%${query}%,name_zh_cn.ilike.%${query}%`
        );
      speciesMatchCount = speciesMatches?.length ?? 0;

      const dexNos = (speciesMatches ?? []).map((s) => s.national_dex_no);
      if (dexNos.length > 0) {
        const { data } = await supabase
          .from("cards")
          .select("id, name, set_name, card_number, image_url")
          .eq("language", language)
          .in("national_dex_no", dexNos);
        for (const c of data ?? []) cardsById.set(c.id, c);
      }

      const localizedNameField =
        language === "ja" ? "name_ja" : language === "zh-tw" ? "name_zh_tw" : "name_zh_cn";
      const localizedNames = Array.from(
        new Set(
          (speciesMatches ?? [])
            .map((s) => s[localizedNameField])
            .filter((n): n is string => Boolean(n))
        )
      );
      for (const localizedName of localizedNames) {
        const { data } = await supabase
          .from("cards")
          .select("id, name, set_name, card_number, image_url")
          .eq("language", language)
          .ilike("name", `%${localizedName}%`);
        for (const c of data ?? []) cardsById.set(c.id, c);
      }
    }

    let matched = Array.from(cardsById.values());
    if (setQuery) {
      // Both a Pokemon name and a set filter were given — narrow to the
      // intersection rather than treating them as two separate searches.
      const setQueryLower = setQuery.toLowerCase();
      matched = matched.filter((c) => c.set_name.toLowerCase().includes(setQueryLower));
    }
    cards = matched.sort((a, b) =>
      a.set_name === b.set_name
        ? compareCardNumbers(a.card_number, b.card_number)
        : a.set_name.localeCompare(b.set_name)
    );

    if (cards.length === 0 && language !== "en" && !setQuery) {
      // Distinguish "not released in this language" from "no such Pokemon" —
      // per the spec, this must be an honest, explicit state, not a blank
      // list. Now backed by the species table search above rather than just
      // an English-catalog check, so it's less likely to be a false
      // "not released" claim caused by missing metadata rather than an
      // actual absence.
      const { data: enData } = await supabase
        .from("cards")
        .select("id")
        .eq("language", "en")
        .ilike("name", `%${query}%`)
        .limit(1);
      notReleasedInThisLanguage = speciesMatchCount > 0 || (enData?.length ?? 0) > 0;
    }
  } else if (viewingFriend) {
    // No search typed — show everything the friend owns in this language.
    const { data: entries } = await supabase
      .from("collection_entries")
      .select("card_id")
      .eq("user_id", viewingFriend.id)
      .eq("language", language);
    const ownedCardIds = (entries ?? []).map((e) => e.card_id);
    if (ownedCardIds.length > 0) {
      const { data } = await supabase
        .from("cards")
        .select("id, name, set_name, card_number, image_url")
        .eq("language", language)
        .in("id", ownedCardIds);
      cards = (data ?? []).sort((a, b) =>
        a.set_name === b.set_name
          ? compareCardNumbers(a.card_number, b.card_number)
          : a.set_name.localeCompare(b.set_name)
      );
    }
    showingFriendsFullCollection = true;
  }

  const cardIds = cards.map((c) => c.id);
  const { data: ownedRows } =
    cardIds.length > 0
      ? await supabase
          .from("collection_entries")
          .select("card_id")
          .eq("user_id", targetUserId)
          .eq("language", language)
          .in("card_id", cardIds)
      : { data: [] as { card_id: string }[] };
  const ownedSet = new Set((ownedRows ?? []).map((r) => r.card_id));

  // Every internal link on this page needs to carry `friend` along so
  // switching language or searching doesn't silently kick you back to your
  // own collection.
  function hrefWithFriend(extra: Record<string, string>): string {
    const params = new URLSearchParams(extra);
    if (viewingFriend) params.set("friend", viewingFriend.id);
    return `/collection?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {viewingFriend ? (
          <>
            {viewingFriend.display_name}
            <span className="font-normal text-black/50 dark:text-white/50">&rsquo;s collection</span>
          </>
        ) : (
          "Collection"
        )}
      </h1>

      {friendParam && !viewingFriend && (
        <p className="panel text-sm">
          You can only view the collection of an accepted friend. If this is a new friendship,
          make sure the request has been accepted on both sides.
        </p>
      )}

      {viewingFriend && (
        <div className="panel flex items-center justify-between border-l-4 border-l-violet-400 text-sm">
          <span>
            Viewing <strong>{viewingFriend.display_name}</strong>&rsquo;s collection — read only.
          </span>
          <Link href="/collection" className="btn-secondary btn-sm">
            Back to my collection
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TCGDEX_LANGUAGES.map((l) => {
          const extra: Record<string, string> = { lang: l };
          if (query) extra.q = query;
          if (setQuery) extra.set = setQuery;
          return (
            <a key={l} href={hrefWithFriend(extra)} className={l === language ? "pill-active" : "pill-inactive"}>
              <span className="mr-1">{LANGUAGE_FLAGS[l]}</span>
              {LANGUAGE_LABELS[l]}
            </a>
          );
        })}
      </div>

      <form action="/collection" className="panel flex flex-wrap gap-2">
        <input type="hidden" name="lang" value={language} />
        {viewingFriend && <input type="hidden" name="friend" value={viewingFriend.id} />}
        <input
          name="q"
          defaultValue={query}
          placeholder="Search a Pokemon, e.g. Charizard"
          className="input min-w-[200px] flex-1"
        />
        <input
          name="set"
          list="set-names"
          defaultValue={setQuery}
          placeholder="Filter by set, e.g. Skyridge"
          className="input min-w-[200px] flex-1"
        />
        <datalist id="set-names">
          {setNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button type="submit" className="btn-primary">
          Search
        </button>
      </form>

      {!query && !setQuery && !viewingFriend && (
        <p className="text-sm text-black/60 dark:text-white/60">
          Search for a Pokemon, filter by set, or both, to see {LANGUAGE_LABELS[language]} cards
          and mark which ones you own.
        </p>
      )}

      {!query && !setQuery && viewingFriend && cards.length === 0 && (
        <p className="panel text-sm">
          {viewingFriend.display_name} doesn&apos;t have any {LANGUAGE_LABELS[language]} cards
          marked as owned yet.
        </p>
      )}

      {query && cards.length === 0 && notReleasedInThisLanguage && (
        <p className="panel text-sm">
          &ldquo;{query}&rdquo; hasn&apos;t been released in {LANGUAGE_LABELS[language]} as far as
          the synced card data shows. That&apos;s not a bug — some sets, especially in
          Simplified Chinese, genuinely haven&apos;t been printed there.
        </p>
      )}

      {query && cards.length === 0 && !notReleasedInThisLanguage && (
        <p className="panel text-sm">
          No cards found matching &ldquo;{query}&rdquo;
          {setQuery && <> in a set matching &ldquo;{setQuery}&rdquo;</>}. Check the spelling, or
          the card catalog may not be synced yet — see the sync script in the README.
        </p>
      )}

      {!query && setQuery && cards.length === 0 && (
        <p className="panel text-sm">
          No set matching &ldquo;{setQuery}&rdquo; found in {LANGUAGE_LABELS[language]}. Pick one
          from the suggestions as you type, or check the spelling.
        </p>
      )}

      {cards.length > 0 && (
        <>
          <p className="text-xs text-black/50 dark:text-white/50">
            {showingFriendsFullCollection
              ? `${cards.length} card${cards.length === 1 ? "" : "s"} owned`
              : `${cards.length} card${cards.length === 1 ? "" : "s"} · ${ownedSet.size} owned`}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {cards.map((card) => {
              const owned = ownedSet.has(card.id);
              const thumbnailClassName = `w-full rounded-lg object-cover shadow-sm transition-all duration-300 ${
                owned ? "" : "opacity-80 grayscale-[0.65] group-hover:opacity-100 group-hover:grayscale-0"
              }`;
              return (
                <div
                  key={card.id}
                  className={`group relative flex flex-col gap-2 rounded-xl border p-2 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    owned
                      ? "card-holo border-emerald-600/40 bg-gradient-to-b from-emerald-50 to-emerald-50/40 dark:border-emerald-500/30 dark:from-emerald-950/40 dark:to-emerald-950/10"
                      : "border-black/10 bg-white/60 dark:border-white/10 dark:bg-white/[0.02]"
                  }`}
                >
                  <div className="relative">
                    {card.image_url ? (
                      <CardImageLightbox
                        src={resolveImageSrc(card.image_url)}
                        alt={card.name}
                        thumbnailClassName={thumbnailClassName}
                      />
                    ) : (
                      <div className="card-back-pattern relative flex aspect-[5/7] items-center justify-center overflow-hidden rounded-lg bg-black/5 dark:bg-white/10">
                        <PokeballMark className="h-10 w-10 opacity-20" />
                        <span className="absolute bottom-1.5 text-[10px] text-black/40 dark:text-white/40">
                          No image
                        </span>
                      </div>
                    )}
                    {owned && (
                      <span className="badge absolute right-1.5 top-1.5 bg-emerald-600 text-white shadow-sm">
                        ✓ Owned
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-medium">{card.name}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">
                    {card.set_name} · #{card.card_number}
                  </div>
                  {viewingFriend ? (
                    // Read-only when browsing someone else's collection —
                    // no toggle, just the badge above (or its absence).
                    !owned && (
                      <div className="rounded-lg px-2 py-1 text-center text-xs text-black/40 dark:text-white/40">
                        Not owned
                      </div>
                    )
                  ) : (
                    <form action={toggleOwned}>
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="language" value={language} />
                      <input type="hidden" name="owned" value={String(owned)} />
                      <button
                        type="submit"
                        className={`btn-sm w-full ${owned ? "btn-secondary" : "btn-success"}`}
                      >
                        {owned ? "Remove" : "Mark as owned"}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
