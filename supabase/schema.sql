-- Dear Jee — schema. Apply this first, then policies.sql.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text        not null default '',
  partner_id  uuid        references profiles(id) on delete set null,
  invite_code text        not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists letters (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid        references profiles(id) on delete set null,
  receiver_id uuid        references profiles(id) on delete set null,
  -- The mock enforced this in the repository. The Supabase adapter cannot,
  -- and RLS does not inspect content, so the guarantee lives here instead.
  message     text        not null check (char_length(message) between 1 and 5000),
  created_at  timestamptz not null default now(),
  is_read     boolean     not null default false,
  share_slug  text        unique,
  is_public   boolean     not null default false
);

-- Added after the initial release, so these are alters rather than columns in
-- the create above: a live database already exists and this file must migrate
-- it in place.
alter table letters add column if not exists sender_archived_at   timestamptz;
alter table letters add column if not exists receiver_archived_at timestamptz;
alter table letters add column if not exists sender_deleted_at    timestamptz;
alter table letters add column if not exists receiver_deleted_at  timestamptz;
-- Null while the person still exists; names then resolve live from profiles so
-- an edited name updates every letter. Frozen only when they leave.
alter table letters add column if not exists sender_name   text;
alter table letters add column if not exists receiver_name text;

-- Presentation, chosen by the writer, carried by the letter forever.
--
-- BOTH ARE NULLABLE AND NULL MEANS "the old behaviour". A null salutation
-- renders the recipient's name exactly as it always did; a null body_font
-- renders Lora. Every letter written before this change has nulls in both and
-- must keep looking precisely as it looks now — which is why neither column
-- gets a non-null default. A default would silently restyle correspondence
-- people have already read.
alter table letters add column if not exists salutation text;
alter table letters add column if not exists body_font  text;

-- body_font reaches a CSS font-family in the client, so the set is closed
-- here as well as in TypeScript. This is the only one of the three validation
-- layers a client cannot go around.
alter table letters drop constraint if exists letters_body_font_known;
alter table letters add  constraint letters_body_font_known
  check (body_font is null or body_font in
    ('lora', 'eb-garamond', 'courier-prime', 'caveat', 'dancing-script'));

alter table letters drop constraint if exists letters_salutation_length;
alter table letters add  constraint letters_salutation_length
  check (salutation is null or char_length(salutation) between 1 and 60);

-- Nullable; null means "deliver now" — exactly what every letter has always
-- done. A DATE, not a timestamp: a real mailed letter arrives on a day, not
-- a minute, which keeps the composer to one field and avoids a timezone
-- decision entirely.
alter table letters add column if not exists scheduled_for date;

-- Re-checked on every insert AND every edit (a CHECK constraint validates
-- the row being written, using current_date at THAT moment) — so
-- rescheduling an already-pending letter to a past date is caught exactly
-- the same way a fresh insert would be. Existing rows whose date has since
-- passed are never re-validated, so this cannot retroactively break a
-- letter that has already delivered.
alter table letters drop constraint if exists letters_scheduled_for_not_past;
alter table letters add  constraint letters_scheduled_for_not_past
  check (scheduled_for is null or scheduled_for >= current_date);

alter table letters alter column sender_id   drop not null;
alter table letters alter column receiver_id drop not null;

