// Parses a real Collectr portfolio export into normalized rows. Card/
// variant MATCHING lives in src/lib/csvCardMatching.ts — shared with every
// other source importer — this file is purely "turn Collectr's real export
// bytes into NormalizedImportRow[]", same division of labor as
// src/lib/dexImport.ts and src/lib/pulseTcgImport.ts.
//
// Built entirely from a real export Ross uploaded (5fd08df5-export.csv,
// 2026-08-26) — NOT a guessed format, per this project's standing rule.
// Confirmed real structure, and confirmed genuinely different from both
// Dex's and PulseTCG's, not just a re-skin:
//
//   - Despite the ".csv" extension, the real file is a genuine .xlsx
//     workbook (Excel 2007+, one sheet, produced by "Excel Android" per
//     its own docProps) — not delimited text at all. Detected by content
//     (parsed with read-excel-file, not sniffed by filename), so a
//     genuinely different-shaped upload fails cleanly on the header check
//     below rather than being silently misread as text.
//   - Header row (exact, confirmed byte-for-byte, except the one column
//     noted below): Portfolio Name, Category, Set, Product Name, Card
//     Number, Rarity, Variance, Grade, Card Condition, Average Cost Paid,
//     Quantity, "Market Price (As of <today's date>)", Price Override,
//     Watchlist, Date Added, Notes. The Market Price column's name embeds
//     the export date, so it's located by prefix ("Market Price...") for
//     header validation rather than exact match — everything else matches
//     exactly.
//   - `Card Number` is "<number>/<set-total>" for regular sets ("251/217")
//     or a bare alphanumeric code with no slash for promos ("SWSH050",
//     "SM242") — same shape as Dex/PulseTCG, set-total suffix dropped.
//     Genuinely mixed cell TYPES in the real file though: a purely numeric
//     value like "204" is stored as an actual Excel number cell, not text,
//     so it arrives here as a JS `number`, not a `string` — confirmed via
//     a real row (Cynthia's Garchomp ex, card 204). Always coerced with
//     `String()` before use, never assumed to already be a string.
//   - `Variance` is the variant column (Dex calls this "Variant",
//     PulseTCG splits it across "Material"/"Promo Info") — free text
//     ("Holofoil", "Normal", "Reverse Holofoil", "Unlimited",
//     "1st Edition", "Master Ball Reverse Holo", "Poke Ball Reverse
//     Holo" — all real values seen), fed into the same matchVariant() as
//     every other source.
//   - UNLIKE Dex (`Id` column) and PulseTCG (`Product ID` column), this
//     format has NO set-code prefix column at all — `Set` is the only
//     set-identifying field, a human display name. So `idPrefix` is
//     always null for this source; every row goes straight to
//     csvCardMatching.ts's set-name fallback path.
//   - `Category` was "Pokemon" on every one of the 740 real rows seen —
//     no sealed product observed in this export, but the field is real
//     (Collectr portfolios can presumably hold other categories), so a
//     non-"Pokemon" row is reported as skipped rather than assumed away,
//     same treatment as PulseTCG's `Item Type` check.
//   - `Grade`, `Card Condition`, `Average Cost Paid`, `Market Price`,
//     `Price Override`, `Watchlist`, `Date Added`, `Notes`, `Portfolio
//     Name` have NO equivalent in our schema — not tracked, not guessed
//     at, genuinely dropped, same honesty as Dex/PulseTCG's untracked
//     columns.
//   - `Quantity` is a real per-line-item integer, same semantics as every
//     other source.
//
// TWO things this source needed that Dex/PulseTCG didn't, both found by
// actually looking at the real 740 rows rather than assuming this would
// be a straightforward re-skin of the other two importers:
//
//   1. LANGUAGE ISN'T UNIFORM. Dex and PulseTCG exports were confirmed
//      English-only. This one genuinely isn't: 67 of 740 real rows are
//      Chinese-market cards (sets like "Nine Colours Gathering (Friend)",
//      "Gem Pack 2", "Collect 151 Hope" — none of which are real TCGdex
//      set names, they're Collectr's own English labels for
//      Chinese-exclusive sets). There's no language column at all, so
//      this is detected per-row from two real signals found in the data:
//      a "(CN)" suffix on Product Name (65 of the 67), or an abbreviated
//      rarity code — R/UC/RR/RRR/SAR/CSR — that doesn't appear on any
//      English row (covers the other 2). See CN_FLAG_RARITIES and
//      looksLikeChineseMarketRow below. Flagged rows try "zh-cn" before
//      "zh-tw" (see importCollectrCsv in src/app/import/actions.ts) —
//      zh-cn based on this project's own prior zh-cn set-import work
//      using the same rarity-code convention (see spec history), not a
//      random guess, but still genuinely unverified for zh-tw vs zh-cn
//      specifically. Worth being honest about the real risk this creates:
//      Collectr's own set names ("Nine Colours Gathering (Friend)") are
//      almost certainly NOT what TCGdex stores as that set's localized
//      name, so the set-name fallback match is likely to fail outright
//      for a real chunk of these 67 rows — they're expected to show up in
//      the failure list, not silently mis-imported. That's the honest
//      outcome, not a bug to chase blindly before it's been seen for
//      real.
//   2. REAL DUPLICATE ROWS. Unlike Dex/PulseTCG (where each print variant
//      already gets its own single row with its own quantity), this real
//      export has 2 confirmed pairs of rows (4 rows total, verified via
//      pandas against the real file) that are IDENTICAL on Set+Card
//      Number+Product Name+Variance but split across two lines instead of
//      one Quantity=2 line. Left alone, the shared
//      collection_entries upsert (keyed on user+card+language) would
//      silently let the second write clobber the first rather than
//      adding — undercounting a real duplicate by half. Fixed by
//      aggregating exact duplicates (summing Quantity) BEFORE handing
//      rows to the shared matcher — see aggregateDuplicateRows below.

