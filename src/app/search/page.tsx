import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TCGDEX_LANGUAGES, type TcgdexLanguage } from "@/lib/tcgdex";
import { toggleOwned, toggleForTrade, toggleWishlist } from "../collection/actions";
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

// Same image-shape detection as the collection page (src/app/collection/page.tsx)
// — duplicated rather than shared because this page was added standalone and
// touching the already-shipped collection page wasn't worth the risk. If this
// logic ever needs to change, check that file too.
function resolveImageSrc(imageUrl: string): string {
  return /\.(png|jpe?g|webp)$/i.test(imageUrl) ? imageUrl : `${imageUrl}/high.png`;
}

function compareCardNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// This page searches the WHOLE synced catalog for a language, not just cards
// a user owns (unlike /collection, which defaults to "everything you own"
// with no query typed). There's no natural ownership-based cap on that, so a
// single broad filter — e.g. just "card type = Pokemon" — could otherwise
// match thousands of rows in one query. Capped here, with the truncation
// clearly stated in the UI rather than silently showing a partial list.
const RESULT_LIMIT = 200;

type CardRow = {
  id: string;
  name: string;
  set_name: string;
  card_number: string;
  image_url: string | null;
  national_dex_no: number | null;
  artist: string | null;
  rarity: string | null;
  category: string | null;
  types: string[] | null;
};
const CARD_COLUMNS =
  "id, name, set_name, card_number, image_url, national_dex_no, artist, rarity, category, types";

