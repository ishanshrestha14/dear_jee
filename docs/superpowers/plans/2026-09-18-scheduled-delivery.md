# Scheduled Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sender pick a future date for a letter to a current partner; it stays invisible to the recipient, and freely editable/cancelable by the sender, until that date.

**Architecture:** One nullable `scheduled_for date` column on `letters`. Delivery is a live comparison against `current_date` inside the existing RLS SELECT policy — no cron, no background job, discovered on the recipient's next 30-second poll. Editing before delivery is one narrow, sender-only exception carved into the existing "a sent letter cannot be edited" trigger. Canceling reuses the existing per-side delete column; a bond ending before delivery reuses it too, on the receiver's side only, so the sender keeps their own copy.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Supabase (Postgres + RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-scheduled-delivery-design.md`

## Global Constraints

- **`schema.sql` and `policies.sql` must stay idempotent**: `add column if not exists`, `drop constraint if exists` before `add constraint`, `create or replace` for every function. (CLAUDE.md)
- **Every SQL function carries `set search_path = public, pg_temp`.** (CLAUDE.md)
- **Compare `auth.uid()` with `is distinct from`, never `<>`** — a NULL caller makes `<>` yield NULL, which is falsy in an `if` and silently permits instead of rejecting. (CLAUDE.md)
- **The mock has no RLS.** Whatever the database enforces with a policy or trigger, the mock must reimplement in TypeScript, or the two implementations diverge. (CLAUDE.md)
- **Column grants are checked BEFORE RLS.** A relaxed trigger means nothing if the column was never grantable in the first place — this is the exact failure class a long debugging session in this project was spent on already. (spec, "Column grants")
- **No live migration has been applied for this feature as of writing this plan.** Task 14 hands the SQL to the owner; no earlier task may claim it ran.
- **Logic-level tests only** — no component tests, no hook tests, no jsdom, no Testing Library. (CLAUDE.md)
- **The contract suite (`contractTests.ts`) runs against the MOCK ONLY.** (CLAUDE.md)
- **`npx tsc --noEmit` checks nothing in this repo.** Always verify with `npm run typecheck`. (CLAUDE.md)

---

## File Structure

- `supabase/schema.sql` — the new column, its check constraint, the trigger exception, the unlink cancellation step.
- `supabase/policies.sql` — the RLS visibility gate, the widened update/insert grants.
- `src/lib/validation.ts` — `validateScheduledFor`.
- `src/lib/validation.test.ts` — its tests.
- `src/data/types.ts` — `Letter.scheduledFor`, `SendLetterInput.scheduledFor`, `LetterRepository.listScheduled` / `editScheduled`.
- `src/data/mockRepository.ts` — the date gate, `listScheduled`, `editScheduled`, `send()`'s new field, `unlink()`'s cancellation step.
- `src/data/supabaseRepository.ts` — the same shape, against real tables.
- `src/data/contractTests.ts` — the shared behavioural tests for all of the above (mock only, per the standing rule).
- `src/hooks/useLetters.ts` — exposes `scheduled`, `editScheduled`; `sendLetter` gains a fourth parameter.
- `src/components/ComposeLetter.tsx` — the "Schedule for later" toggle and date field; optional `initial*` props for editing.
- `src/routes/Compose.tsx` — reads an `?edit=<id>` search param, prefills, calls `editScheduled` instead of `sendLetter` when editing.
- `src/routes/Inbox.tsx` — the new "Scheduled" section.
- `README.md` — the Phase 8 build record.

**Task order and why.** Tasks 1–4 are the database and must come first — nothing above them can be tested against real behaviour without them, but the mock (Task 7) does not need them to exist live to be correct, since it reimplements the same rules independently. Tasks 5–6 are shared TypeScript groundwork. Task 7 is the mock plus every behavioural test — get this green before touching Supabase, since the contract suite is the mock's own test suite and catches logic errors far faster than a network round trip would. Task 8 mirrors 7 against Supabase, structurally, with no new tests (the contract suite doesn't run against it — CLAUDE.md). Tasks 9–12 are the UI, in dependency order: hook, then the two composer-touching routes, then the inbox section that links to them. Task 13 is documentation and the SQL handoff.

---

### Task 1: The column and its constraint

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add the column**

Find this block (around line 46-59):

```sql
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
```

Add immediately after it:

```sql

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
```

- [ ] **Step 2: Verify**

Run: `grep -c "scheduled_for" supabase/schema.sql`
Expected: at least `3` (the two `alter table` lines plus the constraint body).

This SQL is unexecuted — nobody has applied it to the live database yet. Do not claim otherwise.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(sql): a letter can carry a future delivery date"
```

---

### Task 2: RLS gate and column grants

**Files:**
- Modify: `supabase/policies.sql`

**Consumes:** the `scheduled_for` column from Task 1.

- [ ] **Step 1: Gate the receiver's visibility on the date**

Find (around line 75-81):

```sql
drop policy if exists letters_select_participant on letters;
create policy letters_select_participant on letters
  for select to authenticated
  using (
    (sender_id = auth.uid() and sender_deleted_at is null)
    or (receiver_id = auth.uid() and receiver_deleted_at is null)
  );
```

Replace with:

```sql
drop policy if exists letters_select_participant on letters;
create policy letters_select_participant on letters
  for select to authenticated
  using (
    (sender_id = auth.uid() and sender_deleted_at is null)
    or (receiver_id = auth.uid() and receiver_deleted_at is null
        and (scheduled_for is null or scheduled_for <= current_date))
  );
```

The sender's own disjunct is untouched — the sender can always see, and later edit or cancel, their own pending letter regardless of its date. Because this lives in the SELECT policy, every existing read path (`listConversation`, `listArchived`, `get_public_letter`) inherits the gate automatically; nothing about how those queries are written needs to change.

- [ ] **Step 2: Widen the update grant**

Find (around line 98-102):

```sql
revoke update on letters from authenticated;
grant update (is_read, is_public, share_slug,
              sender_archived_at, receiver_archived_at,
              sender_deleted_at, receiver_deleted_at)
  on letters to authenticated;
```

Replace with:

```sql
revoke update on letters from authenticated;
grant update (is_read, is_public, share_slug,
              sender_archived_at, receiver_archived_at,
              sender_deleted_at, receiver_deleted_at,
              message, salutation, body_font, scheduled_for)
  on letters to authenticated;
```

`message`, `salutation` and `body_font` join the grant here for the first time — nothing has ever been editable before this feature, so nothing needed to update them. The trigger (Task 3) is what actually restricts *when* that's allowed; this grant is only what makes it possible at all. Skipping this step means every edit attempt fails at the grant layer no matter what the trigger permits — the exact failure class the project already spent a long session debugging for an unrelated column.

- [ ] **Step 3: Widen the insert grant**

Find (around line 114-115):

```sql
grant insert (sender_id, receiver_id, message, salutation, body_font)
  on letters to authenticated;
```

Replace with:

```sql
grant insert (sender_id, receiver_id, message, salutation, body_font, scheduled_for)
  on letters to authenticated;
```

- [ ] **Step 4: Verify**

Run: `grep -n "scheduled_for" supabase/policies.sql`
Expected: three matches — the SELECT policy, the UPDATE grant, the INSERT grant.

- [ ] **Step 5: Commit**

```bash
git add supabase/policies.sql
git commit -m "feat(sql): gate delivery on the date, and grant the columns editing needs"
```

---

### Task 3: The sender's editing window

**Files:**
- Modify: `supabase/schema.sql`

**Consumes:** `scheduled_for` from Task 1.

- [ ] **Step 1: Replace the unconditional immutability check**

Find, inside `enforce_letter_update()` (around line 601-618):

```sql
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
```

Replace with:

```sql
create or replace function enforce_letter_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- The one exception to "a letter cannot be rewritten after it is sent":
  -- its own sender, and only while it is scheduled for a date that has not
  -- yet arrived. `is not distinct from` because a NULL auth.uid() (no
  -- caller) must never accidentally satisfy this — `<>` would yield NULL,
  -- which is falsy in the `if` below and would silently WIDEN the
  -- exception instead of closing it.
  sender_editing_pending boolean := current_user = 'authenticated'
    and old.scheduled_for is not null
    and old.scheduled_for > current_date
    and auth.uid() is not distinct from old.sender_id;
begin
  -- created_at and id are immutable always, no exception, for anyone.
  if new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
    raise exception 'IMMUTABLE_COLUMN';
  end if;

  -- message, salutation, body_font and scheduled_for itself are immutable
  -- UNLESS the row's own sender is rewriting a letter that has not yet
  -- delivered. The moment its date arrives — or if it was never scheduled
  -- at all — this collapses to exactly the rule that existed before this
  -- feature.
  if not sender_editing_pending
     and (new.message is distinct from old.message
          or new.salutation is distinct from old.salutation
          or new.body_font is distinct from old.body_font
          or new.scheduled_for is distinct from old.scheduled_for) then
    raise exception 'IMMUTABLE_COLUMN';
  end if;
```

Everything from `-- sender_id and receiver_id may go to NULL...` onward, to the end of the function, is unchanged — leave it exactly as it is.

- [ ] **Step 2: Verify the rest of the function is untouched**

Run: `grep -n "NOT_YOUR_SIDE\|ONLY_RECEIVER_MAY_READ" supabase/schema.sql`
Expected: both still present, unchanged, further down in the same function.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(sql): a pending scheduled letter's own sender may still rewrite it"
```

---

### Task 4: Cancel a pending letter when the bond it was scheduled for ends

**Files:**
- Modify: `supabase/schema.sql`

**Consumes:** `scheduled_for` from Task 1.

- [ ] **Step 1: Replace the letter-archiving block inside `unlink_partner()`**

Find (around line 337-351):

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

Replace with:

```sql
    -- A breakup moves the correspondence to both people's archives — but
    -- NOT a letter that was scheduled for a future date and never
    -- delivered. That one is excluded from every archive update below, and
    -- cancelled separately just after: archiving would put it in the
    -- sender's "Archived" list, where it would look like an ordinary
    -- delivered letter instead of one that never arrived. Doing it here
    -- rather than in the client means it is atomic: it cannot half-apply
    -- because someone closed a tab.
    update letters
       set sender_archived_at   = coalesce(sender_archived_at, now())
     where sender_id = me.id and receiver_id = other.id
       and (scheduled_for is null or scheduled_for <= current_date);
    update letters
       set receiver_archived_at = coalesce(receiver_archived_at, now())
     where receiver_id = me.id and sender_id = other.id
       and (scheduled_for is null or scheduled_for <= current_date);
    update letters
       set sender_archived_at   = coalesce(sender_archived_at, now())
     where sender_id = other.id and receiver_id = me.id
       and (scheduled_for is null or scheduled_for <= current_date);
    update letters
       set receiver_archived_at = coalesce(receiver_archived_at, now())
     where receiver_id = other.id and sender_id = me.id
       and (scheduled_for is null or scheduled_for <= current_date);

    -- A letter scheduled for a future date, still pending, must never reach
    -- a partner this bond no longer connects its sender to — even if the
    -- same two people bond again later and the date passes. Reusing
    -- receiver_deleted_at (rather than a new column) puts it behind the
    -- exact same gate that already hides a letter from someone who deleted
    -- it themselves. The sender's own side is untouched, so they keep
    -- seeing it — the app labels a letter this way as "not delivered,
    -- bond ended" by checking receiver_deleted_at on a letter only its
    -- sender can see, a state otherwise unreachable since a sender never
    -- sets the receiver's own delete flag any other way.
    update letters
       set receiver_deleted_at = coalesce(receiver_deleted_at, now())
     where receiver_id = me.id and sender_id = other.id
       and scheduled_for is not null and scheduled_for > current_date;
    update letters
       set receiver_deleted_at = coalesce(receiver_deleted_at, now())
     where receiver_id = other.id and sender_id = me.id
       and scheduled_for is not null and scheduled_for > current_date;
```

The four name-freezing `update letters set sender_name = ...` / `receiver_name = ...` statements just below this block are unchanged — leave them exactly as they are; freezing a name is harmless on a letter that will never be delivered anyway, and simpler to leave alone than to also exclude.

- [ ] **Step 2: Verify**

Run: `grep -n "scheduled_for" supabase/schema.sql`
Expected: now also present inside `unlink_partner()`, in addition to the matches from Tasks 1 and 3.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(sql): a bond ending cancels its pending scheduled letters"
```

---

### Task 5: `validateScheduledFor`

**Files:**
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/validation.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/validation.test.ts`:

```ts
import { validateScheduledFor } from './validation'

describe('validateScheduledFor', () => {
  it('accepts null — deliver now', () => {
    expect(validateScheduledFor(null)).toEqual({ ok: true })
  })

  it('accepts today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(validateScheduledFor(today)).toEqual({ ok: true })
  })

  it('accepts a future date', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(validateScheduledFor(future)).toEqual({ ok: true })
  })

  it('rejects a past date', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(validateScheduledFor(past)).toEqual({
      ok: false,
      reason: 'That date has already passed.',
    })
  })
})
```

Add `validateScheduledFor` to the existing `import { ... } from './validation'` line at the top of the file rather than a second import statement.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- validation`
Expected: FAIL — `validateScheduledFor is not a function` (or similar; it does not exist yet).

