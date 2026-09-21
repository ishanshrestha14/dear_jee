# Reactions — the turned-down corner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person a letter was written to can fold its corner — one quiet, wordless, reversible acknowledgment that the writer finds later rather than being told about.

**Architecture:** One nullable `acknowledged_at timestamptz` on `letters`, receiver-only by a trigger clause that mirrors `is_read`'s exactly. A `FoldedCorner` component renders the fold through a new `ornament` slot on `PaperTexture` — a containing-block fix that also stops the decoration painting over the letter's words. The control is a toggle in the reading modal's action row; the fold itself shows on the inbox card and the opened sheet, and never on the public share page.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Framer Motion, Supabase (Postgres + RLS). Vitest for logic-level tests.

**Spec:** `docs/superpowers/specs/2026-09-21-reactions-design.md`

**Branch:** `phase-11-reactions`, based on `main` (`08f83d6`). Deliberately NOT based on `phase-10-letter-themes` — see "Independence from Phase 10" in the spec. Expect a small, trivially-resolved conflict in `PaperTexture.tsx` when the second of the two branches merges.

## Global Constraints

Copied from `CLAUDE.md`. Every task's requirements implicitly include these.

- Repository methods return `{ data, error }` and NEVER throw. Every Supabase adapter method body goes through the `guard()` helper.
- Never narrow a `Result` with a truthiness check. Use `=== null` / `!== null` — the empty string is a falsy `string` and will not narrow. Supabase's own `error` objects are a different shape; `if (error)` is correct for those.
- Read methods return copies (`{ ...letter }`), never references into the store.
- **The mock has no RLS.** Whatever the database enforces with a policy or a trigger, the mock must reimplement in TypeScript, or the app behaves one way in development and another in production.
- `schema.sql` and `policies.sql` run against a LIVE project and must stay idempotent: `add column if not exists`, `drop constraint if exists` before `add constraint`, `create or replace`.
- Every function carries `set search_path = public, pg_temp` — except `new_invite_code`, which needs `public, extensions, pg_temp`.
- Comparing `auth.uid()` in an authorization check uses `is distinct from`, not `<>`. A NULL caller makes `<>` yield NULL, which is falsy in an `if`, so the guard silently permits instead of rejecting.
- The per-side ownership checks in `enforce_letter_update` are wrapped in `if current_user = 'authenticated'` so `security definer` functions can write both people's columns. Do not touch that wrapper.
- Never pure white `#FFFFFF` or pure black `#000000`. Palette is fixed: `#FDFBF7`, `#F4EFE6`, `#2C2825`, `#1A1A1A` at 85%, `#C87963`, `#D4AF37`, plus `--color-paper-edge`, `--color-ink-muted`, `--color-accent-soft`. **No new hex values.**
- Three type ROLES only — `font-ui`, `font-letter`, `font-hand`. UI chrome uses only `font-ui` and `font-hand`.
- A misspelled Tailwind token emits NO CSS and fails silently. Check names against `src/design/tokens.css`.
- All animation respects `prefers-reduced-motion` through the single `<MotionConfig reducedMotion="user">` in `src/app/App.tsx`. Never add a per-component guard.
- Components under `src/components/` must not import VALUES from `src/data/`. `import type` is fine.
- `src/data/index.ts` is the only place that chooses mock or Supabase.
- Testing is logic-level only. No component tests, no hook tests, no jsdom, no Testing Library. The contract suite runs against the MOCK ONLY — do not build a Postgres seeding harness.
- `npx tsc --noEmit` checks NOTHING in this repo (root tsconfig is `{"files": [], "references": [...]}`, always exits 0). The gate is `npm run typecheck`.

**Verification commands** (every task ends with these green):

```bash
npm run typecheck   # tsc -b — the real gate
npm test            # vitest run
npm run lint        # oxlint; 6 pre-existing warnings is the baseline
```

