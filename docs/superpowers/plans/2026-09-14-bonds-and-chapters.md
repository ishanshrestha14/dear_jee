# Bonds and Chapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a relationship a first-class row, so that bonds can end, successive relationships each read as their own chapter, and an unbonded person can still write.

**Architecture:** A new `bonds` table records one row per relationship, open (`ended_at is null`) or closed. `letters.bond_id` files each letter into a chapter; null means a held letter belonging to no chapter yet. `profiles.partner_id` survives as a cache of the open bond, maintained only by the two `security definer` functions that write both. The chapter model is deliberately incapable of granting read access — `letters_select_participant` is unchanged — so "past chapters are read-only" is structural rather than a UI convention.

**Tech Stack:** Postgres 15 (Supabase), PostgREST, React 19, TypeScript, Vitest, React Router 7.

**Spec:** `docs/superpowers/specs/2026-09-13-bonds-and-chapters-design.md`

## Global Constraints

- **`npm run typecheck` (`tsc -b`) is the type gate.** `npx tsc --noEmit` is a NO-OP in this repo — the root tsconfig is `{"files": [], "references": [...]}`, type-checks zero files, and always exits 0. It is never evidence.
- **Every task ends green.** `npm run typecheck && npm test && npm run lint` must pass before the commit step. Lint must show exactly two `set-state-in-effect` warnings (`useLetters.ts` and `usePublicLetter.ts`) — no more, no fewer.
- **The 42 existing contract cases must keep passing, unchanged.** They assert on seeded data. If chapter scoping is right they return exactly what they return today. A break in the 42 means the scoping is wrong — fix the scoping, never the test.
- **Repository methods return `{ data, error }` and NEVER throw.** Every Supabase adapter method body goes through `guard()`.
- **Never narrow a `Result` with a truthiness check.** Use `=== null` / `!== null` — the empty string is a falsy `string` and will not narrow. Supabase's own `error` objects are a different shape; `if (error)` is correct for those.
- **Read methods return copies** (`{ ...letter }`), never references into the store.
- **The mock has no RLS.** Whatever the database enforces with a policy, the mock reimplements in TypeScript. Five invariants are added by this plan; every one must exist in both.
- **SQL must stay idempotent.** A LIVE project exists: `add column if not exists`, `create table if not exists`, `create index if not exists`, `drop policy if exists` before `create policy`, `create or replace function`.
- **Every function carries `set search_path = public, pg_temp`** — EXCEPT `new_invite_code`, which needs `public, extensions, pg_temp`.
- **Comparing `auth.uid()` in an authorization check uses `is distinct from`, not `<>`.** A NULL caller makes `<>` yield NULL, which is falsy in an `if`, so the guard silently permits.
- **Components under `src/components/` must not import VALUES from `src/data/`.** `import type` is fine.
- Palette is fixed: `#FDFBF7`, `#F4EFE6`, `#2C2825`, `#1A1A1A` at 85%, `#C87963`, `#D4AF37`, plus `--color-paper-edge`, `--color-ink-muted`, `--color-accent-soft`. Never pure white `#FFFFFF` or pure black `#000000`.
- Three type roles only: Plus Jakarta Sans (`font-ui`), Lora (`font-letter`), Caveat (`font-hand`).
- A misspelled Tailwind token emits NO CSS and fails silently. Check names against `src/design/tokens.css`.
- All animation respects `prefers-reduced-motion` through the single `<MotionConfig reducedMotion="user">` in `src/app/App.tsx`. Never add per-component guards.
- Widths use `max-w-*` caps, never fixed `w-[…]` or `min-w-`.
- Tests are logic-level only. No component tests, no hook tests, no jsdom, no Testing Library.
- **Every commit message ends with these two trailers**, so they are not repeated in each task:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TRa82VR1nNNbiQhY6UKUaq
  ```

- **All SQL in this plan is unexecuted.** No task may claim a migration ran. Tasks 1–4 end with "the file parses and is idempotent by inspection", never "the schema is live". Applying it is the owner's step, recorded in Task 14.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/schema.sql` | modify | `bonds` table, indexes, `letters.bond_id`/`sent_at`, the four changed functions, two new functions, the trigger exception |
| `supabase/policies.sql` | modify | `bonds` RLS, relaxed letters insert policy, letters insert column grants |
| `supabase/reset-test-data.sql` | create | One-shot wipe of test rows. Separate from `schema.sql` because it is destructive and must never be re-run casually |
| `src/data/types.ts` | modify | `Bond`, `BondRepository`, three new `LetterRepository` methods, `Letter.bondId`/`sentAt`, `SendLetterInput.receiverId` widened to nullable |
| `src/data/mockRepository.ts` | modify | The five invariants in TypeScript, a seeded bond, held letters |
| `src/data/supabaseRepository.ts` | modify | Bond queries, chapter scoping, `sendHeld` via RPC |
| `src/data/index.ts` | modify | Export `bondRepository` |
| `src/data/contractTests.ts` | modify | New contract cases; `ContractFixture` gains `bonds` |
| `src/data/mockRepository.test.ts` | modify | Fixture supplies the bond repository |
| `src/hooks/useBonds.ts` | create | Bond list, unlink, acknowledge — one concern, kept out of `useLetters` |
| `src/hooks/useLetters.ts` | modify | Held letters, `sendHeld`, unbonded send |
| `src/routes/Settings.tsx` | create | Name, bond status, End this bond, Sign out |
| `src/routes/Chapters.tsx` | create | Past chapter list |
| `src/routes/Chapter.tsx` | create | One past chapter, read-only |
| `src/routes/Inbox.tsx` | modify | Unsent section, ended-bond banner |
| `src/components/LetterModal.tsx` | modify | `readOnly` prop that hides the archive toggle |
| `src/components/Layout.tsx` | modify | Settings and Chapters links; Sign out moves out |
| `src/app/App.tsx` | modify | Three new lazy routes |
| `README.md` | modify | Phase 6 build record |

**The seam.** Tasks 1–2, 4–7 and 9–12 deliver bonds, unlinking and past chapters — working, testable software on their own. Tasks 3, 8 and 13 add held letters and are the only ones needing the trigger exception and `send_held_letter`. Stopping after Task 12 leaves a coherent product.

---

### Task 1: The bonds table

**Files:**
- Modify: `supabase/schema.sql`
- Create: `supabase/reset-test-data.sql`

**Interfaces:**
- Produces: table `bonds(id, lower_id, upper_id, lower_name, upper_name, started_at, ended_at, lower_seen_end_at, upper_seen_end_at)`; columns `letters.bond_id`, `letters.sent_at`

- [ ] **Step 1: Add the table after the `letters` alters**

In `supabase/schema.sql`, immediately after the `alter table letters alter column receiver_id drop not null;` line, insert:

```sql
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
```

- [ ] **Step 2: Create the reset script**

Create `supabase/reset-test-data.sql`:

```sql
-- DESTRUCTIVE. Run once, by hand, when adopting the bonds model.
--
-- Every letter in the live project on 2026-09-14 was test data, confirmed by
-- the owner, so this discards rather than backfills. That is deliberate:
-- started_at and ended_at for historical bonds are NOT recoverable from
-- letter dates, and any inferred value would be a fabrication presented as
-- history.
--
-- This file is NOT idempotent in intent — re-running it destroys real letters.
-- It is kept out of schema.sql for exactly that reason.

delete from letters;
update profiles set partner_id = null, invite_code = new_invite_code();

-- Do NOT delete from profiles. profiles.id references auth.users on delete
-- cascade, and handle_new_user fires only on INSERT into auth.users — so a
-- deleted profile row leaves a signed-in account with no profile and no way
-- to recreate one. To start fully clean, delete the test users from
-- Supabase -> Authentication -> Users, which cascades correctly.
```

- [ ] **Step 3: Verify the SQL parses and stays idempotent**

Run: `grep -c "if not exists" supabase/schema.sql`
Expected: a count that increased by 6 from before this task (one table, two indexes, two columns, one index).

Run: `grep -n "create table\|create unique index\|create index" supabase/schema.sql | grep -v "if not exists"`
Expected: NO output. Every create in the file must be guarded.

- [ ] **Step 4: Verify nothing in the app moved**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck clean, 42 passing across 4 files, exactly two `set-state-in-effect` warnings. No TypeScript file changed in this task, so anything else is a signal something else is wrong.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/reset-test-data.sql
git commit -m "feat(sql): a relationship becomes a row"
```

State in the commit body that the SQL is unexecuted.

---

### Task 2: link, unlink and account deletion maintain bonds

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: table `bonds` from Task 1
- Produces: `link_partners` opens a bond; `unlink_partner` closes it and freezes both names; `freeze_profile_letters` closes an open bond on account deletion

- [ ] **Step 1: Open a bond in `link_partners`**

In `link_partners`, replace these two lines:

```sql
  update profiles set partner_id = other.id where id = me.id;
  update profiles set partner_id = me.id   where id = other.id;
```

with:

```sql
  update profiles set partner_id = other.id where id = me.id;
  update profiles set partner_id = me.id   where id = other.id;

  -- Open the chapter. A pair that bonded, unbonded and bonds again gets a
  -- SECOND row: the partial unique indexes constrain only open bonds. That is
  -- the intended behaviour, not an oversight — it is what makes a reunion
  -- read as its own chapter rather than merging with the first.
  insert into bonds (lower_id, upper_id)
  values (least(me.id, other.id), greatest(me.id, other.id));
