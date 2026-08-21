// Parses a real PulseTCG portfolio export CSV into normalized rows. Card/
// variant MATCHING lives in src/lib/csvCardMatching.ts — shared with Dex's
// importer — this file is purely "turn PulseTCG's real export bytes into
// NormalizedImportRow[]".
//
// Built entirely from a real export Ross uploaded
// (a2a4fcc9-portfolio_export_20260821.csv, 2026-08-21) — NOT a guessed
// format. Confirmed real structure, and confirmed genuinely DIFFERENT from
// Dex's, not just a re-skin:
//   - UTF-8 WITH a BOM, CRLF line endings, real RFC4180-style quoting
//     (every field double-quoted, blank fields left as a bare empty spot
//     between commas with no quotes at all, e.g. `,,,"NM"`). A field can
//     contain a literal comma inside its quotes (confirmed real example:
//     "League Challenge, 3rd Place" in a Promo Info value) — Dex's naive
//     semicolon-split was safe for Dex's own export, but doing the
//     equivalent here would silently misalign every field after the first
//     comma-containing one. This uses a real quote-aware record parser.
//   - Header row (exact, confirmed byte-for-byte, after BOM-stripping):
//       Purchase Date,Portfolio,Product Name,Item Type,Set,Card Number,Material,Rarity,Promo Info,Graded By,Grade,Condition,Quantity,Price/Unit,Total Cost,Product ID
//   - `Card Number` is "<number>/<set-total>" for regular sets ("022/086")
//     or a bare alphanumeric code with no slash for promos ("SWSH144",
//     "XY162") — the set-total suffix is just dropped, never used for
//     matching.
//   - `Product ID` embeds PulseTCG's own set code:
//       card:<code>|<card-number>|<material-or-null>|<promo-info-or-null>|null|null
//     Confirmed the SAME real mismatch pattern as Dex against our TCGdex-
//     sourced set_id: numbered sets are sometimes un-padded ("sv6" vs real
//     "sv06"), but promo/lettered codes already match exactly ("me04",
//     "sm6", "sm10", "xy1", "swshp" all matched TCGdex's real id with zero
//     transform needed) — see csvCardMatching.ts's idPrefixCandidates,
//     reused as-is, not re-derived.
//   - Variant information is split across TWO columns instead of Dex's
//     single one: `Material` ("Holo", "Metal Card", or blank) and
//     `Promo Info` (free text — "25th Anniversary", "League Challenge, 3rd
//     Place", "Play! Pokémon Prize Pack"). Combined into one string for
//     matching, same downstream matchVariant() as Dex.
//   - `Item Type` is "Card" in every real row seen — PulseTCG portfolios
//     can presumably also hold sealed product, which has no equivalent in
//     our per-card catalog. Any non-"Card" row is reported as skipped, not
//     silently attempted.
//   - `Condition` and `Graded By`/`Grade` have NO equivalent column in our
//     schema at all — not tracked, not guessed at, genuinely dropped. If
//     this turns out to matter, it needs a real schema decision, not a
//     silent workaround here.
//   - `Quantity` is a real per-line-item integer, same semantics as Dex —
//     confirmed 0 rows would mean "not currently owned", though every row
//     in the one real sample seen so far was 1, so that hasn't been
//     directly observed for THIS source (only inferred from consistency
//     with Dex's own confirmed behavior — flagged in case a future export
//     proves it wrong).

import type { NormalizedImportRow } from "./csvCardMatching";

const PULSETCG_HEADER = [
  "Purchase Date",
  "Portfolio",
  "Product Name",
  "Item Type",
  "Set",
  "Card Number",
  "Material",
  "Rarity",
  "Promo Info",
  "Graded By",
  "Grade",
  "Condition",
  "Quantity",
  "Price/Unit",
  "Total Cost",
  "Product ID",
] as const;

export interface PulseTcgRow {
  purchaseDate: string;
  portfolio: string;
  productName: string;
  itemType: string;
  set: string;
  cardNumber: string;
  material: string;
  rarity: string;
  promoInfo: string;
  gradedBy: string;
  grade: string;
  condition: string;
  quantity: number;
  priceUnit: string;
  totalCost: string;
  productId: string;
}

export interface PulseTcgParseResult {
  rows: PulseTcgRow[];
  // 1-based line numbers (counting the header as line 1) that didn't
  // parse into the expected column count — reported, not silently
  // dropped.
  malformedLines: number[];
}

