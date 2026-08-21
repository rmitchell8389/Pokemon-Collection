// Imports real Japanese card data (name, rarity, image) from
// limitlesstcg.com for the ~92 sets TCGdex declares but has zero per-card
// data for — see src/lib/limitlessCardImport.ts for how the page format was
// verified, and the spec doc's "Japanese card catalog completeness"
// section for how this list of sets was found.
//
// This is a BIG job — 92 sets, likely several thousand cards total once
// each set's real total is read off its own page (which can be larger than
// TCGdex's declared count, confirmed for S4a: TCGdex says 190, real is
// 326). Strongly recommend testing on ONE set first before running the
// full list — pass --set=<id> to do that.
//
// Usage:
//   npx tsx scripts/import-jp-limitless-cards.ts --set=S4a           # dry run, one set
//   npx tsx scripts/import-jp-limitless-cards.ts --set=S4a --commit  # write, one set
//   npx tsx scripts/import-jp-limitless-cards.ts                     # dry run, all active sets
//   npx tsx scripts/import-jp-limitless-cards.ts --commit            # write, all active sets
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local, same as sync-cards.ts.
// Talks to limitlesstcg.com directly — this sandbox can't reach it, so like
// every other script here, run this from your own machine.
//
// UPDATE 2026-08-21: the first full dry run (all 92 of TCGdex's declared-
// but-empty ja sets) 404'd entirely on 24 of them at the set-info-fetch
// step. Investigated each one for real (see limitlessCardImport.ts's
// LIMITLESS_SET_ID_OVERRIDES comment for how) rather than guessing:
//   - 11 were a genuine TCGdex-id-vs-Limitless-code mismatch, same category
//     as the pre-existing "M-P"->"MP" fix — now handled automatically via
//     LIMITLESS_SET_ID_OVERRIDES, so they stay in TARGET_SETS below and
//     will resolve on the next run.
//   - 11 (ADV1-5, L1a/L1b/L2/L3/LL, PCG10) are pre-2011 vintage sets —
//     direct re-checks confirm Limitless's Japanese coverage genuinely
//     doesn't reach back that far (same documented cutoff as
//     limitlesstcg.ts's image-URL gap). Moved to KNOWN_UNAVAILABLE_SETS so
//     this script stops wasting a request on them every run.
//   - 2 (XY8a, XY11a) are real mid-2010s sets that are probably on
//     Limitless under some other code, but that code wasn't found. Moved
//     to UNRESOLVED_SETS rather than guessed at — pick this back up before
//     assuming ja is "done".

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { fetchLimitlessSetInfo, fetchLimitlessCard, LimitlessNotFoundError, sleep } from "../src/lib/limitlessCardImport";
import { buildLimitlessJpImageCandidates, limitlessImageExists } from "../src/lib/limitlesstcg";

const CONCURRENCY = 4;

// TCGdex's own declared name for each set (from a real
// `list-tcgdex-sets.ts --lang=ja` run, 2026-08-20) — used for set_name
// since TCGdex's naming here is trustworthy even though its card-level
// data for these sets is empty. The 15 "CS*"/"CSA" ids that all declared
// as the same set (トリプレットビート / Triplet Beat, already correctly
// synced once as SV1a) are deliberately NOT in this list — that was
// TCGdex duplicate-metadata noise, not 15 real missing sets.
// Real, but Limitless has no Japanese coverage for them at all (confirmed
// 2026-08-21 — see the UPDATE comment above and in
// limitlessCardImport.ts). Not fetched. Kept here only so the ~19,500-card
// ja gap this list was built to close is documented as "can't fill this
// part from Limitless", not silently forgotten.
const KNOWN_UNAVAILABLE_SETS: { id: string; name: string }[] = [
  { id: "ADV1", name: "拡張パック" },
  { id: "ADV2", name: "砂漠のきせき" },
  { id: "ADV3", name: "天空の覇者" },
  { id: "ADV4", name: "強化拡張パックex1マグマVSアクア ふたつの野望" },
  { id: "ADV5", name: "とかれた封印" },
  { id: "L1a", name: "ハートゴールドコレクション" },
  { id: "L1b", name: "ソウルシルバーコレクション" },
  { id: "L2", name: "よみがえる伝説" },
  { id: "L3", name: "頂上大激突" },
  { id: "LL", name: "強化パック ロストリンク" },
  { id: "PCG10", name: "ワールドチャンピオンズパック" },
];

// Real, probably real Limitless coverage too (neither is vintage), but the
// correct Limitless set code hasn't been found — see the UPDATE comment
// above. Not fetched until resolved, rather than guessed at.
const UNRESOLVED_SETS: { id: string; name: string }[] = [
  { id: "XY8a", name: "青い衝撃" },
  { id: "XY11a", name: "爆熱の闘士" },
];