-- ---------- bonds ----------
--
-- A relationship is a row, not a column. profiles.partner_id answered "who am
-- I with now" and nothing else; it could not say that a relationship had
-- ended, when it ran, or that two people had been together twice.
--
-- INVARIANT, maintained only by link_partners and unlink_partner:
--   profiles.partner_id is not null  <=>  a bonds row exists containing that
--   profile with ended_at is null.
-- partner_id is a cache. Both writes happen in the same security definer
-- transaction, so it cannot drift. Nothing else may write either.
create table if not exists bonds (
  id          uuid primary key default gen_random_uuid(),
  -- Canonical ordering, LOWER uuid first: a pair has exactly one
  -- representation, and it matches the ascending-uuid lock order that
  -- link_partners and unlink_partner already use — so the deadlock reasoning
  -- in those functions carries over to this table unchanged.
  lower_id    uuid references profiles(id) on delete set null,
  upper_id    uuid references profiles(id) on delete set null,
  -- Frozen when the bond ends. After unbonding,
  -- profiles_select_self_or_partner stops either person reading the other's
  -- profile at all, so a past chapter that resolved its title through
  -- profiles would render blank. Same reason unlink_partner already freezes
  -- sender_name/receiver_name onto letters.
  lower_name  text,
  upper_name  text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  -- When each side saw the "this ended" notice. Null means not yet shown.
  lower_seen_end_at timestamptz,
  upper_seen_end_at timestamptz,
  -- Both null guards are load-bearing, not defensive noise. Each id goes null
  -- when that person deletes their account, so a bond both of whose members
  -- have left carries two nulls — and `null is distinct from null` is FALSE,
  -- which would make a bare `lower_id is distinct from upper_id` fail exactly
  -- then and block the `on delete set null` action from firing at all.
  constraint bonds_distinct_members
    check (lower_id is null or upper_id is null or lower_id <> upper_id)
);

-- These are two SEPARATE partial unique indexes, one on lower_id and one on
-- upper_id. Each enforces at most one open bond per person PER POSITIONAL
-- ROLE, not at most one open bond per person overall — a person could
-- legally be lower_id of one open bond and upper_id of another without
-- violating either index. A true per-person constraint is not expressible
-- as a plain unique index over two columns, which is presumably why it
-- was not written that way.
--
-- The race the `if me.partner_id is not null then raise ALREADY_LINKED`
-- check leaves open is actually closed by the `for update` row lock on
-- profiles inside link_partners: it serialises concurrent redemptions, so
-- whichever caller locks the row second sees partner_id already set. These
-- indexes are a useful backstop against a direct write that bypasses
-- link_partners, not the thing preventing two open bonds for the same
-- person. Closed bonds are unconstrained, which is what lets the same pair
-- bond twice and read as two chapters.
create unique index if not exists bonds_one_active_lower
  on bonds(lower_id) where ended_at is null;
create unique index if not exists bonds_one_active_upper
  on bonds(upper_id) where ended_at is null;

alter table letters add column if not exists bond_id uuid references bonds(id);
-- Null while a letter is held. created_at keeps meaning WRITTEN; sent_at is
-- when it was delivered. For an ordinary letter the two are the same instant.
alter table letters add column if not exists sent_at timestamptz;

create index if not exists letters_bond_id_idx on letters(bond_id);

-- The keys were `on delete cascade`, which meant one person deleting their
-- account destroyed the other person's letters too. They now go to null: the
-- account goes, the letters stay.
alter table letters drop constraint if exists letters_sender_id_fkey;
alter table letters add  constraint letters_sender_id_fkey
  foreign key (sender_id) references profiles(id) on delete set null;
alter table letters drop constraint if exists letters_receiver_id_fkey;
alter table letters add  constraint letters_receiver_id_fkey
  foreign key (receiver_id) references profiles(id) on delete set null;

create index if not exists letters_participants_created_idx
  on letters (sender_id, receiver_id, created_at desc);

create index if not exists letters_receiver_created_idx
  on letters (receiver_id, created_at desc);

-- Base58-ish: no 0, O, I or l, so a code read off a screen is unambiguous.
-- Uses the CSPRNG rather than random(): this is a bearer credential, and the
-- app is already careful to use one for share slugs.
--
-- `extensions` MUST be on the search_path here. gen_random_bytes comes from
-- pgcrypto, which Supabase installs into the `extensions` schema — and
-- `create extension if not exists pgcrypto` above is a no-op when it is
-- already there, so it does not move it into public. Without this the
-- function raises "function gen_random_bytes(integer) does not exist", the
-- handle_new_user trigger aborts, and every sign-up fails with Supabase's
-- generic "Database error saving new user". pg_temp stays last so a
-- temporary object cannot shadow anything.
create or replace function new_invite_code()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, (get_byte(gen_random_bytes(1), 0) % 58) + 1, 1);
    end loop;
    exit when not exists (select 1 from profiles where invite_code = code);
  end loop;
  return code;
