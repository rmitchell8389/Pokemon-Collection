// One-off diagnostic — NOT wired into any npm script on purpose, run directly.
//
// Lists every zh-cn set TCGdex's own API currently knows about. This sandbox
// can't reach api.tcgdex.net directly (network egress here is allowlisted and
// doesn't include it — same reason WebFetch got ROBOTS_DISALLOWED on the same
// URL), so this has to be run from your machine, same as every other script
// in this project.
//
// Usage:
//   npx tsx scripts/list-tcgdex-zhcn-sets.ts
//
// No Supabase/env vars needed — this only talks to TCGdex, doesn't touch the
// DB. Paste the full output back.
import { listSets } from "../src/lib/tcgdex";

async function main() {
  const sets = await listSets("zh-cn");
  console.log(`TCGdex zh-cn sets: ${sets.length} total\n`);
  const sorted = [...sets].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of sorted) {
    console.log(`${s.id}\t${s.name}\t${s.cardCount.official}/${s.cardCount.total}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
