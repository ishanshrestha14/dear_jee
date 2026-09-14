# The composer, live delivery, and the reading view — design

**Date:** 2026-09-14
**Status:** proposed, not implemented. Every statement of SQL in this document
is unexecuted.

## The problem

Seven complaints, from using the app rather than from reading the code:

1. The letter's salutation is fixed to the partner's account name.
2. Starting a letter is a one-way door — there is no way to back out.
3. A letter that arrives while you are looking at the home page does not appear
   until you reload.
4. The reading view is plain.
5. Every letter is set in the same face.
6. There is nowhere to choose that face while writing.
7. There is no attribution anywhere in the app.

They are not one project. This spec covers four, in the order they should be
built:

- **A — the composer.** Salutation, font, cancel. Small, self-contained, but it
  changes the data model.
- **B — live delivery.** Letters arriving without a reload. The one with real
  failure modes.
- **C — the reading view.** Best done last, once A has stopped changing what a
  letter contains.
- **D — the footer.** A line of attribution. Independent of the other three and
  the smallest thing here; listed so it is not lost.

## What was decided, and why

Seven decisions were taken in conversation on 2026-09-14.

**1. The salutation is per letter, stored with it.** Not an app-wide rename.
"Dear Jee" appears both as the header wordmark (`Layout.tsx:26`) and as the
composer's greeting (`ComposeLetter.tsx:38`); the greeting is the one that
should be editable. A letter carries how it addressed someone, forever, the
same way it carries its words.

**2. The three-type-role constraint is deliberately amended.** `CLAUDE.md`
states *"Three type roles only: Plus Jakarta Sans (`font-ui`), Lora
(`font-letter`), Caveat (`font-hand`)"*. That rule is being changed on purpose,
not broken by accident. See **Constraint amendment** below — this is the part
most likely to be "fixed" back by a future session that reads the rule and sees
five fonts.

**3. Five letter fonts, one per mood.** Lora (warm, printed — the default),
EB Garamond (older, formal), Courier Prime (typewritten), Caveat (quick hand),
Dancing Script (flowing hand). Three new families. Rejected: adding eight, on
the grounds that several would read alike to most eyes while costing five new
families to load and maintain.

**4. Cancel asks before discarding, and only when there is something to lose.**
An empty letter closes silently; a started one prompts. Rejected: keeping a
local draft, because a draft that resurfaces weeks later addressed to someone
you have since unbonded from is a worse problem than the one it solves.

**5. Delivery is visibility-aware polling, not a websocket.** Refetch every 30
seconds while the tab is visible, immediately on refocus, never while hidden.
Rejected: Supabase Realtime, for three reasons — it needs replication enabled
in the dashboard, which is a silent-failure step this project has now been
bitten by twice (unset env vars, an unapplied migration); the mock would need a
fake event emitter to stay honest; and a dropped socket on mobile means
silently stale data unless polling is added underneath anyway. This is a letter
app, not a chat: half a minute is not the constraint.

**6. The reading view leans on the physical metaphor.** A fold crease, a
deckled edge, generous margins, the date as a postmark. Rejected: an
envelope-unfolding animation, which would have to degrade to nothing under
`prefers-reduced-motion` and would grow tiresome on a second reading.

**7. The reading view is extracted and shared.** One `LetterSheet` renders the
letter for the recipient and for a stranger on the public page.

---

# Sub-project A — the composer

## Data model

```sql
alter table letters add column if not exists salutation text;
alter table letters add column if not exists body_font  text;

alter table letters drop constraint if exists letters_body_font_known;
alter table letters add  constraint letters_body_font_known
  check (body_font is null or body_font in
    ('lora', 'eb-garamond', 'courier-prime', 'caveat', 'dancing-script'));

alter table letters drop constraint if exists letters_salutation_length;
alter table letters add  constraint letters_salutation_length
  check (salutation is null or char_length(salutation) between 1 and 60);
```

**Both columns are nullable and null means "unset, use the default."**
`salutation` null renders the recipient's name exactly as today; `body_font`
null renders Lora. This is not laziness — every letter already in the database
will have nulls in both, and they must keep looking precisely as they look now.
A non-null default would rewrite the appearance of existing correspondence.

**Both are immutable once written.** `enforce_letter_update` already refuses
changes to `message`, `created_at` and `id` — a letter cannot be rewritten
after sending. These two belong in that same check. Without it, someone could
change how a letter addressed a person after they had read it.

