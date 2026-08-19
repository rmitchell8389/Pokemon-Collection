// Backfills `cards.image_url` from a local folder of card image scans, for
// English cards that neither TCGdex nor pokemontcg.io has an image for.
//
// Why this exists: after running scripts/backfill-images.ts (the
// pokemontcg.io fallback), a real run against a live database found two
// categories of cards it fundamentally cannot cover, confirmed directly
// against pokemontcg.io's own catalog rather than assumed:
//   - Trainer kit sets outside the EX era (XY, DP, HeartGold/SoulSilver,
//     Black & White, Sun & Moon) simply aren't in pokemontcg.io's catalog at
//     all — only the four EX-era trainer kits (tk1a, tk1b, tk2a, tk2b) exist
//     there.
//   - Some older promo subsets (e.g. Celebrations' 3-card "Classic
//     Collection" insert, id cel25cc) aren't there either — pokemontcg.io
//     has a same-named but different 25-card set (cel25c) that uses
//     different card numbering, so the safe (never-fuzzy) matching in the
//     other script correctly left these blank rather than guessing.
// pokemontcg.io also proved flaky in real use (intermittent 500/502s even
// with retries) and is reportedly being wound down toward a paid successor
// (Scrydex) — a third dependency on it isn't a great bet even where it does
// have data.
//
// Ross separately connected a folder from his own machine containing a
// large scraped archive of real card image files, organized into one
// subfolder per set (at unpredictable nesting depth — e.g.
// "Pokemon TCG/Pokemon TCG/<set-slug>/*.jpg" for most sets, but
// "<set-slug>/<set-slug>/*.jpg" for newer "Mega Evolution" era sets that
// live at the archive root instead). Confirmed by hand: the trainer-kit
// folders for XY/DP/HS/BW/SM eras are present and contain real card scans —
// exactly the gap pokemontcg.io can't fill.
//
// This script:
//   1. Walks the archive recursively, treating any directory that directly
//      contains image files as a "set folder", keyed by that directory's own
//      name — this is deliberately structure-agnostic rather than hardcoding
//      the exact nesting depth, since that nesting wasn't consistent across
//      the archive and more of it hasn't been individually inspected.
//   2. Matches each set folder to a `cards.set_name` by comparing both
//      reduced to bare alphanumerics (lowercased, everything else stripped)
//      — e.g. "mcdonalds-collection-2011" and "McDonald's Collection 2011"
//      both reduce to "mcdonaldscollection2011". Exact match only, same
//      never-fuzzy policy as scripts/backfill-images.ts, for the same reason
//      (a wrong match silently attaches the wrong image to a card).
//   3. Within a matched folder, extracts each file's card number as the
//      LAST run of digits in the filename before the extension — this
//      pattern held across every naming convention spot-checked by hand
//      (en_US-MCD11-001-snivy.jpg -> "001", charizard-base-set-bs-4.jpg ->
//      "4", me2-5_en_001_std.jpg -> "001"). Known limitation: this can't
//      recover a letter-prefixed collector number (e.g. Trainer Gallery's
//      "TG03") unless the filename happens to embed it as one contiguous
//      token — not attempted, since guessing wrong here risks a bad
//      false-positive parse. Not a problem for the current known gap
//      (trainer kits use plain numbering), but worth knowing if this script
//      is pointed at other sets later.
//   4. Uploads matched files to Supabase Storage (bucket "card-images",
//      created automatically if missing) and points `cards.image_url` at the
//      resulting public URL.
//
// This is a plain Node script meant to run ON THE MACHINE where the archive
// folder lives (it reads local files directly via `fs`), unlike
// scripts/backfill-images.ts which only ever talks to a remote API. Point
// LOCAL_CARD_ARCHIVE_PATH (see .env.example) at the archive's root folder.
//
// NOT verified end-to-end — this needs a real archive folder and real
// Supabase credentials to run, neither of which are available in the
// environment this was written in. tsc/eslint/build all pass, and the
// folder-walking + filename-parsing logic was checked by hand against
// several real sample folders (see the project's decision log for which
// ones), but the first real run is the actual test of whether the matching
// holds up across the full ~176-set archive.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const CONCURRENCY = 2; // lower than backfill-images.ts on purpose — this uploads real file bytes, not just writing a URL string.
const STORAGE_BUCKET = "card-images";
const MAX_WALK_DEPTH = 8;
const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp)$/i;

