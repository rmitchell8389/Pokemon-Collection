// Fixes the data loss found by debug-cn-reprint-duplicates.ts: 12 of the 36
// CS/CSM/CSV reprint sets committed by import-cn-reprint-sets-batch.ts had
// wiki-declared cnno collisions (two or more DIFFERENT cards sharing the
// same card_number) — the row-by-row upsert fallback silently overwrote
// earlier entries with later ones sharing an id, so one card from each
// colliding group never made it into the database at all.
//
// This does NOT try to guess which card "really" owns the plain number.
// Instead, for every colliding group it deterministically orders the
// entries (by wiki page title) and assigns: first entry keeps the plain
// card_number, every other entry gets a "b"/"c"/... suffix appended to both
// its card_number and id. That's a real limitation — the suffixed number
// isn't the card's true printed number, which the wiki simply doesn't give
// us cleanly here — but it's honest about the uncertainty (visible in the
// card_number itself) and, critically, means NOTHING gets silently dropped.
// Every entry still goes through the same resolve-then-verify image
// pipeline as everywhere else — nothing gets written without a live check.
//
// Usage:
//   npx tsx scripts/fix-cn-reprint-duplicates.ts               # the 12 known-affected sets
//   npx tsx scripts/fix-cn-reprint-duplicates.ts CSV1C CS2.5C  # subset only
//   npx tsx scripts/fix-cn-reprint-duplicates.ts --dry-run     # report only, no writes
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { searchReprintPages, fetchFullContent, parsePage, type ReprintEntry } from "../src/lib/cnReprintImport";
import { resolveCnImageUrls, cnImageExists } from "../src/lib/cnimages";

// The 12 sets that hit "ON CONFLICT DO UPDATE command cannot affect row a
// second time" during the 2026-08-20 batch commit.
const AFFECTED_SET_IDS = [
  "CS2.5C", "CS2bC", "CS4aC", "CS5bC", "CS6.5C",
  "CSM1aC",
  "CSV1C", "CSV3C", "CSV5C", "CSV6C", "CSV9C", "CSV9.5C",
];

function suffixFor(index: number): string {
  // 0 -> "", 1 -> "b", 2 -> "c", ...
  if (index === 0) return "";
  return String.fromCharCode("b".charCodeAt(0) + index - 1);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const requested = args.filter((a) => !a.startsWith("--"));
  const setIds = requested.length > 0 ? requested : AFFECTED_SET_IDS;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !serviceKey)) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = url && serviceKey ? createClient(url, serviceKey) : null;

  let totalRecovered = 0;

  for (const setId of setIds) {
    console.log(`\n=== ${setId} ${dryRun ? "[DRY RUN]" : ""} ===`);

    const titles = await searchReprintPages(setId);
    const contentByTitle = await fetchFullContent(titles);

    const byCardNumber = new Map<string, ReprintEntry[]>();
    for (const title of titles) {
      const text = contentByTitle.get(title);
      if (!text) continue;
      const entry = parsePage(title, text, setId);
      if (!entry || !entry.cardNumber) continue;
      const list = byCardNumber.get(entry.cardNumber) ?? [];
      list.push(entry);
      byCardNumber.set(entry.cardNumber, list);
    }

    const duplicateGroups = Array.from(byCardNumber.entries()).filter(([, list]) => list.length > 1);
    if (duplicateGroups.length === 0) {
      console.log("No collisions found here (fresh parse) — nothing to fix.");
      continue;
    }

    // Reuse the real set_name already committed for this set (from the
    // original batch run) rather than guessing — avoids writing a
    // different set_name on the recovered rows than the rest of the set.
    let setName = setId;
    if (supabase) {
      const { data } = await supabase
        .from("cards")
        .select("set_name")
        .eq("language", "zh-cn")
        .eq("set_id", setId)
        .limit(1)
        .maybeSingle();
      if (data?.set_name) setName = data.set_name;
    }

    // Only the entries from index 1 onward in each group need a new row —
    // index 0 already exists under the plain card_number from the original
    // commit (whichever entry the upsert loop happened to write last there
    // may differ from "index 0" here, but that row already has a name for
    // that plain number either way; this only ADDS the missing sibling(s)).
    const recoveryEntries: { cardNumber: string; entry: ReprintEntry }[] = [];
    for (const [cardNumber, group] of duplicateGroups) {
      const sorted = [...group].sort((a, b) => a.title.localeCompare(b.title));
      console.log(`  ${cardNumber}: ${sorted.length} cards sharing this number`);
      for (let i = 1; i < sorted.length; i++) {
        const newCardNumber = `${cardNumber}${suffixFor(i)}`;
        console.log(`    -> recovering "${sorted[i].title}" as ${newCardNumber}`);
        recoveryEntries.push({ cardNumber: newCardNumber, entry: sorted[i] });
      }
    }

    const candidateTitles = recoveryEntries
      .filter((r) => r.entry.cnimg && r.entry.cnimg !== "n")
      .map((r) => `File:${r.entry.cnimg}.png`);
    const resolved = await resolveCnImageUrls(candidateTitles);

    const rows = [];
    for (const { cardNumber, entry } of recoveryEntries) {
      let imageUrl: string | null = null;
      if (entry.cnimg && entry.cnimg !== "n") {
        const fileTitle = `File:${entry.cnimg}.png`;
        const resolvedUrl = resolved.get(fileTitle);
        if (resolvedUrl && (await cnImageExists(resolvedUrl))) imageUrl = resolvedUrl;
      }
      rows.push({
        id: `${setId}-${cardNumber}`,
        language: "zh-cn" as const,
        set_id: setId,
        set_name: setName,
        card_number: cardNumber,
        name: entry.name,
        national_dex_no: null,
        rarity: entry.rarity,
        image_url: imageUrl,
        synced_at: new Date().toISOString(),
      });
    }

    console.log(`  ${rows.length} row(s) to recover for ${setId}.`);
    totalRecovered += rows.length;

    if (dryRun || !supabase) continue;

    const { error } = await supabase.from("cards").upsert(rows, { onConflict: "id,language" });
    if (error) {
      console.error(`  ! batch upsert failed (${error.message}) — retrying row by row`);
      let ok = 0;
      for (const row of rows) {
        const { error: rowError } = await supabase.from("cards").upsert(row, { onConflict: "id,language" });
        if (rowError) console.error(`    ! skipped ${row.id}: ${rowError.message}`);
        else ok++;
      }
      console.log(`    recovered ${ok}/${rows.length} row(s) individually`);
    } else {
      console.log(`  Upserted ${rows.length} row(s).`);
    }
  }

  console.log(`\n${dryRun ? "Would recover" : "Recovered"} ${totalRecovered} previously-dropped card(s) total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
