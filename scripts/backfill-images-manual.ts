// Backfills `cards.image_url` from a small folder of hand-picked card scans
// Ross sources himself for the cards that scripts/backfill-images.ts
// (pokemontcg.io) and scripts/backfill-images-from-archive.ts (the big
// scraped archive) genuinely can't cover — e.g. Celebrations Classic
// Collection's Reshiram/Zekrom (real name collision with the base
// Celebrations set, unsolvable by matching alone) or MEP Black Star Promos
// cards past where the archive's scans stop. Those two scripts exhaust
// what's automatable; this one exists for the deliberate, one-at-a-time
// exceptions on top.
//
// Usage:
//   npm run backfill:images-manual
//
// Point MANUAL_CARD_IMAGES_PATH (see .env.example) at a folder of image
// files. Four naming conventions are recognized, tried in this order:
//
//   1. "<SET_PREFIX>_<CARD_NUMBER>_....<ext>", e.g. "CEL_CC20_R_EN.png" or
//      "MEP_013_R_EN.png" — TCG Collector's own asset naming convention.
//      Everything after the second underscore is ignored. Add new prefixes
//      to SET_PREFIXES below as they show up.
//   2. "<Name>MyFirstBattle.<ext>" (optionally "1024px-<Name>MyFirstBattle.<ext>",
//      a Bulbapedia thumbnail naming quirk), e.g. "Bulbasaur​MyFirstBattle.jpg"
//      or "GrassEnergyMyFirstBattle.jpg" — the "My First Battle" promo set,
//      matched by Pokémon/Energy/Trainer name (that set doesn't put numbers
//      in its own filenames anywhere Ross found them). Matched by comparing
//      the captured name and the DB `name` column with spaces/punctuation
//      stripped, so multi-word names like "Grass Energy" line up with
//      "GrassEnergy" automatically — no name list to maintain here.
//   3. "<Name>CreatorContest<N>.<ext>", e.g. "PikachuCreatorContest7.png" —
//      the "Poké Card Creator Pack" set, matched by the embedded number (the
//      name prefix is decorative and ignored, same as convention 1).
//   4. Exact one-off filenames in MANUAL_OVERRIDES, for scans whose filenames
//      don't encode the set/number in any parseable way at all (identified
//      by hand, visually, against the real card) — add an entry there rather
//      than trying to make the regexes above cover a single weird file.
//
// There's also a faster path for sourcing a whole set at once (added
// 2026-08-19 after doing McDonald's Collection 2024 one filename at a time):
// make a subfolder inside MANUAL_CARD_IMAGES_PATH named after an entry in
// SUBFOLDER_SETS below (e.g. "mcd2014/"), and drop images in it named just
// the card number — "1.jpg", "2.jpg", "12.png", whatever the extension.
// No prefix, no card name needed, since the folder itself already says which
// set. Meant for exactly this situation: TCGplayer (or similar) shows a full
// price-guide grid for a set in card-number order, so saving each thumbnail
// and typing a bare number as you go is close to as fast as this gets
// without scraping the page outright — which isn't available from here (no
// live browser/JS-rendering access in this environment, and TCGplayer's
// price-guide pages don't render without JavaScript, so a plain fetch can't
// read them either).
//
// Same safety policy as the other two backfill scripts: only ever writes a
// row that's still missing an image AND has exactly one unambiguous DB
// match for that (set, number-or-name) pair. Zero matches or more than one
// match is logged and skipped, never guessed.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "card-images";
const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp)$/i;

// Convention 1: "<PREFIX>_<NUMBER>_....<ext>"
const PREFIX_NUMBER_RE = /^([A-Za-z]+)_([A-Za-z0-9]+)(?:_.*)?\.(jpe?g|png|webp)$/i;

// Convention 2: "<Name>MyFirstBattle.<ext>", possibly "1024px-" prefixed
// (that prefix is how Bulbapedia names its thumbnail renditions).
const MY_FIRST_BATTLE_RE = /^(?:\d+px-)?([A-Za-z]+)MyFirstBattle\.(jpe?g|png|webp)$/i;
const MY_FIRST_BATTLE_SET_NAME = "My First Battle";

