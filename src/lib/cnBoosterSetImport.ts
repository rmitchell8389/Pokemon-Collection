// Importer for the plain numbered zh-cn booster sets — the round-12 finding
// (see claude/spec.md "zh-cn round 12") that the 28 main numbered expansions
// account for a combined 6,838-card gap and have never had a dedicated
// importer, unlike starter decks/promos/Happy Sets/Gem Packs which all
// already have one.
//
// Round 13 piloted this on the CS1 (Dynamax Clash) line and confirmed real
// wiki articles exist using the SAME bulk-table field shape
// cnStarterDeckImport.ts already parses:
//
//   {{卡牌列表/entryjp|POS/TOTAL|{{C|NAME|ORIGIN}}|TYPE||RARITY}}
//   {{卡牌列表/entry|POS/TOTAL|{{C|NAME|ORIGIN}}|TYPE||RARITY}}    (same shape, different marker string)
//   {{卡牌列表/entryjp|POS/TOTAL|{{TCG|NAME}}|CATEGORY||RARITY}}
//   {{卡牌列表/entry|—|{{TCG|NAME}}|能量卡|ENERGY-TYPE|RARITY}}    (unnumbered energy: literal em-dash "—" position, not a real number)
//
// Confirmed via real captured wikitext (data/wiki-raw/dynamax-clash-round13-raw.txt):
//   CS1aC "极巨争锋 雷（TCG）" — uses {{卡牌列表/entryjp|...}}, 217 raw entries
//   CSAC  "极巨争锋 卡组构筑礼盒（TCG）" — uses {{卡牌列表/entryjp|...}}, 24 raw entries
//   CS1.5C "极巨攻防（TCG）" — uses {{卡牌列表/entryjp|...}}, 96 raw entries
//   CS1DC "V起始卡组 极巨争锋（TCG）" — uses {{卡牌列表/entry|...}} (NO jp — different
//         marker, but the SAME field shape, confirmed byte-for-byte), 230 raw entries
// CS1bC "极巨争锋 炎（TCG）" 404'd — round 13's title guess used the wrong
// character (炎 vs 焰). CS1aC's own page names its sibling directly via
// {{ExpansionPrevNext|...|other=极巨争锋 焰}} — corrected here to
// "极巨争锋 焰（TCG）", NOT independently fetched/confirmed yet (this
// session's WebFetch hit a hard rate limit against wiki.52poke.com partway
// through round 13 and never recovered) — first thing to check when this
// runs live.
//
// Both marker strings are searched independently — "{{卡牌列表/entry|" as a
// literal substring does NOT match inside "{{卡牌列表/entryjp|" (the
// character after "entry" differs, "j" vs "|"), so there's no double-count
// risk searching for both.
//
// Same duplicate-position auto-disambiguation as every other zh-cn importer
// in this project (CS1DC's own data confirms printed positions run past its
// own TOTAL — 221/207 — meaning real position reuse happens here too, same
// holo/non-holo-pair pattern as everywhere else).

import { fetchFullContent, sleep } from "./cnReprintImport";
import type { CardRow } from "./cnReprintImport";

export interface BoosterSetDef {
  setId: string; // TCG Collector's scheme, e.g. "CS1aC"
  pageTitle: string;
}

