// Backfills `cards.image_url` for Simplified Chinese (zh-cn) cards from a
// folder of hand-sourced images — the zh-cn counterpart to
// scripts/backfill-images-manual.ts (English), built after
// scripts/backfill-images-cn.ts (the 52poke.com wiki source) hit a real,
// confirmed wall: the wiki genuinely doesn't have images uploaded for most
// of the ~9,000 still-missing zh-cn cards, and the two other candidate
// sources checked (TCG Collector, the official Asia/mainland China Pokémon
// sites) are either blocked by Cloudflare bot protection or don't carry
// Simplified Chinese card images at all. See the 2026-08-26 investigation
// notes in the project spec doc for the full trail. This script exists so
// Ross can close the gap by hand, at whatever pace he wants, using images he
// sources himself (his own scans, or anything he can legitimately save while
// browsing normally — this script only handles the "get it into the
// database" half, never the collection itself).
//
// Usage:
//   npm run backfill:images-cn-manual
//
// Point MANUAL_CN_IMAGES_PATH (see .env.example) at a folder structured like
// this — one subfolder per DB set_id (NOT the display set name — use the
// exact code from the "Across N set(s)" breakdown that
// `npm run report:missing-images` prints, e.g. "CS1aC", "SV-P", "CSM2DC"),
// each containing image files named just the card number:
//
//   <MANUAL_CN_IMAGES_PATH>/
//     CS1aC/
//       1.jpg
//       2.png
//       217.jpg
//     SV-P/
//       402.jpg
//
// No prefix, no card name, no zero-padding needed in the filename — the
// subfolder already says which set, and card numbers are normalized the same
// way scripts/backfill-images-manual.ts does (strips leading zeros, keeps
// any letter prefix/suffix). This is deliberately the simplest possible
// convention, unlike the English manual script's four legacy conventions —
// those exist because Ross had pre-existing files from scattered sources
// with inconsistent naming; here there's no pre-existing convention to match,
// so we get to define an easy one up front.
//
// Same safety policy as every other backfill script here: only ever writes a
// row that's still missing an image AND has exactly one unambiguous DB match
// for that (set_id, card_number) pair. Zero matches or more than one match is
// logged and skipped, never guessed. Images are uploaded to the same
// "card-images" Supabase Storage bucket the English manual script uses
// (created if it doesn't exist yet), under a zh-cn/manual/<set_id>/ prefix so
// filenames from different sets never collide.
//
// Prioritization is entirely up to Ross — there's no requirement to do every
// set or every card. The biggest sets by missing-card count (from the
// 2026-08-26 report) are the best return on time: CS4DaC (408), CSM2DC
// (406), SV-P (402), CSM1DC (382), SV8a (253), S-P (250), CS1DC (230),
// CSV10C (222), CS1aC (217) — doing just those 9 would close ~2,800 of the
// ~8,970 missing zh-cn images. Re-run this script any time after adding more
// images to the folder; it only ever touches rows still missing an image.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "card-images";
const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp)$/i;

type CardRow = { id: string; set_id: string; card_number: string; name: string };

type Parsed = { filePath: string; setId: string; cardNumber: string; storageName: string };

