# Scheduled delivery

**Status:** proposed, awaiting review
**Motivates:** a specific birthday, a week out

## The idea

Write a letter now, addressed to your current partner as usual, but choose a
future date it should arrive on instead of today. The recipient sees nothing
until that date — no teaser, no locked envelope, no hint. It just appears in
their inbox the way any other letter does, unread dot and all.

## Decisions

**1. Complete surprise, not a teaser.** Nothing about a pending scheduled
letter is visible to the recipient before its date — not its existence, not a
sealed placeholder. This is what "arrives" means for every other letter
already; scheduling only changes *when*, not the fact that it's a surprise
until it's there. Rejected: a locked card showing the date ahead of time —
that turns the moment of arrival into an anticlimax you can watch counting
down.

**2. Editable and cancelable until delivery.** Unlike every other letter in
this app, a scheduled one is not immutable the moment it's written — the
sender can rewrite it, change its font or salutation, reschedule it, or cancel
it outright, any time before its delivery date. Once that date arrives, it
locks exactly like a normal sent letter always has.

**3. A date, not a moment.** Scheduling picks a day, not a day and time. It
becomes visible starting midnight server-time on that day. No timezone
picker, no "exact moment" precision — a real mailed letter arrives on a day,
not a minute, and this keeps the composer to one field.

**4. A bond ending before delivery cancels it, silently, from the recipient's
side only.** If the sender's bond with that partner ends before the scheduled
date arrives, the letter never delivers — not into the (now past) chapter,
not to a later partner. The sender still sees it in their own list, labeled
as never having arrived, because they wrote it and it's theirs to see; the
person it would have gone to never knows it existed.

## Data model

```sql
alter table letters add column if not exists scheduled_for date;
```

Nullable; null means "deliver now," which is what every existing row already
does and continues to do. No other schema changes — this reuses `bond_id`,
`receiver_id`, and `sent_at` exactly as they work today. A scheduled letter is
addressed to the sender's *current* partner at write time (there must be an
open bond — this is not a held letter's "no partner yet" case, it's "a
partner, but not yet").

## Delivery: a query-time gate, not a job

There is no background process, no cron, no edge function watching the
clock. The receiver's existing RLS visibility rule gains one clause:

```sql
-- letters_select_participant, receiver disjunct, currently:
receiver_id = auth.uid() and receiver_deleted_at is null
-- becomes:
receiver_id = auth.uid() and receiver_deleted_at is null
  and (scheduled_for is null or scheduled_for <= current_date)
```

