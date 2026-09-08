# Dear Jee — Phases 1 & 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Dear Jee reading and writing experience — paper aesthetic, inbox, unfolding letter view, and compose screen — running entirely on an in-memory mock repository, with no backend.

**Architecture:** A client-only React SPA. All data access goes through a `LetterRepository` / `ProfileRepository` interface; these phases ship only the in-memory implementation, so the UI can be built and judged before the Supabase project exists. Design tokens live as CSS custom properties consumed by Tailwind's theme.

**Tech Stack:** Vite, React 18, TypeScript, Tailwind CSS v4, Framer Motion, React Router, Lucide React, Vitest, @fontsource.

**Spec:** `docs/superpowers/specs/2026-09-08-dear-jee-design.md`

## Global Constraints

- Never use pure white `#FFFFFF` or pure black `#000000` anywhere in the UI.
- Palette values, verbatim: app background `#FDFBF7`, letter surface `#F4EFE6`, UI ink `#2C2825`, letter ink `#1A1A1A` at 85% opacity, accent terracotta `#C87963`, accent gold `#D4AF37`.
- Three type roles, no others: Plus Jakarta Sans (UI), Lora (letter body), Caveat (sign-off).
- Letter view is centred with a max width of 600px.
- All animation must be disabled under `prefers-reduced-motion: reduce`.
- Components under `src/components/` must not import from `src/data/`.
- Repository methods return `{ data, error }`; they never throw.
- Every module is strictly typed. `any` is not permitted.
- Tests are logic-level only (Vitest). Do not write component tests.

**Deviation from PRD, deliberate:** the PRD names `tailwind.config.js`. This plan uses Tailwind v4, whose theme is configured in CSS via `@theme`. This serves the spec's "tokens as CSS custom properties, single source of truth" decision better than a JS config would. Everything else in PRD section 3 is followed exactly.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/design/tokens.css` | Palette, type, shadow, and radius tokens; Tailwind `@theme` mapping |
| `src/design/fonts.ts` | Font imports, one place |
| `src/design/PaperTexture.tsx` | Reusable textured paper surface |
| `src/components/Layout.tsx` | App shell: background, header, content column |
| `src/components/LetterCard.tsx` | Inbox preview card |
| `src/components/LetterModal.tsx` | Expanded reading view |
| `src/components/ComposeLetter.tsx` | Writing form |
| `src/routes/Inbox.tsx` | Inbox screen, owns modal open state |
| `src/routes/Compose.tsx` | Compose screen, owns send action |
| `src/data/types.ts` | Domain types and repository interfaces |
| `src/data/mockRepository.ts` | In-memory implementation and seed data |
| `src/data/index.ts` | Adapter selection |
| `src/hooks/useLetters.ts` | Fetch on mount, optimistic send |
| `src/lib/slug.ts` | Share-slug generation |
| `src/lib/validation.ts` | Letter body validation |
| `src/lib/format.ts` | Date formatting and snippet truncation |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css` (all from the Vite scaffold; `src/App.tsx` moves to `src/app/App.tsx` in Task 2)
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a running dev server, a passing `npm test`, and `formatLetterDate(iso: string): string` plus `snippet(text: string, max?: number): string`

- [ ] **Step 1: Scaffold Vite and install dependencies**

Run in the project root (the folder already contains `PRD.md`, `docs/`, and `.git`, so scaffold in place):

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install tailwindcss @tailwindcss/vite framer-motion react-router-dom lucide-react @supabase/supabase-js
npm install @fontsource/plus-jakarta-sans @fontsource/lora @fontsource/caveat
npm install -D vitest
```

If `npm create vite` refuses because the directory is not empty, choose the option to ignore existing files. Do not delete `PRD.md`, `docs/`, or `.gitignore`.

- [ ] **Step 2: Wire Tailwind and Vitest into the Vite config**

Replace `vite.config.ts` with:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

Add the test script to `package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Write the failing test for format helpers**

Create `src/lib/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatLetterDate, snippet } from './format'

describe('formatLetterDate', () => {
  it('renders a warm long-form date', () => {
    expect(formatLetterDate('2026-02-14T09:30:00.000Z')).toBe('14 February 2026')
  })
})

describe('snippet', () => {
  it('returns short text unchanged', () => {
    expect(snippet('I miss you.', 40)).toBe('I miss you.')
  })

  it('truncates at a word boundary and appends an ellipsis', () => {
    expect(snippet('I have been thinking about you all morning', 20)).toBe('I have been thinking…')
  })

  it('collapses newlines into single spaces', () => {
    expect(snippet('one\n\ntwo', 40)).toBe('one two')
  })
})
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 5: Implement the format helpers**

Create `src/lib/format.ts`:

```ts
/** Formats an ISO timestamp as the date shown beneath a letter's sign-off. */
export function formatLetterDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Produces a single-line preview of a letter body, cut at a word boundary
 * so the inbox never shows a word sliced in half.
 */
export function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat

  const cut = flat.slice(0, max)
  // If the cut landed exactly on a space, it is already a clean boundary
  // and trimming back to the previous space would drop a whole word.
  if (flat[max] === ' ') return `${cut.trimEnd()}…`

  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify the dev server boots**

Run: `npm run dev`
Expected: Vite prints a local URL and the default Vite page renders with no console errors. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS + Tailwind + Vitest"
```

---

