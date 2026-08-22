# Pokemon Collection Tracker

Free, multi-user Pokemon card collection tracker. Track what you own across
English, Japanese, Traditional Chinese and Simplified Chinese, see what
you're missing per language, connect with friends, and find trade matches —
"they have what I need, I have what they need" — with a light propose →
in-progress → completed workflow.

Product/decision background lives outside this repo, in the project's
`spec.md`. This README is about running the code.

## Stack

- Next.js (App Router, TypeScript) — one codebase, installable as a PWA on
  any device.
- Supabase — Postgres + auth + row-level security. Free tier is enough for a
  handful of friends.
- TCGdex (tcgdex.dev) — free, open-source card reference data, synced into a
  local `cards` table on a schedule rather than hit live per request.

## First-time setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier).
2. In the Supabase dashboard, go to **Project Settings → API** and copy the
   Project URL, anon public key, and service_role key.
3. Copy `.env.example` to `.env.local` and fill in those three values.
4. In the Supabase dashboard, go to **SQL Editor → New query**, paste the
   contents of `supabase/schema.sql`, and run it. This creates every table,
   the row-level security policies, and the trigger that creates a profile
   row on signup.
5. Install dependencies and sync the card catalog, plus the Pokemon species
   name lookup (needed for non-English search to work properly — see below):

   ```bash
   npm install
   npm run sync -- --lang=en --set=base1   # small test run first, see below
   npm run sync:species
   ```

6. Run the app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000, sign up, sign in, and go to **Collection** to
   search for a Pokemon (try "Charizard" if you synced `base1`).

## Syncing the card catalog

The `cards` table is reference data — the same for every user — pulled from
TCGdex. Nothing else in the app works until it's populated.

```bash
npm run sync                      # all 4 languages, every set — slow, many requests
npm run sync -- --lang=ja         # just one language
npm run sync -- --lang=en --set=base1   # one set, good for testing the pipeline works at all
```

This hits TCGdex's free API with limited concurrency (5 requests at a time)
rather than hammering it, per their own request in their docs. A full sync
across all 4 languages will be a lot of requests — no need to run it more
than occasionally; card data doesn't change often once a set is released.
Re-running is safe (it upserts).

