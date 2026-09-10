# Sharing — Design Spec

**Date:** 2026-09-10
**Status:** Approved for planning
**Builds on:** `docs/superpowers/specs/2026-09-08-dear-jee-design.md` (§5.2, §7)
and `docs/superpowers/specs/2026-09-09-letters-outlive-the-bond-design.md`
**Closes:** the two sharing items carried over in
`docs/superpowers/specs/2026-09-08-phase-3-carryover.md`

---

## 1. What this builds

A letter can be published as an unlisted URL and read by someone who is not
signed in and never will be. This is Phase 4 of the original plan, and the last
feature phase before polish.

The PRD's reasoning still governs: a long-distance couple already lives in
WhatsApp and iMessage, and a beautiful letter that can only be seen inside this
app is a letter they cannot show anyone. Sharing exists so a moment can leave
the app without leaving the aesthetic behind.

### Already built

`share_slug` and `is_public` columns; CSPRNG slug generation
(`src/lib/slug.ts`, 12 characters of Base58, ~70 bits); `get_public_letter`, a
`security definer` function returning exactly four columns to `anon`;
`getBySlug` on both repository implementations. None of it has a UI caller.

### Not in this phase

Link expiry, view counts, a share-history page, and anything resembling Drive's
people-and-roles machinery. A two-person app has no roles, no third party to
invite, and immutable letters — those controls would either do nothing or claim
powers that do not exist.

## 2. Decisions

| Question | Decision |
|---|---|
| A shared letter is deleted by one of them. Does the link die? | Yes — either person deleting revokes it. |
| A shared letter is archived. Does the link die? | **No.** |
| Can a link be turned off without deleting the letter? | Yes — sharing is a toggle. |
| Does re-sharing mint a new URL? | No — the original slug is preserved and revived. |
| How much of Drive's share modal applies? | The General-access section only. |

**Why archiving must not revoke.** `unlink_partner` archives the entire
correspondence on both sides. If archiving killed links, a breakup would
silently break every link either person had ever sent to anyone. Archiving
tidies your own view; publishing is a separate act with its own switch.

**Why deleting must revoke.** Deleting is the closest thing the app has to "I
do not want this out there any more." A letter you deleted remaining readable
by a stranger holding an old link is a surprise discovered at a bad moment.

## 3. Data and SQL

**No schema changes.** Every column needed exists. This phase changes one
function and adds no `alter` statements, which makes it the safest migration in
the project so far: re-running `schema.sql` is sufficient.

### 3.1 `get_public_letter` gains a deletion clause

```sql
  where l.share_slug = slug
    and l.is_public = true
    and l.sender_deleted_at is null
    and l.receiver_deleted_at is null
```

This is the entire enforcement of the deletion decision. It lives in the
function because that function is the only thing an anonymous reader can reach
— a check in the client would be advisory, since the reader is not running our
client.

There is deliberately **no** archive clause.

### 3.2 Sharing becomes atomic

The current `share` reads the row, decides on a slug, then writes — two
statements with a window between them. Two concurrent shares of an unshared
letter can generate different slugs, and the first caller is handed one the
second has already overwritten.

It becomes a single statement, with the slug resolved by `coalesce`:

```
update letters
   set share_slug = coalesce(share_slug, <new slug>),
       is_public  = <shared>
 where id = <id>
```

`coalesce` is what makes un-sharing and re-sharing revive the *same* URL rather
than mint a new one. No new RPC: the column grant already permits `is_public`
and `share_slug`, and `enforce_letter_update` already allows either participant
to change them.

Slugs continue to be generated client-side by `crypto.getRandomValues`. That is
a real CSPRNG, and the unique constraint on `share_slug` is the backstop.

## 4. The repository contract

`share(letterId)` is replaced by:

```ts
setShared(letterId: string, shared: boolean): Promise<Result<Letter>>
```

