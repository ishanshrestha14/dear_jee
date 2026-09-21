# Carry-over into Phase 3

Decisions and known gaps from the Phases 1-2 build (branch
`phase-1-2-mock-experience`) that must not be lost. Written 2026-09-08.

## Must happen BEFORE the Supabase adapter is written

**Extract a reusable repository contract suite.**
`src/data/mockRepository.test.ts` holds 15 tests, but they call
`createMockRepositories()` directly and bind to its seed data, so they cannot
be run against a second implementation. The whole architectural bet of Phases
1-2 is that `supabaseRepository` satisfies the same contract as
`mockRepository` — as written, Phase 3 cannot verify that and will either
duplicate the assertions or ship the adapter untested against them.

Extract `describeLetterRepositoryContract(name, setup)` where `setup` yields
`{ letters, profiles, userId, partnerId }`, call it once with the mock, and
call it a second time with the Supabase adapter. This was deliberately
deferred out of the Phases 1-2 fix wave because restructuring 15 passing
tests with only one implementation risks the suite for no present gain — but
its value disappears entirely if the adapter is written first. Make it the
first task of Phase 3.

## Open decision for the user

**Text contrast fails WCAG AA in three places.** Measured against the papers:

| Token | Value | Ratio | Where it is used |
|---|---|---|---|
| `--color-ink-muted` | `#8a8078` | 3.74:1 | letter dates, word count (12px), header link, loading text |
| `--color-accent` | `#c87963` | 3.21:1 | error text; inverted as button label on `bg-accent` |

AA requires 4.5:1 for text under 18.66px. Darkening `--color-ink-muted` to
about `#6f665e` reaches roughly 5.3:1 and fixes the largest offender without
touching the six colours the PRD mandates.

This was NOT changed during the Phases 1-2 fix wave, deliberately: the faded,
warm, low-contrast look is something the PRD chose on purpose, and trading it
against legibility is the product owner's call, not an implementer's. The
related focus-ring failure (`ring-accent-soft`, ~1.3:1) WAS fixed, because an
invisible keyboard focus indicator is a functional defect rather than an
aesthetic choice.

## Known Phase 3 edit sites

- `src/data/index.ts` — `currentUserId` is a module-level constant. Under real
  auth the id is known only after an async session fetch and changes on
  sign-in/sign-out. It must become an argument or context value, and
  `useLetters`' effect deps must include it (they are currently `[]`, so the
  hook can never re-run for a different user).
- `src/hooks/useLetters.ts` — `Inbox` and `Compose` each mount their own
  instance, so the partner is resolved twice. Hoist into a provider.
- `src/routes/Inbox.tsx` — `receiverName="you"` is hardcoded; use the real
  profile name once auth exists.
- `letters` table — add `CHECK (char_length(message) BETWEEN 1 AND 5000)`.
  `mockRepository` calls `validateLetter` inside the repository, which reads
  as a server-side guard; the Supabase adapter cannot do this and RLS does not
  check content, so that guarantee evaporates unless the constraint is added.

## Ratified deviations from the PRD and spec

- Three palette tokens beyond the PRD's six: `--color-paper-edge` `#e8e0d2`,
  `--color-ink-muted` `#8a8078`, `--color-accent-soft` `#e3b3a4`. Six colours
  cannot build a UI.
- Components import `Letter` from `src/data/types` as `import type`. Spec 3.2
  says nothing under `components/` imports from `data/`; the constraint's
  purpose is no runtime dependency, and type imports erase entirely under
  `verbatimModuleSyntax`.
- Tailwind v4 with a CSS `@theme` block instead of the PRD's
  `tailwind.config.js`.
- React 19 rather than the PRD's React 18 (the scaffold's current default;
  satisfies "18+").
- `npx tsc --noEmit` is a no-op in this repo — the root tsconfig is
  `{"files": [], "references": [...]}`. Use `npm run typecheck` (`tsc -b`).

## Resolved from the Phase 3 Task 2 security review

**`letters` foreign keys are now `on delete set null`.** The cascade
configuration would have deleted either account destroyed the entire
correspondence, including the surviving partner's letters. Now changed: the ids
go to null and a `before delete` trigger on `profiles` freezes the departing
person's name and archives the survivor's side. Letters survive their author.

**`link_partners` split its exceptions.** Previously raised `ALREADY_LINKED`
for both "you have a partner" and "the code's owner has one", making it
impossible to tell which was wrong. Now distinguishes: `ALREADY_LINKED` for the
former, `LINK_ALREADY_USED` for the latter.

**`link_partners` still uses `if me is null` rather than `if not found`.** Works
for a composite variable; `if not found` is the idiom and is robust to an
all-null row. Cosmetic and left unchanged.

## Phase 3b carry-over: sharing and deleted letters

**`get_public_letter` ignores the new archive and delete columns.** A letter
shared and later deleted by one party would still resolve by its slug — the
function checks only `is_public` and `share_slug`, not `sender_deleted_at` or
`receiver_deleted_at`. Nothing calls this function yet; sharing is Phase 4.
Phase 4 owns this: decide whether a deleted letter should remain publicly
readable or vanish from the share link, and apply the check then.