The test count on `main` at the start of this branch is **111**. Tasks that add tests must report the exact new number.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/schema.sql` | Modify | `acknowledged_at` column; the receiver-only trigger clause |
| `supabase/policies.sql` | Modify | `acknowledged_at` joins the UPDATE column grant (NOT insert) |
| `src/data/types.ts` | Modify | `acknowledgedAt` on `Letter`; `setAcknowledged` on the repository interface |
| `src/data/mockRepository.ts` | Modify | Reimplement the receiver-only rule in TypeScript |
| `src/data/supabaseRepository.ts` | Modify | Map the column both ways; map the new exception to user copy |
| `src/data/contractTests.ts` | Modify | Fold, unfold, sender-refused, public-view-clean |
| `src/design/PaperTexture.tsx` | Modify | An `ornament` slot that resolves against the paper, not the text column |
| `src/design/FoldedCorner.tsx` | **Create** | The fold, and the matching glyph for its button |
| `src/hooks/useLetters.ts` | Modify | `setAcknowledged`, optimistic, following `markRead` |
| `src/components/LetterModal.tsx` | Modify | The toggle in the action row; renders the fold |
| `src/components/LetterCard.tsx` | Modify | Renders the fold on the inbox card |
| `src/routes/Inbox.tsx` | Modify | Wires the toggle, receiver-only |
| `README.md` | Modify | Phase 11 build record |

---

## Task 1: The SQL

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `supabase/policies.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: an `acknowledged_at timestamptz` column on `letters`, writable only by the letter's receiver, raising `ONLY_RECEIVER_MAY_ACKNOWLEDGE` otherwise.

**This SQL is not executed by this task.** There is no live database connection here and no Postgres test harness; building one is out of scope. The deliverable is read-through-correct, idempotent SQL plus an honest note. Do not claim it has been run.

- [ ] **Step 1: Add the column**

In `supabase/schema.sql`, immediately after the `letters_theme_known`-adjacent
column block — concretely, after the last `alter table letters add column if not exists ...`
statement in that group and before the constraints that follow:

```sql
-- A quiet acknowledgment from the person the letter was written to: they fold
-- the page's corner. Null means unfolded, which is every letter written before
-- this existed — no backfill, for the same reason salutation and body_font
-- were left null: a default would invent a gesture nobody made.
--
-- A timestamptz rather than a boolean because "when" is free and may matter
-- later. Reversible, so it goes back to null; there is no separate "unfolded
-- at", because the absence IS the state.
alter table letters add column if not exists acknowledged_at timestamptz;
```

- [ ] **Step 2: Add the receiver-only trigger clause**

In `enforce_letter_update` in `supabase/schema.sql`, find the existing
`is_read` clause:

```sql
  if new.is_read is distinct from old.is_read
     and auth.uid() is distinct from old.receiver_id then
    raise exception 'ONLY_RECEIVER_MAY_READ';
  end if;
```

Add this directly beneath it:

```sql
  -- Folding is the recipient's gesture and nobody else's — not the writer's,
  -- who may only find it. Modelled exactly on the is_read clause above, and
  -- placed OUTSIDE the `current_user = 'authenticated'` wrapper below for the
  -- same reason: no security definer function writes this column.
  -- unlink_partner and freeze_profile_letters never touch it, so a folded
  -- letter survives a breakup and its author's account deletion untouched.
  --
  -- `is distinct from`, never `<>`: null is the common value on BOTH sides
  -- here, and `<>` against a null yields null, which is falsy in this `if` —
  -- the guard would silently permit every fold it exists to reject.
  if new.acknowledged_at is distinct from old.acknowledged_at
     and auth.uid() is distinct from old.receiver_id then
    raise exception 'ONLY_RECEIVER_MAY_ACKNOWLEDGE';
  end if;
```

Do not move, reindent, or otherwise touch the `current_user = 'authenticated'`
wrapper further down. Removing or relocating it breaks account deletion and
unlinking.

- [ ] **Step 3: Add the column to the UPDATE grant only**

In `supabase/policies.sql`, add `acknowledged_at` to the UPDATE column grant:

```sql
grant update (is_read, is_public, share_slug,
              sender_archived_at, receiver_archived_at,
              sender_deleted_at, receiver_deleted_at,
              acknowledged_at,
              message, salutation, body_font, scheduled_for)
  on letters to authenticated;
```

**Do NOT add it to the `grant insert (...)` list.** A letter cannot arrive
pre-acknowledged, and the insert path stays as narrow as it is.

Column grants are checked BEFORE RLS, so without the update grant the trigger
would be perfectly correct and every fold would fail anyway. This is the
failure class Phase 8's build record describes costing a long session.

- [ ] **Step 4: Verify idempotency by inspection**

Re-read the diff line by line and confirm:
- the `add column` carries `if not exists`
- no constraint was added without a preceding `drop constraint if exists`
- no function lost or gained a `set search_path`
- the `current_user = 'authenticated'` wrapper is untouched
- the new clause uses `is distinct from`, not `<>`
- `acknowledged_at` appears in the update grant and NOT in the insert grant

Run: `npm run typecheck && npm test`
Expected: both pass — no TypeScript changed in this task.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/policies.sql
git commit -m "feat(sql): a letter's recipient may fold its corner

