// Loads Simplified Chinese (zh-cn) card images from the 52poke.com wiki
// (神奇宝贝百科 / "Pokémon Wiki"), a large Chinese-language Pokémon fan wiki
// on MediaWiki. Fallback image source for zh-cn cards TCGdex has no image
// for at all — the zh-cn counterpart to tcimageindex.ts (Traditional
// Chinese), limitlesstcg.ts (Japanese modern), and pcgsearch.ts (Japanese
// vintage).
//
// Unlike every other source in this codebase, this one is NOT a pre-built
// static index — it queries the 52poke.com MediaWiki API live, per card,
// batched. Why: this environment's own fetch tool hit a very hard rate
// limit against wiki.52poke.com while researching this source (roughly one
// request every ~10-15 minutes, spread across many hours of a session) —
// but that limit appears specific to the shared proxy IP this sandbox's web
// tools use, not a general limit on the API itself. There's no reason to
// expect the same throttling when this script runs from Ross's own
// machine, so rather than trying to pre-scrape a static index (impractical
// at that rate), the lookup happens live at backfill time instead.
//
// How the URL scheme was found and verified (2026-08-20, real checks
// against the live wiki, not guessed):
//   - Individual card images are wiki File: pages named
//     "{SETCODE}{cardNumber, 3-digit zero-padded}.png" — confirmed via a
//     real MediaWiki file-namespace search that returned exactly this
//     shape for every card in a real set (e.g. File:CSV3C001.png).
//   - Each set's own "...（TCG）" wiki article references its code via a
//     "SetSymbol{CODE}.png" file in its card-list-header template — this is
//     how a set's SETCODE gets discovered/confirmed.
//   - File: pages resolve to real CDN URLs (under media.52poke.com, with a
//     hash-based storage folder that is NOT derivable from the filename
//     alone) via the MediaWiki imageinfo API, batchable up to 50 titles per
//     call: action=query&titles=File:A.png|File:B.png|...&prop=imageinfo&iiprop=url
//
// SET CODE MAPPING — the actual finding: five of Ross's eight missing
// zh-cn sets were individually searched and content-verified on the live
// wiki (each confirmed by finding its real "...（TCG）" article and reading
// its literal SetSymbol{CODE}.png reference, not guessed):
//   SV7  -> SV7F   (article "星晶奇跡（TCG）")
//   SV8  -> SV8F   (article "超電突圍（TCG）")
//   SV9  -> SV9F   (article "對戰搭檔（TCG）")
//   SV10 -> SV10F  (article "火箭隊的榮耀（TCG）")
//   SV9a -> SV9aF  (article "熱風競技場（TCG）")
// All five follow the exact same rule: wiki code = TCGdex set_id + "F".
// Given that held uniformly across 5 independently-verified sets, this
// module applies the same rule to any other zh-cn set_id shaped like
// "SV<digits><optional letter>" — this covers SV7a and SV8a too, which
// weren't individually confirmed before research time ran out on this
// session. This is NOT a blind guess: every backfill script in this
// codebase (including this one) does a real HTTP check before writing
// anything, so an unconfirmed or wrong code for SV7a/SV8a just resolves to
// "not found" and gets skipped — never a wrong write.
// CSMPiC (a promo combo-pack set, "对战派对组合 奖励包") doesn't fit the
// "SV<n>" shape at all, but was found and content-verified after a real run
// showed the other 5 sets working well: its parent article "对战派对组合
// （TCG）" ("Battle Pair Combo") turned out to be a MULTI-set article
// covering a whole family of combo-pack sub-sets, each with its own
// SetSymbol reference — CSMPaC through CSMPlC (12 sub-codes, one per
// Pokémon type + promo/reconstruction packs). CSMPiC is literally IN that
// list, unchanged — TCGdex's set_id and the wiki's code are IDENTICAL here
// (no "+F" transform, unlike the SV-numbered sets above). Confirmed further
// via a direct file-namespace search that returned real files
// File:CSMPiC007.png, File:CSMPiC008.png, File:CSMPiC031.png,
// File:CSMPiC048.png (3-digit padding, matching every other confirmed set).
//
// UPDATE 2026-08-20, after Ross's first real run (689/877 filled): SV7a and
// SV8a's inferred "+F" codes were validated — SV7a filled 64/64 outright,
// and SV8a's SV8aF code resolved real images too (99/237), just not for
// every card. Investigated the SV8a shortfall directly (via
// debug-cn-card-images.ts): the missing cards are a contiguous low-number
// range (004, 005, 006, 008, 009...) with completely normal 3-digit
// card_number formatting — not a padding/scheme bug at all. Most likely
// explanation: SV8a ("太晶慶典ex") is presumably the newest of the 8 sets,
// and the wiki's own community upload of that set's card images simply
// isn't complete yet — a genuine content gap on the source, not a bug
// here, same category as the newest-set scrape lag already documented for
// the Traditional Chinese source. Re-running this backfill later may pick
// up more as the wiki fills in, at no cost.
//
// UPDATE 2026-08-20, after Ross ran CSMPiC (filled only 4/48, not ~48 as
// expected): root-caused via debug-cn-card-images.ts + a direct read of the
// combo-pack article's card-list wikitext. This is a DIFFERENT failure mode
// than SV8a's content lag, and it's a structural dead end, not a bug to fix
// here. CSMPiC ("对战大师奖励包") is a promo bundle that mostly REPRINTS
// cards originally released in other sets, and the wiki's own card table
// reflects that: card 001 (叶伊布GX) is templated as `{{C|叶伊布GX|SM5S}}`
// and card 002 (喷火龙GX) as `{{C|喷火龙GX|SML}}` — i.e. the wiki points at
// each reprint's ORIGINAL set code, not at "CSMPiC". There is no
// File:CSMPiC0XX.png for most of these cards because the wiki never
// separately uploaded one; only a few cards with dedicated new art for this
// pack (007, 008, 031, 048, confirmed) actually got a CSMPiC-coded file.
// Filling the rest would require resolving each reprinted card's ORIGINAL
// set+number (a name-based lookup per card, not a set-id-based one) — a
// meaningfully different and much larger problem than anything else this
// module does, and not worth building given how hard this domain throttles
// automated fetches. Deliberately not pursued further. If a future session
// picks this up, don't re-derive this from scratch — start here.
//
// Card-number zero-padding: 3-digit, confirmed both for the original
// CSV3C example and directly for CSMPiC (007/008/031/048 above). Not
// independently re-confirmed card-by-card for SV7F/SV8F/SV9F/SV10F/SV9aF,
// but the real run's near-100% fill rate on 5 of those 6 sets (everything
// except SV8a's separately-explained gap) is strong indirect confirmation
// the padding assumption holds there too.
//
// CORRECTION, 2026-08-20 (same day, later): the CSMPiC "reprint via a
// combo-pack article" explanation two paragraphs up is WRONG and should be
// disregarded — it was built on a WebFetch extraction of an article titled
// "对战派对组合（TCG）" that, on direct re-search the same day, does not
// appear to exist. That data was very likely fabricated/hallucinated by the
// small extraction model, not real wikitext. Lesson: don't trust a single
// large WebFetch table-extraction as ground truth, especially for content
// that can't be cross-checked — prefer MediaWiki's `insource:"literal
// text"` search (exact substring match against real wikitext) for anything
// load-bearing. That technique is what actually resolved both CSMPiC and
// SV8a for real, below.
//
// THE ACTUAL MECHANISM (confirmed via insource: search, much more
// trustworthy than table extraction): every individual card has its own
// wiki page (e.g. "超梦GX（SM3+）"), and that page's infobox has an
// `{{ExpansionList/main/zh|...}}` block listing every product the card was
// printed in. For a zh-cn SV8a printing specifically, the relevant fields
// are `zhicon=SV8aF|zhexpansion=太晶慶典ex|...|zhno=NNN/187|zhimg=...`. The
// `zhimg` field is either an explicit filename (`SV8aFNNN`), the literal
// string `n` (wiki explicitly says no image), or blank (not yet
// documented). CSMPiC cards use `cnicon=CSMPiC|...|cnimg=...` the same way.
//
// CRITICAL FINDING: a documented `zhimg=SV8aFNNN` value does NOT mean the
// file has actually been uploaded. Directly verified via the MediaWiki
// imageinfo API for 4 different documented-but-still-missing cards across
// both sets (CSMPiC 001/026/045, SV8a 092) — ALL FOUR came back `"missing"`
// despite having an explicit filename in their infobox. The wiki's
// per-card metadata can be ahead of its actual media uploads. This means
// there is NO reliable way to distinguish "will resolve soon" from "may
// never resolve" from the infobox data alone — only a live imageinfo/HTTP
// check (which this module already does) tells the truth.
//
// BOTTOM LINE after a full day of investigation (2026-08-20): there is no
// further code-level fix available for CSMPiC or SV8a's remaining gap. Of
// SV8a's ~138 missing cards, a real insource:"zhicon=SV8aF" search (193
// hits, effectively the whole set) showed ~70 explicitly marked `zhimg=n`
// (confirmed content gap) and the rest either undetermined-but-verified-
// missing or genuinely undocumented. CSMPiC's ~44 remaining cards are the
// same story. This is a genuine wiki-content-upload lag, not a mapping
// problem, not a padding problem, not a naming-scheme problem — the exact
// same conclusion as the ORIGINAL, simplest hypothesis from before this
// investigation started, just now backed by real evidence instead of
// guesswork. Re-running backfill:images-cn occasionally may pick up
// whatever the wiki community uploads over time, at no cost, but there is
// nothing more to build here. Do not re-open this investigation without new
// evidence that the situation has changed (e.g. a re-run picks up a
// meaningfully different count than 693/877).

