# Backlog

Ideas raised in conversation, not yet spec'd. Each item gets its own
brainstorm → spec → plan cycle when its turn comes, per `CLAUDE.md`'s working
style. This file is just the queue — not a design, not a commitment to any
particular shape yet.

## Up next, in order

1. **Scheduled delivery** — write now, letter arrives on a chosen future
   date. Urgent: a specific birthday is the trigger for this one.
2. **Letter visual themes** — stationery-level look (paper, ornament,
   border), distinct from the existing per-letter body-font picker from
   Phase 7.
3. **Reactions** — a quiet acknowledgment the reader can leave on a letter.
   Needs a deliberate shape check before building: a chat-style emoji bar
   is the default instinct and probably wrong for this app's voice (see
   `docs/superpowers/specs/2026-09-14-composer-delivery-reading-design.md`
   decision 5 — "this is a letter app, not a chat").
4. **Letter templates / prompts** — opening lines to offer someone who's
   stuck, not a rigid form.
5. **Streaks** — a quiet sense of ongoing momentum between two people.
6. **Dark mode**
7. **PWA installability** — add-to-home-screen. Confirmed feasible on
   Vercel's static hosting; needs a manifest + service worker
   (e.g. `vite-plugin-pwa`), no server-side change.

## Also raised, unordered

- **Drafts** — a letter is currently either held or sent; closing the
  composer mid-write loses everything.
- **Search** — across all past letters/chapters.
- **Export a chapter** — a bond's whole correspondence as a keepsake PDF.
- **"On this day"** — surface a letter from a year ago on its anniversary.
- **Soft-delete with a grace window** — today's delete is immediate and
  permanent (a two-step confirm, but no undo). A short-lived undo toast
  is cheap insurance against a misclick.
- **Notification on delivery** — currently polling-only while the tab is
  open; no proactive nudge (push or email) when a letter arrives.
- **Letters-exchanged counter** — a quiet running total on Settings.