```

- [ ] **Step 2: Close the bond in `unlink_partner`**

In `unlink_partner`, inside the `if me.partner_id is not null then` block, immediately BEFORE the four `update letters … archived_at` statements, insert:

```sql
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
```

- [ ] **Step 3: Close the bond when an account is deleted**

In `freeze_profile_letters`, after the existing letter-freezing updates and before `return old;`, insert:

```sql
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
```

- [ ] **Step 4: Verify the invariant is stated where it can be seen**

Run: `grep -n "INVARIANT" supabase/schema.sql`
Expected: the invariant comment from Task 1 is present. If a reader can find `bonds` without finding the rule that `partner_id` mirrors it, the cache will drift the first time someone adds a third writer.

Run: `grep -c "least(me.id, other.id)" supabase/schema.sql`
Expected: 2 — one in `link_partners`, one in `unlink_partner`. Both must use the same canonical ordering or a bond will be opened under one key and searched for under another.

- [ ] **Step 5: Verify nothing in the app moved, and commit**

```bash
npm run typecheck && npm test && npm run lint
git add supabase/schema.sql
git commit -m "feat(sql): link and unlink maintain the bond row"
```

---

### Task 3: send_held_letter, acknowledge_bond_end, and the trigger exception

This task is the held-letters seam. It can be deferred; nothing in Tasks 4–7 or 9–12 depends on it.

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: `bonds`, `letters.bond_id`, `letters.sent_at`
- Produces: `send_held_letter(letter_id uuid) returns letters`; `acknowledge_bond_end(bond_id uuid) returns void`

- [ ] **Step 1: Narrow the receiver_id immutability rule**

In `enforce_letter_update`, replace:

```sql
  if new.receiver_id is distinct from old.receiver_id and new.receiver_id is not null then
    raise exception 'IMMUTABLE_COLUMN';
  end if;
```

with:

```sql
  -- receiver_id may go to NULL (the `on delete set null` action firing), and
  -- may be filled in ONCE from null by a security definer function — that is
  -- send_held_letter addressing a held letter. Nothing else.
  --
  -- current_user is 'authenticated' for every PostgREST request, so a client
  -- can still never change receiver_id by any path. Once addressed, a letter
  -- can never be re-addressed by anyone, which is the property the original
  -- check exists to guarantee: otherwise either party could re-point
  -- receiver_id into a stranger's inbox and defeat the insert policy's
  -- partner check.
  if new.receiver_id is distinct from old.receiver_id
     and new.receiver_id is not null
     and not (old.receiver_id is null and current_user <> 'authenticated') then
    raise exception 'IMMUTABLE_COLUMN';
  end if;

  -- bond_id and sent_at follow the same rule: fillable once, from null, and
  -- only from inside the database. A client that could set bond_id would file
  -- a letter into someone else's chapter.
  if new.bond_id is distinct from old.bond_id
     and new.bond_id is not null
     and not (old.bond_id is null and current_user <> 'authenticated') then
    raise exception 'IMMUTABLE_COLUMN';
  end if;
  if new.sent_at is distinct from old.sent_at
     and new.sent_at is not null
     and not (old.sent_at is null and current_user <> 'authenticated') then
    raise exception 'IMMUTABLE_COLUMN';
  end if;
```

- [ ] **Step 2: Add `send_held_letter`**

Append after `unlink_partner`'s grant block in `supabase/schema.sql`:

```sql
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

  -- `is distinct from` throughout: a NULL sender_id on a letter whose author
  -- was deleted would make `<>` yield NULL, which is falsy in an if, so the
  -- guard would silently permit a stranger to send it.
  update letters
     set receiver_id = target,
         bond_id     = bond.id,
         sent_at     = now()
   where id = letter_id
     and sender_id is not distinct from me_id
     and receiver_id is null
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
```

- [ ] **Step 3: Verify every new function carries a search_path**

Run: `grep -c "set search_path = public, pg_temp" supabase/schema.sql`
Expected: increased by 2 from before this task.

Run: `grep -n "create or replace function" supabase/schema.sql | wc -l` then `grep -c "set search_path" supabase/schema.sql`
Expected: equal counts. A function without `search_path` is a privilege-escalation hole, and `new_invite_code` is the only one whose path differs (it needs `extensions` as well).

- [ ] **Step 4: Verify the narrowing did not widen anything**

Run: `grep -n "current_user <> 'authenticated'" supabase/schema.sql`
Expected: exactly 3 hits — `receiver_id`, `bond_id`, `sent_at`. If a fourth appears, something else was loosened.

Run: `grep -n "current_user = 'authenticated'" supabase/schema.sql`
Expected: 1 hit — the pre-existing per-side archive/delete wrapper. That wrapper must stay exactly as it is; removing it breaks account deletion and unlinking.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm test && npm run lint
git add supabase/schema.sql
git commit -m "feat(sql): a held letter can be addressed once, from inside the database"
```

---

### Task 4: RLS and grants

**Files:**
- Modify: `supabase/policies.sql`

**Interfaces:**
- Consumes: `bonds` from Task 1
- Produces: `bonds_select_member` policy; relaxed `letters_insert_own_to_partner`; letters insert column grants

- [ ] **Step 1: Add bonds RLS**

In `supabase/policies.sql`, after the `alter table letters enable row level security;` line, add `bonds` to the enable and revoke blocks:

```sql
alter table bonds enable row level security;
revoke all on bonds from anon;
```

Then, after the profiles section and before the letters section, add:

```sql
-- ---------- bonds ----------

-- You may read a bond you were part of, open or closed. That is what makes a
-- past chapter's title readable after the fact.
drop policy if exists bonds_select_member on bonds;
create policy bonds_select_member on bonds
  for select to authenticated
  using (lower_id = auth.uid() or upper_id = auth.uid());

-- There is deliberately NO insert/update/delete policy. link_partners,
-- unlink_partner, freeze_profile_letters and acknowledge_bond_end are
-- security definer and are the only writers. A client that could write bonds
-- could bond itself to a stranger.
revoke insert, update, delete on bonds from authenticated;
```

- [ ] **Step 2: Relax the letters insert policy for held letters**

Replace the existing `letters_insert_own_to_partner` policy with:

```sql
-- You may write only as yourself, and only to the partner you are linked to —
-- or, when you have no partner at all, to nobody, which is a held letter.
-- Without the partner condition an authenticated user could write letters
-- into any account whose id they could guess.
--
-- Held letters are restricted to the UNBONDED. Someone bonded sitting on an
-- unsent letter is a different feature and is deliberately not built.
drop policy if exists letters_insert_own_to_partner on letters;
create policy letters_insert_own_to_partner on letters
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (receiver_id = current_partner_id()
         or (receiver_id is null and current_partner_id() is null))
  );
```

- [ ] **Step 3: Add the insert column grants that do not currently exist**

After the existing `grant update (…) on letters to authenticated;` block, add:

```sql
-- Column grants are checked BEFORE RLS. The UPDATE path has been locked down
-- since Phase 3; the INSERT path never was, so Supabase's default table grant
-- currently lets a client set is_public, share_slug or sender_archived_at at
-- insert time. This closes that, and is REQUIRED for bonds: a client that
-- could set bond_id itself would file a letter into someone else's chapter.
revoke insert on letters from authenticated;
grant insert (sender_id, receiver_id, message) on letters to authenticated;
```

- [ ] **Step 4: Verify every policy is re-runnable and nothing lost a drop**

Run: `grep -c "create policy" supabase/policies.sql` and `grep -c "drop policy if exists" supabase/policies.sql`
Expected: equal counts. Every `create policy` needs its `drop policy if exists`, or a second run of the file fails.

Run: `grep -n "grant insert" supabase/policies.sql`
Expected: one hit, naming exactly `sender_id, receiver_id, message`. If `bond_id` or `sent_at` appears, a client can file letters into arbitrary chapters.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm test && npm run lint
git add supabase/policies.sql
git commit -m "feat(sql): bonds are readable by their members and writable by nobody"
```

---

### Task 5: Types for bonds and chapters

Adding methods to `LetterRepository` immediately red-lines both implementations, so this task deliberately ends with the types AND the mock's bond lifecycle green together. It is the largest task in the plan; its steps are correspondingly small.

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/data/mockRepository.ts`
- Modify: `src/data/contractTests.ts`
- Modify: `src/data/mockRepository.test.ts`

**Interfaces:**
- Produces: `Bond`, `BondRepository`, `Letter.bondId`, `Letter.sentAt`, `MOCK_BOND_ID`, `ContractFixture.bonds`

- [ ] **Step 1: Add the two new `Letter` fields**

In `src/data/types.ts`, inside `interface Letter`, after `receiverName`:

```ts
  /**
   * Which chapter this letter belongs to. Null means a HELD letter: written
   * while its author had no bond, belonging to no chapter until it is sent.
   */
  bondId: string | null
  /**
   * When it was delivered. Null while held. `createdAt` always means WRITTEN,
   * so a letter held for months keeps the date it was written and gains a
   * separate sent date — never a rewritten one.
   */
  sentAt: string | null
```

- [ ] **Step 2: Add `Bond` and `BondRepository`**

In `src/data/types.ts`, after the `Letter` interface:

```ts
/** One relationship, open or ended. A chapter. */
export interface Bond {
  id: string
  /** The other person. Null once they delete their account. */
  partnerId: string | null
  /** Frozen at the end for a past chapter; the live name for the open one. */
  partnerName: string
  startedAt: string
  /** Null for the one live bond. */
  endedAt: string | null
  /**
   * Resolved per caller: whichever of the two database columns belongs to
   * this user. A caller never sees the other side's.
   */
  seenEndAt: string | null
  /**
   * Letters in this chapter the CALLER can still see — their own deletes are
   * already excluded, so it matches what opening the chapter shows.
   */
  letterCount: number
}
```

And after `ProfileRepository`:

```ts
export interface BondRepository {
  /** Every bond this user has had, newest first. The open one, if any, is first. */
  list(userId: string): Promise<Result<Bond[]>>
  /**
   * Ends the caller's current bond. Symmetric and immediate: both people are
   * freed, both get a fresh invite code, and the whole correspondence moves to
   * both archives. Returns the caller's updated profile.
   */
  unlink(userId: string): Promise<Result<Profile>>
  /** Marks the ended-bond notice as seen by this user, so it stops showing. */
  acknowledgeEnd(userId: string, bondId: string): Promise<Result<void>>
}
```

- [ ] **Step 3: Widen `SendLetterInput` and document the scoping change**

In `src/data/types.ts`, change `SendLetterInput`:

```ts
export interface SendLetterInput {
  senderId: string
  /**
   * Null writes a HELD letter, permitted only when the sender has no bond.
   * Same act as sending, so it shares this one code path and one set of
   * validation rather than gaining a `hold` method of its own.
   */
  receiverId: string | null
  message: string
}
```

Replace the two doc comments at the top of `LetterRepository`:

```ts
  /**
   * The CURRENT chapter: letters exchanged with your present partner, newest
   * first, minus the ones you archived.
   *
   * SCOPED TO THE OPEN BOND — this is the central semantic change of the
   * bonds work and the easiest thing to miss in a diff. It is NOT "every
   * letter you participate in". Letters from a past relationship live in
   * listChapter, and held letters in listHeld; neither appears here.
   */
  listConversation(userId: string): Promise<Result<Letter[]>>
  /** The ones you archived WITHIN the current chapter, newest first. */
  listArchived(userId: string): Promise<Result<Letter[]>>
```

And add three methods after `getBySlug`:

```ts
  /**
   * Your held letters — written with no bond, addressed to nobody, newest
   * first. Visible to their author and to no one else, ever.
   */
  listHeld(userId: string): Promise<Result<Letter[]>>
  /**
   * Addresses a held letter to the caller's current partner. Fails when the
   * letter is already sent, is not yours, or you have no bond. `createdAt` is
   * never altered.
   */
  sendHeld(letterId: string, userId: string): Promise<Result<Letter>>
  /** One past chapter's letters, newest first. Read-only by construction. */
  listChapter(userId: string, bondId: string): Promise<Result<Letter[]>>
```

- [ ] **Step 4: Run the typecheck and watch it fail in exactly two places**

Run: `npm run typecheck`
Expected: FAIL. `mockRepository.ts` and `supabaseRepository.ts` each no longer satisfy `LetterRepository`, and the seeded letters lack `bondId`/`sentAt`. This is the expected red state; it confirms the interface is actually load-bearing rather than decorative.

- [ ] **Step 5: Write the failing contract cases for the bond lifecycle**

In `src/data/contractTests.ts`, add `bonds: BondRepository` to `ContractFixture` and import `BondRepository`. Then add this block inside `describeRepositoryContract`, after the existing cases:

```ts
    describe('bonds', () => {
      it('reports one open bond for a linked pair', async () => {
        const result = await fx.bonds.list(fx.userId)
        expect(result.error).toBe(null)
        expect(result.data).not.toBe(null)
        const open = result.data!.filter((b) => b.endedAt === null)
        expect(open).toHaveLength(1)
        expect(open[0].partnerId).toBe(fx.partnerId)
      })

      it('reports no bond at all for an unlinked account', async () => {
        const solo = await fx.unlinked()
        const result = await solo.bonds.list(solo.userId)
        expect(result.error).toBe(null)
        expect(result.data).toEqual([])
      })

      it('unlinking closes the bond and frees both sides', async () => {
        const unlinked = await fx.bonds.unlink(fx.userId)
        expect(unlinked.error).toBe(null)
        expect(unlinked.data!.partnerId).toBe(null)

        const mine = await fx.profiles.getById(fx.userId)
        const theirs = await fx.profiles.getById(fx.partnerId)
        expect(mine.data!.partnerId).toBe(null)
        expect(theirs.data!.partnerId).toBe(null)

        const bonds = await fx.bonds.list(fx.userId)
        expect(bonds.data!.filter((b) => b.endedAt === null)).toHaveLength(0)
        expect(bonds.data!).toHaveLength(1)
      })

      it('unlinking issues both people a fresh invite code', async () => {
        const before = (await fx.profiles.getById(fx.userId)).data!.inviteCode
        const beforeTheirs = (await fx.profiles.getById(fx.partnerId)).data!.inviteCode
        await fx.bonds.unlink(fx.userId)
        const after = (await fx.profiles.getById(fx.userId)).data!.inviteCode
        const afterTheirs = (await fx.profiles.getById(fx.partnerId)).data!.inviteCode
        expect(after).not.toBe(before)
        expect(afterTheirs).not.toBe(beforeTheirs)
      })

      it('unlinking moves the whole correspondence out of the current chapter', async () => {
        const before = await fx.letters.listConversation(fx.userId)
        expect(before.data!.length).toBeGreaterThan(0)
        await fx.bonds.unlink(fx.userId)
        const after = await fx.letters.listConversation(fx.userId)
        expect(after.data).toEqual([])
      })

      it('a past chapter keeps its letters and its partner name', async () => {
        await fx.bonds.unlink(fx.userId)
        const bonds = await fx.bonds.list(fx.userId)
        const past = bonds.data![0]
        expect(past.endedAt).not.toBe(null)
        expect(past.partnerName).not.toBe('')
        expect(past.letterCount).toBeGreaterThan(0)

        const chapter = await fx.letters.listChapter(fx.userId, past.id)
        expect(chapter.error).toBe(null)
        expect(chapter.data!.length).toBe(past.letterCount)
      })

      it('refuses to unlink someone who has no bond', async () => {
        const solo = await fx.unlinked()
        const result = await solo.bonds.unlink(solo.userId)
        expect(result.error).not.toBe(null)
      })

      it('re-bonding the same person opens a distinct chapter', async () => {
        await fx.bonds.unlink(fx.userId)
        const theirs = (await fx.profiles.getById(fx.partnerId)).data!
        const relinked = await fx.profiles.linkPartner(fx.userId, theirs.inviteCode)
        expect(relinked.error).toBe(null)

        const bonds = await fx.bonds.list(fx.userId)
        expect(bonds.data!).toHaveLength(2)
        expect(bonds.data!.filter((b) => b.endedAt === null)).toHaveLength(1)
        const ids = new Set(bonds.data!.map((b) => b.id))
        expect(ids.size).toBe(2)
      })

      it('a letter from the old chapter never reappears in the new one', async () => {
        const original = (await fx.letters.listConversation(fx.userId)).data!
        expect(original.length).toBeGreaterThan(0)
        await fx.bonds.unlink(fx.userId)
        const theirs = (await fx.profiles.getById(fx.partnerId)).data!
        await fx.profiles.linkPartner(fx.userId, theirs.inviteCode)

        const now = await fx.letters.listConversation(fx.userId)
        expect(now.data).toEqual([])
        const archived = await fx.letters.listArchived(fx.userId)
        expect(archived.data).toEqual([])
      })

      it('acknowledging the end stops the notice for that user only', async () => {
        await fx.bonds.unlink(fx.userId)
        const past = (await fx.bonds.list(fx.userId)).data![0]
        expect(past.seenEndAt).toBe(null)

        const ack = await fx.bonds.acknowledgeEnd(fx.userId, past.id)
        expect(ack.error).toBe(null)

        const mine = (await fx.bonds.list(fx.userId)).data![0]
        expect(mine.seenEndAt).not.toBe(null)
        const theirs = (await fx.bonds.list(fx.partnerId)).data![0]
        expect(theirs.seenEndAt).toBe(null)
      })
    })
```

- [ ] **Step 6: Run the new cases and watch them fail for the right reason**

Run: `npm test`
Expected: FAIL — `fx.bonds` is undefined and `listChapter` does not exist. NOT a type error inside the test itself; if the failure is a syntax or import problem, fix that before continuing, because a test that fails for the wrong reason proves nothing.

- [ ] **Step 7: Add the seeded bond to the mock**

In `src/data/mockRepository.ts`, after the `MOCK_PARTNER_ID` export:

```ts
export const MOCK_BOND_ID = 'bond-seed'
```

Add a `Bond`-shaped internal record — note it is NOT the `Bond` DTO, because the DTO is resolved per caller:

```ts
/**
 * The stored shape, mirroring the bonds TABLE rather than the Bond DTO. The
 * DTO resolves partnerId, partnerName and seenEndAt per caller, so it cannot
 * be what is stored.
 *
 * Named MockBondRow, not BondRow: supabaseRepository.ts has its own snake_case
 * BondRow for the same table, and two same-named types with different casing
 * in neighbouring files is how someone ends up mapping the wrong one.
 */
interface MockBondRow {
  id: string
  lowerId: string | null
  upperId: string | null
  lowerName: string | null
  upperName: string | null
  startedAt: string
  endedAt: string | null
  lowerSeenEndAt: string | null
  upperSeenEndAt: string | null
}

/** Canonical ordering, lower id first — the same rule the SQL uses. */
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function seedBonds(unlinked: boolean): MockBondRow[] {
  if (unlinked) return []
  const [lower, upper] = canonical(MOCK_USER_ID, MOCK_PARTNER_ID)
  return [
    {
      id: MOCK_BOND_ID,
      lowerId: lower,
      upperId: upper,
      lowerName: null,
      upperName: null,
      startedAt: '2026-01-01T09:10:00.000Z',
      endedAt: null,
      lowerSeenEndAt: null,
      upperSeenEndAt: null,
    },
  ]
}
```

