// URGENT CHECK: did today's booster-row --commit wipe image_url back to
// null for sets that already had images manually backfilled?
//
// Why this is a real risk, not paranoia: cnBoosterSetImport.ts's
// scoutBoosterSet() builds every row with `image_url: null` (see
// src/lib/cnBoosterSetImport.ts's BoosterSetResult mapping). The commit
// script upserts those rows with `onConflict: "id,language"`. If the
// pre-existing DB rows for a set used the SAME id convention
// ("${setId}-${cardNumber}") — which verify-round18-commit.ts's output
// suggests is true for CS1aC, CS1bC, CS1.5C, CS2aC, CS2bC, CS3aC, CS3bC,
// CS4aC, CS4bC, CS3.5C, CS4.5C (all showed "current ≈ just_imported",
// meaning the upsert overwrote existing rows in place rather than adding
// new ones) — then a plain Supabase upsert REPLACES every column in the
// payload, including image_url. If any of those overwritten rows
// previously had a real image_url set (from the manual-image-backfill
// rounds earlier in THIS session — CS3aC, CS1aC, CS1bC, CS2aC, CS2bC,
// CS4aC, CS4bC are all on that backfill-completed list), today's commit
// may have just silently nulled them back out.
//
// This script checks image_url coverage right now for exactly the sets
// where both things are true (booster-importer overwrote existing rows
// AND those rows were previously backfilled with images this session).
//
// Usage: npx tsx scratch/round10/check-images-after-commit.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// Sets that (a) showed the MERGED pattern in verify-round18-commit.ts
// (meaning the booster importer overwrote pre-existing rows) AND (b) were
// previously reported as image-backfill-complete earlier this session.
const CHECK_SETS = ["CS1aC", "CS1bC", "CS2aC", "CS2bC", "CS3aC", "CS3bC", "CS4aC", "CS4bC"];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  console.log("set_id\ttotal_rows\thas_image\tmissing_image\tpct_missing");

  for (const setId of CHECK_SETS) {
    const { count: total, error: totalErr } = await supabase
      .from("cards")
      .select("*", { count: "exact", head: true })
      .eq("language", "zh-cn")
      .eq("set_id", setId);
    if (totalErr) {
      console.log(`${setId}\tERROR\t${totalErr.message}`);
      continue;
    }

    const { count: missing, error: missingErr } = await supabase
      .from("cards")
      .select("*", { count: "exact", head: true })
      .eq("language", "zh-cn")
      .eq("set_id", setId)
      .is("image_url", null);
    if (missingErr) {
      console.log(`${setId}\tERROR\t${missingErr.message}`);
      continue;
    }

    const t = total ?? 0;
    const m = missing ?? 0;
    const has = t - m;
    const pct = t > 0 ? ((m / t) * 100).toFixed(1) : "0.0";
    console.log(`${setId}\t${t}\t${has}\t${m}\t${pct}%`);
  }

  console.log(
    "\nIf missing_image is near 100% for CS1aC/CS1bC/CS2aC/CS2bC/CS3aC/CS3bC/CS4aC/CS4bC, " +
      "today's commit wiped the manually-backfilled images for these sets — they'll need to be " +
      "re-run through the same manual-paste workflow. If missing_image is low (matching what " +
      "report:missing-images showed before today's commit), the images survived and this was a false alarm."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