Naming it as a toggle, like `setArchived` before it, keeps the two states
symmetrical instead of treating un-sharing as an afterthought. It returns the
updated `Letter` so the caller learns the slug.

`getBySlug(slug)` is unchanged in signature. Its mock implementation must now
apply the same four conditions the SQL function applies — slug matches,
`is_public`, and neither side deleted — because the mock has no policies and no
function to lean on. This is the third occasion this pattern has appeared, and
it is now a known shape: **whatever the database enforces, the mock
reimplements, or the two diverge.**

### 4.1 Contract cases

| Case | Guards against |
|---|---|
| sharing twice reuses the slug | links already sent dying on a re-share |
| un-sharing then re-sharing revives the same slug | the toggle minting a new URL |
| an un-shared slug no longer resolves | a "stop sharing" that stops nothing |
| a deleted letter's slug no longer resolves | the deletion decision, unenforced in the mock |
| an **archived** letter's slug still resolves | a breakup silently killing every link |

The last two are inverse assertions of each other. They are the two ways to get
this wrong, in opposite directions, and each looks correct in isolation.

## 5. The hook

`useLetters` gains `setShared(id, shared)`, following the pattern the previous
phase settled: reload after the mutation, then set any error **after** the
reload, never before — `load` clears the error on success and would otherwise
wipe it within a render.

## 6. Interface

### 6.1 The share modal

Opened by the `Share2` icon in the letter's top-right — the corner reserved for
it since Phase 2. Drive's General-access section, rendered on paper:

- **"Share this letter"**, then the current state in plain words: *"Only the two
  of you can read this"* or *"Anyone with the link can read this."*
- **The access control**: Only you two / Anyone with the link. This is
  `is_public` alone. Switching to "Only you two" sets it false and RETAINS the
  slug, which is what lets the same URL come back if they share again.
- **The link**, shown in full only while the letter is shared, reusing the
  treatment `InviteLink` already uses so the app has one way of presenting a
  copyable URL. When access is "Only you two" the link row and both buttons are
  hidden entirely rather than disabled: the slug still exists in the database,
  but showing a URL that does not resolve invites someone to send it.
- **Copy link**, and native **Share** via the Web Share API where available,
  with a clipboard fallback. The icon morphs to a check for about 1.2 seconds.

### 6.2 Nested focus traps

`LetterModal` already traps Tab. A second trap inside it fights the first, and
the symptom is Tab escaping to the page behind both.

`LetterModal` gains a `trapActive` prop, false while the share modal is open.
The share modal owns the trap and returns focus to the Share button on close.

This is a small change to existing code and skipping it produces a keyboard
trap that is genuinely difficult to escape.

### 6.3 The toast

A new component: bottom-centre, warm paper surface, auto-dismissing after about
three seconds.

> Link copied! Send it to them on WhatsApp 💌

Verbatim from the PRD. It also carries share errors, so the app keeps one
notification system rather than two.

### 6.4 The public page

`/letter/:slug` renders **outside** `RequireAuth` and outside the app chrome —
no header, no navigation, nothing to sign into. Just the letter on paper,
centred, max-width 600px, with a small "Dear Jee" mark beneath it.

It must not call `useLetters`, which requires a signed-in user. It calls
`letterRepository.getBySlug` through its own small hook.

Three states:

1. **Loading.**
2. **Found** — the letter, its date, and the two names.
3. **Not available** — a designed page, not an error. Strangers land here
   whenever a link has been un-shared or its letter deleted, and it should read
   as *"this letter isn't available"* rather than as a fault.

Getting the auth boundary wrong sends strangers to a sign-in page. That is the
most likely way this feature ships broken.

## 7. Testing

Logic-level only, per the standing decision. No component tests, no hook tests.
The contract suite runs against the mock only.

## 8. Out of scope

- Link expiry, view counts, share history.
- Any UI for `unlink_partner()`.
- Realtime, a sent folder beyond the existing merged timeline, multiple letter
  fonts.
- Deployment — Phase 5.
