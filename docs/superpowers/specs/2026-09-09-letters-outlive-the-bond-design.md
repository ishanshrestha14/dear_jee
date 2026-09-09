# Letters Outlive the Bond — Design Spec

**Date:** 2026-09-09
**Status:** Approved for planning
**Builds on:** `docs/superpowers/specs/2026-09-08-dear-jee-design.md`
**Supersedes:** the v1 decisions "no sent folder" and "letters are deleted with
their author"

---

## 1. Why

Three problems with the app as shipped through Phase 3.

**Letters die with their author.** Both `letters` foreign keys are `on delete
cascade`, so one person deleting their account destroys every letter in both
directions — including the other person's. One person can erase the other's
memories, silently and unrecoverably. This was recorded as a deferred risk in
the Phase 3 carry-over doc; it is now the main thing being fixed.

**A breakup has no shape.** Unlinking leaves the correspondence sitting in the
inbox with the ex's name resolving to blank, because the `profiles` select
policy only admits you and your *current* partner. There is no way to put
letters away without destroying them.

**The pairing error lies.** `link_partners` raises `ALREADY_LINKED` both when
*you* have a partner and when the *code's owner* does, so someone opening a
spent invite link is told they are already connected to someone when they are
not connected to anyone.

A fourth change rides along, because it touches the same reads: a letter you
sent is invisible to you. For an app about affirmations, re-reading what you
wrote is part of the point.

## 2. Decisions

| Question | Decision |
|---|---|
| Do letters survive an account deletion? | Yes. Deleting your account removes you, not what you gave someone. |
| What happens to letters after a breakup? | They move to an archive. The inbox returns to its empty state with a quiet link. |
| Is archiving per-person? | Yes. Your choice never reaches into their view. |
| What does deleting one letter do? | Removes it from your side permanently. Their copy is untouched. |
| Can you see letters you sent? | Yes. One merged timeline, both directions. |

Two of these are asymmetric on purpose. **Archive is cheap and reversible;
delete is irreversible with no in-app recovery.** The interface must make that
difference legible in the half-second before someone taps.

## 3. Data model

### 3.1 New columns on `letters`

| Column | Type | Meaning |
|---|---|---|
| `sender_archived_at` | timestamptz, null | the sender moved it out of their view |
| `receiver_archived_at` | timestamptz, null | the receiver moved it out of theirs |
| `sender_deleted_at` | timestamptz, null | gone from the sender's side, permanently |
| `receiver_deleted_at` | timestamptz, null | gone from the receiver's side |
| `sender_name` | text, null | frozen author name, filled only when that profile is deleted |
| `receiver_name` | text, null | frozen recipient name, same |

Timestamps rather than booleans: the same storage, and "when did I archive
this" is recoverable later where a boolean throws it away.

### 3.2 Changed columns

```sql
sender_id   uuid references profiles(id) on delete set null   -- was: not null, cascade
receiver_id uuid references profiles(id) on delete set null   -- was: not null, cascade
```

Both lose `not null`. This single change is what lets a letter outlive its
author.

### 3.3 Name resolution

Names resolve **live** from `profiles` while the person exists, so someone
correcting a typo in their name updates every letter they ever wrote. A
`before delete` trigger on `profiles` writes the current name into
`sender_name` / `receiver_name` on every letter that person touched, freezing
it as it was at the moment they left. Readers use the live name when the id is
present and the snapshot when it is null.

### 3.4 Migration

`supabase/schema.sql` remains the single source of truth and stays re-runnable:
new columns use `add column if not exists`, and the foreign keys are replaced
with `drop constraint if exists` followed by `add constraint`. Re-running the
file both creates from scratch and migrates an existing project, preserving the
promise in `supabase/README.md`.

The alternative — a numbered `migrations/` directory — is more conventional but
means maintaining the schema in two places. For one database and two people,
one re-runnable file is the better trade.

## 4. Security

### 4.1 The dangerous interaction

`on delete set null` performs an **update** on `letters`, which fires
`enforce_letter_update`. That trigger currently raises `IMMUTABLE_COLUMN` on any
change to `sender_id`, so adding `set null` without changing the trigger would
make account deletion fail outright.

The trigger must permit `sender_id` and `receiver_id` to change **only to
null**, and reject every other change to them.

### 4.2 Column grants on `letters`

```sql
revoke update on letters from authenticated;
grant update (is_read, is_public, share_slug,
              sender_archived_at, receiver_archived_at,
              sender_deleted_at, receiver_deleted_at)
  on letters to authenticated;
```

Column grants are checked before RLS, so this is the control that stops a
client touching `sender_id`, `receiver_id`, `message` or `created_at` at all.
Referential actions run as the system and bypass grants, so the foreign-key
null-out still works. The trigger's immutability checks remain as a second
layer, mirroring how `profiles` is already protected.

