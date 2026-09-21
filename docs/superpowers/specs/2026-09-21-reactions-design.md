# Reactions — design

**Date:** 2026-09-21
**Status:** proposed, not implemented. Every statement of SQL in this document
is unexecuted.

## The problem

Backlog item 3: "a quiet acknowledgment the reader can leave on a letter."
The backlog flags it as needing a deliberate shape check before building,
because a chat-style emoji bar is the default instinct and is probably wrong
for this app's voice — see decision 5 in
`2026-09-14-composer-delivery-reading-design.md`: "this is a letter app, not
a chat."

Nothing travels back to a writer today. `is_read` exists, but `unread` is only
ever true for a letter *you* received, so the sender is never told their letter
was opened. This is the first signal that ever goes the other way.

## What was decided, and why

**1. One wordless acknowledgment, not a vocabulary.** A single gesture on the
whole letter meaning "this reached me". Rejected: a small set of named
feelings, which is the chat reaction bar in nicer clothes; a positional mark
on a specific line, which carries more but needs text-offset anchoring that
re-flowing text on a phone makes genuinely hard; and a few words back, which
is a second writing surface and a short walk from a reply.

**2. It is found, not announced.** No toast, no notification, no count. The
writer notices it the next time they look at their own letter. Rejected:
reusing Phase 9's new-letter toast, which exists and would have been nearly
free — but a letter app that pings you is a step toward exactly the chat feel
decision 5 pushed away from. This decision is why the phase needs no
notification machinery at all.

**3. Reversible.** Tap again to unfold. Rejected: permanence, which would match
how delete and send already work here, but a quiet gesture has no natural place
to hang a two-step confirm without becoming ceremonious, and a misclick would
be unrecoverable. Accepted cost: the writer can see a mark appear and later
vanish, which the permanent version could not inflict.

**4. The gesture is a turned-down corner.** The reader dog-ears the page, the
way you fold a corner you want to find again. It is the one physical gesture
that means *this one mattered* without meaning *I reply*, and it is inherently
reversible — you unfold it — so the undo reads as physical rather than as an
edit. Rejected: a pressed flower, which collides directly with the In Bloom
theme so "the reader added a sprig" and "the writer chose the flowery
stationery" would be ambiguous on the same page; and a mark beside the
postmark, which reads as a status badge — closer to a read receipt than to a
gesture.

**5. Only the receiver may fold, and only in the current conversation.** The
writer sees the fold on their own letter but has nothing to press; it is not
theirs to fold. Past chapters and the archive display an existing fold but
offer no control — `LetterCard` composes the fold wherever it renders for a
participant, so display follows the letter while the control follows the
conversation.

**6. A fold outlives the bond, like the letter under it.** Phase 3b decided a
letter survives a breakup and survives its author's account deletion, moving
quietly into a past chapter with the departing name frozen onto it. The fold is
a column on that row and needs no special handling: it persists, it is still
shown, and nobody can add or remove one afterwards because the control is gone.
Nothing in `unlink_partner` or `freeze_profile_letters` touches it, which is
also why the trigger clause sits outside the `security definer` wrapper.

## Data model

```sql
alter table letters add column if not exists acknowledged_at timestamptz;
```

Nullable, unbackfilled, null meaning "not acknowledged" — the same shape as
`salutation`, `body_font` and `theme`, and for the same reason: every letter
already written must keep reading exactly as it reads now.

**A column, not a table.** One person leaves one mark on one letter, so a
`reactions` table would buy multiple reactors, multiple reaction types and a
history, none of which this shape has. A timestamp rather than a boolean
because "when" is free and may matter later.

**Types** (`src/data/types.ts`): `acknowledgedAt: string | null` on `Letter`.
`PublicLetter` is deliberately UNCHANGED — see Sharing below.

## Enforcement

**`is_read` is the exact precedent and should be followed line for line.** It
is a receiver-only column: it sits in the update column grant, and
`enforce_letter_update` guards it with

```sql
  if new.is_read is distinct from old.is_read
     and auth.uid() is distinct from old.receiver_id then
    raise exception 'ONLY_RECEIVER_MAY_READ';
  end if;
```

`acknowledged_at` gains the mirrored clause raising
`ONLY_RECEIVER_MAY_ACKNOWLEDGE`. Like `is_read`'s, it sits OUTSIDE the
`if current_user = 'authenticated'` wrapper, because no `security definer`
function writes this column — `unlink_partner` and `freeze_profile_letters`
never touch it. `is distinct from`, not `<>`: null is the common value on both
sides, and `<>` would yield NULL, which is falsy, so the guard would silently
permit.