### Task 2: Design tokens and fonts

**Files:**
- Create: `src/design/tokens.css`, `src/design/fonts.ts`
- Modify: `src/index.css`, `src/main.tsx`
- Delete: `src/App.css`

**Interfaces:**
- Consumes: Task 1's Tailwind wiring
- Produces: Tailwind utilities `bg-paper-app`, `bg-paper-letter`, `text-ink-ui`, `text-ink-letter`, `bg-accent`, `text-accent`, `bg-accent-gold`, `shadow-letter`, `shadow-letter-lifted`, `font-ui`, `font-letter`, `font-hand`

- [ ] **Step 1: Write the tokens file**

Create `src/design/tokens.css`:

```css
@import 'tailwindcss';

/*
 * Single source of truth for the Dear Jee palette.
 * Values are taken verbatim from the PRD; no pure white or pure black.
 */
@theme {
  --color-paper-app: #fdfbf7;
  --color-paper-letter: #f4efe6;
  --color-paper-edge: #e8e0d2;

  --color-ink-ui: #2c2825;
  --color-ink-muted: #8a8078;
  --color-ink-letter: rgb(26 26 26 / 0.85);

  --color-accent: #c87963;
  --color-accent-soft: #e3b3a4;
  --color-accent-gold: #d4af37;

  --font-ui: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
  --font-letter: 'Lora', ui-serif, Georgia, serif;
  --font-hand: 'Caveat', ui-serif, cursive;

  /* Warm-tinted, diffused shadows: the letter rests on a desk. */
  --shadow-letter: 0 1px 2px rgb(140 110 90 / 0.06), 0 8px 24px rgb(140 110 90 / 0.1);
  --shadow-letter-lifted: 0 2px 4px rgb(140 110 90 / 0.08), 0 18px 44px rgb(140 110 90 / 0.16);

  --radius-letter: 3px;
}
```

- [ ] **Step 2: Write the font entry point**

Create `src/design/fonts.ts`:

```ts
// Self-hosted so first paint never waits on a third party and the
// letter body never flashes in a fallback face.
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/lora/400.css'
import '@fontsource/lora/400-italic.css'
import '@fontsource/lora/500.css'
import '@fontsource/caveat/400.css'
import '@fontsource/caveat/600.css'
```

- [ ] **Step 3: Replace the global stylesheet**

Replace the entire contents of `src/index.css` with:

```css
@import './design/tokens.css';

html,
body,
#root {
  min-height: 100%;
}

body {
  background-color: var(--color-paper-app);
  color: var(--color-ink-ui);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
}

/* Honour the reader's motion preference across the whole app. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Delete the Vite starter stylesheet:

```bash
rm src/App.css
```

- [ ] **Step 4: Import fonts at the entry point**

Replace `src/main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/fonts'
import './index.css'
import App from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Move the starter component to `src/app/App.tsx` and replace its body with a token proof sheet:

```tsx
export default function App() {
  return (
    <main className="mx-auto max-w-[600px] px-6 py-16">
      <h1 className="font-ui text-2xl font-semibold text-ink-ui">Dear Jee</h1>
      <p className="mt-6 font-letter text-lg text-ink-letter">
        The letter body is set in Lora, and it should feel like ink on paper.
      </p>
      <p className="mt-6 text-right font-hand text-3xl text-accent">With love, Jee</p>
      <div className="mt-10 rounded-letter bg-paper-letter p-6 shadow-letter">
        A letter surface resting on the desk.
      </div>
    </main>
  )
}
```

Delete `src/App.tsx` if the scaffold placed it at the root:

```bash
rm -f src/App.tsx
```

- [ ] **Step 5: Verify the tokens render**

Run: `npm run dev`
Expected: the page background is cream, not white. Three visibly different typefaces appear — a clean sans heading, a serif paragraph, and a handwritten sign-off in terracotta. The bottom box is a slightly darker paper tone with a soft warm shadow. No console errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add design tokens, palette, and self-hosted fonts"
```

---

### Task 3: Paper texture and layout shell

**Files:**
- Create: `src/design/PaperTexture.tsx`, `src/components/Layout.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: tokens from Task 2
- Produces: `<PaperTexture className?: string; children: ReactNode />` and `<Layout children: ReactNode />`

- [ ] **Step 1: Write the paper texture component**

Create `src/design/PaperTexture.tsx`:

```tsx
import type { ReactNode } from 'react'

/**
 * A paper surface: the letter tone, a warm shadow, and a very low-opacity
 * fibre texture so the rectangle never reads as flat digital fill.
 *
 * The texture is an inline SVG feTurbulence encoded as a data URI — no
 * network request, and resolution-independent at any size.
 */
const TEXTURE_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")"

interface PaperTextureProps {
  children: ReactNode
  className?: string
}

export function PaperTexture({ children, className = '' }: PaperTextureProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-letter bg-paper-letter shadow-letter ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-multiply opacity-[0.035]"
        style={{ backgroundImage: TEXTURE_URI }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Write the layout shell**

Create `src/components/Layout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface LayoutProps {
  children: ReactNode
}

/** App shell: warm ground, a quiet header, and a centred content column. */
export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-paper-app">
      <header className="mx-auto flex max-w-3xl items-baseline justify-between px-6 pt-10 pb-6">
        <Link to="/" className="font-hand text-3xl text-ink-ui transition-colors hover:text-accent">
          Dear Jee
        </Link>
        <Link
          to="/compose"
          className="font-ui text-sm font-medium text-ink-muted transition-colors hover:text-accent"
        >
          Write a letter
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Render the shell with a textured letter**

