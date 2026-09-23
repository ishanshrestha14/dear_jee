# Drafts — the composer remembers

Phase 12. Written 2026-09-23.

A letter in this app is meant to be written slowly. Today, closing the tab
destroys it. This phase makes the composer remember an unfinished letter, and
does no more than that.

## What this is, and what it is deliberately not

**It is an invisible safety net.** One unfinished letter at a time — the one
you are writing. There is no drafts list, no save button, no naming, no
deleting, no badge, no count. Nothing to manage.

**It is not a shelf of unfinished letters.** That feature would be a visible,
deliberate thing you curate, and it is close enough to the HELD letter that
already exists (`listHeld` / `sendHeld`: written with no bond, addressed to
nobody, kept until sent) that building both would give the app two overlapping
answers to "an unsent letter I come back to". Held letters keep that role.

**It is device-local, and never reaches the database.** No table, no column,
no RLS policy, no repository method, no change to `LetterRepository`, no mock
parity work. A draft survives a refresh, a closed tab, a crash and a reboot.
It does not follow you from laptop to phone, and it is gone if site data is
cleared. Cross-device drafts are a separate decision for a later phase, and
choosing it later costs nothing that is built here.

## The module

`src/lib/draft.ts`, pure and framework-free.

```ts
export interface LetterDraft {
  message: string
  salutation: string
  bodyFont: BodyFont | null
  /** ISO. Not an expiry — a draft does not rot. Shown in the notice. */
  savedAt: string
}

export function draftKey(userId: string): string
export function readDraft(storage: StorageLike, userId: string): LetterDraft | null
export function writeDraft(storage: StorageLike, userId: string, draft: LetterDraft): void
export function clearDraft(storage: StorageLike, userId: string): void
```

`StorageLike` is the three methods actually used — `getItem`, `setItem`,
`removeItem` — not the DOM `Storage` type. Taking storage as an argument is
what makes this testable under this project's logic-level-tests-only rule: a
test passes a plain object, with no jsdom and no hook tests.

**Every access is wrapped in try/catch.** In a private window, with site data
blocked, or over quota, `localStorage` throws on access rather than returning
null. The correct behaviour is that the safety net silently does not exist:
`readDraft` returns null, `writeDraft` and `clearDraft` do nothing. A composer
that cannot save must never be a composer that cannot open.

**The key is `dearjee:draft:<userId>`, and the user id is not optional.** Two
accounts on one device is not hypothetical in an app whose whole premise is
two people; an unkeyed draft would show one person's unsent words to the other
on a shared laptop. `userId` comes from `useAuth()`. With `userId === null`
there is no key and therefore no draft — reads return null and writes are
dropped.

**Signing out does NOT clear the draft.** The per-user key is the protection.
Clearing on sign-out would destroy an unfinished letter every time someone
signs out and back in, which is the exact loss this phase exists to prevent.

**Reads are validated, never trusted.** `localStorage` is user-writable and
outlives deploys, so a stored entry is an untrusted string from an unknown
version of this app. `readDraft` returns null unless the parsed value is an
object with a string `message`, a string `salutation`, a string `savedAt`, and
a `bodyFont` that passes the existing `validateBodyFont` from
`src/lib/validation.ts`. Reusing that validator rather than writing a second
font check means adding a sixth font touches the list it already touches, and
not a fourth place. An invalid entry is treated as no draft at all.

**The scheduled date is deliberately not stored.** A date chosen on Tuesday
and restored on Friday may already be past, and `validateScheduledFor` would
reject it at send. Silently losing a picker selection is a smaller harm than
silently restoring an invalid one. A restored draft opens with scheduling off,
which is the composer's ordinary default.

## The wiring

**`Compose.tsx` owns persistence; `ComposeLetter.tsx` stays presentational.**
Nothing here goes near `src/data/`, so the components-must-not-import-data
rule is untouched.

