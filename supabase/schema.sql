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

-- At most one OPEN bond per person, enforced by the database rather than by a
-- read-then-write check inside link_partners. The existing
-- `if me.partner_id is not null then raise ALREADY_LINKED` can in principle be
-- raced; a partial unique index cannot. Closed bonds are unconstrained, which
-- is what lets the same pair bond twice and read as two chapters.
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
-- Returns exactly the four columns the spec allows an anonymous reader to
-- see. Ids and emails are unreachable from here.
--
-- The joins are LEFT joins so a shared letter survives its author's account
-- deletion, falling back to the frozen name rather than disappearing.
create or replace function get_public_letter(slug text)
returns table (
  message       text,
  created_at    timestamptz,
  sender_name   text,
  receiver_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.message,
         l.created_at,
         coalesce(sender.full_name, l.sender_name),
         coalesce(receiver.full_name, l.receiver_name)
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
  if new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
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
  if new.receiver_id is distinct from old.receiver_id and new.receiver_id is not null then
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