**Grants.** `acknowledged_at` joins the UPDATE column grant in `policies.sql`.
It does NOT join the INSERT grant — a letter cannot arrive pre-acknowledged.
Column grants are checked before RLS, so without the update grant the trigger
would be perfectly correct and the feature dead. This is the failure class
Phase 8's build record describes costing a long session — `message`,
`salutation` and `body_font` had never been grantable for UPDATE, because
nothing had ever been editable.

**The database enforces receiver-only and nothing more.** "Current conversation
only" is held by where the control is offered: the Archive and Chapters routes
render no button. A determined client could still mark an archived letter, and
the effect is a fold on a letter nobody is looking at.

Rejected: enforcing bond-open and not-archived in the trigger as well. It is
three rules the mock must reimplement exactly, and mock/database divergence is
the failure this project keeps hitting — Phases 3, 6 and 10 all record a
version of it. Unlike `receiver_id`, which was a real attack surface, this
gesture has no security consequence, so the extra rules buy tidiness at the
cost of the divergence risk `CLAUDE.md` warns about hardest.

**Mock parity** (`CLAUDE.md`: the mock has no RLS): `mockRepository` must
reject a fold by anyone but the letter's receiver, reproducing the trigger in
TypeScript.

## Repository

```ts
setAcknowledged(letterId: string, userId: string, acknowledged: boolean): Promise<Result<Letter>>
```

It takes `userId` deliberately, exactly as `setArchived` and `deleteForMe` do,
so the mock can reimplement the receiver-only rule. `setShared` is the one
method in this interface that does not take one, and the Phase 3 carry-over
records it as the single place the mock is knowingly weaker than the database.
This is not the place to repeat that.

The Supabase adapter writes `new Date().toISOString()` or `null`, inside
`guard()` like every other method, returning `{ data, error }` and never
throwing.

## The hook

`useLetters` gains `setAcknowledged(id, acknowledged)`, following `markRead`
rather than `setArchived`:

- **Optimistic**, so the fold appears the instant it is pressed, reverting on
  failure.
- **`lettersRef` written synchronously BEFORE `setLetters`**, never inside a
  functional updater — the ordering rule that file documents at length, because
  an updater is not guaranteed to run before `load()`'s `Promise.all` reads the
  ref, especially under the mock's zero latency.
- **Takes the `mutating` guard**, so a 30-second poll cannot overwrite the
  optimistic write.
- **Never calls `setError`.** It returns `{ ok, error }` and surfaces through
  the existing `Toast`, following the reasoning already written into
  `setShared`: the routes early-return on a page-level error, so `setError`
  would replace the entire grid with one line of text over a failed corner
  fold. `Inbox` already owns toast state, so this adds no new surface.

## The gesture

**The control is a button in the modal's action row**, beside Archive, Delete
and Share — a heart, outline when untouched and filled when loved, labelled
"Love this letter".

**The heart is the verb; the turned-down corner is its trace.** Revised after
looking at the built feature: the corner mark reads well on the page, but a
fold glyph on the button did not say what pressing it meant. A heart does.
Note this does not reverse decision 1, which rejected "a small fixed
vocabulary" of named feelings as the chat reaction bar in nicer clothes — one
heart is not a vocabulary, it is still exactly the single wordless gesture
decision 1 chose. What changed is only how the control names that gesture.

Rejected, deliberately: rendering a heart ON the letter. That is the chat
reaction this app keeps declining, and it would put an emoji on a page whose
whole design argument is restraint. What the reader leaves behind is still a
dog-eared corner. Also rejected: animating the fill, which would need a
reduced-motion story the existing `whileTap` scale already provides, and
would read as a like-button pop.

Rejected: tapping the corner itself, which is the prettier interaction but puts
a ~28px target below the 44px minimum Phase 7 established, and `CLAUDE.md`
records a whole class of defect from controls that look inert. The corner is
the result; the button is the control, exactly as archiving is a button whose
result is the letter moving.

**Noted during the final whole-branch review:** the 44px argument above does
not survive its own implementation — the shipped button is `p-1.5` around an
18px glyph, roughly 30px, matching the three buttons beside it, not 44px. The
conclusion still stands (a button in the action row is right; widening one of
four would have been worse than leaving all four narrow), but the stated
reason for rejecting the corner-tap alternative is internally inconsistent
with what shipped. The original reasoning is left as written; the whole
action row wants a tap-target pass at some point (see the Phase 3 carryover
doc).