// Same normalization as backfill-images-manual.ts — strips leading zeros,
// keeps any letter prefix/suffix, so "001", "1", and "1a" all resolve
// predictably against whatever's actually stored in card_number.
function normalizeCardNumber(number: string): string {
  const match = number.match(/^([a-zA-Z]*)0*(\d+)([a-zA-Z]*)$/);
  if (!match) return number.toUpperCase().trim();
  const [, prefix, digits, suffix] = match;
  return `${prefix.toUpperCase()}${digits}${suffix.toUpperCase()}`;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

// Same 1000-row PostgREST cap fix as every other script here.
async function fetchAllMissingCards(supabase: SupabaseClient, setIds: string[]): Promise<CardRow[]> {
  const PAGE_SIZE = 1000;
  const all: CardRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, set_id, card_number, name")
      .eq("language", "zh-cn")
      .is("image_url", null)
      .in("set_id", setIds)
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
  const folderPath = process.env.MANUAL_CN_IMAGES_PATH;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in."
    );
  }
  if (!folderPath) {
    throw new Error(
      "Missing MANUAL_CN_IMAGES_PATH in .env.local — set it to the folder of hand-sourced zh-cn card images (see this script's header comment for the required folder structure)."
    );
  }
  if (!fs.existsSync(folderPath)) {
    throw new Error(`MANUAL_CN_IMAGES_PATH does not exist on disk: ${folderPath}`);
  }

  const supabase = createClient(url, serviceKey);

  console.log(`Ensuring Supabase Storage bucket "${STORAGE_BUCKET}" exists...`);
  const { error: bucketError } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
  if (bucketError && !/already exists/i.test(bucketError.message)) {
    throw new Error(`Failed to create/verify storage bucket: ${bucketError.message}`);
  }

  const topLevel = fs.readdirSync(folderPath, { withFileTypes: true });
  const subfolders = topLevel.filter((e) => e.isDirectory());

  if (subfolders.length === 0) {
    console.log(
      `No subfolders found directly in ${folderPath}. Every set needs its own subfolder named after its set_id — see this script's header comment.`
    );
    return;
  }

  const parsed: Parsed[] = [];

  for (const dirent of subfolders) {
    const setId = dirent.name; // matched exactly, case-sensitive — zh-cn set_ids are case-sensitive (e.g. "CS1aC" vs "CS1AC" are different real codes)
    const subfolderPath = path.join(folderPath, dirent.name);
    const subfolderFiles = fs
      .readdirSync(subfolderPath, { withFileTypes: true })
      .filter((e) => e.isFile() && IMAGE_EXTENSION_RE.test(e.name));

    for (const fileEntry of subfolderFiles) {
      const filename = fileEntry.name;
      const rawNumber = path.basename(filename, path.extname(filename));
      parsed.push({
        filePath: path.join(subfolderPath, filename),
        setId,
        cardNumber: normalizeCardNumber(rawNumber),
        storageName: `${setId}_${filename}`,
      });
    }
    console.log(`  ${dirent.name}/: ${subfolderFiles.length} image(s) found`);
  }

  if (parsed.length === 0) {
    console.log("\nNo image files found in any subfolder — nothing to do.");
    return;
  }

  const setIds = Array.from(new Set(parsed.map((p) => p.setId)));
  console.log(`\nFetching still-missing zh-cn cards for set_id(s): ${setIds.join(", ")}...`);
  const missingCards = await fetchAllMissingCards(supabase, setIds);
  console.log(`${missingCards.length} card(s) still missing an image across those set(s)\n`);

  const cardsByKey = new Map<string, CardRow[]>();
  for (const card of missingCards) {
    const key = `${card.set_id}::${normalizeCardNumber(card.card_number)}`;
    cardsByKey.set(key, [...(cardsByKey.get(key) ?? []), card]);
  }

  let totalUploaded = 0;
  let totalSkippedAlreadyFilled = 0;
  let totalSkippedAmbiguous = 0;
  let totalSkippedUploadError = 0;

  for (const { filePath, setId, cardNumber, storageName } of parsed) {
    const label = path.basename(filePath);
    const key = `${setId}::${cardNumber}`;
    const matchLabel = `${setId} #${cardNumber}`;
    const candidates = cardsByKey.get(key);

    if (!candidates || candidates.length === 0) {
      console.log(
        `  ! "${setId}/${label}" -> ${matchLabel}: no still-missing DB row matches (already filled, or set_id/number is wrong — double-check the subfolder name against the exact set_id from report:missing-images)`
      );
      totalSkippedAlreadyFilled++;
      continue;
    }
    if (candidates.length > 1) {
      console.log(`  ! "${setId}/${label}" -> ${matchLabel}: ${candidates.length} DB rows match, ambiguous — skipped`);
      totalSkippedAmbiguous++;
      continue;
    }

    const card = candidates[0];

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const storagePath = `zh-cn/manual/${storageName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, fileBuffer, { contentType: guessContentType(filePath), upsert: true });

      if (uploadError) {
        console.log(`    ! failed to upload ${setId}/${label}: ${uploadError.message}`);
        totalSkippedUploadError++;
        continue;
      }

      const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

      const { error: updateError } = await supabase
        .from("cards")
        .update({ image_url: publicUrlData.publicUrl })
        .eq("id", card.id)
        .eq("language", "zh-cn");

      if (updateError) {
        console.log(`    ! failed to update ${card.id}: ${updateError.message}`);
        totalSkippedUploadError++;
        continue;
      }

      console.log(`  ${setId}/${label} -> ${setId} #${card.card_number} (${card.name}): filled`);
      totalUploaded++;
    } catch (err) {
      console.log(`    ! error processing ${setId}/${label}: ${(err as Error).message}`);
      totalSkippedUploadError++;
    }
  }

  console.log(`\nDone. Filled ${totalUploaded} image(s).`);
  console.log(`Skipped — already filled or no still-missing row matched: ${totalSkippedAlreadyFilled}`);
  console.log(`Skipped — ambiguous (more than one DB row matched): ${totalSkippedAmbiguous}`);
  console.log(`Skipped — upload or database error: ${totalSkippedUploadError}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
