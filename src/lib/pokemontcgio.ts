// Thin wrapper around pokemontcg.io (https://pokemontcg.io) — used ONLY as a
// fallback image source for cards TCGdex has no image for at all.
//
// Why this exists: roughly 6% of the synced English catalog (~1,450 of
// ~23,400 cards) has no image in TCGdex, concentrated almost entirely in
// two categories: "trainer kit" starter-box products and "McDonald's
// Collection" promotional sets, plus the alternate-art "Trainer Gallery" /
// "Shiny Vault" insert subsets bundled in modern sets. TCGdex simply hasn't
// photographed these — confirmed by checking both the API response (no
// `dexId`-equivalent `image` field) and TCGdex's own asset CDN directly (the
// guessed asset URL 404s), so this isn't fixable by working around TCGdex —
// it needs a second source entirely.
//
// pokemontcg.io is the obvious historical alternative (it predates TCGdex as
// the go-to free Pokemon TCG API), and — confirmed live during development,
// via fetch tooling that could reach it — it has exactly the coverage
// TCGdex is missing: trainer kit sets (e.g. "EX Trainer Kit Latias", id
// tk1a) with working image URLs, McDonald's Collection sets 2011 through at
// least 2022, and Trainer Gallery / Shiny Vault subsets with matching names
// and matching card-number formats (e.g. "TG03") to TCGdex's own data.
//
// Known limitation, flagged honestly: pokemontcg.io itself is reportedly
// being wound down in favor of a paid successor (Scrydex) — its free tier
// was confirmed working when this was built, but there's no guarantee it
// stays that way. English-only; this is not a fix for the language
// completion checklists, only for missing images within English.
//
// UPDATE 2026-08-18, round 1: the original version of this file requested
// `pageSize=250` in one shot, assuming that covered every set (174 total) in
// a single request. Ross ran the backfill for real and hit a hard 500 on
// `/v2/sets?pageSize=250`. At the time, `pageSize=100` also 500'd but
// `pageSize=50` returned 200 — read as a page-size cap and fixed by paginating
// in chunks of 50.
//
// UPDATE 2026-08-18, round 2: that wasn't the real problem. Ross re-ran with
// the pagination fix and hit a 500 on page 2 specifically — but re-requesting
// the *exact same* `page=2&pageSize=50` immediately afterward returned 200
// with no changes at all. This is plain flakiness, not a deterministic
// page-size ceiling (the round 1 fix likely "worked" partly by coincidence,
// or by reducing request weight enough to dodge whatever's causing this).
// Consistent with the "being wound down toward Scrydex" caveat already
// flagged below — an API in that state is exactly the kind to get flaky
// under real, not just single-request, use.
//
// Real fix: retry transient (5xx) failures with backoff instead of giving up
// on the first one, in fetchWithRetry() below. A 4xx is left alone (retrying
// a bad request doesn't help), but a 500 gets a few attempts with increasing
// delay before this actually gives up and surfaces an error.
//
// NOT verified end-to-end from this sandbox — api.pokemontcg.io isn't
// reachable via direct fetch here (same network restriction as TCGdex and
// PokeAPI), only via fetch tooling that proxies differently, which is how
// both rounds above were diagnosed. The actual backfill script
// (scripts/backfill-images.ts) still needs a clean, complete real run from
// Ross to confirm this holds up at full scale under sustained concurrent
// requests (the script fetches 3 sets at a time), not just the handful of
// individual requests checked by hand.

const POKEMONTCGIO_BASE_URL = "https://api.pokemontcg.io/v2";

// 50 turned out not to be load-bearing (see UPDATE round 2 above) but is
// left as-is — a smaller page count means fewer total requests, which is a
// reasonable thing to minimize against a service that's already shown it can
// be flaky, independent of whatever the real cause of the 500s is.
const PAGE_SIZE = 50;

