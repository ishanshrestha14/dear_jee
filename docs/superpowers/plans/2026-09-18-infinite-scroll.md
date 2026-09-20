# Infinite Scroll for the Conversation List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The current-bond conversation list (`listConversation`) loads 30 letters at a time and fetches more automatically as the reader scrolls, instead of fetching the entire history on every load and every 30-second poll.

**Architecture:** Cursor-based (keyset) pagination on `(created_at, id)`, both directions. Scrolling to a sentinel near the bottom fetches strictly-older letters and appends them. The first time that happens, the hook freezes a "boundary" cursor at the last-loaded letter; from then on, every poll and every mutation refetches only what's strictly newer than that boundary and splices it onto the untouched, already-appended tail — never a fixed-width window, so a letter can never fall through the seam between the refreshed prefix and the frozen suffix. Two small UX additions reuse existing pieces: a scroll-to-top button, and a "new letter" toast that extends the app's one existing `Toast` component rather than adding a second notification surface.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Supabase (Postgres + PostgREST), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-infinite-scroll-design.md`

## Global Constraints

- **Repository methods return `{ data, error }` and never throw**; every Supabase adapter body goes through `guard()`. (CLAUDE.md)
- **Never narrow a `Result` with a truthiness check** — use `=== null` / `!== null`. (CLAUDE.md)
- **Read methods return copies, never references into the store.** (CLAUDE.md)
- **The mock has no RLS.** Whatever the database enforces with a policy or a JS-side filter, the mock must reimplement, or the two implementations diverge. (CLAUDE.md)
- **`schema.sql` and `policies.sql` must stay idempotent** — not touched by this plan at all; this feature is a query-shape change in application code, no new column, no new constraint, no RLS change. (CLAUDE.md, and see spec's Data layer section)
- **Logic-level tests only** — no component tests, no hook tests, no jsdom, no Testing Library. Pure, non-React helper functions (Task 4) ARE logic-level and get real unit tests; `useLetters.ts` itself and every component in this plan get typecheck-only verification, same as every prior UI task in this codebase's plans. (CLAUDE.md)
- **The contract suite (`contractTests.ts`) runs against the MOCK ONLY.** (CLAUDE.md)
- **All animation respects `prefers-reduced-motion` through the single `<MotionConfig reducedMotion="user">`** in `src/app/App.tsx` — never a per-component guard. The scroll-to-top behavior in this plan is native browser scrolling, not a Framer Motion animation, so it is governed by one global CSS rule instead (Task 7), not a JS media-query check. (CLAUDE.md)
- **Never pure white `#FFFFFF` or pure black `#000000`; palette is the fixed set in `tokens.css`.** Every new color in this plan (`--color-accent`, `--color-paper-app`, `--shadow-letter-lifted`) is an existing token. (CLAUDE.md)
- **`npx tsc --noEmit` checks nothing in this repo.** Always verify with `npm run typecheck`. (CLAUDE.md)

---

## File Structure

- `src/data/types.ts` — `LetterCursor`, the paginated `listConversation` signature.
- `src/data/mockRepository.ts` — the shared `(createdAt, id)` ordering comparator, cursor filtering, `limit` slicing.
- `src/data/contractTests.ts` — the pagination behavioral tests (mock only, per the standing rule).
- `src/data/supabaseRepository.ts` — the archived/pending-scheduled filter pushed into the SQL `where` clause (it has to move out of JS for `limit` to mean anything), plus the cursor filter.
- `src/hooks/conversationPaging.ts` (new) — two pure functions: splicing a refreshed prefix onto a frozen tail, and detecting partner-authored arrivals. This is the one piece of new logic that gets a real unit test.
- `src/hooks/conversationPaging.test.ts` (new) — its tests.
- `src/hooks/useLetters.ts` — `PAGE_SIZE`, the boundary ref, `hasMoreLetters`/`loadingMore`/`newArrivals`, `loadMoreLetters()`, `clearNewArrivals()`.
- `src/components/Toast.tsx` — optional `onClick` and `durationMs` props, backward compatible.
- `src/components/ScrollToTopButton.tsx` (new) — the button, plus an exported `scrollToTop()` the new-letter toast also uses.
- `src/design/tokens.css` — the global `scroll-behavior: smooth` rule and its reduced-motion override.
- `src/routes/Inbox.tsx` — the sentinel + `IntersectionObserver`, the generalized toast state, the new-letter toast wiring, the button.
- `README.md` — the Phase 9 build record.

