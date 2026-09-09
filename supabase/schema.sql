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
  sender_id   uuid        not null references profiles(id) on delete cascade,
  receiver_id uuid        not null references profiles(id) on delete cascade,
  -- The mock enforced this in the repository. The Supabase adapter cannot,
  -- and RLS does not inspect content, so the guarantee lives here instead.
  message     text        not null check (char_length(message) between 1 and 5000),
  created_at  timestamptz not null default now(),
  is_read     boolean     not null default false,
  share_slug  text        unique,
  is_public   boolean     not null default false
);

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
    raise exception 'ALREADY_LINKED';
  end if;

  update profiles set partner_id = other.id where id = me.id;
  update profiles set partner_id = me.id   where id = other.id;

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
  end if;

  update profiles set partner_id = null, invite_code = new_invite_code()
    where id = me.id;

  select * into me from profiles where id = me.id;
  return me;
end;
$$;

revoke all on function unlink_partner() from public;
grant execute on function unlink_partner() to authenticated;

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
  select l.message, l.created_at, sender.full_name, receiver.full_name
  from letters l
  join profiles sender   on sender.id   = l.sender_id
  join profiles receiver on receiver.id = l.receiver_id
  where l.share_slug = slug and l.is_public = true
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
  if new.sender_id is distinct from old.sender_id
     or new.receiver_id is distinct from old.receiver_id
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
    raise exception 'IMMUTABLE_COLUMN';
  end if;

  if new.is_read is distinct from old.is_read and auth.uid() <> old.receiver_id then
    raise exception 'ONLY_RECEIVER_MAY_READ';
  end if;

  -- Either participant may share. The share button lives in the Letter
  -- View, which shows RECEIVED letters, so the person sharing is normally
  -- the receiver — "look what they wrote me" is the feature, not a leak.
  -- The correspondence belongs to both of them; what they must NOT be able
  -- to do is rewrite it or re-address it, which the checks above prevent.
  return new;
end;
$$;

drop trigger if exists letters_enforce_update on letters;
create trigger letters_enforce_update
  before update on letters
  for each row execute function enforce_letter_update();
