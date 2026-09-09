# Letters Outlive the Bond — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make letters survive a breakup or an account deletion, give each person their own archive and delete, show sent letters alongside received ones, and stop the pairing error from blaming the wrong person.

**Architecture:** Per-person state lives as four nullable timestamps on `letters`; the foreign keys become `on delete set null` so a letter outlives its author; a `before delete` trigger on `profiles` freezes author names and archives the survivor's side. Deletion is enforced in RLS rather than in queries, so "deleted" means unreadable rather than merely hidden.

**Tech Stack:** Supabase/Postgres, React 19, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-letters-outlive-the-bond-design.md`

## Global Constraints

- Never use pure white `#FFFFFF` or pure black `#000000`.
- Palette exact: `#FDFBF7`, `#F4EFE6`, `#2C2825`, `#1A1A1A` at 85%, `#C87963`, `#D4AF37`, plus the ratified `--color-paper-edge #e8e0d2`, `--color-ink-muted #8a8078`, `--color-accent-soft #e3b3a4`.
- Three type roles only: Plus Jakarta Sans (`font-ui`), Lora (`font-letter`), Caveat (`font-hand`).
- Letter view centred, max width 600px.
- All animation respects `prefers-reduced-motion` via `<MotionConfig reducedMotion="user">` in `src/app/App.tsx`. Never add per-component guards.
- Components under `src/components/` must not import **values** from `src/data/`. `import type` is ratified and fine.
- Repository methods return `{ data, error }` and NEVER throw. Every Supabase adapter method body goes through the existing `guard()` helper.
- Never narrow a `Result` with a truthiness check — use `=== null` / `!== null`. The empty string is a falsy `string` and will not narrow. (Supabase's own `error` objects are a different shape; `if (error)` is correct for those.)
- Strict TypeScript. `any` is not permitted.
- Tests are logic-level only (Vitest). No component tests, no hook tests, no jsdom, no Testing Library.
- **The contract suite runs against the MOCK ONLY.** It asserts on seeded data, so a fresh Postgres would fail it for want of a seeding harness. Do NOT build a seeding harness, an integration test, or a Supabase test run.
- `npm run typecheck` (`tsc -b`) is the type gate. `npx tsc --noEmit` is a NO-OP in this repo — the root tsconfig is `{"files": [], "references": [...]}` — and is never evidence.
- `supabase/schema.sql` and `supabase/policies.sql` must remain idempotent and safe to re-run. **A live database already exists**, so every schema change must migrate in place: `add column if not exists`, `drop constraint if exists` before `add constraint`.
- SQL cannot be executed here — there is no local database. Never claim you ran it.

## Two things that will bite if you do not know them

**1. `on delete set null` fires the update trigger.** When a profile is deleted, Postgres *updates* `letters` to null the id. `enforce_letter_update` currently raises `IMMUTABLE_COLUMN` on any change to `sender_id`, so changing the foreign keys without changing the trigger first makes account deletion fail outright. Task 2 changes the trigger; Task 3 changes the keys. Do them in that order.

**2. The mock has no RLS.** Section 4.4 of the spec makes deleted letters unreadable via a policy, so the Supabase adapter needs no delete filter. The mock must filter explicitly or the two implementations diverge — which is exactly the class of bug the contract suite exists to catch.

---

## File Structure

| File | Change |
|---|---|
| `supabase/schema.sql` | new columns, changed FKs, new `freeze_profile_letters` trigger, split pairing exception, `unlink_partner` archives |
| `supabase/policies.sql` | delete-aware select policy, column grants on `letters` |
| `src/data/types.ts` | `Letter` gains six fields; `LetterRepository` gains four methods, loses `listReceived` |
| `src/data/mockRepository.ts` | implements them, including the explicit delete filter |
| `src/data/supabaseRepository.ts` | implements them; maps the new error strings |
| `src/data/contractTests.ts` | six new cases |
| `src/hooks/useLetters.ts` | `listConversation`, archive and delete actions |
| `src/routes/Inbox.tsx` | merged timeline, archive link, breakup copy |
| `src/routes/Archive.tsx` | new route |
| `src/components/LetterModal.tsx` | direction-aware header, archive and delete controls |
| `src/components/LetterCard.tsx` | author name by direction |
| `src/app/App.tsx` | `/archive` route |

---

### Task 1: Domain types

Types first so every later task compiles against one contract. Nothing here changes behaviour.

**Files:**
- Modify: `src/data/types.ts`

**Interfaces:**
- Produces: `Letter` with six new fields; `LetterRepository` with `listConversation`, `listArchived`, `setArchived`, `deleteForMe`, and WITHOUT `listReceived`

- [ ] **Step 1: Extend the `Letter` type**

In `src/data/types.ts`, replace the `Letter` interface with:

```ts
export interface Letter {
  id: string
  /** Null once that account has been deleted. The letter outlives them. */
  senderId: string | null
  receiverId: string | null
  message: string
  createdAt: string
  isRead: boolean
  shareSlug: string | null
  isPublic: boolean
  /** Set only when the profile is deleted, freezing the name as it then was. */
  senderName: string | null
  receiverName: string | null
  senderArchivedAt: string | null
  receiverArchivedAt: string | null
  senderDeletedAt: string | null
  receiverDeletedAt: string | null
}
```

- [ ] **Step 2: Replace `listReceived` in the repository interface**

In the same file, replace the `LetterRepository` interface with:

```ts
export interface LetterRepository {
  /** Every letter you sent or received, newest first, minus your archived ones. */
  listConversation(userId: string): Promise<Result<Letter[]>>
  /** The ones you archived, newest first. */
  listArchived(userId: string): Promise<Result<Letter[]>>
  send(input: SendLetterInput): Promise<Result<Letter>>
  markRead(letterId: string): Promise<Result<Letter>>
  /** Archives or unarchives for the calling user only. */
  setArchived(letterId: string, userId: string, archived: boolean): Promise<Result<Letter>>
  /** Removes the letter from this user's side only. Permanent. */
  deleteForMe(letterId: string, userId: string): Promise<Result<Letter>>
  /** Makes the letter publicly readable, generating a slug on first call. */
  share(letterId: string): Promise<Result<Letter>>
  getBySlug(slug: string): Promise<Result<PublicLetter>>
}
```

- [ ] **Step 3: Verify the break is what you expect**

Run: `npm run typecheck`
Expected: FAIL. Both repositories no longer satisfy the interface, and `useLetters` still calls `listReceived`. Tasks 4 and 5 close it. Note the errors in your report; if any error names a file OTHER than `mockRepository.ts`, `supabaseRepository.ts`, `contractTests.ts`, `mockRepository.test.ts` or `useLetters.ts`, investigate — something else depended on the old shape.

- [ ] **Step 4: Commit**

```bash
git add src/data/types.ts
git commit -m "feat: extend Letter and LetterRepository for archive, delete and sent letters"
```

Committing red is deliberate and happens only here. The break is how you find every consumer.

---

### Task 2: The update trigger and the pairing error

The trigger must be permissive BEFORE the foreign keys change in Task 3, or account deletion breaks.

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `enforce_letter_update` permitting the new columns; `link_partners` raising `LINK_ALREADY_USED`

- [ ] **Step 1: Rewrite the update trigger**

In `supabase/schema.sql`, replace the whole body of `enforce_letter_update` — everything between `as $$` and `$$;` — with:

```sql
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
```

Note `auth.uid() is distinct from old.sender_id` rather than `<>`: `auth.uid()` is NULL in the SQL editor and for the trigger firing under a referential action, and `<>` would yield NULL there — letting the check pass by accident. `is distinct from` treats NULL as a real difference, so a NULL caller is refused rather than waved through.

- [ ] **Step 2: Split the overloaded pairing exception**

In `link_partners`, find the SECOND `ALREADY_LINKED` raise — the one guarded by `if other.partner_id is not null` — and change only that one to:

```sql
    raise exception 'LINK_ALREADY_USED';
```

Leave the first raise, guarded by `if me.partner_id is not null`, as `ALREADY_LINKED`. The two now mean different things: you are taken, versus the link is spent.

- [ ] **Step 3: Read the file through**

Run: `grep -n "raise exception" supabase/schema.sql`
Expected: exactly one `LINK_ALREADY_USED`, and `ALREADY_LINKED` appearing once inside `link_partners`.

- [ ] **Step 4: Confirm nothing in TypeScript moved**

```bash
npm test && npm run lint
```
Expected: 28 tests still passing, lint showing only the known `set-state-in-effect` warning at `src/hooks/useLetters.ts:29`. `npm run typecheck` still fails from Task 1 — that is expected and unrelated.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: let letters outlive their author in the update trigger, split pairing error"
```

---

### Task 3: Schema columns, keys, and the freeze trigger

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: the permissive trigger from Task 2
- Produces: six new columns on `letters`; nullable `sender_id`/`receiver_id` with `on delete set null`; `freeze_profile_letters()` trigger; `unlink_partner` archiving

- [ ] **Step 1: Add the columns**

In `supabase/schema.sql`, immediately after the `create table if not exists letters (...)` statement, add:

```sql
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
```

Also change the two column definitions inside the `create table` statement itself from `not null references profiles(id) on delete cascade` to `references profiles(id) on delete set null`, so a database created from scratch matches a migrated one.

- [ ] **Step 2: Add the freeze-and-archive trigger**

After `unlink_partner`, add:

```sql
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

  return old;
end;
$$;

drop trigger if exists profiles_freeze_letters on profiles;
create trigger profiles_freeze_letters
  before delete on profiles
  for each row execute function freeze_profile_letters();
```

- [ ] **Step 3: Make `unlink_partner` archive both sides**

In `unlink_partner`, immediately before the line `update profiles set partner_id = null, invite_code = new_invite_code() where id = me.id;`, insert:

```sql
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
```

This sits inside the existing `if me.partner_id is not null then` block, so it runs only when there is a partner to unlink from.

- [ ] **Step 4: Read the file through**

Check by reading, since nothing can be executed:
- `new_invite_code` is still defined before `handle_new_user` and `unlink_partner`.
- Every function still carries `set search_path = public, pg_temp` — and `new_invite_code` still has `extensions` on its path, without which sign-up fails.
- No statement references anything no earlier statement creates.
- Every `alter` uses `if not exists` or `if exists`, so a second full run is safe.

Run: `grep -n "set search_path" supabase/schema.sql`
Expected: `new_invite_code` shows `public, extensions, pg_temp`; every other function shows `public, pg_temp`.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: letters survive account deletion, freeze names, archive on separation"
```

---

### Task 4: Policies

**Files:**
- Modify: `supabase/policies.sql`

**Interfaces:**
- Consumes: the columns from Task 3
- Produces: delete-aware select policy; column grants on `letters`

- [ ] **Step 1: Make deletion real in the select policy**

In `supabase/policies.sql`, replace the `letters_select_participant` policy with:

```sql
-- Deleting a letter must mean you cannot read it, not merely that the app
-- stops showing it — otherwise "deleted" would leave the row fetchable
-- through the API, which is not what someone deleting a letter believes is
-- happening. Each side's deletion affects only that side.
drop policy if exists letters_select_participant on letters;
create policy letters_select_participant on letters
  for select to authenticated
  using (
    (sender_id = auth.uid() and sender_deleted_at is null)
    or (receiver_id = auth.uid() and receiver_deleted_at is null)
  );
```

- [ ] **Step 2: Add column grants on `letters`**

After the letters policies, add:

```sql
-- Column grants are checked BEFORE RLS, so this is what actually stops a
-- client touching sender_id, receiver_id, message or created_at at all. The
-- trigger's immutability checks are the second layer, not the first.
-- Referential actions run as the system and bypass grants, so the
-- `on delete set null` action still works.
revoke update on letters from authenticated;
grant update (is_read, is_public, share_slug,
              sender_archived_at, receiver_archived_at,
              sender_deleted_at, receiver_deleted_at)
  on letters to authenticated;
```

- [ ] **Step 3: Read through and commit**

Confirm every `create policy` still has a matching `drop policy if exists`, and that both files remain idempotent.

```bash
npm test && npm run lint
git add supabase/policies.sql
git commit -m "feat: enforce per-person deletion in RLS, restrict letter columns"
```

Expected: 28 tests still passing. `npm run typecheck` still fails from Task 1.

---

### Task 5: The contract suite

Tests before implementations, so both adapters are written against the same assertions.

**Files:**
- Modify: `src/data/contractTests.ts`

**Interfaces:**
- Consumes: `LetterRepository` from Task 1
- Produces: the behavioural contract both implementations must satisfy

- [ ] **Step 1: Rename the listing cases**

In `src/data/contractTests.ts`, replace the whole `describe('listReceived', ...)` block with:

```ts
    describe('listConversation', () => {
      it('returns letters the user received', async () => {
        const { data } = await fx.letters.listConversation(fx.userId)
        expect(data!.length).toBeGreaterThan(0)
        expect(data!.some((l) => l.receiverId === fx.userId)).toBe(true)
      })

      it('also returns letters the user SENT', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Something I wrote.',
        })
        const { data } = await fx.letters.listConversation(fx.userId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('orders newest first', async () => {
        const { data } = await fx.letters.listConversation(fx.userId)
        const times = data!.map((l) => Date.parse(l.createdAt))
        expect([...times].sort((a, b) => b - a)).toEqual(times)
      })

      it('excludes letters this user archived', async () => {
        const { data: before } = await fx.letters.listConversation(fx.userId)
        const target = before![0]
        await fx.letters.setArchived(target.id, fx.userId, true)
        const { data: after } = await fx.letters.listConversation(fx.userId)
        expect(after!.some((l) => l.id === target.id)).toBe(false)
      })
    })
```

- [ ] **Step 2: Add the archive and delete cases**

After the `markRead` describe block, add:

```ts
    describe('archive', () => {
      it('moves the letter to the archive listing', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const target = inbox![0]
        await fx.letters.setArchived(target.id, fx.userId, true)
        const { data: archived } = await fx.letters.listArchived(fx.userId)
        expect(archived!.some((l) => l.id === target.id)).toBe(true)
      })

      it('is reversible', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const target = inbox![0]
        await fx.letters.setArchived(target.id, fx.userId, true)
        await fx.letters.setArchived(target.id, fx.userId, false)
        const { data: after } = await fx.letters.listConversation(fx.userId)
        expect(after!.some((l) => l.id === target.id)).toBe(true)
      })

      it('does NOT archive it for the other person', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Still yours.',
        })
        await fx.letters.setArchived(sent.data!.id, fx.userId, true)
        const { data: theirs } = await fx.letters.listConversation(fx.partnerId)
        expect(theirs!.some((l) => l.id === sent.data!.id)).toBe(true)
      })
    })

    describe('deleteForMe', () => {
      it('removes the letter from this user only', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Gone from my side.',
        })
        await fx.letters.deleteForMe(sent.data!.id, fx.userId)

        const { data: mine } = await fx.letters.listConversation(fx.userId)
        expect(mine!.some((l) => l.id === sent.data!.id)).toBe(false)

        const { data: theirs } = await fx.letters.listConversation(fx.partnerId)
        expect(theirs!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('keeps it out of the archive too', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Not in the archive either.',
        })
        await fx.letters.deleteForMe(sent.data!.id, fx.userId)
        const { data: archived } = await fx.letters.listArchived(fx.userId)
        expect(archived!.some((l) => l.id === sent.data!.id)).toBe(false)
      })

      it('reports a missing letter rather than throwing', async () => {
        const result = await fx.letters.deleteForMe(
          '00000000-0000-4000-8000-000000000000',
          fx.userId,
        )
        expect(result.data).toBeNull()
        expect(result.error).toBe('Letter not found.')
      })
    })
```

The "does NOT archive it for the other person" and "removes the letter from this user only" cases are the point of this task. Per-person state implemented accidentally as shared state is the defect most likely to ship here, and nothing else catches it.

- [ ] **Step 3: Update the pairing assertion for the reworded copy**

The spec rewords the self-already-linked message so it no longer reads as if it
covers both cases. In the `linkPartner` describe block, change:

```ts
        expect(result.error).toBe('You are already connected.')
```

to:

```ts
        expect(result.error).toBe('You are already connected to someone.')
```

**Do NOT add a contract case for the other-person-is-taken path.** The fixture
seeds exactly two profiles, and that case needs three — me unlinked, the code's
owner already paired with somebody else. It cannot be constructed here. Tasks 6
and 7 still split the message on both implementations; the path is verified by
reading them against each other, and by a three-account manual check if one is
ever run. Recording the gap is the point — do not invent a third seeded profile
to close it, because that would change what every other contract case runs
against.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: FAIL — `fx.letters.listConversation is not a function`. The implementations arrive in Tasks 6 and 7.

- [ ] **Step 5: Commit**

```bash
git add src/data/contractTests.ts
git commit -m "test: contract cases for sent letters, per-person archive and delete"
```

---

### Task 6: The mock repository

**Files:**
- Modify: `src/data/mockRepository.ts`

**Interfaces:**
- Consumes: `Letter`, `LetterRepository` from Task 1
- Produces: the mock satisfying the contract from Task 5

- [ ] **Step 1: Seed the new fields**

In `seedLetters()`, add to the `base` object so every seeded letter carries them:

```ts
    senderName: null,
    receiverName: null,
    senderArchivedAt: null,
    receiverArchivedAt: null,
    senderDeletedAt: null,
    receiverDeletedAt: null,
```

Do the same in `send()`, on the object literal it pushes.

- [ ] **Step 2: Replace `listReceived` with the four new methods**

Replace the `listReceived` method with:

```ts
    async listConversation(userId) {
      const mine = letters
        .filter((l) => visibleTo(l, userId) && !isArchivedBy(l, userId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listArchived(userId) {
      const mine = letters
        .filter((l) => visibleTo(l, userId) && isArchivedBy(l, userId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async setArchived(letterId, userId, archived) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      const at = archived ? new Date().toISOString() : null
      if (letter.senderId === userId) letter.senderArchivedAt = at
      else if (letter.receiverId === userId) letter.receiverArchivedAt = at
      else return fail('Letter not found.')
      return ok({ ...letter })
    },

    async deleteForMe(letterId, userId) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      const at = new Date().toISOString()
      if (letter.senderId === userId) letter.senderDeletedAt = at
      else if (letter.receiverId === userId) letter.receiverDeletedAt = at
      else return fail('Letter not found.')
      return ok({ ...letter })
    },
```

- [ ] **Step 3: Add the two helpers**

Above `createMockRepositories`, add:

```ts
/**
 * The mock has no row-level security, so it must apply the delete rule the
 * Supabase policy applies for the real adapter. Without this the two
 * implementations diverge and the contract suite passes on a lie.
 */
function visibleTo(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderDeletedAt === null
  if (l.receiverId === userId) return l.receiverDeletedAt === null
  return false
}

function isArchivedBy(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderArchivedAt !== null
  if (l.receiverId === userId) return l.receiverArchivedAt !== null
  return false
}
```

- [ ] **Step 4: Split the mock's overloaded pairing message**

The mock has the SAME bug the SQL had: `linkPartner` returns
`'You are already connected.'` both when the caller is taken and when the code's
owner is. Someone opening a spent link is told they are connected to somebody
when they are connected to nobody.

Change the line guarded by `if (self.partnerId)` to:

```ts
      if (self.partnerId) return fail('You are already connected to someone.')
```

and the line guarded by `if (other.partnerId)` to:

```ts
      if (other.partnerId) return fail('That invite link has already been used.')
```

Those two strings must match the adapter's exactly — Task 7 maps the SQL
exceptions to the same pair. A mismatch here is precisely the mock-versus-real
divergence the repository abstraction exists to prevent.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS. The mock's contract run is green; the Supabase adapter is still unwritten but nothing tests it.

- [ ] **Step 6: Commit**

```bash
git add src/data/mockRepository.ts
git commit -m "feat: mock supports sent letters, per-person archive and delete"
```

---

### Task 7: The Supabase adapter

**Files:**
- Modify: `src/data/supabaseRepository.ts`

**Interfaces:**
- Consumes: `Letter`, `LetterRepository` from Task 1
- Produces: the adapter satisfying the same interface

- [ ] **Step 1: Extend the row type and mapper**

In `src/data/supabaseRepository.ts`, add to `LetterRow`:

```ts
  sender_name: string | null
  receiver_name: string | null
  sender_archived_at: string | null
  receiver_archived_at: string | null
  sender_deleted_at: string | null
  receiver_deleted_at: string | null
```

and change its `sender_id` / `receiver_id` to `string | null`. Then extend `toLetter`:

```ts
  senderName: r.sender_name,
  receiverName: r.receiver_name,
  senderArchivedAt: r.sender_archived_at,
  receiverArchivedAt: r.receiver_archived_at,
  senderDeletedAt: r.sender_deleted_at,
  receiverDeletedAt: r.receiver_deleted_at,
```

- [ ] **Step 2: Replace `listReceived` with the four methods**

```ts
    async listConversation(userId) {
      return guard(async () => {
        // RLS already hides letters this user deleted, so there is no delete
        // filter here — unlike the mock, which has no policies to lean on.
        const { data, error } = await db
          .from('letters')
          .select('*')
          .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        return ok(rows.filter((l) => !archivedBy(l, userId)))
      })
    },

    async listArchived(userId) {
      return guard(async () => {
        const { data, error } = await db
          .from('letters')
          .select('*')
          .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        return ok(rows.filter((l) => archivedBy(l, userId)))
      })
    },

    async setArchived(letterId, userId, archived) {
      return guard(async () => {
        const existing = await db.from('letters').select('*').eq('id', letterId).maybeSingle()
        if (existing.error) return fail(letterErrorMessage(existing.error.message))
        if (existing.data === null) return fail('Letter not found.')

        const row = existing.data as LetterRow
        const at = archived ? new Date().toISOString() : null
        const patch =
          row.sender_id === userId
            ? { sender_archived_at: at }
            : row.receiver_id === userId
              ? { receiver_archived_at: at }
              : null
        if (patch === null) return fail('Letter not found.')

        const { data, error } = await db
          .from('letters')
          .update(patch)
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return fail('Letter not found.')
        return ok(toLetter(data as LetterRow))
      })
    },

    async deleteForMe(letterId, userId) {
      return guard(async () => {
        const existing = await db.from('letters').select('*').eq('id', letterId).maybeSingle()
        if (existing.error) return fail(letterErrorMessage(existing.error.message))
        if (existing.data === null) return fail('Letter not found.')

        const row = existing.data as LetterRow
        const at = new Date().toISOString()
        const patch =
          row.sender_id === userId
            ? { sender_deleted_at: at }
            : row.receiver_id === userId
              ? { receiver_deleted_at: at }
              : null
        if (patch === null) return fail('Letter not found.')

        // The row is returned before RLS hides it, so the caller still gets
        // the Result it expects rather than a confusing not-found.
        const { data, error } = await db
          .from('letters')
          .update(patch)
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return ok(toLetter({ ...row, ...patch } as LetterRow))
        return ok(toLetter(data as LetterRow))
      })
    },
```

- [ ] **Step 3: Add the helper and the new error strings**

Above `createSupabaseRepositories`, add:

```ts
function archivedBy(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderArchivedAt !== null
  if (l.receiverId === userId) return l.receiverArchivedAt !== null
  return false
}
```

In `letterErrorMessage`, add before the existing `row-level security` branch:

```ts
  if (raw.includes('NOT_YOUR_SIDE')) return 'That is not yours to change.'
```

In `linkErrorMessage`, add a branch before the `ALREADY_LINKED` one and reword
that existing branch, so the two situations read differently:

```ts
  if (raw.includes('LINK_ALREADY_USED')) return 'That invite link has already been used.'
  if (raw.includes('ALREADY_LINKED')) return 'You are already connected to someone.'
```

Both strings must match the mock's from Task 6 character for character.

Order matters in both: `LINK_ALREADY_USED` contains neither `ALREADY_LINKED` nor any other token as a substring, but keeping the more specific branch first is the habit that stops the next addition from being shadowed.

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm test && npm run lint
```
Expected: typecheck clean — Task 1's break is now closed on the data layer, though `useLetters` still needs Task 8. If typecheck still fails, the remaining errors must be in `src/hooks/useLetters.ts` only.

- [ ] **Step 5: Commit**

```bash
git add src/data/supabaseRepository.ts
git commit -m "feat: adapter supports sent letters, per-person archive and delete"
```

---

### Task 8: The hook

**Files:**
- Modify: `src/hooks/useLetters.ts`

**Interfaces:**
- Consumes: `letterRepository` from `../data`, `useAuth`
- Produces: `useLetters()` returning `{ letters, archived, partnerName, loading, error, sendLetter, markRead, setArchived, deleteForMe, reload }`

No test for this task: it is a thin binding over the repository, whose behaviour Task 5 covers, and the project's testing policy excludes hook tests.

- [ ] **Step 1: Rewrite the hook**

Replace the contents of `src/hooks/useLetters.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(message: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  deleteForMe(id: string): Promise<void>
  reload(): Promise<void>
}

/**
 * The correspondence. Identity and partner resolution belong to AuthProvider;
 * this hook owns letters and reloads whenever the signed-in user changes.
 */
export function useLetters(): UseLetters {
  const { userId, profile, partnerName, loading: authLoading } = useAuth()
  const partnerId = profile?.partnerId ?? null

  const [letters, setLetters] = useState<Letter[]>([])
  const [archived, setArchived_] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    const [conversation, archive] = await Promise.all([
      letterRepository.listConversation(id),
      letterRepository.listArchived(id),
    ])
    if (conversation.error !== null) {
      setError(conversation.error)
    } else {
      setLetters(conversation.data)
      setError(null)
    }
    if (archive.error === null) setArchived_(archive.data)
  }, [])

  useEffect(() => {
    if (userId === null) {
      setLetters([])
      setArchived_([])
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

  const reload = useCallback(async () => {
    if (userId !== null) await load(userId)
  }, [userId, load])

  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      if (partnerId === null) return { ok: false, error: 'You are not connected to anyone yet.' }
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, partnerId, load],
  )

  const markRead = useCallback<UseLetters['markRead']>(async (id) => {
    // Optimistic: the dot disappears the instant the letter opens.
    setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: true } : l)))
    const result = await letterRepository.markRead(id)
    if (result.error !== null) {
      setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: false } : l)))
    }
  }, [])

  const setArchivedFn = useCallback<UseLetters['setArchived']>(
    async (id, next) => {
      if (userId === null) return
      const result = await letterRepository.setArchived(id, userId, next)
      if (result.error !== null) setError(result.error)
      await load(userId)
    },
    [userId, load],
  )

  const deleteForMe = useCallback<UseLetters['deleteForMe']>(
    async (id) => {
      if (userId === null) return
      const result = await letterRepository.deleteForMe(id, userId)
      if (result.error !== null) setError(result.error)
      await load(userId)
    },
    [userId, load],
  )

  return {
    letters,
    archived,
    partnerName,
    loading: loading || authLoading,
    error,
    sendLetter,
    markRead,
    setArchived: setArchivedFn,
    deleteForMe,
    reload,
  }
}
```

Archive and delete reload rather than mutating local state optimistically: both move a letter between two lists, and reconciling that by hand is how one list ends up stale.

- [ ] **Step 2: Verify**

```bash
npm run typecheck && npm test && npm run build && npm run lint
```
Expected: typecheck clean — Task 1's break is fully closed. 28 tests plus the new contract cases pass. Lint may still show the known `set-state-in-effect` warning.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLetters.ts
git commit -m "feat: hook exposes the conversation, the archive, and both actions"
```