**Task order and why.** Tasks 1–3 are the data layer, in the same order the scheduled-delivery plan used: types first, then the mock plus its own behavioral tests (the contract suite is the mock's test suite and catches a pagination logic bug far faster than a network round trip would), then the Supabase mirror with no new tests. Task 4 is pure, hook-independent pagination-merge logic — it doesn't need the data layer at all, but it needs `Letter`/`LetterCursor` from Task 1, and `useLetters` (Task 5) needs it, so it sits right before the hook it serves. Tasks 6–7 are small, independent, reusable pieces (`Toast`, `ScrollToTopButton`) the final UI task (8) wires together. Task 9 is documentation and full-suite verification.

---

### Task 1: Types

**Files:**
- Modify: `src/data/types.ts`

**Produces:** `LetterCursor` and the paginated `LetterRepository.listConversation` signature, consumed by every later task.

- [ ] **Step 1: Add `LetterCursor`**

Find (around line 98-99):

```ts
/** Repositories report failure in the value, never by throwing. */
export type Result<T> = { data: T; error: null } | { data: null; error: string }
```

Add immediately after it:

```ts

/**
 * A point in listConversation's page order — newest first, ties on the same
 * millisecond broken by id descending (see mockRepository.ts's
 * `compareNewestFirst`, which every cursor comparison, in both
 * implementations, must agree with or a page boundary can gain a gap or an
 * overlap).
 */
export interface LetterCursor {
  createdAt: string
  id: string
}
```

- [ ] **Step 2: Paginate `listConversation`**

Find (around line 126-135):

```ts
  /**
   * The CURRENT chapter: letters exchanged with your present partner, newest
   * first, minus the ones you archived.
   *
   * SCOPED TO THE OPEN BOND — this is the central semantic change of the
   * bonds work and the easiest thing to miss in a diff. It is NOT "every
   * letter you participate in". Letters from a past relationship live in
   * listChapter, and held letters in listHeld; neither appears here.
   */
  listConversation(userId: string): Promise<Result<Letter[]>>
```

Replace with:

```ts
  /**
   * The CURRENT chapter: letters exchanged with your present partner, newest
   * first, minus the ones you archived.
   *
   * SCOPED TO THE OPEN BOND — this is the central semantic change of the
   * bonds work and the easiest thing to miss in a diff. It is NOT "every
   * letter you participate in". Letters from a past relationship live in
   * listChapter, and held letters in listHeld; neither appears here.
   *
   * Paginated. With no `options`, returns everything — every existing call
   * site as of this writing (the contract suite has dozens) keeps working
   * unchanged. Pass `limit` alone for the first page; `olderThan` + `limit`
   * for an older page; `newerThan` (never with a `limit` — there is no
   * ceiling on how many letters can have arrived) to refresh only what's
   * newer than a previously frozen cursor. `newerThan` and `olderThan` are
   * mutually exclusive.
   */
  listConversation(
    userId: string,
    options?: {
      newerThan?: LetterCursor
      olderThan?: LetterCursor
      limit?: number
    },
  ): Promise<Result<Letter[]>>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: FAILS — `mockRepository.ts` and `supabaseRepository.ts` both implement `LetterRepository` and their `listConversation(userId)` no longer matches the (still-compatible, since `options` is optional) signature... actually this signature change is backward compatible with an implementation that ignores a second argument, so this should PASS. Run it anyway to confirm no unrelated breakage before continuing.
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/data/types.ts
git commit -m "feat(types): paginate listConversation"
```

---

### Task 2: The mock — cursor pagination, and its tests

**Files:**
- Modify: `src/data/mockRepository.ts`
- Modify: `src/data/contractTests.ts`

**Consumes:** `LetterCursor` from Task 1.
**Produces:** the mock's `listConversation(userId, options)` honoring `limit`/`olderThan`/`newerThan`, and `compareNewestFirst` — the one ordering both this task and Task 3 must agree with.

- [ ] **Step 1: Write the failing contract tests**

Open `src/data/contractTests.ts`. Find the end of the `listConversation` describe block (around line 32-57):

```ts
    describe('listConversation', () => {
      it('returns letters the user received', async () => {
        const { data } = await fx.letters.listConversation(fx.userId)
        expect(data!.length).toBeGreaterThan(0)
        expect(data!.some((l) => l.receiverId === fx.userId)).toBe(true)
      })

      it('also returns letters the user SENT', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Something I wrote.',
          salutation: null,
          bodyFont: null,
        })
        const { data } = await fx.letters.listConversation(fx.userId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('orders newest first', async () => {
        const { data } = await fx.letters.listConversation(fx.userId)
        const times = data!.map((l) => Date.parse(l.createdAt))
        expect([...times].sort((a, b) => b - a)).toEqual(times)
      })

      it('excludes letters this user archived', async () => {
        const { data: before } = await fx.letters.listConversation(fx.userId)
        const target = before![0]
        await fx.letters.setArchived(target.id, fx.userId, true)
        const { data: after } = await fx.letters.listConversation(fx.userId)
        expect(after!.some((l) => l.id === target.id)).toBe(false)
      })
    })
```

Add a new nested `describe`, immediately before that block's closing `})`:

```ts

      describe('pagination', () => {
        it('limit caps the result to the newest N', async () => {
          for (let i = 0; i < 5; i++) {
            await fx.letters.send({
              senderId: fx.userId,
              receiverId: fx.partnerId,
              message: `Letter number ${i}`,
              salutation: null,
              bodyFont: null,
            })
          }
          const { data: all } = await fx.letters.listConversation(fx.userId)
          const { data: capped } = await fx.letters.listConversation(fx.userId, { limit: 3 })
          expect(capped!.length).toBe(3)
          expect(capped!.map((l) => l.id)).toEqual(all!.slice(0, 3).map((l) => l.id))
        })

        it('olderThan + limit returns the next page with no overlap or gap', async () => {
          for (let i = 0; i < 5; i++) {
            await fx.letters.send({
              senderId: fx.userId,
              receiverId: fx.partnerId,
              message: `Letter number ${i}`,
              salutation: null,
              bodyFont: null,
            })
          }
          const { data: all } = await fx.letters.listConversation(fx.userId)
          const { data: firstPage } = await fx.letters.listConversation(fx.userId, { limit: 3 })
          const cursor = firstPage![firstPage!.length - 1]
          const { data: secondPage } = await fx.letters.listConversation(fx.userId, {
            olderThan: { createdAt: cursor.createdAt, id: cursor.id },
            limit: 100,
          })
          expect([...firstPage!, ...secondPage!].map((l) => l.id)).toEqual(all!.map((l) => l.id))
        })

        it('newerThan returns only what arrived after the cursor, unbounded', async () => {
          const { data: before } = await fx.letters.listConversation(fx.userId)
          const cursor = before![0]
          // A real delay, not a synthetic one: two sends in the same millisecond
          // would make the outcome depend on the id tiebreak rather than on
          // newerThan actually working, which is not what this test is for.
          await new Promise((resolve) => setTimeout(resolve, 5))
          const fresh = await fx.letters.send({
            senderId: fx.partnerId,
            receiverId: fx.userId,
            message: 'One more, after the cursor.',
            salutation: null,
            bodyFont: null,
          })
          const { data: since } = await fx.letters.listConversation(fx.userId, {
            newerThan: { createdAt: cursor.createdAt, id: cursor.id },
          })
          expect(since!.map((l) => l.id)).toEqual([fresh.data!.id])
        })
      })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- contractTests`
Expected: FAIL — the three new `pagination` tests fail because the mock's `listConversation` ignores its second argument entirely (`limit` never caps anything, `olderThan`/`newerThan` never filter).

- [ ] **Step 3: Implement pagination in the mock**

Open `src/data/mockRepository.ts`. Find `hasArrived` (around line 21-23):

```ts
/** True once a scheduled instant has arrived. */
function hasArrived(scheduledFor: string): boolean {
  return Date.parse(scheduledFor) <= Date.now()
}
```

Add immediately after it:

```ts

/**
 * The canonical order for listConversation's pagination: newest first, ties
 * on the same millisecond broken by id descending. This is the ONE order
 * every cursor filter below has to agree with — using a different tiebreak
 * for sorting than for cursoring is exactly how a page ends up with a
 * duplicate or a gap at its seam. Negative means `a` sorts before `b` (is
 * newer, or newer-tiebreaking).
 */
function compareNewestFirst(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt)
  if (byTime !== 0) return byTime
  return b.id > a.id ? 1 : b.id < a.id ? -1 : 0
}
```

Find `listConversation` (around line 186-202):

```ts
    async listConversation(userId) {
      // Scoped to the OPEN bond. No bond means no current chapter, which is a
      // real and renderable state, not an error: an unbonded person's home is
      // empty and their held letters are in listHeld.
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      const mine = letters
        .filter(
          (l) =>
            l.bondId === open.id &&
            visibleTo(l, userId) &&
            !isArchivedBy(l, userId) &&
            !(l.senderId === userId && l.scheduledFor !== null && !hasArrived(l.scheduledFor)),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },
```

Replace with:

```ts
    async listConversation(userId, options) {
      // Scoped to the OPEN bond. No bond means no current chapter, which is a
      // real and renderable state, not an error: an unbonded person's home is
      // empty and their held letters are in listHeld.
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      let mine = letters
        .filter(
          (l) =>
            l.bondId === open.id &&
            visibleTo(l, userId) &&
            !isArchivedBy(l, userId) &&
            !(l.senderId === userId && l.scheduledFor !== null && !hasArrived(l.scheduledFor)),
        )
        .sort(compareNewestFirst)

      // > 0 means `l` sorts AFTER the cursor — i.e. older.
      if (options?.olderThan !== undefined) {
        const cursor = options.olderThan
        mine = mine.filter((l) => compareNewestFirst(l, cursor) > 0)
      }
      if (options?.newerThan !== undefined) {
        const cursor = options.newerThan
        mine = mine.filter((l) => compareNewestFirst(l, cursor) < 0)
      }
      if (options?.limit !== undefined) {
        mine = mine.slice(0, options.limit)
      }

      return ok(mine.map((l) => ({ ...l })))
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- contractTests`
Expected: PASS — all `listConversation` tests, including the three new `pagination` ones.

- [ ] **Step 5: Full test run and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/data/mockRepository.ts src/data/contractTests.ts
git commit -m "feat(mock): cursor-paginate listConversation"
```

---

### Task 3: The Supabase adapter

**Files:**
- Modify: `src/data/supabaseRepository.ts`

**Consumes:** `LetterCursor` from Task 1. Mirrors the ordering Task 2 established (`created_at desc, id desc`) and the same archived/pending-scheduled exclusion `archivedBy()` already encodes, now pushed into the query instead of applied after it.
**Produces:** nothing later tasks import directly — this is the live-data mirror of Task 2, exercised by the app itself rather than the contract suite (which runs against the mock only, per CLAUDE.md).

- [ ] **Step 1: Push the archived/pending-scheduled filter into the query, and add the cursor**

Today's `listConversation` fetches every bond letter and filters archived/pending-scheduled status in JS, AFTER the fetch. That has to change here: applying a SQL `limit` before that JS filter would return a page that looks full but has already-excluded rows counted against it — a real page could come back short. The filter has to move into the `where` clause so `order` + cursor + `limit` operate on the already-correct row set.

Find (around line 209-235):

```ts
    async listConversation(userId) {
      return guard(async () => {
        // Scoped to the OPEN bond: this is the current chapter, not every
        // letter the user has ever exchanged. No open bond is a real,
        // renderable state — an unbonded person's home is empty — not an
        // error. A failed lookup is a different thing entirely and must
        // surface as one, not silently resolve to the same empty inbox.
        //
        // RLS already hides letters this user deleted, so there is no delete
        // filter here — unlike the mock, which has no policies to lean on.
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        const now = Date.now()
        return ok(
          rows.filter(
            (l) =>
              !archivedBy(l, userId) &&
              !(l.senderId === userId && l.scheduledFor !== null && Date.parse(l.scheduledFor) > now),
          ),
        )
      })
    },
```

Replace with:

```ts
    async listConversation(userId, options) {
      return guard(async () => {
        // Scoped to the OPEN bond: this is the current chapter, not every
        // letter the user has ever exchanged. No open bond is a real,
        // renderable state — an unbonded person's home is empty — not an
        // error. A failed lookup is a different thing entirely and must
        // surface as one, not silently resolve to the same empty inbox.
        //
        // RLS already hides letters this user deleted, so there is no delete
        // filter here — unlike the mock, which has no policies to lean on.
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])

        const nowIso = new Date().toISOString()
        let query = db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          // Not archived by this side. Mirrors archivedBy() below, in SQL:
          // pushed into the where clause (rather than filtered in JS, as
          // every other list method here still does) because a `limit`
          // further down has to apply to the CORRECT row set, or a page
          // can come back short.
          .or(
            `and(sender_id.eq.${userId},sender_archived_at.is.null),` +
              `and(receiver_id.eq.${userId},receiver_archived_at.is.null)`,
          )
          // De Morgan's of "not (I'm the sender AND it's still pending)":
          // not-sender, OR no schedule, OR its date has already passed.
          .or(`sender_id.neq.${userId},scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })

        // Mirrors mockRepository.ts's compareNewestFirst: `created_at desc,
        // id desc`, so a `lt`/`gt` tuple comparison against that same pair
        // is the correct cursor in either direction.
        if (options?.olderThan !== undefined) {
          const { createdAt, id } = options.olderThan
          query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`)
        }
        if (options?.newerThan !== undefined) {
          const { createdAt, id } = options.newerThan
          query = query.or(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`)
        }
        if (options?.limit !== undefined) {
          query = query.limit(options.limit)
        }

        const { data, error } = await query
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },
```

`archivedBy()` stays defined and used exactly as before — `listArchived` still relies on it; only `listConversation` stopped needing it.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/data/supabaseRepository.ts
git commit -m "feat(supabase): cursor-paginate listConversation"
```

This query is unexecuted against the live project as of this commit — the contract suite does not run against Supabase (CLAUDE.md), so its correctness is verified by inspection here and by manual exercise once the whole feature is wired up (Task 8's verification step, and Task 9's handoff note).

---

### Task 4: Pure pagination-merge logic

**Files:**
- Create: `src/hooks/conversationPaging.ts`
- Test: `src/hooks/conversationPaging.test.ts`

**Consumes:** `Letter`, `LetterCursor` from Task 1.
**Produces:** `spliceConversation(fresh, boundary, previous): Letter[]` and `detectPartnerArrivals(fresh, previous, partnerId): Letter[]`, both consumed by Task 5's `useLetters.ts`.

These two functions are plain data transforms — no React, no timers, no network — which is exactly what CLAUDE.md's "logic-level only" testing rule is for for: real unit tests, not a hook test.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/conversationPaging.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { spliceConversation, detectPartnerArrivals } from './conversationPaging'
import type { Letter } from '../data/types'

function letter(id: string, senderId: string, overrides: Partial<Letter> = {}): Letter {
  return {
    id,
    senderId,
    receiverId: 'someone',
    message: 'x',
    createdAt: '2026-01-01T00:00:00.000Z',
    isRead: false,
    shareSlug: null,
    isPublic: false,
    senderName: null,
    receiverName: null,
    salutation: null,
    bodyFont: null,
    senderArchivedAt: null,
    receiverArchivedAt: null,
    senderDeletedAt: null,
    receiverDeletedAt: null,
    bondId: 'bond-1',
    sentAt: null,
    scheduledFor: null,
    ...overrides,
  }
}

describe('spliceConversation', () => {
  it('returns fresh unchanged when there is no boundary yet', () => {
    const fresh = [letter('a', 'p'), letter('b', 'p')]
    expect(spliceConversation(fresh, null, [])).toEqual(fresh)
  })

  it('keeps everything from the boundary onward, untouched', () => {
    const previous = [letter('a', 'p'), letter('b', 'p'), letter('c', 'p'), letter('d', 'p')]
    const fresh = [letter('new', 'p'), letter('a', 'p')] // 'a' refetched identically
    const result = spliceConversation(fresh, { createdAt: previous[1].createdAt, id: 'b' }, previous)
    expect(result.map((l) => l.id)).toEqual(['new', 'a', 'b', 'c', 'd'])
  })

  it('falls back to the whole previous list, deduped, if the boundary letter is gone', () => {
    const previous = [letter('a', 'p'), letter('b', 'p')]
    const fresh = [letter('new', 'p'), letter('a', 'p')]
    const result = spliceConversation(
      fresh,
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'missing' },
      previous,
    )
    expect(result.map((l) => l.id)).toEqual(['new', 'a', 'b'])
  })
})