**Insert grants widen.** `policies.sql` currently has
`grant insert (sender_id, receiver_id, message) on letters to authenticated`.
It becomes `grant insert (sender_id, receiver_id, message, salutation,
body_font)`. The writer sets both at insert time and never again — the grant
and the trigger together are what make that true.

**`get_public_letter` must return both.** Its return type gains `salutation`
and `body_font`, and `PublicLetter` in `src/data/types.ts` gains them too.
Without this a shared letter loses its salutation and its face for the stranger
reading it — who is the reader the font choice is most visible to, and the one
the sender chose it for.

## Validation, in three layers

`body_font` reaches a `style` attribute, so an unconstrained string is a small
injection surface. It is constrained three times, and each layer exists because
the one above it can be bypassed:

1. **TypeScript** — `type BodyFont = 'lora' | 'eb-garamond' | 'courier-prime' | 'caveat' | 'dancing-script'`, exported from `src/data/types.ts`.
2. **`validateLetter`** in `src/lib/validation.ts` — rejects an unknown font and
   an over-long salutation, producing the user-facing copy.
3. **The check constraint** — the only layer a client cannot get around.

The mock must enforce layers 1 and 2 *and* reimplement layer 3 in TypeScript,
per the standing rule that whatever the database enforces with a constraint the
mock reimplements, or the two behave differently.

## Font loading

`src/design/fonts.ts` is imported eagerly from `src/main.tsx`, so every
`@font-face` declaration it contains ships to everyone — including a stranger
opening a public letter on mobile.

**The three new families are dynamically imported, not added to that file:**

```ts
await import('@fontsource/courier-prime/400.css')
```

The existing three stay eager because the app chrome uses them. The new three
load only when a letter actually calls for one. A stranger opening a Lora
letter downloads nothing extra; one opening a Courier Prime letter downloads a
single family.

This preserves Phase 5's work, which got a stranger's first load to 133 kB
gzipped and is the reason the public route was split at all.

Browsers do not fetch a `.woff2` until text renders in that face, so declaring
the faces eagerly would "only" cost CSS. That is still the wrong trade: the CSS
bundle is already 51 kB, every byte of it on the public route's critical path,
and three more families of subset declarations is real weight for a face most
letters will not use.

## The composer

- **The salutation is an inline editable field inside the "Dear ___," line**,
  not a separate labelled input above the letter. It should read as part of the
  letter, because it is. Placeholder is the recipient's name, so leaving it
  untouched produces today's behaviour.
- **The font picker sits at the bottom**, beside the word count, each option's
  name set in the face it selects — the only honest way to show a font.
- **Cancel sits beside Send.** With an empty letter it navigates away silently.
  With text, it asks: *"Discard this letter?"* / Discard / Keep writing. The
  confirmation reuses the two-step inline pattern `LetterModal` already uses
  for Delete rather than introducing a dialog.

## Mock parity

The mock's `send` must reject an unknown `body_font` and an over-long
`salutation` with the same messages the database's constraints will produce,
store both fields, and return them on reads. New contract cases:

- a letter stores and returns its salutation and font
- a null salutation and null font read back as null, and existing seeded letters
  are unaffected
- an unknown font is rejected
- a salutation over 60 characters is rejected
- `getBySlug` returns the salutation and font, so the public page can render them

---

# Sub-project B — live delivery

## Shape

A `usePoll(callback, intervalMs)` hook in `src/hooks/`, used by `useLetters`:

- refetch every 30s **only while `document.visibilityState === 'visible'`**
- stop entirely when hidden — no timers running in a backgrounded tab
- refetch immediately on becoming visible again

The refocus refetch is the part that will actually be felt. The interval is the
safety net.

## Two bugs this forces into the open

**1. The captured open letter goes stale.** `Inbox.tsx` and `Archive.tsx` hold
the open letter as a captured object (`const [open, setOpen] =
useState<Letter | null>`). Nothing currently reloads underneath it, so that is
safe today. Polling replaces the list while the reader is mid-letter, and
`open` becomes a snapshot that no longer matches the store.

This is the same bug the codebase already fixed once for sharing — both
`Inbox.tsx` and `Archive.tsx` carry a comment explaining why `sharing` is
*derived* from the list rather than captured. `open` must become derived in the
same way. Polling is what makes the latent bug live.

**2. Polling can clobber the optimistic read receipt.** `markRead` flips
`isRead` optimistically before the write lands. A poll completing mid-flight
overwrites it with the pre-write server value, and the unread dot flickers back
on a letter the reader has open. The poll must not apply while a mutation is in
flight.

## Scope

