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
set search_path = public
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
set search_path = public
as $$
declare
  me    profiles;
  other profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if me.partner_id is not null then
    raise exception 'ALREADY_LINKED';
  end if;

  select * into other from profiles where invite_code = code;
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

-- The anonymous reader's view of a shared letter. Exactly four columns:
-- ids and emails must be unreachable from an unauthenticated session.
-- security_invoker = false is deliberate and load-bearing. With invoker
-- rights the view would run as the caller, and an anonymous caller has no
-- SELECT policy on `letters` — so the view would return nothing and every
-- share link would 404. Running as the view owner is what lets this view
-- be the restricted window onto letters that the spec calls for; the
-- WHERE clause and the four-column list are the entire boundary, which is
-- why neither may be widened.
create or replace view public_letters
with (security_invoker = false)
as
  select
    l.share_slug           as share_slug,
    l.message              as message,
    l.created_at           as created_at,
    sender.full_name       as sender_name,
    receiver.full_name     as receiver_name
  from letters l
  join profiles sender   on sender.id   = l.sender_id
  join profiles receiver on receiver.id = l.receiver_id
  where l.is_public = true and l.share_slug is not null;

grant select on public_letters to anon, authenticated;
