# Composer, Live Delivery and Reading View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a writer address a letter their own way and choose its face, let them back out of writing it, make letters arrive without a reload, make the reading view look like paper, and sign the app in the footer.

**Architecture:** A letter gains two nullable presentation columns — `salutation` and `body_font` — where null means "the old behaviour", so every existing letter is untouched. A `usePoll` hook refetches while the tab is visible. A shared `LetterSheet` component renders the letter for both the recipient and a stranger, so the two cannot drift again.

**Tech Stack:** Postgres 15 (Supabase), PostgREST, React 19, TypeScript, Vitest, Tailwind v4, Fontsource.

**Spec:** `docs/superpowers/specs/2026-09-14-composer-delivery-reading-design.md`

## Global Constraints

- **`npm run typecheck` (`tsc -b`) is THE type gate.** `npx tsc --noEmit` type-checks zero files in this repo and always exits 0. It is never evidence.
- **Every task ends green:** `npm run typecheck && npm test && npm run lint && npm run build`.
- **Lint baseline is THREE `set-state-in-effect` warnings** (`useLetters.ts`, `usePublicLetter.ts`, `useBonds.ts`). **Task 6 raises it to FOUR** by adding `usePoll.ts` — that one is expected and must be named, not silenced. Never add an `eslint-disable`, and never delete state management to dodge a warning.
- **The 60 existing contract cases must pass unchanged.** A break means the implementation is wrong, not the test. Never edit an existing test to accommodate new behaviour.
- **The mock has no RLS and no check constraints.** Whatever the database enforces, the mock reimplements in TypeScript, or development and production diverge. This project has been bitten by that four times.
- Repository methods return `{ data, error }` and NEVER throw; every Supabase body goes through `guard()`.
- **Never narrow a `Result` with a truthiness check.** Use `=== null` / `!== null` — the empty string is a falsy `string` and will not narrow. Supabase's own `error` objects are a different shape; `if (error)` is correct for those.
- Read methods return copies, never references into the store.
- **Components under `src/components/` must not import VALUES from `src/data/`.** `import type` is fine. Routes and hooks may import values.
- **SQL must stay idempotent:** `add column if not exists`, `drop constraint if exists` before `add constraint`, `create or replace function`, `drop trigger if exists` before `create trigger`. Every function carries `set search_path = public, pg_temp` except `new_invite_code`, which needs `public, extensions, pg_temp`.
- **ALL SQL IN THIS PLAN IS UNEXECUTED.** Nobody has database access. No task may claim a migration ran. Applying it is the owner's step (Task 14).
- Never pure white `#FFFFFF` or pure black `#000000`. The palette is fixed: `#FDFBF7`, `#F4EFE6`, `#2C2825`, `#1A1A1A` at 85%, `#C87963`, `#D4AF37`, plus `--color-paper-edge`, `--color-ink-muted`, `--color-accent-soft`.
- **A misspelled Tailwind token emits NO CSS and fails silently.** Check every class against `src/design/tokens.css`.
- Widths use `max-w-*` caps, never fixed `w-[…]` or `min-w-`.
- All animation goes through the single `<MotionConfig reducedMotion="user">` in `src/app/App.tsx`. Never add a per-component `prefers-reduced-motion` guard.
- Tests are logic-level only. No component tests, no hook tests, no jsdom, no Testing Library. `usePoll`, the composer and `LetterSheet` get NO tests — deliberate, not an omission.
- **Every commit message ends with these two trailers:**

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TRa82VR1nNNbiQhY6UKUaq
  ```

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/schema.sql` | modify | Two columns, two check constraints, `enforce_letter_update` immutability, `get_public_letter` signature |
| `supabase/policies.sql` | modify | Widened insert column grant |
| `src/lib/validation.ts` | modify | `BODY_FONTS`, salutation and font validation |
| `src/lib/validation.test.ts` | modify | New logic-level cases |
| `src/data/types.ts` | modify | `BodyFont`, `Letter.salutation`/`bodyFont`, `PublicLetter` additions, `SendLetterInput` additions |
| `src/data/mockRepository.ts` | modify | Store, validate and return both fields |
| `src/data/supabaseRepository.ts` | modify | Map both columns, send both, read both from the RPC |
| `src/data/contractTests.ts` | modify | New contract cases |
| `src/design/letterFonts.ts` | create | The five faces, their CSS stacks, and the dynamic loader |
| `src/components/ComposeLetter.tsx` | modify | Inline salutation, font picker, cancel |
| `src/routes/Compose.tsx` | modify | Wire cancel to navigation |
| `src/hooks/usePoll.ts` | create | Visibility-aware interval |
| `src/hooks/useLetters.ts` | modify | Poll, and guard the optimistic read receipt |
| `src/routes/Inbox.tsx` | modify | Derive the open letter instead of capturing it |
| `src/routes/Archive.tsx` | modify | Same |
| `src/routes/Chapter.tsx` | modify | Same |
| `src/components/LetterSheet.tsx` | create | The shared paper: crease, deckle, margins, postmark |
| `src/components/LetterModal.tsx` | modify | Render `LetterSheet`; fix tap targets |
| `src/routes/PublicLetter.tsx` | modify | Render `LetterSheet` |
| `src/components/LetterCard.tsx` | modify | Preview in the letter's face |
| `src/components/Layout.tsx` | modify | Footer |
| `CLAUDE.md` | modify | **Amend the three-type-role rule** |
| `README.md` | modify | Phase 7 build record |

**Task order and why.** Tasks 1–5 are sub-project A and must come first: C renders the font that A introduces. Task 6–8 are sub-project B, independent of A. Tasks 9–12 are C. Task 13 is D and depends on nothing. If work stops early, any of these boundaries leaves a coherent product.