// searchParams gives a plain string when a key appears once in the query
// string, and an array when it appears more than once — which is exactly
// what happens when several checkboxes share the same `name` and get
// submitted together (e.g. cat=Pokemon&cat=Trainer).
function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    lang?: string;
    q?: string;
    set?: string;
    dex?: string;
    artist?: string;
    rarity?: string;
    cat?: string | string[];
    etype?: string | string[];
  }>;
}) {
  const { lang, q, set, dex, artist, rarity, cat, etype } = await searchParams;
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
  // turned into a filter — dexInvalid drives a small hint instead of
  // silently returning either nothing or the whole catalog.
  const dexNumber = dexQuery && Number.isFinite(Number(dexQuery)) ? Number(dexQuery) : null;
  const dexInvalid = dexQuery !== "" && dexNumber === null;
  const selectedCategories = toArray(cat);
  const selectedTypes = toArray(etype);

  const hasAnyFilter = Boolean(
    query ||
      setQuery ||
      dexQuery ||
      artistQuery ||
      rarityQuery ||
      selectedCategories.length > 0 ||
      selectedTypes.length > 0
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Populate the set/artist/rarity fields with real values from the synced
  // data for this language, same pattern as the collection page.
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
  const artistNames = Array.from(
    new Set((artistRows ?? []).map((r) => r.artist).filter((a): a is string => Boolean(a)))
  );

  const { data: rarityRows } = await supabase
    .from("cards")
    .select("rarity")
    .eq("language", language)
    .not("rarity", "is", null)
    .order("rarity");
  const rarities = Array.from(
    new Set((rarityRows ?? []).map((r) => r.rarity).filter((r): r is string => Boolean(r)))
  );

  // category ("Pokemon" / "Trainer" / "Energy") and types (energy colors)
  // come from a schema + sync-script addition newer than the rest of this
  // table (see supabase/schema.sql and scripts/sync-cards.ts). Pulling the
  // checkbox options from whatever's actually in the data — instead of a
  // hardcoded list — means these filters just work once a sync has run,
  // and don't assume TCGdex's exact strings (which may even be localized
  // per language; unverified, see src/lib/tcgdex.ts).
  const { data: categoryRows } = await supabase
    .from("cards")
    .select("category")
    .eq("language", language)
    .not("category", "is", null);
  const CATEGORY_ORDER = ["Pokemon", "Trainer", "Energy"];
  const categories = Array.from(
    new Set((categoryRows ?? []).map((r) => r.category).filter((c): c is string => Boolean(c)))
  ).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const { data: typeRows } = await supabase
    .from("cards")
    .select("types")
    .eq("language", language)
    .not("types", "is", null);
  const energyTypes = Array.from(
    new Set((typeRows ?? []).flatMap((r) => r.types ?? []).filter(Boolean))
  ).sort();

  let cards: CardRow[] = [];
  let totalMatches = 0;
  let notReleasedInThisLanguage = false;

  if (query) {
    // Cross-language name search — same approach as the collection page's
    // name search: literal match on this language's card names, plus a
    // lookup against pokemon_species_names (synced from PokeAPI) to catch
    // cards TCGdex didn't tag with a dex number. See the long comment on
    // this logic in src/app/collection/page.tsx for the full reasoning.
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
    if (selectedCategories.length > 0) {
      matched = matched.filter((c) => c.category !== null && selectedCategories.includes(c.category));
    }
    if (selectedTypes.length > 0) {
      matched = matched.filter((c) => (c.types ?? []).some((t) => selectedTypes.includes(t)));
    }

    totalMatches = matched.length;
    cards = matched
      .sort((a, b) =>
        a.set_name === b.set_name
          ? compareCardNumbers(a.card_number, b.card_number)
          : a.set_name.localeCompare(b.set_name)
      )
      .slice(0, RESULT_LIMIT);

    if (cards.length === 0 && language !== "en") {
      const { data: enData } = await supabase
        .from("cards")
        .select("id")
        .eq("language", "en")
        .ilike("name", `%${query}%`)
        .limit(1);
      notReleasedInThisLanguage = speciesMatchCount > 0 || (enData?.length ?? 0) > 0;
    }
  } else if (hasAnyFilter) {
    // Catalog-style browsing, no name typed — filter the language's whole
    // catalog directly.
    let catalogQuery = supabase
      .from("cards")
      .select(CARD_COLUMNS, { count: "exact" })
      .eq("language", language);
    if (setQuery) catalogQuery = catalogQuery.ilike("set_name", `%${setQuery}%`);
    if (artistQuery) catalogQuery = catalogQuery.ilike("artist", `%${artistQuery}%`);
    if (rarityQuery) catalogQuery = catalogQuery.eq("rarity", rarityQuery);
    if (dexNumber !== null) catalogQuery = catalogQuery.eq("national_dex_no", dexNumber);
    if (selectedCategories.length > 0) catalogQuery = catalogQuery.in("category", selectedCategories);
    if (selectedTypes.length > 0) catalogQuery = catalogQuery.overlaps("types", selectedTypes);
    const { data, count } = await catalogQuery.limit(RESULT_LIMIT);
    totalMatches = count ?? (data ?? []).length;
    cards = (data ?? []).sort((a, b) =>
      a.set_name === b.set_name
        ? compareCardNumbers(a.card_number, b.card_number)
        : a.set_name.localeCompare(b.set_name)
    );
  }

  const cardIds = cards.map((c) => c.id);
  const { data: ownedRows } =
    cardIds.length > 0
      ? await supabase
          .from("collection_entries")
          .select("card_id, quantity, for_trade")
          .eq("user_id", user.id)
          .eq("language", language)
          .in("card_id", cardIds)
      : { data: [] as { card_id: string; quantity: number; for_trade: boolean }[] };
  const ownedQuantities = new Map((ownedRows ?? []).map((r) => [r.card_id, r.quantity ?? 1]));
  const forTradeCardIds = new Set((ownedRows ?? []).filter((r) => r.for_trade).map((r) => r.card_id));

  const { data: wishlistRows } =
    cardIds.length > 0
      ? await supabase
          .from("wishlist_entries")
          .select("card_id")
          .eq("user_id", user.id)
          .eq("language", language)
          .in("card_id", cardIds)
      : { data: [] as { card_id: string }[] };
  const wantedCardIds = new Set((wishlistRows ?? []).map((r) => r.card_id));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Card search</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Search the whole synced catalog, not just your own collection — filter by name, set, dex
        number, artist, rarity, card type, or energy type, in any combination.
      </p>

      <div className="flex flex-wrap gap-2">
        {TCGDEX_LANGUAGES.map((l) => {
          const params = new URLSearchParams();
          params.set("lang", l);
          if (query) params.set("q", query);
          if (setQuery) params.set("set", setQuery);
          if (dexQuery) params.set("dex", dexQuery);
          if (artistQuery) params.set("artist", artistQuery);
          if (rarityQuery) params.set("rarity", rarityQuery);
          selectedCategories.forEach((c) => params.append("cat", c));
          selectedTypes.forEach((t) => params.append("etype", t));
          return (
            <a
              key={l}
              href={`/search?${params.toString()}`}
              className={l === language ? "pill-active" : "pill-inactive"}
            >
              <span className="mr-1">{LANGUAGE_FLAGS[l]}</span>
              {LANGUAGE_LABELS[l]}
            </a>
          );
        })}
      </div>

      <form action="/search" className="panel flex flex-col gap-3">
        <input type="hidden" name="lang" value={language} />
        <div className="flex flex-wrap gap-2">
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
        </div>

        {categories.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-black/50 dark:text-white/50">Card type:</span>
            {categories.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="cat"
                  value={c}
                  defaultChecked={selectedCategories.includes(c)}
                  className="h-4 w-4"
                />
                {c}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-black/40 dark:text-white/40">
            Card type filtering needs a fresh sync after the latest schema update — run{" "}
            <code>npm run sync</code> to enable it.
          </p>
        )}

        {energyTypes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-black/50 dark:text-white/50">Energy type:</span>
            {energyTypes.map((t) => (
              <label key={t} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="etype"
                  value={t}
                  defaultChecked={selectedTypes.includes(t)}
                  className="h-4 w-4"
                />
                {t}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-black/40 dark:text-white/40">
            Energy type filtering needs a fresh sync after the latest schema update — run{" "}
            <code>npm run sync</code> to enable it.
          </p>
        )}

        <button type="submit" className="btn-primary self-start">
          Search
        </button>
      </form>

      {dexInvalid && (
        <p className="text-sm text-red-700 dark:text-red-300">
          &ldquo;{dexQuery}&rdquo; isn&apos;t a valid Dex number — enter just the number, e.g. 6.
        </p>
      )}

      {!hasAnyFilter && (
        <p className="panel text-sm">
          Use the filters above to search the full {LANGUAGE_LABELS[language]} card catalog — this
          searches every synced card, not just ones you own.
        </p>
      )}

      {hasAnyFilter && cards.length === 0 && notReleasedInThisLanguage && (
        <p className="panel text-sm">
          &ldquo;{query}&rdquo; hasn&apos;t been released in {LANGUAGE_LABELS[language]} as far as
          the synced card data shows.
        </p>
      )}

      {hasAnyFilter && cards.length === 0 && !notReleasedInThisLanguage && (
        <p className="panel text-sm">
          No cards found matching your filters in {LANGUAGE_LABELS[language]}. Check the spelling,
          or the card catalog may not be synced yet.
        </p>
      )}

      {cards.length > 0 && (
        <>
          <p className="text-xs text-black/50 dark:text-white/50">
            {totalMatches > cards.length
              ? `Showing first ${cards.length} of ${totalMatches} matches — add more filters to narrow it down.`
              : `${cards.length} card${cards.length === 1 ? "" : "s"}`}
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
                  {(card.artist || card.rarity || card.category) && (
                    <div className="text-[11px] text-black/40 dark:text-white/40">
                      {card.category ? card.category : null}
                      {card.category && card.rarity ? " · " : null}
                      {card.rarity ? card.rarity : null}
                      {(card.category || card.rarity) && card.artist ? " · " : null}
                      {card.artist ? card.artist : null}
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <form action={toggleOwned}>
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="language" value={language} />
                      <input type="hidden" name="owned" value={String(owned)} />
                      <button type="submit" className={`btn-sm w-full ${owned ? "btn-secondary" : "btn-success"}`}>
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
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
