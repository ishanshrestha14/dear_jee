# Infinite scroll for the conversation list — design

**Date:** 2026-09-18
**Status:** proposed, not implemented. Every statement of SQL in this document
is unexecuted.

## The problem

`listConversation` fetches the entire current-bond, non-archived letter list
in one request, every load and every 30-second poll. That's fine for tens of
letters. A bond that has been open for years — the realistic version of
"hundreds of letters" — pays for the whole history on every page load and
every poll tick, and the Inbox route renders the whole thing in one pass.

## What was decided, and why

**1. Scope: the current conversation only.** Archive and past chapters
(`listArchived`, `listChapter`) are read-only-ish, browsed far less often,
and out of scope for v1 — revisit if they turn out to need it too.

**2. TikTok/Instagram-style auto-load, not a "load more" button.** An
`IntersectionObserver` watches a sentinel near the bottom of the page (the
Inbox has no internal scroll container — it's a normal page scroll) and
fetches the next page when it comes into view. 30 letters initial, 30 per
scroll-triggered fetch.

**3. The existing "replace wholesale on poll/mutation" model is kept, but
`letters` splits into a live prefix and a frozen suffix, not "top 30 always."**
Today, `useLetters.load()` refetches the *entire* conversation on every poll
and every mutation (send, archive, delete...) and replaces `letters`
outright — no merge, no dedup, which is what keeps the hook's optimistic
updates and `mutating` ref simple. A literal "always refetch the newest 30
and re-glue it to whatever was appended after" was considered and **rejected**:
once a user has scrolled to page 2+, new letters arriving push the old
page-1/page-2 boundary down, so a fixed-width refetch of "30" no longer lines
up with where the previously-appended page 2 starts — 1–2 letters land in
neither segment and silently vanish from the list. Unacceptable for an app
built around never losing a letter.

Instead: the first time the user scrolls past page 1 (the first
`loadMore`), the hook freezes a **boundary cursor** — the `(createdAt, id)` of
the last letter in the currently-loaded array at that moment. From then on,
every poll and every mutation refetches with `newerThan: boundary` (no limit —
there is no ceiling on how many letters can arrive since the boundary) and
replaces only the prefix of `letters` up to the boundary; everything from the
boundary onward was loaded once, appended, and is never refetched. Because
`newerThan` fetches are defined by an absolute cursor rather than a count,
this can't create a gap: it is set-equivalent to "the boundary's neighborhood
never shifts," no matter how many letters arrive above it.

Before the first `loadMore` (i.e., fewer than 30 letters ever loaded, or the
user hasn't scrolled), there is no boundary yet and the hook keeps today's
behavior in shape only: refetch and replace outright, but capped at
`limit: PAGE_SIZE`, not unlimited — see the Hook section below.

**4. Cursor-based pagination, not offset.** `loadMore` fetches with
`olderThan: <last loaded letter's (createdAt, id)>` and a `limit`. Offset
pagination breaks under concurrent inserts (a new letter arriving shifts
every offset by one, causing skips or dupes on the next page); a keyset
cursor on `(created_at, id)` doesn't have that problem and the schema
already has `letters_participants_created_idx` / `letters_receiver_created_idx`
ordered by `created_at desc` to serve it. `id` is the tiebreak for letters
sharing a timestamp.

**5. Two small UX additions, both reusing existing pieces rather than adding
new notification machinery:**

- **Scroll-to-top button.** Fixed bottom-right, appears once the page has
  scrolled past 300px, terracotta (`--color-accent`), `shadow-letter-lifted`
  (the existing elevated-shadow token, already used by `Toast`). Click smooth-
  scrolls to top.
- **New-letter toast.** When a poll's `newerThan` refetch turns up a letter
  authored by the *partner* (not the reader's own letter — see below) that
  wasn't in `letters` before, show "New letter from {name} 💌" — matching the
  existing precedent of an emoji in toast copy (`ShareModal`'s "Link copied!
  ... 💌"). Clicking it scrolls to top. Reuses the single existing `Toast`
  component (see below) rather than inventing a second notification surface,
  keeping "the app's one notification system."

**Why filter to the partner's letters, not any new arrival:** a scheduled
letter the reader wrote themselves, delivering while their own tab happens to
be open, will newly appear in their own `letters` array at delivery time too
(it moves from `scheduled` into `letters`). That's not something arriving
*for* them — a toast announcing their own letter to themselves reads as a bug,
not a feature. Only a new letter whose `senderId` is the partner triggers the
toast.

**6. No virtualization.** Explicitly out of scope per direction — lazy
pagination only. 30 letters per DOM page is cheap enough that windowing the
DOM isn't worth the complexity yet.

## Data layer

`LetterRepository.listConversation` gains an optional second parameter;
omitted, it behaves exactly as today (every existing call in
`contractTests.ts` — none of which pass a second argument — keeps working
unchanged):

```ts
listConversation(
  userId: string,
  options?: {
    /** Only letters strictly after this point. Unbounded — used to refresh
     *  the live prefix once a boundary is frozen. Mutually exclusive with
     *  olderThan. */
    newerThan?: { createdAt: string; id: string }
    /** Only letters strictly before this point. Always paired with `limit` —
     *  used to load an older page. Mutually exclusive with newerThan. */
    olderThan?: { createdAt: string; id: string }
    /** Caps the rows returned. Required with olderThan or on its own for the
     *  first page; omitted with newerThan. */
    limit?: number
  },
): Promise<Result<Letter[]>>
```

Always ordered newest-first, matching today.

**Mock** (`mockRepository.ts`): after the existing `.filter(...).sort(...)`
in `listConversation`, apply `newerThan`/`olderThan` as an additional filter
on `(createdAt, id)` and slice to `limit` when given. Same function, same
filter predicate that already encodes archived/pending-scheduled exclusion —
nothing about that logic changes, pagination is applied after it.

**Supabase** (`supabaseRepository.ts`): today this fetches *every* bond
letter with `.select('*').eq('bond_id', ...)` and filters archived/pending-
scheduled status **in JS after the fetch**. That has to change: applying a
SQL `limit` before that JS filter would silently under-fill a page (fewer
than 30 real conversation letters could come back after the JS filter drops
some). The archived/pending-scheduled exclusion has to move into the SQL
`where` clause — mirroring `archivedBy()`'s own logic — so `order` + cursor
+ `limit` operate on the already-correct row set:

```sql
where bond_id = :openBondId
  and (
    (sender_id = :userId and sender_archived_at is null)
    or (receiver_id = :userId and receiver_archived_at is null)
  )
  and not (
    sender_id = :userId and scheduled_for is not null and scheduled_for > now()
  )
  -- plus, for a cursor: and (created_at, id) < (:cursorCreatedAt, :cursorId)   -- olderThan
  --                  or (created_at, id) > (:cursorCreatedAt, :cursorId)      -- newerThan
order by created_at desc, id desc
limit :limit  -- omitted for newerThan
```

This is expressible through the `supabase-js` query builder
(`.lt`/`.gt` combined via `.or()` for the tuple comparison, or a raw
PostgREST filter string) — the exact call shape is an implementation detail
for the plan, not this spec. No RLS change: this only narrows what the
existing `letters_select_participant` policy already allows the caller to
see.

**Types** (`src/data/types.ts`): the `LetterRepository.listConversation`
doc comment gets updated to describe pagination; a `LetterCursor` type
(`{ createdAt: string; id: string }`) is added for the two option fields.

**Contract tests** (`contractTests.ts`): new cases — `limit` caps the
result and returns the newest N; `olderThan` returns the next page with no
overlap or gap versus the first; `newerThan` returns only what's after the
cursor; a boundary-straddling scenario (insert a letter, then a `newerThan`
fetch at a pre-insert cursor returns exactly the one new letter). All run
against the mock only, per the existing contract-suite convention.

## Hook (`useLetters.ts`)

- New state: `hasMoreLetters: boolean`, `loadingMore: boolean`. The boundary
  cursor is a ref (`pageBoundary`), not state — it doesn't drive a render on
  its own.
- `load()` keeps loading `archived`/`held`/`scheduled` exactly as today
  (unpaged, out of scope). For `letters`: if `pageBoundary.current` is
  `null`, fetch with `limit: PAGE_SIZE` (today's shape, just capped) and
  replace `letters` outright, same as now. If a boundary is frozen, fetch
  with `newerThan: pageBoundary.current` and replace only the prefix of
  `letters` up to (not including) the boundary letter, concatenated with the
  untouched remainder.
- New `loadMoreLetters()`: guarded by `hasMoreLetters` and `!loadingMore`.
  Fetches with `olderThan: <last letter in current array>` and
  `limit: PAGE_SIZE`. On the *first* call, this is also the moment
  `pageBoundary.current` gets set (to what was, until now, the last loaded
  letter). Appends the result to `letters`; `hasMoreLetters` becomes
  `result.length === PAGE_SIZE` (heuristic: a short page means the end was
  reached; a full page might still be the end, in which case the next
  `loadMore` just returns empty and flips the flag — same heuristic used
  elsewhere in feed pagination, no extra count query needed).
- `poll()`: after fetching the refreshed prefix (per `load()`'s boundary
  logic above), diff the *new* letter IDs (not previously present in
  `letters` at all) whose `senderId === partnerId`, and surface them to the
  caller for the toast (a new `onNewLetters?: (letters: Letter[]) => void`
  passed into the hook, or a `newArrivals` return value the Inbox route
  watches — implementation detail for the plan).
- `PAGE_SIZE = 30`, a module constant in `useLetters.ts`.

## Toast extension

`Toast` gains two optional props, backward compatible with every existing
call site:

```ts
interface ToastProps {
  message: string
  onDone: () => void
  onClick?: () => void
  durationMs?: number // default 3000, unchanged
}
```

`onClick` present renders the toast as a `<button>` instead of a `<p>`
(cursor pointer, same visual chrome) and does not call `onDone` itself —
clicking still lets the auto-dismiss timer run its course, or the caller can
call `onDone` from within their `onClick` if they want it to disappear
immediately. The new-letter toast passes `durationMs: 5000` per the request
above; every other existing call (link copied, error messages) keeps the
default 3000 untouched.

## New components / UI

- **Scroll-to-top button**: a small new component (or inline in `Inbox.tsx`
  — implementation detail for the plan), `fixed bottom-6 right-6`,
  `bg-accent` background, visible via a scroll listener threshold at 300px
  (`window.scrollY`), smooth-scrolls via `window.scrollTo({ top: 0,
  behavior: 'smooth' })`.
- **Reduced motion for the smooth scroll**: `window.scrollTo`'s `smooth`
  behavior is native browser scrolling, not a Framer Motion animation, so it
  sits outside the single `<MotionConfig reducedMotion="user">` in `App.tsx`
  — that provider only intercepts `motion.*` elements. Rather than a
  per-component reduced-motion check (which the hard constraint rules out),
  add one global CSS rule to `tokens.css`:

  ```css
  html { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
  }
  ```

  and drop `behavior: 'smooth'` from the JS call, letting the CSS property
  govern it — one place decides, same spirit as the existing rule.
- **Sentinel**: a zero-height `div` near the end of the letters list, watched
  by an `IntersectionObserver` that calls `loadMoreLetters()` when it enters
  the viewport. Torn down on unmount.
- **New-letter toast wiring**: `Inbox.tsx` already owns a `toast` state
  (currently `string | null`); it generalizes to carry the optional
  `onClick`, and the poll-detected arrivals (from the hook) populate it with
  the "New letter from {name} 💌" message and a scroll-to-top `onClick`.

## What's out of scope

- Archive and past-chapter pagination (backlog note: revisit if they grow
  large too).
- Virtualizing the DOM list itself.
- Any change to how letters are composed, sent, or rendered — this is purely
  about how many are fetched and when.

## Sub-project

Single sub-project: one repository method signature change (both
implementations), one hook restructuring, one small component (scroll-to-top
+ sentinel), one existing-component extension (`Toast`), one CSS rule. No
further decomposition needed before the implementation plan.
