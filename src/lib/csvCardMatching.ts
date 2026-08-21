// Shared card-matching pipeline for every "import a collection CSV from
// [service]" feature (Dex first, PulseTCG second — Collectr presumably
// later). Deliberately source-agnostic: everything here operates on a
// NormalizedImportRow, a shape any importer's own parser can produce, so
// the actual matching logic — the hard, real-world-messy part — is written
// and fixed exactly ONCE instead of being re-derived (and re-bugged) per
// source. See src/lib/dexImport.ts and src/lib/pulseTcgImport.ts for the
// source-specific CSV parsing that feeds this.
//
// History worth knowing before touching this file: this used to live
// entirely inside dexImport.ts, written and debugged against Ross's real
// Dex export across several real import runs (see the UPDATE comments
// below, kept because they're not just changelog — they're WHY the code
// looks the way it does, and undoing them silently re-introduces bugs that
// already shipped once). Extracted here once a second source (PulseTCG)
// needed the exact same set-id/card-number/variant matching, since Dex's
// own set-code prefixes and PulseTCG's (from its Product ID column) turned
// out to follow the identical real mismatch pattern against our TCGdex-
// sourced set_id (un-padded vs zero-padded numbered sets, promo-set codes
// matching exactly with no transform needed).

import {
  labelVariant,
  lookupVariants,
  pickPrimaryVariant,
  zeroPadCardNumber,
  stripLeadingZeros,
  type CardVariantLanguage,
} from "@/lib/cardVariants";

// ---------------------------------------------------------------------------
// Set-code / set-name matching
// ---------------------------------------------------------------------------

// Confirmed real mismatch pattern (from Dex) and confirmed to hold for
// PulseTCG too: numbered-set prefixes are sometimes un-padded ("sv7",
// "sv6") where TCGdex's real set id is zero-padded ("sv07", "sv06") — but
// promo-set and other letter-suffixed prefixes ("svp", "swshp", "xyp",
// "sma", "sm10", "me04", "sm6", "xy1") already match TCGdex's real id
// exactly with no transform, for BOTH sources. Rather than hand-maintain a
// mapping table (which would need a real verified pair for every one of
// 400+ sets), this generates both the raw and a digit-zero-padded
// candidate and lets the caller try each as an exact `cards.id` lookup —
// safe because `cards.id` is a real primary key, so an exact-match hit is
// never ambiguous.
export function idPrefixCandidates(prefix: string): string[] {
  const candidates = [prefix];
  const m = prefix.match(/^([a-z]+)(\d+)$/i);
  if (m && m[2].length < 2) {
    candidates.push(`${m[1]}${m[2].padStart(2, "0")}`);
  }
  return candidates;
}

function normalizeSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[:,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function setNamesMatch(a: string, b: string): boolean {
  return normalizeSetName(a) === normalizeSetName(b);
}

// ---------------------------------------------------------------------------
// Variant text matching
// ---------------------------------------------------------------------------

function normalizeVariantText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlapScore(a: string, b: string): number {
  const wordsA = new Set(normalizeVariantText(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeVariantText(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type VariantMatchConfidence = "high" | "low";

export interface VariantMatchResult {
  cardId: string;
  confidence: VariantMatchConfidence;
  reason: string;
}

// Picks which of a card's real rows (the primary "" / null-variant row,
// plus any additional print-variant rows scripts/import-card-variants.ts
// added) a source CSV row's free-text variant column refers to.
//
// Deliberately tiered rather than "best score wins" for every case: an
// external service's own variant vocabulary and TCGdex's (the source our
// labelVariant() text comes from) genuinely diverge for stamps/promos —
// confirmed real example, Dex calls a card's stamp "Expansion Stamp",
// TCGdex's own data (and our label built from it) calls the exact same
// physical stamp "Set Logo Stamp". A pure word-overlap score would rate
// that a bad match even though it's the ONLY plausible one. Rather than
// lower the threshold until that case passes (which would silently start
// mismatching cards with genuinely different real alternate-print
// variants), this treats "exactly one non-primary variant exists for this
// card" as its own honest signal — the source is telling us this row is
// SOME special print, and if our data only knows about one, that's the
// one, just flagged low confidence so an import summary can surface it for
// a human to sanity check rather than silently trusting it forever.
export function matchVariant(
  sourceVariantText: string,
  candidates: Array<{ id: string; variant: string | null; label: string }>
): VariantMatchResult | null {
  const trimmed = sourceVariantText.trim();
  const primary = candidates.find((c) => c.variant === null) ?? null;

  // UPDATE 2026-08-21, caught by Ross's first real import run: a card with
  // exactly ONE row in our data (just the primary — no extra print-variant
  // rows at all) used to fall all the way through to "no confident match"
  // and get skipped, because the old code only ever special-cased "exactly
  // one NON-primary variant", not "exactly one candidate total". In
  // practice this is the single most common real case — a modern EX/GX/V
  // "chase" card is almost always holo-only, so scripts/import-card-
  // variants.ts never created a second row for it at all (see that
  // script's `if (variants.length === 1) continue`). There's no
  // possible ambiguity here — this IS the only row this row could refer
  // to — so it's matched directly, and treated as high confidence (not a
  // guess between candidates, there simply isn't another one).
  if (candidates.length === 1) {
    return { cardId: candidates[0].id, confidence: "high", reason: "only print known for this card" };
  }

  // Only a genuinely BLANK variant column short-circuits straight to the
  // primary row — it makes no specific claim, so "the default print" is
  // the reasonable read regardless of what that default actually is. A
  // literal "Normal" is NOT special-cased the same way: now that the
  // primary row's label is derived from its real variant key (see
  // matchAndImportRow below) instead of being hardcoded to the word
  // "Normal", a literal "Normal" is trusted to mean the same thing our
  // data calls "Normal" — for a holo-only card whose primary's real label
  // is "Holo", a source saying "Normal" should NOT silently match it just
  // by convention.
  if (trimmed === "") {
    if (primary) return { cardId: primary.id, confidence: "high", reason: "blank -> primary print" };
    // No primary row in our data at all (shouldn't happen — every card has
    // one) — fall through to text matching against whatever exists.
  }

  const nonPrimary = candidates.filter((c) => c.variant !== null);

  // UPDATE 2026-08-21: the first version of this scoring also boosted the
  // score to 0.85 whenever the source text was a substring of a
  // candidate's label (as well as the reverse) — e.g. "Holo" is a literal
  // substring of our label "Holo, Set Logo Stamp". That direction is NOT
  // safe: it lets a short, generic source word falsely strong-match a
  // longer, MORE SPECIFIC compound label. Caught on a real import: Ross's
  // Stellar Crown Greninja ex has 3 real prints in our data (plain holo,
  // holo+stamp, holo+jumbo+stamp) — Dex's own export tracks these as 3
  // SEPARATE rows (plain "Holo" owned, "Expansion Stamp" and "Jumbo
  // (Expansion Stamp)" both unowned) specifically because they're
  // different prints. The old scoring matched a plain "Holo" row to the
  // STAMPED candidate (first one hit in iteration order) purely because
  // "holo" is a substring of "holo set logo stamp" — silently importing
  // the WRONG print as high-confidence, worse than an honest failure. Only
  // the SAFE direction is kept: a candidate whose full label is contained
  // in what the source said (e.g. our "Metal" ⊆ "Metal Card") is a genuine
  // simplification, not a false generalization, so that direction still
  // gets the boost.
  // NOTE: this trusts `c.label` as-supplied for EVERY candidate, including
  // the primary (variant=null) one — the caller is responsible for passing
  // its real derived label rather than a hardcoded placeholder, precisely
  // because a hardcoded "Normal" here previously defeated the whole point
  // of deriving the primary row's true label upstream.
  let best: { c: (typeof candidates)[number]; score: number } | null = null;
  for (const c of candidates) {
    const label = c.label;
    const norm = normalizeVariantText(label);
    const dexNorm = normalizeVariantText(trimmed);
    let score = wordOverlapScore(sourceVariantText, label);
    if (norm === dexNorm) score = 1;
    else if (norm.length > 0 && dexNorm.includes(norm)) {
      score = Math.max(score, 0.85);
    }
    if (!best || score > best.score) best = { c, score };
  }
  if (best && best.score >= 0.6) {
    return { cardId: best.c.id, confidence: "high", reason: `text match "${best.c.label}" (score ${best.score.toFixed(2)})` };
  }

  // No confident text match. If this card has exactly one non-primary
  // variant, the source is clearly pointing at SOME special print and
  // that's the only candidate — accept it, flagged low-confidence.
  if (nonPrimary.length === 1) {
    return {
      cardId: nonPrimary[0].id,
      confidence: "low",
      reason: `only one alternate print exists ("${nonPrimary[0].label}") — source said "${trimmed}", not a recognized match, accepted as the only real candidate`,
    };
  }

  // Multiple non-primary variants and no confident match, or the card has
  // no primary row to fall back to either — genuinely ambiguous. Caller
  // should skip and report rather than guess.
  return null;
}

// ---------------------------------------------------------------------------
// Full row -> card matching + collection_entries write
// ---------------------------------------------------------------------------

// Kept loose/untyped against the real Supabase client type so this module
// doesn't need to import the generated DB types — every caller already has
// a real client instance from src/lib/supabase/server.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any;

interface CardCandidateRow {
  id: string;
  set_id: string;
  set_name: string;
  card_number: string;
  variant: string | null;
}

// One row from ANY source CSV, already reduced to the fields the matcher
// actually needs. `idPrefix` is the source's own set-code guess (Dex's
// "Id" column prefix, PulseTCG's Product ID prefix) — pass null if a
// future source doesn't have one at all, and matching falls straight to
// the set-name fallback.
export interface NormalizedImportRow {
  sourceRef: string; // for error messages — whatever uniquely identifies this row in the source's own export
  name: string;
  setName: string;
  idPrefix: string | null;
  cardNumber: string;
  variantText: string;
  quantity: number;
}

export interface ImportRowSuccess {
  sourceRef: string;
  name: string;
  cardId: string;
  quantity: number;
  confidence: VariantMatchConfidence;
}

export interface ImportRowFailure {
  sourceRef: string;
  name: string;
  setName: string;
  variantText: string;
  reason: string;
}

// Finds the matching BASE card row (the primary/variant=null print) in our
// cards table. Tries an exact `id` lookup first (precise, unambiguous —
// cards.id is a real primary key), generating both the raw and
// zero-padded set-code prefix. Only falls back to matching by the human
// Set name if no id-based candidate hits anything, since set-name matching
// is comparatively more prone to ambiguity (multiple sets can share a
// card_number).
async function findBaseCard(
  supabase: AnySupabaseClient,
  language: string,
  idPrefix: string | null,
  cardNumberRaw: string,
  setName: string
): Promise<CardCandidateRow | { ambiguous: CardCandidateRow[] } | null> {
  const numberCandidates = Array.from(
    new Set(
      [cardNumberRaw, zeroPadCardNumber(cardNumberRaw), stripLeadingZeros(cardNumberRaw)].filter(
        (n): n is string => n !== null
      )
    )
  );

  if (idPrefix) {
    for (const prefix of idPrefixCandidates(idPrefix)) {
      for (const number of numberCandidates) {
        const candidateId = `${prefix}-${number}`;
        const { data } = await supabase
          .from("cards")
          .select("id, set_id, set_name, card_number, variant")
          .eq("id", candidateId)
          .eq("language", language)
          .is("variant", null)
          .maybeSingle();
        if (data) return data as CardCandidateRow;
      }
    }
  }

  // Fallback: same card_number candidates, but matched by normalized Set
  // name instead of id. Bounded to base (variant=null) rows only.
  const { data: byNumber } = await supabase
    .from("cards")
    .select("id, set_id, set_name, card_number, variant")
    .eq("language", language)
    .is("variant", null)
    .in("card_number", numberCandidates);

  const nameMatches = ((byNumber ?? []) as CardCandidateRow[]).filter((row) => setNamesMatch(row.set_name, setName));
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) return { ambiguous: nameMatches };
  return null;
}

// The full pipeline for one normalized row: find the card, find its real
// print-variant siblings, derive the primary row's true label, match the
// source's variant text against them, and upsert collection_entries on
// success. Used identically by every source's import action — this is the
// part that must never be re-derived per source, since every real bug
// found so far lived exactly here.
export async function matchAndImportRow(
  supabase: AnySupabaseClient,
  userId: string,
  language: CardVariantLanguage,
  row: NormalizedImportRow
): Promise<{ type: "success"; result: ImportRowSuccess } | { type: "failure"; result: ImportRowFailure }> {
  const fail = (reason: string): { type: "failure"; result: ImportRowFailure } => ({
    type: "failure",
    result: { sourceRef: row.sourceRef, name: row.name, setName: row.setName, variantText: row.variantText, reason },
  });

  const base = await findBaseCard(supabase, language, row.idPrefix, row.cardNumber, row.setName);
  if (!base) {
    return fail("no matching card found in our catalog (set/number combination not recognized)");
  }
  if ("ambiguous" in base) {
    return fail(`matched ${base.ambiguous.length} different cards by set name — ambiguous, skipped rather than guessing`);
  }

  const { data: family } = await supabase
    .from("cards")
    .select("id, variant")
    .eq("language", language)
    .or(`id.eq.${base.id},id.like.${base.id}-%`);

  // The primary (variant=null) row's `variant` column is deliberately
  // never recorded in the DB — see the schema comment on cards.variant —
  // so on its own the row has no real label, and defaulting it to the
  // generic word "Normal" caused a real bug: a holo-only "chase" card
  // (EX/GX/V etc.) has no separate "normal" print at all, so its primary
  // row genuinely IS the plain holo print, but nothing in the DB says so.
  // Fixed by re-deriving the primary row's true variant key the exact
  // same way scripts/import-card-variants.ts originally chose it —
  // data/card-variants-index.json has the full variant list for this
  // card, and pickPrimaryVariant() is the same function that decided
  // which key became the unlabeled default row in the first place.
  // Falls back to the old generic "Normal" only when this card isn't in
  // the index at all (coverage isn't 100%, same caveat as
  // import-card-variants.ts's own "no variant data" count).
  const indexVariants = lookupVariants(language, base.set_id, base.card_number);
  const primaryLabel = indexVariants && indexVariants.length > 0 ? labelVariant(pickPrimaryVariant(indexVariants)) : "Normal";

  const candidates = ((family ?? []) as { id: string; variant: string | null }[]).map((c) => ({
    id: c.id,
    variant: c.variant,
    label: c.variant ? labelVariant(c.variant) : primaryLabel,
  }));

  const variantMatch = matchVariant(row.variantText, candidates);
  if (!variantMatch) {
    return fail(
      `card identified (${base.set_name} #${base.card_number}) but variant "${row.variantText}" wasn't confidently matched among ${candidates.length} known print(s)`
    );
  }

  const { error } = await supabase.from("collection_entries").upsert(
    { user_id: userId, card_id: variantMatch.cardId, language, quantity: row.quantity },
    { onConflict: "user_id,card_id,language" }
  );
  if (error) {
    return fail(`DB write failed: ${error.message}`);
  }

  return {
    type: "success",
    result: {
      sourceRef: row.sourceRef,
      name: row.name,
      cardId: variantMatch.cardId,
      quantity: row.quantity,
      confidence: variantMatch.confidence,
    },
  };
}