**Resolved in Phase 4.** `get_public_letter` now adds `and
l.sender_deleted_at is null and l.receiver_deleted_at is null` to its `where`
clause, so either person deleting the letter revokes the link. Archiving was
deliberately left out of that clause: `unlink_partner` archives the whole
correspondence, and revoking on archive would mean a breakup silently broke
every link either person had ever sent.

## Deferred from the Phase 3 Task 4 review

**`getByInviteCode` cannot see a stranger's profile under RLS.** The
`profiles` select policy admits only your own row and your partner's, so
looking up an unlinked person by invite code returns nothing and the method
reports "That invite link is not valid." for a perfectly valid code. Nothing
calls it: `JoinPartner` uses `linkPartner`, which is `security definer` and
bypasses RLS, and `InviteLink` reads the user's own profile. Do NOT build a
pre-link partner preview on this method — making it work would require a
security-definer lookup that turns invite codes into a name-enumeration
oracle. Use a different mechanism if that feature is ever wanted.

## Carried out of Phase 3

**`Inbox.tsx` still hardcodes `receiverName="you"`**, so the letter modal opens
"Dear you,". Correct before auth existed; now that a real profile is available
it should use it. The Phase 3 plan never scheduled this — a plan omission
rather than an implementation defect.

**`unlink_partner`'s stale-read guard locks out of canonical order.** Both
`link_partners` and `unlink_partner` lock the two profile rows lower-uuid-first
so they cannot deadlock against each other. The exception is `unlink_partner`'s
guard for a partner that changed between its unlocked read and its lock: that
path re-locks while already holding the caller's row. The window requires a
concurrent `link_partners` on the same user at that instant; Postgres aborts one
side rather than corrupting. The function has no UI caller yet. If a Phase 4+
feature calls it, close this by re-reading `partner_id` under the caller's lock
and restarting the ordered acquisition.

**`share` is a non-atomic read-then-write** in `supabaseRepository.ts`: two
concurrent shares of an unshared letter can generate different slugs and the
first caller is handed one the second overwrote. No caller exists until Phase 4
— build the share button on a single `coalesce(share_slug, $1)` update or an
RPC rather than patching the current shape.

**Resolved in Phase 4.** `share(letterId)` became `setShared(letterId,
shared)`, a toggle, and the write became a single statement: an `update`
guarded by `.is('share_slug', null)` so it can only ever set a slug on a
letter that has none, falling through to a plain `is_public` flip when that
guard finds the letter already has one. There is no longer a window between
reading a slug and writing it.

## Carried out of the sharing phase

**`setShared` takes no `userId`, so the mock cannot enforce participation.**
`setArchived` and `deleteForMe` both take one specifically so the mock can
reimplement the per-side rule the database enforces. Sharing has no per-side
column, and the participant check lives only in the `letters_update_participant`
policy — so the mock allows `setShared` on any letter by id. Not exploitable
(the mock is dev-only and both call sites pass a letter from the user's own
list), but it is the one place in the repository interface where the mock is
deliberately weaker than the database. Add the parameter and the check if this
interface is touched again.

**`openShare` calls `setSharingId` inside a `setOpen` functional updater.** An
impure updater — safe because it is idempotent, but it would fire twice under
StrictMode. Read `open` from the closure in a plain callback instead when next
in the file.

**The adapter double-writes when sharing an already-deleted letter.** The first
update writes, `.select()` returns nothing because the select policy hides the
caller's deleted side, so it falls through and writes `is_public` a second time
before reporting `'Letter not found.'`. Unreachable from the UI, since a deleted
letter appears in neither list.

**A participant can probe slug existence through the unique constraint.**
`share_slug` is in the `authenticated` column grant and `enforce_letter_update`
does not constrain it, so a `23505` violation confirms a guess. Irrelevant in a
two-person app where both people see every letter anyway, and 70 bits makes the
oracle useless — but constrain `share_slug` to null-to-non-null in the trigger
if this ever grows past two people.

**No toast after a native share.** When `navigator.share` exists, `copy()`
returns before `onCopied()`, so a mobile user gets the OS share sheet and no
toast. Arguably correct — the sheet is its own feedback — but it means the
spec's toast copy never appears on the device it names WhatsApp for.

## Carried out of the reactions phase (Phase 11)

**`PaperTexture.ornament` will not survive merging with `phase-10-letter-themes`
unmodified.** `src/design/PaperTexture.tsx` takes `ornament?: ReactNode` — a
single slot, not a list. Phase 11 (this branch) uses it for the folded-corner
decoration at bottom-left. The unmerged sibling branch
`phase-10-letter-themes` adds an identically named `ornament` prop to the same
component for its own stationery ornaments, at top-left and bottom-right.

Not a problem today: the two branches have not merged, and their corners do
not collide — top-left/bottom-right versus bottom-left. But one prop cannot
hold two ornaments, so once both land, a themed letter that is also folded
has no way to render both decorations as the code currently stands; whichever
branch merges second will silently drop the other's ornament.

The fix, whenever the merge happens, is one of: change `ornament` to accept a
list (`ornament?: ReactNode[]` or similar) and render each in source order, or
leave the prop as a single `ReactNode` and have call sites compose a
`<>...</>` fragment of both ornaments before passing it in. Either is a small
change to `PaperTexture.tsx` and its two-or-more call sites — not attempted
here, since the sibling branch is unmerged and speculative accommodation
would be worse than this note.
