// Parses this app's own "fill in yourself" CSV template — for people who
// don't use Dex or PulseTCG and just want to type/paste their collection
// into a spreadsheet. Built in response to a real feature request (see
// /feedback): "if I knew the CSV format I could quite easily get my cards
// into it." Deliberately a NEW, simpler format rather than exposing Dex's
// own export shape — Dex's `Id` column encodes Dex's own internal set-code
// prefixes (e.g. "sv7" for Stellar Crown, see dexImport.ts), which only
// Dex's own export can produce; handing someone that format to fill in by
// hand would be unusable. This format instead only asks for what a person
// can read straight off a physical card: the set's real name and the
// card's printed number.
//
// Real CSV (RFC4180-ish): comma-delimited, double-quote-quoted fields,
// UTF-8. Deliberately NOT treated the same "confirmed byte-for-byte from a
// real export" way as dexImport.ts/pulseTcgImport.ts — there's no external
// file to reverse-engineer here, this app defines the format itself. See
// SIMPLE_TEMPLATE_CSV below and src/app/import/simple-template.csv/route.ts,
// which serves it as a download.
//
// Header: Set,Card Number,Name,Variant,Quantity,Language
//   - Set: the set's real name, e.g. "Base Set", "Obsidian Flames". Matched
//     loosely (case/punctuation-insensitive) against the synced catalog —
//     see setNamesMatch in csvCardMatching.ts.
//   - Card Number: exactly as printed on the card, e.g. "4", "025/198",
//     "SWSH284". Matched against a few reasonable variants (as-typed,
//     zero-padded, leading-zeros-stripped) — see findBaseCard in
//     csvCardMatching.ts.
//   - Name: for the person's own reference and shown in the import summary
//     — not used for matching (Set + Card Number already uniquely identify
//     a card within a language).
//   - Variant: free text describing the specific print, e.g. "Holo",
//     "Reverse Holo", or blank for the default print. Same matching engine
//     as every other import source — see matchVariant in csvCardMatching.ts.
//   - Quantity: how many copies owned. 0 or blank rows are skipped, same
//     "not currently owned" convention as every other import source here.
//   - Language: en / ja / zh-tw / zh-cn. Blank defaults to "en".

import type { NormalizedImportRow } from "./csvCardMatching";
import type { CardVariantLanguage } from "./cardVariants";

const SIMPLE_HEADER = ["Set", "Card Number", "Name", "Variant", "Quantity", "Language"] as const;

// Served as a real file download by src/app/import/simple-template.csv/route.ts.
// The two example rows are real cards on purpose — an unmodified upload of
// this exact file successfully imports them, which doubles as a working
// example rather than a row someone has to first figure out how to delete.
export const SIMPLE_TEMPLATE_CSV =
  "Set,Card Number,Name,Variant,Quantity,Language\n" +
  "Base Set,4,Charizard,Holo,1,en\n" +
  "Scarlet & Violet,1,Sprigatito,,1,en\n";

export interface SimpleRow {
  setName: string;
  cardNumber: string;
  name: string;
  variant: string;
  quantity: number;
  language: string;
}

export interface SimpleParseResult {
  rows: SimpleRow[];
  // 1-based line numbers (header counted as line 1) that didn't parse —
  // reported, not silently dropped. 0 means the header itself didn't match
  // the expected columns (still parsed by position, but worth flagging).
  malformedLines: number[];
}

// Minimal RFC4180 line splitter — this format is meant to be edited in
// Excel/Google Sheets and saved as CSV, which quotes any field containing a
// comma, quote, or newline (doubling embedded quotes: "" for a literal ").
// The other importers in this app (Dex, PulseTCG) get away with a plain
// delimiter split because their real exports were confirmed to never quote
// fields — that's not a safe assumption for a format people hand-edit.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

export function parseSimpleCsv(text: string): SimpleParseResult {
  // Strip a UTF-8 BOM if present — Excel adds one when saving CSVs on
  // Windows, which would otherwise glue onto the first header cell
  // ("Set" becomes "﻿Set") and silently fail the header check below.
  let clean = text;
  if (clean.charCodeAt(0) === 0xfeff) clean = clean.slice(1);

  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const rows: SimpleRow[] = [];
  const malformedLines: number[] = [];

  const header = lines[0] ? parseCsvLine(lines[0]) : [];
  const looksLikeRealHeader = SIMPLE_HEADER.every(
    (h, i) => (header[i] ?? "").toLowerCase() === h.toLowerCase()
  );
  if (!looksLikeRealHeader) malformedLines.push(0);

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < SIMPLE_HEADER.length) {
      malformedLines.push(i + 1);
      continue;
    }
    const [setName, cardNumber, name, variant, quantityRaw, languageRaw] = fields;
    if (!setName || !cardNumber) {
      malformedLines.push(i + 1);
      continue;
    }
    const quantityText = (quantityRaw ?? "").trim();
    const quantity = quantityText === "" ? 0 : Number(quantityText);
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
      malformedLines.push(i + 1);
      continue;
    }
    rows.push({
      setName,
      cardNumber,
      name: name ?? "",
      variant: variant ?? "",
      quantity,
      language: (languageRaw ?? "").trim() || "en",
    });
  }

  return { rows, malformedLines };
}

export function toNormalizedRow(row: SimpleRow): NormalizedImportRow {
  return {
    sourceRef: `${row.setName} #${row.cardNumber}`,
    name: row.name || `${row.setName} #${row.cardNumber}`,
    setName: row.setName,
    // No source-provided set-code prefix to try (unlike Dex/PulseTCG) —
    // findBaseCard in csvCardMatching.ts already handles idPrefix: null by
    // going straight to its set-name + card-number fallback match, which
    // is exactly the right behavior for a human-typed set name.
    idPrefix: null,
    cardNumber: row.cardNumber,
    variantText: row.variant,
    quantity: row.quantity,
  };
}

const VALID_LANGUAGES: readonly string[] = ["en", "ja", "zh-tw", "zh-cn"];
export function isValidLanguage(language: string): language is CardVariantLanguage {
  return VALID_LANGUAGES.includes(language);
}