Replace `src/app/App.tsx`:

```tsx
import { BrowserRouter } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { PaperTexture } from '../design/PaperTexture'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <PaperTexture className="mx-auto max-w-[600px] p-10">
          <p className="font-letter text-lg leading-relaxed text-ink-letter">
            The texture should be felt more than seen.
          </p>
          <p className="mt-8 text-right font-hand text-3xl text-ink-ui">With love, Jee</p>
        </PaperTexture>
      </Layout>
    </BrowserRouter>
  )
}
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`
Expected: a cream page with a header, and a centred paper panel whose surface has a faint grain visible when you look closely but which does not read as noise at a glance. Confirm the panel is at most 600px wide on a desktop viewport and full width minus padding at 375px.

**Phase 1 exit criteria met when this step passes.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add paper texture surface and app layout shell"
```

---

### Task 4: Domain types and letter validation

**Files:**
- Create: `src/data/types.ts`, `src/lib/validation.ts`
- Test: `src/lib/validation.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: types `Profile`, `Letter`, `PublicLetter`, `Result<T>`, `LetterRepository`, `ProfileRepository`; and `validateLetter(message: string): ValidationResult`

- [ ] **Step 1: Define the domain types and repository contracts**

Create `src/data/types.ts`:

```ts
export interface Profile {
  id: string
  fullName: string
  /** Null until the two accounts are linked. A real, renderable state. */
  partnerId: string | null
  inviteCode: string
  createdAt: string
}

export interface Letter {
  id: string
  senderId: string
  receiverId: string
  message: string
  createdAt: string
  isRead: boolean
  shareSlug: string | null
  isPublic: boolean
}

/** The narrow shape an anonymous reader is allowed to see. */
export interface PublicLetter {
  message: string
  createdAt: string
  senderName: string
  receiverName: string
}

/** Repositories report failure in the value, never by throwing. */
export type Result<T> = { data: T; error: null } | { data: null; error: string }

export interface SendLetterInput {
  senderId: string
  receiverId: string
  message: string
}

export interface LetterRepository {
  listReceived(userId: string): Promise<Result<Letter[]>>
  send(input: SendLetterInput): Promise<Result<Letter>>
  markRead(letterId: string): Promise<Result<Letter>>
  /** Makes the letter publicly readable, generating a slug on first call. */
  share(letterId: string): Promise<Result<Letter>>
  getBySlug(slug: string): Promise<Result<PublicLetter>>
}

export interface ProfileRepository {
  getById(id: string): Promise<Result<Profile>>
  getByInviteCode(inviteCode: string): Promise<Result<Profile>>
  linkPartner(userId: string, inviteCode: string): Promise<Result<Profile>>
}
```

- [ ] **Step 2: Write the failing validation test**

Create `src/lib/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateLetter, MAX_LETTER_LENGTH } from './validation'

describe('validateLetter', () => {
  it('accepts an ordinary letter', () => {
    expect(validateLetter('I miss you today.')).toEqual({ ok: true })
  })

  it('rejects an empty letter', () => {
    expect(validateLetter('')).toEqual({ ok: false, reason: 'A letter needs a few words.' })
  })

  it('rejects a whitespace-only letter', () => {
    expect(validateLetter('   \n\t  ')).toEqual({
      ok: false,
      reason: 'A letter needs a few words.',
    })
  })

  it('rejects a letter past the maximum length', () => {
    expect(validateLetter('a'.repeat(MAX_LETTER_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'This letter is a little too long to send.',
    })
  })

  it('accepts a letter exactly at the maximum length', () => {
    expect(validateLetter('a'.repeat(MAX_LETTER_LENGTH))).toEqual({ ok: true })
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./validation`.

- [ ] **Step 4: Implement validation**

Create `src/lib/validation.ts`:

```ts
export const MAX_LETTER_LENGTH = 5000

export type ValidationResult = { ok: true } | { ok: false; reason: string }

/** Guards the one field the app writes. Messages are user-facing copy. */
export function validateLetter(message: string): ValidationResult {
  if (message.trim().length === 0) {
    return { ok: false, reason: 'A letter needs a few words.' }
  }
  if (message.length > MAX_LETTER_LENGTH) {
    return { ok: false, reason: 'This letter is a little too long to send.' }
  }
  return { ok: true }
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, 9 tests total.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add domain types, repository contracts, and letter validation"
```

---

### Task 5: Share-slug generation

**Files:**
- Create: `src/lib/slug.ts`
- Test: `src/lib/slug.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `generateSlug(): string` and `SLUG_LENGTH`, `SLUG_ALPHABET`

- [ ] **Step 1: Write the failing slug test**

Create `src/lib/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateSlug, SLUG_LENGTH, SLUG_ALPHABET } from './slug'

