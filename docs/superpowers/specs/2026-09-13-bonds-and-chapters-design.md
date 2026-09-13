# Bonds and chapters — design

**Date:** 2026-09-13
**Status:** proposed, not implemented. Every statement of SQL in this document
is unexecuted.

## The problem

Dear Jee models a relationship as a single column: `profiles.partner_id`. That
is enough for one pair that never changes. It is not enough for what the app
is now meant to be — many accounts coexisting unbonded, bonding only by invite,
and relationships that end and are replaced.

Three things are missing and one is quietly wrong:

- **No way to end a bond from the app.** `unlink_partner()` exists in
  `schema.sql:173` and is granted to `authenticated`, but its own comment says
  "No UI calls this yet", and `LetterRepository`/`ProfileRepository` have no
  method for it. The mechanism is built; nothing reaches it.
- **No concept of a chapter.** `listConversation` returns every letter you
  participate in. With one lifetime bond that is correct. The moment there is a
  second, letters written to a former partner appear inline in the current
  correspondence.
- **An unbonded person cannot write at all.** `useLetters.sendLetter:80`
  refuses with "You are not connected to anyone yet", and `Layout.tsx:13` hides
  the compose link.
- **Un-archiving is already a latent bug.** `LetterModal`'s "Move back" button
  calls `setArchived(id, false)`, which today would lift a letter written to a
  former partner onto the current home page.

## What was decided, and why

Four decisions were taken in conversation on 2026-09-13. They are recorded here
with their reasoning because each closes off alternatives that will look
attractive again later.

**1. Home is scoped to the current bond; past relationships get their own
view.** Not "everything unarchived". Home shows the live chapter, the archive
holds what you put away *within* that chapter, and `/chapters` lists past
relationships by person. Rejected: letting the archive double as the container
for past relationships, which conflates "I put this away" with "this is over".

**2. Past chapters are read-only. Nothing crosses between them.** A letter
written to B is never re-associated to C, and is never copied forward either.
Two reasons, and the second is the decisive one:

- `receiver_id` is what grants read access. Re-pointing it at C is not a
  relabelling, it is a permission grant.
- It is not a copy, it is a *move*. B would silently lose a letter they
  received, from their own archive, without being asked. That is not a
  feature, it is data loss with a friendly name.

**3. An unbonded person may write held letters, which can be sent later.** They
carry `receiver_id` null and belong to no chapter. When the author later bonds,
each held letter can be sent individually. **The letter keeps `created_at` —
the date it was written — as its date.** A separate `sent_at` records when it
was actually delivered. This was the owner's explicit requirement: the letter
should show when it was written.

**4. Ending a bond is immediate, unilateral and symmetric, and the other person
is told.** `unlink_partner()` already frees both sides in one transaction and
issues both a fresh invite code. The missing half is that B currently learns
nothing — they simply find themselves single. Rejected: mutual consent, which
needs a pending state, a cancel path, and a rule for a partner who never
answers, for no gain in a two-person relationship that one person has already
decided is over.

## Data model

```sql
create table if not exists bonds (
  id          uuid primary key default gen_random_uuid(),
  -- Canonical ordering, lower uuid first: a pair has exactly one
  -- representation, and it matches the ascending-uuid lock order that
  -- link_partners and unlink_partner already use, so the deadlock reasoning
  -- in those functions carries over to this table unchanged.
  lower_id    uuid references profiles(id) on delete set null,
  upper_id    uuid references profiles(id) on delete set null,
  -- Frozen when the bond ends. After unbonding, profiles_select_self_or_partner
  -- stops either person reading the other's profile at all, so a past chapter
  -- that resolved its title through profiles would render blank. Same reason
  -- unlink_partner already freezes sender_name/receiver_name onto letters.
  lower_name  text,
  upper_name  text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  -- When each side saw the "this ended" notice. Null means not yet shown.
  lower_seen_end_at timestamptz,
  upper_seen_end_at timestamptz,
  -- Both null guards are load-bearing, not defensive noise. Each id goes null
  -- when that person deletes their account, so a bond both of whose members
  -- have left has two nulls — and `null is distinct from null` is false, which
  -- would make a bare `lower_id is distinct from upper_id` fail exactly then
  -- and block the `on delete set null` action from firing at all.
  constraint bonds_distinct_members
    check (lower_id is null or upper_id is null or lower_id <> upper_id)
);

-- At most one open bond per person, enforced by the database rather than by a
-- read-then-write check inside link_partners. The existing
-- `if me.partner_id is not null then raise ALREADY_LINKED` can in principle be
-- raced; a partial unique index cannot.
create unique index if not exists bonds_one_active_lower
  on bonds(lower_id) where ended_at is null;
create unique index if not exists bonds_one_active_upper
  on bonds(upper_id) where ended_at is null;

alter table letters add column if not exists bond_id uuid references bonds(id);
alter table letters add column if not exists sent_at timestamptz;
```

