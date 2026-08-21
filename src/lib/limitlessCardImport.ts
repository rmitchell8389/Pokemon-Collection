// Fetches real per-card data (not just images) from limitlesstcg.com for
// Japanese sets TCGdex has zero card-level data for at all — see the
// "Japanese card catalog completeness" section of the spec doc for how this
// gap was found (TCGdex declares 177 ja sets but only delivers real card
// data for 70 of them).
//
// Built against REAL raw HTML (scripts/debug-limitless-jp-raw.ts), not a
// summarized/paraphrased fetch — this project has already shipped one
// importer built on a summarized "quote verbatim" that silently wasn't
// verbatim (the Gem Pack parser, see spec doc), wasted a full run before the
// real template name was found. Not repeating that mistake on something 20x
// the size. Every regex below is checked against real saved HTML
// (debug-limitless-card.html / debug-limitless-set.html), not memory or a
// summary.
//
// Verified live 2026-08-20 against /cards/jp/S4a and /cards/jp/S4a/318:
// - The set list page has an `.infobox-line` div containing literal text
//   like "20th November 2020 • 326 Cards" — the real total, which can be
//   LARGER than TCGdex's own declared cardCount.total (S4a: TCGdex says
//   190, Limitless says 326, confirmed real via this exact page, not a
//   guess). Always use this number, never TCGdex's declared count, for how
//   many cards to fetch per set.
// - Card numbering in URLs (/cards/jp/<set>/<n>) runs 1..N sequentially,
//   confirmed by the set page's own card grid linking to /1 through at
//   least /29 in visible order with no gaps.
// - Each card page has a `.card-text-name` span with the card's Japanese
//   name, a `.card-text-type` paragraph whose first segment (before the
//   first " - ") is the category (Pokémon / Trainer / Energy — only
//   Pokémon has been checked directly), and a `.card-prints-current` block
//   containing an unclassed `<span>#NNN · RARITY</span>` — the card's own
//   rarity, separated from its number by a literal "·" (middle dot).
//
// NOT verified: the exact markup for a Trainer or Energy card page (only a
// Pokémon card was fetched raw). Every parse below is defensive — a field
// that can't be found comes back null rather than a guessed value, and
// import-jp-limitless-cards.ts skips a card entirely (logs it, doesn't
// write) if the one truly required field, the name, can't be found. Watch
// a first real dry run's skip list for a pattern before assuming Trainer/
// Energy cards parse the same way Pokémon cards do.
//
// UPDATE 2026-08-21: the first full-92-set dry run 404'd on 24 sets at the
// set-info-fetch step. Checked each one against limitlesstcg.com directly
// (real fetches/searches, not guessed) — same category of problem as the
// pre-existing "M-P" -> "MP" override in limitlesstcg.ts, TCGdex's declared
// id just doesn't match Limitless's own code for these 11:
//   - TCGdex's "+"-suffixed SM box sets (SM1+, sm2+, SM3+, SM4+, SM5+) are
//     "p"-suffixed on Limitless (SM1p..SM5p) — confirmed via exact declared
//     name matches (SM3+ "ひかる伝説"/Shining Legends, SM4+ "GXバトルブースト"/
//     GX Battle Boost, SM5+ "ウルトラフォース"/Ultra Force all matched
//     Limitless's SM3p/SM4p/SM5p listings verbatim).
//   - XY1a/XY1b ("コレクションX"/"コレクションY", Collection X/Y) are
//     XY1x/XY1y on Limitless — exact name match.
//   - XY5a/XY5b ("ガイアボルケーノ"/"タイダルストーム", Gaia Volcano/Tidal
//     Storm) are XY5g/XY5t on Limitless — exact name match.
//   - sn10a/sn11 (TCGdex's oddly-lowercased ids, "ジージーエンド"/
//     "ミラクルツイン", GG End/Miracle Twin) are just SM10a/SM11 on
//     Limitless (normal casing) — exact name match.
// The other 13 failing sets were NOT resolved this pass:
//   - ADV1-5, L1a/L1b/L2/L3/LL, PCG10 (11 sets, all pre-2011/vintage) —
//     direct re-checks of ADV1 and L1 both 404'd again, and a search found
//     no limitlesstcg.com/cards/jp hits for HeartGold/SoulSilver Collection
//     or World Champions Pack at all. Consistent with the coverage cutoff
//     already documented in this file's image-URL sibling
//     (buildLimitlessJpImageCandidates in limitlesstcg.ts): Limitless's
//     Japanese coverage doesn't reach back past the Black & White era
//     (2011). Treated as a genuine content gap, not an id mismatch — not
//     in TARGET_SETS, see KNOWN_UNAVAILABLE_SETS in
//     import-jp-limitless-cards.ts.
//   - XY8a ("青い衝撃") and XY11a ("爆熱の闘士") are real mid-2010s sets, so
//     probably ARE on Limitless under some other code, but that code
//     wasn't found — a candidate ("XY8r") turned out to be a duplicate of
//     TCGdex's own already-working XY8b ("赤い閃光"/Red Light Flash, same
//     name and card count), ruling it out rather than confirming a fix.
//     Left unresolved rather than guessed — see UNRESOLVED_SETS in
//     import-jp-limitless-cards.ts.
export const LIMITLESS_SET_ID_OVERRIDES: Record<string, string> = {
  "SM1+": "SM1p",
  "sm2+": "SM2p",
  "SM3+": "SM3p",
  "SM4+": "SM4p",
  "SM5+": "SM5p",
  XY1a: "XY1x",
  XY1b: "XY1y",
  XY5a: "XY5g",
  XY5b: "XY5t",
  sn10a: "SM10a",
  sn11: "SM11",
};

