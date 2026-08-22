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

// "Mechanic" markers (ex, V, GX, EX, Radiant) aren't a separate TCGdex field
// — they're embedded directly in the card NAME text. Pokemon TCG naming
// convention keeps these Latin-letter suffixes/prefixes untranslated even on
// non-English cards (a Japanese card is still named "...ex", not
// translated), so matching on the name works the same way across all 4
// languages without needing any new synced data. "ex" (modern, lowercase)
// and "EX" (2003-2016 era, uppercase) are deliberately distinct — case
// matters, see mechanicNameTest/mechanicLikeFilter below.
const MECHANIC_OPTIONS = ["ex", "V", "GX", "EX", "Radiant"] as const;
type Mechanic = (typeof MECHANIC_OPTIONS)[number];

function isMechanic(value: string): value is Mechanic {
  return (MECHANIC_OPTIONS as readonly string[]).includes(value);
}

// PostgREST's `.or()` filter string uses `*` as its LIKE wildcard (not `%`
// like a plain .like()/.ilike() call) — different escaping convention for
// the same underlying operator. Deliberately `like`, not `ilike`: needs to
// stay case-sensitive so "ex" and "EX" don't collide.
function mechanicLikeFilter(mechanic: Mechanic): string {
  return mechanic === "Radiant" ? "Radiant *" : `* ${mechanic}`;
}
function mechanicNameTest(mechanic: Mechanic): (name: string) => boolean {
  return mechanic === "Radiant"
    ? (name) => name.startsWith("Radiant ")
    : (name) => name.endsWith(` ${mechanic}`);
}

// The only two card-type values this page's checkboxes offer, per what was
// asked for — the underlying `category` column may also contain "Energy"
// (basic/special energy cards), which is left out of this filter on
// purpose rather than hidden entirely; it just never shows as an option.
const CARD_TYPE_OPTIONS = ["Pokemon", "Trainer"];

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
  series: string | null;
};
const CARD_COLUMNS =
  "id, name, set_name, card_number, image_url, national_dex_no, artist, rarity, category, types, series";