---

### Task 9: Timeline, archive route, and letter actions

**Files:**
- Modify: `src/components/LetterCard.tsx`, `src/components/LetterModal.tsx`, `src/routes/Inbox.tsx`, `src/app/App.tsx`
- Create: `src/routes/Archive.tsx`

**Interfaces:**
- Consumes: `useLetters` from Task 8
- Produces: `<LetterCard letter authorName onOpen />`, `<LetterModal letter authorName recipientName onClose onArchive onDelete archived />`, default-exported `Archive`

- [ ] **Step 1: Make the card show the author**

In `src/components/LetterCard.tsx`, change the props interface to:

```tsx
interface LetterCardProps {
  letter: Letter
  /** Whoever wrote it — hers on hers, yours on yours. */
  authorName: string
  /** Only ever true for a letter you received and have not opened. */
  unread: boolean
  onOpen: (letter: Letter) => void
}
```

Rename the prop in the function signature from `senderName` to `authorName`, add `unread`, and use `authorName` where `senderName` was rendered. Change the unread dot condition to:

```tsx
        {unread && (
```

The card cannot compute this itself. Now that the timeline carries letters you SENT as well as received, `!letter.isRead` is true for every letter you have written — the recipient has not opened it — so testing that alone would put an unread dot on your own outgoing letters. The card does not know who is viewing, so the caller decides: `unread={letter.receiverId === userId && !letter.isRead}`.