const WIKI_API_BASE = "https://wiki.52poke.com/api.php";

// Add explicit overrides here for any zh-cn set_id that doesn't fit the
// "SV<digits><letter?>" + "F" rule below, or where that rule turns out to
// be wrong for a specific set once a real run comes back with unexpected
// results.
const SET_ID_OVERRIDES: Record<string, string> = {
  CSMPiC: "CSMPiC",
};

// Matches TCGdex zh-cn set_ids shaped like "SV7", "SV9a", "SV10", etc.
const SV_SET_ID_PATTERN = /^SV\d+[a-zA-Z]?$/;

export function buildWikiSetCode(setId: string): string | null {
  const override = SET_ID_OVERRIDES[setId];
  if (override) return override;
  if (SV_SET_ID_PATTERN.test(setId)) return `${setId}F`;
  // UPDATE 2026-08-20 (later the same day): non-SV zh-cn set codes
  // discovered via the wiki's per-card `{{ExpansionList/main/zh|...|
  // cnicon=CODE|...}}` reprint field are identity-mapped (wiki code == our
  // own set_id) — confirmed for CSMPiC (explicit override above, kept for
  // documentation clarity) and independently observed the same way for
  // CS1aC via real insource: search hits, both matching this rule with no
  // transform. Applying it generally rather than one override per code,
  // since it's the same confirmed pattern each time. As always, nothing
  // gets written without a live imageinfo/HTTP check downstream, so a wrong
  // guess here just resolves to "not found" for that card, never a bad
  // write. See scripts/import-cn-reprint-set.ts, which uses this for a
  // whole new class of zh-cn sets TCGdex has no card data for at all.
  return setId;
}

