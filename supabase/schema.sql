-- Pokemon Collection Tracker — schema
-- Run this in the Supabase SQL editor for your project (Project > SQL Editor > New query).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE
-- throughout. (Postgres doesn't support "CREATE POLICY IF NOT EXISTS" — an
-- earlier version of this file assumed it did and was wrong; policies here
-- are dropped first, then recreated, which is the correct idempotent
-- pattern.)
--
-- This file has been run end-to-end against a real Postgres instance with a
-- stub auth schema (not just eyeballed) — see the two bugs fixed as a
-- result: CREATE POLICY IF NOT EXISTS isn't valid syntax, and the
-- Friendships table needs to be created before Collection entries, since a
-- Collection entries policy references it.

-- ---------------------------------------------------------------------------
-- Profiles (one row per Supabase auth user, keeps display info separate from
-- the auth.users table which we don't own / shouldn't extend directly)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by any signed-in user" on public.profiles;
create policy "profiles are readable by any signed-in user"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Cards — the local reference cache synced from TCGdex. This table is the
-- same for every user; it's reference data, not per-user data.
-- ---------------------------------------------------------------------------
create table if not exists public.cards (
  id text not null,            -- TCGdex card id, e.g. "swsh3-136"
  language text not null,      -- 'en' | 'ja' | 'zh-tw' | 'zh-cn'
  set_id text not null,
  set_name text not null,
  card_number text not null,
  name text not null,
  national_dex_no numeric,      -- null for trainer/energy cards. NOT always
                                 -- a clean integer — TCGdex returns values
                                 -- like 384.1 for some Japanese cards
                                 -- (regional/special forms), which broke a
                                 -- real sync run when this was `int`.
  rarity text,
  image_url text,
  synced_at timestamptz not null default now(),
  primary key (id, language)
);

create index if not exists cards_national_dex_no_idx on public.cards (language, national_dex_no);
create index if not exists cards_name_idx on public.cards (language, lower(name));

alter table public.cards enable row level security;

drop policy if exists "cards are readable by any signed-in user" on public.cards;
create policy "cards are readable by any signed-in user"
  on public.cards for select
  to authenticated
  using (true);

-- No insert/update/delete policy for regular users — only the sync job
-- (using the service role key, which bypasses RLS) writes to this table.

-- ---------------------------------------------------------------------------
-- Pokemon species names — dex number -> official name per language, synced
-- from PokeAPI (see scripts/sync-species-names.ts), NOT from TCGdex. This
-- exists because TCGdex's own per-card dex-number tagging turned out to be
-- incomplete (only ~27% of synced Traditional Chinese cards had it), so
-- cross-language search needs an independent, complete name lookup instead
-- of relying on that field. Same reference-data treatment as `cards` below
-- — one shared table, service-role-only writes, read-only for users.
-- ---------------------------------------------------------------------------
create table if not exists public.pokemon_species_names (
  national_dex_no integer primary key,
  name_en text,
  name_ja text,
  name_zh_tw text,
  name_zh_cn text,
  synced_at timestamptz not null default now()
);

alter table public.pokemon_species_names enable row level security;

drop policy if exists "species names are readable by any signed-in user" on public.pokemon_species_names;
create policy "species names are readable by any signed-in user"
  on public.pokemon_species_names for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Friendships — symmetric relationship, stored as one directed row with a
-- status. 'pending' until the recipient accepts. Created before Collection
-- entries below, since a Collection entries policy references this table.
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

alter table public.friendships enable row level security;

drop policy if exists "users see friendships they're part of" on public.friendships;
create policy "users see friendships they're part of"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_user_id);

drop policy if exists "users can send friend requests" on public.friendships;
create policy "users can send friend requests"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "either side can update status (accept/decline)" on public.friendships;
create policy "either side can update status (accept/decline)"
  on public.friendships for update
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_user_id);

-- ---------------------------------------------------------------------------
-- Collection entries — have / don't-have. A row existing means "owned".
-- No quantity, no condition, per the have/don't-have decision.
-- ---------------------------------------------------------------------------
create table if not exists public.collection_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null,
  language text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, card_id, language),
  foreign key (card_id, language) references public.cards (id, language) on delete cascade
);

create index if not exists collection_entries_user_idx on public.collection_entries (user_id, language);

alter table public.collection_entries enable row level security;