// Round 13 pilot — the CS1 (Dynamax Clash) line. All 5 titles confirmed
// real and committed live (766 rows, zero errors) — see claude/spec.md
// "zh-cn round 13".
//
// Round 14 — CS2 (Vivid Portrayals) line. CS2aC/CS2bC titles came straight
// from CS1.5C's own {{ExpansionPrevNext|...}} template (no more guessing —
// see cnBoosterSetImport.ts's round-13 header note), confirmed real via the
// raw capture (data/wiki-raw/vivid-portrayals-round14-raw.txt): both use
// {{卡牌列表/entryjp|...}}, 143 entries each. CS2.1C ("Meowth's Little
// Tricks") and CS2.5C ("Brilliant Counterattack") guessed titles both
// 404'd — CS2.5C's real title was found afterward via CS2aC's OWN chain
// reference (`next=璀璨反击`) and is queued for round 15; CS2.1C's real
// title is still unknown.
export const BOOSTER_SETS: BoosterSetDef[] = [
  { setId: "CS1aC", pageTitle: "极巨争锋 雷（TCG）" },
  { setId: "CS1bC", pageTitle: "极巨争锋 焰（TCG）" },
  { setId: "CS1DC", pageTitle: "V起始卡组 极巨争锋（TCG）" },
  { setId: "CSAC", pageTitle: "极巨争锋 卡组构筑礼盒（TCG）" },
  { setId: "CS1.5C", pageTitle: "极巨攻防（TCG）" },
  { setId: "CS2aC", pageTitle: "浓墨重彩 黎（TCG）" },
  { setId: "CS2bC", pageTitle: "浓墨重彩 靛（TCG）" },
  // Round 15 — CS2.5C's real title ("璀璨反击") came from CS2aC's own chain
  // reference, confirmed real (79 cards) via
  // data/wiki-raw/brilliant-counterattack-round15-raw.txt. Its own chain
  // reference in turn names CS3aC/CS3bC directly: `next=洪荒演武 茂|next2=洪荒演武 激`.
  { setId: "CS2.5C", pageTitle: "璀璨反击（TCG）" },
  // Round 16 — CS3aC/CS3bC/CS3DC (Primordial Arts line), all three confirmed
  // real via data/wiki-raw/primordial-arts-round16-raw.txt:
  //   CS3aC "洪荒演武 茂（TCG）" — 184 raw entries (positions 001-184 against a
  //     stated total of 125, as usual TOTAL is decorative, not the real count).
  //   CS3bC "洪荒演武 激（TCG）" — 177 raw entries (positions 001-177 against a
  //     stated total of 122).
  //   CS3DC "V起始卡组 洪荒演武（TCG）" — 191 raw entries: 183 numbered
  //     (positions 001-183 against a stated total of 170; infobox separately
  //     claims cards=178 — a THIRD, also-wrong number, ignored as always) plus
  //     8 unnumbered basic-energy cards (literal "—" position, same pattern as
  //     CS1DC). Three raw lines (166/070, 167/132, 168/190) have a TOTAL field
  //     that varies per line instead of staying constant — a wiki-source
  //     copy-paste artifact — but the position regex only reads the numerator,
  //     so 166/167/168 parse correctly regardless. Validated in
  //     scripts/validate-dynamax-clash-parser.ts.
  //   CS3aC's own chain reference also confirms both siblings independently
  //   (`other=洪荒演武 激|other2=V起始卡组 洪荒演武`) and names the next set in
  //   the chain: `next=怒炎灼天` — round 17's target.
  //   A 4th round-16 guess, "洪荒演武 卡组构筑礼盒（TCG）" for CSBC/CSCC (the
  //   Primordial Arts gift boxes), 404'd — those two sets' real titles are
  //   still unknown.
  { setId: "CS3aC", pageTitle: "洪荒演武 茂（TCG）" },
  { setId: "CS3bC", pageTitle: "洪荒演武 激（TCG）" },
  { setId: "CS3DC", pageTitle: "V起始卡组 洪荒演武（TCG）" },
  // Round 18 — CS3.5C bridges the CS3 (Primordial Arts) and CS4 (Nine
  // Colors Gathering) lines; CS4aC/CS4bC/CS4.5C confirmed real via
  // data/wiki-raw/nine-colors-gathering-round18-raw.txt:
  //   CS3.5C "怒炎灼天（TCG）" — 90 raw entries (positions 001-090 against a
  //     stated total of 66). Named as "next" by BOTH CS3aC's and CS3bC's
  //     own chain references. Its own chain in turn names both CS4 sets:
  //     `next=九彩汇聚 朋|next2=九彩汇聚 源`.
  //   CS4aC "九彩汇聚 朋（TCG）" — 184 raw entries (positions 001-184 against
  //     a stated total of 132). Chain: `next=终末炎舞|other=九彩汇聚 谱`.
  //   CS4bC "九彩汇聚 源（TCG）" — 177 raw entries (positions 001-177 against
  //     a stated total of 132). Chain: `next=终末炎舞|other=九彩汇聚 朋`.
  //   CS4.5C "终末炎舞（TCG）" — 83 raw entries (positions 001-083 against a
  //     stated total of 63). Confirmed real (own page text mentions
  //     "CS4.5C" directly, not just a chain-ref guess) — its own chain
  //     reference names the round-19 targets: `other=伊布进阶礼盒|next=勇魅群星 魅|next2=勇魅群星 勇`.
  //   All four validated offline with zero duplicate positions and fully
  //   sequential 1-N numbering in scripts/validate-dynamax-clash-parser.ts.
  //   Two more titles from this round's chain refs 404'd and remain
  //   unidentified: "九彩汇聚 谱（TCG）" (unknown CS4-family set — could be a
  //   starter deck or gift box) and the carried-over CSBC/CSCC ("洪荒演武
  //   双人对战卡组") and CS2.1C ("猫铃奇计 卡组构筑礼盒") guesses.
  { setId: "CS3.5C", pageTitle: "怒炎灼天（TCG）" },
  { setId: "CS4aC", pageTitle: "九彩汇聚 朋（TCG）" },
  { setId: "CS4bC", pageTitle: "九彩汇聚 源（TCG）" },
  { setId: "CS4.5C", pageTitle: "终末炎舞（TCG）" },
  // Round 19 — CS5aC/CS5bC (Brave Stars) and CS5.5C (the bridge to CS6),
  // all confirmed real via data/wiki-raw/gallant-galaxy-round19-raw.txt:
  //   CS5aC "勇魅群星 魅（TCG）" — 176 raw entries (positions 001-176 against
  //     a stated total of 127). A light WebFetch lookup earlier this same
  //     round briefly misread the middle character as "魂" instead of "魅"
  //     in one of two independent fetches — the raw capture below settles
  //     it: "魅" is correct (confirmed byte-for-byte from the actual page
  //     text, not a summarized paraphrase). Chain: `prev=终末炎舞,
  //     other=勇魅群星 勇, next=暗影夺辉`.
  //   CS5bC "勇魅群星 勇（TCG）" — 178 raw entries (positions 001-178 against
  //     a stated total of 128). Chain: `prev=终末炎舞, other=勇魅群星 魅,
  //     next=暗影夺辉`.
  //   CS5.5C "暗影夺辉（TCG）" — 89 raw entries (positions 001-089 against a
  //     stated total of 66). Its own chain reference names the round-20
  //     targets DIRECTLY, not guessed: `prev=勇魅群星 魅, prev2=勇魅群星 勇,
  //     next=碧海暗影 啸, next2=碧海暗影 逐` — the CS6aC/CS6bC pair (matches
  //     this project's own "Shadow of the Blue Sea" translation for that
  //     code family exactly: 碧海暗影 = "blue sea shadow").
  //   All three validated offline with zero duplicate positions and fully
  //   sequential 1-N numbering in scripts/validate-dynamax-clash-parser.ts.
  //   A 4th title captured this round, "伊布进阶礼盒（TCG）" (Eevee Advanced
  //   Gift Boxes, alt=CSHC, 9 real cards under a `{{未完成}}` "incomplete
  //   article" tag) — confirmed real but NOT part of the 29-code booster
  //   family per round-12's reconciliation (it's a small gift-box product,
  //   same category as CSAC/CSBC/CSCC). Not added to BOOSTER_SETS; flagged
  //   as a real, tiny, separate opportunity if Ross wants every last card,
  //   not pursued as part of this gap-closing effort.
  { setId: "CS5aC", pageTitle: "勇魅群星 魅（TCG）" },
  { setId: "CS5bC", pageTitle: "勇魅群星 勇（TCG）" },
  { setId: "CS5.5C", pageTitle: "暗影夺辉（TCG）" },
  // Round 20 — CS6aC/CS6bC (Shadow of the Blue Sea), both confirmed real
  // via data/wiki-raw/shadow-blue-sea-round20-raw.txt. Neither title was a
  // guess — both came directly from CS5.5C's own chain reference:
  //   CS6aC "碧海暗影 啸（TCG）" — 169 raw entries (positions 001-169 against
  //     a stated total of 131). Chain: `prev=暗影夺辉, other=碧海暗影 逐,
  //     next=胜象星引`.
  //   CS6bC "碧海暗影 逐（TCG）" — 172 raw entries (positions 001-172 against
  //     a stated total of 131). Chain: `prev=暗影夺辉, other=碧海暗影 啸,
  //     next=胜象星引`.
  //   Both validated offline with zero duplicate positions and fully
  //   sequential 1-N numbering in scripts/validate-dynamax-clash-parser.ts.
  //   Both name the SAME next title, "胜象星引（TCG）" — round 21's target,
  //   not yet fetched. This is the first title in the chain past CS1-CS6
  //   (Sword & Shield line) — plausibly the start of the CSM (Storming
  //   Emergence) or CSV (Scarlet & Violet) line the round-12 reconciliation
  //   still needs a way into, but genuinely unconfirmed until fetched.
  { setId: "CS6aC", pageTitle: "碧海暗影 啸（TCG）" },
  { setId: "CS6bC", pageTitle: "碧海暗影 逐（TCG）" },
  // Round 21 — CS6.5C (胜象星引, "Victory Lodestar"), the bridge set after
  // CS6aC/CS6bC, same pattern as CS3.5C/CS4.5C/CS5.5C. Confirmed real via
  // data/wiki-raw/victory-lodestar-round21-raw.txt — named directly by
  // BOTH CS6aC's and CS6bC's own chain references (`next=胜象星引`), not a
  // guess. alt=CS6.5C, cards=72+ (denominator stays at 072 while the
  // numerator continues past it for the SR/HR/SAR/UR chase-card tail —
  // same quirk already handled by this project's own CS3DC precedent).
  //   96 raw entries, positions 001-096, zero duplicate positions, fully
  //   sequential. First card 阿罗拉 椰蛋树V, last card V防守能量 (energy card).
  //   Its own chain reference names TWO next titles, not one:
  //     `prev=碧海暗影 啸, prev2=碧海暗影 逐, next=收集啦151 旅, next2=亘古开来`
  //   Both "收集啦151 旅" and "亘古开来" are new leads past the entire CS1-CS6
  //   family — "收集啦151" plausibly maps to a Scarlet & Violet-era "151"
  //   crossover product, and "亘古开来" ("since time immemorial") plausibly
  //   maps to an "ancient"-themed Scarlet & Violet set. Both genuinely
  //   unconfirmed until fetched — round 22's targets, named directly by
  //   this page, not guessed. This may finally be the doorway into the
  //   CSV line the round-12 reconciliation has been missing.
  { setId: "CS6.5C", pageTitle: "胜象星引（TCG）" },
  // Round 22 — BREAKTHROUGH: this is the doorway into the CSV (Scarlet &
  // Violet, "朱&紫系列") line the round-12 reconciliation has been missing.
  // Both of CS6.5C's chain-ref targets (round 21's leads) resolved real via
  // data/wiki-raw/ancient-times-future-progress-round22-raw.txt (the page's
  // own interwiki link confirms the official English name: "Ancient Times,
  // Future Progress"):
  //   "亘古开来（TCG）" — alt=CSV1C. **This is CSV1C, the first of the
  //     10-code CSV1C-CSV10C family named in the original gap list.**
  //     167 raw entries (positions 001-167 against a stated total of 127),
  //     zero duplicate positions, fully sequential, no gaps. First card
  //     榛果球, last card 宝可梦交替 (item card). Its own chain reference:
  //     `prev=胜象星引, next=奇迹启程, other=收集啦151 旅, other2=宝石包 第一弹`
  //     — names round 23's target directly: "奇迹启程" (plausibly CSV2C).
  //   "收集啦151 旅（TCG）" — alt=151C. Also confirmed real (186 raw entries,
  //     zero duplicate positions, positions 1-192 with 6 intentional gaps
  //     in the wiki's own numbering at 171-173/189-191 — not a parsing
  //     bug, just unlisted slots). But "151C" does NOT match the "CS"-
  //     prefixed naming convention of the 29-code core family (CS1-CS6,
  //     CSM1-2, CSV1-10) — same category as CSHC (伊布进阶礼盒): a real,
  //     separate crossover product ("Pokémon 151" tie-in), NOT added to
  //     BOOSTER_SETS. Its own chain (`next=收集啦151 望, other=亘古开来,
  //     other2=宝石包 第一弹`) leads to more of this same side-line if Ross
  //     ever wants full completeness, not pursued as part of this
  //     gap-closing effort.
  { setId: "CSV1C", pageTitle: "亘古开来（TCG）" },
  // Round 23 — CSV2C (奇迹启程, "Miracle Journey"), named directly by
  // CSV1C's own chain reference (`next=奇迹启程`), not a guess. Confirmed
  // real via data/wiki-raw/miracle-journey-round23-raw.txt. alt=CSV2C,
  // cards=128+35. 163 raw entries, positions 001-163, zero duplicate
  // positions, fully sequential, no gaps. First card 赫拉克罗斯, last card
  // 深钵镇 (stadium card). Chain: `prev=亘古开来, next=无畏太晶, other=`
  // (empty other/other2 this time, unlike CSV1C/CS6.5C — straight
  // single-strand chain here). Names round 24's target directly:
  // "无畏太晶" (plausibly CSV3C), not yet fetched.
  { setId: "CSV2C", pageTitle: "奇迹启程（TCG）" },
  // Round 24 — CSV3C (无畏太晶, "Fearless Terastal"), named directly by
  // CSV2C's own chain reference (`next=无畏太晶`), not a guess. Confirmed
  // real via data/wiki-raw/fearless-terastal-round24-raw.txt. alt=CSV3C,
  // cards=130+35. 165 raw entries, positions 001-165, zero duplicate
  // positions, fully sequential, no gaps. First card 毽子草, last card
  // 反转能量 (energy card). Chain: `prev=奇迹启程, next=嘉奖回合,
  // other=嗨皮组合 路卡利欧&甲贺忍蛙&藏玛然特&獒教父, other2=宝石包 第二弹`
  // — names round 25's target directly: "嘉奖回合" (plausibly CSV4C), not
  // yet fetched. The `other`/`other2` side leads (a Happy Set combo and a
  // second Gem Pack wave) are real but out of scope, same as round 22's
  // "收集啦151 旅" and "宝石包 第一弹".
  { setId: "CSV3C", pageTitle: "无畏太晶（TCG）" },
  // Round 25 — CSV4C (嘉奖回合, "Bonus Round"), named directly by CSV3C's
  // own chain reference (`next=嘉奖回合`), not a guess. Confirmed real via
  // data/wiki-raw/bonus-round-round25-raw.txt. alt=CSV4C, cards=129+36.
  // 165 raw entries, positions 001-165, zero duplicate positions, fully
  // sequential, no gaps. First card 飞天螳螂, last card 海滩场地 (stadium
  // card). Chain: `prev=无畏太晶, next=黑晶炽诚, other=收集啦151 惊,
  // other2=对战派对 耀梦 上` — names round 26's target directly: "黑晶炽诚"
  // (plausibly CSV5C), not yet fetched. The two `other` fields (more of
  // the 151 side-line, a Battle Party product) are real but out of
  // core-family scope, same as prior rounds' side leads.
  { setId: "CSV4C", pageTitle: "嘉奖回合（TCG）" },
  // Round 26 — CSV5C (黑晶炽诚, "Ardent Obsidian"), named directly by
  // CSV4C's own chain reference (`next=黑晶炽诚`), not a guess. Confirmed
  // real via data/wiki-raw/ardent-obsidian-round26-raw.txt. alt=CSV5C,
  // cards=129+35. 164 raw entries, positions 001-164, zero duplicate
  // positions, fully sequential, no gaps (two different cards at
  // positions 124/125 happen to share a printed name, "帕底亚的学生" —
  // distinct positions, not a collision). First card 走路草, last card
  // 不服输头带 (tool card). Chain: `prev=嘉奖回合, next=真实玄虚,
  // other=嗨皮组合 七夕青鸟&拉帝欧斯&烈焰猴&一家鼠, other2=` — names round
  // 27's target directly: "真实玄虚" (plausibly CSV6C), not yet fetched.
  { setId: "CSV5C", pageTitle: "黑晶炽诚（TCG）" },
  // Round 27 — CSV6C (真实玄虚, "Arcane Truth"), named directly by CSV5C's
  // own chain reference (`next=真实玄虚`), not a guess. Confirmed real via
  // data/wiki-raw/arcane-truth-round27-raw.txt. alt=CSV6C, cards=128+35.
  // 163 raw entries, positions 001-163, zero duplicate positions, fully
  // sequential, no gaps. First card 溜溜糖球, last card 朋友手册 (item card).
  // Chain: `prev=黑晶炽诚, next=利刃猛醒, other=游历专题包, other2=` — names
  // round 28's target directly: "利刃猛醒". NOTE: this title is already
  // confirmed as CSV7C from an entirely separate work thread — the
  // "Feature completion: CSV7C zh-cn manual image backfill" section of
  // claude/spec.md independently identified "利刃猛醒" as CSV7C months
  // ago (204 real cards, clean identity mapping, images already backfilled
  // via that track). Two independent methods now agree on the same title.
  { setId: "CSV6C", pageTitle: "真实玄虚（TCG）" },
  // Round 28 — CSV7C (利刃猛醒, "Blade Awakening"), named directly by
  // CSV6C's own chain reference (`next=利刃猛醒`), not a guess. Confirmed
  // real via data/wiki-raw/blade-awakening-round28-raw.txt. alt=CSV7C,
  // cards=204+55. 259 raw entries, positions 001-259, zero duplicate
  // positions, fully sequential, no gaps. First card 蔓藤怪, last card
  // 紧急滑板 (item card, UR chase reprint).
  // CORRECTION vs. the separate image-backfill track: claude/spec.md's
  // "Feature completion: CSV7C zh-cn manual image backfill" section had
  // stated 204 real cards for this set. That 204 is only the *base* count
  // before the AR/SR/SAR/UR chase-card tail (positions 205-259, the same
  // "+55" pattern every other CSV set in this chain has shown). The real
  // total confirmed here is 259, matching the `cards=204+55` figure in the
  // page's own infobox. Recording this as the correction, not the 204.
  // Chain: `prev=真实玄虚, next=璀璨诡幻, other=, other2=` — names round
  // 29's target directly: "璀璨诡幻".
  { setId: "CSV7C", pageTitle: "利刃猛醒（TCG）" },
  // Round 29 — CSV8C (璀璨诡幻, "Sparkling Fable"), named directly by
  // CSV7C's own chain reference (`next=璀璨诡幻`), not a guess. Confirmed
  // real via data/wiki-raw/sparkling-fable-round29-raw.txt. alt=CSV8C,
  // cards=207+57. 264 raw entries, positions 001-264, zero duplicate
  // positions, fully sequential, no gaps. First card 蛋蛋, last card
  // 夜光能量 (energy card).
  // Chain: `prev=利刃猛醒, next=星彩晶璃, other=, other2=` — names round
  // 30's target directly: "星彩晶璃".
  { setId: "CSV8C", pageTitle: "璀璨诡幻（TCG）" },
  // Round 30 — CSV9C (星彩晶璃, "Stellar Crystal"), named directly by
  // CSV8C's own chain reference (`next=星彩晶璃`), not a guess. Confirmed
  // real via data/wiki-raw/stellar-crystal-round30-raw.txt. alt=CSV9C,
  // cards=208+58. 266 raw entries, positions 001-266 by raw line count.
  // NOTE — wiki source data error, not a parser bug: position 136/208 is
  // used TWICE on the page itself (铝钢龙 then 铝钢桥龙, two genuinely
  // different cards — a base form and its evolution), and position 137
  // is never used at all. This is a real typo on wiki.52poke.com's own
  // card-list table, independently re-verified via a standalone regex
  // script outside the real parser (same result: one collision at 136,
  // one gap at 137, everything else 1-266 clean). The real importer's
  // existing dedup logic (numberSeenCount Map, `-2`/`-3` suffixing)
  // already handles this without any special-casing — the second 136
  // entry becomes "136-2". Recording as-scraped rather than silently
  // renumbering it to 137, per the never-guess discipline: this chain
  // corrects titles from chain references, not raw card data from
  // pattern-matching what "should" be there.
  // First card 蛋蛋, last card 零之大空洞 (arena card).
  // Chain: `prev=璀璨诡幻, next=太晶盛聚, other=, other2=` — names round
  // 31's target directly: "太晶盛聚".
  { setId: "CSV9C", pageTitle: "星彩晶璃（TCG）" },
  // Round 31 — CSV9.5C (太晶盛聚, "Terastal Gathering"), named directly by
  // CSV9C's own chain reference (`next=太晶盛聚`), not a guess. Confirmed
  // real via data/wiki-raw/terastal-gathering-round31-raw.txt. alt=CSV9.5C
  // (NOT CSV10C — the round-31 scout script's header comment speculated
  // "plausibly CSV10C" before the fetch; the page's own infobox says
  // CSV9.5C, a bridge/half-set following the same X.5C pattern as CS5.5C
  // and CS6.5C. CSV10C is still ahead, unreached.) cards=208+51. 259 raw
  // entries, positions 001-259, zero duplicate positions, fully
  // sequential, no gaps. First card 蛋蛋, last card 太乐巴戈斯ex.
  // Chain: `prev=星彩晶璃, next=共逐荣光, other=, other2=` — names round
  // 32's target directly: "共逐荣光" (plausibly CSV10C, the actual last
  // of the originally-named CSV1C-CSV10C family).
  { setId: "CSV9.5C", pageTitle: "太晶盛聚（TCG）" },
  // Round 32 — CSV10C (共逐荣光, "Together in Pursuit of Glory"), named
  // directly by CSV9.5C's own chain reference (`next=共逐荣光`), not a
  // guess. Confirmed real via data/wiki-raw/together-in-pursuit-of-glory-
  // round32-raw.txt. alt=CSV10C, cards=222+65. 287 raw entries, positions
  // 001-287, zero duplicate positions, fully sequential, no gaps. First
  // card 阿响的凯罗斯, last card 尖钉能量 (energy card).
  // This is the actual, final set of the originally-named CSV1C-CSV10C
  // family (round 31's CSV9.5C turned out to be an unplanned bridge set
  // along the way, not this one).
  // Chain: `prev=太晶盛聚, next=雳焰激荡, other=大师战略卡组构筑套装` +
  // ` 猛雷鼓ex·多龙巴鲁托ex·赛富豪ex, other2=嗨皮组合 快龙&超梦&喷火驼` +
  // `&来悲粗茶` — the `other`/`other2` fields are a deck-building gift box` +
  // ` and a Happy Set combo, both real but out of core-family scope (same` +
  // ` category as prior rounds' side branches). Names round 33's target` +
  // ` directly: "雳焰激荡" — the first set past the original CSV1C-CSV10C` +
  // ` family, plausibly CSV11C.
  { setId: "CSV10C", pageTitle: "共逐荣光（TCG）" },
  // Round 33 — CSV10C's own chain reference names "雳焰激荡" as the next
  // title past the original CSV1C-CSV10C family. Confirmed real (alt=CSV11C)
  // via data/wiki-raw/csv11c-stub-round33-raw.txt, but the page itself is an
  // unpublished stub — empty cards=, empty release=, empty official=, zero
  // card-list entries. NOT added here: nothing to validate against yet.
  // Its chain reference branches into two next titles: `next=黑雷奔流,
  // next2=白雷迸涌`.
  //
  // Round 34 — both branch titles ("黑雷奔流（TCG）" and "白雷迸涌（TCG）")
  // returned "page not found" on wiki.52poke.com — genuinely unpublished,
  // not a bad guess. Stalled here until the wiki catches up; nothing added.
  //
  // Round 35/36 — CSM1/CSM2 family (Storming Emergence / Shining Synergy),
  // the last 6 codes of the original 29-code core-pack family from round 12
  // — the only codes in this whole chain NEVER named by a next=/other=
  // chain reference. Found via a different method: the wiki's own CSM1 and
  // CSM2 hub/index pages name every sub-code directly in plain prose (round
  // 35), then all 8 titles below (6 core + 2 bridge sets) were independently
  // confirmed via a direct fetch each, all in round 36
  // (data/wiki-raw/round36-raw.txt) — zero guesses, zero 404s, zero missing
  // pages, the cleanest single-round batch of the whole 36-round effort:
  //   CSM1aC "横空出世 赫（TCG）" — alt=CSM1aC confirmed. 211 raw entries,
  //     positions 001-211, zero duplicates, fully sequential. cards=211
  //     matches the raw count exactly. Chain: `next=对战精英,
  //     other=横空出世 苍, other2=横空出世 泽` — cross-confirms both siblings.
  //   CSM1bC "横空出世 苍（TCG）" — alt=CSM1bC confirmed. 204 raw entries,
  //     positions 001-204, zero duplicates, fully sequential. cards=204
  //     matches exactly. Chain: `next=对战精英, other=横空出世 赫,
  //     other2=横空出世 泽`.
  //   CSM1cC "横空出世 泽（TCG）" — alt=CSM1cC confirmed. 212 raw entries,
  //     positions 001-212, zero duplicates, fully sequential. cards=212
  //     matches exactly. Chain: `next=对战精英, other=横空出世 赫,
  //     other2=横空出世 苍`.
  //   CSM1.5C "对战精英（TCG）" — the bridge set after the CSM1 wave, same
  //     X.5C pattern as CS3.5C/CS4.5C/CS5.5C/CS6.5C/CSV9.5C. alt=CSM1.5C
  //     confirmed. cards=60+28=88, matching the raw entry count (88) exactly
  //     — the only one of these 8 sets where the wiki's own cards= field is
  //     complete and agrees with the real count. 88 raw entries, positions
  //     001-088, zero duplicates, fully sequential. Chain:
  //     `prev=横空出世 赫, prev2=横空出世 苍, prev3=横空出世 泽,
  //     next=交相辉映 沐, next2=交相辉映 魁, next3=交相辉映 唤` — names all
  //     three CSM2 titles directly.
  //   CSM2aC "交相辉映 沐（TCG）" — alt=CSM2aC confirmed. 194 raw entries,
  //     positions 001-194, zero duplicates, fully sequential. NOTE: the
  //     wiki's own cards= field is a genuinely incomplete value, "150+"
  //     with nothing after the plus sign (confirmed directly in the raw
  //     |cards= line, not a parsing artifact) — same as CSV7C/CSV8C/CSV9C/
  //     CSV9.5C/CSV10C's BASE+EXTRA pattern, the real raw entry count (194)
  //     is authoritative, not the infobox summary field. Chain:
  //     `prev=对战精英, next=炫奇争胜, other=交相辉映 魁, other2=交相辉映 唤`.
  //   CSM2bC "交相辉映 魁（TCG）" — alt=CSM2bC confirmed. 193 raw entries,
  //     positions 001-193, zero duplicates, fully sequential. Same
  //     incomplete "150+" cards= field as CSM2aC — 193 is the real count.
  //     Chain: `prev=对战精英, next=炫奇争胜, other=交相辉映 沐,
  //     other2=交相辉映 唤`.
  //   CSM2cC "交相辉映 唤（TCG）" — alt=CSM2cC confirmed. 192 raw entries,
  //     positions 001-192, zero duplicates, fully sequential. Same
  //     incomplete "150+" cards= field — 192 is the real count. Chain:
  //     `prev=对战精英, next=炫奇争胜, other=交相辉映 沐, other2=交相辉映 魁`.
  //   CSM2.5C "炫奇争胜（TCG）" — the bridge set after the CSM2 wave.
  //     alt=CSM2.5C confirmed. cards=61+ is also an incomplete field on the
  //     wiki's own page — 99 raw entries (positions 001-099, zero
  //     duplicates, fully sequential) is the real count. Chain:
  //     `prev=交相辉映 沐, prev2=交相辉映 魁, prev3=交相辉映 唤,
  //     next=极巨争锋 雷, next2=极巨争锋 焰` — this is the SAME CS1aC/CS1bC
  //     pair already at the top of this array (极巨争锋 雷/焰), confirming
  //     the chain wraps back around rather than pointing to anything new —
  //     the CSM family is the true end of this chain-discovery effort.
  // All 8 independently re-verified via a standalone script parsing the raw
  // capture directly (not reusing this file's own parser) — fully
  // sequential positions, zero gaps, zero duplicates on every single one.
  { setId: "CSM1aC", pageTitle: "横空出世 赫（TCG）" },
  { setId: "CSM1bC", pageTitle: "横空出世 苍（TCG）" },
  { setId: "CSM1cC", pageTitle: "横空出世 泽（TCG）" },
  { setId: "CSM1.5C", pageTitle: "对战精英（TCG）" },
  { setId: "CSM2aC", pageTitle: "交相辉映 沐（TCG）" },
  { setId: "CSM2bC", pageTitle: "交相辉映 魁（TCG）" },
  { setId: "CSM2cC", pageTitle: "交相辉映 唤（TCG）" },
  { setId: "CSM2.5C", pageTitle: "炫奇争胜（TCG）" },
];