- [ ] **Step 2: Make the modal direction-aware and add the actions**

In `src/components/LetterModal.tsx`, change the props interface to:

```tsx
interface LetterModalProps {
  letter: Letter
  authorName: string
  recipientName: string
  archived: boolean
  onClose: () => void
  onArchive: () => void
  onDelete: () => void
}
```

Update the signature and replace `Dear {receiverName},` with `Dear {recipientName},` and `With love, {senderName}` with `With love, {authorName}`.

Add near the top of the component:

```tsx
  const [confirmingDelete, setConfirmingDelete] = useState(false)
```

and import `useState` alongside `useEffect`.

Then, immediately after the closing `</div>` of the sign-off block and before `</PaperTexture>`, add:

```tsx
          <div className="mt-10 flex items-center justify-end gap-4 border-t border-paper-edge pt-5">
            {confirmingDelete ? (
              <>
                <span className="font-ui text-xs text-ink-muted">
                  Delete this letter permanently?
                </span>
                <button
                  type="button"
                  onClick={onDelete}
                  className="font-ui text-xs text-accent underline underline-offset-4"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="font-ui text-xs text-ink-muted underline underline-offset-4"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onArchive}
                  className="font-ui text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-accent"
                >
                  {archived ? 'Move back' : 'Archive'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="font-ui text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-accent"
                >
                  Delete
                </button>
              </>
            )}
          </div>
```

