// Recompresses every image already sitting in the "card-images" Supabase
// Storage bucket, IN PLACE — same bucket, same storage path, same public
// URL, just fewer bytes. Exists to claw back Storage usage for free when the
// bucket is approaching (or over) the free-tier cap, without needing any
// original source URL and without re-doing any of the manual/automated
// backfill work already done — every backfill script in this codebase
// (backfill-images-manual.ts, backfill-images-cn-manual.ts,
// backfill-images-from-archive.ts, backfill-images-cn-krystalkollectz.ts)
// uploads to this same bucket, and none of them record the original source
// URL anywhere reusable, so "just hotlink instead" only helps FUTURE
// uploads (see those scripts' own headers) — it can't shrink what's already
// there. This script is the free lever for the bytes already in Storage.
//
// What it does, per object in the bucket:
//   1. Downloads it.
//   2. If it's already WebP AND already at or under MAX_DIMENSION on its
//      longer edge, leaves it alone — nothing to gain.
//   3. Otherwise, re-encodes it as WebP (quality WEBP_QUALITY), downscaling
//      only if the longer edge exceeds MAX_DIMENSION. Never upscales.
//   4. Only re-uploads (upsert, same storage path) if the new bytes are
//      meaningfully smaller (see MIN_SAVINGS_RATIO) than the original —
//      guards against ever making a file BIGGER or re-uploading for a
//      trivial saving.
//   5. Content-Type is set explicitly to "image/webp" on upload regardless
//      of the storage path's own extension (e.g. a path ending in .png can
//      legitimately hold WebP bytes) — Supabase Storage serves whatever
//      Content-Type was set at upload time, and browsers decode by that
//      header, not by the URL's extension. The app's own <Image> usage
//      (src/components/CardImageLightbox.tsx) renders with `unoptimized`,
//      i.e. a plain <img src=...>, so this is safe.
//
// MAX_DIMENSION default (see below) was picked by checking the app's own
// display sizes, not guessed: card thumbnails render at a fixed 200x280
// (CardImageLightbox.tsx `<Image width={200} height={280} .../>`), and the
// only larger view is the same component's fullscreen lightbox, which caps
// at `h-[85vh] max-w-[85vw]` — comfortably covered by an 800px longer edge
// on any screen up to a natural 4K-ish display before it would ever be
// upscaled past source resolution. No page in this app requests print-res
// or a bigger crop than that.
//
// This is a LOSSY, ONE-WAY operation — re-encoding at a lower quality can't
// be un-done from the resulting bytes alone. Defaults to DRY RUN (reports
// what it would do and the total savings, writes nothing). Pass --apply to
// actually upload. Strongly recommended: run without --apply first, read
// the summary, then re-run with --apply once the numbers look right.
//
// Usage:
//   npx tsx scripts/recompress-storage-images.ts              (dry run)
//   npx tsx scripts/recompress-storage-images.ts --apply       (writes)
//   npx tsx scripts/recompress-storage-images.ts --apply --prefix zh-cn/manual   (scope to one folder)
//
// Requires the `sharp` package (added to package.json dependencies) — run
// `npm install` first if it's not already present in node_modules.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const STORAGE_BUCKET = "card-images";

// Longer edge, in pixels, that any recompressed image is capped at. See the
// header comment above for how this was derived from actual app display
// sizes rather than picked arbitrarily.
const MAX_DIMENSION = 800;

// WebP quality (0-100). 82 is a conservative pick — visually
// indistinguishable from source at this app's display sizes, while still
// giving WebP's real advantage over the PNG/JPEG most of these were
// uploaded as.
const WEBP_QUALITY = 82;

// Only keep a recompression if it saves at least this fraction of the
// original bytes. Guards against re-uploading (and burning a write) for a
// few-percent saving that isn't worth the churn.
const MIN_SAVINGS_RATIO = 0.1;

type StorageEntry = { path: string; sizeBytes: number };