**Run this on a schedule** (a cron job, a Vercel Cron Job hitting a protected
route, GitHub Actions, whatever's easiest) rather than manually forever, so
new sets show up without you remembering to run it.

## Syncing Pokemon species names (for non-English search)

```bash
npm run sync:species
```

Separate from the card sync above, and from a different source entirely:
[PokeAPI](https://pokeapi.co), not TCGdex. This populates the
`pokemon_species_names` table — dex number to official name, per language —
which non-English search depends on.

Why this is a separate table at all: TCGdex doesn't reliably tag every card
with a National Pokedex number. Checked against a real synced database, only
~27% of Traditional Chinese cards had one, even though the Chinese card data
itself was ~90% as complete as Japanese's. Searching by dex number alone
would miss most of the catalog. PokeAPI's species names are complete and
official regardless of what TCGdex tagged, so search now also matches by
literal name text in the target language, resolved through this table.

Species names essentially never change, so this only needs running once
(re-run occasionally if you want to be safe, it's a cheap upsert either way)
— unlike the card sync, it doesn't need a recurring schedule.

## Backfilling missing card images

```bash
npm run backfill:images
```

TCGdex — the primary card data source — simply has no image at all for
roughly 6% of the synced English catalog (~1,450 of ~23,400 cards, checked
against a real synced database). This isn't spread evenly: it's concentrated
almost entirely in "trainer kit" starter-box products, "McDonald's
Collection" promotional sets, and the alternate-art "Trainer Gallery" /
"Shiny Vault" insert subsets bundled into modern sets — TCGdex just hasn't
photographed these. Confirmed two ways: the raw API response for an affected
card has no `image` field at all, and guessing TCGdex's own asset CDN URL for
one of these cards 404s.

This script fills the gap from a second source, [pokemontcg.io](https://pokemontcg.io)
(`src/lib/pokemontcgio.ts`), which has coverage for exactly these categories.
For every English card with a null `image_url`, it matches TCGdex's set name
and card number against pokemontcg.io's catalog (loosely normalized —
lowercased, punctuation stripped, leading zeros stripped — but matched
exactly, never fuzzy-guessed, since a wrong match would attach the wrong
image to a card) and writes the image URL only on a confident match.
Everything that can't be matched is logged by set, not silently skipped, so
the end-of-run summary is an honest count of what's still missing after it
runs. Safe to re-run — it only ever touches rows where `image_url` is still
null.

Two things worth knowing before you run it:

- **English only.** This fixes missing images, not the multi-language
  completion checklists — it doesn't touch `ja`/`zh-tw`/`zh-cn` rows at all.
- **pokemontcg.io itself is reportedly being wound down** in favor of a paid
  successor ("Scrydex"), and has proven flaky in real use — real runs against
  a live database hit intermittent 500/502 errors, now handled with
  retry-with-backoff (`fetchWithRetry` in `src/lib/pokemontcgio.ts`), but a
  request can still fail outright after using its retries.

**Run for real, confirmed working with real limitations:** filled 395 of
1,000 missing English cards in one run. The remainder splits into two honest
categories, not bugs: (1) sets pokemontcg.io's catalog genuinely doesn't have
at all — confirmed directly, e.g. it only has the four EX-era trainer kits,
none of the XY/DP/HS/BW/SM-era ones, and (2) a handful of sets that failed
outright after exhausting retries under a flaky API — safe to just re-run,
since the script only touches rows still missing an image. See "Backfilling
from a local image archive" below for how the first category gets covered.

## Backfilling missing card images from a local archive

```bash
npm run backfill:images-archive
```

For whatever's still missing after `npm run backfill:images` — confirmed to
be concentrated in trainer kit sets outside the EX era, which pokemontcg.io's
catalog doesn't have at all. This script (`scripts/backfill-images-from-archive.ts`)
covers those from a local folder of card image scans instead of a third API
dependency.

Unlike every other script here, this one reads **local files**, not a remote
API — set `LOCAL_CARD_ARCHIVE_PATH` in `.env.local` to the full path of your
archive folder first (see `.env.example`). It only makes sense to run this on
whichever machine actually has that folder.

How it works: walks the archive folder recursively, treating any directory
that directly contains image files as a "set folder" (keyed by that
directory's own name) — this doesn't assume a fixed nesting depth, since a
real archive folder checked by hand had inconsistent nesting (most sets at
one depth, some newer ones at another). Matches each set folder to a
`cards.set_name` by reducing both to bare lowercase alphanumerics and
comparing exactly — same never-fuzzy policy as the pokemontcg.io script, for
the same reason. Also tries known era abbreviation swaps (`BW`/`black-white`,
`DP`/`diamond-pearl`, `SM`/`sun-moon`) since TCGdex abbreviates some trainer
kit set names where a real archive checked by hand spelled them out —
confirmed this exact mismatch by hand for 3 of the 5 affected eras before
adding the fix, so it's not a hypothetical. Extracts each file's card number
as the last run of digits in its filename (held up across every naming
convention spot-checked in a real archive — different sets used different
schemes) and matches it against `cards.card_number`, normalized the same way
as the pokemontcg.io script. Matched images are uploaded to Supabase Storage
(bucket `card-images`, created automatically if missing) and `image_url` is
pointed at the resulting public URL.

Known limitation: card-number extraction can't recover a letter-prefixed
collector number (e.g. Trainer Gallery's `TG03`) unless a filename happens to
embed it as one contiguous token — not attempted, since a wrong guess there
risks a worse failure mode (attaching a plausible-but-wrong image) than just
leaving it blank. Not an issue for the current known gap (trainer kits use
plain numbering), worth knowing if this script gets pointed at other sets.

The folder-walking, card-number extraction, and slug-matching logic (era
aliases included) were tested against a mock file tree mirroring five real
naming conventions checked by hand in the actual archive, including all
three of the abbreviation-mismatch cases — this caught and fixed the era
alias gap before it could quietly under-cover the exact sets this script
exists for. Not run end-to-end against a live archive folder + Supabase
project yet, since that combination doesn't exist in the environment this
was built in — the first real run is the actual test of whether matching
holds up across the full archive, not just the folders spot-checked by hand.

## Deploying

- **App**: push this repo to GitHub, import it into Vercel, add the same env
  vars from `.env.local` (Vercel project settings → Environment Variables),
  deploy. Free hobby tier covers this comfortably.
- **Database**: already live once you created the Supabase project above —
  nothing extra to deploy there.
- **PWA install**: once deployed on a real HTTPS domain, visiting the site
  on a phone will offer "Add to Home Screen" (Android/Chrome) or it can be
  added manually via the share sheet (iOS/Safari) — no app store involved.

## Fixing "email rate limit exceeded" on signup

Every new Supabase project starts on Supabase's own built-in email sender
for confirmation emails, password resets, etc. It's meant for development
and is capped hard — a handful of emails per hour, shared across every
signup and password-reset request the project sends. Once a few friends
sign up in the same evening, everyone after the first few gets "Email rate
limit exceeded" and can't confirm their account. This isn't a bug in this
app's code — it's a Supabase project setting — so there's nothing to fix in
a script or a page here. Two real fixes, in order of effort:

1. **Fastest unblock — turn off email confirmation.** For a small
   friends-and-family app like this one, requiring email confirmation
   before someone can sign in isn't buying much. In the Supabase dashboard:
   Authentication → Sign In / Providers → Email → turn off "Confirm email".
   New signups get a usable session immediately, no email involved, no rate
   limit to hit. Anyone who's already stuck on an unconfirmed account can
   just sign up again once this is off (or you can confirm them directly:
   Authentication → Users → find the user → the "..." menu → Confirm
   email).
2. **Proper fix — custom SMTP.** In the Supabase dashboard: Project
   Settings → Authentication → SMTP Settings, and point it at a real
   transactional email provider (Resend, Postmark, SendGrid all have a free
   tier that's more than enough for a small user base). This removes the
   rate limit entirely and is worth doing if email confirmation matters to
   you long-term — just more setup than option 1.

Either change is made in the Supabase dashboard, takes a couple of minutes,
and needs no redeploy of this app.

## Getting emailed when someone submits a feature request

The `/feedback` page (feature request board) emails you the moment someone
submits a request, via Resend's API — but only once `RESEND_API_KEY` is set.
Without it, requests still save fine, you just won't get the email.

1. Sign up for a free account at [resend.com](https://resend.com) using
   your own email address — the one you want notifications sent to.
2. Create an API key (Resend dashboard → API Keys) and copy it.
3. Add it to `.env.local`: `RESEND_API_KEY=re_...`. For the live site, add
   the same variable in Vercel (Project → Settings → Environment Variables)
   and redeploy.

No custom domain or DNS setup needed for this — Resend's shared sandbox
sender (`onboarding@resend.dev`) is allowed to deliver to the same address
the account was signed up with, which is exactly this use case (you
notifying yourself). If you later want the "from" address to look like it
came from your own domain instead, that needs a verified domain in Resend —
optional, not required for this to work.

This is a separate thing from the SMTP setup in the section above — that
one controls Supabase Auth's own emails (signup confirmations, password
resets); this one is a direct API call this app makes for its own
notification, unrelated to Supabase.

## Things that need verifying before you rely on this — flagging honestly

A few pieces were built against TCGdex's documented conventions rather than
a response I could fetch and confirm byte-for-byte, because their docs site
renders examples client-side in a way the research tooling couldn't execute,
and their API subdomain (`api.tcgdex.net`) blocks automated fetching
entirely. None of this is a guess made up from nothing — it's TCGdex's
documented v2 REST convention, used by their own official SDKs — but it's
untested against a live response, so treat it as the first thing to check
if the sync script errors out:

- **The exact REST paths** (`/v2/{lang}/sets`, `/v2/{lang}/sets/{id}`,
  `/v2/{lang}/cards/{id}`) in `src/lib/tcgdex.ts`. Run
  `npm run sync -- --lang=en --set=base1` first and watch the console —
  if every request 404s, the path shape is the first thing to fix.
- **The image URL suffix** in `src/app/collection/page.tsx` — cards are
  rendered as `${image_url}/high.png`. If images don't load, try `/low.webp`
  or check `tcgdex.dev/reference/card` for the current asset convention.
- **Composite foreign key embedding** — avoided entirely on purpose. Queries
  that join `trade_items` to `cards` do it manually in JS (see
  `src/app/trades/page.tsx`) rather than relying on PostgREST resolving the
  `(card_id, language)` composite foreign key automatically, since that
  wasn't something worth betting on unverified.
- **PokeAPI's species name shape** in `src/lib/pokeapi.ts` — confirmed
  against a live response (dex-number-as-id, and the `zh-hant`/`zh-hans`
  language codes for Chinese names both check out), but only for one species
  fetched during development. If `npm run sync:species` errors out or comes
  back with mostly-empty Chinese/Japanese name columns, that's the first
  place to look.
- **pokemontcg.io's set/card matching** in `src/lib/pokemontcgio.ts` and
  `scripts/backfill-images.ts` — the set list, a trainer kit set, and a few
  Trainer Gallery/Shiny Vault card numbers were checked by hand during
  development and matched TCGdex's naming, but the full backfill across all
  ~64 affected sets hasn't been run against a live database. See
  "Backfilling missing card images" above.

## Known limitations (deliberate, not oversights — see spec.md for why)

- No camera scanning — manual entry only.
- No live market pricing or portfolio value.
- No quantity/condition tracking — a card is either owned or it isn't.
- Each language's completion checklist is fully independent. There is no
  attempt to say "this English card and this Japanese card are the same
  card" — see spec.md's language decision for why that's deliberate, not a
  gap to file a bug about.
- Pokemon search is a substring match on card name (`ILIKE '%query%'`)
  within the selected language, PLUS — for non-English languages — a lookup
  against `pokemon_species_names` (synced from PokeAPI, not TCGdex — see
  "Syncing Pokemon species names" above) to resolve the query to a National
  Pokedex number and the Pokemon's official name in the target language.
  Both the dex number and the localized name are then used to search the
  target language's cards, so e.g. typing "Charizard" with Japanese selected
  finds リザードン even though the text itself never matches, and this works
  even for the majority of Traditional Chinese cards that TCGdex never
  tagged with a dex number at all (only ~27% have one — see spec.md).
  Searching in native script directly (e.g. typing リザードン) still works
  too, as a plain substring match. Trainer/Energy cards have no dex number
  or species entry and are only found by literal text match.
- The `profiles` table's row-level security policy allows any signed-in user
  to read any other signed-in user's email (needed for the "add friend by
  email" lookup). Fine for a small friends-and-family deployment; worth
  knowing if this ever grows beyond people you'd share an email list with
  anyway.

## Project structure

```
src/app/                 Pages and Server Actions (App Router)
  collection/             Search + have/don't-have toggle
  friends/                Friend requests
  trades/                 Trade list + status workflow
  trades/find/            Match finder (per friend, per language)
  login/, signup/, auth/  Auth pages + Server Actions
src/lib/tcgdex.ts        TCGdex API client
src/lib/pokeapi.ts       PokeAPI client (species names, for non-English search)
src/lib/pokemontcgio.ts  pokemontcg.io client (fallback image source only)
src/lib/supabase/        Supabase client helpers (browser/server/middleware)
scripts/sync-cards.ts                    TCGdex → Supabase sync job
scripts/sync-species-names.ts            PokeAPI → Supabase species name sync job
scripts/backfill-images.ts               pokemontcg.io → Supabase missing-image backfill
scripts/backfill-images-from-archive.ts  local archive → Supabase Storage missing-image backfill
supabase/schema.sql      Full database schema, run once in Supabase's SQL editor
```