---

### Task 1: The two columns and their constraints

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `letters.salutation`, `letters.body_font`, constraints `letters_body_font_known` and `letters_salutation_length`

- [ ] **Step 1: Add the columns beside the existing letter alters**

In `supabase/schema.sql`, after the existing `alter table letters add column if not exists receiver_name text;` line, add:

```sql
-- Presentation, chosen by the writer, carried by the letter forever.
--
-- BOTH ARE NULLABLE AND NULL MEANS "the old behaviour". A null salutation
-- renders the recipient's name exactly as it always did; a null body_font
-- renders Lora. Every letter written before this change has nulls in both and
-- must keep looking precisely as it looks now — which is why neither column
-- gets a non-null default. A default would silently restyle correspondence
-- people have already read.
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

- [ ] **Step 2: Make both immutable after writing**

In `enforce_letter_update`, extend the existing immutability check. Find:

```sql
  if new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
    raise exception 'IMMUTABLE_COLUMN';
  end if;
```

and replace it with:

```sql
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

- [ ] **Step 3: Verify idempotency held**

Run: `grep -c "if not exists" supabase/schema.sql`
Expected: increased by exactly 2 from before this task.

Run: `grep -c "drop constraint if exists" supabase/schema.sql`
Expected: increased by exactly 2. Every `add constraint` in this file must have a matching `drop constraint if exists` immediately before it, or a second run of the file fails against the live project.

Run: `grep -n "add  constraint\|add constraint" supabase/schema.sql`
Report each hit and confirm a drop precedes it.

- [ ] **Step 4: Verify nothing in the app moved**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 60 tests across 4 files, **three** `set-state-in-effect` warnings, build succeeds. No TypeScript changed in this task, so anything else is a signal something unexpected happened — report it rather than fixing it.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(sql): a letter carries its salutation and its face"
```

State in the commit body that the SQL is unexecuted.

---

### Task 2: `get_public_letter` returns them, and the insert grant widens

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `supabase/policies.sql`

**Interfaces:**
- Consumes: the columns from Task 1
- Produces: `get_public_letter` returning 6 columns; insert grant covering 5 columns

- [ ] **Step 1: Drop the function before replacing it**

`get_public_letter`'s return type is changing, and **Postgres refuses `create or replace function` when the OUT columns differ** — it fails with `cannot change return type of existing function`. This is the one statement in this plan that is not simply re-runnable.

Immediately BEFORE the existing `create or replace function get_public_letter(slug text)`, add:

```sql
-- The return type gains two columns below, and `create or replace` cannot
-- change a function's OUT columns — it fails with "cannot change return type
-- of existing function". This drop is what makes the file re-runnable.
drop function if exists get_public_letter(text);
```

- [ ] **Step 2: Add the two columns to the function**

Replace the function's `returns table (...)` block and its select with:

```sql
returns table (
  message       text,
  created_at    timestamptz,
  sender_name   text,
  receiver_name text,
  salutation    text,
  body_font     text
)
```

and in the select, add the two columns after the receiver name:

```sql
  select l.message,
         l.created_at,
         coalesce(sender.full_name, l.sender_name),
         coalesce(receiver.full_name, l.receiver_name),
         l.salutation,
         l.body_font
```

Leave every `where` clause exactly as it is — the delete checks and the
deliberate absence of an archive clause are load-bearing and documented in
place.

- [ ] **Step 3: Widen the insert grant**

In `supabase/policies.sql`, find:

```sql
grant insert (sender_id, receiver_id, message) on letters to authenticated;
```

and replace with:

```sql
-- salutation and body_font join the insert grant: the writer chooses both when
-- they write, and enforce_letter_update makes them immutable afterwards. The
-- grant is what allows setting them at all; the trigger is what stops them
-- changing later.
grant insert (sender_id, receiver_id, message, salutation, body_font)
  on letters to authenticated;
```

Note `bond_id` and `sent_at` are still deliberately absent — a client that could set `bond_id` could file a letter into someone else's chapter.

- [ ] **Step 4: Verify**

Run: `grep -n "drop function if exists get_public_letter" supabase/schema.sql`
Expected: exactly one hit, positioned before the `create or replace function get_public_letter` line. If it is missing, re-running `schema.sql` against the live project fails.

Run: `grep -n "grant insert" supabase/policies.sql`
Expected: one hit naming exactly `sender_id, receiver_id, message, salutation, body_font`. If `bond_id` or `sent_at` appears there, a client can file letters into arbitrary chapters.

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: unchanged — typecheck silent, 60 tests, three warnings, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/policies.sql
git commit -m "feat(sql): the public page can see how a letter was addressed"
```

---

### Task 3: Validation, in TypeScript

**Files:**
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/validation.test.ts`

**Interfaces:**
- Produces: `BODY_FONTS`, `MAX_SALUTATION_LENGTH`, `validateSalutation`, `validateBodyFont`

- [ ] **Step 1: Write the failing tests**

In `src/lib/validation.test.ts`, add:

```ts
describe('validateSalutation', () => {
  it('accepts null — the letter uses the recipient name', () => {
    expect(validateSalutation(null).ok).toBe(true)
  })

  it('accepts an ordinary salutation', () => {
    expect(validateSalutation('my love').ok).toBe(true)
  })

  it('rejects an empty or whitespace-only salutation', () => {
    expect(validateSalutation('').ok).toBe(false)
    expect(validateSalutation('   ').ok).toBe(false)
  })

  it('rejects one longer than the column allows', () => {
    expect(validateSalutation('a'.repeat(MAX_SALUTATION_LENGTH)).ok).toBe(true)
    expect(validateSalutation('a'.repeat(MAX_SALUTATION_LENGTH + 1)).ok).toBe(false)
  })
})