describe('detectPartnerArrivals', () => {
  it('flags a letter new to the list and written by the partner', () => {
    const previous = [letter('a', 'partner')]
    const fresh = [letter('a', 'partner'), letter('b', 'partner')]
    expect(detectPartnerArrivals(fresh, previous, 'partner').map((l) => l.id)).toEqual(['b'])
  })

  it('ignores a new letter the reader wrote themselves', () => {
    const previous: Letter[] = []
    const fresh = [letter('a', 'me')]
    expect(detectPartnerArrivals(fresh, previous, 'partner')).toEqual([])
  })

  it('ignores a letter that was already loaded', () => {
    const previous = [letter('a', 'partner')]
    const fresh = [letter('a', 'partner')]
    expect(detectPartnerArrivals(fresh, previous, 'partner')).toEqual([])
  })

  it('returns nothing with no partner', () => {
    expect(detectPartnerArrivals([letter('a', 'x')], [], null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- conversationPaging`
Expected: FAIL — `src/hooks/conversationPaging.ts` does not exist yet.

- [ ] **Step 3: Implement**

Create `src/hooks/conversationPaging.ts`:

```ts
import type { Letter, LetterCursor } from '../data/types'

/**
 * Splices a freshly refetched prefix onto the tail that loadMoreLetters
 * appended earlier and that a poll or a mutation must leave untouched — see
 * the infinite-scroll spec's "frozen boundary" decision. Refetching a fixed-
 * width window instead (e.g. always "the newest 30") would let a letter fall
 * through the seam whenever new ones arrive while pages are loaded: the
 * refreshed prefix and the already-appended tail would no longer meet
 * exactly where they used to.
 *
 * Deduping by id is cheap insurance against the one edge case where the
 * boundary letter itself was archived or deleted out from under it, which
 * would otherwise make where `tail` starts ambiguous.
 */
export function spliceConversation(
  fresh: Letter[],
  boundary: LetterCursor | null,
  previous: Letter[],
): Letter[] {
  if (boundary === null) return fresh
  const boundaryIndex = previous.findIndex((l) => l.id === boundary.id)
  const tail = boundaryIndex === -1 ? previous : previous.slice(boundaryIndex)
  const freshIds = new Set(fresh.map((l) => l.id))
  return [...fresh, ...tail.filter((l) => !freshIds.has(l.id))]
}

/**
 * Letters in `fresh` that are new since `previous` AND written by the
 * partner — never the reader's own letter, including their own scheduled
 * letter delivering itself while their tab happens to be open. A toast
 * announcing your own letter to yourself would read as a bug, not a
 * feature.
 */
export function detectPartnerArrivals(
  fresh: Letter[],
  previous: Letter[],
  partnerId: string | null,
): Letter[] {
  if (partnerId === null) return []
  const previousIds = new Set(previous.map((l) => l.id))
  return fresh.filter((l) => l.senderId === partnerId && !previousIds.has(l.id))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- conversationPaging`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/conversationPaging.ts src/hooks/conversationPaging.test.ts
git commit -m "feat(hooks): pure conversation-pagination helpers"
```

---

### Task 5: `useLetters`

**Files:**
- Modify: `src/hooks/useLetters.ts`

**Consumes:** `LetterCursor` (Task 1), the paginated `listConversation` (Tasks 2-3), `spliceConversation`/`detectPartnerArrivals` (Task 4).
**Produces:** `UseLetters.hasMoreLetters: boolean`, `UseLetters.loadingMore: boolean`, `UseLetters.loadMoreLetters(): Promise<void>`, `UseLetters.newArrivals: Letter[]`, `UseLetters.clearNewArrivals(): void`. Task 8 consumes all five through `useLettersContext()`.

No automated test for this task — `useLetters.ts` is a React hook, and CLAUDE.md rules out hook tests. Verified by `npm run typecheck` at each step and, once Task 8 wires it into the UI, by the manual walkthrough in that task's verification step.

- [ ] **Step 1: Imports and the page-size constant**

Find the top of the file:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import { usePoll } from './usePoll'
import type { Letter } from '../data/types'
import type { BodyFont } from '../lib/validation'
```

Replace with:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import { usePoll } from './usePoll'
import { spliceConversation, detectPartnerArrivals } from './conversationPaging'
import type { Letter, LetterCursor } from '../data/types'
import type { BodyFont } from '../lib/validation'

/** Letters per page, both for the first load and every scroll-triggered fetch. */
const PAGE_SIZE = 30
```

- [ ] **Step 2: Extend the interface**

Find:

```ts
export interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  held: Letter[]
  /** The caller's own pending or bond-cancelled scheduled letters. */
  scheduled: Letter[]
  hasBond: boolean
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(
```

Replace with:

```ts
export interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  held: Letter[]
  /** The caller's own pending or bond-cancelled scheduled letters. */
  scheduled: Letter[]
  hasBond: boolean
  partnerName: string
  loading: boolean
  error: string | null
  /** True once a fetch has come back short of PAGE_SIZE — no further page exists. */
  hasMoreLetters: boolean
  /** True while a scroll-triggered page fetch is in flight. */
  loadingMore: boolean
  /** Fetches the next older page of `letters` and appends it. */
  loadMoreLetters(): Promise<void>
  /**
   * Partner-authored letters a poll found that were not loaded before.
   * Stays populated until the caller calls clearNewArrivals — meant to
   * drive a one-shot notification, not to be read on every render.
   */
  newArrivals: Letter[]
  clearNewArrivals(): void
  sendLetter(
```

- [ ] **Step 3: New state and refs**

Find:

```ts
  const [letters, setLetters] = useState<Letter[]>([])
  const [archived, setArchived_] = useState<Letter[]>([])
  const [held, setHeld] = useState<Letter[]>([])
  const [scheduled, setScheduled] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // A poll that lands mid-mutation overwrites the optimistic update with the
  // pre-write server value — the unread dot flickering back on a letter the
  // reader is looking at. A ref, not state: this must not cause a render, and
  // the poll needs the current value, not the one from its closure.
  const mutating = useRef(0)
```

Replace with:

```ts
  const [letters, setLetters] = useState<Letter[]>([])
  const [archived, setArchived_] = useState<Letter[]>([])
  const [held, setHeld] = useState<Letter[]>([])
  const [scheduled, setScheduled] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMoreLetters, setHasMoreLetters] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [newArrivals, setNewArrivals] = useState<Letter[]>([])

  // A poll that lands mid-mutation overwrites the optimistic update with the
  // pre-write server value — the unread dot flickering back on a letter the
  // reader is looking at. A ref, not state: this must not cause a render, and
  // the poll needs the current value, not the one from its closure.
  const mutating = useRef(0)

  // Mirrors `letters` for reads inside load()/loadMoreLetters(), which must
  // stay stable (empty dependency array) so usePoll's interval is not torn
  // down and rebuilt on every fetch — the same reason `mutating` above is a
  // ref rather than state.
  const lettersRef = useRef<Letter[]>([])

  // Null until the user scrolls past the first page; frozen from then on.
  // See spliceConversation and the spec's "frozen boundary" decision.
  const pageBoundary = useRef<LetterCursor | null>(null)

  // Read inside load(), which must stay referentially stable — see
  // lettersRef above for why this can't just be the partnerId variable.
  const partnerIdRef = useRef<string | null>(null)
```

- [ ] **Step 4: Rewrite `load()`**

Find:

```ts
  const load = useCallback(async (id: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    const [conversation, archive, heldLetters, scheduledLetters] = await Promise.all([
      letterRepository.listConversation(id),
      letterRepository.listArchived(id),
      letterRepository.listHeld(id),
      letterRepository.listScheduled(id),
    ])
    // All three failures must surface. Swallowing one would leave the
    // previous list on screen looking correct, and setArchived/deleteForMe
    // both call load(), so the staleness would recur after every action — a
    // wrong list the reader trusts is worse than a missing one they do not.
    //
    // Silent (polling) loads are the opposite: a failure here has a
    // last-known-good list to fall back on, the reader did not ask for the
    // refresh, and cannot act on its failure. So a silent failure changes
    // nothing on screen — it neither blanks a list nor sets the page error.
    if (conversation.error !== null) {
      if (!silent) setError(conversation.error)
    } else setLetters(conversation.data)

    if (archive.error !== null) {
      if (!silent) setError(archive.error)
    } else setArchived_(archive.data)

    if (heldLetters.error !== null) {
      if (!silent) setError(heldLetters.error)
    } else setHeld(heldLetters.data)

    if (scheduledLetters.error !== null) {
      if (!silent) setError(scheduledLetters.error)
    } else setScheduled(scheduledLetters.data)

    if (
      !silent &&
      conversation.error === null &&
      archive.error === null &&
      heldLetters.error === null &&
      scheduledLetters.error === null
    ) {
      setError(null)
    }
  }, [])
```

Replace with:

```ts
  const load = useCallback(async (id: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    // No boundary yet: this IS the first page, capped at PAGE_SIZE, same
    // shape as before pagination existed. A boundary frozen by
    // loadMoreLetters: refetch only what's newer than it and leave the
    // already-appended tail alone — see spliceConversation.
    const conversationOptions =
      pageBoundary.current === null ? { limit: PAGE_SIZE } : { newerThan: pageBoundary.current }
    const [conversation, archive, heldLetters, scheduledLetters] = await Promise.all([
      letterRepository.listConversation(id, conversationOptions),
      letterRepository.listArchived(id),
      letterRepository.listHeld(id),
      letterRepository.listScheduled(id),
    ])
    // All three failures must surface. Swallowing one would leave the
    // previous list on screen looking correct, and setArchived/deleteForMe
    // both call load(), so the staleness would recur after every action — a
    // wrong list the reader trusts is worse than a missing one they do not.
    //
    // Silent (polling) loads are the opposite: a failure here has a
    // last-known-good list to fall back on, the reader did not ask for the
    // refresh, and cannot act on its failure. So a silent failure changes
    // nothing on screen — it neither blanks a list nor sets the page error.
    if (conversation.error !== null) {
      if (!silent) setError(conversation.error)
    } else {
      const fresh = conversation.data
      if (pageBoundary.current === null) {
        setHasMoreLetters(fresh.length === PAGE_SIZE)
      }
      // Diffed BEFORE lettersRef is updated below — this is specifically
      // "what a silent poll found that wasn't already on screen."
      if (silent) {
        const arrivals = detectPartnerArrivals(fresh, lettersRef.current, partnerIdRef.current)
        if (arrivals.length > 0) setNewArrivals((current) => [...current, ...arrivals])
      }
      const next = spliceConversation(fresh, pageBoundary.current, lettersRef.current)
      lettersRef.current = next
      setLetters(next)
    }

    if (archive.error !== null) {
      if (!silent) setError(archive.error)
    } else setArchived_(archive.data)

    if (heldLetters.error !== null) {
      if (!silent) setError(heldLetters.error)
    } else setHeld(heldLetters.data)

    if (scheduledLetters.error !== null) {
      if (!silent) setError(scheduledLetters.error)
    } else setScheduled(scheduledLetters.data)

    if (
      !silent &&
      conversation.error === null &&
      archive.error === null &&
      heldLetters.error === null &&
      scheduledLetters.error === null
    ) {
      setError(null)
    }
  }, [])
```

- [ ] **Step 5: Reset pagination state on every userId change**

Find:

```ts
  useEffect(() => {
    if (userId === null) {
      setLetters([])
      setArchived_([])
      setHeld([])
      setScheduled([])
      setLoading(authLoading)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      await load(userId)
      if (cancelled) return
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading, load])
```

Replace with:

```ts
  useEffect(() => {
    if (userId === null) {
      setLetters([])
      lettersRef.current = []
      pageBoundary.current = null
      setHasMoreLetters(false)
      setNewArrivals([])
      setArchived_([])
      setHeld([])
      setScheduled([])
      setLoading(authLoading)
      return
    }

    // A fresh sign-in (or a switch between accounts) starts a fresh
    // pagination cycle — a boundary or a tail left over from a previous
    // user would otherwise be spliced onto the new one's letters.
    pageBoundary.current = null
    lettersRef.current = []

    let cancelled = false
    setLoading(true)

    void (async () => {
      await load(userId)
      if (cancelled) return
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading, load])

  useEffect(() => {
    partnerIdRef.current = partnerId
  }, [partnerId])
```

- [ ] **Step 6: `loadMoreLetters` and `clearNewArrivals`**

Find:

```ts
  const reload = useCallback(async () => {
    if (userId !== null) await load(userId)
  }, [userId, load])
```

Replace with:

```ts
  const reload = useCallback(async () => {
    if (userId !== null) await load(userId)
  }, [userId, load])

  const loadMoreLetters = useCallback(async () => {
    if (userId === null || !hasMoreLetters || loadingMore) return
    const last = lettersRef.current[lettersRef.current.length - 1]
    if (last === undefined) return
    setLoadingMore(true)
    try {
      // The first call freezes the boundary right here, at what was — until
      // now — the last loaded letter. Every refresh from this point on
      // refetches only what's newer than it; everything from here back was
      // loaded once and is never touched again.
      if (pageBoundary.current === null) {
        pageBoundary.current = { createdAt: last.createdAt, id: last.id }
      }
      const result = await letterRepository.listConversation(userId, {
        olderThan: { createdAt: last.createdAt, id: last.id },
        limit: PAGE_SIZE,
      })
      if (result.error !== null) {
        setError(result.error)
        return
      }
      const next = [...lettersRef.current, ...result.data]
      lettersRef.current = next
      setLetters(next)
      setHasMoreLetters(result.data.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [userId, hasMoreLetters, loadingMore])

  const clearNewArrivals = useCallback(() => setNewArrivals([]), [])
```

- [ ] **Step 7: Return the new pieces**

Find the final `return`:

```ts
  return {
    letters,
    archived,
    held,
    scheduled,
    hasBond: partnerId !== null,
    partnerName,
    loading: loading || authLoading,
    error,
    sendLetter,
    sendHeld: sendHeldFn,
    markRead,
    setArchived: setArchivedFn,
    deleteForMe,
    setShared: setSharedFn,
    editScheduled: editScheduledFn,
    reload,
  }
```

Replace with:

```ts
  return {
    letters,
    archived,
    held,
    scheduled,
    hasBond: partnerId !== null,
    partnerName,
    loading: loading || authLoading,
    error,
    hasMoreLetters,
    loadingMore,
    loadMoreLetters,
    newArrivals,
    clearNewArrivals,
    sendLetter,
    sendHeld: sendHeldFn,
    markRead,
    setArchived: setArchivedFn,
    deleteForMe,
    setShared: setSharedFn,
    editScheduled: editScheduledFn,
    reload,
  }
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck`
Expected: PASS — `Inbox.tsx` destructures only the fields it already knew about, and an unused new property on the hook's return value is not a type error. (Task 8 is what actually uses the new ones.)

Run: `npm test`
Expected: PASS — no existing test touches `useLetters.ts` directly (CLAUDE.md: no hook tests), and Task 4's new tests are independent of it.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useLetters.ts
git commit -m "feat(hooks): paginate the conversation list, detect partner arrivals"
```

---

### Task 6: `Toast` gains `onClick` and `durationMs`

**Files:**
- Modify: `src/components/Toast.tsx`

**Produces:** `ToastProps.onClick?: () => void`, `ToastProps.durationMs?: number` (default `3000`, unchanged from today). Every existing call site (`Inbox.tsx`, two of them) keeps compiling unchanged; Task 8 is the first caller to pass the new props.

- [ ] **Step 1: Extend the component**

Read the current file (`src/components/Toast.tsx`) in full before editing — it is short. Replace its entire contents with:

```tsx
import { useEffect } from 'react'
import { motion } from 'framer-motion'

interface ToastProps {
  message: string
  onDone: () => void
  /** Present makes the toast clickable — e.g. "scroll to the new letter." */
  onClick?: () => void
  /** Defaults to 3000, matching every toast before this one. */
  durationMs?: number
}

/** Bottom-centre, warm, and gone on its own timer. The app's one notification. */
export function Toast({ message, onDone, onClick, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, durationMs)
    return () => window.clearTimeout(timer)
  }, [onDone, durationMs])

  const chrome = 'rounded-full bg-paper-letter px-5 py-2.5 font-ui text-sm text-ink-ui shadow-letter-lifted'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-8 z-[60] flex justify-center px-4"
    >
      {onClick ? (
        <button type="button" onClick={onClick} className={`${chrome} cursor-pointer`}>
          {message}
        </button>
      ) : (
        <p className={chrome}>{message}</p>
      )}
    </motion.div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS — `Inbox.tsx`'s two existing `<Toast message={toast} onDone={...} />` calls (Task 8 hasn't touched them yet) still match the new, backward-compatible props.

- [ ] **Step 3: Commit**

```bash
git add src/components/Toast.tsx
git commit -m "feat(ui): Toast supports onClick and a custom duration"
```

---

### Task 7: `ScrollToTopButton`, and the reduced-motion CSS rule

**Files:**
- Create: `src/components/ScrollToTopButton.tsx`
- Modify: `src/design/tokens.css`

**Produces:** `ScrollToTopButton` (a component) and `scrollToTop()` (a plain function), both consumed by Task 8 — the button renders itself, and the new-letter toast's `onClick` calls `scrollToTop()` directly.

- [ ] **Step 1: The global reduced-motion rule**

`window.scrollTo({ top: 0, behavior: 'smooth' })` is native browser scrolling, not a Framer Motion animation — it sits outside `<MotionConfig reducedMotion="user">` in `App.tsx`, which only intercepts `motion.*` elements. CLAUDE.md rules out a per-component reduced-motion check, so this is one global CSS rule instead: the smooth behavior comes from CSS, not a JS option, and reduced motion turns it off in exactly one place.

Open `src/design/tokens.css`. Find the end of the file (the closing `}` of `@theme`, currently the last line):

```css
  --radius-letter: 14px;
}
```

Add immediately after it:

```css

/*
 * Smooth scrolling is a CSS property, not a per-call JS option, specifically
 * so prefers-reduced-motion governs it from this one place — the same
 * single-source-of-truth rule <MotionConfig reducedMotion="user"> applies to
 * every Framer Motion animation in this app (see src/app/App.tsx).
 */
html {
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}
```

- [ ] **Step 2: The component**

Create `src/components/ScrollToTopButton.tsx`:

```tsx
import { useEffect, useState } from 'react'

const SHOW_AFTER_PX = 300

/** Scrolls to the top of the page. `scroll-behavior` in tokens.css decides whether that's smooth or instant. */
export function scrollToTop() {
  window.scrollTo({ top: 0 })
}

/**
 * Fixed bottom-right, appears once the page has scrolled past roughly a
 * screen's worth. Terracotta, matching the app's one accent color — nothing
 * here is a new color, per the fixed palette in tokens.css.
 */
export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-paper-app shadow-letter-lifted transition-opacity hover:opacity-90"
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M10 15V5M4 9l6-6 6 6" />
      </svg>
    </button>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run lint`
Expected: PASS — confirms no misspelled Tailwind class slipped through (CLAUDE.md: a misspelled token emits no CSS and fails silently, so this is worth checking explicitly here).

- [ ] **Step 4: Commit**

```bash
git add src/components/ScrollToTopButton.tsx src/design/tokens.css
git commit -m "feat(ui): scroll-to-top button and the reduced-motion scroll rule"
```

---

### Task 8: Wire it into the Inbox

**Files:**
- Modify: `src/routes/Inbox.tsx`

**Consumes:** `hasMoreLetters`, `loadingMore`, `loadMoreLetters`, `newArrivals`, `clearNewArrivals` (Task 5); the extended `Toast` (Task 6); `ScrollToTopButton`, `scrollToTop` (Task 7).

- [ ] **Step 1: Imports and new destructured fields**

Find:

```tsx
import { useCallback, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { ShareModal } from '../components/ShareModal'
import { Toast } from '../components/Toast'
import { useLettersContext } from '../hooks/LettersProvider'
import { useBonds } from '../hooks/useBonds'
import { useAuth } from '../auth/useAuth'
import { InviteLink } from '../components/InviteLink'
import { cancelledByBondEnding, formatLetterDate, formatLetterTimestamp, snippet } from '../lib/format'
import type { Letter } from '../data/types'

export default function Inbox() {
  const {
    letters,
    archived,
    held,
    scheduled,
    hasBond,
    partnerName,
    loading,
    error,
    markRead,
    setArchived,
    deleteForMe,
    setShared,
    sendHeld,
  } = useLettersContext()
```

Replace with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { ShareModal } from '../components/ShareModal'
import { Toast } from '../components/Toast'
import { ScrollToTopButton, scrollToTop } from '../components/ScrollToTopButton'
import { useLettersContext } from '../hooks/LettersProvider'
import { useBonds } from '../hooks/useBonds'
import { useAuth } from '../auth/useAuth'
import { InviteLink } from '../components/InviteLink'
import { cancelledByBondEnding, formatLetterDate, formatLetterTimestamp, snippet } from '../lib/format'
import type { Letter } from '../data/types'

export default function Inbox() {
  const {
    letters,
    archived,
    held,
    scheduled,
    hasBond,
    partnerName,
    loading,
    error,
    hasMoreLetters,
    loadingMore,
    loadMoreLetters,
    newArrivals,
    clearNewArrivals,
    markRead,
    setArchived,
    deleteForMe,
    setShared,
    sendHeld,
  } = useLettersContext()
```

- [ ] **Step 2: Generalize the toast state**

Find:

```tsx
  const [toast, setToast] = useState<string | null>(null)
```

Replace with:

```tsx
  const [toast, setToast] = useState<{
    message: string
    onClick?: () => void
    durationMs?: number
  } | null>(null)
```

- [ ] **Step 3: Update every `setToast` call to the new shape**

Find (inside the "Unsent" section's send-to-partner handler):

```tsx
                        const result = await sendHeld(letter.id)
                        if (!result.ok) setToast(result.error ?? 'That did not work.')
```

Replace with:

```tsx
                        const result = await sendHeld(letter.id)
                        if (!result.ok) setToast({ message: result.error ?? 'That did not work.' })
```

Find (in the `ShareModal`'s `onSetShared` handler):

```tsx
                const result = await setShared(sharing.id, next)
                if (!result.ok) setToast(result.error ?? 'That did not work.')
```

Replace with:

```tsx
                const result = await setShared(sharing.id, next)
                if (!result.ok) setToast({ message: result.error ?? 'That did not work.' })
```

Find:

```tsx
            onCopied={() => setToast('Link copied! Send it to them on WhatsApp 💌')}
```

Replace with:

```tsx
            onCopied={() => setToast({ message: 'Link copied! Send it to them on WhatsApp 💌' })}
```

- [ ] **Step 4: Update both `Toast` render sites**

Find (there are two identical lines — one in the empty-state branch, one in the main return):

```tsx
        {toast !== null && <Toast key="toast" message={toast} onDone={() => setToast(null)} />}
```

Replace BOTH occurrences with:

```tsx
        {toast !== null && (
          <Toast
            key="toast"
            message={toast.message}
            onClick={toast.onClick}
            durationMs={toast.durationMs}
            onDone={() => setToast(null)}
          />
        )}
```

- [ ] **Step 5: The sentinel and the loading-more indicator**

Find:

```tsx
      <div className="grid gap-5 sm:grid-cols-2">
        {letters.map((letter) => (
          <LetterCard
            key={letter.id}
            letter={letter}
            authorName={authorOf(letter)}
            unread={letter.receiverId === userId && !letter.isRead}
            onOpen={handleOpen}
          />
        ))}
      </div>
      <AnimatePresence>
```

Replace with:

```tsx
      <div className="grid gap-5 sm:grid-cols-2">
        {letters.map((letter) => (
          <LetterCard
            key={letter.id}
            letter={letter}
            authorName={authorOf(letter)}
            unread={letter.receiverId === userId && !letter.isRead}
            onOpen={handleOpen}
          />
        ))}
      </div>

      {/*
        Zero-height and unobserved once hasMoreLetters is false — the effect
        below tears the observer down rather than leaving it watching a
        sentinel that will never trigger another fetch.
      */}
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {loadingMore && (
        <p className="mt-4 text-center font-ui text-xs text-ink-muted">Loading more letters…</p>
      )}

      <ScrollToTopButton />

      <AnimatePresence>
```

Now add the ref and the effect that drives it. Find (near the other `useCallback`-based derived values, right after `const sharing = ...`):

```tsx
  const sharing = sharingId === null ? null : (letters.find((l) => l.id === sharingId) ?? null)

  const closeLetter = useCallback(() => setOpenId(null), [])
```

Replace with:

```tsx
  const sharing = sharingId === null ? null : (letters.find((l) => l.id === sharingId) ?? null)

  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || !hasMoreLetters) return
    // rootMargin fires the fetch a little before the sentinel is actually on
    // screen, so the next page is usually ready before the reader reaches
    // the bottom rather than after.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMoreLetters()
      },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMoreLetters, loadMoreLetters])

  const closeLetter = useCallback(() => setOpenId(null), [])
```

- [ ] **Step 6: The new-letter toast**

Find (right after the `authorOf`/`recipientOf`/`handleOpen` helpers, before the `if (loading)` early return):

```tsx
  function handleOpen(letter: Letter) {
    setOpenId(letter.id)
    if (!letter.isRead) void markRead(letter.id)
  }

  if (loading) {
```

Replace with:

```tsx
  function handleOpen(letter: Letter) {
    setOpenId(letter.id)
    if (!letter.isRead) void markRead(letter.id)
  }

  useEffect(() => {
    if (newArrivals.length === 0) return
    const who = partnerName || 'them'
    const message =
      newArrivals.length === 1 ? `New letter from ${who} 💌` : `${newArrivals.length} new letters from ${who} 💌`
    setToast({
      message,
      durationMs: 5000,
      onClick: () => {
        scrollToTop()
        setToast(null)
      },
    })
    clearNewArrivals()
  }, [newArrivals, partnerName, clearNewArrivals])

  if (loading) {
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Full verification**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 9: Manual verification (record what was actually checked, not assumed)**

This feature has no automated coverage above the pure helpers in Task 4 — CLAUDE.md rules out component and hook tests, and the mock only seeds 3 letters, fewer than `PAGE_SIZE`. Before committing, run `npm run dev` and, using the mock data source, actually check:

- Send more than 30 letters between the two seeded accounts (the compose form, repeated) so the conversation list exceeds one page.
- Scroll down: the next page loads automatically as the sentinel nears the viewport, with no button click.
- Scroll back up past 300px: the scroll-to-top button appears; clicking it returns to the top.
- With two browser profiles signed in as both seeded accounts, send a letter from one; on the other, within one 30-second poll (or on refocus), confirm the "New letter from …" toast appears and clicking it scrolls to the top.
- Archive or delete a letter that's part of the already-scrolled-in, older (frozen) portion of the list and confirm it disappears without the rest of the list re-shuffling or duplicating.

State plainly in the commit or the follow-up message which of these were actually run, not assumed to work from the code alone.

- [ ] **Step 10: Commit**

```bash
git add src/routes/Inbox.tsx
git commit -m "feat(ui): infinite scroll, scroll-to-top, and a new-letter toast"
```

---

### Task 9: Record the phase, verify everything

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the Phase 9 build record**

Find the end of the Phase 8 section and the `---` before "Open decisions and known gaps" (the same seam every prior phase's record was inserted at). Add a new section immediately before that `---`:

```markdown
## Phase 9 — Infinite scroll for the conversation list *(complete)*

`listConversation` no longer fetches the whole current-bond history on every
load and every 30-second poll. It's cursor-paginated on `(created_at, id)`,
30 letters at a time; scrolling near the bottom fetches the next page
automatically via an `IntersectionObserver`, matching a TikTok/Instagram-style
feed rather than a "load more" button.

- **A frozen refresh boundary, not a fixed-width refetch.** The naive version
  — "always refetch the newest 30 and re-glue it to whatever was appended
  after" — has a real bug: once the reader has scrolled to page 2+, new
  letters arriving push the old page boundary down, so a fixed-width refetch
  no longer lines up with where the appended page actually starts, and 1-2
  letters can silently vanish from the list. Instead, the first time the
  reader scrolls past page 1, the hook freezes a boundary cursor at the last
  loaded letter; every poll and mutation from then on refetches only what's
  strictly newer than it and splices that onto the untouched, already-loaded
  tail (`spliceConversation` in `src/hooks/conversationPaging.ts`) — a letter
  can't fall through a seam that never moves.
- **The Supabase adapter's archived/pending-scheduled filter moved from JS
  into the SQL `where` clause.** It used to fetch every bond letter and
  filter in JavaScript after the fact; a `limit` applied before that filter
  would have returned a page that looked full but wasn't, so the filter had
  to move into the query itself before pagination could mean anything.
- **No schema change, no RLS change, no live migration.** This phase is
  entirely a query-shape and application-state change — `schema.sql` and
  `policies.sql` are untouched.
- **Two small, reused UX pieces**, deliberately not new notification
  machinery: a scroll-to-top button, and a "new letter" toast that extends
  the app's one existing `Toast` component with an optional click handler
  and a longer duration rather than inventing a second surface.
- **Scope: the current conversation only.** The archive and past chapters
  still fetch everything in one request — revisit if either grows large
  enough to need this too.
```

- [ ] **Step 2: Update the test count**

Run: `npm test`
Copy the exact reported test count into the command table's row (`| npm test | Vitest, N logic-level tests across M files |`), replacing whatever number is currently there.

- [ ] **Step 3: Verify and commit**

Run: `git diff --stat`
Expected: only `README.md`.

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add README.md
git commit -m "docs: record phase 9"
```

- [ ] **Step 4: Report what's left**

Tell the owner, in these words or close to them:

> No SQL to hand off this time — Phase 9 only changed the shape of an
> existing query and how the client paginates it, so there's nothing to
> apply in the Supabase SQL editor. What's unverified: the Supabase
> `listConversation` query in `src/data/supabaseRepository.ts` (the `.or()`
> filter combinators for the archived/pending-scheduled exclusion and the
> cursor) has not been run against the live project — the contract suite
> only exercises the mock. Running the app against real Supabase data and
> scrolling a real, longer-than-30-letter conversation is what actually
> proves it.

---

## Self-Review

**Spec coverage.** Scope (conversation list only) — Tasks 1-5. TikTok-style auto-load via sentinel — Task 8, Step 5. 30/page, cursor-based, not offset — Tasks 2-3 (`limit`, `olderThan`, `newerThan`), Task 5 (`PAGE_SIZE`). Frozen refresh boundary avoiding the fixed-width gap — Task 4 (`spliceConversation`) and Task 5 (`pageBoundary` ref, `load()`). No virtualization — nothing in this plan adds any; confirmed absent by omission. Scroll-to-top button, terracotta, bottom-right, 300px threshold, smooth scroll — Task 7. New-letter toast, cream/charcoal/terracotta via the existing `Toast` chrome, 💌, 5s, reuses `Toast` rather than a new surface, click scrolls to top — Task 6 (extension) and Task 8 (wiring). Partner-only arrival filtering (not the reader's own delivered scheduled letter) — Task 4 (`detectPartnerArrivals`) and its tests.

**Placeholder scan.** No TBD/TODO; every code step has real, complete code; every "Find" block is copied verbatim from the files read while writing this plan.

**Type consistency.** `LetterCursor` (Task 1) is the same shape used in Tasks 2, 3, 5. `spliceConversation(fresh, boundary, previous)` and `detectPartnerArrivals(fresh, previous, partnerId)` (Task 4) are called with that exact parameter order and names in Task 5. `hasMoreLetters`, `loadingMore`, `loadMoreLetters`, `newArrivals`, `clearNewArrivals` are named identically in the Task 5 interface, the Task 5 return statement, and the Task 8 destructure. `ScrollToTopButton`/`scrollToTop` (Task 7) match their Task 8 import and usage exactly.
