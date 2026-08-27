// Confirms the 2,217-row --commit Ross just ran actually landed and
// actually reduced the round-12 gap, rather than just trusting
// import-cn-dynamax-clash.ts's own printed row count.
//
// Why this matters: round 12's reconciliation table already showed
// nonzero DB rows for every one of these 15 sets BEFORE any booster
// importer ever ran (e.g. CS1aC had 92, CS4aC had 71) — leftover stray
// hits from the old cnicon= reprint-pattern search (round 7's mechanism),
// not a real bulk import. The booster importer's row ids are
// `${setId}-${cardNumber}` (e.g. "CS1aC-001"). If the old stray rows
// happen to share that same id format, the upsert (onConflict "id,language")
// would have MERGED into them — meaning "current count" could land well
// below "old baseline + newly imported count". If the old rows use a
// different id scheme entirely, the two are additive and current count
// should be close to baseline + imported. Either way, printing the raw
// numbers side by side settles it instead of assuming.
//
// Usage: npx tsx scratch/round10/verify-round18-commit.ts
// (run from the repo root; needs .env.local for Supabase creds)

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// Round-12 baseline (data/zh-cn-round12-reconciliation.md), before any
// booster-set importer had ever run.
const ROUND12_BASELINE: Record<string, { target: number; baseline: number }> = {
  CS1aC: { target: 329, baseline: 92 },
  CS1bC: { target: 315, baseline: 63 },
  CS1DC: { target: 222, baseline: 0 },
  CSAC: { target: 24, baseline: 0 },
  "CS1.5C": { target: 141, baseline: 31 },
  CS2aC: { target: 241, baseline: 68 },
  CS2bC: { target: 241, baseline: 58 },
  "CS2.5C": { target: 126, baseline: 31 },
  CS3aC: { target: 290, baseline: 64 },
  CS3bC: { target: 283, baseline: 74 },
  CS3DC: { target: 183, baseline: 247 }, // already over target pre-import — flagged in round 12 as -64 gap
  "CS3.5C": { target: 147, baseline: 32 },
  CS4aC: { target: 295, baseline: 71 },
  CS4bC: { target: 288, baseline: 68 },
  "CS4.5C": { target: 136, baseline: 29 },
};

// What the --commit run itself reported upserting, from Ross's pasted
// terminal output.
const JUST_IMPORTED: Record<string, number> = {
  CS1aC: 217,
  CS1bC: 199,
  CS1DC: 230,
  CSAC: 24,
  "CS1.5C": 96,
  CS2aC: 143,
  CS2bC: 143,
  "CS2.5C": 79,
  CS3aC: 184,
  CS3bC: 177,
  CS3DC: 191,
  "CS3.5C": 90,
  CS4aC: 184,
  CS4bC: 177,
  "CS4.5C": 83,
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const supabase = createClient(url, serviceKey);

  const setIds = Object.keys(ROUND12_BASELINE);

  console.log(
    "set_id\ttarget\tround12_baseline\tjust_imported\tcurrent_db\tcurrent-baseline\tvs_target\tnote"
  );

  let totalBaseline = 0;
  let totalImported = 0;
  let totalCurrent = 0;

  for (const setId of setIds) {
    const { target, baseline } = ROUND12_BASELINE[setId];
    const imported = JUST_IMPORTED[setId];

    const { count, error } = await supabase
      .from("cards")
      .select("*", { count: "exact", head: true })
      .eq("language", "zh-cn")
      .eq("set_id", setId);

    if (error) {
      console.log(`${setId}\t${target}\t${baseline}\t${imported}\tERROR\t-\t-\t${error.message}`);
      continue;
    }

    const current = count ?? 0;
    const delta = current - baseline;
    const vsTarget = current - target;

    let note = "";
    if (current >= baseline + imported - 2 && current <= baseline + imported + 2) {
      note = "ADDITIVE — old stray rows and new import used different ids, both counted";
    } else if (current >= imported - 2 && current <= imported + 2) {
      note = "MERGED — upsert overwrote the old stray rows (same id scheme), current ≈ just the new import";
    } else if (current < imported - 2) {
      note = "SHORT — current DB count is LESS than what was just imported. Investigate.";
    } else {
      note = "UNEXPECTED — doesn't cleanly match either additive or merged pattern. Investigate.";
    }

    totalBaseline += baseline;
    totalImported += imported;
    totalCurrent += current;

    console.log(`${setId}\t${target}\t${baseline}\t${imported}\t${current}\t${delta}\t${vsTarget}\t${note}`);
  }

  console.log(
    `\nTOTALS\ttarget_sum=${setIds.reduce((s, id) => s + ROUND12_BASELINE[id].target, 0)}\tbaseline_sum=${totalBaseline}\timported_sum=${totalImported}\tcurrent_sum=${totalCurrent}`
  );
  console.log(
    `\nIf current_sum ≈ baseline_sum + imported_sum (${totalBaseline + totalImported}), the commit was additive and the gap dropped by ~${totalImported} cards as expected.`
  );
  console.log(
    `If current_sum ≈ imported_sum (${totalImported}) instead, the upsert merged into the old stray rows — still correct data, just means the "gap closed" figure should use current_sum, not current_sum - baseline_sum.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
