# Dear Jee

A letter app for two people who live apart. Not a messaging app — the point is
that a letter arrives, unfolds, and is read once, slowly. See `PRD.md` for the
original brief.

## Run it

```bash
npm install
npm run dev
```

With no `.env` the app runs on an in-memory mock: three seeded letters, one
unread, a signed-in user, and a linked partner. That is the normal development
mode and the whole test suite runs against it. With `.env` present it talks to
Supabase — see `supabase/README.md`.

The same fallback applies in production, which is the trap: a deployment whose
environment variables are unset does not error, it serves the mock's three
seeded letters to every visitor. `DEPLOY.md` has the click-path and the two
things that bite.

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Vitest, 60 logic-level tests across 4 files |
| `npm run typecheck` | `tsc -b` — the real type gate |
| `npm run build` | Typecheck plus production build |
| `npm run lint` | oxlint |

**`npx tsc --noEmit` checks nothing in this repo.** The root tsconfig is
`{"files": [], "references": [...]}`, so it type-checks zero files and always
exits 0. Use `npm run typecheck`.

## Where things are

```
src/
  app/         App shell and routes
  auth/        AuthProvider, useAuth — session, profile, partner
  components/  Layout, LetterCard, LetterModal, ComposeLetter, RequireAuth,
               InviteLink, ShareModal, Toast
  routes/      Inbox, Compose, AuthScreen, SetupProfile, JoinPartner,
               Settings, Chapters, Chapter, Archive, PublicLetter
  design/      tokens.css, fonts, PaperTexture
  data/        types, mockRepository, supabaseRepository, contractTests
  hooks/       useLetters, useBonds, usePublicLetter
  lib/         slug, validation, format
supabase/      schema.sql, policies.sql, reset-test-data.sql, README.md
docs/superpowers/
  specs/       Design spec and carry-over decisions
  plans/       Task-by-task implementation plans
```

**The one architectural idea:** everything above `src/data/` talks to a
repository interface, never to a backend. `src/data/index.ts` picks the mock or
the Supabase adapter based on whether `VITE_SUPABASE_URL` is set. That is why
the entire UI was built and reviewed before a database existed, and why the
swap was a one-line change.

---

# Build record

Each phase was specified, planned task-by-task, implemented by a fresh agent
per task, and reviewed twice — once per task, once across the whole branch.
Reviews found real defects in every phase; the notable ones are recorded below
because the reasoning is worth more than the diff.

## Phase 1 — Foundation *(complete)*

Vite + React + TypeScript + Tailwind v4, design tokens, self-hosted fonts, the
paper texture, and the app shell.

- Palette and type are CSS custom properties in `src/design/tokens.css`,
  consumed through Tailwind v4's `@theme`. One source of truth; no
  `tailwind.config.js`.
- The paper texture is an inline SVG `feTurbulence` at `opacity-[0.035]`
  embedded as a data URI — no network request, resolution-independent.

**Deviations from the PRD:** Tailwind v4 (CSS-based theme, not
`tailwind.config.js`) and React 19 rather than 18. Three palette tokens were
added beyond the PRD's six — `--color-paper-edge`, `--color-ink-muted`,
`--color-accent-soft` — because six colours cannot build a UI.

## Phase 2 — The letter experience on mock data *(complete)*

Inbox, the unfolding letter view, and compose — fully usable with no backend.

- `LetterCard` and `LetterModal` share a `layoutId`, which is what makes a card
  *grow* into the opened letter rather than fade in.
- The repository interface, the in-memory implementation, and a 15-case
  contract suite.
- Inbox shown only letters you *received*; sent letters did not appear in your
  own timeline. This was a Phase 2 decision and is superseded by the later
  phase-break change.

**Found by review:**
- `prefers-reduced-motion` was unmet across the whole app. The CSS media query
  disables CSS animation; Framer Motion animates in JavaScript and defaults to
  `reducedMotion: "never"`. Every per-task review saw the media query and
  reasonably concluded the constraint was covered. Fixed with `<MotionConfig
  reducedMotion="user">`.
- `Compose` mounted its own `useLetters` and enabled Send before `partnerId`
  resolved — invisible against an instant mock, a wrong-answer bug the day a
  network is behind it.
- The modal had no focus management: keyboard users tabbed into invisible cards
  behind the overlay.

## Phase 3 — Supabase, auth, partner linking *(complete, not yet live)*

Schema, row-level security, email/password auth, and invite-link pairing.