- [ ] **Step 3: Implement**

Add to `src/lib/validation.ts`, after `validateBodyFont`:

```ts
/** Null means "deliver now". A chosen date must be today or later. */
export function validateScheduledFor(scheduledFor: string | null): ValidationResult {
  if (scheduledFor === null) return { ok: true }
  const today = new Date().toISOString().slice(0, 10)
  if (scheduledFor < today) {
    return { ok: false, reason: 'That date has already passed.' }
  }
  return { ok: true }
}
```

This compares two `YYYY-MM-DD` strings lexicographically, which sorts identically to chronological order for that format — no `Date` parsing needed, and so no timezone to reason about either.

- [ ] **Step 4: Run them green**

Run: `npm test -- validation`
Expected: all pass, including the four new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: validate a letter's chosen delivery date"
```

---

### Task 6: Types

**Files:**
- Modify: `src/data/types.ts`

**Consumes:** `validateScheduledFor` is not used here — this task is types only.
**Produces:** `Letter.scheduledFor: string | null`; `SendLetterInput.scheduledFor?: string | null`; `LetterRepository.listScheduled(userId): Promise<Result<Letter[]>>`; `LetterRepository.editScheduled(id, userId, message, salutation, bodyFont, scheduledFor): Promise<Result<Letter>>`. Every later task relies on these exact names and shapes. `userId` is required here — unlike `setShared`, which the codebase already documents as "the one place in this interface where the mock is deliberately weaker than the database" because sharing has no per-side restriction that matters, editing very much does: only the letter's own sender may do it, and the mock has no RLS to lean on to enforce that without being told who's asking.

- [ ] **Step 1: Add the field to `Letter`**

Find (around line 42-49):

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
}
```