const MARKERS = ["{{卡牌列表/entryjp|", "{{卡牌列表/entry|"];

// Same brace-depth block finder as every other zh-cn importer in this
// project, parameterized by marker (same pattern as cnHappySetImport.ts).
function findEntryBlocks(text: string, marker: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const start = text.indexOf(marker, searchFrom);
    if (start === -1) break;
    let depth = 1;
    let p = start + 2;
    while (p < text.length && depth > 0) {
      if (text[p] === "{" && text[p + 1] === "{") {
        depth++;
        p += 2;
      } else if (text[p] === "}" && text[p + 1] === "}") {
        depth--;
        p += 2;
      } else {
        p++;
      }
    }
    blocks.push(text.slice(start + marker.length, p - 2));
    searchFrom = p;
  }
  return blocks;
}

// Same [[ ]]/{{ }}-depth-aware splitter as every other zh-cn importer.
function splitTopLevelFields(inner: string): string[] {
  const fields: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "{" && inner[i + 1] === "{") {
      braceDepth++;
      cur += "{{";
      i++;
    } else if (inner[i] === "}" && inner[i + 1] === "}") {
      braceDepth--;
      cur += "}}";
      i++;
    } else if (inner[i] === "[" && inner[i + 1] === "[") {
      bracketDepth++;
      cur += "[[";
      i++;
    } else if (inner[i] === "]" && inner[i + 1] === "]") {
      bracketDepth--;
      cur += "]]";
      i++;
    } else if (inner[i] === "|" && braceDepth === 0 && bracketDepth === 0) {
      fields.push(cur);
      cur = "";
    } else {
      cur += inner[i];
    }
  }
  fields.push(cur);
  return fields;
}