type CardRow = { id: string; set_name: string; card_number: string; name: string };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// TCGdex sometimes abbreviates an era in a set name ("BW trainer Kit
// (Excadrill)") where the local archive's folder spells it out
// ("black-white-trainer-kit-excadrill"), or vice versa. Confirmed by hand
// against real set names from a live backfill-images.ts run: BW/black-white,
// DP/diamond-pearl, and SM/sun-moon all clash this way for trainer kit sets
// specifically (XY and HS use the same abbreviated form on both sides, so
// they're unaffected and need no entry here). Rather than silently missing
// an otherwise-perfect match over a naming convention difference, try both
// the literal slug and every known abbreviation swapped in — this only ever
// ADDS candidate slugs to check, so a wrong guess just fails to match
// (harmless) rather than risking a false positive.
const ERA_ALIASES: Array<[string, string]> = [
  ["bw", "blackwhite"],
  ["dp", "diamondpearl"],
  ["sm", "sunmoon"],
];

// UPDATE 2026-08-18: the ERA_ALIASES swap above only fixes names that differ
// by a spelled-out-vs-abbreviated ERA. Checked a real batch of ~100 still-
// missing rows by hand against the live archive (folder listing + a few
// pokemontcg.io calls) and found a second, unrelated kind of mismatch: some
// set_names and their archive folders just use different WORDS for the same
// product, which no amount of alias-swapping on a shared prefix can bridge —
// "Mega Evolution Energy" (DB) vs the archive's "mee" (an acronym, not an
// abbreviation of a shared prefix), "McDonald's Collection 2023" (DB) vs
// "mcdonalds-match-battle-2023" (the actual product name, "Collection" vs
// "Match Battle"), and "MEP Black Star Promos" (DB) vs "mega-evolution-
// promos" (DB uses the set's own short code "MEP", archive spells the era
// out). Each confirmed by hand: the archive folder has real files whose
// extracted numbers line up with the DB rows that were reported missing.
// Exact literal overrides, not a heuristic — same reasoning as ERA_ALIASES
// (only ever adds a candidate to check, never removes one, so a stale or
// wrong entry just fails silently instead of mismatching).
const SET_NAME_ALIASES: Array<[string, string]> = [
  [slugify("Mega Evolution Energy"), "mee"],
  [slugify("McDonald's Collection 2023"), slugify("mcdonalds-match-battle-2023")],
  [slugify("MEP Black Star Promos"), slugify("mega-evolution-promos")],
  // The archive doesn't split the Classic Collection insert into its own
  // folder — it's bundled into "celebrations" alongside the 25-card base
  // Celebrations set (50 files total). That's fine for the name-fallback
  // match below (see findByNameFallback), which is what actually resolves
  // this set's numbering anyway. CAVEAT, not yet verified either way: if a
  // plain "Celebrations" (base set) row is ALSO still missing an image and
  // its number happens to collide with a Classic Collection file's number
  // in this same bundled folder (both use each card's own original/base
  // numbering, so a collision is plausible, not just theoretical), the
  // primary number-match map (built fresh per set_name, but from this same
  // shared file list) could pick whichever of the two collides last. Not
  // fixed here because it wasn't confirmed to actually happen against a
  // real "still missing" base-Celebrations row — worth a second look if a
  // real run shows a wrong image on a base Celebrations card.
  [slugify("Celebrations Classic Collection"), slugify("celebrations")],
  // UPDATE 2026-08-18, round 2: Ross ran the round-1 version of this script
  // for real. It filled zero images — every fix above was still correct in
  // principle, but never actually reached Ross's machine (this sandbox and
  // his machine are different filesystems; the file edited here doesn't
  // sync anywhere on its own). Re-diagnosed against his real run output plus
  // a fresh look at the actual archive contents. Four more "Black Star
  // Promos" sets hit the exact same DB-uses-short-code-vs-archive-spells-it-
  // out mismatch as MEP above, and one more insert (Unseen Forces' Unown
  // Collection) is bundled into its base set's folder the same way
  // Celebrations Classic Collection is:
  [slugify("SM Black Star Promos"), slugify("sun-moon-promos")],
  [slugify("XY Black Star Promos"), slugify("xy-promos")],
  [slugify("SWSH Black Star Promos"), slugify("sword-shield-promos")],
  [slugify("SVP Black Star Promos"), slugify("scarlet-violet-promos")],
  [slugify("Miscellaneous Promos"), slugify("miscellaneous")],
  [slugify("Unseen Forces Unown Collection"), slugify("unseen-forces")],
];