Replace with:

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
  /**
   * A future delivery date. Null means deliver now, which is what every
   * letter has always done. While this is set to a date later than today,
   * the letter is invisible to its receiver and its own sender may still
   * rewrite it — the one exception to a sent letter's usual immutability.
   */
  scheduledFor: string | null
}
```

- [ ] **Step 2: Add the field to `SendLetterInput`**

Find (around line 91-104):

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
  /** Null leaves the recipient's name as the salutation. */
  salutation: string | null
  /** Null leaves the default face. */
  bodyFont: BodyFont | null
}
```

Replace with:

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
  /** Null leaves the recipient's name as the salutation. */
  salutation: string | null
  /** Null leaves the default face. */
  bodyFont: BodyFont | null
  /**
   * Optional, unlike every field above — deliberately. Every existing call
   * site (contractTests.ts has 21 of them) sends an ordinary letter and has
   * no reason to name this at all; unlike `salutation` or `bodyFont`, an
   * absent value has exactly one meaning (deliver now) with none of the
   * undefined/null ambiguity the other fields are required to avoid.
   * Implementations must treat a missing key the same as an explicit null.
   */
  scheduledFor?: string | null
}
```

- [ ] **Step 3: Add the two new repository methods**

Find (around line 150-151):

```ts
  /** One past chapter's letters, newest first. Read-only by construction. */
  listChapter(userId: string, bondId: string): Promise<Result<Letter[]>>
}
```

Replace with:

```ts
  /** One past chapter's letters, newest first. Read-only by construction. */
  listChapter(userId: string, bondId: string): Promise<Result<Letter[]>>
  /**
   * The caller's own letters scheduled for a future date, newest first —
   * including one whose bond has since ended and will never deliver.
   * (Distinguish the two in the UI by checking `receiverDeletedAt`: null
   * means still pending, non-null means the bond ended before it could
   * arrive. A letter the caller cancelled themselves — `senderDeletedAt`
   * set — never appears here at all.)
   */
  listScheduled(userId: string): Promise<Result<Letter[]>>
  /**
   * Rewrites a pending scheduled letter: its words, its salutation, its
   * face, or the date itself. Fails once the letter has delivered, once its
   * bond has ended, or for anyone but its own sender — the same window
   * `enforce_letter_update` enforces in the database.
   */
  editScheduled(
    letterId: string,
    userId: string,
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ): Promise<Result<Letter>>
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: FAILS — `mockRepository.ts` and `supabaseRepository.ts` no longer satisfy `LetterRepository` (missing `listScheduled` / `editScheduled`), and neither constructs a `Letter` with `scheduledFor`. This is expected; Tasks 7 and 8 fix it.

- [ ] **Step 5: Commit**

```bash
git add src/data/types.ts
git commit -m "feat(data): letters carry a delivery date"
```

---

### Task 7: The mock — scheduling, the visibility gate, editing, cancellation

**Files:**
- Modify: `src/data/mockRepository.ts`
- Modify: `src/data/contractTests.ts`

**Consumes:** `Letter.scheduledFor`, `SendLetterInput.scheduledFor`, `LetterRepository.listScheduled` / `editScheduled` from Task 6; `validateScheduledFor` from Task 5.
**Produces:** every behaviour this feature has, proven against the mock — the contract suite is the only place these rules are tested (CLAUDE.md: the suite runs against the mock only).

- [ ] **Step 1: A `today()` helper and the seed data**

At the top of `src/data/mockRepository.ts`, after the existing imports, add:

```ts
/** Today as `YYYY-MM-DD`, comparable directly against `scheduledFor`. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
```

Import `validateScheduledFor` alongside the existing validation imports (line 2):

```ts
import { validateBodyFont, validateLetter, validateSalutation, validateScheduledFor } from '../lib/validation'
```

In `seedLetters()`'s shared `base` object (around line 90-107), add the new field so every seeded letter has one:

```ts
    bondId: MOCK_BOND_ID,
    sentAt: null,
    scheduledFor: null,
```

- [ ] **Step 2: Gate the receiver's visibility**

Find `visibleTo` (around line 140-144):

```ts
function visibleTo(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderDeletedAt === null
  if (l.receiverId === userId) return l.receiverDeletedAt === null
  return false
}
```

Replace with:

```ts
function visibleTo(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderDeletedAt === null
  if (l.receiverId === userId) {
    return l.receiverDeletedAt === null && (l.scheduledFor === null || l.scheduledFor <= today())
  }
  return false
}
```

- [ ] **Step 3: Exclude the sender's own pending letters from the normal grid**

`listConversation` and `listArchived` (around lines 178-202) each filter with `visibleTo(l, userId) && !isArchivedBy(l, userId)` or `&& isArchivedBy(l, userId)`. Add one more condition to both filters — a pending scheduled letter belongs in `listScheduled` (Step 5), not in either of these:

```ts
    async listConversation(userId) {
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      const mine = letters
        .filter(
          (l) =>
            l.bondId === open.id &&
            visibleTo(l, userId) &&
            !isArchivedBy(l, userId) &&
            !(l.senderId === userId && l.scheduledFor !== null && l.scheduledFor > today()),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listArchived(userId) {
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      const mine = letters
        .filter(
          (l) =>
            l.bondId === open.id &&
            visibleTo(l, userId) &&
            isArchivedBy(l, userId) &&
            !(l.senderId === userId && l.scheduledFor !== null && l.scheduledFor > today()),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },
```

- [ ] **Step 4: `send()` accepts the new field**

Find the `send` signature and body (around line 277-322):

```ts
    async send({ senderId, receiverId, message, salutation, bodyFont }: SendLetterInput) {
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)
      // The database has check constraints for these two; the mock has none,
      // so it enforces them here or the two implementations disagree about
      // what is a valid letter.
      const salutationCheck = validateSalutation(salutation)
      if (!salutationCheck.ok) return fail(salutationCheck.reason)
      const fontCheck = validateBodyFont(bodyFont)
      if (!fontCheck.ok) return fail(fontCheck.reason)
```

Replace with:

```ts
    async send({ senderId, receiverId, message, salutation, bodyFont, scheduledFor = null }: SendLetterInput) {
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)
      // The database has check constraints for these three; the mock has
      // none, so it enforces them here or the two implementations disagree
      // about what is a valid letter.
      const salutationCheck = validateSalutation(salutation)
      if (!salutationCheck.ok) return fail(salutationCheck.reason)
      const fontCheck = validateBodyFont(bodyFont)
      if (!fontCheck.ok) return fail(fontCheck.reason)
      const scheduledCheck = validateScheduledFor(scheduledFor)
      if (!scheduledCheck.ok) return fail(scheduledCheck.reason)
```