**Restore needs almost no new surface.** `ComposeLetter` already takes
`initialMessage`, `initialSalutation` and `initialBodyFont` for the
edit-a-scheduled-letter case. A restored draft is those three props with
different values. The only new prop is `onDraftChange(draft)`, fired whenever
message, salutation or font changes.

**The draft is read in a `useState` initializer, not an effect.**
`Compose.tsx` already carries a comment about this exact hazard for the
`?edit=` path: `ComposeLetter`'s `useState` reads its initial values once, so
anything resolving after first render never reaches the textarea. A draft read
in an effect would be a silent no-op.

**Only the fresh branch.** The `key="new"` branch gets the restored values and
`onDraftChange`; the `editing` branch gets neither and is unchanged. A
scheduled letter already has a saved copy on the server, so its words are not
at risk from a closed tab — and local autosave there carries the opposite bug:
restoring stale local text over a newer saved version, or over a letter that
delivered or was cancelled while the tab was shut, none of which the device
can reliably observe. Held letters go through the fresh branch and are
therefore covered, which is right: a letter written with no bond is the one
most likely to be written slowly.

**Writes are debounced ~600ms, and flushed on unmount.** A synchronous
`localStorage` write per keystroke is a jank source on a 5000-character
letter. An empty or whitespace-only message calls `clearDraft` rather than
writing, so the restore notice can never appear over a blank page.

**Cleared on three events:** a successful send (including a held letter and a
scheduled one), a confirmed discard through the composer's existing
`confirmingCancel` flow, and "Start fresh". If discard left the draft behind,
throwing a letter away and reopening the composer would resurrect it.

## What is on screen

One line, above the paper, shown only when a draft was actually restored at
mount — never merely because storage is non-empty:

> Unsent, from 21 September 2026.  **Start fresh**

`font-ui`, `text-sm`, `--color-ink-muted`, the date from the existing
`formatLetterDate`. "Start fresh" is a button: it calls `clearDraft`, empties
message, salutation and font to their blank defaults, and removes the line.
No new palette tokens, no new type role, no per-component motion guard — the
single `<MotionConfig reducedMotion="user">` in `App.tsx` still governs.

The line exists because completely silent restoration leaves someone who
wanted a blank page with no way to get one but select-all-and-delete, and no
explanation of where the old words came from. It is a line and a button rather
than a dialog because a prompt between the person and the blank page, every
time they open the composer, is friction in the exact moment this app is
trying to keep quiet.

## Tests

`src/lib/draft.test.ts`, logic-level, against a fake `StorageLike`:

- round-trip: what `writeDraft` stores, `readDraft` returns
- per-user isolation: a draft written for user A is not readable as user B
- malformed JSON reads back as null
- a missing or non-string `message` reads back as null
- a `bodyFont` outside `BODY_FONTS` reads back as null
- a storage whose methods throw: `readDraft` returns null, `writeDraft` and
  `clearDraft` do not propagate
- `clearDraft` removes only that user's key

**Not covered, by the project's own testing rule:** the debounce timing, the
React wiring in `Compose.tsx`, and the rendered notice. There are no component
or hook tests in this repo and this phase does not add the first ones.

## Files

| File | Change |
|---|---|
| `src/lib/draft.ts` | new — the module above |
| `src/lib/draft.test.ts` | new — the suite above |
| `src/routes/Compose.tsx` | reads the draft at mount, persists on change, clears on send/discard, renders the notice |
| `src/components/ComposeLetter.tsx` | one new optional prop, `onDraftChange`; a way to reset fields for "Start fresh" |

No SQL. No change to `src/data/`. No change to the repository contract or the
contract suite.

## Open question for the owner

**"Start fresh" and the reset.** `ComposeLetter` holds message, salutation and
font in its own `useState`, so clearing them from outside is either a `key`
bump that remounts the composer or a new imperative prop. The `key` bump is
smaller and uses a pattern `Compose.tsx` already relies on; it also discards
the scheduling toggle and date, which for a "start fresh" button is arguably
correct rather than a side effect. The implementation plan should assume the
`key` bump unless you say otherwise.