- [ ] **Step 8: Assign the seeded letters to the seeded bond**

In `seedLetters`, add to the shared `base` object:

```ts
    bondId: MOCK_BOND_ID,
    sentAt: null,
```

This is what keeps the existing 42 green: all three seeded letters sit inside the seeded bond, so a correctly scoped `listConversation` returns exactly what it returned before.

- [ ] **Step 9: Implement chapter scoping in the mock**

In `createMockRepositories`, add `const bonds = seedBonds(options.unlinked ?? false)` beside the existing `profiles` and `letters`, then add these helpers below `isArchivedBy`'s use site:

```ts
  const openBondFor = (userId: string): MockBondRow | undefined =>
    bonds.find((b) => b.endedAt === null && (b.lowerId === userId || b.upperId === userId))

  const bondsFor = (userId: string): MockBondRow[] =>
    bonds
      .filter((b) => b.lowerId === userId || b.upperId === userId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
```

Replace `listConversation` and `listArchived`:

```ts
    async listConversation(userId) {
      // Scoped to the OPEN bond. No bond means no current chapter, which is a
      // real and renderable state, not an error: an unbonded person's home is
      // empty and their held letters are in listHeld.
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      const mine = letters
        .filter(
          (l) =>
            l.bondId === open.id && visibleTo(l, userId) && !isArchivedBy(l, userId),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listArchived(userId) {
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      const mine = letters
        .filter(
          (l) => l.bondId === open.id && visibleTo(l, userId) && isArchivedBy(l, userId),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listChapter(userId, bondId) {
      // Membership is checked here because the mock has no RLS. The database
      // gets this from bonds_select_member plus letters_select_participant;
      // without this check the two implementations diverge and a chapter id
      // guessed in development would return someone else's letters.
      const bond = bonds.find((b) => b.id === bondId)
      if (bond === undefined) return fail('Chapter not found.')
      if (bond.lowerId !== userId && bond.upperId !== userId) {
        return fail('Chapter not found.')
      }
      const mine = letters
        .filter((l) => l.bondId === bondId && visibleTo(l, userId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },
```

- [ ] **Step 10: Set `bondId` when a letter is sent**

In the mock's `send`, replace the `bondId`/`sentAt` fields of the constructed letter and add the guard above it:

```ts
    async send({ senderId, receiverId, message }: SendLetterInput) {
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)

      const open = openBondFor(senderId)
      // Mirrors letters_insert_own_to_partner: to a partner when you have
      // one, to nobody when you do not, and never to anyone else.
      if (receiverId === null) {
        if (open !== undefined) return fail('You are connected to someone.')
      } else {
        if (open === undefined) return fail('You are not connected to anyone yet.')
        const partner = open.lowerId === senderId ? open.upperId : open.lowerId
        if (receiverId !== partner) return fail('You can only write to your partner.')
      }

      const now = new Date().toISOString()
      const letter: Letter = {
        id: `letter-${crypto.randomUUID()}`,
        senderId,
        receiverId,
        message: message.trim(),
        createdAt: now,
        isRead: false,
        shareSlug: null,
        isPublic: false,
        senderName: null,
        receiverName: null,
        senderArchivedAt: null,
        receiverArchivedAt: null,
        senderDeletedAt: null,
        receiverDeletedAt: null,
        bondId: receiverId === null ? null : open!.id,
        sentAt: receiverId === null ? null : now,
      }
      letters.push(letter)
      return ok({ ...letter })
    },
```

- [ ] **Step 11: Implement the mock bond repository**

Add to `createMockRepositories`, before the return:

```ts
  const toBondDto = (row: MockBondRow, userId: string): Bond => {
    const iAmLower = row.lowerId === userId
    const partnerId = iAmLower ? row.upperId : row.lowerId
    const frozen = iAmLower ? row.upperName : row.lowerName
    const live = partnerId === null ? undefined : findProfile(partnerId)?.fullName
    return {
      id: row.id,
      partnerId,
      // Frozen name wins for an ended bond; the live profile answers for the
      // open one. Falls back to '' rather than throwing — a nameless past
      // partner is a renderable state, an exception is not.
      partnerName: frozen ?? live ?? '',
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      seenEndAt: iAmLower ? row.lowerSeenEndAt : row.upperSeenEndAt,
      letterCount: letters.filter((l) => l.bondId === row.id && visibleTo(l, userId))
        .length,
    }
  }

  const bondRepository: BondRepository = {
    async list(userId) {
      return ok(bondsFor(userId).map((row) => toBondDto(row, userId)))
    },

    async unlink(userId) {
      const me = findProfile(userId)
      if (me === undefined) return fail('Profile not found.')
      const open = openBondFor(userId)
      if (open === undefined) return fail('You are not connected to anyone.')
      const otherId = open.lowerId === userId ? open.upperId : open.lowerId
      const other = otherId === null ? undefined : findProfile(otherId)

      const at = new Date().toISOString()
      // Freeze both names BEFORE clearing partnerId, exactly as
      // unlink_partner does: afterwards neither profile can resolve the
      // other, so a chapter with no frozen title would render blank.
      open.endedAt = at
      open.lowerName =
        open.lowerName ?? (open.lowerId === userId ? me.fullName : (other?.fullName ?? ''))
      open.upperName =
        open.upperName ?? (open.upperId === userId ? me.fullName : (other?.fullName ?? ''))

      for (const letter of letters) {
        if (letter.bondId !== open.id) continue
        if (letter.senderId !== null) letter.senderArchivedAt ??= at
        if (letter.receiverId !== null) letter.receiverArchivedAt ??= at
        letter.senderName ??= letter.senderId === null ? null : findProfile(letter.senderId)?.fullName ?? null
        letter.receiverName ??= letter.receiverId === null ? null : findProfile(letter.receiverId)?.fullName ?? null
      }

      me.partnerId = null
      me.inviteCode = `${me.inviteCode}-2`
      if (other !== undefined) {
        other.partnerId = null
        other.inviteCode = `${other.inviteCode}-2`
      }
      return ok({ ...me })
    },

    async acknowledgeEnd(userId, bondId) {
      const row = bonds.find((b) => b.id === bondId)
      if (row === undefined) return fail('Chapter not found.')
      if (row.lowerId !== userId && row.upperId !== userId) {
        return fail('Chapter not found.')
      }
      if (row.endedAt === null) return fail('That bond has not ended.')
      const at = new Date().toISOString()
      if (row.lowerId === userId) row.lowerSeenEndAt ??= at
      else row.upperSeenEndAt ??= at
      return ok(undefined)
    },
  }
```

Return `{ letters: letterRepository, profiles: profileRepository, bonds: bondRepository }`, and import `Bond` and `BondRepository` as types at the top.

- [ ] **Step 12: Open a bond in the mock's `linkPartner`**

In `profileRepository.linkPartner`, after the two `partnerId` assignments, add:

```ts
      // Mirrors link_partners: a re-bond of the same pair opens a SECOND row
      // rather than reopening the first, which is what makes a reunion its
      // own chapter.
      const [lower, upper] = canonical(self.id, other.id)
      bonds.push({
        id: `bond-${crypto.randomUUID()}`,
        lowerId: lower,
        upperId: upper,
        lowerName: null,
        upperName: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        lowerSeenEndAt: null,
        upperSeenEndAt: null,
      })
```

- [ ] **Step 13: Wire the fixture**

In `src/data/mockRepository.test.ts`, add `bonds: repos.bonds` to the returned fixture object.

- [ ] **Step 14: Run everything green**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck clean; **the original 42 still passing** plus the 10 new bond cases, so 52 across 4 files; exactly two `set-state-in-effect` warnings.

If any of the original 42 now fails, the scoping is wrong — the seeded letters must carry `bondId: MOCK_BOND_ID`. Fix the mock, never the test.

**One case from the spec deliberately has no test here.** The spec's testing
section lists "a letter cannot be created with a `bondId` the caller chose".
There is no such test because there is no such code path to test:
`SendLetterInput` has no `bondId` field, so a caller cannot express the attempt
in TypeScript at all, and in the database `grant insert (sender_id,
receiver_id, message)` rejects it before RLS is even consulted. A test would
have to reach around the interface to construct a call the interface forbids,
and would then be asserting on the test's own scaffolding rather than on the
product. The type and the grant are the enforcement; this note is the record
that it was considered rather than missed.

- [ ] **Step 15: Commit**

```bash
git add src/data/types.ts src/data/mockRepository.ts src/data/contractTests.ts src/data/mockRepository.test.ts
git commit -m "feat(data): bonds, chapters, and the mock that enforces them"
```

---

### Task 6: Held letters in the mock

The held-letters seam continues here. Skippable with Tasks 3, 8 and 13.

**Files:**
- Modify: `src/data/contractTests.ts`
- Modify: `src/data/mockRepository.ts`