- RLS is the entire authorization layer; there is no server-side application
  code.
- `link_partners` links both profiles in one transaction so a link cannot
  half-apply.
- The anonymous share path is a `security definer` function taking the slug as
  a mandatory argument, not a view.

**Found by review — the SQL had no tests and could not be executed, so
read-through was its only check:**
- **The `profiles` policy subqueried `profiles`.** Postgres rejects that as
  infinite recursion, so every profile read *and* every letter send would have
  failed the moment the SQL was applied.
- **The public view was listable.** `grant select on public_letters to anon`
  let anyone select it with no filter and receive every shared letter plus both
  names. Unlisted-link privacy rests entirely on slug unguessability; a
  listable view removes the need to guess. Replaced with a function.
- **A receiver could rewrite the sender's words**, and a user could re-point a
  letter's `receiver_id` into a stranger's inbox — RLS cannot restrict columns,
  so a before-update trigger now does.
- **A fix that was itself wrong.** The trigger initially allowed only the
  *sender* to publish. The share button lives in the Letter View, which shows
  *received* letters, so it would have failed on every letter it is attached
  to. Caught by reading the adapter against the schema.
- **The invite code was dropped for new accounts** — the most common path. B
  taps A's link, signs up, gets redirected to name themselves, and lands on an
  empty inbox, unlinked, with nothing explaining why.
- **Failures were invisible.** A failed profile load left the app on
  "One moment…" forever with the error consumed by nothing.

A whole-branch review ran nine exploit attempts against the finished SQL — 
forging `partner_id`, inserting to a stranger, re-pointing `receiver_id`,
enumerating profiles, reading a private letter through the share function,
anonymous reads — and all nine are blocked.

## Phase 3b — Letters outlive the bond *(complete)*

Archive and per-person delete, one merged timeline, and account deletion no
longer destroys a letter.

- Deleting an account unfolds into two changes: `sender_id` and `receiver_id`
  go to null, and a `before delete` trigger on `profiles` freezes the departing
  person's name onto their letters (into `sender_name` and `receiver_name`,
  separate from the live profile) while archiving the survivor's side. The
  correspondence survives, the author's name is preserved.
- Archive and delete are per-person. `sender_archived_at` and
  `receiver_archived_at` timestamps record when each side archived, leaving
  the other's copy untouched. `sender_deleted_at` and `receiver_deleted_at`
  remove it from that person's side permanently — RLS stops them reading the
  row, so recovery requires the dashboard.
- The inbox became `listConversation()`: every letter you sent or received,
  newest first, excluding archived ones. A second method, `listArchived()`,
  returns the archived letters. This retires Phase 2's received-only inbox
  and, with it, the earlier restriction that sent letters do not appear in
  your own timeline.
- `link_partners` split its overloaded exception: `ALREADY_LINKED` when *you*
  have a partner, `LINK_ALREADY_USED` when the *code's owner* does. Someone
  opening a spent invite link is no longer told they are already connected to
  someone when they are not connected to anyone.

**Fixed by this work:**
- **Letters were erasable by one person.** Both `letters` foreign keys were
  `on delete cascade`, so deleting an account destroyed the surviving partner's
  entire correspondence. Changed to `on delete set null` so letters survive
  their author, and a trigger archives the survivor's side.
- **The pairing error lied.** `link_partners` raised the same exception both
  when the caller was linked and when the code was spent, so the UI could not
  tell someone what actually went wrong.

## Phase 4 — Sharing *(complete)*

A letter can be published as an unlisted URL and read by someone who is not
signed in — `/letter/:slug`, rendered outside both the auth guard and the app
chrome. Sharing is a toggle: `setShared(letterId, shared)` flips visibility
without discarding the slug, so turning sharing off and back on revives the
same URL rather than minting a new one. The share panel is modelled on
Drive's "General access" section and nothing else — current state in plain
words, a Restricted / Anyone-with-the-link control, the URL, Copy and native
Share via the Web Share API. No roles, no people list, no expiry, no view
counts; a two-person app has no roles and nobody to invite.

Two decisions worth knowing:

- **Deleting a letter revokes its link; archiving does not.**
  `get_public_letter` checks `sender_deleted_at is null and
  receiver_deleted_at is null`, so either person deleting the letter breaks
  the link. It deliberately does not check either archive column:
  `unlink_partner` archives the whole correspondence on a breakup, and
  revoking every link on archive would silently break every letter either
  person had ever shared.