`letters.bond_id` null means a held letter — written, belonging to no chapter
yet. `letters.sent_at` null means the same; it is set when the letter is
delivered. `created_at` continues to mean *written* and remains immutable under
`enforce_letter_update`.

### profiles.partner_id stays, as a cache

Deriving the current partner from `bonds` and dropping the column was
considered and rejected. `partner_id` is read by `current_partner_id()`, by
three RLS policies and by the whole UI; restructuring that buys nothing,
because both writes happen inside the same `security definer` transaction and
therefore cannot drift. It must be documented in `schema.sql` as a cache whose
only writers are `link_partners` and `unlink_partner`, with the invariant
stated explicitly:

> `profiles.partner_id is not null` if and only if a row exists in `bonds`
> with `ended_at is null` containing that profile.

## SQL functions

**`link_partners(code)`** — after setting both `partner_id`s, insert a bond in
canonical order. A pair that bonds, unbonds and bonds again produces a *second*
row; the partial unique indexes only constrain open bonds. That is the intended
behaviour, not an accident: it is the "whole new chapter" case.

**`unlink_partner()`** — add two steps to what it already does. Close the open
bond (`ended_at = now()`), and freeze `lower_name`/`upper_name` from the
profiles while it can still read them. Its existing letter archiving and
per-letter name freezing are unchanged.

**`freeze_profile_letters()`** — the `before delete` trigger on profiles must
also close any open bond, or a deleted account leaves a bond open forever and
the partial unique index then blocks the survivor from ever bonding again.

**`send_held_letter(letter_id uuid)`** — new, `security definer`,
`set search_path = public, pg_temp`. Locks the letter row; requires the caller
to be the sender, `receiver_id` to be null, and the caller to have an open
bond. Sets `receiver_id`, `bond_id` and `sent_at` in one statement. Never
touches `created_at`. Raises `NOT_SIGNED_IN`, `LETTER_NOT_FOUND`,
`ALREADY_SENT`, or `NO_BOND`.

**`acknowledge_bond_end(bond_id uuid)`** — new, `security definer`. Sets
`lower_seen_end_at` or `upper_seen_end_at` for the calling member. Needed
because `authenticated` has no write access to `bonds` at all.

## The trigger exception

`enforce_letter_update` currently makes `receiver_id` immutable, and that check
sits **outside** the `current_user = 'authenticated'` wrapper, so it fires for
`security definer` functions too. Sending a held letter would be rejected by
the very trigger that protects the table.

The rule is load-bearing — its comment names the attack: *"either party could
re-point receiver_id into a stranger's inbox — defeating the insert policy's
partner check."* So the exception is cut as narrowly as possible rather than
the rule relaxed:

```sql
if new.receiver_id is distinct from old.receiver_id
   and new.receiver_id is not null
   and not (old.receiver_id is null and current_user <> 'authenticated') then
  raise exception 'IMMUTABLE_COLUMN';
end if;
```

A client can never change `receiver_id` — `current_user` is `authenticated` for
every PostgREST request. A definer function can only ever *fill in* a null one.
Once addressed, a letter can never be re-addressed by anyone, which is the
property the original check exists to guarantee. `bond_id` and `sent_at` get
the same treatment.

## RLS and grants

```sql
alter table bonds enable row level security;
revoke all on bonds from anon;

drop policy if exists bonds_select_member on bonds;
create policy bonds_select_member on bonds
  for select to authenticated
  using (lower_id = auth.uid() or upper_id = auth.uid());

-- No insert/update/delete policy at all. Only the security definer functions
-- write this table.
revoke insert, update, delete on bonds from authenticated;
```

**The insert policy on `letters` is relaxed for held letters:**

```sql
with check (
  sender_id = auth.uid()
  and (receiver_id = current_partner_id()
       or (receiver_id is null and current_partner_id() is null))
)
```