**Interfaces:**
- Consumes: `openBondFor`, `canonical`, `MockBondRow` from Task 5
- Produces: mock `listHeld`, `sendHeld`

- [ ] **Step 1: Write the failing contract cases**

In `src/data/contractTests.ts`, add after the `bonds` describe block:

```ts
    describe('held letters', () => {
      it('an unbonded author can write one, and only they can see it', async () => {
        const solo = await fx.unlinked()
        const written = await solo.letters.send({
          senderId: solo.userId,
          receiverId: null,
          message: 'Dear whoever you turn out to be,',
        })
        expect(written.error).toBe(null)
        expect(written.data!.receiverId).toBe(null)
        expect(written.data!.bondId).toBe(null)
        expect(written.data!.sentAt).toBe(null)

        const held = await solo.letters.listHeld(solo.userId)
        expect(held.data!).toHaveLength(1)

        const other = await solo.letters.listHeld(solo.partnerId)
        expect(other.data!).toEqual([])
      })

      it('a held letter is in no chapter', async () => {
        const solo = await fx.unlinked()
        await solo.letters.send({
          senderId: solo.userId,
          receiverId: null,
          message: 'Not sent yet.',
        })
        const current = await solo.letters.listConversation(solo.userId)
        expect(current.data).toEqual([])
        const archived = await solo.letters.listArchived(solo.userId)
        expect(archived.data).toEqual([])
      })

      it('a bonded author cannot write one', async () => {
        const result = await fx.letters.send({
          senderId: fx.userId,
          receiverId: null,
          message: 'Should be refused.',
        })
        expect(result.error).not.toBe(null)
      })

      it('sending one keeps the date it was written', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Written long before it was sent.',
          })
        ).data!

        const theirs = (await solo.profiles.getById(solo.partnerId)).data!
        await solo.profiles.linkPartner(solo.userId, theirs.inviteCode)

        const sent = await solo.letters.sendHeld(written.id, solo.userId)
        expect(sent.error).toBe(null)
        expect(sent.data!.createdAt).toBe(written.createdAt)
        expect(sent.data!.sentAt).not.toBe(null)
        expect(sent.data!.receiverId).toBe(solo.partnerId)
        expect(sent.data!.bondId).not.toBe(null)
      })

      it('a sent held letter joins the current chapter and leaves the held list', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'On its way at last.',
          })
        ).data!
        const theirs = (await solo.profiles.getById(solo.partnerId)).data!
        await solo.profiles.linkPartner(solo.userId, theirs.inviteCode)
        await solo.letters.sendHeld(written.id, solo.userId)

        const held = await solo.letters.listHeld(solo.userId)
        expect(held.data).toEqual([])
        const current = await solo.letters.listConversation(solo.userId)
        expect(current.data!.map((l) => l.id)).toContain(written.id)
      })

      it('refuses a second send of the same letter', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Only once.',
          })
        ).data!
        const theirs = (await solo.profiles.getById(solo.partnerId)).data!
        await solo.profiles.linkPartner(solo.userId, theirs.inviteCode)

        expect((await solo.letters.sendHeld(written.id, solo.userId)).error).toBe(null)
        expect((await solo.letters.sendHeld(written.id, solo.userId)).error).not.toBe(null)
      })

      it('refuses to send when the author has no bond', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Nobody to send it to.',
          })
        ).data!
        const result = await solo.letters.sendHeld(written.id, solo.userId)
        expect(result.error).not.toBe(null)
      })

      it("refuses to send someone else's held letter", async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Mine alone.',
          })
        ).data!
        const result = await solo.letters.sendHeld(written.id, solo.partnerId)
        expect(result.error).not.toBe(null)
      })
    })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test`
Expected: FAIL — `listHeld` and `sendHeld` are not functions.

- [ ] **Step 3: Implement both in the mock**

Add to the mock's `letterRepository`:

```ts
    async listHeld(userId) {
      // A held letter has no receiver, so visibleTo cannot speak for it: the
      // author is the only person who may ever see one.
      const mine = letters
        .filter((l) => l.bondId === null && l.senderId === userId && l.senderDeletedAt === null)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async sendHeld(letterId, userId) {
      const letter = letters.find((l) => l.id === letterId)
      if (letter === undefined) return fail('Letter not found.')
      if (letter.senderId !== userId) return fail('Letter not found.')
      // Mirrors the trigger: receiverId is fillable exactly once, from null.
      if (letter.receiverId !== null) return fail('That letter has already been sent.')

      const open = openBondFor(userId)
      if (open === undefined) return fail('You are not connected to anyone yet.')
      const partner = open.lowerId === userId ? open.upperId : open.lowerId
      if (partner === null) return fail('You are not connected to anyone yet.')

      letter.receiverId = partner
      letter.bondId = open.id
      letter.sentAt = new Date().toISOString()
      // createdAt deliberately untouched: the letter's date is when it was
      // written, which is the entire reason for holding it.
      return ok({ ...letter })
    },
```

- [ ] **Step 4: Run everything green and commit**

Run: `npm run typecheck && npm test && npm run lint`
Expected: 60 passing across 4 files (42 original + 10 bonds + 8 held), typecheck clean, two lint warnings.

```bash
git add src/data/contractTests.ts src/data/mockRepository.ts
git commit -m "feat(data): held letters keep the date they were written"
```

---

### Task 7: Bonds and chapter scoping in the Supabase adapter

**Files:**
- Modify: `src/data/supabaseRepository.ts`

**Interfaces:**
- Consumes: `Bond`, `BondRepository`, `Letter.bondId`, `Letter.sentAt` from Task 5
- Produces: `createSupabaseRepositories()` returns `{ letters, profiles, bonds }`

- [ ] **Step 1: Extend the row types**

In `src/data/supabaseRepository.ts`, add to `interface LetterRow`:

```ts
  bond_id: string | null
  sent_at: string | null
```

and add a new row interface after it:

```ts
interface BondRow {
  id: string
  lower_id: string | null
  upper_id: string | null
  lower_name: string | null
  upper_name: string | null
  started_at: string
  ended_at: string | null
  lower_seen_end_at: string | null
  upper_seen_end_at: string | null
}
```

- [ ] **Step 2: Map the new columns**

In `toLetter`, add:

```ts
  bondId: r.bond_id,
  sentAt: r.sent_at,
```

**Why this matters more than it looks.** On 2026-09-13 the live table was missing `sender_archived_at`, so `toLetter` produced `undefined`, `archivedBy` evaluated `undefined !== null` as `true`, and every letter in production was classified as archived. The `LetterRow` type claimed columns that did not exist and TypeScript could not tell. If `bond_id` is added to the type but not to the live table, `bondId` becomes `undefined`, `l.bondId === open.id` is false for every letter, and **home goes permanently empty** — the same failure with a new mask. Task 14 exists to stop that.

- [ ] **Step 3: Scope both list methods to the open bond**

Add a helper above `createSupabaseRepositories`'s `letterRepository`:

```ts
  /**
   * The caller's open bond, or null. Two round trips rather than a join
   * because PostgREST cannot express "letters whose bond is my open one" in a
   * single filtered select without an embedded resource, and the embedded
   * form would be harder to read than the extra request is to pay for.
   */
  const openBond = async (): Promise<BondRow | null> => {
    const { data, error } = await db
      .from('bonds')
      .select('*')
      .is('ended_at', null)
      .maybeSingle()
    if (error) return null
    return data as BondRow | null
  }
```

Note there is no `or(lower_id.eq…, upper_id.eq…)` filter: `bonds_select_member` already restricts the rows to this user's, and `bonds_one_active_*` guarantees at most one open one. Adding a client-side filter would duplicate the policy and drift from it.

Replace `listConversation` and `listArchived`:

```ts
    async listConversation(userId) {
      return guard(async () => {
        const bond = await openBond()
        // No open bond is a real, renderable state — an unbonded person's
        // home is empty — not an error.
        if (bond === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bond.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        return ok(rows.filter((l) => !archivedBy(l, userId)))
      })
    },

    async listArchived(userId) {
      return guard(async () => {
        const bond = await openBond()
        if (bond === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bond.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        return ok(rows.filter((l) => archivedBy(l, userId)))
      })
    },

    async listChapter(_userId, bondId) {
      return guard(async () => {
        // No membership check here, unlike the mock: bonds_select_member and
        // letters_select_participant both apply, so a guessed bond id returns
        // an empty list rather than someone else's letters. The mock has to
        // check by hand because it has no policies.
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondId)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },
```

- [ ] **Step 4: Set no bond_id on send, and let the database do it**

The client has no insert grant on `bond_id` (Task 4), so `send` must not try. Leave the existing insert as it is, and add this comment above it:

```ts
    // bond_id is deliberately absent from this insert: `grant insert
    // (sender_id, receiver_id, message)` forbids it, and the insert policy
    // already proves receiver_id is the caller's partner. A client that could
    // choose bond_id could file a letter into someone else's chapter.