drop policy if exists "users manage their own collection" on public.collection_entries;
create policy "users manage their own collection"
  on public.collection_entries for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "friends can view each other's collection" on public.collection_entries;
create policy "friends can view each other's collection"
  on public.collection_entries for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_id = auth.uid() and f.friend_user_id = collection_entries.user_id)
          or (f.friend_user_id = auth.uid() and f.user_id = collection_entries.user_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Trades — the light workflow: proposed -> in_progress -> completed
-- (or cancelled at any point before completed).
-- ---------------------------------------------------------------------------
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 'in_person' (the original, only option) or 'post' — added 2026-08-20 so
  -- friends spread across the UK can trade without meeting up. Chosen when
  -- the trade is proposed; doesn't change afterward. In-person trades keep
  -- the original lightweight "either side clicks completed" rule (safe
  -- because the exchange is simultaneous — both people are standing there).
  -- Postal trades CANNOT complete that way: nobody can truthfully vouch
  -- that a parcel they didn't personally receive actually arrived, so
  -- in_progress -> completed is blocked for 'post' trades in
  -- advanceTrade — completion only happens once both
  -- *_received_at columns below are set, via markReceived.
  fulfillment_method text not null default 'in_person' check (fulfillment_method in ('in_person', 'post')),
  -- Per-participant shipping status for postal trades. Nullable/unused for
  -- in_person trades. tracking_ref is free text (a Royal Mail/courier
  -- reference), optional — some people just won't bother getting one.
  proposer_shipped_at timestamptz,
  proposer_tracking_ref text,
  proposer_received_at timestamptz,
  recipient_shipped_at timestamptz,
  recipient_tracking_ref text,
  recipient_received_at timestamptz,
  check (proposer_id <> recipient_id)
);

-- Existing databases already have this table without the columns above.
alter table public.trades add column if not exists fulfillment_method text not null default 'in_person';
alter table public.trades drop constraint if exists trades_fulfillment_method_check;
alter table public.trades add constraint trades_fulfillment_method_check check (fulfillment_method in ('in_person', 'post'));
alter table public.trades add column if not exists proposer_shipped_at timestamptz;
alter table public.trades add column if not exists proposer_tracking_ref text;
alter table public.trades add column if not exists proposer_received_at timestamptz;
alter table public.trades add column if not exists recipient_shipped_at timestamptz;
alter table public.trades add column if not exists recipient_tracking_ref text;
alter table public.trades add column if not exists recipient_received_at timestamptz;

alter table public.trades enable row level security;

drop policy if exists "participants see their trades" on public.trades;
create policy "participants see their trades"
  on public.trades for select
  to authenticated
  using (auth.uid() = proposer_id or auth.uid() = recipient_id);

drop policy if exists "either participant can propose or update a trade" on public.trades;
create policy "either participant can propose or update a trade"
  on public.trades for insert
  to authenticated
  with check (auth.uid() = proposer_id);

drop policy if exists "either participant can update trade status" on public.trades;
create policy "either participant can update trade status"
  on public.trades for update
  to authenticated
  using (auth.uid() = proposer_id or auth.uid() = recipient_id);

create table if not exists public.trade_items (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades (id) on delete cascade,
  card_id text not null,
  language text not null,
  offered_by_user_id uuid not null references auth.users (id) on delete cascade,
  -- Whether the person who GAVE this card away in a completed trade still
  -- owns a duplicate. null = trade not completed yet, or completed but the
  -- giver hasn't answered yet. true = they said "I have another copy" (no
  -- change made to their collection). false = they confirmed they don't,
  -- and it was removed. This is a deliberate per-card decision by the
  -- giver, not automatic — collection_entries is a plain have/don't-have
  -- table with no quantity column, so there's no way to know in advance
  -- whether removing a traded card would wrongly un-own a card someone has
  -- spares of. Decided with Ross 2026-08-20: confirm at completion rather
  -- than build real quantity tracking, since it ships without a bigger
  -- schema/UI change and never silently guesses wrong. See spec doc.
  giver_kept_duplicate boolean,
  foreign key (card_id, language) references public.cards (id, language) on delete cascade
);

-- Existing databases already have this table without the column above —
-- `create table if not exists` is a no-op once the table exists, so this
-- adds it in place without touching any existing rows. Safe to re-run.
alter table public.trade_items add column if not exists giver_kept_duplicate boolean;