**The button renders only when `letter.receiverId === userId`**, so the UI and
the trigger agree by construction.

**The fold renders at bottom-left**, on the inbox card and the opened sheet.
The card is the important one: that is the found-not-announced moment, noticed
while scanning the timeline rather than delivered as an event.

**Bottom-left, chosen for forward compatibility rather than necessity.** On
this branch only top-right is occupied — the modal's close button and the
card's unread dot — so three corners are free. Bottom-left is picked because
the unmerged `phase-10-letter-themes` puts an ornament at top-left (In Bloom)
and another at bottom-right (Sealed); taking bottom-left now means the two
phases do not fight over a corner whenever themes land.

**Drawn from the palette only** — the flap in `--color-paper-app` (the page's
reverse, a shade off the letter tone) with `--color-paper-edge` as the crease.
No new hex value, consistent with the theme ornaments. If it animates at all it
animates through the single `<MotionConfig reducedMotion="user">` in
`src/app/App.tsx`, never a per-component guard.

## Sharing

**The fold does not render on the public page, and `get_public_letter` does not
return the column.** A stranger holding an unlisted link should not learn that
a letter was privately marked.

The boundary is enforced by call-site composition rather than by a prop that
must remember to be false: `LetterModal` and `LetterCard` pass the fold to
`PaperTexture`, and `PublicLetter` simply does not.

The contract suite already carries a sorted key-set assertion on `getBySlug`
(`contractTests.ts`, the `Object.keys(data!).sort()` check). Leaving
`PublicLetter` unchanged means that existing test — which predates this phase —
is what stops this field ever leaking to the public view.

## Testing

Logic-level only, contract suite against the MOCK ONLY, no seeding harness —
all standing decisions, unchanged.

- The receiver folds; `acknowledgedAt` reads back non-null.
- Unfolding returns it to null.
- **The sender is refused.** This is the mock reimplementing the trigger, and
  it is the most valuable test in the phase.
- The public view carries no trace of it.

## What's out of scope

- Any notification, toast, badge or count (decision 2).
- Multiple reactions, reaction types, or a reaction from anyone but the
  receiver.
- Acknowledging from the archive or a past chapter.
- A letters-exchanged counter on Settings — a separate backlog item, and
  pulling it in here would widen this phase for no gain.

## Independence from Phase 10

**This phase branches from `main` and does not depend on
`phase-10-letter-themes`.** The two can merge in either order.

The fold needs one small thing that `main`'s `PaperTexture` lacks: a slot for
decoration that resolves against the paper rather than against the padded text
column. `PaperTexture` renders two nested divs — an outer
`relative overflow-hidden` one carrying the caller's padding, and an inner
`relative` wrapper holding the children — so anything passed as a child
resolves against the *content box*, and because positioned descendants paint
above in-flow text, it would draw **over the letter's words**. A fold at a
corner hits this exactly as a theme ornament would.

So this phase adds the slot itself:

```tsx
interface PaperTextureProps {
  children: ReactNode
  className?: string
  /** Edge decoration that must resolve against the paper, not the padded
      content column. Rendered inside the outer relative/overflow-hidden div,
      after the texture layer and before the content wrapper — so an inset
      means inset from the paper edge, and it paints beneath the words. */
  ornament?: ReactNode
}
```

This is a containing-block fix, not theme logic, and it stands on its own
merits.

**Known cost, stated plainly:** `phase-10-letter-themes` adds an identically
named and identically shaped `ornament` prop to the same file. Whichever branch
merges second will hit a small textual conflict in `PaperTexture.tsx` that
resolves by keeping one copy — the two implementations are the same code. The
same is true of the doc comment. That is a two-minute resolution, and it is the
price of the two phases being independently mergeable, which is worth more.

## Migration status

`schema.sql` and `policies.sql` would carry the new column, the trigger clause
and the update grant. On this branch that is a fourth unapplied migration, on
top of Phases 6, 7 and 8. (Phase 9's `letters_bond_created_idx` and Phase 10's
`theme` column are also unapplied, but they live on other branches and are not
this phase's concern.) None of it has been executed against the live project,
and there is no Postgres harness here to execute it with.

**Deploy order is not free**, the same as Phase 10: the SQL must run before the
client that writes the column deploys.

## Sub-project

Small enough to be a single sub-project — one column, one trigger clause, one
grant, one repository method, one hook method, one button and one ornament. No
further decomposition needed before the implementation plan.