These sit at the bottom deliberately: the top-right corner is reserved for Phase 4's share control, and the PRD asks for reading to feel undisturbed.

- [ ] **Step 3: Rewrite the inbox as a timeline**

In `src/routes/Inbox.tsx`, take `archived`, `setArchived` and `deleteForMe` from `useLetters()` alongside what it already destructures, and add:

```tsx
  const authorOf = (letter: Letter): string => {
    if (letter.senderId === userId) return profile?.fullName ?? 'You'
    return letter.senderName ?? partnerName ?? ''
  }

  const recipientOf = (letter: Letter): string => {
    if (letter.receiverId === userId) return profile?.fullName ?? 'you'
    return letter.receiverName ?? partnerName ?? ''
  }
```

taking `userId` and `profile` from `useAuth()`. Pass `authorName={authorOf(letter)}` and `unread={letter.receiverId === userId && !letter.isRead}` to each `LetterCard`, and give the modal `authorName={authorOf(open)}`, `recipientName={recipientOf(open)}`, `archived={false}`, `onArchive={() => { void setArchived(open.id, true); setOpen(null) }}` and `onDelete={() => { void deleteForMe(open.id); setOpen(null) }}`.

In the unlinked empty state, when `archived.length > 0`, add below the invite link:

```tsx
        <p className="mt-8 font-ui text-sm text-ink-muted">
          Your letters with them are in the{' '}
          <Link to="/archive" className="underline underline-offset-4 hover:text-accent">
            archive
          </Link>
          .
        </p>
```