export function buildCnImageFileTitle(setId: string, cardNumber: string, padWidth = 3): string | null {
  const code = buildWikiSetCode(setId);
  if (!code) return null;
  const padded = /^\d+$/.test(cardNumber) ? cardNumber.padStart(padWidth, "0") : cardNumber;
  return `File:${code}${padded}.png`;
}

type ImageInfoResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: { url?: string }[];
        missing?: string;
      }
    >;
  };
};

// Batches up to 50 File: titles per MediaWiki API call (the API's own
// multi-title limit for anonymous/non-bot requests) and resolves each to
// its real CDN URL via imageinfo. Runs on whoever calls it (Ross's
// machine, not this sandbox) — no artificial delay here, since this calls
// the live MediaWiki API directly rather than a pre-built local index.
export async function resolveCnImageUrls(fileTitles: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const BATCH_SIZE = 50;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };

  for (let i = 0; i < fileTitles.length; i += BATCH_SIZE) {
    const batch = fileTitles.slice(i, i + BATCH_SIZE);
    const url = new URL(WIKI_API_BASE);
    url.searchParams.set("action", "query");
    url.searchParams.set("titles", batch.join("|"));
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url");
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) continue;

    const data = (await res.json()) as ImageInfoResponse;
    const pages = data.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      if (!page.title || "missing" in page) continue;
      const imgUrl = page.imageinfo?.[0]?.url;
      if (imgUrl) resolved.set(page.title, imgUrl);
    }
  }

  return resolved;
}

export async function cnImageExists(url: string): Promise<boolean> {
  // Real check before trusting anything resolved above — belt-and-braces
  // alongside the imageinfo lookup itself (which already confirms the file
  // exists on the wiki), same never-write-unverified philosophy as every
  // other backfill script in this codebase.
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  try {
    const res = await fetch(url, { method: "HEAD", headers });
    return res.ok;
  } catch {
    try {
      const res = await fetch(url, { method: "GET", headers });
      return res.ok;
    } catch {
      return false;
    }
  }
}