- **The slug write is atomic.** `share` used to read the row, choose a slug,
  and write it back — two round trips with a race in between. It is now a
  single `update` guarded by `.is('share_slug', null)`, so it can only ever
  set a slug on a letter that doesn't have one yet; a second call falls
  through to a plain `is_public` flip.

## Phase 5 — Deploy *(complete)*

The app was already on Vercel and already broken in the two ways that only
appear once deployed. `vercel.json` now rewrites every path to `index.html`,
and the route bundle was split so a stranger following a share link downloads
a fraction of what they used to. `DEPLOY.md` records the parts that live in
two dashboards rather than in this repository.

**Why the 404s could not have been caught locally.** Vite's dev server serves
`index.html` for any path it does not recognise, so `/letter/<slug>` and
`/archive` resolve invisibly in development. Vercel's static file server does
not: it looks for a file, finds none, and returns 404. Every route in this app
except `/` was therefore fine locally and dead in production — and
`/letter/<slug>` is the one URL nobody ever reaches by navigation. A direct hit
from a message is the *only* way anyone arrives there, so the single route that
had to survive a cold load was the single route guaranteed not to. One rewrite
rule fixes all of it.

**The split, and what it is actually for.** `/letter/:slug` is opened by
someone who did not choose to be here — on a phone, from a message, to read
one letter once. Before this phase they downloaded the entire application to
do it: one 609 kB chunk (179 kB gzipped) carrying auth, compose, archive,
both modals and framer-motion. `PublicLetter` went behind `lazy()` first, and
that alone changed almost nothing, because `PublicLetter` was never the heavy
part — the weight was everything statically imported alongside it. So the six
signed-in routes went lazy too, and `MotionConfig` moved inside `AppChrome`
so framer-motion loads only for the routes that animate. A stranger now gets
the shared 448 kB chunk (133 kB gzipped: React, the router, the Supabase
client) plus a 1.9 kB letter page; framer-motion's 120 kB sits in a chunk they
never request. The signed-in routes are split as a side effect, not as a goal
— those two people open the app and stay in it.

**Found: the live site was serving fiction.** Checked directly on 2026-09-10,
`dearjee.vercel.app` had no Supabase URL anywhere in its bundle and the mock's
seeded letter text present in it. The environment variables were never set, so
every visitor was reading three fabricated letters about someone waking before
an alarm. Nothing in this repository can fix that: Vite inlines `VITE_`-prefixed
variables at **build** time, so setting them in the Vercel dashboard does
nothing until a redeploy rebuilds the bundle. There is no server process to
restart, and no error to notice — the fallback is silent by design.

A structural responsive audit came out of this phase as well
(`docs/superpowers/specs/2026-09-10-responsive-audit.md`): no fixed width
anywhere, both share-URL rows correctly `break-all`, but the letter body
carries `whitespace-pre-wrap` without `break-words`, so a pasted URL inside a
letter is the most likely way a real page breaks at 375px. It reports; it
fixes nothing. Nobody on this project can see a rendered page, and that
verdict needs a phone.

## Phase 6 — Bonds and chapters *(complete, migration pending)*

A relationship became a row. `profiles.partner_id` used to be the whole model
of a relationship: it could say who you are with and nothing else — not that
a relationship ended, when it ran, or that two people had been together
twice. A new `bonds` table records one row per relationship, open
(`ended_at is null`) or closed, and `letters.bond_id` files each letter into
one. `partner_id` survives as a cache of the open bond, written only by the
two `security definer` functions that maintain both sides. Someone with no
open bond can still write — the letter is held (`bond_id is null`) until they
bond, at which point it joins that chapter.

- Home is scoped to the open bond, not to "every letter I can see." This
  closes a latent bug that predates this phase: `LetterModal`'s "Move back"
  (un-archiving) would have lifted a letter originally written to a former
  partner onto the current partner's home page, because archiving was the
  only state the UI tracked.
- Past chapters are read-only, and that is structural, not a UI convention.
  `receiver_id` is what RLS reads to grant read access, so re-associating a
  letter to a different chapter would itself be a permission grant, and
  moving one would silently delete the other person's copy of a letter they
  already received. There is no code path that changes which chapter a
  delivered letter belongs to.
- Held letters keep the date they were written, not the date they arrive.
  `created_at` means written; `sent_at` means delivered. A letter can now sit
  for weeks before a bond exists to receive it, and it reads as having been
  written when it was.
