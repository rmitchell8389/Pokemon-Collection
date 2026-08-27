// Shared guard against a real data-loss bug found and fixed 2026-08-27
// (see claude/spec.md's "zh-cn round 18 continued" for the full incident):
// scripts/import-cn-dynamax-clash.ts's --commit run wiped image_url back to
// null for 1,426 cards across 8 sets that had already been through the
// manual-image-backfill workflow.
//
// Root cause: every card importer in this project upserts full row objects
// against `.upsert(rows, { onConflict: "id,language" })`. Postgres' ON
// CONFLICT DO UPDATE overwrites every column PRESENT in the payload — so a
// row whose own source (a wiki scrape, TCGdex, whatever) doesn't know a
// card's image, and therefore builds `image_url: null`, silently erases any
// real image a different pipeline (the manual backfill workflow) had
// already filled in for that same row id.
//
// Fix: strip `image_url` out of the payload entirely whenever a row doesn't
// carry a real value. An OMITTED column is left untouched by ON CONFLICT DO
// UPDATE — existing data survives — while a row that DOES carry a real,
// freshly-verified image_url (Gem Packs, reprint-pattern imports, JP
// Limitless, TCGdex sync) still writes it through normally. This mirrors
// the pattern sync-cards.ts's own author already used for price_* fields
// (see that script's `priceFields` comment) — just generalized to every
// script that upserts into `cards`.
//
// Usage: call this on the row array immediately before every
// `.upsert(rows, ...)` and every per-row retry `.upsert(row, ...)` against
// the `cards` table. Safe to call on rows that already have no image_url
// key at all.
export function stripUnsetImageUrl<T extends { image_url?: string | null }>(
  row: T
): Omit<T, "image_url"> & { image_url?: string } {
  if (row.image_url) return row as Omit<T, "image_url"> & { image_url?: string };
  const { image_url: _drop, ...rest } = row;
  return rest as Omit<T, "image_url"> & { image_url?: string };
}

export function stripUnsetImageUrls<T extends { image_url?: string | null }>(
  rows: T[]
): (Omit<T, "image_url"> & { image_url?: string })[] {
  return rows.map(stripUnsetImageUrl);
}
