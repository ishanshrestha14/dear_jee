# Dear Jee — Design Spec

**Date:** 2026-09-08
**Source:** `PRD.md`
**Status:** Approved for planning

---

## 1. Purpose & Scope

Dear Jee is a two-person web app for long-distance couples to write and read
affirmations and love letters. The emotional target is a physical, handwritten
letter; the visual design is the primary product requirement, not a finishing
step.

### In scope for v1

- Email/password authentication
- Profile setup and partner linking via an invite link
- Inbox of received letters
- Reading a letter in an expanded view
- Composing and sending a letter to your partner
- Sharing a single letter as an unlisted public URL

### Explicitly out of scope for v1

Decided during brainstorming; each may return as a later phase.

- Realtime letter arrival (Supabase Realtime is unused in v1; letters load on mount)
- A "sent" folder
- Deleting or unsending letters
- Multiple letter fonts (PRD lists this as a future idea)
- Push notifications, email digests, attachments, reactions

---

## 2. Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data access | Repository interface with swappable adapter | Supabase project does not exist yet; lets the aesthetic (the priority) be built and reviewed first, and makes the backend swap one line |
| Partner linking | Invite link (`/join/:inviteCode`) | Fits the app's share-link theme; self-serve; no email enumeration |
| v1 feature set | Core only | YAGNI; fastest path to an app the couple actually uses |
| Testing | Logic-level only (Vitest) | Value concentrated in data layer, slug generation, validation, linking; component tests on a heavily-animated UI are brittle |
| Server-side code | None | Supabase + RLS is the whole backend; Vercel serves static output |
| Data fetching library | None (hooks + Context) | Two entities, no realtime; React Query would be more machinery than the app needs |

---

## 3. Architecture

Client-only single-page React application. Supabase provides Postgres, auth,
and row-level authorization. Vercel serves the static build. There is no
custom backend.

### 3.1 Module layout

```
src/
  app/            App.tsx, router, providers
  design/         tokens.css, fonts, PaperTexture, theme utilities
  components/     Layout, LetterCard, LetterModal, ComposeLetter, Toast, ShareButton
  routes/         Inbox, Compose, AuthScreen, SetupProfile, JoinPartner, PublicLetter
  data/
    types.ts            Letter, Profile, repository interfaces
    mockRepository.ts   in-memory, seeded; doubles as the test fixture
    supabaseRepository.ts
    supabaseClient.ts
    index.ts            selects adapter from env
  hooks/          useAuth, useLetters, usePartner, useShare
  lib/            slug.ts, format.ts, validation.ts
supabase/
  schema.sql      tables and indexes
  policies.sql    row-level security policies
docs/superpowers/
  specs/          this document
  plans/          implementation plans
```

### 3.2 Boundaries

- Components receive data through props and call hook functions. Nothing under
  `components/` imports from `data/`.
- The repository interface is the sole contract between UI and backend. This is
  what makes the mock-to-Supabase swap a one-line change and what keeps logic
  tests free of network access.
- `supabaseClient.ts` is imported only by `supabaseRepository.ts`.

### 3.3 Routes

| Path | Auth | Purpose |
|---|---|---|
| `/` | required | Inbox of received letters |
| `/compose` | required | Write and send a letter |
| `/auth` | public | Sign in / sign up |
| `/setup` | required | First-run: enter your name |
| `/join/:inviteCode` | required (redirects to `/auth` and returns) | Link two profiles as partners |
| `/letter/:slug` | public | Read-only shared letter |

### 3.4 State

- `AuthProvider` (React Context) holds the Supabase session and the current
  user's profile, including `partner_id`.
- `useLetters` fetches received letters on mount and performs an optimistic
  insert on send, reconciling with the server response.
- `usePartner` resolves the partner profile for display names.

### 3.5 Error handling

- Repository methods return `{ data, error }` rather than throwing. Callers
  handle `error` explicitly.
- User-visible failures surface through the same toast component used for share
  confirmation, so the app has one notification system.
- `/letter/:slug` has three designed states: loading, found, and
  not-found-or-unshared. The last is a designed page, not a blank screen —
  strangers will land on it from messaging apps.

---

## 4. Data Model

### 4.1 `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | references `auth.users` |
| `full_name` | text | |
| `partner_id` | uuid, nullable | references `profiles.id`; null means not yet linked |
| `invite_code` | text, unique | short random string generated at signup |
| `created_at` | timestamptz | default `now()` |

`invite_code` is an addition to the PRD schema, required by the invite-link
flow. Nullable `partner_id` is a real state the UI must handle: it exists
between User A signing up and User B accepting the link.

### 4.2 `letters`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | default `gen_random_uuid()` |
| `sender_id` | uuid | references `profiles.id` |
| `receiver_id` | uuid | references `profiles.id` |
| `message` | text | letter body |
| `created_at` | timestamptz | default `now()` |
| `is_read` | boolean | default false |
| `share_slug` | text, unique, nullable | populated on first share |
| `is_public` | boolean | default false |

Index on `(receiver_id, created_at desc)` for the inbox query, and a unique
index on `share_slug`.

### 4.3 Partner linking

1. User A signs up and completes `/setup` with their name. An `invite_code` is
   generated for them.
2. A's inbox empty state shows a copyable `/join/<code>` link.
3. User B opens the link, signs up or signs in, and completes setup.
4. Acceptance calls a single Postgres function that sets `partner_id` on both
   rows in one transaction, so the link cannot half-apply.
5. If B already has a `partner_id`, the route shows an "already connected"
   message and changes nothing.

---

## 5. Security

### 5.1 Row-level security

RLS is enabled on both tables. No table is readable without a matching policy.