Held letters are restricted to people with no bond, matching the case that
motivated them. A bonded person sitting on an unsent letter is a different
feature and is out of scope.

**Insert column grants, which do not currently exist:**

```sql
revoke insert on letters from authenticated;
grant insert (sender_id, receiver_id, message) on letters to authenticated;
```

This is required — without it a client could set `bond_id` itself and file a
letter into someone else's chapter. It also closes a pre-existing gap: the
update path is locked down tightly by `revoke update … grant update (…)`, but
the insert path never was, so Supabase's default table grant currently lets a
client set `is_public`, `share_slug` or `sender_archived_at` at insert time.

**`letters_select_participant` does not change.** `bond_id` is organisational
and never a permission. Who may read a letter remains exactly "the sender or
the receiver, unless they deleted it". This is what makes decision 2
enforceable rather than merely honoured by the UI: the chapter model is
structurally incapable of granting access.

## Migration

The owner confirmed on 2026-09-13 that all current rows are test data and may
be discarded. There is therefore **no backfill**, which removes the one part of
this design that could not have been made safe — `started_at` and `ended_at`
for historical bonds are not recoverable from letter dates, and any inferred
value would have been a fabrication presented as history.

```sql
delete from letters;
update profiles set partner_id = null, invite_code = new_invite_code();
```

Do **not** delete rows from `profiles`. `profiles.id` references
`auth.users on delete cascade`, and `handle_new_user` only fires on *insert*
into `auth.users` — so a deleted profile row leaves a signed-in account with no
profile and no way to recreate one. To start fully clean, delete the test users
from Supabase → Authentication → Users, which cascades correctly.

After this runs, both accounts are unbonded with fresh invite codes, and the
first redemption creates the first bond row.

## Repository contract

Bonds get their own repository rather than joining `ProfileRepository`: their
lifecycle is independent of either person's profile, and they outlive both.

```ts
interface Bond {
  id: string
  partnerId: string | null   // null once that person deletes their account
  partnerName: string        // frozen for past chapters, live for the current one
  startedAt: string
  endedAt: string | null     // null = the live bond
  // Resolved per caller: the repository reads whichever of lower_seen_end_at /
  // upper_seen_end_at belongs to this user. Callers never see the other side's.
  seenEndAt: string | null
  // Letters in this chapter the CALLER can still see — their own deletes are
  // already excluded, so the count matches what opening the chapter shows.
  letterCount: number
}

interface BondRepository {
  list(userId: string): Promise<Result<Bond[]>>   // current + past, newest first
  unlink(userId: string): Promise<Result<Profile>>
  acknowledgeEnd(userId: string, bondId: string): Promise<Result<void>>
}
```

`LetterRepository` gains three methods:

```ts
listHeld(userId: string): Promise<Result<Letter[]>>
sendHeld(letterId: string, userId: string): Promise<Result<Letter>>
listChapter(userId: string, bondId: string): Promise<Result<Letter[]>>
```

and **changes the meaning of two without changing their signatures**:
`listConversation` and `listArchived` are now scoped to the caller's current
bond rather than to every letter they participate in. This is the central
semantic change of the feature and the thing most likely to be missed when
reading a diff, so it is documented at the interface in `src/data/types.ts`,
not only here.

Neither returns held letters. A held letter has no `bond_id`, so it is in no
chapter by definition; `listHeld` is the only way to reach one. An unbonded
person therefore sees an empty `listConversation` and a populated `listHeld`,
which is what the home screen renders as the Unsent section.

Writing with no bond reuses `send` with a null `receiverId` rather than adding
a `hold` method — it is the same act, and one code path means one set of
validation.

All new methods obey the existing hard constraints: they return
`{ data, error }` and never throw, every Supabase body goes through `guard()`,
results are narrowed with `=== null` / `!== null` and never by truthiness, and
read methods return copies rather than references into the store.

## Mock parity

This is the largest piece of work in the feature, and the one most likely to be
under-estimated. `CLAUDE.md` states the rule: **the mock has no RLS, so
whatever the database enforces with a policy, the mock must reimplement in
TypeScript.** Five invariants now live in SQL and must be mirrored:

1. One open bond per person.
2. Chapter scoping on `listConversation` and `listArchived`.
3. Held letters only while unbonded.
4. `receiverId` fillable exactly once, never re-pointed.
5. Past chapters are read-only.

If any of these exists only in SQL, development and production behave
differently — the exact failure class that produced the missing-columns bug on
2026-09-13, where the app ran happily against a schema that did not match it.