import { readSheet } from "read-excel-file/node";
import { stripCardTotal } from "./pulseTcgImport";
import type { CardVariantLanguage } from "./cardVariants";
import type { NormalizedImportRow } from "./csvCardMatching";

// Every column this importer actually reads, by position — validated
// against the real header below rather than assumed. The "Market Price"
// column (index 11) is deliberately excluded from this map since its real
// header text embeds the export date and can't be matched exactly.
const EXPECTED_HEADER_BY_INDEX: Record<number, string> = {
  0: "Portfolio Name",
  1: "Category",
  2: "Set",
  3: "Product Name",
  4: "Card Number",
  5: "Rarity",
  6: "Variance",
  7: "Grade",
  8: "Card Condition",
  9: "Average Cost Paid",
  10: "Quantity",
  12: "Price Override",
  13: "Watchlist",
  14: "Date Added",
  15: "Notes",
};

export interface CollectrRow {
  category: string;
  set: string;
  productName: string;
  cardNumber: string;
  rarity: string;
  variance: string;
  quantity: number;
}

export interface CollectrParseResult {
  rows: CollectrRow[];
  // 1-based line numbers (counting the header as line 1) that didn't parse
  // into a usable row — reported, not silently dropped. A leading 0 means
  // the header itself didn't match the confirmed real shape (same
  // convention as dexImport.ts/pulseTcgImport.ts).
  malformedLines: number[];
}