UNEXECUTED against the live project. Idempotent by inspection."
```

---

## Task 2: The data layer

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/data/mockRepository.ts`
- Modify: `src/data/supabaseRepository.ts`
- Modify: `src/hooks/conversationPaging.test.ts` (one fixture literal)

**Interfaces:**
- Consumes: the `ONLY_RECEIVER_MAY_ACKNOWLEDGE` exception name from Task 1.
- Produces: `Letter.acknowledgedAt: string | null`, and
  `setAcknowledged(letterId: string, userId: string, acknowledged: boolean): Promise<Result<Letter>>`
  on `LetterRepository`.

Both implementations move in one task on purpose: `acknowledgedAt` is a
required field on `Letter`, so the moment it lands on the type every
construction site in both implementations fails `tsc -b`. There is no ordering
that leaves the gate green with only one done.

`PublicLetter` is **deliberately NOT changed**. A stranger holding an unlisted
link must not learn that a letter was privately marked.

- [ ] **Step 1: Extend the types**

In `src/data/types.ts`, on the `Letter` interface, directly below `isRead`:

```ts
  /**
   * When the recipient folded the corner — a quiet acknowledgment, theirs
   * alone to give and to take back. Null means unfolded, which is every
   * letter written before this existed.
   */
  acknowledgedAt: string | null
```

Add the method to the `LetterRepository` interface, directly after
`setArchived`:

```ts
  /**
   * Folds or unfolds the corner. Only the letter's RECEIVER may do this —
   * the writer can see the fold but not make one.
   *
   * Takes a userId, like setArchived and deleteForMe and unlike setShared,
   * so the mock can reimplement the rule the database enforces in
   * enforce_letter_update. setShared not taking one is a recorded wart, not
   * a pattern to copy.
   */
  setAcknowledged(letterId: string, userId: string, acknowledged: boolean): Promise<Result<Letter>>
```

- [ ] **Step 2: Run the typecheck and read the failure list**

Run: `npm run typecheck`
Expected: FAIL, with one error per `Letter` construction site and one per
repository missing the new method. That list is this task's worklist.

- [ ] **Step 3: The mock**

In `src/data/mockRepository.ts`, add `acknowledgedAt: null,` to the seeded
letters' shared `base` object (beside `isRead: false`), and to the `letter`
object constructed in `send`.

Then add the method directly after `setArchived`:

```ts
    async setAcknowledged(letterId, userId, acknowledged) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      if (!visibleTo(letter, userId)) return fail('Letter not found.')
      // The mock has no RLS. This reimplements enforce_letter_update's
      // ONLY_RECEIVER_MAY_ACKNOWLEDGE clause: folding is the recipient's
      // gesture and nobody else's, the writer's included.
      if (letter.receiverId !== userId) {
        return fail('Only the person it was written to can fold it.')
      }
      letter.acknowledgedAt = acknowledged ? new Date().toISOString() : null
      return ok({ ...letter })
    },
```

Note the `!== userId` comparison is correct here even though `receiverId` is
`string | null`: a held letter has a null receiver and no signed-in `userId` is
ever null at this point, so a held letter is refused, which is what we want.

- [ ] **Step 4: The Supabase adapter**

In `src/data/supabaseRepository.ts`:

Add to the row type, beside `is_read`:

```ts
  acknowledged_at: string | null
```

Add to the row-to-`Letter` mapper, beside `isRead: r.is_read,`:

```ts
  acknowledgedAt: r.acknowledged_at,
```

Add the new exception to `letterErrorMessage`, directly after the
`ONLY_RECEIVER_MAY_READ` line:

```ts
  if (raw.includes('ONLY_RECEIVER_MAY_ACKNOWLEDGE'))
    return 'Only the person it was written to can fold it.'
```

The copy matches the mock's exactly, so development and production say the
same sentence.

Add the method directly after `setArchived`:

```ts
    async setAcknowledged(letterId, userId, acknowledged) {
      return guard(async () => {
        const at = acknowledged ? new Date().toISOString() : null
        // .eq('receiver_id', userId) is belt to the trigger's braces: the
        // trigger is the real enforcement, but matching on it here turns
        // "someone else's letter" into a clean not-found rather than a
        // database exception surfaced as prose.
        const { data, error } = await db
          .from('letters')
          .update({ acknowledged_at: at })
          .eq('id', letterId)
          .eq('receiver_id', userId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return fail('Letter not found.')
        return ok(toLetter(data as LetterRow))
      })
    },
```