| Table | Operation | Policy |
|---|---|---|
| `profiles` | select | own row, or the row whose id equals your `partner_id` |
| `profiles` | update | own row only |
| `letters` | insert | `sender_id = auth.uid()` **and** `receiver_id` equals your `partner_id` |
| `letters` | select | you are the sender or the receiver |
| `letters` | update | sender may change `is_public` / `share_slug`; receiver may set `is_read` |

The insert policy's second condition matters: without it an authenticated user
could write letters to arbitrary accounts.

### 5.2 Public share links

The `/letter/:slug` route is read by an anonymous Supabase client, requiring a
separate select path. Two constraints:

- **Slug entropy.** Slugs are approximately 12 characters of URL-safe random
  data (~70 bits). Unlisted-URL security rests entirely on unguessability, so a
  short or sequential slug is the vulnerability.
- **Column restriction.** The public read exposes only `message`, `created_at`,
  and the two first names. It goes through a restricted database view rather
  than relying on the client to request a narrow column list — ids and emails
  must not be reachable from an anonymous session.

Sharing is opt-in per letter. `is_public` stays false until the sender taps
Share; the slug is generated on first share and reused thereafter.

---

## 6. Design System

The visual design is the primary requirement. It must not read as a SaaS
dashboard.

### 6.1 Tokens

Palette, type scale, and shadows are defined as CSS custom properties in
`design/tokens.css`, and referenced from the Tailwind theme extension. Single
source of truth: the paper texture, letter surface gradient, and warm-tinted
shadow need raw CSS that is awkward to express as utility classes, and the
palette must not be maintained in two places.

Palette, per PRD section 3A:

| Token | Value | Use |
|---|---|---|
| `--paper-app` | `#FDFBF7` | app background |
| `--paper-letter` | `#F4EFE6` | letter surface |
| `--ink-ui` | `#2C2825` | UI text |
| `--ink-letter` | `#1A1A1A` at 85% | letter body |
| `--accent` | `#C87963` | buttons, active states |
| `--accent-gold` | `#D4AF37` | secondary accent |

No pure white or pure black anywhere.

### 6.2 Typography

Three roles, self-hosted via `@fontsource` so first paint does not depend on a
third party and the letter never flashes in a fallback face.

| Role | Family |
|---|---|
| App UI | Plus Jakarta Sans |
| Letter body | Lora |
| Sign-off | Caveat |

### 6.3 Texture and depth

- **Paper texture:** inline SVG `feTurbulence` at low opacity, embedded as a
  data URI. No network request, resolution-independent, tinted in one place.
- **Shadows:** soft and diffused with a warm tint, so the letter reads as
  resting on a desk rather than floating in a browser.

### 6.4 Motion

Framer Motion throughout.

- `LetterCard` hover animates the shadow rather than translating the card —
  subtler, less "web app".
- `LetterModal` opens with `AnimatePresence`, scaling from the originating
  card's position rather than fading in from centre. This is what reads as
  unfolding.
- New letters slide gently into the inbox.
- The share icon morphs into a check mark for approximately 1.2 seconds on
  success, with a soft terracotta glow.
- All motion respects `prefers-reduced-motion`.

### 6.5 Layout

- Letter view centred, max-width 600px.
- Mobile: full width with padding. Desktop: centred and max-width constrained.
- Letter view header optional ("Dear [name],"), footer sign-off in Caveat
  aligned right, with the date below in small muted text.

---

## 7. Sharing UX

- Share control sits in the top-right of the letter view, subordinate to the
  reading experience.
- On mobile, the Web Share API opens the native share sheet.
- Where the Web Share API is unavailable, the link is copied to the clipboard.
- Either path shows a warm toast at the bottom of the screen:
  "Link copied! Send it to them on WhatsApp 💌"

---

## 8. Testing

Logic-level tests only, using Vitest. No component tests.

| Target | What is verified |
|---|---|
| `lib/slug.ts` | length, alphabet, absence of collisions across a large sample |
| `lib/validation.ts` | empty and whitespace-only letters rejected; length bounds |
| Repository contract | run against `mockRepository`: send, list, mark read, share |
| Partner linking | both directions set; already-linked case rejected |

The mock repository serves as the test fixture, so the suite needs no network
and no Supabase project.

---

## 9. Phases

| Phase | Content | Blocked on |
|---|---|---|
| 1. Foundation | Vite + TS + Tailwind, tokens, fonts, paper texture, Layout shell | — |
| 2. Letters UI on mock data | LetterCard, inbox grid, LetterModal with unfolding animation, ComposeLetter; fully clickable, no backend | — |
| 3. Supabase foundation | schema and policies applied, client wired, `supabaseRepository`, env swap, auth screens, setup, `/join/:code` | user creates the Supabase project |
| 4. Sharing | slug generation, public route, restricted view, Web Share API with clipboard fallback, toast | Phase 3 |
| 5. Polish and deploy | empty states, loading skeletons, error paths, responsive pass, reduced-motion, Vercel | Phase 4 |

Phase 2 is deliberately the largest: it is the part the PRD identifies as most
important, and it has no external dependencies. Phase 3 is the only phase gated
on an external action.

### Phase exit criteria

- **Phase 1:** app runs; a page renders in the paper palette with all three
  fonts loaded and the texture visible.
- **Phase 2:** a reviewer can browse seeded letters, open one with the
  unfolding animation, and compose a new one that appears in the inbox — all
  without a backend.
- **Phase 3:** two real accounts can sign up, link as partners, and exchange a
  letter that persists.
- **Phase 4:** a shared link opens the letter in a logged-out browser, and an
  unshared slug shows the designed not-found page.
- **Phase 5:** deployed to Vercel and usable on a phone.