// Convention 3: "<Name>CreatorContest<N>.<ext>"
const CREATOR_CONTEST_RE = /^([A-Za-z]+)CreatorContest(\d+)\.(jpe?g|png|webp)$/i;
const CREATOR_CONTEST_SET_NAME = "Poké Card Creator Pack";

// Convention 5: "<Name><CODE>Promo<N>.<ext>", e.g. "EeveeSMPromo184.jpg" or
// "KingdraXYPromo39.jpg" — a second, unrelated hand-sourced naming style for
// Black Star Promos (name prefix decorative/ignored, same as conventions 1
// and 3). CODE maps into PROMO_CODES below.
const PROMO_NAME_RE = /^[A-Za-z]+(SM|XY)Promo(\d+)\.(jpe?g|png|webp)$/i;

// Some Black Star Promo eras print the era code as *part of* the card's
// actual number (e.g. Sun & Moon promos are numbered "SM01"..."SM252" on the
// card itself, not bare "01"), so the DB's card_number column has that
// prefix baked in too — unlike MEP/SVP/Creator Pack, which are plain digits.
// numberPrefix, when set, gets prepended before normalizeCardNumber() so the
// match key lines up. SET_PREFIXES entries and PROMO_NAME_RE's PROMO_CODES
// both consult this — same set, two different filename conventions Ross has
// run into.
type SetInfo = { setName: string; numberPrefix?: string };

// Add an entry here for every new SET_PREFIX these hand-picked files use
// (convention 1). Keys are matched case-insensitively against the
// filename's prefix.
const SET_PREFIXES: Record<string, SetInfo> = {
  CEL: { setName: "Celebrations Classic Collection" },
  MEP: { setName: "MEP Black Star Promos" },
  SMP: { setName: "SM Black Star Promos", numberPrefix: "SM" },
  SVP: { setName: "SVP Black Star Promos" },
};

// Add an entry here for every new promo-code this hand-picked-filename
// convention (5) uses. NOTE: numberPrefix is an unverified best guess
// (SM/XY Black Star Promos are officially numbered with the era code baked
// into the print, e.g. "SM89", so that's what's assumed here) — if a run
// reports these as "no still-missing DB row matches" when you know they
// should hit, the fix is to check the real cards.card_number value for that
// set via SQL and adjust/remove numberPrefix here accordingly. A wrong
// guess here only ever causes a safe skip, never a wrong write, since it's
// scoped to (this exact set name, this exact number) with the same
// single-unambiguous-match check as everything else.
const PROMO_CODES: Record<string, SetInfo> = {
  SM: { setName: "SM Black Star Promos", numberPrefix: "SM" },
  XY: { setName: "XY Black Star Promos", numberPrefix: "XY" },
};

// Subfolder-per-set convention (see header comment). Keys are subfolder
// names, matched case-insensitively. Every image file directly inside one of
// these folders is treated as "the card numbered <filename-without-extension>
// in <setName>" — no filename parsing beyond stripping the extension.
const SUBFOLDER_SETS: Record<string, SetInfo> = {
  mcd2014: { setName: "McDonald's Collection 2014" },
  mcd2015: { setName: "McDonald's Collection 2015" },
  mcd2017: { setName: "McDonald's Collection 2017" },
  mcd2018: { setName: "McDonald's Collection 2018" },
};