The body is inside `guard()` like every other method. Do not add a
`try`/`catch`, and do not let it throw.

- [ ] **Step 5: Fix the test fixture**

In `src/hooks/conversationPaging.test.ts`, the `Letter` fixture literal gains
`acknowledgedAt: null,` beside `isRead: false,`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck silent, 111 tests passing, lint at its 6-warning baseline.

- [ ] **Step 7: Commit**

```bash
git add src/data/types.ts src/data/mockRepository.ts src/data/supabaseRepository.ts src/hooks/conversationPaging.test.ts
git commit -m "feat(data): a letter carries a folded corner through both implementations"
```

---

## Task 3: Contract tests

**Files:**
- Modify: `src/data/contractTests.ts`

**Interfaces:**
- Consumes: `setAcknowledged` from Task 2.
- Produces: nothing the app imports — this is the mock's behavioural gate.

The suite runs against the MOCK ONLY and asserts on seeded data. Do not build a
Postgres seeding harness.

- [ ] **Step 1: Write the tests**

Add a new `describe` block inside the existing letters suite, as a sibling of
the other `describe` blocks (place it after the `salutation and face` block):

```ts
    describe('folding the corner', () => {
      it('the recipient folds it, and it reads back', async () => {
        const inbox = (await fx.letters.listConversation(fx.userId)).data!
        const received = inbox.find((l) => l.receiverId === fx.userId)!
        const folded = await fx.letters.setAcknowledged(received.id, fx.userId, true)
        expect(folded.error).toBe(null)
        expect(folded.data!.acknowledgedAt).not.toBe(null)
      })

      it('unfolding puts it back to null', async () => {
        const inbox = (await fx.letters.listConversation(fx.userId)).data!
        const received = inbox.find((l) => l.receiverId === fx.userId)!
        await fx.letters.setAcknowledged(received.id, fx.userId, true)
        const unfolded = await fx.letters.setAcknowledged(received.id, fx.userId, false)
        expect(unfolded.error).toBe(null)
        expect(unfolded.data!.acknowledgedAt).toBe(null)
      })

      it('the seeded letters start unfolded', async () => {
        const inbox = (await fx.letters.listConversation(fx.userId)).data!
        for (const letter of inbox) {
          expect(letter.acknowledgedAt).toBe(null)
        }
      })

      // The most valuable test in this phase: the mock reimplementing the
      // trigger. The writer may find a fold but never make one.
      it('refuses the sender', async () => {
        const sent = (
          await fx.letters.send({
            senderId: fx.userId,
            receiverId: fx.partnerId,
            message: 'Mine to write, not to fold.',
            salutation: null,
            bodyFont: null,
          })
        ).data!
        const refused = await fx.letters.setAcknowledged(sent.id, fx.userId, true)
        expect(refused.error).not.toBe(null)
        expect(refused.data).toBe(null)
      })

      it('a folded letter tells a stranger nothing', async () => {
        const inbox = (await fx.letters.listConversation(fx.userId)).data!
        const received = inbox.find((l) => l.receiverId === fx.userId)!
        await fx.letters.setAcknowledged(received.id, fx.userId, true)
        await fx.letters.setShared(received.id, true)
        const reread = (await fx.letters.listConversation(fx.userId)).data!.find(
          (l) => l.id === received.id,
        )!
        const view = await fx.letters.getBySlug(reread.shareSlug!)
        expect(view.error).toBe(null)
        expect(Object.keys(view.data!)).not.toContain('acknowledgedAt')
      })
    })
```

If the surrounding suite builds its fixtures differently — a different helper
for finding a received letter, or a different `fx` shape — follow the local
pattern. The assertions are what matter.

- [ ] **Step 2: Run and confirm they pass**

Run: `npm test`
Expected: PASS. The count rises from 111 by the number of `it`s added. **Record
the exact new number** — Task 7 writes it into the README.

- [ ] **Step 3: Confirm the sender test fails for the right reason**

Read `mockRepository.ts`'s `setAcknowledged` and satisfy yourself that the
`refuses the sender` test fails on the receiver check and not incidentally —
that the letter exists, is visible to the caller, and reaches that line. A test
that passes for the wrong reason is worse than no test. Record what you
checked.

- [ ] **Step 4: Full gates**

Run: `npm run typecheck && npm test && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/data/contractTests.ts
git commit -m "test(contract): folding is the recipient's alone, and never reaches the public view"
```

---

## Task 4: The fold, and the slot it hangs in

