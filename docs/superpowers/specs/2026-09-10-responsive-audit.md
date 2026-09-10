# Responsive audit — structural only

**Date:** 2026-09-10

Every component and route read for four classes of problem: widths that cannot
shrink, horizontal overflow risk, tap targets under 44px, and absolute
positioning that could collide on a narrow screen.

**This is not a responsive pass.** Nobody working on this project can see a
rendered page. These are suspects found by reading code; the verdict requires
someone opening the deployed site on a phone. Findings are listed so that
person knows where to look first.

## Nothing here obviously breaks at 375px

No component declares a width that cannot shrink. Every `max-w-[…]` in the
codebase is a cap, not a floor, and the two share-URL rows — the only places
that render a long machine-generated string — both carry `break-all`. The
layout should reach 375px intact.

What is left is three kinds of *conditional* risk, all of which depend on
content rather than on the viewport alone:

1. **The letter body has no `break-words`.** It is the one place that renders
   arbitrary user text at full width. A pasted URL or any unbroken run of
   characters longer than the column will push the paper panel wider than the
   screen. This is the single most likely way a real letter breaks the page.
2. **Two absolutely-positioned icon rows sit on the same line as heading
   text.** A long recipient name or the share panel's heading could run
   underneath them at 375px.
3. **Nearly every tap target is under 44px.** The footer actions in
   `LetterModal` are roughly 16px tall. This is a comfort problem, not a
   layout one — nothing overflows — but it is the thing a thumb notices first.

## Findings

### 1. Widths that cannot shrink below 375px

| File | Line | Observed | Verdict |
|---|---|---|---|
| `src/components/ComposeLetter.tsx` | 36 | `mx-auto max-w-[600px]` | **Fine.** A cap; the block shrinks with the viewport. |
| `src/components/LetterModal.tsx` | 116 | `relative w-full max-w-[600px]` | **Fine.** `w-full` inside a `p-4` flex parent, capped at 600. |
| `src/components/ShareModal.tsx` | 74 | `relative w-full max-w-[420px]` | **Fine.** Same shape. |
| `src/routes/AuthScreen.tsx` | 35 | `mx-auto max-w-[420px] pt-10` | **Fine.** |
| `src/routes/JoinPartner.tsx` | 40 | `mx-auto max-w-[420px] pt-10` | **Fine.** |
| `src/routes/SetupProfile.tsx` | 39 | `mx-auto max-w-[420px] pt-10` | **Fine.** |
| `src/routes/PublicLetter.tsx` | 33 | `mx-auto max-w-[600px]` | **Fine.** Inside a `px-4` wrapper (line 32). |
| `src/components/Layout.tsx` | 20, 46 | `mx-auto max-w-3xl px-6` | **Fine.** |
| `src/components/InviteLink.tsx` | 28 | `mx-auto mt-8 max-w-sm` | **Fine.** |

Searched the whole of `src/components/` and `src/routes/` for `w-[`, `min-w-`
and `basis-[`: **no matches.** There is no fixed pixel width and no minimum
width anywhere in the UI. All seven `max-w-[…]` instances named in the plan
were confirmed to be `max-w`, not something stricter.

The one grid — `grid gap-5 sm:grid-cols-2` in `Inbox.tsx:110` and
`Archive.tsx:74` — is single-column below 640px. Correct.

### 2. Horizontal overflow risk