Then find the constructed `letter` object a little further down (around line 300-319) and add the field:

```ts
        bondId: receiverId === null ? null : open!.id,
        sentAt: receiverId === null ? null : now,
        scheduledFor,
      }
```

- [ ] **Step 5: `listScheduled`**

Add to `letterRepository`, right after `listHeld` (around line 229, before `sendHeld`):

```ts
    async listScheduled(userId) {
      const mine = letters
        .filter(
          (l) =>
            l.senderId === userId &&
            l.senderDeletedAt === null &&
            l.scheduledFor !== null &&
            l.scheduledFor > today(),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },
```

- [ ] **Step 6: `editScheduled`**

Add right after `listScheduled`:

```ts
    async editScheduled(letterId, userId, message, salutation, bodyFont, scheduledFor) {
      const letter = letters.find((l) => l.id === letterId)
      if (letter === undefined) return fail('Letter not found.')
      // Mirrors enforce_letter_update's sender_editing_pending: only the
      // letter's own sender, and only while it has not yet delivered.
      if (
        letter.senderId !== userId ||
        letter.scheduledFor === null ||
        letter.scheduledFor <= today()
      ) {
        return fail('A sent letter cannot be edited.')
      }
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)
      const salutationCheck = validateSalutation(salutation)
      if (!salutationCheck.ok) return fail(salutationCheck.reason)
      const fontCheck = validateBodyFont(bodyFont)
      if (!fontCheck.ok) return fail(fontCheck.reason)
      const scheduledCheck = validateScheduledFor(scheduledFor)
      if (!scheduledCheck.ok) return fail(scheduledCheck.reason)

      letter.message = message.trim()
      letter.salutation = salutation === null ? null : salutation.trim()
      letter.bodyFont = bodyFont
      letter.scheduledFor = scheduledFor
      return ok({ ...letter })
    },
```

- [ ] **Step 7: Cancel a pending letter when its bond ends**

Find the `unlink` letter-archiving loop (around line 469-475):

```ts
      for (const letter of letters) {
        if (letter.bondId !== open.id) continue
        if (letter.senderId !== null) letter.senderArchivedAt ??= at
        if (letter.receiverId !== null) letter.receiverArchivedAt ??= at
        letter.senderName ??= letter.senderId === null ? null : findProfile(letter.senderId)?.fullName ?? null
        letter.receiverName ??= letter.receiverId === null ? null : findProfile(letter.receiverId)?.fullName ?? null
      }
```

Replace with:

```ts
      for (const letter of letters) {
        if (letter.bondId !== open.id) continue
        // Pending and never delivered: cancel it instead of archiving it.
        // Archiving would put it in the sender's own Archive, looking like
        // an ordinary delivered letter instead of one that never arrived.
        // Only the receiver's side is gated, the same column a self-delete
        // already uses — the sender keeps their own copy, and the app
        // tells the two states apart by checking receiverDeletedAt on a
        // letter only its sender can see.
        if (letter.scheduledFor !== null && letter.scheduledFor > today()) {
          letter.receiverDeletedAt ??= at
          continue
        }
        if (letter.senderId !== null) letter.senderArchivedAt ??= at
        if (letter.receiverId !== null) letter.receiverArchivedAt ??= at
        letter.senderName ??= letter.senderId === null ? null : findProfile(letter.senderId)?.fullName ?? null
        letter.receiverName ??= letter.receiverId === null ? null : findProfile(letter.receiverId)?.fullName ?? null
      }
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: `mockRepository.ts` now satisfies `LetterRepository`. `supabaseRepository.ts` still fails — Task 8 fixes it.

- [ ] **Step 9: Write the failing contract tests**

Add to `src/data/contractTests.ts`, as a new top-level `describe` block (place it after the existing `describe('listHeld', ...)` block, before `sendHeld`'s block, so scheduling-related describes sit together):

```ts
  describe('scheduled delivery', () => {
    function daysFromNow(n: number): string {
      return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    }

    it('is invisible to the receiver before its date', async () => {
      const future = daysFromNow(7)
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'A letter for later.',
        salutation: null,
        bodyFont: null,
        scheduledFor: future,
      })
      expect(sent.error).toBeNull()

      // fx.userId is the sender; a fresh unlinked-then-relinked fixture has
      // no separate "log in as the partner" call, so this checks the
      // receiver's own read path the same way listScheduled below checks
      // the sender's — via listConversation, which the receiver would use.
      const { data } = await fx.letters.listConversation(fx.partnerId)
      expect(data!.some((l) => l.id === sent.data!.id)).toBe(false)
    })

    it('appears to the receiver once its date arrives', async () => {
      const today = daysFromNow(0)
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'Arriving today.',
        salutation: null,
        bodyFont: null,
        scheduledFor: today,
      })
      const { data } = await fx.letters.listConversation(fx.partnerId)
      expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
    })

    it('is excluded from the sender\'s own listConversation while pending', async () => {
      const future = daysFromNow(7)
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'Not in the grid yet.',
        salutation: null,
        bodyFont: null,
        scheduledFor: future,
      })
      const { data } = await fx.letters.listConversation(fx.userId)
      expect(data!.some((l) => l.id === sent.data!.id)).toBe(false)
    })

    it('listScheduled returns the sender\'s own pending letters', async () => {
      const future = daysFromNow(7)
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'On the list.',
        salutation: null,
        bodyFont: null,
        scheduledFor: future,
      })
      const { data } = await fx.letters.listScheduled(fx.userId)
      expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
    })

    it('editScheduled rewrites a pending letter', async () => {
      const future = daysFromNow(7)
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'Original wording.',
        salutation: null,
        bodyFont: null,
        scheduledFor: future,
      })
      const laterStill = daysFromNow(14)
      const edited = await fx.letters.editScheduled(
        sent.data!.id,
        fx.userId,
        'Rewritten wording.',
        'darling',
        'caveat',
        laterStill,
      )
      expect(edited.error).toBeNull()
      expect(edited.data!.message).toBe('Rewritten wording.')
      expect(edited.data!.salutation).toBe('darling')
      expect(edited.data!.bodyFont).toBe('caveat')
      expect(edited.data!.scheduledFor).toBe(laterStill)
    })

    it('editScheduled refuses a letter that has already delivered', async () => {
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'Already sent.',
        salutation: null,
        bodyFont: null,
      })
      const result = await fx.letters.editScheduled(
        sent.data!.id,
        fx.userId,
        'Trying to rewrite it.',
        null,
        null,
        null,
      )
      expect(result.error).toBe('A sent letter cannot be edited.')
    })

    it('editScheduled refuses anyone but the letter\'s own sender', async () => {
      const future = daysFromNow(7)
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'Not yours to rewrite.',
        salutation: null,
        bodyFont: null,
        scheduledFor: future,
      })
      const result = await fx.letters.editScheduled(
        sent.data!.id,
        fx.partnerId,
        'Trying to rewrite someone else\'s letter.',
        null,
        null,
        future,
      )
      expect(result.error).toBe('A sent letter cannot be edited.')
    })

    it('cancels a pending letter when the bond it was scheduled for ends, keeping the sender\'s own view', async () => {
      const future = daysFromNow(7)
      const sent = await fx.letters.send({
        senderId: fx.userId,
        receiverId: fx.partnerId,
        message: 'Never arrives.',
        salutation: null,
        bodyFont: null,
        scheduledFor: future,
      })
      await fx.bonds.unlink(fx.userId)

      const { data: scheduled } = await fx.letters.listScheduled(fx.userId)
      const cancelled = scheduled!.find((l) => l.id === sent.data!.id)
      expect(cancelled).toBeDefined()
      expect(cancelled!.receiverDeletedAt).not.toBeNull()
    })
  })