describe('validateBodyFont', () => {
  it('accepts null — the letter uses the default face', () => {
    expect(validateBodyFont(null).ok).toBe(true)
  })

  it('accepts every font in the published set', () => {
    for (const font of BODY_FONTS) {
      expect(validateBodyFont(font.id).ok).toBe(true)
    }
  })

  it('rejects a font outside the set', () => {
    expect(validateBodyFont('comic-sans').ok).toBe(false)
    expect(validateBodyFont('').ok).toBe(false)
  })

  it('rejects a CSS injection attempt', () => {
    expect(validateBodyFont('lora; background: url(x)').ok).toBe(false)
  })
})
```

Add `validateSalutation`, `validateBodyFont`, `BODY_FONTS` and `MAX_SALUTATION_LENGTH` to the file's existing import from `./validation`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test`
Expected: FAIL — the four functions do not exist. If the failure is an import or syntax error rather than a missing export, fix that first; a test failing for the wrong reason proves nothing.

- [ ] **Step 3: Implement**

In `src/lib/validation.ts`, append:

```ts
/** The salutation column is `check (char_length between 1 and 60)`. */
export const MAX_SALUTATION_LENGTH = 60

/**
 * The five faces a letter may be written in. `id` is what is stored and what
 * the check constraint allows; `stack` is the CSS font-family; `label` is what
 * the picker shows, set in the face itself.
 *
 * Adding to this list means ALSO adding to the check constraint in
 * schema.sql and to the loader in src/design/letterFonts.ts. All three must
 * agree or a letter becomes unwritable, unreadable, or unstyled.
 */
export const BODY_FONTS = [
  { id: 'lora', label: 'Lora', stack: "'Lora', ui-serif, Georgia, serif" },
  { id: 'eb-garamond', label: 'EB Garamond', stack: "'EB Garamond', ui-serif, Georgia, serif" },
  { id: 'courier-prime', label: 'Courier Prime', stack: "'Courier Prime', ui-monospace, monospace" },
  { id: 'caveat', label: 'Caveat', stack: "'Caveat', ui-serif, cursive" },
  { id: 'dancing-script', label: 'Dancing Script', stack: "'Dancing Script', ui-serif, cursive" },
] as const

export type BodyFont = (typeof BODY_FONTS)[number]['id']

const FONT_IDS: readonly string[] = BODY_FONTS.map((f) => f.id)

/** Null means "use the recipient's name", which is always valid. */
export function validateSalutation(salutation: string | null): ValidationResult {
  if (salutation === null) return { ok: true }
  if (salutation.trim().length === 0) {
    return { ok: false, reason: 'A salutation needs a word, or leave it as their name.' }
  }
  if (salutation.length > MAX_SALUTATION_LENGTH) {
    return { ok: false, reason: 'That salutation is a little too long.' }
  }
  return { ok: true }
}

/** Null means "use the default face", which is always valid. */
export function validateBodyFont(bodyFont: string | null): ValidationResult {
  if (bodyFont === null) return { ok: true }
  if (!FONT_IDS.includes(bodyFont)) {
    return { ok: false, reason: 'That is not a font this app can write in.' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run them green**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, **68 tests across 4 files** (60 + 8 new), three `set-state-in-effect` warnings, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: the five faces a letter may be written in"
```

---

### Task 4: The data layer carries both fields

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/data/mockRepository.ts`
- Modify: `src/data/supabaseRepository.ts`
- Modify: `src/data/contractTests.ts`

**Interfaces:**
- Consumes: `BodyFont`, `validateSalutation`, `validateBodyFont` from Task 3
- Produces: `Letter.salutation`, `Letter.bodyFont`, `PublicLetter.salutation`, `PublicLetter.bodyFont`, `SendLetterInput.salutation`, `SendLetterInput.bodyFont`

- [ ] **Step 1: Extend the types**

In `src/data/types.ts`, re-export the font type and add the fields.

To `interface Letter`, after `receiverName`:

```ts
  /**
   * How the writer addressed the recipient. Null means the recipient's name,
   * which is how every letter written before this feature reads.
   */
  salutation: string | null
  /** The face the letter was written in. Null means the default, Lora. */
  bodyFont: BodyFont | null
```

To `interface PublicLetter`, the same two fields — a stranger must see the letter as it was written, and the public page is the one a sender chooses to show people.

To `interface SendLetterInput`:

```ts
  /** Null leaves the recipient's name as the salutation. */
  salutation: string | null
  /** Null leaves the default face. */
  bodyFont: BodyFont | null
