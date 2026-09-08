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

create index if not exists letters_share_slug_idx
  on letters (share_slug) where share_slug is not null;

-- A new auth user gets a profile automatically, with a random invite code.
-- Base58-ish: no 0, O, I or l, so a code read off a screen is unambiguous.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  code text;
begin
  loop
    code := array_to_string(array(
      select substr('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
                    (floor(random() * 58) + 1)::int, 1)
      from generate_series(1, 8)
    ), '');
    exit when not exists (select 1 from profiles where invite_code = code);
  end loop;

  insert into profiles (id, full_name, invite_code)
  values (new.id, '', code);
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
  me    profiles;
  other profiles;
begin
  -- Lock both rows: two people redeeming the same code concurrently would
  -- otherwise both see partner_id null, both pass, and the last write would
  -- win — leaving A pointing at B while B points at C.
  select * into me from profiles where id = auth.uid() for update;
  if me is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if me.partner_id is not null then
    raise exception 'ALREADY_LINKED';
  end if;

  select * into other from profiles where invite_code = code for update;
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

-- Enforces the column split RLS cannot express: the receiver may only flip
-- is_read; the sender may only publish. Without this, a receiver could
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

  if (new.is_public is distinct from old.is_public
      or new.share_slug is distinct from old.share_slug)
     and auth.uid() <> old.sender_id then
    raise exception 'ONLY_SENDER_MAY_SHARE';
  end if;

  return new;
end;
$$;

drop trigger if exists letters_enforce_update on letters;
create trigger letters_enforce_update
  before update on letters
  for each row execute function enforce_letter_update();