```

- [ ] **Step 10: Run them and watch them fail for the right reason**

Run: `npm test -- mockRepository`
Expected: FAIL — before Steps 1-7 of this task, these would fail with "not a function" or wrong visibility; after those steps, run again to confirm they were already passing (Steps 1-7 come before the tests in this task's ordering, so this is really the green-check below).

- [ ] **Step 11: Run everything green**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck clean, all tests pass (including every new one from Step 9), lint at the existing baseline (three `set-state-in-effect` warnings — unchanged, this task touches no React code).

- [ ] **Step 12: Commit**

```bash
git add src/data/mockRepository.ts src/data/contractTests.ts
git commit -m "feat(data): the mock schedules, gates, edits and cancels a future letter"
```

---

### Task 8: The Supabase adapter

**Files:**
- Modify: `src/data/supabaseRepository.ts`

**Consumes:** the same types from Task 6. No new tests in this task — the contract suite runs against the mock only (CLAUDE.md); this task's correctness rests on Tasks 1-4's SQL, applied later by the owner (Task 13).

- [ ] **Step 1: `LetterRow` and `toLetter`**

Find `LetterRow` (around line 21-40) and add the field at the end, before the closing brace:

```ts
  bond_id: string | null
  sent_at: string | null
  scheduled_for: string | null
}
```

Find `toLetter` (around line 50-69) and add the mapping at the end, before the closing brace:

```ts
  bondId: r.bond_id,
  sentAt: r.sent_at,
  scheduledFor: r.scheduled_for,
})
```

- [ ] **Step 2: Exclude the sender's own pending letters from the normal grid**

Find `listConversation` and `listArchived` (around line 206-245):

```ts
    async listConversation(userId) {
      return guard(async () => {
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        return ok(rows.filter((l) => !archivedBy(l, userId)))
      })
    },

    async listArchived(userId) {
      return guard(async () => {
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        return ok(rows.filter((l) => archivedBy(l, userId)))
      })
    },
```

Replace with:

```ts
    async listConversation(userId) {
      return guard(async () => {
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        const today = new Date().toISOString().slice(0, 10)
        return ok(
          rows.filter(
            (l) =>
              !archivedBy(l, userId) &&
              !(l.senderId === userId && l.scheduledFor !== null && l.scheduledFor > today),
          ),
        )
      })
    },

    async listArchived(userId) {
      return guard(async () => {
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        const today = new Date().toISOString().slice(0, 10)
        return ok(
          rows.filter(
            (l) =>
              archivedBy(l, userId) &&
              !(l.senderId === userId && l.scheduledFor !== null && l.scheduledFor > today),
          ),
        )
      })
    },
```

The receiver's own before-the-date exclusion needs no client-side code here at all — it's already enforced by the RLS SELECT policy from Task 2, so a not-yet-delivered letter never comes back from the `.select('*')` in the first place for the receiver.

- [ ] **Step 3: `send()` passes the field through**

Find (around line 305-337):

```ts
    async send({ senderId, receiverId, message, salutation, bodyFont }: SendLetterInput) {
      return guard(async () => {
        const validation = validateLetter(message)
        if (!validation.ok) return fail(validation.reason)
        const salutationCheck = validateSalutation(salutation)
        if (!salutationCheck.ok) return fail(salutationCheck.reason)
        const fontCheck = validateBodyFont(bodyFont)
        if (!fontCheck.ok) return fail(fontCheck.reason)

        const { data, error } = await db
          .from('letters')
          .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            message: message.trim(),
            salutation: salutation === null ? null : salutation.trim(),
            body_font: bodyFont,
          })
          .select()
          .single()
        if (error) return fail(letterErrorMessage(error.message))
        return ok(toLetter(data as LetterRow))
      })
    },
```

Replace with:

```ts
    async send({ senderId, receiverId, message, salutation, bodyFont, scheduledFor = null }: SendLetterInput) {
      return guard(async () => {
        const validation = validateLetter(message)
        if (!validation.ok) return fail(validation.reason)
        const salutationCheck = validateSalutation(salutation)
        if (!salutationCheck.ok) return fail(salutationCheck.reason)
        const fontCheck = validateBodyFont(bodyFont)
        if (!fontCheck.ok) return fail(fontCheck.reason)
        const scheduledCheck = validateScheduledFor(scheduledFor)
        if (!scheduledCheck.ok) return fail(scheduledCheck.reason)

        const { data, error } = await db
          .from('letters')
          .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            message: message.trim(),
            salutation: salutation === null ? null : salutation.trim(),
            body_font: bodyFont,
            scheduled_for: scheduledFor,
          })
          .select()
          .single()
        if (error) return fail(letterErrorMessage(error.message))
        return ok(toLetter(data as LetterRow))
      })
    },