describe('generateSlug', () => {
  it('is the declared length', () => {
    expect(generateSlug()).toHaveLength(SLUG_LENGTH)
  })

  it('uses only the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      for (const char of generateSlug()) {
        expect(SLUG_ALPHABET).toContain(char)
      }
    }
  })

  it('carries enough entropy that unlisted links cannot be guessed', () => {
    // Security here rests entirely on unguessability, so assert the floor.
    const bits = SLUG_LENGTH * Math.log2(SLUG_ALPHABET.length)
    expect(bits).toBeGreaterThan(60)
  })

  it('produces no collisions across a large sample', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20000; i += 1) seen.add(generateSlug())
    expect(seen.size).toBe(20000)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./slug`.

- [ ] **Step 3: Implement slug generation**

Create `src/lib/slug.ts`:

```ts
/**
 * Base58: the digits and letters minus 0, O, I, and l, so a slug read
 * aloud or retyped from a screenshot cannot be mistranscribed.
 */
export const SLUG_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export const SLUG_LENGTH = 12

/**
 * Generates the unlisted-URL identifier for a shared letter.
 *
 * Uses the CSPRNG, not Math.random: an unlisted link is only private
 * while it is unguessable, and rejection sampling keeps the character
 * distribution uniform.
 */
export function generateSlug(): string {
  const limit = 256 - (256 % SLUG_ALPHABET.length)
  const out: string[] = []
  const buffer = new Uint8Array(SLUG_LENGTH * 2)

  while (out.length < SLUG_LENGTH) {
    crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (byte >= limit) continue // discard, or common characters skew high
      out.push(SLUG_ALPHABET[byte % SLUG_ALPHABET.length])
      if (out.length === SLUG_LENGTH) break
    }
  }

  return out.join('')
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, 13 tests total.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add CSPRNG share-slug generation"
```

---

### Task 6: Mock repository and the contract test

**Files:**
- Create: `src/data/mockRepository.ts`, `src/data/index.ts`
- Test: `src/data/mockRepository.test.ts`

**Interfaces:**
- Consumes: `Letter`, `Profile`, `Result`, `LetterRepository`, `ProfileRepository`, `SendLetterInput` from `src/data/types.ts`; `generateSlug` from `src/lib/slug.ts`; `validateLetter` from `src/lib/validation.ts`
- Produces: `createMockRepositories(): { letters: LetterRepository; profiles: ProfileRepository }`, the seed constants `MOCK_USER_ID` and `MOCK_PARTNER_ID`, and the app-wide singletons `letterRepository` / `profileRepository` / `currentUserId` exported from `src/data/index.ts`

- [ ] **Step 1: Write the failing contract test**

Create `src/data/mockRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockRepositories, MOCK_USER_ID, MOCK_PARTNER_ID } from './mockRepository'
import type { LetterRepository, ProfileRepository } from './types'

let letters: LetterRepository
let profiles: ProfileRepository

beforeEach(() => {
  const repos = createMockRepositories()
  letters = repos.letters
  profiles = repos.profiles
})

describe('listReceived', () => {
  it('returns only letters addressed to the user', async () => {
    const { data } = await letters.listReceived(MOCK_USER_ID)
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((l) => l.receiverId === MOCK_USER_ID)).toBe(true)
  })

  it('orders newest first', async () => {
    const { data } = await letters.listReceived(MOCK_USER_ID)
    const times = data!.map((l) => Date.parse(l.createdAt))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})

describe('send', () => {
  it('stores a letter the receiver can then read', async () => {
    const sent = await letters.send({
      senderId: MOCK_USER_ID,
      receiverId: MOCK_PARTNER_ID,
      message: 'Good morning, you.',
    })
    expect(sent.error).toBeNull()

    const { data } = await letters.listReceived(MOCK_PARTNER_ID)
    expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
  })

  it('starts unread, unshared, and private', async () => {
    const { data } = await letters.send({
      senderId: MOCK_USER_ID,
      receiverId: MOCK_PARTNER_ID,
      message: 'Hello.',
    })
    expect(data!.isRead).toBe(false)
    expect(data!.shareSlug).toBeNull()
    expect(data!.isPublic).toBe(false)
  })

  it('rejects an empty letter without storing anything', async () => {
    const before = (await letters.listReceived(MOCK_PARTNER_ID)).data!.length
    const result = await letters.send({
      senderId: MOCK_USER_ID,
      receiverId: MOCK_PARTNER_ID,
      message: '   ',
    })
    expect(result.data).toBeNull()
    expect(result.error).toBe('A letter needs a few words.')
    expect((await letters.listReceived(MOCK_PARTNER_ID)).data!.length).toBe(before)
  })
})

describe('markRead', () => {
  it('flips isRead and persists it', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const target = inbox!.find((l) => !l.isRead)!
    await letters.markRead(target.id)
    const { data: after } = await letters.listReceived(MOCK_USER_ID)
    expect(after!.find((l) => l.id === target.id)!.isRead).toBe(true)
  })

  it('reports a missing letter rather than throwing', async () => {
    const result = await letters.markRead('does-not-exist')
    expect(result.data).toBeNull()
    expect(result.error).toBe('Letter not found.')
  })
})

describe('share', () => {
  it('makes the letter public and assigns a slug', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const { data } = await letters.share(inbox![0].id)
    expect(data!.isPublic).toBe(true)
    expect(data!.shareSlug).toHaveLength(12)
  })

  it('reuses the slug on a second share so old links keep working', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const first = await letters.share(inbox![0].id)
    const second = await letters.share(inbox![0].id)
    expect(second.data!.shareSlug).toBe(first.data!.shareSlug)
  })
})