And in the populated branch, above the grid, when `archived.length > 0`:

```tsx
      <div className="mb-6 text-right">
        <Link
          to="/archive"
          className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Archive
        </Link>
      </div>
```

The link appears only when the archive has something in it — an empty archive should not advertise itself.

- [ ] **Step 4: Add the archive route**

Create `src/routes/Archive.tsx`:

```tsx
import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { useLetters } from '../hooks/useLetters'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

export default function Archive() {
  const { archived, partnerName, loading, setArchived, deleteForMe } = useLetters()
  const { userId, profile } = useAuth()
  const [open, setOpen] = useState<Letter | null>(null)

  const authorOf = (letter: Letter): string =>
    letter.senderId === userId ? (profile?.fullName ?? 'You') : (letter.senderName ?? partnerName)

  const recipientOf = (letter: Letter): string =>
    letter.receiverId === userId ? (profile?.fullName ?? 'you') : (letter.receiverName ?? partnerName)

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (archived.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">Nothing kept here yet</p>
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
        <h1 className="font-hand text-3xl text-ink-ui">Kept</h1>
        <Link
          to="/"
          className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Back
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {archived.map((letter) => (
          <LetterCard
            key={letter.id}
            letter={letter}
            authorName={authorOf(letter)}
            unread={letter.receiverId === userId && !letter.isRead}
            onOpen={setOpen}
          />
        ))}
      </div>

      <AnimatePresence>
        {open && (
          <LetterModal
            letter={open}
            authorName={authorOf(open)}
            recipientName={recipientOf(open)}
            archived
            onClose={() => setOpen(null)}
            onArchive={() => {
              void setArchived(open.id, false)
              setOpen(null)
            }}
            onDelete={() => {
              void deleteForMe(open.id)
              setOpen(null)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
```