```

Add `import type { BodyFont } from '../lib/validation'` and re-export it: `export type { BodyFont }`.

- [ ] **Step 2: Write the failing contract cases**

In `src/data/contractTests.ts`, add:

```ts
    describe('salutation and face', () => {
      it('stores and returns both', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Written in a particular hand.',
          salutation: 'my love',
          bodyFont: 'courier-prime',
        })
        expect(sent.error).toBe(null)
        expect(sent.data!.salutation).toBe('my love')
        expect(sent.data!.bodyFont).toBe('courier-prime')
      })

      it('accepts null for both, which is how older letters read', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Plain, like the ones before.',
          salutation: null,
          bodyFont: null,
        })
        expect(sent.error).toBe(null)
        expect(sent.data!.salutation).toBe(null)
        expect(sent.data!.bodyFont).toBe(null)
      })

      it('leaves the seeded letters untouched', async () => {
        const existing = await fx.letters.listConversation(fx.userId)
        expect(existing.error).toBe(null)
        for (const letter of existing.data!) {
          expect(letter.salutation).toBe(null)
          expect(letter.bodyFont).toBe(null)
        }
      })

      it('refuses a font outside the published set', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Should not send.',
          salutation: null,
          bodyFont: 'comic-sans' as never,
        })
        expect(sent.error).not.toBe(null)
      })

      it('refuses a salutation longer than the column allows', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Should not send.',
          salutation: 'a'.repeat(61),
          bodyFont: null,
        })
        expect(sent.error).not.toBe(null)
      })

      it('a shared letter carries both to the public view', async () => {
        const sent = (
          await fx.letters.send({
            senderId: fx.userId,
            receiverId: fx.partnerId,
            message: 'For anyone with the link.',
            salutation: 'dearest',
            bodyFont: 'dancing-script',
          })
        ).data!
        await fx.letters.setShared(sent.id, true)
        const reread = (await fx.letters.listConversation(fx.userId)).data!.find(
          (l) => l.id === sent.id,
        )!
        const view = await fx.letters.getBySlug(reread.shareSlug!)
        expect(view.error).toBe(null)
        expect(view.data!.salutation).toBe('dearest')
        expect(view.data!.bodyFont).toBe('dancing-script')
      })
    })
```

- [ ] **Step 3: Run them and watch them fail for the right reason**

Run: `npm test`
Expected: FAIL — `send` does not accept the new fields. A TypeScript error inside the test file is the expected shape here.

- [ ] **Step 4: Implement in the mock**

In `src/data/mockRepository.ts`:

Add to the `base` object in `seedLetters` so the seeded letters read as pre-feature letters:

```ts
    salutation: null,
    bodyFont: null,
```

In `send`, validate both alongside the message and store them. The validation
mirrors the check constraints, because the mock has none:

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

and in the constructed letter:

```ts
        salutation: salutation === null ? null : salutation.trim(),
        bodyFont,
```

In `getBySlug`, return both on the `PublicLetter` view.

Import `validateSalutation` and `validateBodyFont` from `../lib/validation`.

- [ ] **Step 5: Implement in the adapter**

In `src/data/supabaseRepository.ts`:

Add to `interface LetterRow`:

```ts
  salutation: string | null
  body_font: BodyFont | null
```

Add to `toLetter`:

```ts
  salutation: r.salutation,
  bodyFont: r.body_font,
```

**This mapping is the project's most expensive recurring bug.** If a column is named in `LetterRow` but absent from the live table, the mapped value is `undefined`, TypeScript cannot tell, and a `!== null` check reads it as present. Task 14's live probe exists for exactly this.

In `send`, pass both through the insert, and validate before the round trip the same way `message` already is. In `getBySlug`, read the two new columns off the RPC's row and return them.

- [ ] **Step 6: Run everything green**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, **74 tests across 4 files** (68 + 6 new), three warnings, build succeeds.

If any of the original 60 fails, the seeded letters are missing their null fields — fix the mock, never the test.

- [ ] **Step 7: Commit**

```bash
git add src/data/types.ts src/data/mockRepository.ts src/data/supabaseRepository.ts src/data/contractTests.ts
git commit -m "feat(data): letters carry a salutation and a face"
```

---

### Task 5: The font loader

**Files:**
- Create: `src/design/letterFonts.ts`

**Interfaces:**
- Consumes: `BODY_FONTS`, `BodyFont` from Task 3
- Produces: `fontStack(bodyFont)`, `loadLetterFont(bodyFont)`

- [ ] **Step 1: Add the three new Fontsource packages**

```bash
npm install @fontsource/eb-garamond @fontsource/courier-prime @fontsource/dancing-script
```

- [ ] **Step 2: Write the loader**

Create `src/design/letterFonts.ts`:

```ts
import { BODY_FONTS, type BodyFont } from '../lib/validation'

/**
 * The CSS font-family for a letter's chosen face. Null — an older letter, or
 * one whose writer did not choose — gets Lora, which is what every letter
 * looked like before the choice existed.
 */
export function fontStack(bodyFont: BodyFont | null): string {
  const id = bodyFont ?? 'lora'
  return BODY_FONTS.find((f) => f.id === id)?.stack ?? BODY_FONTS[0].stack
}

/**
 * Loads a letter's face on demand.
 *
 * Lora, Caveat and Plus Jakarta Sans ship eagerly from src/design/fonts.ts
 * because the app chrome uses them. The other three are imported only when a
 * letter actually calls for one — a stranger opening a Lora letter downloads
 * nothing extra, and one opening a Courier Prime letter downloads one family.
 *
 * This is what preserves the work that got a stranger's first load of a shared
 * letter to 133 kB gzipped. Declaring all six eagerly would put three more
 * families of @font-face subset declarations on the public route's critical
 * path for a face most letters will not use.
 *
 * Failure is deliberately silent: the fallback in every stack is a real serif,
 * so a letter whose face fails to load is still perfectly readable, and an
 * error banner about a font would be worse than the substitution.
 */