| File | Line | Observed | Verdict |
|---|---|---|---|
| `src/components/InviteLink.tsx` | 29 | The `/join/<code>` URL renders in a `<p className="break-all …">` | **Clean.** Checked; `break-all` is present. |
| `src/components/ShareModal.tsx` | 108 | The `/letter/<slug>` URL renders in a `<p className="mt-5 break-all …">` | **Clean.** Checked; `break-all` is present. |
| `src/components/LetterModal.tsx` | 139 | Letter body: `whitespace-pre-wrap` with **no** `break-words` / `break-all` | **Real risk.** `whitespace-pre-wrap` wraps at word boundaries only. A single unbroken token longer than the column — a pasted URL is the obvious case — will not break, and will widen the panel past the viewport. |
| `src/routes/PublicLetter.tsx` | 36 | Same body markup, same omission | **Real risk.** Worse here: this is the page strangers open on a phone. |
| `src/components/LetterCard.tsx` | 39–41 | `snippet(letter.message, 140)`, no break class | **Lower risk.** The 140-character cut bounds it, but 140 unbroken characters still overflow a 375px card. |
| `src/components/ComposeLetter.tsx` | 52 | `<textarea className="w-full resize-none …">` | **Fine.** `resize-none` prevents a drag-wider; a textarea's own overflow is internal and does not widen the page. |
| `src/components/LetterModal.tsx` | 144 | `With love, {authorName}` in `font-hand text-3xl` | **Fine in practice.** A name is short, and it wraps by word. Only a pathological single-token name overflows. |
| `src/routes/PublicLetter.tsx` | 40 | Same | **Fine in practice.** |
| `src/components/Toast.tsx` | 23, 25 | `fixed inset-x-0 bottom-8 … px-4` around a pill | **Fine.** The messages are fixed strings set in `Inbox`/`Archive`. |

The fix, if the phone check confirms it, is one class — `break-words` — on the
two body paragraphs. **This task does not apply it.**

### 3. Tap targets under 44px

Sizes below are the rendered box implied by the padding and Tailwind's
line-heights (`text-xs` = 12px/16px, `text-sm` = 14px/20px), not measurements.

| File | Line | Control | Implied size | Verdict |
|---|---|---|---|---|
| `src/components/LetterModal.tsx` | 123 | Close (`p-2`, icon 18) | **34 × 34** | Under 44. |
| `src/components/LetterModal.tsx` | 132 | Share (`p-2`, icon 18) | **34 × 34** | Under 44. |
| `src/components/ShareModal.tsx` | 81 | Close sharing (`p-2`, icon 16) | **32 × 32** | Under 44. The smallest icon button in the app. |
| `src/components/LetterModal.tsx` | 176, 183 | Archive / Delete (`text-xs`, no padding) | **≈16 tall** | Well under 44. The worst offenders, and they sit in a `gap-4` row so a mis-tap lands on nothing rather than on the wrong action. |
| `src/components/LetterModal.tsx` | 159, 166 | Delete / Cancel, the confirm step (`text-xs`, no padding) | **≈16 tall** | Well under 44 — on the one row in the app where a mis-tap is destructive. |
| `src/components/Layout.tsx` | 21 | "Dear Jee" home link (`text-3xl` hand) | **≈40 tall** | Marginal, and large enough in practice. |
| `src/components/Layout.tsx` | 28, 36 | Write a letter / Sign out (`text-sm`, no padding) | **≈20 tall** | Under 44. |
| `src/routes/Inbox.tsx` | 102 | Archive link (`text-xs`) | **≈16 tall** | Under 44. |
| `src/routes/Archive.tsx` | 67 | Back link (`text-xs`) | **≈16 tall** | Under 44. |
| `src/routes/AuthScreen.tsx` | 95 | Mode toggle (`text-xs`) | **≈16 tall** | Under 44. |
| `src/routes/NotFound.tsx` | 17 | "Go to Dear Jee" (`text-sm`) | **≈20 tall** | Under 44. |
| `src/routes/JoinPartner.tsx` | 69 | "Back to your letters" (`text-sm`) | **≈20 tall** | Under 44. |
| `src/routes/Archive.tsx` | 53 | "Back to your letters" (`text-sm`) | **≈20 tall** | Under 44. |
| `src/components/RequireAuth.tsx` | 27 | Sign out on the error state (`text-sm`) | **≈20 tall** | Under 44. |
| `src/components/ComposeLetter.tsx` | 67 | Send letter (`px-6 py-2.5`, `text-sm`) | **≈40 tall** | Marginally under 44. |
| `src/routes/AuthScreen.tsx` | 83 | Submit (`w-full`, `py-2.5`) | **≈40 tall**, full width | Fine in practice — the width carries it. |
| `src/routes/SetupProfile.tsx` | 72 | Continue (`w-full`, `py-2.5`) | **≈40 tall**, full width | Fine in practice. |
| `src/routes/JoinPartner.tsx` | 55 | Write a letter (`px-6 py-2.5`) | **≈40 tall** | Marginally under 44. |
| `src/routes/Inbox.tsx` | 78 | Write the first one (`px-6 py-2.5`) | **≈40 tall** | Marginally under 44. |
| `src/components/InviteLink.tsx` | 35 | Copy invite link (`px-5 py-2`) | **≈36 tall** | Under 44. |
| `src/components/ShareModal.tsx` | 114 | Copy link (`px-5 py-2`) | **≈36 tall** | Under 44. |
| `src/components/ShareModal.tsx` | 100 | Access `<select>` (`w-full px-3 py-2`) | **≈36 tall**, full width | Fine — a native select opens the OS picker. |
| `src/components/LetterCard.tsx` | 26–28 | The whole card (`w-full`, `p-6`) | Large | **Clean.** The primary target of the app is the easiest to hit. |