// Supabase Storage's `.list()` only returns one directory level at a time
// (same PostgREST-style pagination lesson as every other script here, just
// for the Storage API instead of the DB) — recurse into subfolders
// ourselves to get a flat list of every real file in the bucket.
async function listAllObjects(
  supabase: SupabaseClient,
  prefix: string,
): Promise<StorageEntry[]> {
  const results: StorageEntry[] = [];
  const PAGE_SIZE = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(`Failed to list "${prefix || "/"}": ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase distinguishes files from "folders" by `id` being null on
      // folder placeholder entries.
      if (entry.id === null) {
        const nested = await listAllObjects(supabase, entryPath);
        results.push(...nested);
      } else {
        results.push({ path: entryPath, sizeBytes: entry.metadata?.size ?? 0 });
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return results;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in.",
    );
  }

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const prefixArgIndex = args.indexOf("--prefix");
  const scopePrefix = prefixArgIndex !== -1 ? args[prefixArgIndex + 1] ?? "" : "";

  const supabase = createClient(url, serviceKey);

  console.log(`Listing objects in "${STORAGE_BUCKET}"${scopePrefix ? ` under "${scopePrefix}"` : ""}...`);
  const objects = await listAllObjects(supabase, scopePrefix);
  console.log(`Found ${objects.length} objects.\n`);

  if (!apply) {
    console.log("DRY RUN — no files will be modified. Pass --apply to actually recompress and upload.\n");
  }

  let processed = 0;
  let skippedAlreadyOptimal = 0;
  let skippedNotEnoughSavings = 0;
  let errors = 0;
  let totalOriginalBytes = 0;
  let totalNewBytes = 0; // for objects that WOULD be / WERE recompressed

  for (const obj of objects) {
    processed++;
    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(obj.path);

      if (downloadError || !blob) {
        console.log(`  ! failed to download ${obj.path}: ${downloadError?.message ?? "no data"}`);
        errors++;
        continue;
      }

      const originalBuffer = Buffer.from(await blob.arrayBuffer());
      const originalSize = originalBuffer.byteLength;

      const meta = await sharp(originalBuffer).metadata();
      const longerEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
      const alreadyWebp = meta.format === "webp";

      if (alreadyWebp && longerEdge > 0 && longerEdge <= MAX_DIMENSION) {
        skippedAlreadyOptimal++;
        totalOriginalBytes += originalSize;
        totalNewBytes += originalSize;
        continue;
      }

      let pipeline = sharp(originalBuffer);
      if (longerEdge > MAX_DIMENSION) {
        pipeline = pipeline.resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      const newBuffer = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
      const newSize = newBuffer.byteLength;

      const savingsRatio = originalSize > 0 ? 1 - newSize / originalSize : 0;

      if (savingsRatio < MIN_SAVINGS_RATIO) {
        skippedNotEnoughSavings++;
        totalOriginalBytes += originalSize;
        totalNewBytes += originalSize;
        continue;
      }

      totalOriginalBytes += originalSize;
      totalNewBytes += newSize;

      console.log(
        `  ${apply ? "recompressing" : "would recompress"} ${obj.path}: ${formatBytes(originalSize)} -> ${formatBytes(newSize)} (-${(savingsRatio * 100).toFixed(0)}%)`,
      );

      if (apply) {
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(obj.path, newBuffer, { contentType: "image/webp", upsert: true });

        if (uploadError) {
          console.log(`  ! failed to upload ${obj.path}: ${uploadError.message}`);
          errors++;
        }
      }
    } catch (err) {
      console.log(`  ! error processing ${obj.path}: ${err instanceof Error ? err.message : String(err)}`);
      errors++;
    }

    if (processed % 100 === 0) {
      console.log(`  ...${processed}/${objects.length} processed`);
    }
  }

  console.log(`\n${apply ? "Recompression complete." : "Dry run complete."}`);
  console.log(`Objects scanned: ${objects.length}`);
  console.log(`Already optimal (webp, <= ${MAX_DIMENSION}px): ${skippedAlreadyOptimal}`);
  console.log(`Skipped — savings under ${(MIN_SAVINGS_RATIO * 100).toFixed(0)}%: ${skippedNotEnoughSavings}`);
  console.log(`Errors: ${errors}`);
  console.log(
    `Total: ${formatBytes(totalOriginalBytes)} -> ${formatBytes(totalNewBytes)} (${totalOriginalBytes > 0 ? (((1 - totalNewBytes / totalOriginalBytes) * 100).toFixed(1)) : "0"}% reduction${apply ? "" : " if applied"})`,
  );

  if (!apply) {
    console.log(`\nRe-run with --apply to actually recompress and upload.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