alter table public.trade_items enable row level security;

drop policy if exists "participants see items in their trades" on public.trade_items;
create policy "participants see items in their trades"
  on public.trade_items for select
  to authenticated
  using (
    exists (
      select 1 from public.trades t
      where t.id = trade_items.trade_id
        and (t.proposer_id = auth.uid() or t.recipient_id = auth.uid())
    )
  );

drop policy if exists "participants can add items to their trades" on public.trade_items;
create policy "participants can add items to their trades"
  on public.trade_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.trades t
      where t.id = trade_items.trade_id
        and (t.proposer_id = auth.uid() or t.recipient_id = auth.uid())
    )
  );

-- Only the person who gave a card away can record their own
-- keep-a-duplicate-or-remove-it decision on it. App-level logic
-- (resolveGivenCard in trades/actions.ts) additionally checks the trade is
-- actually completed and the item isn't already resolved before touching
-- this — this policy is the "can a stranger touch this row at all" floor,
-- same division of responsibility as advanceTrade's proposer/recipient
-- check elsewhere in this file.
drop policy if exists "giver can record their own duplicate decision" on public.trade_items;
create policy "giver can record their own duplicate decision"
  on public.trade_items for update
  to authenticated
  using (offered_by_user_id = auth.uid())
  with check (offered_by_user_id = auth.uid());

-- Lets a completed trade auto-add the RECEIVED card to the other
-- participant's collection (both sides update on completion — Ross
-- confirmed 2026-08-20 that giving away a card should also mean the
-- recipient's collection reflects it). Without this, the app-level
-- upsert in advanceTrade would be blocked: the existing "users manage
-- their own collection" policy only lets you write rows where
-- auth.uid() = user_id, and completing a trade often means writing a row
-- for the OTHER participant. This policy scopes that narrowly — you can
-- only insert a collection_entries row for someone else if there's a
-- real completed trade you're both part of, with a matching item that
-- was offered by the card's new owner's counterpart (i.e. they actually
-- received this exact card in that trade). Adding a card someone already
-- owns has no downside, so unlike the removal side above, this doesn't
-- need a confirmation step.
drop policy if exists "trade completion adds the received card for both sides" on public.collection_entries;
create policy "trade completion adds the received card for both sides"
  on public.collection_entries for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.trade_items ti
      join public.trades t on t.id = ti.trade_id
      where ti.card_id = collection_entries.card_id
        and ti.language = collection_entries.language
        and t.status = 'completed'
        and ti.offered_by_user_id <> collection_entries.user_id
        and (t.proposer_id = collection_entries.user_id or t.recipient_id = collection_entries.user_id)
        and (t.proposer_id = auth.uid() or t.recipient_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Shipping addresses — one per user, for postal trades. Deliberately a
-- SEPARATE table from `profiles`, not a column on it: `profiles` has a
-- blanket "readable by any signed-in user" policy (see above), so adding an
-- address column there would hand every user's home address to every other
-- signed-in user, not just their trade partners. That's not what "store
-- addresses in the app" was meant to authorize. This table instead has its
-- own narrow policy: you can always read/write your own row, and someone
-- else can only read your address if you're both actively in a postal trade
-- together (in_progress or completed — so it stays visible after
-- completion in case the sender needs to double check where it went, but
-- disappears once a trade is cancelled or if you were never actually
-- trading by post).
-- ---------------------------------------------------------------------------
create table if not exists public.shipping_addresses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  address text not null,
  updated_at timestamptz not null default now()
);

alter table public.shipping_addresses enable row level security;

drop policy if exists "users manage their own shipping address" on public.shipping_addresses;
create policy "users manage their own shipping address"
  on public.shipping_addresses for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trade partners can view each other's shipping address" on public.shipping_addresses;
create policy "trade partners can view each other's shipping address"
  on public.shipping_addresses for select
  to authenticated
  using (
    exists (
      select 1 from public.trades t
      where t.fulfillment_method = 'post'
        and t.status in ('in_progress', 'completed')
        and ((t.proposer_id = auth.uid() and t.recipient_id = shipping_addresses.user_id)
          or (t.recipient_id = auth.uid() and t.proposer_id = shipping_addresses.user_id))
    )
  );