// UPDATE 2026-08-19: Celebrations Classic Collection's real run filled
// 18/25 and skipped 2 (Reshiram, Zekrom) as ambiguous, as expected — but
// that's not the full 25. Checked the actual "celebrations" folder listing
// again: it's confirmed to bundle the 25-card base Celebrations set
// ("en_US-Ann25th-NNN-name.jpg") together with the Classic Collection
// reprints ("en_US-Ann25thR-NNN-name.jpg", the "R" for Reprint) in one
// directory. Reshiram/Zekrom are ambiguous because a base-set card of the
// same name is sitting in the same folder as candidate. Now that the "R"
// prefix convention is confirmed (not guessed), scope Classic Collection's
// matching to ONLY the "R"-prefixed files up front — this removes the
// ambiguity at the source instead of relying on findByNameFallback to catch
// it after the fact, so Reshiram/Zekrom resolve too.
const SET_FILE_FILTERS: Array<[string, string]> = [[slugify("Celebrations Classic Collection"), "ann25thr"]];

// Two Classic Collection cards still won't resolve even with the above:
// "Luxray GL LV.X" and "Garchomp C LV.X". Confirmed why — the archive's
// filenames for these are "109-luxray_gl.jpg" and "145-garchomp_c.jpg",
// dropping the "LV.X" suffix entirely, so the full card name can never
// appear as a token run in the filename. Deliberately NOT fixed by loosening
// findByNameFallback to accept a partial/prefix name match in general —
// that would also match a plain "Charizard" file against a "Charizard GX"
// row elsewhere in this same folder, which is exactly the wrong-art mistake
// this script exists to prevent. Two confirmed, narrow overrides instead:
// safe because they can only ever match the one card they name.
// UPDATE 2026-08-19, round 4: these two didn't fire on the real run — my
// bug, not the archive's. The match below compares against a SLUGIFIED
// filename (slugify strips underscores), but I left underscores in
// "luxray_gl" / "garchomp_c", so the substring could never be found.
// Confirmed by tracing it by hand: slugify("...-luxray_gl.jpg") produces
// "...luxraygl..." with no underscore left to match against. Stripped the
// underscores from the override strings to match what they're actually
// compared against.
const CARD_NUMBER_OVERRIDES: Array<{ setSlug: string; cardNumber: string; filenameContains: string }> = [
  { setSlug: slugify("Celebrations Classic Collection"), cardNumber: "CC17", filenameContains: "luxraygl" },
  { setSlug: slugify("Celebrations Classic Collection"), cardNumber: "CC18", filenameContains: "garchompc" },
];

// UPDATE 2026-08-19: "Yellow A Alternate" isn't a real product/folder at
// all — confirmed against the archive and a web search. It's Ross's own DB
// grouping for XY-era alternate-art secret cards, which the archive itself
// marks with a "-yaa" filename suffix (found on
// "en_US-XY4-24a-m_manectric_ex-yaa.jpg" in the "phantom-forces" folder —
// "yaa" almost certainly IS "Yellow A Alternate", just lowercased). These
// cards are scattered across whichever real set each one originally
// belongs to (Phantom Forces for Manectric, other XY-era sets for the
// rest), not one folder, so the normal one-set-one-folder lookup can never
// find them. Handled as a special case in main(): search every archive file
// for the "-yaa" marker instead of resolving a folder, then match by number
// as usual within that filtered set.
const YELLOW_A_ALTERNATE_SLUG = slugify("Yellow A Alternate");

