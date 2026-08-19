// Thin wrapper around PokeAPI (https://pokeapi.co) — used ONLY to build a
// local Pokemon-species name lookup table (dex number -> official name per
// language). This is a completely separate data source from TCGdex.
//
// Why this exists: TCGdex's own per-card `dexId` field, which the search
// feature originally relied on to link the same Pokemon across languages,
// turned out to be missing on ~73% of the synced Traditional Chinese cards
// (confirmed against a live TCGdex response — see spec.md's "Chinese search
// showing only 1 card" entry). PokeAPI's species names are complete and
// official for every mainline Pokemon, independent of whether TCGdex has
// tagged a given card with a dex number, so searching by the actual
// localized name text recovers cards TCGdex's own metadata gap would
// otherwise hide.
//
// Confirmed against a live response (via fetch tooling that could reach
// pokeapi.co when this was built — direct outbound access to pokeapi.co is
// blocked from the sandbox itself, see scripts/sync-species-names.ts):
// PokeAPI's `pokemon-species` "id" field equals the National Pokedex number
// for every mainline species (Bulbasaur = 1, Charizard = 6, etc.), and each
// species' `names` array includes entries such as:
//   { language: { name: "zh-hant" }, name: "噴火龍" }
//   { language: { name: "zh-hans" }, name: "喷火龙" }

const POKEAPI_BASE_URL = "https://pokeapi.co/api/v2";

export interface PokeApiSpeciesListItem {
  name: string;
  url: string;
}

export interface PokeApiSpeciesListResponse {
  count: number;
  next: string | null;
  results: PokeApiSpeciesListItem[];
}

export interface PokeApiName {
  name: string;
  language: { name: string };
}

export interface PokeApiSpecies {
  id: number; // equals the National Pokedex number for mainline species
  names: PokeApiName[];
}

async function pokeApiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${POKEAPI_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`PokeAPI request failed: ${res.status} ${res.statusText} for ${path}`);
  }

  return (await res.json()) as T;
}

// PokeAPI's species list is capped at ~1025 mainline entries as of the most
// recent generation this was built against — a limit of 2000 comfortably
// covers current and near-future additions in one request (no pagination
// needed in practice, but `next` is still surfaced in case that changes).
export function listAllSpecies() {
  return pokeApiFetch<PokeApiSpeciesListResponse>(`/pokemon-species?limit=2000&offset=0`);
}

export function getSpecies(idOrName: string | number) {
  return pokeApiFetch<PokeApiSpecies>(`/pokemon-species/${encodeURIComponent(String(idOrName))}`);
}

export function namesByLanguage(species: PokeApiSpecies): Record<string, string> {
  const map: Record<string, string> = {};
  for (const n of species.names) {
    map[n.language.name] = n.name;
  }
  return map;
}
