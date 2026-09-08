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