- [ ] **Step 5: Register the route**

In `src/app/App.tsx`, add the import:

```tsx
import Archive from '../routes/Archive'
```

and inside `<Routes>`:

```tsx
              <Route
                path="/archive"
                element={
                  <RequireAuth>
                    <Archive />
                  </RequireAuth>
                }
              />
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm test && npm run build && npm run lint
```

Start the dev server and fetch `/`, `/compose`, `/archive` — all must return HTTP 200. You cannot see the page; verify structurally and say so.

On the mock, the seeded letters are all received, so opening `/` should show three cards with the partner's name on them. Sending a letter should make a fourth card appear immediately with YOUR name on it — that is the change this whole task exists for, and it is the one thing worth checking by fetching the built bundle for the seeded text.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: merged timeline, archive route, and per-letter actions"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`, `supabase/README.md`, `docs/superpowers/specs/2026-09-08-phase-3-carryover.md`

- [ ] **Step 1: Correct the retired decisions**

In `README.md`, the Phase 2 section says a sent letter does not appear in your own inbox. That is no longer true. Replace that behaviour note with a line recording that Phase 2 shipped a received-only inbox and this change superseded it.

In the "Open decisions and known gaps" section, remove the `on delete cascade` warning — it is fixed — and replace it with a line noting letters now survive account deletion and that names freeze at the moment someone leaves.