- `receiver_id` immutability — added in Phase 3 after a receiver could
  re-point a letter into a stranger's inbox — had to be narrowed rather than
  relaxed. A held letter's `receiver_id` legitimately goes from `null` to
  someone's id exactly once, when it is sent into the newly-formed bond. The
  trigger now permits that one transition and still blocks every other
  client-side rewrite.
- The insert column grants closed a gap that predates this phase and was
  found while writing the new insert policy: the update path has been locked
  down since Phase 3, but the insert path never was, so a client could set
  `is_public` or `share_slug` at the moment a letter is created, not just
  afterward.

**Found by review:**
- **A letter could escape its chapter through account deletion.**
  `letters_receiver_id_fkey` is `on delete set null`, so when a recipient
  deleted their account, their letters returned to `receiver_id = null` —
  re-entering the same state as a genuinely held letter. Left alone, a sender
  could then "send" a letter originally written to B into a later partner
  C's bond, still carrying its original `created_at`. Fixed by also requiring
  `sent_at is null` wherever the code distinguishes a held letter from a
  delivered one: a letter that has never been sent has no `sent_at`, but one
  that was delivered and then orphaned by deletion does, so the two cases no
  longer look the same.
- **The mock and the database disagreed twice** — the failure this project
  keeps hitting. `listHeld` in the mock skipped the deleted-letter filter the
  database applies through RLS, so a letter its own author had deleted kept
  reappearing in development while staying gone in production. And
  `Bond.partnerName` returned a live name from the mock but an empty string
  from production for the current chapter, which would have shown the
  partner's actual name in development and the literal word "Someone" in
  production — the two environments telling a different story about the same
  screen.
- **Two failures were being presented to the user as ordinary states.** A
  failed bond query rendered as an empty inbox, indistinguishable from
  genuinely having no partner; a failed bond load on the settings screen
  rendered as "You are not connected to anyone," which is a lie dressed as
  a fact. Both now surface as errors instead of false negatives.
- **Three controls were visible but inert**, the worst of which was a "Delete
  this letter permanently?" confirmation on a past-chapter letter that did
  nothing when confirmed — worse than no button at all, because the
  confirmation implies the deletion happened. All three are now wired up.
- **`/settings` shipped without its auth guard** — the only signed-in route
  missing one. Beyond the obvious access problem, it also skipped the
  redirect that stops the app rendering "Dear ," to someone who has never
  named themselves, which every other signed-in route enforces.
- **A user could be permanently cut off from their own past letters.** With
  an empty current inbox and the ended-bond notice dismissed, nothing on the
  screen linked to `/chapters` — the only route into a correspondence that
  had already ended.

**Migration status.** `supabase/schema.sql` and `supabase/policies.sql` carry
the `bonds` table, the chapter-scoping changes, and the narrowed
`receiver_id` trigger, and are idempotent by inspection. Applying them to the
live project, and the one-shot `supabase/reset-test-data.sql` that follows,
is the owner's step and had not been run as of this record. Until it is, the
app continues to run on the mock in development and the pre-Phase-6 schema in
production.

---

## Open decisions and known gaps

Full detail in `docs/superpowers/specs/2026-09-08-phase-3-carryover.md`.

**Decided, 2026-09-10: the palette stands.** `--color-ink-muted` (#8a8078) is
3.74:1 against the paper, below WCAG AA for the letter dates and word count.
The owner chose to keep it: the faded, low-contrast warmth is the product, and
those two elements are peripheral rather than the letter itself. Revisit only
if the app is ever used by someone who finds them illegible. The focus ring was
fixed regardless — an invisible keyboard indicator is a defect, not a style.

**Resolved in Phase 3b:** Letters used to be deleted along with their author.
Both `letters` foreign keys were `on delete cascade`, so one person could
erase the other's correspondence by deleting their account. Changed to `on
delete set null`, and a `before delete` trigger on `profiles` freezes the
departing person's name and archives the survivor's side so the correspondence
survives and moves quietly away.

**Resolved in Phase 6:** `Inbox.tsx` used to hardcode `receiverName="you"`
regardless of who actually received the letter. `recipientOf` now resolves
the real name — the signed-in profile's name when you are the receiver, the
letter's frozen `receiverName` or the current partner's name otherwise.

**Cosmetic:** `.env.example` and `supabase/README.md` name the Supabase
dashboard path slightly differently.