function candidateSlugs(name: string): string[] {
  const base = slugify(name);
  const variants = new Set([base]);
  for (const [abbr, full] of ERA_ALIASES) {
    if (base.startsWith(abbr)) variants.add(full + base.slice(abbr.length));
    if (base.startsWith(full)) variants.add(abbr + base.slice(full.length));
  }
  for (const [dbSlug, archiveSlug] of SET_NAME_ALIASES) {
    if (base === dbSlug) variants.add(archiveSlug);
  }
  return Array.from(variants);
}

// Card number = the last run of digits in the filename before the
// extension, optionally followed by a single letter suffix directly
// attached to it (no separator in between) — e.g. "146" or "146a".
//
// UPDATE 2026-08-18: the original version only captured plain digit runs.
// Found for real that this silently collapses letter-suffixed variant
// numbers onto their base number: BREAKthrough's archive folder has both
// "en_US-XY8-146-professors_letter.jpg" (card 146) and
// "en_US-XY8-146a-professors_letter-yaa.jpg" (card 146a, a distinct alt-art
// scan — genuinely a different photo, confirmed by file size/name, not a
// duplicate) — both used to extract to "146", so whichever file the
// directory walk happened to see last would silently win the map slot and
// the other stayed unfilled (or worse, got attached to the wrong DB row).
// Requiring the suffix letter be *directly* attached (no "-"/"_" in
// between) keeps this from misfiring on the far more common pattern where a
// number is immediately followed by a separator then an unrelated word
// (e.g. "mee_en_001_std.jpg" — "001" is followed by "_", not a letter, so
// no suffix attaches).
// UPDATE 2026-08-18, round 2: Unseen Forces' Unown Collection insert has no
// digits in its filenames at all ("unown-unseen-forces-uf-a.jpg",
// "...-uf-b.jpg", one per letter) — the real cards are numbered by letter,
// not digit. When no digit run exists, fall back to a trailing single-
// letter token (the last "-"/"_"-separated segment, if it's exactly one
// letter) as the card number. Deliberately narrow — a bare single-letter
// segment, not e.g. "mark" from "...-question-mark.jpg" — so this only
// fires on the genuinely letter-numbered case instead of grabbing an
// arbitrary trailing word as a fake card number.
// UPDATE 2026-08-19: Skyridge's e-card-era secret rares are scanned as bare
// "h13.jpg", "h16.jpg" (no Pokémon name in the filename at all, unlike
// Aquapolis/Expedition's equivalent "h01-ampharos-expedition.jpg" style —
// confirmed by hand, this is a real difference between the two folders, not
// an inconsistency I'm misreading). The digit-run regex below would extract
// "13" from "h13.jpg" and silently drop the "h", which is exactly the part
// that distinguishes it from a plain card 13 — Ross's DB correctly expects
// "H13". Checked whole last-segment patterns FIRST, ahead of the general
// digit scan, for exactly this reason: a segment that's already a clean
// "letter(s)+digits" or lone-letter token carries information the general
// scan would throw away. Confirmed this ordering doesn't regress anything
// already working: it only fires when the last segment matches one of these
// narrow shapes, and every previously-working filename's last segment
// (words like "std", "yaa", or a plain digit run) matches neither.
function extractCardNumber(filename: string): string | null {
  const base = filename.replace(IMAGE_EXTENSION_RE, "");
  const segments = base.split(/[-_]/).filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  if (lastSegment) {
    if (/^[a-zA-Z]\d+$/.test(lastSegment)) return lastSegment;
    if (/^[a-zA-Z]$/.test(lastSegment)) return lastSegment;
  }

  const digitRuns = base.match(/\d+[a-zA-Z]?/g);
  if (digitRuns && digitRuns.length > 0) return digitRuns[digitRuns.length - 1];

  return null;
}