describe('getBySlug', () => {
  it('returns only the publicly safe fields', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const shared = await letters.share(inbox![0].id)
    const { data } = await letters.getBySlug(shared.data!.shareSlug!)
    expect(Object.keys(data!).sort()).toEqual([
      'createdAt',
      'message',
      'receiverName',
      'senderName',
    ])
  })

  it('refuses an unknown slug', async () => {
    const result = await letters.getBySlug('nosuchslug12')
    expect(result.data).toBeNull()
    expect(result.error).toBe('This letter is not available.')
  })
})

describe('linkPartner', () => {
  it('links both profiles to each other', async () => {
    const repos = createMockRepositories({ unlinked: true })
    const partner = await repos.profiles.getById(MOCK_PARTNER_ID)
    const linked = await repos.profiles.linkPartner(MOCK_USER_ID, partner.data!.inviteCode)
    expect(linked.data!.partnerId).toBe(MOCK_PARTNER_ID)
    const other = await repos.profiles.getById(MOCK_PARTNER_ID)
    expect(other.data!.partnerId).toBe(MOCK_USER_ID)
  })

  it('refuses an unknown invite code', async () => {
    const repos = createMockRepositories({ unlinked: true })
    const result = await repos.profiles.linkPartner(MOCK_USER_ID, 'BADCODE')
    expect(result.data).toBeNull()
    expect(result.error).toBe('That invite link is not valid.')
  })

  it('refuses to link someone who already has a partner', async () => {
    const partner = await profiles.getById(MOCK_PARTNER_ID)
    const result = await profiles.linkPartner(MOCK_USER_ID, partner.data!.inviteCode)
    expect(result.data).toBeNull()
    expect(result.error).toBe('You are already connected.')
  })

  it('refuses to link a profile to itself', async () => {
    const repos = createMockRepositories({ unlinked: true })
    const self = await repos.profiles.getById(MOCK_USER_ID)
    const result = await repos.profiles.linkPartner(MOCK_USER_ID, self.data!.inviteCode)
    expect(result.data).toBeNull()
    expect(result.error).toBe('That invite link is your own.')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./mockRepository`.

- [ ] **Step 3: Implement the mock repositories**

Create `src/data/mockRepository.ts`:

```ts
import { generateSlug } from '../lib/slug'
import { validateLetter } from '../lib/validation'
import type {
  Letter,
  LetterRepository,
  Profile,
  ProfileRepository,
  PublicLetter,
  Result,
  SendLetterInput,
} from './types'

export const MOCK_USER_ID = 'user-jee'
export const MOCK_PARTNER_ID = 'user-love'

const ok = <T>(data: T): Result<T> => ({ data, error: null })
const fail = <T>(error: string): Result<T> => ({ data: null, error })

interface MockOptions {
  /** Start with both profiles unlinked, to exercise the joining flow. */
  unlinked?: boolean
}

function seedProfiles(unlinked: boolean): Profile[] {
  return [
    {
      id: MOCK_USER_ID,
      fullName: 'Jee',
      partnerId: unlinked ? null : MOCK_PARTNER_ID,
      inviteCode: 'JEE7K2M',
      createdAt: '2026-01-01T09:00:00.000Z',
    },
    {
      id: MOCK_PARTNER_ID,
      fullName: 'Ishan',
      partnerId: unlinked ? null : MOCK_USER_ID,
      inviteCode: 'ISH4Q9P',
      createdAt: '2026-01-01T09:05:00.000Z',
    },
  ]
}

function seedLetters(): Letter[] {
  const base = {
    senderId: MOCK_PARTNER_ID,
    receiverId: MOCK_USER_ID,
    isRead: false,
    shareSlug: null,
    isPublic: false,
  }
  return [
    {
      ...base,
      id: 'letter-1',
      createdAt: '2026-02-14T08:15:00.000Z',
      message:
        'I woke up before the alarm again, and the first thing I did was work out what time it was where you are. Half past four. You were still asleep. I lay there imagining the exact shape of you under that blue blanket, and it was the happiest I have been all week.',
    },
    {
      ...base,
      id: 'letter-2',
      isRead: true,
      createdAt: '2026-02-11T21:40:00.000Z',
      message:
        'You said something on the phone last night that I have not stopped thinking about. That you are not waiting for the distance to end to be happy. I want you to know I heard it. I am not waiting either. I am just very glad it will end.',
    },
    {
      ...base,
      id: 'letter-3',
      isRead: true,
      createdAt: '2026-02-06T13:02:00.000Z',
      message:
        'It rained the whole afternoon and I walked home without an umbrella on purpose, because you once told me you liked the smell of wet pavement. Small silly things keep turning out to be about you.',
    },
  ]
}

/**
 * In-memory implementation of the repository contracts.
 *
 * This is the only data source in Phases 1 and 2, and it doubles as the
 * fixture for the contract tests, so the suite needs no network.
 */
export function createMockRepositories(options: MockOptions = {}): {
  letters: LetterRepository
  profiles: ProfileRepository
} {
  const profiles = seedProfiles(options.unlinked ?? false)
  const letters = seedLetters()

  const findProfile = (id: string) => profiles.find((p) => p.id === id)

  const letterRepository: LetterRepository = {
    async listReceived(userId) {
      const received = letters
        .filter((l) => l.receiverId === userId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(received.map((l) => ({ ...l })))
    },

    async send({ senderId, receiverId, message }: SendLetterInput) {
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)

      const letter: Letter = {
        id: `letter-${crypto.randomUUID()}`,
        senderId,
        receiverId,
        message: message.trim(),
        createdAt: new Date().toISOString(),
        isRead: false,
        shareSlug: null,
        isPublic: false,
      }
      letters.push(letter)
      return ok({ ...letter })
    },

    async markRead(letterId) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      letter.isRead = true
      return ok({ ...letter })
    },

    async share(letterId) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      // Reuse an existing slug so links already sent keep resolving.
      letter.shareSlug = letter.shareSlug ?? generateSlug()
      letter.isPublic = true
      return ok({ ...letter })
    },

    async getBySlug(slug) {
      const letter = letters.find((l) => l.shareSlug === slug && l.isPublic)
      if (!letter) return fail('This letter is not available.')
      const view: PublicLetter = {
        message: letter.message,
        createdAt: letter.createdAt,
        senderName: findProfile(letter.senderId)?.fullName ?? 'Someone',
        receiverName: findProfile(letter.receiverId)?.fullName ?? 'you',
      }
      return ok(view)
    },
  }

  const profileRepository: ProfileRepository = {
    async getById(id) {
      const profile = findProfile(id)
      return profile ? ok({ ...profile }) : fail('Profile not found.')
    },

    async getByInviteCode(inviteCode) {
      const profile = profiles.find((p) => p.inviteCode === inviteCode)
      return profile ? ok({ ...profile }) : fail('That invite link is not valid.')
    },

    async linkPartner(userId, inviteCode) {
      const self = findProfile(userId)
      if (!self) return fail('Profile not found.')
      if (self.partnerId) return fail('You are already connected.')

      const other = profiles.find((p) => p.inviteCode === inviteCode)
      if (!other) return fail('That invite link is not valid.')
      if (other.id === self.id) return fail('That invite link is your own.')
      if (other.partnerId) return fail('You are already connected.')

      // Both sides in one step: the link must not half-apply.
      self.partnerId = other.id
      other.partnerId = self.id
      return ok({ ...self })
    },
  }

  return { letters: letterRepository, profiles: profileRepository }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, 28 tests total.

- [ ] **Step 5: Add the adapter selection module**

Create `src/data/index.ts`:

```ts
import { createMockRepositories, MOCK_USER_ID } from './mockRepository'

/**
 * The single swap point between mock and real data.
 *
 * Phase 3 adds `createSupabaseRepositories()` and selects it here when
 * VITE_SUPABASE_URL is present. Nothing above this module changes.
 */
const repositories = createMockRepositories()

export const letterRepository = repositories.letters
export const profileRepository = repositories.profiles

/** Stands in for the signed-in user until auth arrives in Phase 3. */
export const currentUserId = MOCK_USER_ID

export type { Letter, Profile, PublicLetter, Result } from './types'
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add in-memory repositories with full contract tests"
```

---

### Task 7: The letters hook

**Files:**
- Create: `src/hooks/useLetters.ts`

**Interfaces:**
- Consumes: `letterRepository`, `profileRepository`, `currentUserId` from `src/data/index.ts`
- Produces: `useLetters()` returning `{ letters: Letter[]; partnerName: string; loading: boolean; error: string | null; sendLetter(message: string): Promise<{ ok: boolean; error?: string }>; markRead(id: string): Promise<void> }`

There is no test for this task. It is a thin binding over the repository, whose behaviour Task 6 already covers, and the light-testing decision excludes React component and hook tests.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useLetters.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { currentUserId, letterRepository, profileRepository } from '../data'
import type { Letter } from '../data/types'

interface UseLetters {
  letters: Letter[]
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(message: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
}

/** Loads the inbox once on mount and keeps it in sync with local actions. */
export function useLetters(): UseLetters {
  const [letters, setLetters] = useState<Letter[]>([])
  const [partnerName, setPartnerName] = useState('')
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const inbox = await letterRepository.listReceived(currentUserId)
      const me = await profileRepository.getById(currentUserId)
      if (cancelled) return

      if (inbox.error) setError(inbox.error)
      else setLetters(inbox.data)

      if (me.data?.partnerId) {
        setPartnerId(me.data.partnerId)
        const partner = await profileRepository.getById(me.data.partnerId)
        if (!cancelled && partner.data) setPartnerName(partner.data.fullName)
      }
      if (!cancelled) setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message) => {
      if (!partnerId) return { ok: false, error: 'You are not connected to anyone yet.' }
      const result = await letterRepository.send({
        senderId: currentUserId,
        receiverId: partnerId,
        message,
      })
      if (result.error) return { ok: false, error: result.error }
      return { ok: true }
    },
    [partnerId],
  )

  const markRead = useCallback<UseLetters['markRead']>(async (id) => {
    // Optimistic: the dot disappears the instant the letter opens.
    setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: true } : l)))
    await letterRepository.markRead(id)
  }, [])

  return { letters, partnerName, loading, error, sendLetter, markRead }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add useLetters hook over the repository layer"