end;
$$;

revoke all on function new_invite_code() from public;

-- A new auth user gets a profile automatically, with a random invite code.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into profiles (id, full_name, invite_code) values (new.id, '', new_invite_code());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Links two profiles in ONE transaction. A half-applied link would leave
-- one person able to write to someone who cannot write back.
create or replace function link_partners(code text)
returns profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me_id    uuid := auth.uid();
  other_id uuid;
  me       profiles;
  other    profiles;
begin
  select id into other_id from profiles where invite_code = code;
  if other_id is null then
    raise exception 'INVALID_CODE';
  end if;

  -- Lock both rows, LOWER uuid first: two people redeeming each other's
  -- codes concurrently would otherwise each lock their own row first and
  -- then block waiting for the other's — a mutual-redeem deadlock.
  -- unlink_partner locks in this same ascending-uuid order, so any pair of
  -- calls that lock the same two profile rows — two link_partners, two
  -- unlink_partner, or one of each — acquire them in the same order and
  -- cannot deadlock against each other.
  if me_id < other_id then
    select * into me    from profiles where id = me_id    for update;
    select * into other from profiles where id = other_id for update;
  else
    select * into other from profiles where id = other_id for update;
    select * into me    from profiles where id = me_id    for update;
  end if;

  if me is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if me.partner_id is not null then
    raise exception 'ALREADY_LINKED';
  end if;
  if other is null then
    raise exception 'INVALID_CODE';
  end if;
  if other.id = me.id then
    raise exception 'OWN_CODE';
  end if;
  if other.partner_id is not null then
    raise exception 'LINK_ALREADY_USED';
  end if;

  update profiles set partner_id = other.id where id = me.id;
  update profiles set partner_id = me.id   where id = other.id;

  -- Open the chapter. A pair that bonded, unbonded and bonds again gets a
  -- SECOND row: the partial unique indexes constrain only open bonds. That is
  -- the intended behaviour, not an oversight — it is what makes a reunion
  -- read as its own chapter rather than merging with the first.
  insert into bonds (lower_id, upper_id)
  values (least(me.id, other.id), greatest(me.id, other.id));

  select * into me from profiles where id = me.id;
  return me;
end;
$$;

-- Recovery path. An invite code is a bearer credential with no expiry, so a
-- link redeemed by the wrong person is otherwise permanent — partner_id is
-- outside the app's column grant and nothing in the UI can undo it. No UI
-- calls this yet; having it means one statement fixes a mis-pairing instead
-- of hand-editing rows.
create or replace function unlink_partner()
returns profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me_id    uuid := auth.uid();
  other_id uuid;
  me       profiles;
  other    profiles;