function extractName(field: string): string | null {
  const m = field.match(/^\{\{(?:C|TCG)\|([^|}]+)/);
  return m ? m[1].trim() : null;
}

export interface BoosterSetEntry {
  numbered: boolean;
  cardNumber: string;
  rawPositionField: string;
  name: string;
  category: string;
  rarity: string | null; // null when missing OR the literal "—" (no rarity marked)
}

export function countRawEntryLines(fullText: string): number {
  let count = 0;
  for (const marker of MARKERS) {
    const matches = fullText.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
    count += matches ? matches.length : 0;
  }
  return count;
}

export function parseBoosterSetEntries(fullText: string): BoosterSetEntry[] {
  const entries: BoosterSetEntry[] = [];
  let unnumberedCounter = 0;
  const numberSeenCount = new Map<string, number>();

  const rawBlocks = MARKERS.flatMap((marker) => findEntryBlocks(fullText, marker));

  for (const inner of rawBlocks) {
    const fields = splitTopLevelFields(inner);
    if (fields.length < 3) continue;

    const name = extractName(fields[1]);
    if (!name) continue;

    const category = fields[2].trim();
    const rawRarity = fields.length >= 5 ? fields[4].trim() : "";
    const rarity = rawRarity && rawRarity !== "—" ? rawRarity : null;

    // "POS/TOTAL" — TOTAL is a box-level figure, not used. Anything that
    // doesn't match (a bare "—" em-dash for unnumbered energy, or any other
    // non-numeric value) falls through to the unnumbered branch.
    const posMatch = fields[0].trim().match(/^(\d+)\/\d+$/);

    if (posMatch) {
      const baseNumber = posMatch[1];
      const seenCount = (numberSeenCount.get(baseNumber) ?? 0) + 1;
      numberSeenCount.set(baseNumber, seenCount);
      const cardNumber = seenCount === 1 ? baseNumber : `${baseNumber}-${seenCount}`;

      entries.push({
        numbered: true,
        cardNumber,
        rawPositionField: fields[0].trim(),
        name,
        category,
        rarity,
      });
    } else {
      unnumberedCounter++;
      entries.push({
        numbered: false,
        cardNumber: `U${String(unnumberedCounter).padStart(2, "0")}`,
        rawPositionField: fields[0].trim(),
        name,
        category,
        rarity,
      });
    }
  }

  return entries;
}

export interface BoosterSetResult {
  setId: string;
  setName: string;
  found: boolean;
  rawEntryLines: number;
  parsedEntries: number;
  rows: CardRow[];
}

export async function scoutBoosterSet(def: BoosterSetDef): Promise<BoosterSetResult> {
  const content = await fetchFullContent([def.pageTitle]);
  const text = content.get(def.pageTitle);
  const setName = def.pageTitle.replace(/（[^（）]*）$/, "").trim();

  if (!text) {
    return {
      setId: def.setId,
      setName,
      found: false,
      rawEntryLines: 0,
      parsedEntries: 0,
      rows: [],
    };
  }

  const rawEntryLines = countRawEntryLines(text);
  const entries = parseBoosterSetEntries(text);

  const rows: CardRow[] = entries.map((e) => ({
    id: `${def.setId}-${e.cardNumber}`,
    language: "zh-cn",
    set_id: def.setId,
    set_name: setName,
    card_number: e.cardNumber,
    name: e.name,
    national_dex_no: null,
    rarity: e.rarity,
    image_url: null,
    synced_at: new Date().toISOString(),
  }));

  return {
    setId: def.setId,
    setName,
    found: true,
    rawEntryLines,
    parsedEntries: entries.length,
    rows,
  };
}

export async function scoutAllBoosterSets(): Promise<BoosterSetResult[]> {
  const results: BoosterSetResult[] = [];
  for (let i = 0; i < BOOSTER_SETS.length; i++) {
    results.push(await scoutBoosterSet(BOOSTER_SETS[i]));
    if (i < BOOSTER_SETS.length - 1) await sleep(1500);
  }
  return results;
}