```

The database must therefore derive it. Add this to `supabase/schema.sql`,
after `set_letter_bond`'s natural neighbours — the other letter triggers, at
the end of the file beside `letters_enforce_update`:

```sql
-- bond_id is not client-writable, so the database derives it. A letter to a
-- partner belongs to the open bond; a held letter belongs to none.
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
```

- [ ] **Step 5: Implement the Supabase bond repository**

Add before the return of `createSupabaseRepositories`:

```ts
  const bondRepository: BondRepository = {
    async list(userId) {
      return guard(async () => {
        const { data, error } = await db
          .from('bonds')
          .select('*')
          .order('started_at', { ascending: false })
        if (error) return fail('Your chapters could not be loaded.')
        const rows = data as BondRow[]

        // One count query for all chapters rather than one per chapter.
        const { data: letterData, error: letterError } = await db
          .from('letters')
          .select('bond_id')
        if (letterError) return fail('Your chapters could not be loaded.')
        const counts = new Map<string, number>()
        for (const row of letterData as { bond_id: string | null }[]) {
          if (row.bond_id === null) continue
          counts.set(row.bond_id, (counts.get(row.bond_id) ?? 0) + 1)
        }

        return ok(
          rows.map((row) => {
            const iAmLower = row.lower_id === userId
            const partnerId = iAmLower ? row.upper_id : row.lower_id
            const frozen = iAmLower ? row.upper_name : row.lower_name
            return {
              id: row.id,
              partnerId,
              // Frozen wins for an ended bond. For the OPEN bond the frozen
              // columns are null, and the caller resolves the live name
              // through useAuth's partnerName — this DTO does not, because
              // profiles_select_self_or_partner is the only thing that could
              // answer and that is AuthProvider's job, not this method's.
              partnerName: frozen ?? '',
              startedAt: row.started_at,
              endedAt: row.ended_at,
              seenEndAt: iAmLower ? row.lower_seen_end_at : row.upper_seen_end_at,
              letterCount: counts.get(row.id) ?? 0,
            }
          }),
        )
      })
    },

    async unlink(_userId) {
      return guard(async () => {
        const { data, error } = await db.rpc('unlink_partner')
        if (error) return fail('That did not work. Please try again.')
        if (data === null) return fail('You are not connected to anyone.')
        return ok(toProfile(data as ProfileRow))
      })
    },

    async acknowledgeEnd(_userId, bondId) {
      return guard(async () => {
        const { error } = await db.rpc('acknowledge_bond_end', { bond_id: bondId })
        if (error) return fail('That did not work.')
        return ok(undefined)
      })
    },
  }
```

Both `unlink` and `acknowledgeEnd` ignore their `userId`: the database reads `auth.uid()` from the JWT, and a client-supplied id would be both redundant and a lie waiting to happen. The parameter exists because the mock genuinely needs it — it has no session.

Change the return to `{ letters: letterRepository, profiles: profileRepository, bonds: bondRepository }` and widen the declared return type. Import `Bond` and `BondRepository` as types.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck clean, 60 passing (the contract suite runs against the mock only, so these numbers do not change), two lint warnings.

```bash
git add src/data/supabaseRepository.ts supabase/schema.sql
git commit -m "feat(data): the Supabase adapter files letters into chapters"
```

---

### Task 8: Held letters in the Supabase adapter

Held-letters seam.

**Files:**
- Modify: `src/data/supabaseRepository.ts`

**Interfaces:**
- Consumes: `send_held_letter` from Task 3
- Produces: Supabase `listHeld`, `sendHeld`

- [ ] **Step 1: Implement both**

Add to `letterRepository`:

```ts
    async listHeld(userId) {
      return guard(async () => {
        const { data, error } = await db
          .from('letters')
          .select('*')
          .is('bond_id', null)
          .eq('sender_id', userId)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },

    async sendHeld(letterId, _userId) {
      return guard(async () => {
        // An RPC, not an update: receiver_id, bond_id and sent_at are all
        // blocked by the column grants AND by enforce_letter_update, and only
        // a security definer function may fill them in.
        const { data, error } = await db.rpc('send_held_letter', { letter_id: letterId })
        if (error) return fail(heldErrorMessage(error.message))
        if (data === null) return fail('That letter could not be sent.')
        return ok(toLetter(data as LetterRow))
      })
    },
```

- [ ] **Step 2: Add the error message mapper**

Beside the existing `linkErrorMessage`, add:

```ts
/**
 * The function's exception names, turned into sentences. Matching on message
 * text is what the existing linkErrorMessage does too — PostgREST does not
 * pass through SQLSTATE for a plpgsql `raise exception`.
 */
function heldErrorMessage(message: string): string {
  if (message.includes('NO_BOND')) return 'You are not connected to anyone yet.'
  if (message.includes('LETTER_NOT_FOUND_OR_ALREADY_SENT')) {
    return 'That letter has already been sent.'
  }
  if (message.includes('NOT_SIGNED_IN')) return 'You are not signed in.'
  return 'That letter could not be sent.'
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck clean, 60 passing, two lint warnings.

```bash
git add src/data/supabaseRepository.ts
git commit -m "feat(data): sending a held letter goes through the database"
```

---

### Task 9: Wire the bond repository and the hooks

**Files:**
- Modify: `src/data/index.ts`
- Create: `src/hooks/useBonds.ts`
- Modify: `src/hooks/useLetters.ts`

**Interfaces:**
- Consumes: `bondRepository` from Tasks 5 and 7
- Produces: `bondRepository` export; `useBonds()`; `useLetters().held`, `.sendHeld`, `.hasBond`

- [ ] **Step 1: Export the third repository**

In `src/data/index.ts`, add `export const bondRepository = repositories.bonds` beside the other two, and add `Bond` to the re-exported types:

```ts
export type { Bond, Letter, Profile, PublicLetter, Result } from './types'
```

- [ ] **Step 2: Create the hook**

Create `src/hooks/useBonds.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { bondRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import type { Bond } from '../data/types'

interface UseBonds {
  /** The open bond, or null when unbonded. */
  current: Bond | null
  /** Ended bonds, newest first. */
  past: Bond[]
  loading: boolean
  error: string | null
  unlink(): Promise<{ ok: boolean; error?: string }>
  acknowledgeEnd(bondId: string): Promise<void>
  reload(): Promise<void>
}

/**
 * Chapters. Kept out of useLetters because a bond's lifecycle is not a
 * letter's: Settings needs unlink without touching letters, and Chapters
 * needs the list without loading a conversation.
 */
export function useBonds(): UseBonds {
  const { userId, loading: authLoading, refreshProfile } = useAuth()
  const [bonds, setBonds] = useState<Bond[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    const result = await bondRepository.list(id)
    if (result.error !== null) setError(result.error)
    else {
      setBonds(result.data)
      setError(null)
    }
  }, [])

  useEffect(() => {
    if (userId === null) {
      setBonds([])
      setLoading(authLoading)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      await load(userId)
      if (cancelled) return
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [userId, authLoading, load])

  const unlink = useCallback<UseBonds['unlink']>(async () => {
    if (userId === null) return { ok: false, error: 'You are not signed in.' }
    const result = await bondRepository.unlink(userId)
    if (result.error !== null) return { ok: false, error: result.error }
    // The profile's partnerId drives the whole signed-in UI, so it must be
    // refreshed before anything re-reads it.
    await refreshProfile()
    await load(userId)
    return { ok: true }
  }, [userId, load, refreshProfile])

  const acknowledgeEnd = useCallback<UseBonds['acknowledgeEnd']>(
    async (bondId) => {
      if (userId === null) return
      await bondRepository.acknowledgeEnd(userId, bondId)
      await load(userId)
    },
    [userId, load],
  )

  const reload = useCallback(async () => {
    if (userId !== null) await load(userId)
  }, [userId, load])

  return {
    current: bonds.find((b) => b.endedAt === null) ?? null,
    past: bonds.filter((b) => b.endedAt !== null),
    loading: loading || authLoading,
    error,
    unlink,
    acknowledgeEnd,
    reload,
  }
}
```

- [ ] **Step 3: Add held letters to `useLetters`**

In `src/hooks/useLetters.ts`, add `held: Letter[]`, `hasBond: boolean` and `sendHeld(id: string): Promise<{ ok: boolean; error?: string }>` to the `UseLetters` interface. Extend `load` to fetch a third list:

```ts
  const load = useCallback(async (id: string) => {
    const [conversation, archive, heldLetters] = await Promise.all([
      letterRepository.listConversation(id),
      letterRepository.listArchived(id),
      letterRepository.listHeld(id),
    ])
```

and after the existing archive branch:

```ts
    if (heldLetters.error !== null) setError(heldLetters.error)
    else setHeld(heldLetters.data)
```

then widen the final success condition to require all three:

```ts
    if (conversation.error === null && archive.error === null && heldLetters.error === null) {
      setError(null)
    }
```

Add the state `const [held, setHeld] = useState<Letter[]>([])`, clear it alongside the others when `userId === null`, and add:

```ts
  const sendHeldFn = useCallback<UseLetters['sendHeld']>(
    async (id) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      const result = await letterRepository.sendHeld(id, userId)
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, load],
  )
```

- [ ] **Step 4: Let an unbonded author write**

Replace the `partnerId === null` guard in `sendLetter`:

```ts
      // An unbonded author writes a HELD letter — receiverId null — rather
      // than being refused. The repository and the insert policy both enforce
      // that this is only allowed with no bond, so there is no check here.
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
      })
```

`partnerId` is already `string | null`, so this compiles once `SendLetterInput.receiverId` is nullable from Task 5. Return `held`, `hasBond: partnerId !== null` and `sendHeld: sendHeldFn` from the hook.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck clean, 60 passing, and **still exactly two** `set-state-in-effect` warnings — `useBonds.ts` uses the same `setLoading(true)`-in-effect shape as `useLetters.ts`, so if a third warning appears, name it in the commit body rather than silencing it.

```bash
git add src/data/index.ts src/hooks/useBonds.ts src/hooks/useLetters.ts
git commit -m "feat(hooks): chapters and held letters reach the UI"
```

---

### Task 10: The settings route

**Files:**
- Create: `src/routes/Settings.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `useBonds`, `useAuth`, `profileRepository.updateName`
- Produces: route `/settings`

- [ ] **Step 1: Create the route**

Create `src/routes/Settings.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'
import { useBonds } from '../hooks/useBonds'
import { profileRepository } from '../data'

export default function Settings() {
  const { userId, profile, partnerName, signOut, refreshProfile } = useAuth()
  const { current, loading, unlink } = useBonds()
  const navigate = useNavigate()
  const [name, setName] = useState(profile?.fullName ?? '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function saveName() {
    if (userId === null) return
    setSaving(true)
    setError(null)
    const result = await profileRepository.updateName(userId, name)
    setSaving(false)
    if (result.error !== null) {
      setError(result.error)
      return
    }
    await refreshProfile()
    setNotice('Saved.')
  }

  async function endBond() {
    setError(null)
    const result = await unlink()
    if (!result.ok) {
      setError(result.error ?? 'That did not work.')
      return
    }
    setConfirming(false)
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-[480px] pt-4">
      <PaperTexture className="p-8 sm:p-10">
        <h1 className="font-hand text-4xl text-ink-ui">You</h1>

        <label htmlFor="name" className="mt-8 block font-ui text-xs text-ink-muted">
          The name signed at the bottom of your letters
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setNotice(null)
          }}
          className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void saveName()}
          disabled={saving || name.trim().length === 0 || name === profile?.fullName}
          className="mt-3 rounded-full bg-accent px-5 py-2.5 font-ui text-sm font-medium text-paper-app disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'One moment…' : 'Save'}
        </button>
        {notice !== null && (
          <p className="mt-3 font-ui text-xs text-ink-muted">{notice}</p>
        )}

        <div className="mt-10 border-t border-paper-edge pt-6">
          <h2 className="font-ui text-xs tracking-wide text-ink-muted">Your bond</h2>
          {loading ? (
            <p className="mt-2 font-ui text-sm text-ink-muted">One moment…</p>
          ) : current === null ? (
            <p className="mt-2 font-letter text-ink-letter">
              You are not connected to anyone.
            </p>
          ) : (
            <>
              <p className="mt-2 font-letter text-ink-letter">
                You and {partnerName || 'them'}.
              </p>
              {confirming ? (
                <div className="mt-4">
                  <p className="font-letter text-ink-letter">
                    {partnerName || 'They'} keeps every letter, and so do you — they move
                    to Past chapters. Both of you can bond with someone else afterwards.
                    This cannot be undone.
                  </p>
                  <div className="mt-4 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => void endBond()}
                      className="rounded-full bg-accent px-5 py-2.5 font-ui text-sm font-medium text-paper-app"
                    >
                      End this bond
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="mt-4 font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
                >
                  End this bond
                </button>
              )}
            </>
          )}
        </div>

        {error !== null && (
          <p role="alert" className="mt-6 font-ui text-sm text-accent">
            {error}
          </p>
        )}

        <div className="mt-10 border-t border-paper-edge pt-6">
          <button
            type="button"
            onClick={() => void signOut()}
            className="font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
          >
            Sign out
          </button>
        </div>
      </PaperTexture>
    </div>
  )
}
```

- [ ] **Step 2: Move Sign out out of the header**

In `src/components/Layout.tsx`, replace the `canSignOut` button with a Settings link, and keep the `isSupabaseConfigured()` condition that gates it:

```tsx
            {canSignOut && (
              <Link
                to="/settings"
                className="font-ui text-sm text-ink-muted transition-colors hover:text-accent"
              >
                You
              </Link>
            )}