export async function loadLetterFont(bodyFont: BodyFont | null): Promise<void> {
  try {
    switch (bodyFont) {
      case 'eb-garamond':
        await import('@fontsource/eb-garamond/400.css')
        return
      case 'courier-prime':
        await import('@fontsource/courier-prime/400.css')
        return
      case 'dancing-script':
        await import('@fontsource/dancing-script/400.css')
        return
      // 'lora', 'caveat' and null need nothing — already loaded eagerly.
      default:
        return
    }
  } catch {
    // See the note above: the fallback stack carries it.
  }
}
```

The `switch` uses literal import specifiers rather than a template string on purpose — a bundler cannot statically analyse `import(\`@fontsource/${id}/400.css\`)`, and would either fail to split them or inline all three.

- [ ] **Step 3: Verify the split actually happens**

Run: `npm run build`
Expected: `dist/assets/` gains separate small CSS chunks for the three new families, and the main CSS bundle does NOT grow by three families' worth of `@font-face` declarations.

Run: `ls -la dist/assets/*.css`
Report every CSS file and its size. Compare the main `index-*.css` against its size before this task — it should be essentially unchanged. If it grew substantially, the dynamic imports were inlined and the public route regressed; say so rather than reporting success.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck silent, 74 tests, three warnings.

```bash
git add package.json package-lock.json src/design/letterFonts.ts
git commit -m "feat: load a letter's face only when a letter needs it"
```

---

### Task 6: `usePoll`

**Files:**
- Create: `src/hooks/usePoll.ts`

**Interfaces:**
- Produces: `usePoll(callback, intervalMs)`

- [ ] **Step 1: Write the hook**

Create `src/hooks/usePoll.ts`:

```ts
import { useEffect, useRef } from 'react'

/**
 * Runs `callback` on an interval, but ONLY while the tab is visible — and
 * immediately when it becomes visible again.
 *
 * The refocus call is the one that will actually be felt: you switch back to
 * the tab and the letter is already there. The interval is the safety net for
 * someone who leaves the page open.
 *
 * Nothing runs while the tab is hidden. A backgrounded tab polling a database
 * every thirty seconds is a battery cost with no reader to benefit from it.
 *
 * The callback is held in a ref so that a caller passing a fresh closure on
 * every render does not tear the interval down and rebuild it each time —
 * which would mean the timer never actually fires.
 */
export function usePoll(callback: () => void, intervalMs: number): void {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])

  useEffect(() => {
    let timer: number | undefined

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }

    const start = () => {
      stop()
      timer = window.setInterval(() => saved.current(), intervalMs)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        saved.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
}
```

- [ ] **Step 2: Verify, and name the fourth lint warning**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 74 tests, build succeeds.

**Lint may now report a FOURTH `set-state-in-effect` warning.** That is expected — report the exact count and location. Do NOT silence it, do NOT add an `eslint-disable`, and do NOT restructure the hook to dodge it. If the count stays at three, say so; either outcome is fine, but it must be stated.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePoll.ts
git commit -m "feat: a poll that sleeps when nobody is looking"
```

Name the lint count in the commit body.

---

### Task 7: Derive the open letter instead of capturing it

This task fixes a latent bug BEFORE Task 8 makes it live. Do not reorder them.

**Files:**
- Modify: `src/routes/Inbox.tsx`
- Modify: `src/routes/Archive.tsx`
- Modify: `src/routes/Chapter.tsx`

**Interfaces:**
- Produces: an open letter derived from the current list in all three routes

- [ ] **Step 1: Understand what is wrong before changing it**

All three routes hold the open letter as a captured object:

```tsx
const [open, setOpen] = useState<Letter | null>(null)
```

Nothing currently reloads the list while a letter is open, so this is safe today. Task 8 adds polling, which replaces the list underneath the reader — and `open` becomes a snapshot that no longer matches the store. A letter archived on the other device, or edited state arriving from a refetch, leaves the modal showing something that is no longer true.

The codebase already solved this once. Both `Inbox.tsx` and `Archive.tsx` carry a comment explaining why `sharing` is DERIVED from the list rather than captured. Read that comment before you start — you are applying the same fix to `open`.

- [ ] **Step 2: Convert each route**

In each of the three routes, replace the captured state with an id plus a derived lookup, following the existing `sharing` pattern exactly:

```tsx
  const [openId, setOpenId] = useState<string | null>(null)
  // Derived, not captured — the same reason `sharing` is derived. Polling
  // replaces this list while a letter is open, and a captured Letter object
  // would leave the modal rendering a snapshot that no longer matches the
  // store.
  const open = openId === null ? null : (letters.find((l) => l.id === openId) ?? null)
```

In `Archive.tsx` the list is `archived`; in `Chapter.tsx` it is the chapter's `letters`.

Update every `setOpen(letter)` to `setOpenId(letter.id)` and every `setOpen(null)` to `setOpenId(null)`. `Inbox.tsx`'s `handleOpen` still calls `markRead` as it does now.

**A consequence to handle deliberately:** when a letter is deleted, it leaves the list, so `open` becomes null and the modal closes by itself. That is correct and is what you want — but check each route's delete handler does not ALSO call `setOpenId(null)` in a way that fights it, and that nothing throws on the render between the two.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 74 tests, lint count unchanged from Task 6, build succeeds.

Start the dev server. Open a letter, archive it from inside the modal, and confirm the modal closes cleanly rather than erroring. Do the same for delete. Then stop the server. Report what you saw.

- [ ] **Step 4: Commit**

```bash
git add src/routes/Inbox.tsx src/routes/Archive.tsx src/routes/Chapter.tsx
git commit -m "fix: derive the open letter so a reload cannot strand it"
```

---

### Task 8: Poll the letters

**Files:**
- Modify: `src/hooks/useLetters.ts`

**Interfaces:**
- Consumes: `usePoll` from Task 6, derived open letters from Task 7

- [ ] **Step 1: Guard the optimistic read receipt**

`markRead` flips `isRead` optimistically before the write lands. A poll completing mid-flight would overwrite it with the pre-write server value and the unread dot would flicker back on a letter the reader has open.

Add a ref that tracks in-flight mutations, and have the poll skip while one is outstanding:

```ts
  // A poll that lands mid-mutation overwrites the optimistic update with the
  // pre-write server value — the unread dot flickering back on a letter the
  // reader is looking at. A ref, not state: this must not cause a render, and
  // the poll needs the current value, not the one from its closure.
  const mutating = useRef(0)
```

Increment it at the start of `markRead`, `setArchivedFn`, `deleteForMe`, `setSharedFn` and `sendHeldFn`, and decrement in a `finally`.

- [ ] **Step 2: Add the poll**

```ts
  const POLL_INTERVAL_MS = 30_000

  const poll = useCallback(() => {
    if (userId === null) return
    if (mutating.current > 0) return
    // A failed background refresh changes nothing on screen: it must not blank
    // the list and must not set the page error. The reader did not ask for it
    // and cannot act on it, and an error banner appearing on a timer while
    // someone is reading a letter is worse than no banner. The last good list
    // stays. This is deliberately the opposite of the rule for FOREGROUND
    // failures elsewhere in this app — the difference is that a poll has a
    // last-known-good answer to fall back on and a first load does not.
    void load(userId, { silent: true })
  }, [userId, load])

  usePoll(poll, POLL_INTERVAL_MS)
```

Extend `load` to take an optional `{ silent }` so a failing poll skips the `setError` calls and leaves the existing lists in place, while a foreground load behaves exactly as it does now.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 74 tests, build succeeds. Report the lint count.

Start the dev server and leave the inbox open for a minute. Nothing should visibly change, no errors should appear in the console, and the letters should not flicker. Switch to another tab and back; confirm no error appears. Stop the server and report what you saw.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useLetters.ts
git commit -m "feat: letters arrive without a reload"
```

---

### Task 9: The composer

**Files:**
- Modify: `src/components/ComposeLetter.tsx`
- Modify: `src/routes/Compose.tsx`

**Interfaces:**
- Consumes: `BODY_FONTS`, `fontStack`, `loadLetterFont`
- Produces: `ComposeLetter` props `onCancel`; sends `salutation` and `bodyFont`

- [ ] **Step 1: The inline salutation**

Replace the static greeting line:

```tsx
        <p className="font-letter text-lg text-ink-letter">Dear {partnerName || 'you'},</p>
```

with an inline editable field, so it reads as part of the letter rather than as a form control:

```tsx
        <p className="font-letter text-lg text-ink-letter">
          Dear{' '}
          <input
            type="text"
            value={salutation}
            onChange={(event) => setSalutation(event.target.value)}
            maxLength={MAX_SALUTATION_LENGTH}
            placeholder={partnerName || 'you'}
            aria-label="How to address them"
            className="border-b border-paper-edge bg-transparent font-letter text-lg text-ink-letter placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
            size={Math.max((salutation || partnerName || 'you').length, 4)}
          />
          ,
        </p>
```

Leaving it untouched sends `salutation: null` — which is why the placeholder is the partner's name rather than a prompt. Send `salutation.trim() === '' ? null : salutation.trim()`.

- [ ] **Step 2: The font picker at the bottom**

Beside the word count, each option's name set in the face it selects — the only honest way to show a font:

```tsx
          <div className="flex flex-wrap items-center gap-2">
            {BODY_FONTS.map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => {
                  setBodyFont(font.id)
                  void loadLetterFont(font.id)
                }}
                aria-pressed={bodyFont === font.id}
                style={{ fontFamily: font.stack }}
                className={`rounded-full px-3 py-2 text-sm transition-colors ${
                  bodyFont === font.id
                    ? 'bg-accent-soft text-ink-ui'
                    : 'text-ink-muted hover:text-accent'
                }`}
              >
                {font.label}
              </button>
            ))}
          </div>
```

The textarea itself uses `style={{ fontFamily: fontStack(bodyFont) }}` so the writer sees the letter in the face they chose while writing it.

**Load the face when it is picked, not when it is sent** — otherwise the preview shows a fallback and the choice looks broken.

- [ ] **Step 3: Cancel**

Add an `onCancel` prop and a two-step confirm, reusing the inline pattern `LetterModal` already uses for Delete rather than introducing a dialog:

```tsx
  const dirty = message.trim().length > 0

  // Nothing written: leave silently. Something written: ask. Losing ten
  // minutes of writing to someone you miss is the worst failure this screen
  // has, and it is worth one extra tap to prevent.
  function handleCancel() {
    if (!dirty) {
      onCancel()
      return
    }
    setConfirmingCancel(true)
  }
```

Render `Discard this letter?` / `Discard` / `Keep writing` in place of the Cancel button while confirming.

In `src/routes/Compose.tsx`, pass `onCancel={() => navigate('/')}`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 74 tests, build succeeds. Report the lint count.

Start the dev server, write a letter, and check: the textarea renders in the selected face; picking a new face changes it immediately rather than after a delay; Cancel on an empty letter leaves; Cancel with text asks. Stop the server and report each.

- [ ] **Step 5: Commit**

```bash
git add src/components/ComposeLetter.tsx src/routes/Compose.tsx
git commit -m "feat: address a letter your own way, in a face you choose"
```

---

### Task 10: `LetterSheet`

**Files:**
- Create: `src/components/LetterSheet.tsx`

**Interfaces:**
- Consumes: `fontStack`, `loadLetterFont`, `formatLetterDate`
- Produces: `<LetterSheet salutation body bodyFont authorName recipientName createdAt />`

- [ ] **Step 1: Write the component**

Create `src/components/LetterSheet.tsx`. It takes presentation props only and imports NO values from `src/data/` — that is what lets it live under `src/components/`.

```tsx
import { useEffect } from 'react'
import { formatLetterDate } from '../lib/format'
import { fontStack, loadLetterFont } from '../design/letterFonts'
import type { BodyFont } from '../lib/validation'

interface LetterSheetProps {
  /** Null renders the recipient's name, which is how older letters read. */
  salutation: string | null
  body: string
  bodyFont: BodyFont | null
  authorName: string
  recipientName: string
  createdAt: string
}

/**
 * The letter itself — the paper, not the chrome around it.
 *
 * Shared by LetterModal and PublicLetter because they render the same object
 * and had already drifted apart once. A redesign applied to only one of them
 * would leave a stranger reading a plainer letter than the recipient does,
 * which is backwards: the public page is the one someone chooses to show
 * people.
 */
export function LetterSheet({
  salutation,
  body,
  bodyFont,
  authorName,
  recipientName,
  createdAt,
}: LetterSheetProps) {
  useEffect(() => {
    void loadLetterFont(bodyFont)
  }, [bodyFont])

  return (
    <div className="relative px-2 sm:px-6">
      <p className="font-letter text-lg text-ink-letter" style={{ fontFamily: fontStack(bodyFont) }}>
        Dear {salutation ?? recipientName},
      </p>

      {/*
        break-words is load-bearing, not cosmetic: whitespace-pre-wrap breaks
        at word boundaries only, so a pasted URL — one unbroken token longer
        than the column — would push the sheet past a 375px viewport. Named in
        the 2026-09-10 responsive audit as the most likely way a real letter
        breaks the page.
      */}
      <p
        className="mt-6 whitespace-pre-wrap break-words text-[17px] leading-[1.85] text-ink-letter"
        style={{ fontFamily: fontStack(bodyFont) }}
      >
        {body}
      </p>

      {/*
        The fold. A letter this long would have been folded to fit an envelope,
        and the crease is where it was. Built from the existing paper-edge
        token plus an inset shadow — no new colours.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-paper-edge/70 shadow-[0_1px_2px_rgba(44,40,37,0.06)]"
      />

      <div className="mt-10 text-right">
        <p className="font-hand text-3xl text-ink-ui">With love, {authorName}</p>
        {/*
          The date as a postmark rather than a caption: a ring of paper-edge
          around it, set small and wide. Still the same formatted date string.
        */}
        <p className="mt-3 inline-block rounded-full border border-paper-edge px-3 py-1 font-ui text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          {formatLetterDate(createdAt)}
        </p>
      </div>
    </div>
  )
}
```

The signature deliberately stays `font-hand` — it stands for a hand signing a page, not for the letter's typesetting, and it should be constant across a correspondence. Chrome stays `font-ui`. So a letter shows at most two faces.

- [ ] **Step 2: Verify every token exists**

Run: `grep -n "paper-edge\|ink-letter\|ink-ui\|ink-muted\|font-hand\|font-ui\|font-letter\|rounded-full" src/design/tokens.css`
Report which of the classes you used are backed by a real token. **A misspelled Tailwind token emits no CSS and fails silently** — an unstyled letter is the whole product looking broken.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 74 tests, build succeeds.

```bash
git add src/components/LetterSheet.tsx
git commit -m "feat: the letter is a sheet of paper with a fold in it"
```

---

### Task 11: Both readers use the sheet

**Files:**
- Modify: `src/components/LetterModal.tsx`
- Modify: `src/routes/PublicLetter.tsx`

**Interfaces:**
- Consumes: `LetterSheet` from Task 10

- [ ] **Step 1: `LetterModal` renders the sheet**

Replace the greeting, body and signature block inside `PaperTexture` with:

```tsx
          <LetterSheet
            salutation={letter.salutation}
            body={letter.message}
            bodyFont={letter.bodyFont}
            authorName={authorName}
            recipientName={recipientName}
            createdAt={letter.createdAt}
          />
```

Keep the close and share buttons, the archive/delete row and the focus trap exactly as they are — those are chrome, not the letter.

- [ ] **Step 2: Fix the tap targets**

From the 2026-09-10 audit: Archive and Delete are ~16px tall and the close/share icons 32–34px, against a 44px target. Give the footer buttons real padding and the icon buttons a larger hit area:

- The Archive / Delete / Cancel / Delete-confirm buttons: add `px-3 py-2.5` so each is at least 44px tall.
- The close and share icon buttons: `p-3` rather than `p-2`, taking an 18px icon to 42px — and keep `right-4` / `right-14` far enough apart that they still do not overlap at 375px. Verify the spacing arithmetic and report it.

- [ ] **Step 3: `PublicLetter` renders the same sheet**

Replace its duplicated greeting/body/signature markup with the same `LetterSheet` call, using the public view's fields. The stranger now sees exactly what the recipient sees.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 74 tests, build succeeds, and the `PublicLetter-*.js` chunk still exists and has NOT grown substantially — if it has, a font was pulled in eagerly and the public route regressed.

Report the chunk sizes before and after.

- [ ] **Step 5: Commit**

```bash
git add src/components/LetterModal.tsx src/routes/PublicLetter.tsx
git commit -m "feat: the recipient and a stranger read the same letter"
```

---

### Task 12: The card shows the face

**Files:**
- Modify: `src/components/LetterCard.tsx`

- [ ] **Step 1: Render the snippet in the letter's face**

```tsx
        <p
          className="mt-3 text-[15px] leading-relaxed text-ink-letter"
          style={{ fontFamily: fontStack(letter.bodyFont) }}
        >
          {snippet(letter.message, 140)}
        </p>
```

Import `fontStack` from `../design/letterFonts`. `LetterCard` already imports `type { Letter }` only, and `letterFonts` is under `src/design/`, not `src/data/` — so the architecture rule is untouched.

**Do not call `loadLetterFont` here.** A grid of twelve cards would fetch every family at once, which is exactly the cost the lazy loader exists to avoid. The card falls back to the stack's serif until the letter is opened, which is a fair trade for an inbox preview.

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all green.

```bash
git add src/components/LetterCard.tsx
git commit -m "feat: a letter's character shows before you open it"
```

---

### Task 13: The footer

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/routes/PublicLetter.tsx`

- [ ] **Step 1: Add it to the app chrome**

In `src/components/Layout.tsx`, after the `<main>` element:

```tsx
      <footer className="pb-10 text-center">
        <p className="font-ui text-xs text-ink-muted">
          Made with{' '}
          <span role="img" aria-label="love">
            ❤️
          </span>{' '}
          by Pin3appl3ishan
        </p>
      </footer>
```

The heart carries `role="img"` and an `aria-label` so a screen reader announces "Made with love by Pin3appl3ishan" rather than the emoji's raw name mid-sentence — the same treatment the unread dot already gets in `LetterCard`.

`Layout.tsx` must NOT gain a value import from `src/data/` for this. It needs none.

- [ ] **Step 2: Add it to the public page**

In `src/routes/PublicLetter.tsx`, beneath the existing "Dear Jee" mark, add the same line.

The owner decided the attribution should appear here too, on the grounds that the point of attribution is to be seen and this is the page deliberately shown to other people. **It is one line to remove if that changes.**

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all green.

```bash
git add src/components/Layout.tsx src/routes/PublicLetter.tsx
git commit -m "feat: sign the app"
```

---

### Task 14: Amend the constraint, record the phase, hand over the SQL

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Amend `CLAUDE.md` — this is the highest-risk item in the plan**

`CLAUDE.md` currently reads:

> Three type roles only: Plus Jakarta Sans (`font-ui`), Lora (`font-letter`), Caveat (`font-hand`).

That is now false. Replace it with:

```markdown
- **Three type ROLES only** — `font-ui` (Plus Jakarta Sans), `font-letter`, and
  `font-hand` (Caveat). The `font-letter` role is user-selectable per letter
  from a fixed set of five: Lora (default), EB Garamond, Courier Prime, Caveat,
  Dancing Script. Adding a sixth means changing `BODY_FONTS` in
  `src/lib/validation.ts`, the `letters_body_font_known` check constraint, and
  the loader in `src/design/letterFonts.ts` — all three, or a letter becomes
  unwritable, unreadable, or unstyled. UI chrome uses only `font-ui` and
  `font-hand`.
```

**Why this matters more than it looks:** the rule is enforced by every future session reading it. An un-amended rule means someone eventually deletes four fonts as a regression — and every test passes while they do it, because nothing tests which font families exist.

- [ ] **Step 2: Add the Phase 7 build record**

In `README.md`, after Phase 6, add a Phase 7 section in the same voice as the others — what it does, and what review actually found. Read the Phase 5 and 6 sections first and match their candour; they are honest about defects, and that is the document's point.

Cover: the two nullable columns and why null means the old behaviour; the three-layer validation and why `body_font` needs a constraint the client cannot reach; lazy font loading and what it protects; polling over websockets, with the reasons Realtime was rejected; that polling forced a latent bug — the captured open letter — to be fixed first; the shared `LetterSheet` and the drift it prevents; and the two responsive-audit bugs finally closed.

Also update the command table's test count if it changed, and add any new files to the "Where things are" tree — `usePoll.ts`, `letterFonts.ts`, `LetterSheet.tsx`.

- [ ] **Step 3: Verify and commit**

Run: `git diff --stat`
Expected: only `CLAUDE.md` and `README.md`.

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add CLAUDE.md README.md
git commit -m "docs: record phase 7 and amend the type-role rule"
```

- [ ] **Step 4: Hand the SQL to the owner, then STOP**

Tell the owner, in these words or close to them:

> `supabase/schema.sql` and `supabase/policies.sql` both need applying in the
> Supabase SQL editor, schema first. Both are idempotent — note that
> `get_public_letter` is dropped and recreated, because its return type
> changed and `create or replace` cannot do that. No reset script this time
> and no backfill: null means the old behaviour in both new columns, so every
> existing letter renders exactly as it does today.

Then WAIT. Do not run the next step first.

- [ ] **Step 5: Verify the live schema took**

This check exists because this project has shipped a `LetterRow` claiming a column the live table lacked — the mapped value was `undefined`, a `!== null` check read it as present, and every letter in production was misclassified.

```bash
U=$(grep -m1 '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"\r\n')
K=$(grep -m1 '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r\n')
for col in salutation body_font; do
  curl -s "$U/rest/v1/letters?select=$col&limit=1" \
    -H "apikey: $K" -H "Authorization: Bearer $K" | head -c 120; echo "  <- $col"
done
```

Expected: `42501` (permission denied — the column parsed and only the anon grant stopped it). `42703` means the column does not exist and the migration did not run.

---

## What only the owner can do

1. Apply `schema.sql`, then `policies.sql`. No reset script, no backfill.
2. Write a letter with a custom salutation and each of the five faces, and confirm each renders — for the writer, for the recipient, and on a public share link.
3. Confirm a letter written before this change still reads exactly as it did.
4. Leave the inbox open on two devices and confirm a letter sent from one appears on the other within half a minute without a reload.

## What this deliberately leaves out

- Renaming the app itself; local drafts; realtime/websocket delivery. All three were considered and rejected, with reasons recorded in the spec.
- Per-letter colour, size or alignment. Font is the only presentational choice.
- A separate face for the signature or salutation.
- Polling on `/chapters`, `/settings`, or while signed out.
- The pre-existing `markRead`-on-your-own-sent-letter behaviour noted in the Phase 6 final review.
