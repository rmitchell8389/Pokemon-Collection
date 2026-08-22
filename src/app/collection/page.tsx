import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TCGDEX_LANGUAGES, type TcgdexLanguage } from "@/lib/tcgdex";
import { toggleOwned, toggleForTrade, toggleWishlist } from "./actions";
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

type ViewMode = "owned" | "wishlist" | "trade";
const VIEW_MODES: ViewMode[] = ["owned", "wishlist", "trade"];
const VIEW_LABELS: Record<ViewMode, string> = {
  owned: "My collection",
  wishlist: "Wishlist",
  trade: "For trade",
};

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{
    lang?: string;
    q?: string;
    set?: string;
    dex?: string;
    artist?: string;
    rarity?: string;
    friend?: string;
    view?: string;
  }>;
}) {
  const { lang, q, set, dex, artist, rarity, friend, view } = await searchParams;
  const language: TcgdexLanguage = TCGDEX_LANGUAGES.includes(lang as TcgdexLanguage)
    ? (lang as TcgdexLanguage)
    : "en";
  const query = (q ?? "").trim();
  const setQuery = (set ?? "").trim();
  const dexQuery = (dex ?? "").trim();
  const artistQuery = (artist ?? "").trim();
  const rarityQuery = (rarity ?? "").trim();
  // A non-empty dex query that isn't a real number is still shown back in
  // the input (so the person can see what they typed) but doesn't get
  // turned into a `.eq()` filter — dexInvalid drives a small hint instead
  // of silently returning either nothing or the whole catalog.
  const dexNumber = dexQuery && Number.isFinite(Number(dexQuery)) ? Number(dexQuery) : null;
  const dexInvalid = dexQuery !== "" && dexNumber === null;
  const friendParam = (friend ?? "").trim();
  // Whether any of the catalog-style filters (as opposed to the name
  // search) are active — drives the "browse the whole catalog by filter"
  // branch below and the empty-state / intro messaging.
  const hasCatalogFilter = Boolean(setQuery || dexQuery || artistQuery || rarityQuery);
  // Only affects the zero-query default listing below (which table drives
  // "everything shown with no search typed") — search results always show
  // owned/wishlist/for-trade status together via the badges further down,
  // regardless of which view is selected.
  const viewMode: ViewMode = VIEW_MODES.includes(view as ViewMode) ? (view as ViewMode) : "owned";

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
  // Same idea for artist (free-text with suggestions) and rarity (a fixed
  // enough list per language to be a real dropdown rather than free text).
  const { data: setNameRows } = await supabase
    .from("cards")
    .select("set_name")
    .eq("language", language)
    .order("set_name");
  const setNames = Array.from(new Set((setNameRows ?? []).map((r) => r.set_name)));

  const { data: artistRows } = await supabase
    .from("cards")
    .select("artist")
    .eq("language", language)
    .not("artist", "is", null)
    .order("artist");
  const artistNames = Array.from(new Set((artistRows ?? []).map((r) => r.artist).filter((a): a is string => Boolean(a))));

  const { data: rarityRows } = await supabase
    .from("cards")
    .select("rarity")
    .eq("language", language)
    .not("rarity", "is", null)
    .order("rarity");
  const rarities = Array.from(new Set((rarityRows ?? []).map((r) => r.rarity).filter((r): r is string => Boolean(r))));

  type CardRow = {
    id: string;
    name: string;
    set_name: string;
    card_number: string;
    image_url: string | null;
    national_dex_no: number | null;
    artist: string | null;
    rarity: string | null;
  };
  const CARD_COLUMNS = "id, name, set_name, card_number, image_url, national_dex_no, artist, rarity";
  let cards: CardRow[] = [];
  let notReleasedInThisLanguage = false;
  // With no search typed yet, default to showing everything the target user
  // (yourself, or a friend you're viewing) owns instead of an empty "search
  // to begin" prompt — the whole point of opening a collection is browsing
  // it, not guessing what to search for first. This used to only apply when
  // viewing a friend; as of 2026-08-20 it applies to your own collection
  // too, since requiring a search just to see your own cards was the actual
  // complaint that prompted this change.
  let showingFullCollection = false;

  if (hasCatalogFilter && !query) {
    // Catalog-style browsing (set / dex number / artist / rarity, in any
    // combination, with no Pokemon name to resolve): no cross-language name
    // matching needed, so this goes straight at the `cards` table for the
    // selected language with whichever filters were actually given.
    let catalogQuery = supabase.from("cards").select(CARD_COLUMNS).eq("language", language);
    if (setQuery) catalogQuery = catalogQuery.ilike("set_name", `%${setQuery}%`);
    if (artistQuery) catalogQuery = catalogQuery.ilike("artist", `%${artistQuery}%`);
    if (rarityQuery) catalogQuery = catalogQuery.eq("rarity", rarityQuery);
    if (dexNumber !== null) catalogQuery = catalogQuery.eq("national_dex_no", dexNumber);
    const { data } = await catalogQuery;
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
      .select(CARD_COLUMNS)
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
          .select(CARD_COLUMNS)
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
          .select(CARD_COLUMNS)
          .eq("language", language)
          .ilike("name", `%${localizedName}%`);
        for (const c of data ?? []) cardsById.set(c.id, c);
      }
    }

    let matched = Array.from(cardsById.values());
    // A name search combined with any of the catalog-style filters narrows
    // to the intersection, rather than treating them as separate searches.
    if (setQuery) {
      const setQueryLower = setQuery.toLowerCase();
      matched = matched.filter((c) => c.set_name.toLowerCase().includes(setQueryLower));
    }
    if (artistQuery) {
      const artistQueryLower = artistQuery.toLowerCase();
      matched = matched.filter((c) => (c.artist ?? "").toLowerCase().includes(artistQueryLower));
    }
    if (rarityQuery) {
      matched = matched.filter((c) => c.rarity === rarityQuery);
    }
    if (dexNumber !== null) {
      matched = matched.filter((c) => c.national_dex_no === dexNumber);
    }
    cards = matched.sort((a, b) =>
      a.set_name === b.set_name
        ? compareCardNumbers(a.card_number, b.card_number)
        : a.set_name.localeCompare(b.set_name)
    );

    if (cards.length === 0 && language !== "en" && !hasCatalogFilter) {
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
  } else {
    // No search typed — show targetUserId's (yourself, or the friend you're
    // viewing) cards for whichever view is selected, rather than an empty
    // "search to begin" prompt. Same shape for all three views: get the
    // relevant card ids, then fetch those cards.
    let sourceCardIds: string[] = [];
    if (viewMode === "wishlist") {
      const { data: entries } = await supabase
        .from("wishlist_entries")
        .select("card_id")
        .eq("user_id", targetUserId)
        .eq("language", language);
      sourceCardIds = (entries ?? []).map((e) => e.card_id);
    } else if (viewMode === "trade") {
      const { data: entries } = await supabase
        .from("collection_entries")
        .select("card_id")
        .eq("user_id", targetUserId)
        .eq("language", language)
        .eq("for_trade", true);
      sourceCardIds = (entries ?? []).map((e) => e.card_id);
    } else {
      const { data: entries } = await supabase
        .from("collection_entries")
        .select("card_id")
        .eq("user_id", targetUserId)
        .eq("language", language);
      sourceCardIds = (entries ?? []).map((e) => e.card_id);
    }
    if (sourceCardIds.length > 0) {
      const { data } = await supabase
        .from("cards")
        .select(CARD_COLUMNS)
        .eq("language", language)
        .in("id", sourceCardIds);
      cards = (data ?? []).sort((a, b) =>
        a.set_name === b.set_name
          ? compareCardNumbers(a.card_number, b.card_number)
          : a.set_name.localeCompare(b.set_name)
      );
    }
    showingFullCollection = true;
  }

  const cardIds = cards.map((c) => c.id);
  const { data: ownedRows } =
    cardIds.length > 0
      ? await supabase
          .from("collection_entries")
          .select("card_id, quantity, for_trade")
          .eq("user_id", targetUserId)
          .eq("language", language)
          .in("card_id", cardIds)
      : { data: [] as { card_id: string; quantity: number; for_trade: boolean }[] };
  // card_id -> quantity, not just a Set — quantity is only real (i.e.
  // possibly > 1) for someone who's imported a Dex CSV; every row added the
  // old have/don't-have way still defaults to 1 at the DB level, so this
  // stays a drop-in replacement for the old ownedSet everywhere the value
  // itself isn't shown.
  const ownedQuantities = new Map((ownedRows ?? []).map((r) => [r.card_id, r.quantity ?? 1]));
  const forTradeCardIds = new Set((ownedRows ?? []).filter((r) => r.for_trade).map((r) => r.card_id));

  const { data: wishlistRows } =
    cardIds.length > 0
      ? await supabase
          .from("wishlist_entries")
          .select("card_id")
          .eq("user_id", targetUserId)
          .eq("language", language)
          .in("card_id", cardIds)
      : { data: [] as { card_id: string }[] };
  const wantedCardIds = new Set((wishlistRows ?? []).map((r) => r.card_id));

  // Every internal link on this page needs to carry `friend` (and, for the
  // view-mode pills, `view`) along so switching language or searching
  // doesn't silently kick you back to your own collection or the default
  // "owned" view.
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
          if (dexQuery) extra.dex = dexQuery;
          if (artistQuery) extra.artist = artistQuery;
          if (rarityQuery) extra.rarity = rarityQuery;
          if (viewMode !== "owned") extra.view = viewMode;
          return (
            <a key={l} href={hrefWithFriend(extra)} className={l === language ? "pill-active" : "pill-inactive"}>
              <span className="mr-1">{LANGUAGE_FLAGS[l]}</span>
              {LANGUAGE_LABELS[l]}
            </a>
          );
        })}
      </div>

      {!query && !hasCatalogFilter && (
        <div className="flex flex-wrap gap-2">
          {VIEW_MODES.map((v) => {
            const extra: Record<string, string> = { lang: language };
            if (v !== "owned") extra.view = v;
            return (
              <a key={v} href={hrefWithFriend(extra)} className={v === viewMode ? "pill-active" : "pill-inactive"}>
                {VIEW_LABELS[v]}
              </a>
            );
          })}
        </div>
      )}

      <form action="/collection" className="panel flex flex-wrap gap-2">
        <input type="hidden" name="lang" value={language} />
        {viewingFriend && <input type="hidden" name="friend" value={viewingFriend.id} />}
        {viewMode !== "owned" && <input type="hidden" name="view" value={viewMode} />}
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
        <input
          name="dex"
          inputMode="numeric"
          defaultValue={dexQuery}
          placeholder="Dex #, e.g. 6"
          className="input w-28"
        />
        <input
          name="artist"
          list="artist-names"
          defaultValue={artistQuery}
          placeholder="Artist, e.g. Mitsuhiro Arita"
          className="input min-w-[200px] flex-1"
        />
        <datalist id="artist-names">
          {artistNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <select name="rarity" defaultValue={rarityQuery} className="input w-auto">
          <option value="">Any rarity</option>
          {rarities.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary">
          Search
        </button>
      </form>

      {dexInvalid && (
        <p className="text-sm text-red-700 dark:text-red-300">
          &ldquo;{dexQuery}&rdquo; isn&apos;t a valid Dex number — enter just the number, e.g. 6.
        </p>
      )}

      {!query && !hasCatalogFilter && (
        <p className="text-sm text-black/60 dark:text-white/60">
          {viewMode === "wishlist"
            ? viewingFriend
              ? `Showing what ${viewingFriend.display_name} wants in ${LANGUAGE_LABELS[language]}.`
              : `Showing your wishlist in ${LANGUAGE_LABELS[language]}. Search for a Pokemon below and tap "Want" on any card you don't own yet.`
            : viewMode === "trade"
              ? viewingFriend
                ? `Showing what ${viewingFriend.display_name} has marked available to trade in ${LANGUAGE_LABELS[language]}.`
                : `Showing your cards marked for trade in ${LANGUAGE_LABELS[language]}. Tap "For trade" on any owned card to list it here.`
              : viewingFriend
                ? `Showing everything ${viewingFriend.display_name} owns in ${LANGUAGE_LABELS[language]}. Search for a Pokemon or filter by dex number, artist, set, or rarity to narrow it down.`
                : `Showing everything you own in ${LANGUAGE_LABELS[language]}. Search for a Pokemon, or filter by dex number, artist, set, or rarity to narrow it down or browse the full catalog.`}
        </p>
      )}

      {!query && !hasCatalogFilter && cards.length === 0 && (
        <p className="panel text-sm">
          {viewMode === "wishlist"
            ? viewingFriend
              ? `${viewingFriend.display_name} doesn't have any ${LANGUAGE_LABELS[language]} cards on their wishlist.`
              : `Nothing on your wishlist yet — search for a Pokemon below and tap "Want" on a card you don't own.`
            : viewMode === "trade"
              ? viewingFriend
                ? `${viewingFriend.display_name} doesn't have any ${LANGUAGE_LABELS[language]} cards marked for trade.`
                : `You haven't marked any owned cards for trade yet — tap "For trade" on a card in My collection.`
              : viewingFriend
                ? `${viewingFriend.display_name} doesn't have any ${LANGUAGE_LABELS[language]} cards marked as owned yet.`
                : `You haven't marked any ${LANGUAGE_LABELS[language]} cards as owned yet — search for a Pokemon or a set below to start adding them.`}
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
          {setQuery && <> in a set matching &ldquo;{setQuery}&rdquo;</>}
          {artistQuery && <> by an artist matching &ldquo;{artistQuery}&rdquo;</>}
          {rarityQuery && <> with rarity &ldquo;{rarityQuery}&rdquo;</>}
          {dexNumber !== null && <> at dex #{dexNumber}</>}. Check the spelling, or the card catalog
          may not be synced yet — see the sync script in the README.
        </p>
      )}

      {!query && hasCatalogFilter && cards.length === 0 && (
        <p className="panel text-sm">
          No cards found
          {setQuery && <> in a set matching &ldquo;{setQuery}&rdquo;</>}
          {artistQuery && <> by an artist matching &ldquo;{artistQuery}&rdquo;</>}
          {rarityQuery && <> with rarity &ldquo;{rarityQuery}&rdquo;</>}
          {dexNumber !== null && <> at dex #{dexNumber}</>} in {LANGUAGE_LABELS[language]}. Check the
          spelling, or pick a suggestion as you type.
        </p>
      )}

      {cards.length > 0 && (
        <>
          <p className="text-xs text-black/50 dark:text-white/50">
            {showingFullCollection
              ? viewMode === "wishlist"
                ? `${cards.length} card${cards.length === 1 ? "" : "s"} wanted`
                : viewMode === "trade"
                  ? `${cards.length} card${cards.length === 1 ? "" : "s"} for trade`
                  : `${cards.length} card${cards.length === 1 ? "" : "s"} owned`
              : `${cards.length} card${cards.length === 1 ? "" : "s"} · ${ownedQuantities.size} owned`}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {cards.map((card) => {
              const owned = ownedQuantities.has(card.id);
              const quantity = ownedQuantities.get(card.id) ?? 0;
              const forTrade = forTradeCardIds.has(card.id);
              const wanted = wantedCardIds.has(card.id);
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
                        ✓ Owned{quantity > 1 ? ` ×${quantity}` : ""}
                      </span>
                    )}
                    {forTrade && (
                      <span className="badge absolute left-1.5 top-1.5 bg-amber-500 text-white shadow-sm">
                        ⇄ For trade
                      </span>
                    )}
                    {wanted && !owned && (
                      <span className="badge absolute left-1.5 top-1.5 bg-violet-600 text-white shadow-sm">
                        ★ Wanted
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-medium">{card.name}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">
                    {card.set_name} · #{card.card_number}
                    {card.national_dex_no !== null && <> · Dex #{card.national_dex_no}</>}
                  </div>
                  {(card.artist || card.rarity) && (
                    <div className="text-[11px] text-black/40 dark:text-white/40">
                      {card.rarity ? card.rarity : null}
                      {card.rarity && card.artist ? " · " : null}
                      {card.artist ? card.artist : null}
                    </div>
                  )}
                  {viewingFriend ? (
                    // Read-only when browsing someone else's collection —
                    // no toggle, just the badges above (or their absence).
                    !owned &&
                    !wanted && (
                      <div className="rounded-lg px-2 py-1 text-center text-xs text-black/40 dark:text-white/40">
                        Not owned
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col gap-1.5">
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
                      {owned ? (
                        <form action={toggleForTrade}>
                          <input type="hidden" name="cardId" value={card.id} />
                          <input type="hidden" name="language" value={language} />
                          <input type="hidden" name="forTrade" value={String(forTrade)} />
                          <button
                            type="submit"
                            className={`btn-sm w-full ${forTrade ? "bg-amber-500 text-white hover:bg-amber-600" : "btn-secondary"}`}
                          >
                            {forTrade ? "Remove from trade list" : "Mark for trade"}
                          </button>
                        </form>
                      ) : (
                        <form action={toggleWishlist}>
                          <input type="hidden" name="cardId" value={card.id} />
                          <input type="hidden" name="language" value={language} />
                          <input type="hidden" name="wanted" value={String(wanted)} />
                          <button
                            type="submit"
                            className={`btn-sm w-full ${wanted ? "bg-violet-600 text-white hover:bg-violet-700" : "btn-secondary"}`}
                          >
                            {wanted ? "Remove from wishlist" : "Want"}
                          </button>
                        </form>
                      )}
                    </div>
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