const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries only on 5xx (the server's problem, plausibly transient — this is
// what round 2 above actually needed) and never on 4xx (the request itself
// is wrong; retrying won't fix that and would just waste time before failing
// anyway). Exponential backoff (1s, 2s, 4s) between attempts.
async function fetchWithRetry(url: string): Promise<Response> {
  let lastStatus = 0;
  let lastStatusText = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) return res;

    lastStatus = res.status;
    lastStatusText = res.statusText;

    if (res.status < 500 || attempt === MAX_ATTEMPTS) {
      throw new Error(`pokemontcg.io request failed: ${res.status} ${res.statusText} for ${url}`);
    }

    const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    console.log(
      `    ! pokemontcg.io ${lastStatus} ${lastStatusText}, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})...`
    );
    await sleep(delayMs);
  }

  // Unreachable in practice (the loop always returns or throws above), but
  // keeps TypeScript satisfied that every path returns a Response.
  throw new Error(`pokemontcg.io request failed: ${lastStatus} ${lastStatusText} for ${url}`);
}

export interface PokemonTcgIoSet {
  id: string;
  name: string;
}

export interface PokemonTcgIoCard {
  id: string;
  name: string;
  number: string;
  images?: { small?: string; large?: string };
}

interface PokemonTcgIoListResponse<T> {
  data: T[];
  totalCount?: number;
}

// T here is the item type (e.g. PokemonTcgIoSet), not the array — the
// response envelope is always { data: T[] }. Paginates until a page comes
// back shorter than PAGE_SIZE (the natural end of the results) or until
// `totalCount` (when the API provides it) says everything's been collected
// — whichever signal fires first, since not every response includes
// totalCount.
async function pokemonTcgIoFetchAllPages<T>(path: string, queryParams: string): Promise<T[]> {
  const results: T[] = [];
  let page = 1;

  while (true) {
    const prefix = queryParams ? `${queryParams}&` : "";
    const res = await fetchWithRetry(
      `${POKEMONTCGIO_BASE_URL}${path}?${prefix}page=${page}&pageSize=${PAGE_SIZE}`
    );

    const json = (await res.json()) as PokemonTcgIoListResponse<T>;
    results.push(...json.data);

    const gotFullPage = json.data.length === PAGE_SIZE;
    const knownComplete = typeof json.totalCount === "number" && results.length >= json.totalCount;
    if (!gotFullPage || knownComplete) break;

    page++;
  }

  return results;
}

export function listAllSets() {
  return pokemonTcgIoFetchAllPages<PokemonTcgIoSet>("/sets", "");
}

export function listCardsInSet(setId: string) {
  return pokemonTcgIoFetchAllPages<PokemonTcgIoCard>("/cards", `q=set.id:${encodeURIComponent(setId)}`);
}

// Loose normalization for matching set names between TCGdex and
// pokemontcg.io — they're usually near-identical ("Brilliant Stars Trainer
// Gallery" on both), but capitalization and punctuation can differ
// ("EX trainer Kit (Latias)" vs "EX Trainer Kit Latias"). Deliberately
// simple (lowercase, strip non-alphanumerics) and matched exactly after
// normalization — no fuzzy/similarity scoring, since a wrong-set match
// would attach a completely wrong image to a card. Sets that don't
// normalize to an exact match are skipped and logged, not guessed at.
export function normalizeSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Card numbers match format between the two sources in every case checked
// (e.g. "TG03", "4"), but normalize defensively: uppercase any letter
// prefix, strip leading zeros from the numeric part, so "TG3" and "TG03"
// (or "004" and "4") are still treated as the same card.
export function normalizeCardNumber(number: string): string {
  const match = number.match(/^([a-zA-Z]*)0*(\d+)([a-zA-Z]*)$/);
  if (!match) return number.toUpperCase().trim();
  const [, prefix, digits, suffix] = match;
  return `${prefix.toUpperCase()}${digits}${suffix.toUpperCase()}`;
}