### 4.3 Trigger ownership rules

| Column | Who may change it |
|---|---|
| `id`, `message`, `created_at` | nobody |
| `sender_id`, `receiver_id` | nobody, except a change to null |
| `is_read` | the receiver |
| `is_public`, `share_slug` | either participant |
| `sender_archived_at`, `sender_deleted_at` | the sender |
| `receiver_archived_at`, `receiver_deleted_at` | the receiver |

### 4.4 Deletion is enforced in RLS, not in queries

```sql
using (
  (sender_id = auth.uid() and sender_deleted_at is null)
  or (receiver_id = auth.uid() and receiver_deleted_at is null)
)
```

If deletion were only a query filter, "deleted" would mean "hidden from the
app" while the row stayed fetchable through the API — which is not what someone
deleting a letter believes is happening.

This is also why deletion has no in-app undo: RLS stops you reading the row.
Recovery requires the dashboard.

### 4.5 Separation archives server-side

- `unlink_partner()` sets the caller's archive timestamp on every letter with
  that partner, and the partner's own timestamp on theirs.
- The `before delete` trigger on `profiles` archives the survivor's side while
  it freezes the names.

Doing this in the database makes a breakup atomic; it cannot half-apply because
someone closed a tab.

### 4.6 Pairing errors

`link_partners` splits its overloaded exception:

| Situation | Exception | User-facing copy |
|---|---|---|
| You already have a partner | `ALREADY_LINKED` | "You are already connected to someone." |
| The code's owner is taken | `LINK_ALREADY_USED` | "That invite link has already been used." |

The second deliberately does not name the other person — a stranger's profile is
unreadable under RLS, and "already used" is the actionable fact.

## 5. Reads

`listReceived(userId)` becomes **`listConversation(userId)`**: every letter where
the user is sender or receiver, excluding ones they have archived, newest first.
Deleted letters need no filter here — section 4.4 makes them unreadable in RLS —
but the mock has no RLS, so its implementation must exclude them explicitly for
the two adapters to behave identically. The RLS select policy already permits exactly this, so there is no
security change.

A second method, `listArchived(userId)`, returns the same shape filtered to
letters the user has archived.

`markRead` stays receiver-only and unchanged. A letter you sent is never unread.

## 6. Interface

### 6.1 The timeline

One merged stream, newest first, whoever wrote it — not two tabs. Tabs would
frame the app as two mailboxes; a single stream frames it as one
correspondence.

Letters are distinguished by the author's name already on the card in the
handwriting font — hers on hers, yours on yours. No chat bubbles, no alignment
split. The unread dot stays meaningful because it only ever applies to letters
you received.

### 6.2 Archive

A route at `/archive`, same card grid, quieter heading. The timeline links to it
**only when it has something in it** — an empty archive should not advertise
itself, and a new user should never encounter the word.

### 6.3 Letter actions

At the **bottom** of the letter, below the date: two small text buttons in muted
ink. The top-right corner stays reserved for Phase 4's share control, and the
PRD is explicit that reading should feel undisturbed.

- **Archive** — one tap, reversible. From `/archive` the same control reads
  **Move back**.
- **Delete** — a two-step inline confirm: the button becomes "Delete this letter
  permanently?" with **Delete** / **Cancel**. Not a browser `confirm()`, which
  would be jarring and off-brand.

### 6.4 After a breakup

The timeline shows the existing "Just you so far" empty state with a fresh
invite link, plus one quiet line: *"Your letters with them are in the archive."*

## 7. Testing

Logic-level only, per the project's standing decision. No component or hook
tests.

The repository contract suite gains cases. As established in Phase 3, the suite
runs against the **mock only** — it asserts on seeded data, so pointing it at a
fresh Postgres would fail for want of a seeding harness rather than for want of
correctness. The Supabase adapter is verified by reading it against the mock and
by manual walkthrough. Do not build a seeding harness as part of this work.

| Case | Guards against |
|---|---|
| a sent letter appears for its sender | the retired v1 rule being half-remembered |
| archiving removes it from the timeline | — |
| archiving does NOT affect the other side | "per-person" implemented as "for both" |
| unarchiving restores it | — |
| deleting removes it from your side only | the same asymmetry, permanently |
| a deleted letter is unreadable to the deleter | RLS enforcement, not just filtering |

"Per-person" implemented accidentally as "for both" is the defect most likely to
ship here, and the pair of cases above is what catches it.

## 8. Out of scope

- **`get_public_letter` does not consider the new columns.** A letter shared and
  later deleted by one party would still resolve by slug. Nothing calls it —
  sharing is Phase 4 — so Phase 4 owns this, recorded here rather than
  forgotten.
- No UI for `unlink_partner()`. The function exists; exposing it is separate.
- No bulk archive, no search, no export.
- Realtime, multiple letter fonts, Vercel deployment — unchanged, still later.