- [ ] **Step 2: Add a build-record section**

After the Phase 3 section in `README.md`, add a short section in the same style covering this change: what it does, and the two defects it fixes (letters dying with their author, and the pairing error blaming the wrong person).

- [ ] **Step 3: Update the carry-over doc**

In `docs/superpowers/specs/2026-09-08-phase-3-carryover.md`, mark the delete-cascade item resolved rather than deleting it — the reasoning is why the fix exists. Add a note that `get_public_letter` still ignores the new archive and delete columns, so a shared-then-deleted letter would still resolve by slug, and that Phase 4 owns it.

- [ ] **Step 4: Note the migration in the Supabase guide**

In `supabase/README.md`, add a short section after step 3 saying that re-running `schema.sql` and `policies.sql` on an existing project is how migrations are applied, that both files are idempotent, and that after this change a re-run is required for archive and delete to work.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck
git add -A
git commit -m "docs: record the archive and survival change"
```

---

## What this deliberately leaves out

- **No UI for `unlink_partner()`.** The function archives correctly; exposing it is separate work.
- **`get_public_letter` still ignores the new columns.** A shared-then-deleted letter resolves by slug. Nothing calls it — sharing is Phase 4 — and Phase 4 owns it.
- **No bulk archive, no search, no export.**
- **No seeding harness and no integration tests.** The contract suite runs against the mock only.
- **No sent/received tabs.** One merged stream is the decision; do not add a filter toggle.
