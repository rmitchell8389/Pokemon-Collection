// Parses a real Dex (getdex.app) collection CSV export into normalized
// rows. Card/variant MATCHING lives in src/lib/csvCardMatching.ts — shared
// with every other source importer — this file is purely "turn Dex's real
// export bytes into NormalizedImportRow[]".
//
// Built entirely from a real export Ross uploaded (d5cceb33-dexcollection.csv,
// 2026-08-21) — NOT a guessed format, per this project's standing rule.
// Confirmed real structure:
//   - File is UTF-16LE WITH a BOM (\xff\xfe), semicolon-delimited, NOT the
//     UTF-8/comma-delimited shape you'd assume from "CSV". A naive UTF-8
//     read produces the classic "every other byte is null" garble.
//   - Header row (exact, confirmed byte-for-byte):
//       Type;Category;Locale;Series;Set;Id;Name;Variant;Rarity;Quantity;Price;Note 1;Note 2;Note 3;Note 4;Note 5
//   - `Id` is "<dex-set-code>-<card-number>", e.g. "sv7-41", "svp-132",
//     "sma-SV56", "swshp-SWSH144". Dex's own set-code prefix does NOT
//     reliably match our (TCGdex-sourced) `set_id` — confirmed real
//     mismatch: Dex says "sv7" for Stellar Crown, TCGdex's real id is
//     "sv07" (zero-padded). See csvCardMatching.ts for how this is handled
//     WITHOUT a hand-maintained mapping table.
//   - `Set` is a human display name. Also confirmed NOT reliable alone:
//     Dex's promo sets use simplified names ("Scarlet & Violet Promos")
//     that don't match TCGdex's real name ("SVP Black Star Promos") even
//     though the numbered main sets match exactly ("Stellar Crown" ==
//     "Stellar Crown"). This is why matching tries the id first.
//   - `Variant` is a free-text human label ("Holo", "Expansion Stamp",
//     "Jumbo (Expansion Stamp)", "Normal", "Play! Pokémon", "25th
//     Anniversary", full World Championships deck names). Dex's own
//     vocabulary for stamps/promos does NOT always match the vocabulary
//     src/lib/cardVariants.ts's labelVariant() produces from TCGdex's raw
//     data — see csvCardMatching.ts's matchVariant for how that's handled
//     honestly instead of guessing.
//   - `Quantity` is a real per-line-item integer. Confirmed Dex tracks each
//     print-variant as ITS OWN row with its own quantity — a row with
//     Quantity 0 means "on the wishlist / not owned", not "owned, zero
//     count". Only Quantity >= 1 rows should ever produce a
//     collection_entries write.
//   - Locale seen so far: "International" only (English). Non-English Dex
//     locales are NOT handled by this importer yet — not guessed at,
//     genuinely untested, see importDexCsv's per-row skip reason.

import type { NormalizedImportRow } from "./csvCardMatching";

const DEX_HEADER = [
  "Type",
  "Category",
  "Locale",
  "Series",
  "Set",
  "Id",
  "Name",
  "Variant",
  "Rarity",
  "Quantity",
  "Price",
  "Note 1",
  "Note 2",
  "Note 3",
  "Note 4",
  "Note 5",
] as const;

export interface DexRow {
  type: string;
  category: string;
  locale: string;
  series: string;
  set: string;
  id: string;
  name: string;
  variant: string;
  rarity: string;
  quantity: number;
  price: string;
}

export interface DexParseResult {
  rows: DexRow[];
  // 1-based line numbers (counting the header as line 1) that didn't split
  // into the expected column count — reported, not silently dropped.
  malformedLines: number[];
}

// Dex's real export is UTF-16LE with a BOM. Detect it explicitly rather
// than assuming — falls back to UTF-8 for any file that isn't (e.g. if
// Dex ever changes their export, or someone re-saves the file first), so
// this doesn't silently garble a differently-encoded file either.
export function decodeDexCsv(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le", 2);
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // Big-endian UTF-16 BOM — not seen in a real Dex export yet, but a
    // cheap guard: swap bytes then decode as LE rather than garbling it.
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString("utf16le");
  }
  // Strip a UTF-8 BOM if present, otherwise decode as plain UTF-8.
  let text = buffer.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export function parseDexCsv(text: string): DexParseResult {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const rows: DexRow[] = [];
  const malformedLines: number[] = [];

  // Confirmed real export has no quoted/escaped fields (no field value in
  // the sample contains a literal ";") — plain split is safe. Still
  // validated against the real header rather than assumed, and any line
  // that doesn't split into exactly the expected column count is reported
  // instead of silently misaligning every field after it.
  const headerLine = lines[0];
  const header = headerLine?.split(";").map((h) => h.trim());
  const looksLikeRealHeader = header && DEX_HEADER.every((h, i) => header[i] === h);

  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(";");
    if (fields.length < DEX_HEADER.length) {
      malformedLines.push(i + 1);
      continue;
    }
    const quantityRaw = fields[9]?.trim() ?? "";
    const quantity = /^\d+$/.test(quantityRaw) ? Number(quantityRaw) : NaN;
    if (Number.isNaN(quantity)) {
      malformedLines.push(i + 1);
      continue;
    }
    rows.push({
      type: fields[0]?.trim() ?? "",
      category: fields[1]?.trim() ?? "",
      locale: fields[2]?.trim() ?? "",
      series: fields[3]?.trim() ?? "",
      set: fields[4]?.trim() ?? "",
      id: fields[5]?.trim() ?? "",
      name: fields[6]?.trim() ?? "",
      variant: fields[7]?.trim() ?? "",
      rarity: fields[8]?.trim() ?? "",
      quantity,
      price: fields[10]?.trim() ?? "",
    });
  }

  if (!looksLikeRealHeader) {
    // Not fatal — still parsed by position — but worth the caller knowing
    // this wasn't recognized as the exact confirmed real format, in case
    // Dex has changed their export since 2026-08-21.
    malformedLines.unshift(0);
  }

  return { rows, malformedLines };
}

// Splits Dex's "Id" column ("sv7-41", "svp-132", "sma-SV56") on its LAST
// hyphen — the card number itself can't be assumed hyphen-free forever,
// but the set-code prefix never contains one in any real sample seen, so
// splitting from the right is the safe direction.
export function splitDexId(id: string): { prefix: string; cardNumber: string } | null {
  const idx = id.lastIndexOf("-");
  if (idx <= 0 || idx === id.length - 1) return null;
  return { prefix: id.slice(0, idx), cardNumber: id.slice(idx + 1) };
}

// Turns a parsed Dex row into the source-agnostic shape csvCardMatching.ts
// operates on. Returns null for a row whose Id column doesn't even split
// into prefix+number (malformed, reported by the caller as a failure
// rather than crashing).
export function toNormalizedRow(row: DexRow): NormalizedImportRow | null {
  const split = splitDexId(row.id);
  if (!split) return null;
  return {
    sourceRef: row.id,
    name: row.name,
    setName: row.set,
    idPrefix: split.prefix,
    cardNumber: split.cardNumber,
    variantText: row.variant,
    quantity: row.quantity,
  };
}