begin
  select partner_id into other_id from profiles where id = me_id;

  -- Lock both rows, LOWER uuid first — same canonical order as
  -- link_partners, so this cannot deadlock against a concurrent
  -- link_partners or unlink_partner touching the same pair. No second row
  -- to lock when the caller has no partner.
  if other_id is null then
    select * into me from profiles where id = me_id for update;
  elsif me_id < other_id then
    select * into me    from profiles where id = me_id    for update;
    select * into other from profiles where id = other_id for update;
  else
    select * into other from profiles where id = other_id for update;
    select * into me    from profiles where id = me_id    for update;
  end if;

  if me is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  -- Without this, the block below is skipped entirely when there is no
  -- partner, but the unconditional update after it still fires — succeeding
  -- and rotating the caller's invite code for no reason, silently killing
  -- any invite link they had already shared. The mock already refuses this
  -- case; this brings the database in line with it.
  if me.partner_id is null then
    raise exception 'NO_BOND';
  end if;

  if me.partner_id is not null then
    -- The unlocked read above can be stale (e.g. the partner changed
    -- between it and our lock); re-lock the current partner if it isn't
    -- the row we already hold.
    if other is null or other.id <> me.partner_id then
      select * into other from profiles where id = me.partner_id for update;
    end if;
    -- Rotate both codes: the old link may be why they are unlinking.
    update profiles set partner_id = null, invite_code = new_invite_code()
      where id = other.id;

    -- Close the chapter and freeze both names while this function can still
    -- read the profiles. After the partner_id nulls below,
    -- profiles_select_self_or_partner stops each of them reading the other at
    -- all, so a past chapter with no frozen title would render blank.
    update bonds
       set ended_at   = coalesce(ended_at, now()),
           lower_name = coalesce(lower_name, (select full_name from profiles
                                              where id = bonds.lower_id)),
           upper_name = coalesce(upper_name, (select full_name from profiles
                                              where id = bonds.upper_id))
     where ended_at is null
       and lower_id = least(me.id, other.id)
       and upper_id = greatest(me.id, other.id);

    -- A breakup moves the correspondence to both people's archives. Doing it
    -- here rather than in the client means it is atomic: it cannot half-apply
    -- because someone closed a tab.
    update letters
       set sender_archived_at   = coalesce(sender_archived_at, now())
     where sender_id = me.id and receiver_id = other.id;
    update letters
       set receiver_archived_at = coalesce(receiver_archived_at, now())
     where receiver_id = me.id and sender_id = other.id;
    update letters
       set sender_archived_at   = coalesce(sender_archived_at, now())
     where sender_id = other.id and receiver_id = me.id;
    update letters
       set receiver_archived_at = coalesce(receiver_archived_at, now())
     where receiver_id = other.id and sender_id = me.id;

    -- Freeze both names as they are now. The UI resolves an author through a
    -- single partnerName that empties when partner_id goes null, so without
    -- this every archived letter would show a blank author the moment the two
    -- unlink — the exact problem this change exists to fix.
    update letters
       set sender_name   = coalesce(sender_name, me.full_name)
     where sender_id = me.id and receiver_id = other.id;
    update letters
       set receiver_name = coalesce(receiver_name, me.full_name)
     where receiver_id = me.id and sender_id = other.id;
    update letters
       set sender_name   = coalesce(sender_name, other.full_name)
     where sender_id = other.id and receiver_id = me.id;
    update letters
       set receiver_name = coalesce(receiver_name, other.full_name)
     where receiver_id = other.id and sender_id = me.id;
  end if;

  update profiles set partner_id = null, invite_code = new_invite_code()
    where id = me.id;

  select * into me from profiles where id = me.id;
  return me;
end;
$$;

revoke all on function unlink_partner() from public;
grant execute on function unlink_partner() to authenticated;

-- Addresses a held letter to the caller's current partner. created_at is
-- never touched: the letter's date is when it was WRITTEN, which is the whole
-- point of holding it.
create or replace function send_held_letter(letter_id uuid)
returns letters
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me_id   uuid := auth.uid();
  bond    bonds;
  target  uuid;
  result  letters;
begin
  if me_id is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into bond from bonds
   where ended_at is null and (lower_id = me_id or upper_id = me_id)
     for update;
  if bond is null then
    raise exception 'NO_BOND';
  end if;

  target := case when bond.lower_id is distinct from me_id
                 then bond.lower_id else bond.upper_id end;
  if target is null then
    raise exception 'NO_BOND';
  end if;

  -- `is not distinct from`, not `=`: this comparison lives in a WHERE
  -- clause, not an `if`, so a NULL result would already exclude the row
  -- rather than silently pass anything through — a plain `=` would fail
  -- safe here too. The reason to use `is not distinct from` anyway is
  -- consistency with how this file writes every other identity check, so a
  -- reader never has to stop and ask which comparison operator this
  -- particular spot needed.
  update letters
     set receiver_id = target,
         bond_id     = bond.id,
         sent_at     = now()
   where id = letter_id
     and sender_id is not distinct from me_id
     and receiver_id is null
     and sent_at is null
  returning * into result;

  if result is null then
    raise exception 'LETTER_NOT_FOUND_OR_ALREADY_SENT';
  end if;
  return result;