// Convention 4: exact filenames (matched case-insensitively) that don't fit
// any pattern above — identified by hand against the real card image.
const MANUAL_OVERRIDES: Record<string, { setName: string; cardNumber: string }> = {
  "terapagosfriendssvppromo.jpg": { setName: "SVP Black Star Promos", cardNumber: "500" },
  // Visually confirmed: Pikachu, "Scrappy Spark", World Championships 2025
  // logo, "SVP EN 225" stamp printed on the card itself.
  "648631_in_1000x1000.webp": { setName: "SVP Black Star Promos", cardNumber: "225" },

  // McDonald's Collection 2024 — Ross sourced all 15 himself after this set
  // was written off as a dead end (see spec doc, pre-2026-08-19). Visually
  // confirmed 001/015 (Charizard) and 009/015 (Umbreon): correct M24EN
  // stamp, correct "©2024 Pokémon/Nintendo/Creatures/GAME FREAK" line, real
  // illustrator credits — these are legitimate fronts, not another
  // pokemontcg.io back-image situation. Filenames set the number; matched
  // by number only (not name), so a mismatched Pokémon name in the filename
  // is harmless as long as the number's right.
  "mcd2024_001_charizard.jpg": { setName: "McDonald's Collection 2024", cardNumber: "1" },
  "mcd2024_002_pikachu.jpg": { setName: "McDonald's Collection 2024", cardNumber: "2" },
  "mcd2024_003_miraidon.jpg": { setName: "McDonald's Collection 2024", cardNumber: "3" },
  "mcd2024_004_jigglypuff.jpg": { setName: "McDonald's Collection 2024", cardNumber: "4" },
  "mcd2024_005_hatenna.jpg": { setName: "McDonald's Collection 2024", cardNumber: "5" },
  "mcd2024_006_dragapult.jpg": { setName: "McDonald's Collection 2024", cardNumber: "6" },
  "mcd2024_007_quagsire.jpg": { setName: "McDonald's Collection 2024", cardNumber: "7" },
  "mcd2024_008_koraidon.jpg": { setName: "McDonald's Collection 2024", cardNumber: "8" },
  "mcd2024_009_umbreon.jpg": { setName: "McDonald's Collection 2024", cardNumber: "9" },
  "mcd2024_010_hydreigon.jpg": { setName: "McDonald's Collection 2024", cardNumber: "10" },
  "mcd2024_011_roaring_moon.jpg": { setName: "McDonald's Collection 2024", cardNumber: "11" },
  "mcd2024_012_dragonite.jpg": { setName: "McDonald's Collection 2024", cardNumber: "12" },
  "mcd2024_013_eevee.jpg": { setName: "McDonald's Collection 2024", cardNumber: "13" },
  "mcd2024_014_rayquaza.jpg": { setName: "McDonald's Collection 2024", cardNumber: "14" },
  "mcd2024_015_drampa.jpg": { setName: "McDonald's Collection 2024", cardNumber: "15" },
};

type CardRow = { id: string; set_name: string; card_number: string; name: string };

type MatchKey =
  | { kind: "number"; setName: string; number: string }
  | { kind: "name"; setName: string; name: string };

// storageName is what gets used as both the log label and the Supabase
// Storage object name. Defaults to the bare filename for flat files; for
// subfolder-sourced files it's prefixed with the folder name so "1.jpg" in
// both mcd2014/ and mcd2015/ don't collide in storage.
type Parsed = { filePath: string; matchKey: MatchKey; storageName: string };

function normalizeCardNumber(number: string): string {
  const match = number.match(/^([a-zA-Z]*)0*(\d+)([a-zA-Z]*)$/);
  if (!match) return number.toUpperCase().trim();
  const [, prefix, digits, suffix] = match;
  return `${prefix.toUpperCase()}${digits}${suffix.toUpperCase()}`;
}