Because this lives in the SELECT policy, every existing read path
(`listConversation`, `listArchived`, `get_public_letter`) inherits it for
free — nothing about how those queries are written needs to change. The
recipient's inbox already polls every 30 seconds; the letter surfaces on the
first poll after midnight on its date, the same way any delivery already
works (Phase 7, decision 5 — this app polls, it doesn't push).

The sender's own visibility is untouched — `sender_id = auth.uid() and
sender_deleted_at is null`, no date gate — so they can always see, edit, and
cancel their own pending letter regardless of its date.

## Column grants

Column grants are checked before RLS or any trigger — it's what actually
stops a client touching a column at all, independent of whether the policy
or trigger would have allowed it. The current update grant is `is_read,
is_public, share_slug, sender_archived_at, receiver_archived_at,
sender_deleted_at, receiver_deleted_at` — it does not include `message`,
`salutation`, or `body_font` at all, because nothing has ever been editable
before now. It must widen to add those three plus `scheduled_for`, or every
edit attempt fails at the grant layer regardless of what the trigger permits.
This is the same failure class the account just spent a long debugging
session on for an unrelated delete — worth getting right the first time here.

## Editability

`enforce_letter_update` currently blocks any change to `message`,
`salutation`, or `body_font` unconditionally. It gains one exception: the
sender (and only the sender) may change `message`, `salutation`, `body_font`,
or `scheduled_for` itself, but only while `old.scheduled_for is not null and
old.scheduled_for > current_date` — i.e., only while it is both scheduled and
still pending. The moment its date arrives, or if it was never scheduled at
all, the existing unconditional lock applies exactly as it always has.

Rescheduling to a past-or-today date, or to null, is just another edit within
that window — it makes the letter immediately visible to the receiver on the
next poll, which is the correct and only meaningful effect of "un-scheduling"
something.

Canceling is not a new mechanic — it's the existing per-letter delete
(`sender_deleted_at`), which already works on any letter the sender owns,
scheduled or not.

## Bond ending before delivery

`unlink_partner()` already does bookkeeping on a closing bond's letters
(archiving, freezing names). It gains one more step: for any letter under
that bond where `scheduled_for is not null and scheduled_for > current_date`
(still pending, never delivered), set `receiver_deleted_at =
coalesce(receiver_deleted_at, now())`.

This reuses the *existing* per-side deletion column rather than inventing a
new "canceled" state:
- The receiver's side is permanently gated off — even if the same two people
  bond again later and the date passes, `receiver_deleted_at` stays set, so
  it never resurfaces.
- The sender's side is untouched, so they keep seeing it in their own list.
- The UI tells the two states apart the same way it always could:
  `receiver_deleted_at is not null` on a letter the sender is looking at
  means "the bond ended before this arrived" — a state only reachable this
  way, since the sender never sets the receiver's own delete flag.

## Repository & types

`Letter` gains `scheduledFor: string | null`. Two new repository methods,
both new surface area rather than changes to existing ones:

```ts
listScheduled(userId: string): Promise<Result<Letter[]>>
// mine, not yet delivered: sender_id = userId and scheduled_for is not null
//   and scheduled_for > today (bonded or not — bond status only matters for
//   the "cancelled" label, not for whether it shows up here)

editScheduled(
  id: string,
  message: string,
  salutation: string | null,
  bodyFont: BodyFont | null,
  scheduledFor: string | null,
): Promise<Result<Letter>>
// same validation as sendLetter (validateLetter / validateSalutation /
// validateBodyFont), then an UPDATE the trigger's new exception allows.
```

`listConversation` additionally excludes the sender's own not-yet-delivered
scheduled letters from the normal grid, the same way it already excludes
archived-by-me letters — client-side filter, mirroring the existing
`rows.filter((l) => !archivedBy(l, userId))` line.

**Mock parity, per the standing rule:** the mock reimplements the date gate
in `visibleTo`, the editability window in whatever plays the trigger's role
for the mock's `deleteForMe`/update path, and the unlink cancellation step in
its unlink function. Nothing here is Supabase-only.

## UI

**Composer:** a "Schedule for later" toggle, off by default, revealing a
single date field (today or later) when on. Off means exactly today's
behavior — nothing changes for the common case.

**A new "Scheduled" section in the inbox**, next to the existing "Unsent"
section for held letters, listing the sender's own pending scheduled
letters. Visually distinct from both a normal `LetterCard` and an Unsent
card — not a new color, just: a **dashed border** (in place of the solid
paper-edge border every other card has) and a small **calendar glyph**
beside the date, reading "Arrives {date}" instead of "Written {date}". A
letter cancelled by a bond ending shows the same dashed treatment with
"Not delivered — bond ended" in place of the date, and no Edit action (there
is nothing left to edit).

Each scheduled letter gets **Edit** (reopens the composer, pre-filled, saving
through `editScheduled`) and **Cancel** (the existing two-step delete
confirm, reused verbatim from the Unsent section's pattern).

**Recipient side:** no new code. The letter becomes an ordinary `LetterCard`
in the ordinary grid the day it arrives — the entire point of gating this at
the database layer instead of the client.

## What this deliberately leaves out

- **Exact-time delivery.** Decision 3. A future ask, not this one.
- **Recurring scheduled letters** (e.g. every birthday automatically). Not
  asked for; adds a real scheduling concept this app has no other reason to
  carry yet.
- **A notification when a scheduled letter delivers.** Same polling-discovery
  model as every other letter today; a push/email nudge is backlog item
  "Notification on delivery," tracked separately.
- **Scheduling a held letter** (no bond yet). Held letters already have their
  own "arrives whenever you send it" path (`sendHeld`); combining the two
  concepts (no partner yet, and also a future date) is not asked for and
  meaningfully complicates `set_letter_bond`'s already-careful null handling
  for no proven benefit.
