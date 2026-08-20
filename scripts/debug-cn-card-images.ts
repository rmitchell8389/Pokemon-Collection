// One-off diagnostic: for a given zh-cn set_id, prints the still-missing
// cards' raw card_number values plus the File: title this codebase would
// build for each, then tries to resolve that title against the live
// 52poke.com wiki API and reports whether it found a real image. Read-only
// on the database (no writes) — use this if backfill:images-cn fills far
// short of expectations for a specific set, to check whether the 3-digit
// zero-padding assumption in src/lib/cnimages.ts is wrong for that set.
//
// Usage:
//   npx tsx scripts/debug-cn-card-images.ts SV7a SV8a CSMPiC

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { buildWikiSetCode, buildCnImageFileTitle, resolveCnImageUrls } from "../src/lib/cnimages";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const supabase = createClient(url, serviceKey);
  const setIds = process.argv.slice(2);

  if (setIds.length === 0) {
    throw new Error("Pass one or more set ids, e.g. npx tsx scripts/debug-cn-card-images.ts SV7a SV8a CSMPiC");
  }

  for (const setId of setIds) {
    const code = buildWikiSetCode(setId);
    console.log(`\n=== ${setId} (wiki code: ${code ?? "UNMAPPED"}) ===`);

    if (!code) {
      console.log("  No wiki code mapping for this set_id — nothing to check.");
      continue;
    }

    const { data, error } = await supabase
      .from("cards")
      .select("card_number, name, set_name")
      .eq("language", "zh-cn")
      .eq("set_id", setId)
      .is("image_url", null)
      .order("card_number")
      .limit(10);

    if (error) {
      console.log(`  ! ${error.message}`);
      continue;
    }
    if (!data || data.length === 0) {
      console.log("  (none missing — already fully filled, or set_id not found)");
      continue;
    }

    console.log(`  set_name=${JSON.stringify(data[0].set_name)}`);

    const fileTitles = data
      .map((row) => buildCnImageFileTitle(setId, row.card_number))
      .filter((t): t is string => t !== null);
    const resolved = await resolveCnImageUrls(fileTitles);

    for (const row of data) {
      const fileTitle = buildCnImageFileTitle(setId, row.card_number);
      const resolvedUrl = fileTitle ? resolved.get(fileTitle) : undefined;
      console.log(
        `  card_number=${JSON.stringify(row.card_number)}  fileTitle=${fileTitle}  resolved=${resolvedUrl ?? "NOT FOUND"}  name=${row.name}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