```

---

### Task 8: Letter card and inbox

**Files:**
- Create: `src/components/LetterCard.tsx`, `src/routes/Inbox.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `PaperTexture`, `Layout`, `useLetters`, `formatLetterDate`, `snippet`, type `Letter`
- Produces: `<LetterCard letter: Letter; senderName: string; onOpen: (letter: Letter) => void />` and the default-exported `Inbox` route

- [ ] **Step 1: Write the letter card**

Create `src/components/LetterCard.tsx`:

```tsx
import { motion } from 'framer-motion'
import { PaperTexture } from '../design/PaperTexture'
import { formatLetterDate, snippet } from '../lib/format'
import type { Letter } from '../data/types'

interface LetterCardProps {
  letter: Letter
  senderName: string
  onOpen: (letter: Letter) => void
}

/** Inbox preview. Hover lifts the shadow rather than moving the card. */
export function LetterCard({ letter, senderName, onOpen }: LetterCardProps) {
  return (
    <motion.button
      type="button"
      layoutId={`letter-${letter.id}`}
      onClick={() => onOpen(letter)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ boxShadow: 'var(--shadow-letter-lifted)' }}
      className="w-full rounded-letter text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      <PaperTexture className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <span className="font-hand text-2xl text-ink-ui">{senderName}</span>
          {!letter.isRead && (
            <span
              aria-label="Unread"
              className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
            />
          )}
        </div>
        <p className="mt-3 font-letter text-[15px] leading-relaxed text-ink-letter">
          {snippet(letter.message, 140)}
        </p>
        <p className="mt-4 font-ui text-xs tracking-wide text-ink-muted">
          {formatLetterDate(letter.createdAt)}
        </p>
      </PaperTexture>
    </motion.button>
  )
}
```