// Same normalization scripts/backfill-images.ts uses for card numbers
// (uppercase any letter prefix/suffix, strip leading zeros from the numeric
// part) — duplicated rather than imported to keep this script runnable on
// its own without assuming pokemontcgio.ts's internals stay compatible.
function normalizeCardNumber(number: string): string {
  const match = number.match(/^([a-zA-Z]*)0*(\d+)([a-zA-Z]*)$/);
  if (!match) return number.toUpperCase().trim();
  const [, prefix, digits, suffix] = match;
  return `${prefix.toUpperCase()}${digits}${suffix.toUpperCase()}`;
}

// PostgREST (Supabase's query layer) caps a single request at 1000 rows by
// default — a plain .select() with no .range() silently truncates past
// that. Found this for real: both this script and backfill-images.ts
// reported exactly "1000" missing cards on live runs against a database
// with ~1,457 originally missing — the row cap showing through, not the
// true count, meaning cards past the first 1000 were never even
// considered. Paginate with .range() until a page comes back short.
async function fetchAllMissingCards(supabase: SupabaseClient): Promise<CardRow[]> {
  const PAGE_SIZE = 1000;
  const all: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, set_name, card_number, name")
      .eq("language", "en")
      .is("image_url", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load missing-image cards: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    all.push(...(data as CardRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

// Walks the archive recursively. Any directory whose direct children include
// at least one image file is treated as a "set folder" — its own image
// files (not any deeper) are attributed to it, keyed by its own directory
// name. Deliberately doesn't assume a fixed nesting depth (see header
// comment for why).
function findImageFolders(root: string): Map<string, string[]> {
  const found = new Map<string, string[]>();

  function walk(dir: string, depth: number) {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory (permissions, broken symlink, etc.) — skip, don't crash the whole walk.
    }

    const imageFiles = entries
      .filter((e) => e.isFile() && IMAGE_EXTENSION_RE.test(e.name))
      .map((e) => path.join(dir, e.name));

    if (imageFiles.length > 0) {
      const key = path.basename(dir).toLowerCase();
      const existing = found.get(key) ?? [];
      found.set(key, existing.concat(imageFiles));
    }

    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(root, 0);
  return found;
}

// Fallback for when number-matching finds nothing. Some products reuse a
// card's ORIGINAL print number on the scan/API side instead of numbering by
// the reprint's own position — e.g. Celebrations' "Classic Collection"
// insert. Confirmed by hand: pokemontcg.io labels its Blastoise reprint "2"
// and its Venusaur reprint "15" (their original Base Set numbers), not
// "1"/"3" (their position within this 25-card insert) — and the archive's
// scan filenames follow the same original-number convention. Our own DB
// numbers them CC001/CC003 instead. Worse, several reprints in this same
// set share an original number by coincidence (Venusaur, "Here Comes Team
// Rocket!", Claydol, and "Rocket's Zapdos" were all card 15 in their own
// original sets), so number-matching can never safely resolve this set even
// with a translation table — matching by name instead sidesteps the
// collision entirely, since names are unique within any one set folder.
//
// Deliberately conservative: only tried after the number match already
// failed, and only trusted when exactly one file in the folder's name
// contains the card's normalized name — more than one candidate is logged
// and skipped rather than guessed at, same never-fuzzy policy as everywhere
// else in this script. This also happens to be the right call for the
// Aquapolis-style "103a"/"103b" rows (two DB rows, one real scan): both
// rows independently name-match the single available photo, so both get
// filled with the same image rather than staying blank — an honest
// approximation (it's still a correct photo of that Pokémon, just not
// guaranteed to be the exact rarity variant), logged as such below.
//
// UPDATE 2026-08-18, round 2: the round-1 version compared normalized
// strings with plain .includes(), which silently matches a name against an
// unrelated LONGER name that happens to start with it — "Porygon" is a
// literal substring of "Porygon2", so Aquapolis's two Porygon rows matched
// against "porygon2-aquapolis-aq-28.jpg" as well as the correct
// "porygon-aquapolis-aq-103.jpg", got flagged ambiguous, and both stayed
// blank even though the real Porygon scan was sitting right there. Fixed by
// comparing TOKENS (split on non-alphanumeric) instead of raw substrings —
// require the card name's tokens to appear as a contiguous, exact-token
// run in the filename, so "porygon" only matches a token that's literally
// "porygon", never "porygon2".
// UPDATE 2026-08-19: real run found three more "Rocket's Zapdos"-style
// misses — "Rocket's Zapdos", "Team Magma's Groudon", "Rocket's Admin." all
// failed to match a file that's clearly the right one (confirmed by hand:
// "en_US-Ann25thR-015-rockets_zapdos.jpg" etc. are sitting right there).
// Root cause: the DB name's apostrophe splits "Rocket's" into two tokens
// ["rocket","s"], but archive filenames spell the possessive as one glued
// word ("rockets", no apostrophe or separator) — one token, not two. Fixed
// by collapsing "'s" to "s" BEFORE splitting into tokens, so both sides
// tokenize the same way. Narrow on purpose (only the possessive pattern,
// not all apostrophes) to avoid changing behavior for names that don't have
// this specific shape.
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/'s\b/g, "s")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

function findByNameFallback(files: string[], cardName: string): { file: string | null; ambiguous: boolean } {
  const nameTokens = tokenize(cardName);
  if (nameTokens.length === 0) return { file: null, ambiguous: false };

  const candidates = files.filter((f) => containsTokenSequence(tokenize(path.basename(f)), nameTokens));
  if (candidates.length === 1) return { file: candidates[0], ambiguous: false };
  if (candidates.length > 1) return { file: null, ambiguous: true };
  return { file: null, ambiguous: false };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const archiveRoot = process.env.LOCAL_CARD_ARCHIVE_PATH;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in."
    );
  }
  if (!archiveRoot) {
    throw new Error(
      "Missing LOCAL_CARD_ARCHIVE_PATH in .env.local — set it to the full local path of your card image archive folder."
    );
  }
  if (!fs.existsSync(archiveRoot)) {
    throw new Error(`LOCAL_CARD_ARCHIVE_PATH does not exist on disk: ${archiveRoot}`);
  }

  const supabase = createClient(url, serviceKey);

  console.log(`Ensuring Supabase Storage bucket "${STORAGE_BUCKET}" exists...`);
  const { error: bucketError } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
  if (bucketError && !/already exists/i.test(bucketError.message)) {
    throw new Error(`Failed to create/verify storage bucket: ${bucketError.message}`);
  }

  console.log(`Walking local archive at ${archiveRoot}...`);
  const imageFolders = findImageFolders(archiveRoot);
  console.log(`Found ${imageFolders.size} folder(s) containing image files.`);

  console.log("\nFetching cards with no image (English only)...");
  const missingCards = await fetchAllMissingCards(supabase);

  if (missingCards.length === 0) {
    console.log("No cards with a missing image — nothing to do.");
    return;
  }

  console.log(`${missingCards.length} card(s) still missing an image`);

  const bySet = new Map<string, CardRow[]>();
  for (const card of missingCards) {
    const list = bySet.get(card.set_name) ?? [];
    list.push(card);
    bySet.set(card.set_name, list);
  }
  console.log(`Across ${bySet.size} set(s)`);

  // Index archive folders by slug for lookup.
  const folderBySlug = new Map<string, string[]>();
  for (const [folderName, files] of imageFolders) {
    folderBySlug.set(slugify(folderName), files);
  }

  // Flattened view of every image file in the archive, regardless of which
  // folder it's in — needed for "Yellow A Alternate" below, which isn't a
  // real folder, just files scattered across many real ones.
  const allFiles = Array.from(imageFolders.values()).flat();

  let totalUploaded = 0;
  let totalSkippedNoFolderMatch = 0;
  let totalSkippedNoFileMatch = 0;
  let totalSkippedUploadError = 0;

  const setEntries = Array.from(bySet.entries());

  await mapWithConcurrency(setEntries, CONCURRENCY, async ([setName, cards]) => {
    const setSlug = slugify(setName);
    let files: string[] | undefined;

    if (setSlug === YELLOW_A_ALTERNATE_SLUG) {
      files = allFiles.filter((f) => path.basename(f).toLowerCase().includes("yaa"));
    } else {
      for (const candidate of candidateSlugs(setName)) {
        files = folderBySlug.get(candidate);
        if (files) break;
      }
      if (files) {
        const requiredSubstring = SET_FILE_FILTERS.find(([slug]) => slug === setSlug)?.[1];
        if (requiredSubstring) {
          files = files.filter((f) => slugify(path.basename(f)).includes(requiredSubstring));
        }
      }
    }

    if (!files || files.length === 0) {
      console.log(`  ! no archive folder found for set "${setName}" (${cards.length} card(s) stay blank)`);
      totalSkippedNoFolderMatch += cards.length;
      return;
    }

    const fileByNumber = new Map<string, string>();
    for (const filePath of files) {
      const raw = extractCardNumber(path.basename(filePath));
      if (raw === null) continue;
      fileByNumber.set(normalizeCardNumber(raw), filePath);
    }

    let filledThisSet = 0;
    let filledByNameFallback = 0;
    let skippedAmbiguousName = 0;
    for (const card of cards) {
      let filePath = fileByNumber.get(normalizeCardNumber(card.card_number));
      let matchedByName = false;

      if (!filePath) {
        const override = CARD_NUMBER_OVERRIDES.find(
          (o) => o.setSlug === setSlug && o.cardNumber === normalizeCardNumber(card.card_number)
        );
        if (override) {
          filePath = files.find((f) => slugify(path.basename(f)).includes(override.filenameContains));
        }
      }

      if (!filePath) {
        const nameResult = findByNameFallback(files, card.name);
        if (nameResult.ambiguous) {
          skippedAmbiguousName++;
          totalSkippedNoFileMatch++;
          continue;
        }
        if (nameResult.file) {
          filePath = nameResult.file;
          matchedByName = true;
        }
      }

      if (!filePath) {
        totalSkippedNoFileMatch++;
        continue;
      }

      try {
        const fileBuffer = fs.readFileSync(filePath);
        const storagePath = `english/${slugify(setName)}/${path.basename(filePath)}`;

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, fileBuffer, {
            contentType: guessContentType(filePath),
            upsert: true,
          });

        if (uploadError) {
          console.log(`    ! failed to upload ${filePath}: ${uploadError.message}`);
          totalSkippedUploadError++;
          continue;
        }

        const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

        const { error: updateError } = await supabase
          .from("cards")
          .update({ image_url: publicUrlData.publicUrl })
          .eq("id", card.id)
          .eq("language", "en");

        if (updateError) {
          console.log(`    ! failed to update ${card.id}: ${updateError.message}`);
          totalSkippedUploadError++;
          continue;
        }

        filledThisSet++;
        totalUploaded++;
        if (matchedByName) filledByNameFallback++;
      } catch (err) {
        console.log(`    ! error processing ${filePath}: ${(err as Error).message}`);
        totalSkippedUploadError++;
      }
    }

    const nameFallbackNote = filledByNameFallback
      ? ` (${filledByNameFallback} matched by name, not number — spot-check these)`
      : "";
    const ambiguousNote = skippedAmbiguousName ? `, ${skippedAmbiguousName} skipped as ambiguous by name` : "";
    console.log(
      `  ${setName} -> "${path.basename(files[0] ? path.dirname(files[0]) : "")}": filled ${filledThisSet}/${cards.length}${nameFallbackNote}${ambiguousNote}`
    );
  });

  console.log(`\nDone. Uploaded and filled ${totalUploaded} image(s).`);
  console.log(`Skipped — no matching archive folder found: ${totalSkippedNoFolderMatch}`);
  console.log(`Skipped — folder matched, but this specific card number didn't: ${totalSkippedNoFileMatch}`);
  console.log(`Skipped — upload or database error: ${totalSkippedUploadError}`);
  console.log(
    "Anything still skipped after this and scripts/backfill-images.ts genuinely isn't available on any source checked so far."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