```

Add `validateScheduledFor` to the existing validation import at the top of the file (line 3):

```ts
import { validateBodyFont, validateLetter, validateSalutation, validateScheduledFor } from '../lib/validation'
```

- [ ] **Step 4: `listScheduled`**

Add right after `listHeld` (around line 440-451, before `sendHeld`):

```ts
    async listScheduled(userId) {
      return guard(async () => {
        const today = new Date().toISOString().slice(0, 10)
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('sender_id', userId)
          .not('scheduled_for', 'is', null)
          .gt('scheduled_for', today)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },
```

`sender_deleted_at is null` needs no explicit filter here — the `letters_select_participant` RLS policy's sender disjunct already requires it for every row this query could possibly return.

- [ ] **Step 5: `editScheduled`**

Add right after `listScheduled`:

```ts
    async editScheduled(letterId, _userId, message, salutation, bodyFont, scheduledFor) {
      return guard(async () => {
        const validation = validateLetter(message)
        if (!validation.ok) return fail(validation.reason)
        const salutationCheck = validateSalutation(salutation)
        if (!salutationCheck.ok) return fail(salutationCheck.reason)
        const fontCheck = validateBodyFont(bodyFont)
        if (!fontCheck.ok) return fail(fontCheck.reason)
        const scheduledCheck = validateScheduledFor(scheduledFor)
        if (!scheduledCheck.ok) return fail(scheduledCheck.reason)

        const { data, error } = await db
          .from('letters')
          .update({
            message: message.trim(),
            salutation: salutation === null ? null : salutation.trim(),
            body_font: bodyFont,
            scheduled_for: scheduledFor,
          })
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return fail('A sent letter cannot be edited.')
        return ok(toLetter(data as LetterRow))
      })
    },
```

`_userId` is unused here, same as `sendHeld`'s own `_userId` a few lines up — the mock needs it to check ownership itself, but here `auth.uid()` inside `enforce_letter_update` (Task 3) is the real, unspoofable check; the interface still takes the parameter so both implementations share one signature.

`enforce_letter_update` (Task 3) is what actually enforces the editing window — this returns the same `IMMUTABLE_COLUMN` failure `letterErrorMessage` already maps to `'A sent letter cannot be edited.'` for every other locked column, so no new error copy is needed. A `data === null` with no `error` means RLS's UPDATE policy matched the row but the trigger's `WITH CHECK`-adjacent path returned nothing displayable for it — mirroring the same defensive fallback `deleteForMe` already uses elsewhere in this file for the identical PostgREST shape.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build`
Expected: both clean. This task adds no new tests (contract suite is mock-only); typecheck and build are the only available verification until Task 13 hands the SQL to the owner.

- [ ] **Step 7: Commit**

```bash
git add src/data/supabaseRepository.ts
git commit -m "feat(data): the Supabase adapter schedules, edits and lists pending letters"
```

---

### Task 9: `useLetters`

**Files:**
- Modify: `src/hooks/useLetters.ts`

**Consumes:** `listScheduled` / `editScheduled` from Tasks 7-8; `Letter.scheduledFor` from Task 6.
**Produces:** `UseLetters.scheduled: Letter[]`; `UseLetters.sendLetter(message, salutation, bodyFont, scheduledFor)`; `UseLetters.editScheduled(id, message, salutation, bodyFont, scheduledFor)`. Tasks 10-12 consume these exact names through `useLettersContext()`.

- [ ] **Step 1: Extend the interface**

Find (around line 8-27):

```ts
export interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  held: Letter[]
  hasBond: boolean
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
  ): Promise<{ ok: boolean; error?: string }>
  sendHeld(id: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  deleteForMe(id: string): Promise<void>
  setShared(id: string, shared: boolean): Promise<{ ok: boolean; error?: string }>
  reload(): Promise<void>
}
```

Replace with:

```ts
export interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  held: Letter[]
  /** The caller's own pending or bond-cancelled scheduled letters. */
  scheduled: Letter[]
  hasBond: boolean
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ): Promise<{ ok: boolean; error?: string }>
  sendHeld(id: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  deleteForMe(id: string): Promise<void>
  setShared(id: string, shared: boolean): Promise<{ ok: boolean; error?: string }>
  editScheduled(
    id: string,
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ): Promise<{ ok: boolean; error?: string }>
  reload(): Promise<void>
}
```

- [ ] **Step 2: Fetch it alongside everything else**

Find `load` (around line 49-80) and add a fourth parallel fetch:

```ts
  const load = useCallback(async (id: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    const [conversation, archive, heldLetters, scheduledLetters] = await Promise.all([
      letterRepository.listConversation(id),
      letterRepository.listArchived(id),
      letterRepository.listHeld(id),
      letterRepository.listScheduled(id),
    ])
    if (conversation.error !== null) {
      if (!silent) setError(conversation.error)
    } else setLetters(conversation.data)

    if (archive.error !== null) {
      if (!silent) setError(archive.error)
    } else setArchived_(archive.data)

    if (heldLetters.error !== null) {
      if (!silent) setError(heldLetters.error)
    } else setHeld(heldLetters.data)

    if (scheduledLetters.error !== null) {
      if (!silent) setError(scheduledLetters.error)
    } else setScheduled(scheduledLetters.data)

    if (
      !silent &&
      conversation.error === null &&
      archive.error === null &&
      heldLetters.error === null &&
      scheduledLetters.error === null
    ) {
      setError(null)
    }
  }, [])
```

Add the new state near the other three (around line 37-39):

```ts
  const [letters, setLetters] = useState<Letter[]>([])
  const [archived, setArchived_] = useState<Letter[]>([])
  const [held, setHeld] = useState<Letter[]>([])
  const [scheduled, setScheduled] = useState<Letter[]>([])
```

Find the `userId === null` early-return branch just below (around line 83-88) and clear it there too:

```ts
    if (userId === null) {
      setLetters([])
      setArchived_([])
      setHeld([])
      setScheduled([])
      setLoading(authLoading)
      return
    }
```

- [ ] **Step 3: `sendLetter` takes the fourth argument**

Find (around line 126-144):

```ts
  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message, salutation, bodyFont) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
        salutation,
        bodyFont,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, partnerId, load],
  )
```

Replace with:

```ts
  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message, salutation, bodyFont, scheduledFor) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
        salutation,
        bodyFont,
        scheduledFor,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, partnerId, load],
  )
```

- [ ] **Step 4: `editScheduled`**

Add after `setSharedFn` (around line 232, right before the final `return`):

```ts
  const editScheduledFn = useCallback<UseLetters['editScheduled']>(
    async (id, message, salutation, bodyFont, scheduledFor) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      mutating.current++
      try {
        const result = await letterRepository.editScheduled(
          id,
          userId,
          message,
          salutation,
          bodyFont,
          scheduledFor,
        )
        if (result.error !== null) return { ok: false, error: result.error }
        await load(userId)
        return { ok: true }
      } finally {
        mutating.current--
      }
    },
    [userId, load],
  )
```

- [ ] **Step 5: Return the new pieces**

Find the final `return` (around line 234-249) and add `scheduled` and `editScheduled`:

```ts
  return {
    letters,
    archived,
    held,
    scheduled,
    hasBond: partnerId !== null,
    partnerName,
    loading: loading || authLoading,
    error,
    sendLetter,
    sendHeld: sendHeldFn,
    markRead,
    setArchived: setArchivedFn,
    deleteForMe,
    setShared: setSharedFn,
    editScheduled: editScheduledFn,
    reload,
  }
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: FAILS — `Compose.tsx` still calls `sendLetter` with three arguments. Task 11 fixes it. (`Inbox.tsx` does not yet reference `scheduled`, which is fine — an unused property on a destructured object is not a type error.)

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useLetters.ts
git commit -m "feat(hooks): schedule, list and edit reach the UI"
```

---

### Task 10: The composer's schedule toggle, and edit mode

**Files:**
- Modify: `src/components/ComposeLetter.tsx`

**Consumes:** `BODY_FONTS`, `MAX_LETTER_LENGTH`, `MAX_SALUTATION_LENGTH`, `validateLetter` (already imported); `validateScheduledFor` from Task 5.
**Produces:** `ComposeLetterProps.onSend`'s new fourth argument `scheduledFor: string | null`; five new optional props (`initialMessage`, `initialSalutation`, `initialBodyFont`, `initialScheduledFor`, `submitLabel`) that Task 11 relies on by these exact names.

- [ ] **Step 1: Extend the props**

Find (around line 9-18):

```ts
interface ComposeLetterProps {
  partnerName: string
  onSend: (
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
  ) => Promise<{ ok: boolean; error?: string }>
  onCancel: () => void
  disabled?: boolean
}
```

Replace with:

```ts
interface ComposeLetterProps {
  partnerName: string
  onSend: (
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ) => Promise<{ ok: boolean; error?: string }>
  onCancel: () => void
  disabled?: boolean
  /** Pre-fills the page for editing an existing pending letter. */
  initialMessage?: string
  initialSalutation?: string
  initialBodyFont?: BodyFont | null
  initialScheduledFor?: string | null
  /** Swaps the button's resting and in-flight copy for the edit case. */
  submitLabel?: string
  sendingLabel?: string
}
```

- [ ] **Step 2: Seed state from the new props, and add the toggle's own state**

Find (around line 21-31):

```ts
export function ComposeLetter({ partnerName, onSend, onCancel, disabled = false }: ComposeLetterProps) {
  const [message, setMessage] = useState('')
  const [salutation, setSalutation] = useState('')
  const [bodyFont, setBodyFont] = useState<BodyFont | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
```

Replace with:

```ts
export function ComposeLetter({
  partnerName,
  onSend,
  onCancel,
  disabled = false,
  initialMessage = '',
  initialSalutation = '',
  initialBodyFont = null,
  initialScheduledFor = null,
  submitLabel = 'Send letter',
  sendingLabel = 'Sending…',
}: ComposeLetterProps) {
  const [message, setMessage] = useState(initialMessage)
  const [salutation, setSalutation] = useState(initialSalutation)
  const [bodyFont, setBodyFont] = useState<BodyFont | null>(initialBodyFont)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  // Pre-checked when editing an already-scheduled letter; off by default for
  // a fresh letter, which is exactly today's "send now" behaviour.
  const [scheduling, setScheduling] = useState(initialScheduledFor !== null)
  const [scheduledFor, setScheduledFor] = useState(initialScheduledFor ?? '')
  const todayIso = new Date().toISOString().slice(0, 10)
```

- [ ] **Step 3: Validate and send the date**

Find `handleSend` (around line 33-46):

```ts
  async function handleSend() {
    const validation = validateLetter(message)
    if (!validation.ok) {
      setError(validation.reason)
      return
    }
    setSending(true)
    const result = await onSend(message, salutation.trim() === '' ? null : salutation.trim(), bodyFont)
    setSending(false)
    if (result.ok) {
      setMessage('')
      setSalutation('')
    } else setError(result.error ?? 'The letter could not be sent.')
  }
```

Replace with:

```ts
  async function handleSend() {
    const validation = validateLetter(message)
    if (!validation.ok) {
      setError(validation.reason)
      return
    }
    const chosenDate = scheduling && scheduledFor !== '' ? scheduledFor : null
    const dateCheck = validateScheduledFor(chosenDate)
    if (!dateCheck.ok) {
      setError(dateCheck.reason)
      return
    }
    setSending(true)
    const result = await onSend(
      message,
      salutation.trim() === '' ? null : salutation.trim(),
      bodyFont,
      chosenDate,
    )
    setSending(false)
    if (result.ok) {
      setMessage('')
      setSalutation('')
    } else setError(result.error ?? 'The letter could not be sent.')
  }
```

Add `validateScheduledFor` to the existing import (line 6):

```ts
import {
  BODY_FONTS,
  MAX_LETTER_LENGTH,
  MAX_SALUTATION_LENGTH,
  validateLetter,
  validateScheduledFor,
} from '../lib/validation'
```

- [ ] **Step 4: The toggle and date field**

Find the footer row that holds the word count and font picker (around line 93-120), specifically right after the closing `</div>` of the font-picker row and before the Cancel/Send row. Add a new row between them:

```ts
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-paper-edge pt-4">
          <label className="flex items-center gap-2 font-ui text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={scheduling}
              onChange={(event) => {
                setScheduling(event.target.checked)
                if (!event.target.checked) setScheduledFor('')
              }}
            />
            Schedule for later
          </label>
          {scheduling && (
            <input
              type="date"
              value={scheduledFor}
              min={todayIso}
              onChange={(event) => setScheduledFor(event.target.value)}
              aria-label="Deliver on"
              className="rounded-full border border-paper-edge bg-transparent px-3 py-1.5 font-ui text-xs text-ink-ui focus:border-accent focus:outline-none"
            />
          )}
        </div>
```

- [ ] **Step 5: The submit button uses the new labels**

Find (around line 151-161):

```ts
              <motion.button
                type="button"
                onClick={handleSend}
                disabled={!valid || sending || disabled}
                whileHover={valid && !sending && !disabled ? { boxShadow: 'var(--shadow-letter-lifted)' } : undefined}
                whileTap={valid && !sending && !disabled ? { scale: 0.97 } : undefined}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={15} />
                {sending ? 'Sending…' : 'Send letter'}
              </motion.button>
```

Replace the last two lines with:

```ts
                <Send size={15} />
                {sending ? sendingLabel : submitLabel}
              </motion.button>
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck`
Expected: fails only on `Compose.tsx`'s three-argument `onSend` — Task 11 fixes it. `ComposeLetter.tsx` itself typechecks cleanly.

```bash
git add src/components/ComposeLetter.tsx
git commit -m "feat: schedule a letter for later, and reuse the composer to edit one"
```

---

### Task 11: Wire editing into the Compose route

**Files:**
- Modify: `src/routes/Compose.tsx`

**Consumes:** `useLettersContext().scheduled` and `.editScheduled` from Task 9; the five new `ComposeLetter` props from Task 10.

- [ ] **Step 1: Rewrite the route**

Replace the entire file:

```tsx
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ComposeLetter } from '../components/ComposeLetter'
import { useLettersContext } from '../hooks/LettersProvider'

export default function Compose() {
  const { partnerName, loading, sendLetter, editScheduled, scheduled } = useLettersContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  // Undefined while the id doesn't resolve to one of the caller's own
  // pending letters — a stale link, or one that has since delivered or been
  // cancelled. Falling through to an ordinary blank compose is the safe
  // default rather than an error page for what is, at worst, a dead link.
  const editing = editId === null ? null : (scheduled.find((l) => l.id === editId) ?? null)

  if (editId !== null && editing === null && !loading) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">That letter isn't there anymore</p>
        <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
          It may have already arrived, or been cancelled.
        </p>
      </div>
    )
  }

  if (editing !== null) {
    return (
      <ComposeLetter
        partnerName={partnerName}
        disabled={loading}
        initialMessage={editing.message}
        initialSalutation={editing.salutation ?? ''}
        initialBodyFont={editing.bodyFont}
        initialScheduledFor={editing.scheduledFor}
        submitLabel="Save changes"
        sendingLabel="Saving…"
        onCancel={() => navigate('/')}
        onSend={async (message, salutation, bodyFont, scheduledFor) => {
          const result = await editScheduled(editing.id, message, salutation, bodyFont, scheduledFor)
          if (result.ok) navigate('/')
          return result
        }}
      />
    )
  }

  return (
    <ComposeLetter
      partnerName={partnerName}
      disabled={loading}
      onCancel={() => navigate('/')}
      onSend={async (message, salutation, bodyFont, scheduledFor) => {
        const result = await sendLetter(message, salutation, bodyFont, scheduledFor)
        if (result.ok) navigate('/')
        return result
      }}
    />
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: both clean — this was the last caller of the old three-argument `onSend`/`sendLetter` shapes.

- [ ] **Step 3: Commit**

```bash
git add src/routes/Compose.tsx
git commit -m "feat: edit a pending scheduled letter through the same composer"
```

---

### Task 12: The Scheduled section

**Files:**
- Modify: `src/routes/Inbox.tsx`

**Consumes:** `scheduled` from `useLettersContext()` (Task 9).

- [ ] **Step 1: Read `scheduled` and add a `Link` for the Edit action**

`Link` is already imported (line 3). Find the destructure of `useLettersContext()` (around line 16-29) and add `scheduled`:

```ts
  const {
    letters,
    archived,
    held,
    scheduled,
    hasBond,
    partnerName,
    loading,
    error,
    markRead,
    setArchived,
    deleteForMe,
    setShared,
    sendHeld,
  } = useLettersContext()
```

- [ ] **Step 2: State for the Cancel confirm**

Find the existing held-letter state (around line 42-43):

```ts
  const [expandedHeldId, setExpandedHeldId] = useState<string | null>(null)
  const [confirmingHeldDeleteId, setConfirmingHeldDeleteId] = useState<string | null>(null)
```

Add right after it:

```ts
  const [confirmingScheduledCancelId, setConfirmingScheduledCancelId] = useState<string | null>(null)
```

- [ ] **Step 3: Build the section**

Find the closing of the `unsent` constant (around line 184-185, the `</div>\n  )` right before `if (letters.length === 0) {`). Add a new constant right after it:

```tsx
  // A letter still waiting for its date, or one that will never arrive
  // because its bond ended first — receiverDeletedAt is what tells the two
  // apart, and it is only ever set on a scheduled letter by that bond-ending
  // path (its receiver can never see it to delete it themselves).
  const upcoming = scheduled.length > 0 && (
    <div className="mt-8 text-left">
      <h2 className="font-ui text-xs tracking-wide text-ink-muted">Scheduled · {scheduled.length}</h2>
      <ul className="mt-3 space-y-3">
        {scheduled.map((letter) => {
          const cancelledByBondEnding = letter.receiverDeletedAt !== null
          const confirmingCancel = confirmingScheduledCancelId === letter.id
          return (
            <li
              key={letter.id}
              className="rounded-letter border border-dashed border-paper-edge bg-paper-letter px-4 py-3"
            >
              <p className="font-letter text-[15px] leading-relaxed text-ink-letter">
                {snippet(letter.message, 100)}
              </p>
              <p className="mt-2 flex items-center gap-1.5 font-ui text-xs tracking-wide text-ink-muted">
                <span role="img" aria-label="Calendar">
                  📅
                </span>
                {cancelledByBondEnding
                  ? 'Not delivered — bond ended'
                  : `Arrives ${formatLetterDate(letter.scheduledFor!)}`}
              </p>
              <div className="mt-3 flex items-center gap-4">
                {!cancelledByBondEnding && (
                  <Link
                    to={`/compose?edit=${letter.id}`}
                    className="font-ui text-xs text-accent underline underline-offset-4"
                  >
                    Edit
                  </Link>
                )}
                {confirmingCancel ? (
                  <>
                    <span className="font-ui text-xs text-ink-muted">Cancel permanently?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingScheduledCancelId(null)
                        void deleteForMe(letter.id)
                      }}
                      className="font-ui text-xs text-accent underline underline-offset-4"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingScheduledCancelId(null)}
                      className="font-ui text-xs text-ink-muted underline underline-offset-4"
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingScheduledCancelId(letter.id)}
                    className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
```

- [ ] **Step 4: Render it in both branches, exactly where `unsent` already renders**

Find the empty-inbox branch's `{unsent}` (around line 234) and change it to:

```tsx
        {unsent}
        {upcoming}
```

Find the populated branch's `{unsent}` (around line 268) and change it the same way:

```tsx
      {unsent}
      {upcoming}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all clean; lint at the unchanged three-warning baseline.

- [ ] **Step 6: Verify by eye**

This is a UI change with no logic-level test coverage for the rendering itself (CLAUDE.md: no component tests). Run `npm run dev`, open the app, use the "Schedule for later" toggle from Task 10 to write a letter dated a few days out, and confirm:
- It appears under a new "Scheduled" heading with a dashed border and a 📅 date, not in the main grid.
- "Edit" opens the composer pre-filled and "Save changes" updates it in place.
- "Cancel" removes it after the two-step confirm.

State plainly in the commit message that this was checked by running the dev server, not merely by the automated suite passing — per CLAUDE.md's rule to say what was actually verified.

- [ ] **Step 7: Commit**

```bash
git add src/routes/Inbox.tsx
git commit -m "feat: a scheduled letter shows in its own section, dashed border and all

Verified by running npm run dev and exercising schedule, edit and cancel by hand."
```

---

### Task 13: Record the phase, hand over the SQL

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the Phase 8 build record**

Find the end of the Phase 7 section and the `---` before "Open decisions and known gaps" (the same seam Phase 7's own record was inserted at). Add a new section immediately before that `---`:

```markdown
## Phase 8 — Scheduled delivery *(complete, migration pending)*

A letter can now be written for a date that hasn't arrived yet. `scheduled_for`
is a nullable `date` column; null means deliver now, exactly what every
letter already did. Delivery has no job or cron behind it at all — the
recipient's existing RLS visibility rule gained one clause comparing the
column against `current_date`, so a letter surfaces on whichever poll happens
after midnight on its day, the same way delivery has always worked here.

- **Editability is one narrow, sender-only exception**, not a general
  reopening of "a sent letter cannot be edited." `enforce_letter_update` now
  computes a single `sender_editing_pending` condition — true only for the
  letter's own sender, only while its date is still in the future — and
  every other actor, and every other column, remains exactly as immutable as
  before.
- **Column grants had to widen before any of this could work at all.**
  `message`, `salutation` and `body_font` had never been grantable for
  UPDATE, because nothing had ever been editable — a gap that would have
  silently defeated the trigger regardless of how correct it was, the same
  failure class already spent a long session on for an unrelated column.
- **Canceling reuses `receiver_deleted_at` rather than inventing a new
  state**, twice over: once for the sender's own voluntary cancel (the
  existing per-letter delete, unchanged), and once for a bond ending before
  delivery, where `unlink_partner` now sets it on the receiver's side only —
  the sender keeps their own copy, labelled by the app as never having
  arrived, and the recipient can never see it even if the same two people
  bond again later and the date passes.
- **The recipient's side needed no new code whatsoever.** The entire feature
  lives in when a row becomes selectable and who may still edit it before
  that point — the whole reason for gating this at the database layer
  instead of teaching the client a new concept.

**Migration status.** `supabase/schema.sql` and `supabase/policies.sql` carry
the new column, its constraint, the trigger's editing exception, and the
unlink cancellation step, and are idempotent by inspection. Applying them to
the live project is the owner's step and had not been run as of this record.
```

- [ ] **Step 2: Update the test count**

Run: `npm test`
Copy the exact reported test count into the command table's row (`| npm test | Vitest, N logic-level tests across M files |`), replacing whatever number is currently there.

- [ ] **Step 3: Verify and commit**

Run: `git diff --stat`
Expected: only `README.md`.

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add README.md
git commit -m "docs: record phase 8"
```

- [ ] **Step 4: Hand the SQL to the owner, then STOP**

Tell the owner, in these words or close to them:

> `supabase/schema.sql` and `supabase/policies.sql` both need applying in the
> Supabase SQL editor, schema first. Both are idempotent, and neither drops
> anything this time — no function's return type changed, so `create or
> replace` covers all of it. Once applied, writing a letter with "Schedule
> for later" turned on is what proves it end to end.

Do not apply it. Do not claim it has been applied. Stop here.