- [ ] **Step 2: Write the inbox route**

Create `src/routes/Inbox.tsx`:

```tsx
import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { useLetters } from '../hooks/useLetters'
import type { Letter } from '../data/types'

export default function Inbox() {
  const { letters, partnerName, loading, error, markRead } = useLetters()
  const [open, setOpen] = useState<Letter | null>(null)

  function handleOpen(letter: Letter) {
    setOpen(letter)
    if (!letter.isRead) void markRead(letter.id)
  }

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">Opening the post…</p>
  }

  if (error) {
    return <p className="py-20 text-center font-ui text-sm text-accent">{error}</p>
  }

  if (letters.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">No letters yet</p>
        <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
          When {partnerName || 'they'} write to you, it will arrive here.
        </p>
        <Link
          to="/compose"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
        >
          Write the first one
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        {letters.map((letter) => (
          <LetterCard
            key={letter.id}
            letter={letter}
            senderName={partnerName}
            onOpen={handleOpen}
          />
        ))}
      </div>
      {/* LetterModal is mounted here in Task 9. */}
      <AnimatePresence>{null}</AnimatePresence>
    </>
  )
}
```

- [ ] **Step 3: Wire the router**

Replace `src/app/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '../components/Layout'
import Inbox from '../routes/Inbox'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Inbox />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`
Expected: three seeded letters in a two-column grid on desktop and one column at 375px. The newest carries a small terracotta dot; the other two do not. Cards fade and rise in on load. Hovering deepens the shadow without shifting the card. Clicking one removes its dot.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add letter card and inbox grid"
```

---

### Task 9: The unfolding letter view

**Files:**
- Create: `src/components/LetterModal.tsx`
- Modify: `src/routes/Inbox.tsx`

**Interfaces:**
- Consumes: `PaperTexture`, `formatLetterDate`, type `Letter`
- Produces: `<LetterModal letter: Letter | null; senderName: string; receiverName: string; onClose: () => void />`

- [ ] **Step 1: Write the modal**

Create `src/components/LetterModal.tsx`:

```tsx
import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import { formatLetterDate } from '../lib/format'
import type { Letter } from '../data/types'

interface LetterModalProps {
  letter: Letter
  senderName: string
  receiverName: string
  onClose: () => void
}

/**
 * The reading view. The panel carries the same layoutId as its card, so
 * Framer Motion grows it out of the card's position — the movement that
 * reads as a letter unfolding rather than a dialog appearing.
 */
export function LetterModal({ letter, senderName, receiverName, onClose }: LetterModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10 sm:py-16"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-ink-ui/25 backdrop-blur-[2px]" aria-hidden />

      <motion.div
        layoutId={`letter-${letter.id}`}
        onClick={(event) => event.stopPropagation()}
        transition={{ type: 'spring', stiffness: 210, damping: 26 }}
        className="relative w-full max-w-[600px]"
      >
        <PaperTexture className="p-8 sm:p-12">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close letter"
            className="absolute right-4 top-4 rounded-full p-2 text-ink-muted transition-colors hover:text-accent"
          >
            <X size={18} />
          </button>

          <p className="font-letter text-lg text-ink-letter">Dear {receiverName},</p>

          <p className="mt-6 whitespace-pre-wrap font-letter text-[17px] leading-[1.85] text-ink-letter">
            {letter.message}
          </p>

          <div className="mt-10 text-right">
            <p className="font-hand text-3xl text-ink-ui">With love, {senderName}</p>
            <p className="mt-2 font-ui text-xs tracking-wide text-ink-muted">
              {formatLetterDate(letter.createdAt)}
            </p>
          </div>
        </PaperTexture>
      </motion.div>
    </motion.div>
  )
}
```

Note the empty top-right area beside the close button: Phase 4 places the share control there.

- [ ] **Step 2: Mount the modal in the inbox**

In `src/routes/Inbox.tsx`, add the import:

```tsx
import { LetterModal } from '../components/LetterModal'
```

and replace the placeholder block:

```tsx
      <AnimatePresence>{null}</AnimatePresence>