Nothing here overflows or breaks. Every one of these is a comfort question,
and the honest answer needs a thumb, not a code review.

### 4. Absolute positioning that could collide

| File | Line | Observed | Verdict |
|---|---|---|---|
| `src/components/LetterModal.tsx` | 123, 132 | Close at `right-4 top-4`, Share at `right-14 top-4`, each 34px wide | **They do not collide with each other.** Close occupies 16–50px from the right edge; share occupies 56–90px. A 6px gap. The plan flagged this pair as the obvious risk; it is clear. |
| `src/components/LetterModal.tsx` | 123, 132 vs 137 | Both buttons span roughly 16–50px from the panel's top; the greeting `Dear {recipientName},` starts at the `p-8` inset, 32px down | **Possible overlap.** The rows share vertical space. At 375px the panel's text column is about 279px wide and the buttons cover its rightmost ~74px, so a long recipient name would run underneath them. Short names are safe. |
| `src/components/ShareModal.tsx` | 81 vs 86 | Close at `right-4 top-4` (32px); `<h2>Share this letter</h2>` at the `p-7` inset, 28px down, `font-hand text-3xl` | **Possible overlap.** The heading is a fixed string, so this either collides on every phone or on none — one look settles it. |
| `src/components/LetterModal.tsx` | 99 | Overlay `fixed inset-0 … overflow-y-auto p-4 py-10 sm:py-16` | **Fine.** Scrolls vertically; the 16px inset keeps the panel off both edges. |
| `src/components/ShareModal.tsx` | 57 | Overlay `fixed inset-0 … items-center justify-center p-4` | **Fine**, with one caveat: `items-center` and no `overflow-y-auto`. The panel is short, so this only matters if the content grows. |
| `src/components/Toast.tsx` | 23 | `fixed inset-x-0 bottom-8 z-[60]` | **Fine.** Centred, `px-4`, above everything. |
| `src/components/Layout.tsx` | 20–44 | Header `flex … justify-between` with no `flex-wrap`, `px-6`, containing the wordmark plus up to two nav links | **Tight, not broken.** At 375px there are about 327px of usable width for "Dear Jee" plus "Write a letter" plus "Sign out". It should fit; it is the row most likely to look cramped. |

## What a phone check should look at, in order

1. Open a shared letter containing a long pasted URL. Does the page scroll
   sideways? (Findings 2 — `LetterModal.tsx:139`, `PublicLetter.tsx:36`.)
2. Open any letter. Do the close and share icons sit on top of the greeting?
   (Finding 4.)
3. Open the share panel. Does the close icon sit on top of its heading?
   (Finding 4.)
4. Try to tap Archive, then Delete, then Cancel with a thumb. (Finding 3.)
5. Look at the header while signed in with a partner linked. (Finding 4.)