```

The `Link` import already exists. `isSupabaseConfigured` stays imported and used — on the mock path `signOut` is a no-op, and Settings would offer a dead button.

- [ ] **Step 3: Add the route**

In `src/app/App.tsx`, add beside the other lazy signed-in routes:

```tsx
const Settings = lazy(() => import('../routes/Settings'))
```

and inside the `AppChrome` route group:

```tsx
            <Route path="/settings" element={<Settings />} />
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all green, and `dist/assets/` gains a `Settings-*.js` chunk.

Run the dev server and fetch `/settings`. Expected: HTTP 200. Then stop it.

Confirm no component under `src/components/` imports a value from `src/data/` — `Settings.tsx` is a ROUTE and may import `profileRepository`; `Layout.tsx` may not gain such an import.

Run: `grep -n "from '../data'" src/components/*.tsx`
Expected: no output, or `import type` only.

- [ ] **Step 5: Commit**

```bash
git add src/routes/Settings.tsx src/components/Layout.tsx src/app/App.tsx
git commit -m "feat: a place to end a bond, and to change your name"
```

---

### Task 11: Past chapters

**Files:**
- Create: `src/routes/Chapters.tsx`
- Create: `src/routes/Chapter.tsx`
- Modify: `src/components/LetterModal.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `useBonds`, `letterRepository.listChapter`
- Produces: routes `/chapters` and `/chapters/:bondId`; `LetterModal` prop `readOnly?: boolean`

- [ ] **Step 1: Add `readOnly` to `LetterModal`**

In `src/components/LetterModal.tsx`, add `readOnly?: boolean` to `LetterModalProps` with this comment:

```tsx
  /**
   * A letter in a past chapter. Hides the archive toggle, because with
   * listConversation scoped to the open bond an un-archived past letter would
   * appear in NEITHER home nor archive — it would simply vanish. Share and
   * Delete stay: both concern your own copy.
   */
  readOnly?: boolean
```

Default it to `false` in the destructure, and wrap only the archive button:

```tsx
                {!readOnly && (
                  <button
                    type="button"
                    onClick={onArchive}
                    className="font-ui text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-accent"
                  >
                    {archived ? 'Move back' : 'Archive'}
                  </button>
                )}
```

- [ ] **Step 2: Create the chapter list**

Create `src/routes/Chapters.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { useBonds } from '../hooks/useBonds'

function chapterDates(startedAt: string, endedAt: string | null): string {
  const format = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  if (endedAt === null) return `since ${format(startedAt)}`
  return `${format(startedAt)} – ${format(endedAt)}`
}