// Used for name-based matching (convention 2) — strips everything but
// letters/digits and lowercases, so "Grass Energy" and "GrassEnergy" (or
// "grass-energy.jpg") all collapse to the same key.
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function parseFilename(filename: string): MatchKey | null {
  const lower = filename.toLowerCase();
  const override = MANUAL_OVERRIDES[lower];
  if (override) {
    return { kind: "number", setName: override.setName, number: normalizeCardNumber(override.cardNumber) };
  }

  const prefixNumberMatch = filename.match(PREFIX_NUMBER_RE);
  if (prefixNumberMatch) {
    const [, prefix, number] = prefixNumberMatch;
    const setInfo = SET_PREFIXES[prefix.toUpperCase()];
    if (setInfo) {
      const fullNumber = (setInfo.numberPrefix ?? "") + number;
      return { kind: "number", setName: setInfo.setName, number: normalizeCardNumber(fullNumber) };
    }
    // Known convention, unknown prefix — fall through so the caller can
    // report the more specific "unknown prefix" message instead of a bare
    // no-match.
    return null;
  }

  const myFirstBattleMatch = filename.match(MY_FIRST_BATTLE_RE);
  if (myFirstBattleMatch) {
    const [, name] = myFirstBattleMatch;
    return { kind: "name", setName: MY_FIRST_BATTLE_SET_NAME, name: normalizeName(name) };
  }

  const creatorContestMatch = filename.match(CREATOR_CONTEST_RE);
  if (creatorContestMatch) {
    const [, , number] = creatorContestMatch;
    return { kind: "number", setName: CREATOR_CONTEST_SET_NAME, number: normalizeCardNumber(number) };
  }

  const promoNameMatch = filename.match(PROMO_NAME_RE);
  if (promoNameMatch) {
    const [, code, number] = promoNameMatch;
    const setInfo = PROMO_CODES[code.toUpperCase()];
    if (setInfo) {
      const fullNumber = (setInfo.numberPrefix ?? "") + number;
      return { kind: "number", setName: setInfo.setName, number: normalizeCardNumber(fullNumber) };
    }
    return null;
  }

  return null;
}