The mock gains a `bonds` array seeded with one open bond between Jee and Ishan,
and the three seeded letters are assigned to it.

## Testing

Logic-level only, against the mock, per the existing constraint. No component
tests, no hook tests, no jsdom.

**The existing 42 contract cases must pass unchanged.** They assert on seeded
data, and all three seeded letters belong to the seeded bond — so if chapter
scoping is implemented correctly, `listConversation` returns exactly what it
returns today. A break in the 42 means the scoping is wrong. They become a
regression net at no cost.

New cases cover what the 42 structurally cannot:

- Unlinking closes the bond, archives both sides, and issues both people new
  invite codes.
- A held letter is invisible to everyone but its author.
- `sendHeld` fills `receiverId` once and refuses a second attempt.
- `sendHeld` refuses when the author has no bond.
- A held letter keeps its original `createdAt` after being sent.
- Past-chapter letters never appear in `listConversation` or `listArchived`.
- Re-bonding the same person produces a distinct chapter rather than merging
  with the earlier one.
- A letter cannot be created with a `bondId` the caller chose.

## UI surface

**`/settings`** — a new route. Ending a bond is destructive and permanent, and
the header holds only a wordmark, "Write a letter" and "Sign out"; a top-nav
slot is the wrong home for it. Settings holds your name (currently only
settable once, at `/setup`), who you are bonded to, **End this bond**, and Sign
out, which moves down out of the header. The confirmation states what is and
is not lost: B keeps every letter, and both people can bond with someone else.

**`/chapters` and `/chapters/:bondId`** — the list shows one row per past bond:
frozen name, letter count, and when it ran. The detail view is the existing
`LetterCard` grid, read-only. The header link appears only when at least one
past bond exists, so a first-time user never sees it.

**Read-only falls out of the model rather than being policed.** A past-chapter
letter keeps Share and Delete — both concern your own copy — and loses the
Archive / "Move back" toggle entirely. This is not an added rule: with
`listConversation` scoped to the current bond, un-archiving a past letter would
make it appear in neither home nor archive. Removing the control is the honest
UI for what the data already says, and the re-addressing half is enforced in
the trigger regardless.

**Held letters** — unbonded home currently shows "Just you so far" and the
invite link. It gains a working compose entry and an **Unsent** section
beneath, each letter showing the date it was written. After bonding, each held
letter offers "Send to C" individually — never in bulk, because sending a
letter written about someone else to someone new is a decision to take one at a
time.

**The ended-bond notice** — a banner on home when a bond ended and this side's
`seenEndAt` is null: *"Your bond with A ended. Your letters are in Past
chapters."* Dismissing calls `acknowledgeEnd`, so it is remembered across
devices rather than living in `localStorage`.

All of it within the existing design constraints: the fixed palette, never pure
white or pure black, the three type roles, `max-w` caps rather than fixed
widths, and animation through the single `<MotionConfig reducedMotion="user">`
with no per-component guards.

## Out of scope

Named explicitly so they are decisions rather than omissions:

- Mutual-consent breakups.
- Held letters while bonded.
- Chapter renaming, export, or deletion as a unit.
- Any notification when someone bonds with you.
- Anything that copies or moves a letter between chapters.
- Revoking public share links when a bond ends. `get_public_letter` checks only
  the delete columns, deliberately — the README records that archiving must not
  revoke links, and a breakup is an archive event. A shared letter stays shared
  through a breakup. **If that is wrong, it is a separate decision and belongs
  in its own change.**
- The `break-words` fix from `2026-09-10-responsive-audit.md`, still
  outstanding and unrelated.

## Risks

**The five mock invariants are the whole risk.** SQL enforcement is testable
only against a live database, and the contract suite runs against the mock
alone. Every invariant that exists in one and not the other is a production
divergence waiting to happen, and this design adds five at once.

**`/settings` introduces name editing**, which the app has never supported
after setup. `updateName` already exists and `grant update (full_name)` already
permits it, so this is UI only — but it is new behaviour arriving as a side
effect of a different feature, and should be reviewed as such.

**This is a large phase**: a new table, four changed SQL functions, a new
trigger exception, a third repository, substantial mock work, and three new
routes. If it needs splitting, the seam is *bonds + unlink + past chapters*
first and *held letters* second — held letters are the only part requiring the
trigger exception and `send_held_letter`.