export default function Chapters() {
  const { past, loading, error } = useBonds()

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (error !== null) {
    return <p className="py-20 text-center font-ui text-sm text-accent">{error}</p>
  }

  if (past.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">No past chapters</p>
        <Link
          to="/"
          className="mt-6 inline-block font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Back to your letters
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-hand text-3xl text-ink-ui">Past chapters</h1>
        <Link
          to="/"
          className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Back
        </Link>
      </div>

      <ul className="space-y-4">
        {past.map((bond) => (
          <li key={bond.id}>
            <Link
              to={`/chapters/${bond.id}`}
              className="block rounded-letter border border-paper-edge bg-paper-letter px-6 py-5 transition-shadow hover:shadow-letter-lifted"
            >
              <span className="font-hand text-2xl text-ink-ui">
                {bond.partnerName || 'Someone'}
              </span>
              <p className="mt-1 font-ui text-xs tracking-wide text-ink-muted">
                {bond.letterCount} {bond.letterCount === 1 ? 'letter' : 'letters'} ·{' '}
                {chapterDates(bond.startedAt, bond.endedAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
```

- [ ] **Step 3: Create the chapter detail**

Create `src/routes/Chapter.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link, useParams } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { useAuth } from '../auth/useAuth'
import { useBonds } from '../hooks/useBonds'
import { letterRepository } from '../data'
import type { Letter } from '../data/types'

export default function Chapter() {
  const { bondId } = useParams<{ bondId: string }>()
  const { userId, profile } = useAuth()
  const { past } = useBonds()
  const [letters, setLetters] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Letter | null>(null)

  const bond = past.find((b) => b.id === bondId) ?? null

  useEffect(() => {
    if (userId === null || bondId === undefined) return
    let cancelled = false
    void (async () => {
      const result = await letterRepository.listChapter(userId, bondId)
      if (cancelled) return
      if (result.error !== null) setError(result.error)
      else setLetters(result.data)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [userId, bondId])

  const closeLetter = useCallback(() => setOpen(null), [])

  // The frozen name on the letter answers first: after unbonding, nothing can
  // resolve the other person's profile, so a live lookup would render blank.
  const authorOf = (letter: Letter): string =>
    letter.senderId === userId
      ? (profile?.fullName ?? 'You')
      : (letter.senderName ?? bond?.partnerName ?? 'Someone')

  const recipientOf = (letter: Letter): string =>
    letter.receiverId === userId
      ? (profile?.fullName ?? 'you')
      : (letter.receiverName ?? bond?.partnerName ?? 'them')

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (error !== null) {
    return <p className="py-20 text-center font-ui text-sm text-accent">{error}</p>
  }

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-hand text-3xl text-ink-ui">
          {bond?.partnerName || 'Someone'}
        </h1>
        <Link
          to="/chapters"
          className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          All chapters
        </Link>
      </div>

      {letters.length === 0 ? (
        <p className="py-20 text-center font-ui text-sm text-ink-muted">
          Nothing left in this chapter.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {letters.map((letter) => (
            <LetterCard
              key={letter.id}
              letter={letter}
              authorName={authorOf(letter)}
              unread={false}
              onOpen={setOpen}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <LetterModal
            key="letter"
            letter={open}
            authorName={authorOf(open)}
            recipientName={recipientOf(open)}
            archived
            readOnly
            trapActive
            onClose={closeLetter}
            onArchive={() => {}}
            onDelete={() => {}}
            onShare={() => {}}
          />
        )}
      </AnimatePresence>
    </>
  )
}
```

Note `unread={false}` unconditionally: an unread dot on a letter from a finished relationship is noise, and `markRead` is not called here at all.

- [ ] **Step 4: Link to chapters only when there are some**

In `src/components/Layout.tsx` this cannot be done without bond data, and `Layout` must not import values from `src/data/`. Put the link in `Inbox.tsx` instead, in Task 12, beside the existing Archive link. Add nothing to `Layout` in this task beyond what Task 10 changed.

- [ ] **Step 5: Add the routes**

In `src/app/App.tsx`:

```tsx
const Chapters = lazy(() => import('../routes/Chapters'))
const Chapter = lazy(() => import('../routes/Chapter'))
```

```tsx
            <Route path="/chapters" element={<Chapters />} />
            <Route path="/chapters/:bondId" element={<Chapter />} />
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all green; `dist/assets/` gains `Chapters-*.js` and `Chapter-*.js`.

Start the dev server, fetch `/chapters` and `/chapters/anything`. Both must return 200. Then stop it.

```bash
git add src/routes/Chapters.tsx src/routes/Chapter.tsx src/components/LetterModal.tsx src/app/App.tsx
git commit -m "feat: past chapters, read-only by construction"
```

---

### Task 12: The ended-bond notice and the chapters link

**Files:**
- Modify: `src/routes/Inbox.tsx`

**Interfaces:**
- Consumes: `useBonds().past`, `useBonds().acknowledgeEnd`
- Produces: the dismissible notice; the Past chapters link

- [ ] **Step 1: Add the notice and the link**

In `src/routes/Inbox.tsx`, add `import { useBonds } from '../hooks/useBonds'` and inside the component:

```tsx
  const { past, acknowledgeEnd } = useBonds()
  // Only a bond whose ending this person has not yet seen. seenEndAt is
  // resolved per caller by the repository, so this never fires for the other
  // side's acknowledgement.
  const unseenEnd = past.find((b) => b.seenEndAt === null) ?? null
```

Render above the existing content in both the empty-state and the populated branches:

```tsx
      {unseenEnd !== null && (
        <div className="mb-6 rounded-letter border border-paper-edge bg-paper-letter px-5 py-4 text-left">
          <p className="font-letter text-ink-letter">
            Your bond with {unseenEnd.partnerName || 'them'} ended. Your letters are in{' '}
            <Link to="/chapters" className="underline underline-offset-4 hover:text-accent">
              Past chapters
            </Link>
            .
          </p>
          <button
            type="button"
            onClick={() => void acknowledgeEnd(unseenEnd.id)}
            className="mt-3 font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
          >
            Thanks, I know
          </button>
        </div>
      )}
```

And beside the existing Archive link:

```tsx
          {past.length > 0 && (
            <Link
              to="/chapters"
              className="ml-4 font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
            >
              Past chapters
            </Link>
          )}
```

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all green, two lint warnings.

```bash
git add src/routes/Inbox.tsx
git commit -m "feat: tell the other person their bond ended"
```

---

### Task 13: The unsent section

Held-letters seam. The last task that depends on Tasks 3, 6 and 8.

**Files:**
- Modify: `src/routes/Inbox.tsx`
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useLetters().held`, `.sendHeld`, `.hasBond`
- Produces: the Unsent list; a compose entry for the unbonded

- [ ] **Step 1: Let an unbonded person reach the composer**

In `src/components/Layout.tsx`, replace `const canWrite = profile?.partnerId != null` with:

```tsx
  // Everyone signed in may write. With no bond the letter is HELD rather than
  // sent, which the composer and the repository both handle; refusing here
  // would make the app's central act conditional on having a partner.
  const canWrite = userId !== null
```

- [ ] **Step 2: Render the Unsent list**

In `src/routes/Inbox.tsx`, destructure `held`, `sendHeld` and `hasBond` from `useLetters()`, and add below the empty-state's invite link:

```tsx
        {held.length > 0 && (
          <div className="mx-auto mt-12 max-w-sm text-left">
            <h2 className="font-ui text-xs tracking-wide text-ink-muted">
              Unsent · {held.length}
            </h2>
            <ul className="mt-3 space-y-3">
              {held.map((letter) => (
                <li
                  key={letter.id}
                  className="rounded-letter border border-paper-edge bg-paper-letter px-4 py-3"
                >
                  <p className="font-letter text-[15px] leading-relaxed text-ink-letter">
                    {snippet(letter.message, 100)}
                  </p>
                  <p className="mt-2 font-ui text-xs tracking-wide text-ink-muted">
                    Written {formatLetterDate(letter.createdAt)}
                  </p>
                  {hasBond && (
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          const result = await sendHeld(letter.id)
                          if (!result.ok) setToast(result.error ?? 'That did not work.')
                        })()
                      }}
                      className="mt-3 font-ui text-xs text-accent underline underline-offset-4"
                    >
                      Send to {partnerName || 'them'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
```

Add `import { formatLetterDate, snippet } from '../lib/format'`. `snippet` and `formatLetterDate` are already used by `LetterCard`, so no new dependency enters the project.

The send button appears only when `hasBond` — one at a time, never in bulk, because sending a letter written about someone else to someone new is a decision to take individually.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all green, two lint warnings.

Confirm the held list also shows for a BONDED user with leftover held letters — the block is currently only inside the `letters.length === 0` branch. If it is not reachable when the inbox has letters, lift it above the branch so it renders in both. Report which you did.

- [ ] **Step 4: Commit**

```bash
git add src/routes/Inbox.tsx src/components/Layout.tsx
git commit -m "feat: letters written with nobody to send them to"
```

---

### Task 14: Apply the SQL, then record the phase

This task has a step only the owner can perform. Do not claim it is done on their behalf.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Hand over the SQL**

Tell the owner, in these words or close to them:

> `supabase/schema.sql` and `supabase/policies.sql` both need applying in the
> Supabase SQL editor, schema first. Both are idempotent. Then, once only,
> `supabase/reset-test-data.sql`, which deletes every letter and unpairs both
> accounts — that is intended, and it replaces a backfill we deliberately did
> not write.

Then WAIT. The next step verifies the live schema and cannot run first.

- [ ] **Step 2: Verify the live schema actually took**

This check exists because on 2026-09-13 the live table was missing six columns
for weeks while the app ran happily against it, silently on the mock. Adding
`bond_id` to `LetterRow` without adding it to the table makes `bondId`
`undefined`, so `l.bondId === bond.id` is false for every letter and **home
goes permanently empty**.

```bash
U=$(grep -m1 '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"\r\n')
K=$(grep -m1 '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r\n')
for col in bond_id sent_at; do
  curl -s "$U/rest/v1/letters?select=$col&limit=1" \
    -H "apikey: $K" -H "Authorization: Bearer $K" | head -c 120; echo " <- $col"
done
curl -s -o /dev/null -w 'bonds table: %{http_code}\n' \
  "$U/rest/v1/bonds?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"
```

Expected: `42501` (permission denied) for both columns — that means the column
PARSED and only the anon grant stopped it. `42703` means the column does not
exist and the migration did not run. The `bonds` request should be `401`
or `42501`, never `404`.

- [ ] **Step 3: Add the Phase 6 build record**

In `README.md`, after the Phase 5 section, add a Phase 6 section in the same
voice as the others — what it does, and what review actually found. Cover:

- A relationship became a row. `partner_id` could say who you are with and
  nothing else: not that a relationship ended, when it ran, or that two people
  had been together twice.
- Home is scoped to the open bond, and why un-archiving was already a latent
  bug before this phase — `LetterModal`'s "Move back" would have lifted a
  letter written to a former partner onto the current home page.
- Past chapters are read-only, and that this is structural rather than a UI
  convention: `receiver_id` is what grants read access, so re-associating a
  letter would be a permission grant, and moving one would silently delete the
  other person's copy of a letter they received.
- Held letters keep the date they were written. `created_at` means written and
  `sent_at` means delivered.
- That the `receiver_id` immutability rule had to be narrowed rather than
  relaxed, and that a client still cannot change it by any path.
- The insert column grants, which closed a pre-existing gap: the update path
  had been locked down since Phase 3 and the insert path never was, so a client
  could set `is_public` or `share_slug` at insert time.

Move Phase 6 out of any "not started" list.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm test && npm run lint
git add README.md
git commit -m "docs: record the bonds and chapters phase"
```

---

## What only the owner can do

1. Apply `schema.sql`, then `policies.sql`, then once only `reset-test-data.sql`.
2. Re-test in production: two accounts, bond by invite, write both ways, end the bond, confirm the correspondence appears under Past chapters for both people and that home is empty.
3. Confirm an unbonded account can write a held letter and send it after bonding.

## What this deliberately leaves out

- Mutual-consent breakups.
- Held letters while bonded.
- Chapter renaming, export, or deletion as a unit.
- Any notification when someone bonds with you.
- Anything that copies or moves a letter between chapters.
- Revoking public share links when a bond ends — `get_public_letter` checks
  only the delete columns, deliberately. A shared letter stays shared through a
  breakup. Changing that is its own decision.
- The `break-words` fix from `2026-09-10-responsive-audit.md`.