**Files:**
- Modify: `src/design/PaperTexture.tsx`
- Create: `src/design/FoldedCorner.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `PaperTextureProps.ornament?: ReactNode`; `FoldedCorner()` and
  `FoldGlyph()` from `src/design/FoldedCorner.tsx`.

**This task is deliberately inert** — nothing imports the new component yet, and
`PaperTexture`'s new prop is optional, so the app behaves identically before and
after.

**Why the slot is necessary, and not merely convenient.** `PaperTexture`
renders two nested divs: an outer `relative overflow-hidden rounded-letter`
one that carries the caller's padding (`p-6 sm:p-7` on a card, `p-8 sm:p-12` in
the modal), and an inner `<div className="relative">` holding the children. So
anything passed as an ordinary child resolves its `absolute` against the
**padded content box**, not the paper — and because a positioned descendant
with `z-index: auto` paints in the positioned-descendants layer, ABOVE in-flow
text in the same stacking context, it would draw over the letter's words.
Source order does not save you. The slot renders inside the OUTER div, so an
inset means inset from the paper edge, and it sits before the content wrapper,
which is itself positioned — so paint order puts the fold beneath the words.

- [ ] **Step 1: Add the slot to PaperTexture**

In `src/design/PaperTexture.tsx`, extend the props interface:

```ts
interface PaperTextureProps {
  children: ReactNode
  className?: string
  /**
   * Edge decoration — a folded corner, say — that must resolve against the
   * paper itself, not the padded content column. Rendered as a sibling of the
   * content wrapper, inside the outer `relative overflow-hidden` div: that
   * makes the outer div the containing block, so an inset means inset from
   * the paper edge rather than from the text, and, because the content
   * wrapper below is itself positioned and comes later in source, keeps the
   * decoration underneath the words in paint order.
   *
   * Passing decoration as an ordinary child instead resolves it against the
   * INNER wrapper — inset by the caller's padding — and paints it over the
   * letter.
   */
  ornament?: ReactNode
}
```

and the component:

```tsx
export function PaperTexture({ children, className = '', ornament }: PaperTextureProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-letter bg-paper-letter shadow-letter ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-multiply opacity-[0.035]"
        style={{ backgroundImage: TEXTURE_URI }}
      />
      {ornament}
      <div className="relative">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Create the fold**

Create `src/design/FoldedCorner.tsx`:

```tsx
/**
 * A dog-eared corner: the page folded back on itself at bottom-left, the way
 * you fold a corner you want to find again.
 *
 * Bottom-left is chosen for forward compatibility rather than necessity. Only
 * top-right is occupied today — the modal's close button and the card's unread
 * dot — but the unmerged letter-themes work puts ornaments at top-left and
 * bottom-right, so taking bottom-left now means the two never fight over a
 * corner.
 *
 * Must be passed through PaperTexture's `ornament` prop, never as an ordinary
 * child: as a child it would resolve against the padded content box and paint
 * over the letter's words. See the prop's own doc comment.
 *
 * Two colours, both existing palette tokens, each applied as `currentColor` on
 * its own path so no new hex value enters the file: the flap shows the page's
 * reverse (`paper-app`, a shade off the letter tone) and the crease is the
 * fold line (`paper-edge`).
 *
 * aria-hidden: the fold's meaning reaches a screen reader through the toggle
 * button's label, not through a decorative triangle announced mid-letter.
 */
export function FoldedCorner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 28 28"
      className="pointer-events-none absolute bottom-0 left-0 h-7 w-7"
    >
      <path d="M0 0 L28 28 L0 28 Z" fill="currentColor" className="text-paper-app" />
      <path
        d="M0 0 L28 28"
        stroke="currentColor"
        strokeWidth="1"
        className="text-paper-edge"
        fill="none"
      />
    </svg>
  )
}

/**
 * The same shape at icon size, for the toggle that makes it. Sized 18 to sit
 * with the lucide icons already in the modal's action row, and stroked rather
 * than filled so it reads as an outline control rather than a filled state.
 */
export function FoldGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 18 18"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 2.5 H15.5 V15.5 H8 L2.5 10 Z" />
      <path d="M8 15.5 V10 H2.5" />
    </svg>
  )
}
```

- [ ] **Step 3: Verify the tokens exist**

Run: `grep -n 'paper-app\|paper-edge' src/design/tokens.css`
Expected: both present. A misspelled token emits NO CSS and fails silently —
this grep is the only check that catches it, because nobody on this project can
see a rendered page.

- [ ] **Step 4: Full gates**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all green, 111 tests (this task adds none — these are components, and
component tests are not written in this repo), lint at its 6-warning baseline.

- [ ] **Step 5: Commit**

```bash
git add src/design/PaperTexture.tsx src/design/FoldedCorner.tsx
git commit -m "feat(design): a folded corner, and a paper slot that holds it"
```

---

## Task 5: The hook

**Files:**
- Modify: `src/hooks/useLetters.ts`

**Interfaces:**
- Consumes: `setAcknowledged` from Task 2.
- Produces: `setAcknowledged(id: string, acknowledged: boolean): Promise<{ ok: boolean; error?: string }>` on `UseLetters`.

**Follow `markRead`, not `setArchived`.** Read `markRead` in this file before
writing anything — its comment block explains an ordering rule this code must
obey, and it is the closest analogue: a small optimistic flip on one letter.

- [ ] **Step 1: Add the method to the interface**

In the `UseLetters` interface, directly after `setArchived`:

```ts
  /**
   * Folds or unfolds a letter's corner. Only meaningful for a letter you
   * received; the repository and the database both refuse anyone else.
   */
  setAcknowledged(id: string, acknowledged: boolean): Promise<{ ok: boolean; error?: string }>
```

- [ ] **Step 2: Implement it**

Add directly after `setArchivedFn`:

```ts
  const setAcknowledgedFn = useCallback<UseLetters['setAcknowledged']>(
    async (id, acknowledged) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      mutating.current++
      try {
        // Optimistic, so the corner turns the instant it is pressed.
        // lettersRef is written synchronously, BEFORE setLetters and never
        // inside its updater — see markRead above for why: a functional
        // updater is not guaranteed to run before the next line, and load()'s
        // Promise.all can read lettersRef before React flushes it, especially
        // under the mock's zero latency.
        // Captured BEFORE the optimistic write, so a failure restores what was
        // actually there. Recomputing the revert value instead would mean a
        // failed UNFOLD reverts to null — erasing a fold the database still
        // holds, which is the opposite of what a revert is for.
        const previous = lettersRef.current.find((l) => l.id === id)?.acknowledgedAt ?? null
        const at = acknowledged ? new Date().toISOString() : null
        const optimistic = lettersRef.current.map((l) =>
          l.id === id ? { ...l, acknowledgedAt: at } : l,
        )
        lettersRef.current = optimistic
        setLetters(optimistic)

        const result = await letterRepository.setAcknowledged(id, userId, acknowledged)
        if (result.error !== null) {
          const reverted = lettersRef.current.map((l) =>
            l.id === id ? { ...l, acknowledgedAt: previous } : l,
          )
          lettersRef.current = reverted
          setLetters(reverted)
          // Deliberately NOT setError: the routes early-return on a
          // page-level error, which would replace the whole grid with one
          // line of text over a failed corner fold and leave no UI able to
          // clear it. Same reasoning as setShared below. The caller puts this
          // in the toast.
          return { ok: false, error: result.error }
        }
        return { ok: true }
      } finally {
        mutating.current--
      }
    },
    [userId],
  )
```

Note the revert restores `previous`, captured before the optimistic write —
folding reverts to `null`, unfolding reverts to the timestamp it replaced.
Do NOT recompute the revert value from `acknowledged` or reuse `at`: on the
unfold path `at` is already null, so a failed unfold would erase a fold the
database still holds.

- [ ] **Step 3: Return it**

Add `setAcknowledged: setAcknowledgedFn,` to the returned object, beside
`setArchived`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run lint`
Expected: green, 111 tests, lint at its 6-warning baseline. `mutating` is taken
so a poll cannot clobber the optimistic write — if you did not increment it,
re-read `markRead`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLetters.ts
git commit -m "feat(hooks): folding a corner, optimistically"
```

---

## Task 6: The control and the surfaces

**Files:**
- Modify: `src/components/LetterModal.tsx`
- Modify: `src/components/LetterCard.tsx`
- Modify: `src/routes/Inbox.tsx`
- Modify: `src/routes/Archive.tsx` — `folded` is a required prop and this is one of three `LetterModal` call sites
- Modify: `src/routes/Chapter.tsx` — likewise

**Interfaces:**
- Consumes: `FoldedCorner`, `FoldGlyph` (Task 4); `PaperTexture.ornament` (Task 4); `useLetters().setAcknowledged` (Task 5).
- Produces: `folded: boolean` and `onFold?: () => void` on `LetterModalProps`.

**Where the fold shows versus where it can be made.** The fold *displays*
wherever a participant sees the letter — the inbox card, the archive, a past
chapter, the opened modal — because it is part of the letter's state. The
control is offered only in the current conversation, and only to the receiver.
`PublicLetter` renders `LetterSheet` inside its own `PaperTexture` and simply
never passes `ornament`, so the public page is excluded by construction rather
than by a flag someone must remember to set.

**The control is a button, not the corner.** Tapping the corner would be
prettier, but a 28px triangle is under the 44px tap target this project
established, and `CLAUDE.md` records a class of defect from controls that look
inert.

- [ ] **Step 1: LetterCard renders the fold**

In `src/components/LetterCard.tsx`, add the import:

```ts
import { FoldedCorner } from '../design/FoldedCorner'
```

and pass it to `PaperTexture` — through the prop, never as a child:

```tsx
      <PaperTexture
        className="p-6 sm:p-7"
        ornament={letter.acknowledgedAt !== null ? <FoldedCorner /> : null}
      >
```

Leave the rest of the card alone. Note `!== null`, not a truthiness check.

- [ ] **Step 2: LetterModal takes the new props**

In `src/components/LetterModal.tsx`, add the import:

```ts
import { FoldedCorner, FoldGlyph } from '../design/FoldedCorner'
```

and extend the props interface, after `readOnly`:

```ts
  /** Whether this letter's corner is currently turned down. */
  folded: boolean
  /**
   * Folds or unfolds. Absent means no control — the writer, the archive and a
   * past chapter all see the fold but cannot change it.
   */
  onFold?: () => void
```

Destructure `folded` and `onFold` in the parameter list.

- [ ] **Step 3: LetterModal renders the fold**

Change its `PaperTexture` opening tag to pass the ornament:

```tsx
        <PaperTexture
          className="p-8 sm:p-12"
          ornament={folded ? <FoldedCorner /> : null}
        >
```

- [ ] **Step 4: Add the toggle to the action row**

In the non-confirming branch of the action row — the one rendering Share,
Archive and Delete — add this as the FIRST control, before Share:

```tsx
                {onFold !== undefined && (
                  <motion.button
                    type="button"
                    onClick={onFold}
                    aria-pressed={folded}
                    aria-label={folded ? 'Unfold the corner' : 'Fold the corner'}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    className={`rounded-full p-1.5 transition-colors ${
                      folded ? 'text-accent' : 'text-ink-muted hover:text-accent'
                    }`}
                  >
                    <FoldGlyph />
                  </motion.button>
                )}
```

`aria-pressed` is what makes this legible as a toggle rather than an action.
The `whileHover`/`whileTap` values match the Share and Archive buttons beside
it exactly — and they animate through the single `<MotionConfig>` in
`App.tsx`, so do not add any reduced-motion guard here.

- [ ] **Step 5: Wire the archive and chapter call sites**

`src/routes/Archive.tsx` and `src/routes/Chapter.tsx` each render a
`<LetterModal>`. Both must now pass `folded`, and neither passes `onFold`:

```tsx
            folded={open.acknowledgedAt !== null}
```

Use whatever local variable each file already uses for the open letter — read
the surrounding lines rather than assuming the name is `open`.

- [ ] **Step 6: Wire the Inbox**

In `src/routes/Inbox.tsx`, pull `setAcknowledged` out of the letters hook
alongside the other methods it already destructures. On the `<LetterModal>`,
add:

```tsx
            folded={open.acknowledgedAt !== null}
            onFold={
              open.receiverId === userId
                ? () => {
                    void (async () => {
                      const result = await setAcknowledged(open.id, open.acknowledgedAt === null)
                      if (!result.ok) setToast({ message: result.error ?? 'That did not work.' })
                    })()
                  }
                : undefined
            }
```

The `receiverId === userId` check is what makes the control the recipient's
alone, agreeing with the trigger by construction. The toast shape matches the
one already used for share failures in this file.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck silent, 111-plus-Task-3's-additions tests passing, lint at
its 6-warning baseline, build succeeding. The required `folded` prop means the
compiler will have found every `LetterModal` call site — there are exactly
three.

- [ ] **Step 8: Look at it, and be honest about what you could not see**

Run `npm run dev` and check by eye:
- a folded letter shows a turned corner at bottom-left, on the card and in the modal
- **the fold sits under the text, not over it**
- the toggle appears only on letters you received, and flips both ways
- an archived letter and a past-chapter letter show a fold but offer no toggle
- a shared letter's public page shows no fold at all
- nothing overlaps badly at 375px

**If you cannot run a browser, say so plainly.** "I could not see the rendered
page" is an expected and correct answer on this project. Do not claim a visual
check you did not perform.

- [ ] **Step 9: Commit**

```bash
git add src/components/LetterModal.tsx src/components/LetterCard.tsx src/routes/Inbox.tsx src/routes/Archive.tsx src/routes/Chapter.tsx
git commit -m "feat(ui): fold a letter's corner, and find one folded"
```

---

## Task 7: The build record

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the test count**

Run `npm test`, read the exact number, and update the commands-table line. It
currently says 111.

- [ ] **Step 2: Add the phase entry**

After the Phase 9 section and before `## Open decisions and known gaps`, add
`## Phase 11 — Reactions *(complete, migration pending)*`. Read the Phase 7, 8
and 9 sections first and match their voice: what was built, then the decisions
worth knowing, then what review found, then migration status. Cover at minimum:

- The gesture is a turned-down corner, and why: it is the one physical gesture meaning *this one mattered* without meaning *I reply*, and it is inherently reversible, so the undo reads as physical rather than as an edit.
- It is found, not announced — no toast, no badge, no count. This is why the phase needed no notification machinery despite Phase 9 having built some, and it is the decision most at risk of being "improved" later.
- `is_read` was the precedent and was followed line for line: a receiver-only column, guarded by a trigger clause using `is distinct from`, sitting outside the `security definer` wrapper because nothing privileged writes it.
- The database enforces receiver-only and nothing more; "current conversation" is held by where the control is offered. Record the rejected alternative — enforcing bond-open and not-archived too — and why: three more rules the mock must mirror exactly, and mock/database divergence is this project's recurring defect.
- A column, not a `reactions` table, and what that forecloses.
- `PaperTexture` gained an `ornament` slot, and it is a containing-block fix rather than a convenience: decoration passed as an ordinary child resolves against the padded content box and paints over the letter's words, because positioned descendants paint above in-flow text.
- The public share page is excluded by construction — `PublicLetter` never passes `ornament`, and `PublicLetter`'s type is unchanged, so the contract suite's existing `getBySlug` key-set assertion is what stops the field leaking.

- [ ] **Step 3: Record what was not verified**

State plainly whether the rendered page was ever seen, and by whom. If Task 6
Step 8 could not run a browser, say so here — that is the honest and expected
answer, and this file is the project's memory.

- [ ] **Step 4: Record migration status**

State that `schema.sql` and `policies.sql` carry the column, the trigger clause
and the update grant; that they are idempotent **by inspection**; and that they
have **NOT been executed** against the live project. Note that deploy order is
not free — the SQL must run before the client that writes the column deploys,
because a client writing an absent column fails the whole update. Note also
that Phases 6, 7 and 8 remain unapplied.

- [ ] **Step 5: Verify and commit**

```bash
npm run build
npm test
git add README.md
git commit -m "docs: record phase 11"
```

---

## Self-Review

Checked against the spec:

| Spec requirement | Task |
|---|---|
| One wordless acknowledgment, no vocabulary | 4, 6 |
| Found, not announced — no toast/badge/count | 6 (no notification code anywhere) |
| Reversible | 2, 5, 6 |
| The gesture is a turned-down corner | 4 |
| Only the receiver may fold | 1, 2, 3, 6 |
| A fold outlives the bond | 1 (clause outside the `security definer` wrapper) |
| `acknowledged_at` nullable, unbackfilled | 1 |
| A column, not a table | 1, 2 |
| `is_read` precedent, `is distinct from` | 1 |
| Update grant only, never insert | 1 |
| Database enforces receiver-only and nothing more | 1 |
| Mock reimplements the trigger | 2, 3 |
| `setAcknowledged` takes a `userId` | 2 |
| Hook follows `markRead`; optimistic; `mutating` guard; never `setError` | 5 |
| Control is a button in the action row, receiver-only | 6 |
| Fold at bottom-left, on card and sheet | 4, 6 |
| Palette only, no new hex | 4 |
| Not on the public page; `PublicLetter` unchanged | 2, 3, 6 |
| Contract tests: fold, unfold, sender refused, public clean | 3 |
| Out of scope: notifications, multiple reactions, archive/chapter folding, counter | not built |

Gaps found and closed while reviewing: Task 6 originally wired only `Inbox`,
but `folded` is a required prop and there are three `LetterModal` call sites —
Step 5 now covers `Archive` and `Chapter` explicitly, which is also what makes
"display follows the letter, control follows the conversation" real rather
than aspirational.