// Typed loosely against `unknown[]` rather than read-excel-file's own Row
// type — its CellValue union includes `typeof Date` (the Date class
// itself, not an instance), which doesn't line up cleanly with the real
// values this library actually returns for date cells. Coercing with
// String() works correctly regardless of the cell's real runtime type
// (string, number, boolean, or Date instance), so the stricter type isn't
// needed here.
function cell(row: unknown[], index: number): string {
  const v = row[index];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// Reads the FIRST sheet regardless of its name — the real export has
// exactly one sheet (confirmed via its own docProps/app.xml, which
// reports a single worksheet), oddly named "in" in the one real sample
// seen. That name isn't assumed stable across accounts/exports, so this
// deliberately doesn't hardcode it.
export async function parseCollectrExport(buffer: Buffer): Promise<CollectrParseResult> {
  const sheetRows = await readSheet(buffer);

  const header = sheetRows[0] ?? [];
  const looksLikeRealHeader =
    Object.entries(EXPECTED_HEADER_BY_INDEX).every(([idx, name]) => cell(header, Number(idx)) === name) &&
    /^Market Price/.test(cell(header, 11));

  const rows: CollectrRow[] = [];
  const malformedLines: number[] = [];

  for (let i = 1; i < sheetRows.length; i++) {
    const r = sheetRows[i];
    if (!r || r.length < 11) {
      malformedLines.push(i + 1);
      continue;
    }
    const quantityRaw = r[10];
    const quantity = typeof quantityRaw === "number" ? quantityRaw : Number(quantityRaw);
    const category = cell(r, 1);
    const set = cell(r, 2);
    const productName = cell(r, 3);
    const cardNumber = cell(r, 4);
    if (!Number.isFinite(quantity) || !set || !productName || !cardNumber) {
      malformedLines.push(i + 1);
      continue;
    }
    rows.push({
      category,
      set,
      productName,
      cardNumber,
      rarity: cell(r, 5),
      variance: cell(r, 6),
      quantity,
    });
  }

  if (!looksLikeRealHeader) {
    malformedLines.unshift(0);
  }

  return { rows, malformedLines };
}

// Rarity codes seen ONLY on the real Chinese-market rows in the sample
// export (R, UC, RR, RRR, SAR, CSR) — every English row used a full word
// ("Rare", "Uncommon", "Ultra Rare", etc.) instead. Combined with the
// "(CN)" product-name suffix, covers all 67 real Chinese-market rows found
// (65 via the tag, the other 2 via this rarity check alone).
const CN_FLAG_RARITIES = new Set(["R", "UC", "RR", "RRR", "SAR", "CSR"]);

export function looksLikeChineseMarketRow(row: CollectrRow): boolean {
  return /\(CN\)/.test(row.productName) || CN_FLAG_RARITIES.has(row.rarity);
}

// Sums Quantity across rows that are exact duplicates on the fields that
// actually identify a print (Set, Card Number, Product Name, Variance) —
// see the "REAL DUPLICATE ROWS" note at the top of this file. Order-
// preserving (first occurrence's position is kept) so failure/success
// reporting stays in a stable, predictable order.
export function aggregateDuplicateRows(rows: CollectrRow[]): CollectrRow[] {
  const byKey = new Map<string, CollectrRow>();
  const order: string[] = [];
  for (const row of rows) {
    const key = [row.set, row.cardNumber, row.productName, row.variance].join("");
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      byKey.set(key, { ...row });
      order.push(key);
    }
  }
  return order.map((k) => byKey.get(k)!);
}

// Turns a parsed (and de-duplicated) Collectr row into the source-agnostic
// shape csvCardMatching.ts operates on, plus the ordered list of languages
// to try it against — see the "LANGUAGE ISN'T UNIFORM" note at the top of
// this file for why this, uniquely among the three sources, needs more
// than one language candidate per row.
export function toNormalizedRow(
  row: CollectrRow
): { row: NormalizedImportRow; languages: CardVariantLanguage[] } | { skipReason: string } {
  if (row.category !== "Pokemon") {
    return {
      skipReason: `Category "${row.category || "(blank)"}" isn't a Pokemon card — sealed product/accessories aren't matchable against our per-card catalog`,
    };
  }
  const cardNumber = stripCardTotal(row.cardNumber);
  if (!cardNumber) {
    return { skipReason: "no Card Number on this row" };
  }

  const languages: CardVariantLanguage[] = looksLikeChineseMarketRow(row) ? ["zh-cn", "zh-tw"] : ["en"];

  return {
    row: {
      sourceRef: `${row.set} ${row.cardNumber} (${row.productName})`,
      name: row.productName,
      setName: row.set,
      idPrefix: null,
      cardNumber,
      variantText: row.variance,
      quantity: row.quantity,
    },
    languages,
  };
}