Polling runs on the home and archive lists only. **Not** on `/chapters` — a
finished relationship gains no letters. **Not** on `/settings`. **Not** while
signed out. No spinner, no "checking…" indicator: a letter should simply be
there, the way post arrives.

A poll refreshes whatever `useLetters.load` already fetches — the conversation,
the archive and the held letters — because they share one call. That is fine;
held letters change only by the reader's own action, so a refresh is a no-op
for them.

**A failed poll is silent and changes nothing on screen.** It must not blank the
list, and it must not set the page-level error. Two reasons, and the second is
the one this project keeps relearning: a background refresh failing is not
something the reader did or can act on, and an error banner that appears on a
30-second timer while someone is reading a letter is worse than no banner. The
last good list stays. This is deliberately the opposite of the rule applied to
*foreground* failures elsewhere in the app, where a fault must never render as a
benign state — the difference is that a poll has a last-known-good answer to
fall back on and a first load does not.

## Expect a fourth lint warning

`usePoll` will use the same `set-state-in-effect` shape as the three accepted
warnings in `useLetters.ts`, `usePublicLetter.ts` and `useBonds.ts`. Name it in
the commit body; do not silence it, do not add an `eslint-disable`, and do not
restructure to dodge it. The accepted count becomes **four**.

## Mock parity

Free. Polling is `load()` on a timer and behaves identically against both
implementations. That was the deciding argument over a websocket.

---

# Sub-project C — the reading view

## Extract `LetterSheet`

The same letter is rendered in four places: `LetterModal` (used by `Inbox`,
`Archive` and `Chapter`) and `PublicLetter`. The markup is duplicated between
the modal and the public page and has already drifted — different spacing, and
the public page lacks the chrome.

`LetterSheet` in `src/components/` takes presentation props only — salutation,
body, font, author, recipient, date — and imports no values from `src/data/`,
satisfying the architecture rule. Both callers render it.

Applying the redesign to only the modal would leave a stranger reading a
plainer letter than the recipient does, which is backwards: the public page is
the one a person chooses to show someone.

## The paper

- **A fold crease** across the sheet — a soft horizontal seam built from
  `--color-paper-edge` and an inset shadow. No new colours.
- **A deckled edge** on the sheet's outer border, replacing the clean rectangle.
- **Wider margins**, so text sits in from the edge as on real correspondence.
  This also shortens the measure, which helps reading.
- **The date as a postmark** near the signature, rather than a caption beneath
  it.
- **The body renders in the letter's chosen font.** This is where sub-project A
  pays off: a Courier Prime letter and a Dancing Script letter become visibly
  different objects.

**Exactly what the chosen font applies to**, since "the letter's font" is
otherwise ambiguous: the **salutation and the body** — the prose the writer
wrote. The **signature keeps `font-hand`** (Caveat), because it stands for a
hand signing a page rather than for the letter's typesetting, and it should
stay constant across a correspondence. All surrounding chrome — buttons, dates,
counts, labels — stays `font-ui`. So a letter has at most two faces on screen:
the one chosen for its words, and Caveat for the name at the bottom.

## Two carried bugs are fixed here

Both are from `docs/superpowers/specs/2026-09-10-responsive-audit.md` and both
live in this component:

- **`break-words` on the body.** A pasted URL currently pushes the panel past a
  375px viewport. The audit named this the single most likely way a real letter
  breaks the page.
- **Tap targets.** Archive and Delete are ~16px tall; the close and share icons
  are 32–34px, against a 44px target. The row is being restyled regardless.

## Motion

None added. The crease and the edge are static CSS, so there is nothing new for
`prefers-reduced-motion` to suppress. The existing `layoutId` spring remains the
only animation, still governed by the single `<MotionConfig reducedMotion="user">`
in `src/app/App.tsx`. No per-component guard.

## `LetterCard`

The inbox preview renders its snippet in the letter's own face, so the
character of a letter is visible before opening it. Cheap, and it stops the
font choice from being invisible until someone opens the letter.

---

# Sub-project D — the footer

A single line of attribution: **Made with ❤️ by Pin3appl3ishan**.

**Where it appears.** In the app chrome (`src/components/Layout.tsx`), beneath
the `<main>` content, so it sits at the bottom of every signed-in screen — and
also on the public letter page (`src/routes/PublicLetter.tsx`), beneath the
existing "Dear Jee" mark.

Including the public page is a judgment call, made on the grounds that the
point of attribution is to be seen, and that page is the one deliberately shown
to other people. **It is one line to remove if you would rather strangers not
see the handle** — say so and it comes out of `PublicLetter` while staying in
the app chrome.