export function decodePulseTcgCsv(buffer: Buffer): string {
  let text = buffer.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

// Real RFC4180-ish record parser: tracks quote depth across the WHOLE
// text rather than splitting by line first, since a quoted field is
// technically allowed to contain a literal newline (not seen in the real
// sample, but a naive split-by-line-then-split-by-comma approach would
// silently corrupt a file that has one — this doesn't take that risk).
// Doubled quotes ("") inside a quoted field are unescaped to a single ".
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function endField() {
    record.push(field);
    field = "";
  }
  function endRecord() {
    endField();
    records.push(record);
    record = [];
  }

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      // Only a line ending if followed by \n or end-of-input; a bare \r
      // inside an unquoted field would be unusual but treat it as one
      // anyway rather than losing data silently.
      if (text[i + 1] === "\n") i++;
      endRecord();
      i++;
      continue;
    }
    if (c === "\n") {
      endRecord();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing record with no final line ending.
  if (field.length > 0 || record.length > 0) endRecord();

  // Drop fully-empty trailing records (a trailing blank line).
  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function parsePulseTcgCsv(text: string): PulseTcgParseResult {
  const records = parseCsvRecords(text);
  const rows: PulseTcgRow[] = [];
  const malformedLines: number[] = [];

  const header = records[0];
  const looksLikeRealHeader = header && PULSETCG_HEADER.every((h, i) => header[i] === h);

  for (let i = 1; i < records.length; i++) {
    const f = records[i];
    if (f.length < PULSETCG_HEADER.length) {
      malformedLines.push(i + 1);
      continue;
    }
    const quantityRaw = (f[12] ?? "").trim();
    const quantity = /^\d+$/.test(quantityRaw) ? Number(quantityRaw) : NaN;
    if (Number.isNaN(quantity)) {
      malformedLines.push(i + 1);
      continue;
    }
    rows.push({
      purchaseDate: f[0] ?? "",
      portfolio: f[1] ?? "",
      productName: f[2] ?? "",
      itemType: f[3] ?? "",
      set: f[4] ?? "",
      cardNumber: f[5] ?? "",
      material: f[6] ?? "",
      rarity: f[7] ?? "",
      promoInfo: f[8] ?? "",
      gradedBy: f[9] ?? "",
      grade: f[10] ?? "",
      condition: f[11] ?? "",
      quantity,
      priceUnit: f[13] ?? "",
      totalCost: f[14] ?? "",
      productId: f[15] ?? "",
    });
  }

  if (!looksLikeRealHeader) {
    malformedLines.unshift(0);
  }

  return { rows, malformedLines };
}

// Product ID looks like "card:me04|022/086|Holo|null|null|null" — pull
// just the set-code prefix out. Returns null if the field doesn't match
// the confirmed real shape at all (falls back to set-name-only matching
// rather than guessing at a prefix).
export function extractIdPrefix(productId: string): string | null {
  const m = productId.match(/^card:([a-zA-Z0-9]+)\|/);
  return m ? m[1] : null;
}

// "022/086" -> "022", "SWSH144" -> "SWSH144" (no-op when there's no slash
// at all, which is how promo cards' Card Number values look in the real
// export).
export function stripCardTotal(cardNumber: string): string {
  const idx = cardNumber.indexOf("/");
  return idx === -1 ? cardNumber : cardNumber.slice(0, idx);
}

// Turns a parsed PulseTCG row into the source-agnostic shape
// csvCardMatching.ts operates on, or a string skip-reason if this row
// can't become an import candidate at all (not a Card, or Card Number is
// empty).
export function toNormalizedRow(row: PulseTcgRow): NormalizedImportRow | { skipReason: string } {
  if (row.itemType !== "Card") {
    return { skipReason: `Item Type "${row.itemType || "(blank)"}" isn't a single card — sealed product isn't matchable against our per-card catalog` };
  }
  const cardNumber = stripCardTotal(row.cardNumber.trim());
  if (!cardNumber) {
    return { skipReason: "no Card Number on this row" };
  }
  const variantText = [row.material, row.promoInfo]
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .join(", ");
  return {
    sourceRef: row.productId || `${row.set} ${row.cardNumber}`,
    name: row.productName,
    setName: row.set,
    idPrefix: extractIdPrefix(row.productId),
    cardNumber,
    variantText,
    quantity: row.quantity,
  };
}
