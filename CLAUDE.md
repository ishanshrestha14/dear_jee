# Working on Dear Jee

A letter app for two people who live apart. React 19 + TypeScript + Vite +
Tailwind v4 + Framer Motion, with Supabase as the entire backend. There is no
server-side application code — Postgres row-level security IS the authorization
layer.

Read `README.md` for the build record and `docs/superpowers/specs/` for the
decisions behind the code.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Vitest — logic-level tests only |
| `npm run typecheck` | `tsc -b` — **the** type gate |
| `npm run build` | Typecheck plus production build |
| `npm run lint` | oxlint |

**`npx tsc --noEmit` checks nothing in this repo.** The root tsconfig is
`{"files": [], "references": [...]}`, so it type-checks zero files and always
exits 0. It is never evidence of anything. Use `npm run typecheck`.

## Hard constraints

These are not style preferences. Each was a real defect found in review.

**Data layer**
- Repository methods return `{ data, error }` and NEVER throw. Every Supabase
  adapter method body goes through the `guard()` helper.
- Never narrow a `Result` with a truthiness check. Use `=== null` / `!== null`
  — the empty string is a falsy `string` and will not narrow. Supabase's own
  `error` objects are a different shape; `if (error)` is correct for those.
- Read methods return copies (`{ ...letter }`), never references into the
  store.
- **The mock has no RLS.** Whatever the database enforces with a policy, the
  mock must reimplement in TypeScript, or the two implementations diverge and
  the app behaves one way in development and another in production.

**SQL**
- A LIVE Supabase project exists. `schema.sql` and `policies.sql` must stay
  idempotent and safe to re-run: `add column if not exists`,
  `drop constraint if exists` before `add constraint`, `create or replace`.
- Every function carries `set search_path = public, pg_temp` — EXCEPT
  `new_invite_code`, which needs `public, extensions, pg_temp`. Without
  `extensions`, `gen_random_bytes` is unresolvable and every sign-up fails with
  "Database error saving new user".
- Comparing `auth.uid()` in an authorization check uses `is distinct from`, not
  `<>`. A NULL caller makes `<>` yield NULL, which is falsy in an `if`, so the
  guard silently permits instead of rejecting.
- The per-side ownership checks in `enforce_letter_update` are wrapped in
  `if current_user = 'authenticated'` so `security definer` functions can write
  both people's columns on their behalf. Removing that wrapper breaks account
  deletion and unlinking.

**Design**
- Never pure white `#FFFFFF` or pure black `#000000`.
- Palette is fixed: `#FDFBF7`, `#F4EFE6`, `#2C2825`, `#1A1A1A` at 85%,
  `#C87963`, `#D4AF37`, plus `--color-paper-edge`, `--color-ink-muted`,
  `--color-accent-soft`.
- **Three type ROLES only** — `font-ui` (Plus Jakarta Sans), `font-letter`, and
  `font-hand` (Caveat). The `font-letter` role is user-selectable per letter
  from a fixed set of five: Lora (default), EB Garamond, Courier Prime, Caveat,
  Dancing Script. Adding a sixth means changing `BODY_FONTS` in
  `src/lib/validation.ts`, the `letters_body_font_known` check constraint, and
  the loader in `src/design/letterFonts.ts` — all three, or a letter becomes
  unwritable, unreadable, or unstyled. UI chrome uses only `font-ui` and
  `font-hand`.
- A misspelled Tailwind token emits NO CSS and fails silently. Check names.
- All animation respects `prefers-reduced-motion` through the single
  `<MotionConfig reducedMotion="user">` in `src/app/App.tsx`. Never add
  per-component guards.
- `--color-ink-muted` fails WCAG AA at 3.74:1. This is a deliberate, recorded
  decision — do not "fix" it.

**Architecture**
- Components under `src/components/` must not import VALUES from `src/data/`.
  `import type` is fine and ratified.
- `src/data/index.ts` is the only place that chooses mock or Supabase.

**Testing**
- Logic-level only. No component tests, no hook tests, no jsdom, no Testing
  Library. This is a deliberate decision, not an omission — do not offer to add
  them.
- The contract suite runs against the MOCK ONLY. It asserts on seeded data, so
  a fresh Postgres would fail it for want of a seeding harness. Do not build
  one.

## Working style

- **Specs and plans are proposals.** Write the file, say where it is, and wait
  for review before committing it.
- Features go brainstorm → spec → task-by-task plan → execution, with a review
  after each task. Skipping straight to code on anything non-trivial has not
  gone well here.
- Say what you actually verified. "The SQL is unexecuted" and "I cannot see the
  rendered page" are both fine and expected; claiming otherwise is not.
- When a rule above looks wrong or redundant, it is usually load-bearing.
  Ask before removing it.