const TARGET_SETS: { id: string; name: string }[] = [
  { id: "CP2", name: "伝説キラコレクション" },
  { id: "CP3", name: "ポケキュンコレクション" },
  { id: "CP4", name: "プレミアムチャンピオンパック EX×M×BREAK" },
  { id: "CP5", name: "冷酷の反逆者" },
  { id: "CP6", name: "ポケットモンスターカードゲーム 拡張パック 20th Anniversary" },
  { id: "S10a", name: "ダークファンタズマ" },
  { id: "S10b", name: "Pokémon GO" },
  { id: "S10D", name: "タイムゲイザー" },
  { id: "S10P", name: "スペースジャグラー" },
  { id: "S11", name: "ロストアビス" },
  { id: "S11a", name: "白熱のアルカナ" },
  { id: "S1a", name: "VMAXライジング" },
  { id: "S1H", name: "シールド" },
  { id: "S1W", name: "ソード" },
  { id: "S2", name: "反逆クラッシュ" },
  { id: "S2a", name: "爆炎ウォーカー" },
  { id: "S3", name: "ムゲンゾーン" },
  { id: "S3a", name: "伝説の鼓動" },
  { id: "S4", name: "仰天のボルテッカー" },
  { id: "S4a", name: "シャイニースターV" },
  { id: "S5a", name: "双璧のファイター" },
  { id: "S5I", name: "一撃マスター" },
  { id: "S5R", name: "連撃マスター" },
  { id: "S6a", name: "イーブイヒーローズ" },
  { id: "S6H", name: "白銀のランス" },
  { id: "S6K", name: "漆黒のガイスト" },
  { id: "S7D", name: "摩天パーフェクト" },
  { id: "S7R", name: "蒼空ストリーム" },
  { id: "S8", name: "フュージョンアーツ" },
  { id: "S8a", name: "25th アニバーサリーコレクション" },
  { id: "S8b", name: "VMAXクライマックス" },
  { id: "SM0", name: "ピカチュウと新しい仲間たち" },
  { id: "SM1+", name: "サン＆ムーン" },
  { id: "SM10b", name: "スカイレジェンド" },
  { id: "SM11a", name: "リミックスバウト" },
  { id: "SM1M", name: "コレクションムーン" },
  { id: "SM1S", name: "コレクションサン" },
  { id: "sm2+", name: "新たなる試練の向こう" },
  { id: "SM2K", name: "キミを待つ島々" },
  { id: "SM2L", name: "アローラの月光" },
  { id: "SM3+", name: "ひかる伝説" },
  { id: "SM3H", name: "闘う虹を見たか" },
  { id: "SM3N", name: "光を喰らう闇" },
  { id: "SM4+", name: "GXバトルブースト" },
  { id: "SM4A", name: "超次元の暴獣" },
  { id: "SM4S", name: "覚醒の勇者" },
  { id: "SM5+", name: "ウルトラフォース" },
  { id: "SM5M", name: "ウルトラムーン" },
  { id: "SM5S", name: "ウルトラサン" },
  { id: "SM6", name: "禁断の光" },
  { id: "SM6a", name: "ドラゴンストーム" },
  { id: "SM6b", name: "チャンピオンロード" },
  { id: "SM7", name: "裂空のカリスマ" },
  { id: "SM7a", name: "迅雷スパーク" },
  { id: "SM7b", name: "フェアリーライズ" },
  { id: "SM8", name: "超爆インパクト" },
  { id: "SM8a", name: "ダークオーダー" },
  { id: "SM8b", name: "GXウルトラシャイニー" },
  { id: "SM9", name: "タッグボルト" },
  { id: "SM9a", name: "ナイトユニゾン" },
  { id: "SM9b", name: "フルメタルウォール" },
  { id: "SMP2", name: "名探偵ピカチュウ" },
  { id: "sn10a", name: "ジージーエンド" },
  { id: "sn11", name: "ミラクルツイン" },
  { id: "SV5M", name: "サイバージャッジ" },
  { id: "SV6a", name: "ナイトワンダラー" },
  { id: "XY10", name: "めざめる超王" },
  { id: "XY11b", name: "冷酷の反逆者" },
  { id: "XY1a", name: "コレクションX" },
  { id: "XY1b", name: "コレクションY" },
  { id: "XY2", name: "ワイルドブレイズ" },
  { id: "XY3", name: "ライジングフィスト" },
  { id: "XY4", name: "ファントムゲート" },
  { id: "XY5a", name: "ガイアボルケーノ" },
  { id: "XY5b", name: "タイダルストーム" },
  { id: "XY6", name: "エメラルドブレイク" },
  { id: "XY7", name: "バンデットリング" },
  { id: "XY8b", name: "赤い閃光" },
  { id: "XY9", name: "破天の怒り" },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const setArg = args.find((a) => a.startsWith("--set="))?.split("=")[1];
  return { commit, setFilter: setArg };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function padCardNumber(n: number): string {
  return String(n).padStart(3, "0");
}

async function main() {
  const { commit, setFilter } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local and fill them in.");
  }
  const supabase = createClient(url, serviceKey);

  const sets = setFilter ? TARGET_SETS.filter((s) => s.id === setFilter) : TARGET_SETS;
  if (setFilter && sets.length === 0) {
    throw new Error(`"${setFilter}" isn't in the target set list. Check the TARGET_SETS array in this script for valid ids.`);
  }

  console.log(`${commit ? "COMMIT" : "DRY RUN"} — ${sets.length} set(s) to process`);
  if (!setFilter) {
    console.log(
      `(${KNOWN_UNAVAILABLE_SETS.length} set(s) skipped — no Japanese coverage on Limitless at all, see KNOWN_UNAVAILABLE_SETS: ${KNOWN_UNAVAILABLE_SETS.map((s) => s.id).join(", ")})`
    );
    console.log(
      `(${UNRESOLVED_SETS.length} set(s) skipped — real Limitless id not found yet, see UNRESOLVED_SETS: ${UNRESOLVED_SETS.map((s) => s.id).join(", ")})`
    );
  }
  console.log();

  let grandTotalParsed = 0;
  let grandTotalSkipped = 0;
  let grandTotalWithImage = 0;

  for (const set of sets) {
    let info;
    try {
      info = await fetchLimitlessSetInfo(set.id);
    } catch (err) {
      console.error(`! ${set.id}: couldn't read the set's real total — ${(err as Error).message}`);
      continue;
    }

    console.log(`${set.id} (${set.name}) — ${info.totalCards} real card(s) per Limitless`);

    const numbers = Array.from({ length: info.totalCards }, (_, i) => i + 1);
    let parsed = 0;
    let skipped = 0;
    let withImage = 0;
    const skippedNumbers: number[] = [];

    const rows = await mapWithConcurrency(numbers, CONCURRENCY, async (n) => {
      try {
        const card = await fetchLimitlessCard(set.id, n);
        const cardNumber = padCardNumber(n);

        const candidates = buildLimitlessJpImageCandidates(set.id, cardNumber, "LG");
        let imageUrl: string | null = null;
        for (const candidate of candidates) {
          if (await limitlessImageExists(candidate)) {
            imageUrl = candidate;
            break;
          }
        }
        if (imageUrl) withImage++;

        parsed++;
        return {
          id: `${set.id}-${cardNumber}`,
          language: "ja" as const,
          set_id: set.id,
          set_name: set.name,
          card_number: cardNumber,
          name: card.name,
          national_dex_no: null,
          rarity: card.rarity,
          image_url: imageUrl,
          synced_at: new Date().toISOString(),
        };
      } catch (err) {
        skipped++;
        if (err instanceof LimitlessNotFoundError) {
          // A gap in numbering (e.g. a withdrawn/renumbered card) — not
          // worth an individual error line, but the exact number IS
          // recorded (see skippedNumbers below) so a real pattern across
          // several sets is visible instead of just a count.
          skippedNumbers.push(n);
        } else {
          console.error(`  ! ${set.id}/${n}: ${(err as Error).message}`);
        }
        return null;
      }
    });

    const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    grandTotalParsed += parsed;
    grandTotalSkipped += skipped;
    grandTotalWithImage += withImage;

    console.log(`  parsed ${parsed}/${info.totalCards}, ${skipped} skipped, ${withImage} with a verified image`);
    if (skippedNumbers.length > 0) {
      console.log(`    skipped numbers: ${skippedNumbers.sort((a, b) => a - b).join(", ")}`);
    }

    if (commit && validRows.length > 0) {
      const { error } = await supabase.from("cards").upsert(validRows, { onConflict: "id,language" });
      if (error) {
        console.error(`  ! batch upsert failed for ${set.id} (${error.message}) — retrying row by row`);
        let ok = 0;
        for (const row of validRows) {
          const { error: rowError } = await supabase.from("cards").upsert(row, { onConflict: "id,language" });
          if (rowError) {
            console.error(`    ! skipped ${row.id}: ${rowError.message}`);
          } else {
            ok++;
          }
        }
        console.log(`    recovered ${ok}/${validRows.length} card(s) individually`);
      }
    }

    // A small pause between sets (not between individual card fetches,
    // those already run at limited concurrency) — considerate-citizen
    // pacing for a real production site, same spirit as sync-cards.ts's
    // concurrency cap.
    await sleep(500);
  }

  console.log(`\n${commit ? "Committed" : "Dry run complete"}: ${grandTotalParsed} card(s) parsed, ${grandTotalSkipped} skipped, ${grandTotalWithImage} with a verified image, across ${sets.length} set(s).`);
  if (!commit) {
    console.log(`Nothing was written — re-run with --commit to write these rows.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
