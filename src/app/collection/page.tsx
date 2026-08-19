import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { TCGDEX_LANGUAGES, type TcgdexLanguage } from "@/lib/tcgdex";
import { toggleOwned } from "./actions";

const LANGUAGE_LABELS: Record<TcgdexLanguage, string> = {
  en: "English",
  ja: "Japanese",
  "zh-tw": "Traditional Chinese",
  "zh-cn": "Simplified Chinese",
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

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; q?: string }>;
}) {
  const { lang, q } = await searchParams;
  const language: TcgdexLanguage = TCGDEX_LANGUAGES.includes(lang as TcgdexLanguage)
    ? (lang as TcgdexLanguage)
    : "en";
  const query = (q ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  type CardRow = { id: string; name: string; set_name: string; card_number: string; image_url: string | null };
  let cards: CardRow[] = [];
  let notReleasedInThisLanguage = false;

  if (query) {
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

    cards = Array.from(cardsById.values()).sort((a, b) =>
      a.set_name === b.set_name
        ? a.card_number.localeCompare(b.card_number)
        : a.set_name.localeCompare(b.set_name)
    );

    if (cards.length === 0 && language !== "en") {
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
  }

  const cardIds = cards.map((c) => c.id);
  const { data: ownedRows } =
    cardIds.length > 0
      ? await supabase
          .from("collection_entries")
          .select("card_id")
          .eq("user_id", user.id)
          .eq("language", language)
          .in("card_id", cardIds)
      : { data: [] as { card_id: string }[] };
  const ownedSet = new Set((ownedRows ?? []).map((r) => r.card_id));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Collection</h1>

      <div className="flex flex-wrap gap-2">
        {TCGDEX_LANGUAGES.map((l) => (
          <a
            key={l}
            href={`/collection?lang=${l}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            className={`rounded-full px-3 py-1 text-sm ${
              l === language
                ? "bg-red-600 text-white"
                : "border border-black/15 dark:border-white/20"
            }`}
          >
            {LANGUAGE_LABELS[l]}
          </a>
        ))}
      </div>

      <form action="/collection" className="flex gap-2">
        <input type="hidden" name="lang" value={language} />
        <input
          name="q"
          defaultValue={query}
          placeholder="Search a Pokemon, e.g. Charizard"
          className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
        <button type="submit" className="rounded bg-red-600 px-4 py-2 font-medium text-white">
          Search
        </button>
      </form>

      {!query && (
        <p className="text-sm text-black/60 dark:text-white/60">
          Search for a Pokemon to see every {LANGUAGE_LABELS[language]} card of it, and mark
          which ones you own.
        </p>
      )}

      {query && cards.length === 0 && notReleasedInThisLanguage && (
        <p className="rounded bg-black/5 p-3 text-sm dark:bg-white/10">
          &ldquo;{query}&rdquo; hasn&apos;t been released in {LANGUAGE_LABELS[language]} as far as
          the synced card data shows. That&apos;s not a bug — some sets, especially in
          Simplified Chinese, genuinely haven&apos;t been printed there.
        </p>
      )}

      {query && cards.length === 0 && !notReleasedInThisLanguage && (
        <p className="rounded bg-black/5 p-3 text-sm dark:bg-white/10">
          No cards found matching &ldquo;{query}&rdquo;. Check the spelling, or the card catalog
          may not be synced yet — see the sync script in the README.
        </p>
      )}

      {cards.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {cards.map((card) => {
            const owned = ownedSet.has(card.id);
            return (
              <div
                key={card.id}
                className={`flex flex-col gap-2 rounded border p-2 ${
                  owned
                    ? "border-green-600/40 bg-green-50 dark:bg-green-950/30"
                    : "border-black/10 dark:border-white/10"
                }`}
              >
                {card.image_url ? (
                  <Image
                    src={resolveImageSrc(card.image_url)}
                    alt={card.name}
                    width={200}
                    height={280}
                    className="w-full rounded object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex aspect-[5/7] items-center justify-center rounded bg-black/5 text-xs text-black/40 dark:bg-white/10">
                    No image
                  </div>
                )}
                <div className="text-xs font-medium">{card.name}</div>
                <div className="text-xs text-black/50 dark:text-white/50">
                  {card.set_name} · #{card.card_number}
                </div>
                <form action={toggleOwned}>
                  <input type="hidden" name="cardId" value={card.id} />
                  <input type="hidden" name="language" value={language} />
                  <input type="hidden" name="owned" value={String(owned)} />
                  <button
                    type="submit"
                    className={`w-full rounded px-2 py-1 text-xs font-medium ${
                      owned
                        ? "bg-green-600 text-white"
                        : "border border-black/15 dark:border-white/20"
                    }`}
                  >
                    {owned ? "Owned ✓" : "Mark as owned"}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