**Styling.** `font-ui`, `text-xs`, `text-ink-muted`, centred, with generous top
spacing so it reads as a footer rather than as page content. No new colours and
no new type role. The heart is the emoji character, not an icon import —
`lucide-react` is already a dependency but an emoji sets the right register
here, and the codebase already uses one in the copy-confirmation toast
("Link copied! Send it to them on WhatsApp 💌").

**Not a link.** Plain text, because nothing was specified to link to and
inventing a destination would be worse than the absence of one.

**Accessibility.** The heart carries `role="img"` and an `aria-label`, so a
screen reader announces "Made with love by Pin3appl3ishan" rather than reading
the emoji's raw name mid-sentence. The same treatment the unread dot already
gets in `LetterCard`.

**`Layout.tsx` must not gain a value import from `src/data/`** — the
architecture rule, and this change has no reason to need one.

---

# Constraint amendment

`CLAUDE.md` currently reads:

> Three type roles only: Plus Jakarta Sans (`font-ui`), Lora (`font-letter`),
> Caveat (`font-hand`).

This is now false, deliberately. `CLAUDE.md` must be updated in the same change
that introduces the fonts, to something like:

> **Three type ROLES only** — `font-ui` (Plus Jakarta Sans), `font-letter`, and
> `font-hand` (Caveat). The `font-letter` role is user-selectable per letter
> from a fixed set of five: Lora (default), EB Garamond, Courier Prime, Caveat,
> Dancing Script. No other family may be added without amending this rule, and
> the UI chrome uses only `font-ui` and `font-hand`.

Leaving `CLAUDE.md` stale is not a documentation nicety here. The rule is
enforced by every future session reading it; an un-amended rule means someone
eventually deletes four fonts as a regression.

---

# Migration

Idempotent, applied by the owner, and safe against existing data:

```sql
alter table letters add column if not exists salutation text;
alter table letters add column if not exists body_font  text;
-- plus the two check constraints, each dropped before being added
```

No backfill, and none needed: null means "the old behaviour" in both columns by
design, so every existing letter renders exactly as it does today.

`policies.sql` re-run for the widened insert grant. `schema.sql` re-run for the
constraints, the `enforce_letter_update` additions and the `get_public_letter`
signature change.

**`get_public_letter`'s return type changes**, so it needs
`drop function if exists get_public_letter(text);` before the `create or
replace` — Postgres will not replace a function whose OUT columns differ.
This is the one statement in this spec that is not simply re-runnable, and
missing it produces a confusing `cannot change return type of existing
function` error.

---

# Testing

Logic-level only, against the mock, per the standing constraint. No component
tests, no hook tests, no jsdom, no Testing Library — `usePoll` and the composer
get no tests, and that is deliberate, not an omission.

The existing 60 contract cases must pass unchanged. New cases cover the
data-model half of sub-project A only, listed above.

Sub-projects B and C add no logic-level surface and therefore no tests. Their
correctness is established by review and by the owner using the app.

---

# Out of scope

Named so they are decisions rather than omissions:

- Renaming the app itself. Decision 1 chose the salutation instead.
- Local drafts. Decision 4 rejected them.
- Realtime/websocket delivery. Decision 5 rejected it, with reasons that would
  have to be answered rather than ignored to revisit it.
- Per-letter colour, size or alignment. Font is the only presentational choice.
- A font for the signature or salutation independent of the body.
- Polling on `/chapters`, `/settings`, or while signed out.
- Fixing the pre-existing `markRead`-on-your-own-sent-letter behaviour noted in
  the Phase 6 final review.

---

# Risks

**The constraint amendment is the highest-risk item, and it is a documentation
risk.** If `CLAUDE.md` is not updated in the same change, a future session will
read "three type roles only", see five fonts, and remove four of them as a
regression — with tests passing throughout, because no test covers which font
families exist.

**`get_public_letter`'s signature change needs a drop.** A `create or replace`
alone fails. It is the only non-idempotent step, and it is easy to miss when
re-running a file that is otherwise safe to re-run.

**Polling turns a latent bug live.** The captured `open` letter in `Inbox` and
`Archive` is safe only because nothing reloads underneath it today. Sub-project
B must fix that in the same change that introduces polling, not after.

**The font choice is visible to a stranger.** Every new face is weight on the
public route's critical path if loaded eagerly. The dynamic-import decision is
what keeps that true, and it is the kind of detail that gets simplified away by
someone adding a fourth font later.