// Same 1000-row PostgREST cap fix as the other two scripts — see their
// header comments for the real incident that found this.
async function fetchAllMissingCards(supabase: SupabaseClient, setNames: string[]): Promise<CardRow[]> {
  const PAGE_SIZE = 1000;
  const all: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, set_name, card_number, name")
      .eq("language", "en")
      .is("image_url", null)
      .in("set_name", setNames)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load missing-image cards: ${error.message}`);
    if (!data || data.length === 0) break;

    all.push(...(data as CardRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const folderPath = process.env.MANUAL_CARD_IMAGES_PATH;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in."
    );
  }
  if (!folderPath) {
    throw new Error(
      "Missing MANUAL_CARD_IMAGES_PATH in .env.local — set it to the folder of hand-picked card images."
    );
  }
  if (!fs.existsSync(folderPath)) {
    throw new Error(`MANUAL_CARD_IMAGES_PATH does not exist on disk: ${folderPath}`);
  }

  const supabase = createClient(url, serviceKey);

  console.log(`Ensuring Supabase Storage bucket "${STORAGE_BUCKET}" exists...`);
  const { error: bucketError } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
  if (bucketError && !/already exists/i.test(bucketError.message)) {
    throw new Error(`Failed to create/verify storage bucket: ${bucketError.message}`);
  }

  const topLevel = fs.readdirSync(folderPath, { withFileTypes: true });

  const files = topLevel
    .filter((e) => e.isFile() && IMAGE_EXTENSION_RE.test(e.name))
    .map((e) => path.join(folderPath, e.name));

  const subfolders = topLevel.filter((e) => e.isDirectory());

  console.log(
    `Found ${files.length} image file(s) directly in ${folderPath}, plus ${subfolders.length} subfolder(s)`
  );

  const parsed: Parsed[] = [];
  let totalSkippedNoMatch = 0;

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const matchKey = parseFilename(filename);
    if (!matchKey) {
      const prefixNumberMatch = filename.match(PREFIX_NUMBER_RE);
      if (prefixNumberMatch) {
        console.log(
          `  ! "${filename}" has unknown prefix "${prefixNumberMatch[1]}" — add it to SET_PREFIXES in this script`
        );
      } else {
        console.log(`  ! "${filename}" doesn't match any known naming convention — skipped`);
      }
      totalSkippedNoMatch++;
      continue;
    }
    parsed.push({ filePath, matchKey, storageName: filename });
  }

  for (const dirent of subfolders) {
    const setInfo = SUBFOLDER_SETS[dirent.name.toLowerCase()];
    if (!setInfo) {
      console.log(`  ! subfolder "${dirent.name}" doesn't match any entry in SUBFOLDER_SETS — skipped entirely`);
      continue;
    }

    const subfolderPath = path.join(folderPath, dirent.name);
    const subfolderFiles = fs
      .readdirSync(subfolderPath, { withFileTypes: true })
      .filter((e) => e.isFile() && IMAGE_EXTENSION_RE.test(e.name));

    for (const fileEntry of subfolderFiles) {
      const filename = fileEntry.name;
      const rawNumber = path.basename(filename, path.extname(filename));
      const fullNumber = (setInfo.numberPrefix ?? "") + rawNumber;
      parsed.push({
        filePath: path.join(subfolderPath, filename),
        matchKey: { kind: "number", setName: setInfo.setName, number: normalizeCardNumber(fullNumber) },
        storageName: `${dirent.name}_${filename}`,
      });
    }
    console.log(`  ${dirent.name}/ -> ${setInfo.setName}: ${subfolderFiles.length} image(s) found`);
  }

  if (parsed.length === 0) {
    console.log("Nothing recognized — nothing to do.");
    return;
  }

  const setNames = Array.from(new Set(parsed.map((p) => p.matchKey.setName)));
  console.log(`\nFetching still-missing cards for: ${setNames.join(", ")}...`);
  const missingCards = await fetchAllMissingCards(supabase, setNames);
  console.log(`${missingCards.length} card(s) still missing an image across those set(s)`);

  const cardsByNumberKey = new Map<string, CardRow[]>();
  const cardsByNameKey = new Map<string, CardRow[]>();
  for (const card of missingCards) {
    const numberKey = `${card.set_name}::${normalizeCardNumber(card.card_number)}`;
    cardsByNumberKey.set(numberKey, [...(cardsByNumberKey.get(numberKey) ?? []), card]);

    const nameKey = `${card.set_name}::${normalizeName(card.name)}`;
    cardsByNameKey.set(nameKey, [...(cardsByNameKey.get(nameKey) ?? []), card]);
  }

  let totalUploaded = 0;
  let totalSkippedAlreadyFilled = 0;
  let totalSkippedAmbiguous = 0;
  let totalSkippedUploadError = 0;

  for (const { filePath, matchKey, storageName } of parsed) {
    const label = path.basename(filePath);
    const key = `${matchKey.setName}::${matchKey.kind === "number" ? matchKey.number : matchKey.name}`;
    const matchLabel =
      matchKey.kind === "number" ? `${matchKey.setName} #${matchKey.number}` : `${matchKey.setName} "${matchKey.name}"`;
    const candidates = matchKey.kind === "number" ? cardsByNumberKey.get(key) : cardsByNameKey.get(key);

    if (!candidates || candidates.length === 0) {
      console.log(
        `  ! "${label}" -> ${matchLabel}: no still-missing DB row matches (already filled, or set/number/name is wrong)`
      );
      totalSkippedAlreadyFilled++;
      continue;
    }
    if (candidates.length > 1) {
      console.log(`  ! "${label}" -> ${matchLabel}: ${candidates.length} DB rows match, ambiguous — skipped`);
      totalSkippedAmbiguous++;
      continue;
    }

    const card = candidates[0];

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const storagePath = `english/manual/${storageName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, fileBuffer, { contentType: guessContentType(filePath), upsert: true });

      if (uploadError) {
        console.log(`    ! failed to upload ${label}: ${uploadError.message}`);
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

      console.log(`  ${label} -> ${matchKey.setName} #${card.card_number} (${card.name}): filled`);
      totalUploaded++;
    } catch (err) {
      console.log(`    ! error processing ${label}: ${(err as Error).message}`);
      totalSkippedUploadError++;
    }
  }

  console.log(`\nDone. Filled ${totalUploaded} image(s).`);
  console.log(`Skipped — no matching naming convention on filename: ${totalSkippedNoMatch}`);
  console.log(`Skipped — already filled or no still-missing row matched: ${totalSkippedAlreadyFilled}`);
  console.log(`Skipped — ambiguous (more than one DB row matched): ${totalSkippedAmbiguous}`);
  console.log(`Skipped — upload or database error: ${totalSkippedUploadError}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