// searchParams gives a plain string when a key appears once in the query
// string, and an array when it appears more than once — which is exactly
// what happens when several checkboxes share the same `name` and get
// submitted together (e.g. cat=Pokemon&cat=Trainer).
function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// A collapsible checkbox group — plain <details>/<summary>, no client JS,
// so it works the same with or without JavaScript and needs no extra
// component. Defaults open when it already has an active selection (e.g.
// after a page reload) so the person can see what's applied without having
// to tap it open again.
function FilterGroup({
  label,
  name,
  options,
  selected,
}: {
  label: string;
  name: string;
  options: string[];
  selected: string[];
}) {
  if (options.length === 0) {
    return (
      <p className="rounded-lg border border-black/10 px-3 py-2 text-xs text-black/40 dark:border-white/10 dark:text-white/40">
        {label} filtering needs a fresh sync after the latest schema update — run{" "}
        <code>npm run sync</code> to enable it.
      </p>
    );
  }
  return (
    <details
      open={selected.length > 0}
      className="rounded-lg border border-black/10 dark:border-white/10"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        {label}
        {selected.length > 0 && (
          <span className="ml-1 font-normal text-black/50 dark:text-white/50">
            ({selected.length} selected)
          </span>
        )}
      </summary>
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-black/10 px-3 py-2.5 text-sm dark:border-white/10">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name={name}
              value={o}
              defaultChecked={selected.includes(o)}
              className="h-4 w-4"
            />
            {o}
          </label>
        ))}
      </div>
    </details>
  );
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
    rarity?: string | string[];
    cat?: string | string[];
    etype?: string | string[];
    series?: string | string[];
    mech?: string | string[];
  }>;
}) {
  const { lang, q, set, dex, artist, rarity, cat, etype, series, mech } = await searchParams;
  const language: TcgdexLanguage = TCGDEX_LANGUAGES.includes(lang as TcgdexLanguage)
    ? (lang as TcgdexLanguage)
    : "en";
  const query = (q ?? "").trim();
  const setQuery = (set ?? "").trim();
  const dexQuery = (dex ?? "").trim();
  const artistQuery = (artist ?? "").trim();
  // A non-empty dex query that isn't a real number is still shown back in
  // the input (so the person can see what they typed) but doesn't get
  // turned into a filter — dexInvalid drives a small hint instead of
  // silently returning either nothing or the whole catalog.
  const dexNumber = dexQuery && Number.isFinite(Number(dexQuery)) ? Number(dexQuery) : null;
  const dexInvalid = dexQuery !== "" && dexNumber === null;
  const selectedRarities = toArray(rarity);
  const selectedCategories = toArray(cat);
  const selectedTypes = toArray(etype);
  const selectedSeries = toArray(series);
  // Defensive: mech values feed straight into a raw .or() filter string
  // below, so only ever pass through values from the known-safe list —
  // never interpolate arbitrary query-string input into that string.
  const selectedMechanics = toArray(mech).filter(isMechanic);

  const hasAnyFilter = Boolean(
    query ||
      setQuery ||
      dexQuery ||
      artistQuery ||
      selectedRarities.length > 0 ||
      selectedCategories.length > 0 ||
      selectedTypes.length > 0 ||
      selectedSeries.length > 0 ||
      selectedMechanics.length > 0
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Populate every checkbox/datalist group with real values from the
  // synced data for this language, rather than a hardcoded list — same
  // pattern throughout, means these just work once a sync has run, and
  // don't assume TCGdex's exact strings (which may be localized per
  // language in ways that aren't verified — see src/lib/tcgdex.ts).
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
    .not("rarity", "is", null);
  const rarities = Array.from(
    new Set((rarityRows ?? []).map((r) => r.rarity).filter((r): r is string => Boolean(r)))
  ).sort();

  const { data: categoryRows } = await supabase
    .from("cards")
    .select("category")
    .eq("language", language)
    .not("category", "is", null);
  const cardTypeOptions = Array.from(
    new Set((categoryRows ?? []).map((r) => r.category).filter((c): c is string => Boolean(c)))
  ).filter((c) => CARD_TYPE_OPTIONS.some((o) => o.toLowerCase() === c.toLowerCase()));

  const { data: typeRows } = await supabase
    .from("cards")
    .select("types")
    .eq("language", language)
    .not("types", "is", null);
  const energyTypes = Array.from(
    new Set((typeRows ?? []).flatMap((r) => r.types ?? []).filter(Boolean))
  ).sort();

  const { data: seriesRows } = await supabase
    .from("cards")
    .select("series")
    .eq("language", language)
    .not("series", "is", null);
  const seriesOptions = Array.from(
    new Set((seriesRows ?? []).map((r) => r.series).filter((s): s is string => Boolean(s)))
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
    if (selectedRarities.length > 0) {
      matched = matched.filter((c) => c.rarity !== null && selectedRarities.includes(c.rarity));
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
    if (selectedSeries.length > 0) {
      matched = matched.filter((c) => c.series !== null && selectedSeries.includes(c.series));
    }
    if (selectedMechanics.length > 0) {
      const tests = selectedMechanics.map(mechanicNameTest);
      matched = matched.filter((c) => tests.some((test) => test(c.name)));
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
    if (selectedRarities.length > 0) catalogQuery = catalogQuery.in("rarity", selectedRarities);
    if (dexNumber !== null) catalogQuery = catalogQuery.eq("national_dex_no", dexNumber);
    if (selectedCategories.length > 0) catalogQuery = catalogQuery.in("category", selectedCategories);
    if (selectedTypes.length > 0) catalogQuery = catalogQuery.overlaps("types", selectedTypes);
    if (selectedSeries.length > 0) catalogQuery = catalogQuery.in("series", selectedSeries);
    if (selectedMechanics.length > 0) {
      catalogQuery = catalogQuery.or(
        selectedMechanics.map((m) => `name.like.${mechanicLikeFilter(m)}`).join(",")
      );
    }
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

  // Carries every active filter along when switching language, so hopping
  // between languages doesn't silently drop what was selected.
  function buildParams(overrides: { lang: TcgdexLanguage }): URLSearchParams {
    const params = new URLSearchParams();
    params.set("lang", overrides.lang);
    if (query) params.set("q", query);
    if (setQuery) params.set("set", setQuery);
    if (dexQuery) params.set("dex", dexQuery);
    if (artistQuery) params.set("artist", artistQuery);
    selectedRarities.forEach((r) => params.append("rarity", r));
    selectedCategories.forEach((c) => params.append("cat", c));
    selectedTypes.forEach((t) => params.append("etype", t));
    selectedSeries.forEach((s) => params.append("series", s));
    selectedMechanics.forEach((m) => params.append("mech", m));
    return params;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Card search</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Search the whole synced catalog, not just your own collection — filter by name, set, dex
        number, artist, card type, mechanic, series, rarity, or energy type, in any combination.
      </p>

      <div className="flex flex-wrap gap-2">
        {TCGDEX_LANGUAGES.map((l) => (
          <a
            key={l}
            href={`/search?${buildParams({ lang: l }).toString()}`}
            className={l === language ? "pill-active" : "pill-inactive"}
          >
            <span className="mr-1">{LANGUAGE_FLAGS[l]}</span>
            {LANGUAGE_LABELS[l]}
          </a>
        ))}
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
        </div>

        {/* Collapsible on purpose — five checkbox groups shown open at once
            would be a huge wall on a phone screen. Each stays collapsed
            until tapped, unless it already has a selection. */}
        <div className="flex flex-col gap-2">
          <FilterGroup label="Card type" name="cat" options={cardTypeOptions} selected={selectedCategories} />
          <FilterGroup label="Mechanic" name="mech" options={[...MECHANIC_OPTIONS]} selected={selectedMechanics} />
          <FilterGroup label="Series" name="series" options={seriesOptions} selected={selectedSeries} />
          <FilterGroup label="Rarity" name="rarity" options={rarities} selected={selectedRarities} />
          <FilterGroup label="Energy type" name="etype" options={energyTypes} selected={selectedTypes} />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            Search
          </button>
          {hasAnyFilter && (
            <a href={`/search?lang=${language}`} className="text-sm text-black/50 underline dark:text-white/50">
              Clear all filters
            </a>
          )}
        </div>
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
