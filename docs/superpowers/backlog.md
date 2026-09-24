# Backlog

Ideas raised in conversation, not yet spec'd. Each item gets its own
brainstorm → spec → plan cycle when its turn comes, per `CLAUDE.md`'s working
style. This file is just the queue — not a design, not a commitment to any
particular shape yet.

## Done since this file was written

- **Scheduled delivery** — Phase 8.
- **Letter visual themes** — Phase 10. Built, then parked as too basic, and
  still unpushed on `phase-10-letter-themes`. Not abandoned; it wants a
  stronger idea of what stationery means here before it ships.
- **Reactions** — Phase 11. The shape check happened: the answer was a
  turned-down corner, not an emoji bar.
- **Drafts** — Phase 12. Device-local, one unfinished letter per user.
  Cross-device drafts were deliberately left out and are a separate
  decision if they are ever wanted.

## Up next, in order

1. **Letter templates / prompts** — opening lines to offer someone who's
   stuck, not a rigid form.
2. **Streaks** — a quiet sense of ongoing momentum between two people.
3. **Dark mode**
4. **PWA installability** — add-to-home-screen. Confirmed feasible on
   Vercel's static hosting; needs a manifest + service worker
   (e.g. `vite-plugin-pwa`), no server-side change.

## Also raised, unordered

- **Search** — across all past letters/chapters.
- **Export a chapter** — a bond's whole correspondence as a keepsake PDF.
- **"On this day"** — surface a letter from a year ago on its anniversary.
- **Soft-delete with a grace window** — today's delete is immediate and
  permanent (a two-step confirm, but no undo). A short-lived undo toast
  is cheap insurance against a misclick.
- **Notification on delivery** — currently polling-only while the tab is
  open; no proactive nudge (push or email) when a letter arrives. Would be
  the first server-side code this project owns (an Edge Function or a
  database webhook), which is why it has stayed unordered.
- **Cross-device drafts** — Phase 12 keeps an unfinished letter on the
  device only. Syncing one would mean a table, an RLS policy, repository
  methods and mock parity, and unsent words living on a server.
- **Letters-exchanged counter** — a quiet running total on Settings.