end;
$$;

revoke all on function send_held_letter(uuid) from public;
grant execute on function send_held_letter(uuid) to authenticated;

-- The client has no write access to bonds at all, so dismissing the
-- "this ended" notice needs a function of its own.
create or replace function acknowledge_bond_end(bond_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me_id uuid := auth.uid();
begin
  if me_id is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  update bonds
     set lower_seen_end_at = case when lower_id is not distinct from me_id
                                  then coalesce(lower_seen_end_at, now())
                                  else lower_seen_end_at end,
         upper_seen_end_at = case when upper_id is not distinct from me_id
                                  then coalesce(upper_seen_end_at, now())
                                  else upper_seen_end_at end
   where id = bond_id
     and ended_at is not null
     and (lower_id is not distinct from me_id or upper_id is not distinct from me_id);
end;
$$;

revoke all on function acknowledge_bond_end(uuid) from public;
grant execute on function acknowledge_bond_end(uuid) to authenticated;

-- When someone leaves, their letters must not leave with them. This freezes
-- the name as it was at that moment and archives the survivor's side, so the
-- correspondence moves quietly to the archive rather than sitting in the
-- timeline with a blank name on it.
create or replace function freeze_profile_letters()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update letters
     set sender_name = coalesce(sender_name, old.full_name),
         receiver_archived_at = coalesce(receiver_archived_at, now())
   where sender_id = old.id;

  update letters
     set receiver_name = coalesce(receiver_name, old.full_name),
         sender_archived_at = coalesce(sender_archived_at, now())
   where receiver_id = old.id;

  -- An account leaving must close its bond. Otherwise the row stays open
  -- forever and the partial unique index then blocks the SURVIVOR from ever
  -- bonding with anyone again — a departure silently ending someone else's
  -- future.
  update bonds
     set ended_at   = coalesce(ended_at, now()),
         lower_name = coalesce(lower_name, (select full_name from profiles
                                            where id = bonds.lower_id)),
         upper_name = coalesce(upper_name, (select full_name from profiles
                                            where id = bonds.upper_id))
   where ended_at is null
     and (lower_id = old.id or upper_id = old.id);

  return old;
end;
$$;

drop trigger if exists profiles_freeze_letters on profiles;
create trigger profiles_freeze_letters
  before delete on profiles
  for each row execute function freeze_profile_letters();

-- The anonymous reader's path to a shared letter.
--
-- This is a FUNCTION, not a view, and that is the security control. A view
-- granted to `anon` can be selected with no filter, which would let anyone
-- list every shared letter in the database — and unlisted-link privacy rests
-- entirely on the slug being unguessable. A function makes the slug a
-- mandatory argument, so possession of the link is the only way in.
--
-- Returns exactly the six columns the spec allows an anonymous reader to
-- see. Ids and emails are unreachable from here.
--
-- The joins are LEFT joins so a shared letter survives its author's account
-- deletion, falling back to the frozen name rather than disappearing.
--
-- The return type gains two columns below, and `create or replace` cannot
-- change a function's OUT columns — it fails with "cannot change return type
-- of existing function". This drop is what makes the file re-runnable.
drop function if exists get_public_letter(text);

create or replace function get_public_letter(slug text)
returns table (
  message       text,
  created_at    timestamptz,
  sender_name   text,
  receiver_name text,
  salutation    text,
  body_font     text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.message,
         l.created_at,
         coalesce(sender.full_name, l.sender_name),
         coalesce(receiver.full_name, l.receiver_name),
         l.salutation,
         l.body_font
  from letters l
  left join profiles sender   on sender.id   = l.sender_id
  left join profiles receiver on receiver.id = l.receiver_id
  where l.share_slug = slug
    and l.is_public = true
    -- Either person deleting revokes the link. This is the whole enforcement
    -- of that decision, and it lives here because this function is the only
    -- thing an anonymous reader can reach — a check in the client would be
    -- advisory, since the reader is not running our client.
    --
    -- Deliberately NO archive clause: unlink_partner archives the entire
    -- correspondence, so revoking on archive would mean a breakup silently
    -- broke every link either of them had ever sent to anyone.
    and l.sender_deleted_at is null
    and l.receiver_deleted_at is null
$$;

revoke all on function get_public_letter(text) from public;
grant execute on function get_public_letter(text) to anon, authenticated;

-- link_partners needs an authenticated caller; it fails safely for anon
-- (auth.uid() is null), but there is no reason to expose it.
revoke all on function link_partners(text) from public;
grant execute on function link_partners(text) to authenticated;

-- Resolves the caller's partner WITHOUT re-entering the profiles RLS policy.
-- A policy on `profiles` that subqueries `profiles` makes Postgres raise
-- "infinite recursion detected in policy for relation profiles", which fails
-- every profile read and every letter insert. security definer breaks the
-- cycle.
create or replace function current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select partner_id from profiles where id = auth.uid()
$$;

revoke all on function current_partner_id() from public;
grant execute on function current_partner_id() to authenticated;

-- Enforces what RLS cannot express: which COLUMNS each participant may
-- change. Without this, a receiver could
-- rewrite the sender's words, and either party could re-point receiver_id
-- into a stranger's inbox — defeating the insert policy's partner check.
create or replace function enforce_letter_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- A letter cannot be rewritten after it is sent, and how it addressed
  -- someone and what face it was written in are part of the letter. Without
  -- these two, a sender could change the salutation on a letter the recipient
  -- had already read.
  if new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id
     or new.salutation is distinct from old.salutation
     or new.body_font is distinct from old.body_font then
    raise exception 'IMMUTABLE_COLUMN';
  end if;

  -- sender_id and receiver_id may go to NULL and nowhere else. That single
  -- transition is the `on delete set null` action firing when a profile is
  -- deleted: the letter outlives its author. Any other change would
  -- re-address the letter, which is the attack the column grants and this
  -- check exist to stop.
  if new.sender_id is distinct from old.sender_id and new.sender_id is not null then
    raise exception 'IMMUTABLE_COLUMN';
  end if;
  -- receiver_id may go to NULL (the `on delete set null` action firing), and
  -- may be filled in ONCE from null by a security definer function — that is
  -- send_held_letter addressing a held letter. Nothing else. The exemption
  -- also requires old.sent_at is null, because receiver_id can return to
  -- NULL on a letter that was already delivered (the recipient later
  -- deleting their account fires the same `on delete set null` action) —
  -- without the sent_at check that letter would re-enter the "never
  -- addressed" exemption window and could be re-sent to a new partner,
  -- carrying its original created_at into a chapter it was never part of.
  -- sent_at, once set, is otherwise immutable, so it is the one field that
  -- still remembers "this was delivered" after receiver_id has been wiped.
  --
  -- current_user is 'authenticated' for every PostgREST request, so a
  -- client can still never change receiver_id by any path. The exemption
  -- also excludes 'anon' explicitly rather than naming the definer-function
  -- owner role (which isn't knowable from this file) — this makes the
  -- exemption an anti-allowlist, true for anon too, so the trigger only
  -- stays a real backstop as long as policies.sql also revokes all
  -- privileges on letters from anon and grants it no policy of its own; a
  -- reader who loosens that grant must revisit this check. Once addressed,
  -- a never-before-sent letter can never be re-addressed by anyone else,
  -- which is the property the original check exists to guarantee:
  -- otherwise either party could re-point receiver_id into a stranger's
  -- inbox and defeat the insert policy's partner check.
  if new.receiver_id is distinct from old.receiver_id
     and new.receiver_id is not null
     and not (old.receiver_id is null and old.sent_at is null
              and current_user not in ('authenticated', 'anon')) then
    raise exception 'IMMUTABLE_COLUMN';
  end if;

  -- bond_id and sent_at follow the same rule: fillable once, from null, and
  -- only from inside the database. A client that could set bond_id would file
  -- a letter into someone else's chapter.
  if new.bond_id is distinct from old.bond_id
     and new.bond_id is not null
     and not (old.bond_id is null and current_user not in ('authenticated', 'anon')) then
    raise exception 'IMMUTABLE_COLUMN';
  end if;
  if new.sent_at is distinct from old.sent_at
     and new.sent_at is not null
     and not (old.sent_at is null and current_user not in ('authenticated', 'anon')) then
    raise exception 'IMMUTABLE_COLUMN';
  end if;

  if new.is_read is distinct from old.is_read
     and auth.uid() is distinct from old.receiver_id then
    raise exception 'ONLY_RECEIVER_MAY_READ';
  end if;

  -- Each side owns its own archive and delete state and nobody else's —
  -- but ONLY when the update comes straight from a client.
  --
  -- `unlink_partner` and `freeze_profile_letters` are security definer and
  -- archive BOTH people's sides on their behalf. Inside them current_user is
  -- the function owner, not `authenticated`, while auth.uid() still reads the
  -- caller's JWT — so without this guard the per-side rule below would fire on
  -- the partner's row and make unlinking, and account deletion, fail outright.
  -- PostgREST sets the role to `authenticated` for a signed-in request, which
  -- is the same role every grant in this file already names.
  if current_user = 'authenticated' then
    if (new.sender_archived_at is distinct from old.sender_archived_at
        or new.sender_deleted_at is distinct from old.sender_deleted_at)
       and auth.uid() is distinct from old.sender_id then
      raise exception 'NOT_YOUR_SIDE';
    end if;
    if (new.receiver_archived_at is distinct from old.receiver_archived_at
        or new.receiver_deleted_at is distinct from old.receiver_deleted_at)
       and auth.uid() is distinct from old.receiver_id then
      raise exception 'NOT_YOUR_SIDE';
    end if;
  end if;

  -- Either participant may share. The correspondence belongs to both of
  -- them; what they must NOT be able to do is rewrite it or re-address it,
  -- which the checks above prevent.
  return new;
end;
$$;

drop trigger if exists letters_enforce_update on letters;
create trigger letters_enforce_update
  before update on letters
  for each row execute function enforce_letter_update();

-- bond_id is not client-writable — `grant insert (sender_id, receiver_id,
-- message)` in policies.sql omits it precisely so nobody can file a letter
-- into someone else's chapter. So the database derives it. A letter to a
-- partner belongs to the open bond; a held letter belongs to none.
--
-- A BEFORE INSERT trigger assigning NEW.bond_id is NOT subject to column
-- grants, which is what makes this work. Without this trigger every letter
-- would insert with bond_id null and nothing would ever appear in a chapter.
create or replace function set_letter_bond()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.receiver_id is null then
    new.bond_id := null;
    new.sent_at := null;
  else
    select id into new.bond_id from bonds
     where ended_at is null
       and ((lower_id = new.sender_id   and upper_id = new.receiver_id)
         or (lower_id = new.receiver_id and upper_id = new.sender_id));
    if new.bond_id is null then
      raise exception 'NO_BOND';
    end if;
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists letters_set_bond on letters;
create trigger letters_set_bond
  before insert on letters
  for each row execute function set_letter_bond();