```

with:

```tsx
      <AnimatePresence>
        {open && (
          <LetterModal
            letter={open}
            senderName={partnerName}
            receiverName="you"
            onClose={() => setOpen(null)}
          />
        )}
      </AnimatePresence>
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`
Expected: clicking a card grows it into a centred panel at most 600px wide; the background dims and blurs slightly. Closing returns the panel to the card's position rather than fading out. Escape closes it, clicking the dimmed background closes it, and clicking the letter itself does not. The body scroll is locked while open. In macOS System Settings, enable Reduce Motion and confirm the transition becomes instant rather than broken.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add unfolding letter reading view"
```

---

### Task 10: Compose

**Files:**
- Create: `src/components/ComposeLetter.tsx`, `src/routes/Compose.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `PaperTexture`, `useLetters`, `validateLetter`, `MAX_LETTER_LENGTH`
- Produces: `<ComposeLetter partnerName: string; onSend: (message: string) => Promise<{ ok: boolean; error?: string }> />` and the default-exported `Compose` route

- [ ] **Step 1: Write the compose form**

Create `src/components/ComposeLetter.tsx`:

```tsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import { MAX_LETTER_LENGTH, validateLetter } from '../lib/validation'

interface ComposeLetterProps {
  partnerName: string
  onSend: (message: string) => Promise<{ ok: boolean; error?: string }>
}

/** A blank page. Nothing on screen competes with the writing. */
export function ComposeLetter({ partnerName, onSend }: ComposeLetterProps) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const words = message.trim() === '' ? 0 : message.trim().split(/\s+/).length
  const valid = validateLetter(message).ok

  async function handleSend() {
    const validation = validateLetter(message)
    if (!validation.ok) {
      setError(validation.reason)
      return
    }
    setSending(true)
    const result = await onSend(message)
    setSending(false)
    if (result.ok) setMessage('')
    else setError(result.error ?? 'The letter could not be sent.')
  }

  return (
    <div className="mx-auto max-w-[600px]">
      <PaperTexture className="p-8 sm:p-12">
        <p className="font-letter text-lg text-ink-letter">Dear {partnerName || 'you'},</p>

        <textarea
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            if (error) setError(null)
          }}
          rows={12}
          maxLength={MAX_LETTER_LENGTH}
          autoFocus
          placeholder="Tell them what you were thinking about this morning…"
          className="mt-5 w-full resize-none bg-transparent font-letter text-[17px] leading-[1.85] text-ink-letter placeholder:text-ink-muted/60 focus:outline-none"
        />

        <div className="mt-6 flex items-center justify-between border-t border-paper-edge pt-5">
          <span className="font-ui text-xs text-ink-muted">
            {words} {words === 1 ? 'word' : 'words'}
          </span>

          <motion.button
            type="button"
            onClick={handleSend}
            disabled={!valid || sending}
            whileHover={valid && !sending ? { boxShadow: 'var(--shadow-letter-lifted)' } : undefined}
            whileTap={valid && !sending ? { scale: 0.97 } : undefined}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={15} />
            {sending ? 'Sending…' : 'Send letter'}
          </motion.button>
        </div>

        {error && <p className="mt-4 font-ui text-sm text-accent">{error}</p>}
      </PaperTexture>
    </div>
  )
}
```

- [ ] **Step 2: Write the compose route**

Create `src/routes/Compose.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { ComposeLetter } from '../components/ComposeLetter'
import { useLetters } from '../hooks/useLetters'

export default function Compose() {
  const { partnerName, sendLetter } = useLetters()
  const navigate = useNavigate()

  return (
    <ComposeLetter
      partnerName={partnerName}
      onSend={async (message) => {
        const result = await sendLetter(message)
        if (result.ok) navigate('/')
        return result
      }}
    />
  )
}
```

- [ ] **Step 3: Add the route**

In `src/app/App.tsx`, add the import:

```tsx
import Compose from '../routes/Compose'
```

and add the route inside `<Routes>`:

```tsx
          <Route path="/compose" element={<Compose />} />
```

- [ ] **Step 4: Verify the full flow**

Run: `npm run dev`
Expected:
1. "Write a letter" in the header opens a blank paper page with the cursor already in the body.
2. The Send button is dimmed and unclickable while the page is empty.
3. The word count increments as you type and reads "1 word" at one word.
4. Sending returns you to the inbox.
5. The sent letter does **not** appear in your own inbox — it was addressed to your partner, and the inbox shows received letters only. This is correct behaviour; a "sent" folder is deliberately out of scope for v1.

- [ ] **Step 5: Run the full suite and type-check**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 28 tests pass, no type errors, build succeeds.

**Phase 2 exit criteria met when this step passes.**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add compose screen and complete the mock-data experience"
```

---

## What Phases 1 and 2 deliberately leave out

These are Phase 3+ and must not be built here:

- Any Supabase client, schema, or policy file
- Authentication, setup, and the `/join/:inviteCode` route
- The share button, public `/letter/:slug` route, and toast
- A sent folder, delete, realtime, and multiple letter fonts

The `share`, `getBySlug`, and `linkPartner` methods exist and are tested on the mock so the interface is settled before the Supabase adapter implements it. No UI calls them yet.