function resolveLimitlessSetId(setId: string): string {
  return LIMITLESS_SET_ID_OVERRIDES[setId] ?? setId;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class LimitlessNotFoundError extends Error {
  constructor(url: string) {
    super(`404 Not Found: ${url}`);
    this.name = "LimitlessNotFoundError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRawWithRetry(url: string, maxAttempts = 4): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    } catch (err) {
      lastError = err;
      await sleep(attempt * 500);
      continue;
    }

    if (res.status === 404) {
      throw new LimitlessNotFoundError(url);
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfterHeader = Number(res.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : attempt * 1000;
      lastError = new Error(`${res.status} ${res.statusText} for ${url}`);
      await sleep(delayMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.text();
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface LimitlessSetInfo {
  totalCards: number;
}

// Reads the REAL total card count off the set's own page — deliberately
// not trusting TCGdex's declared cardCount.total, which is confirmed wrong
// (too low) for at least S4a. This is the number of pages to fetch, so
// getting it right matters more here than anywhere else in this file.
export async function fetchLimitlessSetInfo(setId: string): Promise<LimitlessSetInfo> {
  const limitlessId = resolveLimitlessSetId(setId);
  const url = `https://limitlesstcg.com/cards/jp/${encodeURIComponent(limitlessId)}`;
  const html = await fetchRawWithRetry(url);
  const match = html.match(/infobox-line">[\s\S]*?(\d+)\s*Cards/);
  if (!match) {
    throw new Error(
      `Couldn't find a "N Cards" total on the set page for ${setId} (${url}) — page layout may have changed since this was built; check scripts/debug-limitless-jp-raw.ts's output against the regex in fetchLimitlessSetInfo before assuming the set doesn't exist.`
    );
  }
  return { totalCards: Number(match[1]) };
}

export interface LimitlessCard {
  name: string;
  category: string | null;
  rarity: string | null;
}

export async function fetchLimitlessCard(setId: string, number: number): Promise<LimitlessCard> {
  const limitlessId = resolveLimitlessSetId(setId);
  const url = `https://limitlesstcg.com/cards/jp/${encodeURIComponent(limitlessId)}/${number}`;
  const html = await fetchRawWithRetry(url);

  const nameMatch = html.match(/card-text-name"><a[^>]*>([^<]+)<\/a>/);
  if (!nameMatch) {
    throw new Error(`Couldn't parse a card name out of ${url} — page layout may have changed, or this isn't a real card page.`);
  }

  // First segment before the first " - " in card-text-type is the
  // category (Pokémon / Trainer / Energy) — the rest (subtype, "Evolves
  // from" link, etc.) isn't needed since the cards table has no category
  // column to put it in.
  const typeMatch = html.match(/card-text-type">\s*([^<]+?)\s*(?:<|$)/);
  const category = typeMatch ? typeMatch[1].split("-")[0].trim() || null : null;

  // The unclassed <span> inside card-prints-current, NOT the
  // <span class="text-lg"> right before it (that one's the set name).
  const rarityMatch = html.match(/card-prints-current">[\s\S]*?<span>\s*#\S+\s*(?:·\s*([^<]+?))?\s*<\/span>/);
  const rarity = rarityMatch && rarityMatch[1] ? rarityMatch[1].trim() : null;

  return {
    name: nameMatch[1].trim(),
    category,
    rarity,
  };
}
