# Letter visual themes — design

**Date:** 2026-09-18
**Status:** proposed, not implemented. Every statement of SQL in this document
is unexecuted.

## The problem

Backlog item 2: "stationery-level look (paper, ornament, border), distinct
from the existing per-letter body-font picker from Phase 7." The font picker
changes what a letter sounds like; nothing yet changes what the paper itself
looks like. Every letter, regardless of occasion, renders on the same plain
sheet (`PaperTexture` + `LetterSheet`).

## What was decided, and why

**1. Four fixed themes, not a generative or open-ended set.** Mirrors the
`BODY_FONTS` pattern deliberately: a small, hand-designed, exhaustive list is
what kept the font picker cheap to maintain and impossible to render
inconsistently. A larger "stationery catalog" was considered and rejected for
v1 — more variety costs more design work per theme and more surface area to
keep inside the fixed palette.

**2. The reference point is restraint, not the mood-board it came from.** A
competing app's screenshot (wax seal, painterly floral illustration, pastel
postage stamp) supplied the *idea* of an ornament living in a corner and a
seal living near the signature — not its palette or its cheerfulness. Dear
Jee's palette is fixed (`CLAUDE.md`) and its voice is literary, not chatty
(see decision 5 in `2026-09-14-composer-delivery-reading-design.md`: "this is
a letter app, not a chat"). Every ornament below is single-color line art
using `currentColor` against an existing CSS variable — no new hex values
anywhere, no filled illustration.

**3. Theme is per letter, chosen at compose time, same interaction pattern as
the font picker.** A second row of pill buttons under the existing font row
in `ComposeLetter.tsx`, `aria-pressed` on the active one, stored with the
letter, immutable after send (same as font — there is no "edit an existing
letter" flow to hang a change on).

**4. The theme renders everywhere the letter renders: card, opened sheet, and
public share page.** Rejected: card-only or sheet-only. The composer, live
delivery, and reading view spec already established that `LetterSheet` is
shared between the recipient's view and a stranger's public view specifically
so the two never drift apart; a theme that only showed up in one context
would reintroduce that drift for `LetterCard` (the inbox preview), which
currently *does* already show the font (`LetterCard.tsx:42`). The border and
ornament follow the same rule.

**5. Names are mood/occasion words, not visual descriptions.** "Everyday",
"Keepsake", "In Bloom", "Sealed" — not "Plain", "Bordered", "Botanical",
"Wax Seal". This matches the app's existing voice (letters "arrive," dates
read as postmarks) more than the font picker's plain type-family names do,
because a theme is chosen for how a letter *feels*, where a font is chosen
for how it *reads*.

**6. `theme: null` means "Everyday," the current look, with no migration.**
Every letter written before this ships reads exactly as it does today.
Identical to how `bodyFont: null` falls back to Lora.

## The four themes

1. **Everyday** (`theme: null`) — today's look. Unchanged.
2. **Keepsake** (`id: 'keepsake'`) — a restrained double-rule border, inset
   ~10px from the sheet's edge, in `--color-paper-edge`. CSS only, no SVG.
3. **In Bloom** (`id: 'in-bloom'`) — a small single-color botanical sprig,
   inline SVG, `currentColor` set to `--color-ink-muted`, opacity ~0.35,
   placed top-left near the salutation line. Line art (stroke, not fill) —
   deliberately closer to a botanical field-guide plate than a greeting-card
   illustration.
4. **Sealed** (`id: 'sealed'`) — a small circular wax-seal-style mark, inline
   SVG, in `--color-accent` (`#D4AF37`), placed beside the signature/postmark
   block where the date already sits.

All four are additive to the existing sheet — none of them touch typography,
which stays governed entirely by the font picker.

## Data model

Mirrors `BodyFont` in `src/lib/validation.ts` exactly:

```ts
export const LETTER_THEMES = [
  { id: 'keepsake', label: 'Keepsake' },
  { id: 'in-bloom', label: 'In Bloom' },
  { id: 'sealed', label: 'Sealed' },
] as const

export type LetterTheme = (typeof LETTER_THEMES)[number]['id']

export function validateTheme(theme: string | null): ValidationResult {
  if (theme === null) return { ok: true }
  if (!THEME_IDS.includes(theme)) {
    return { ok: false, reason: 'That is not a theme this app knows.' }
  }
  return { ok: true }
}
```

"Everyday" is deliberately *not* in the array, the same way Lora is the
fallback but is also a real, selectable entry in `BODY_FONTS` — worth naming
explicitly here as a difference: `BODY_FONTS` includes its default (`lora`)
as an explicit array member with its own pill; `LETTER_THEMES` does not
include "Everyday," because "Everyday" is the absence of a theme, not a
theme. The composer's theme row will render "Everyday" as an extra pill
mapping to `null`, same as how a font's default is implied by no pill being
pressed — this asymmetry with the font row is intentional and is called out
again in Sub-project A below so it isn't "fixed" into false consistency
later.

**SQL** (`schema.sql`):

```sql
alter table letters add column if not exists theme text;

alter table letters drop constraint if exists letters_theme_known;
alter table letters add constraint letters_theme_known
  check (theme is null or theme in ('keepsake', 'in-bloom', 'sealed'));
```

No RLS/policy change — `theme` is just another column on `letters`, covered
by the same per-side ownership checks in `enforce_letter_update` that already
govern `body_font`.

**Mock parity** (`CLAUDE.md`: "the mock has no RLS... whatever the database
enforces with a policy, the mock must reimplement"): `mockRepository.ts` must
validate `theme` against `LETTER_THEMES` on write, exactly where it already
validates `bodyFont`, so an invalid theme id fails identically in dev and
prod.

**Types** (`src/data/types.ts`): `theme: LetterTheme | null` added to the
`Letter` type and to the create-letter input type, alongside `bodyFont`.

**Contract tests** (`src/data/contractTests.ts`): extend the existing
body-font assertions with parallel theme assertions — round-trips a themed
letter, rejects an unknown theme id, confirms `null` reads back as `null`.

## Rendering

New `src/design/letterThemes.ts`, structurally parallel to
`letterFonts.ts` but synchronous — themes are inline SVG and CSS, not web
fonts, so there is no lazy-loading concern:

```ts
export function themeBorderClass(theme: LetterTheme | null): string
export function ThemeOrnament({ theme }: { theme: LetterTheme | null }): JSX.Element | null
```

`themeBorderClass` returns a Tailwind class string (empty for `null` and
`'sealed'`, the border-adding one for `'keepsake'`). `ThemeOrnament` returns
`null` for `theme === null`, otherwise the corresponding inline SVG
positioned absolutely within the sheet's existing `relative` container
(`PaperTexture` already establishes one).

Three call sites apply both, all already theme-aware today via `bodyFont`:

- `LetterSheet.tsx` — the shared reading view (recipient + public page).
- `LetterCard.tsx` — the inbox list preview.
- `ComposeLetter.tsx` — live preview while writing, same as the font already
  previews live.

## Composer UI

`ComposeLetter.tsx` gains a second pill row directly under the existing font
row, same component shape (`aria-pressed`, same button styling), labelled
with the four theme names above (including "Everyday" as the explicit
null-mapping pill, per the asymmetry noted in Data model).

## What's out of scope

- Per-theme paper color or texture swap (backlog explicitly separates this
  from body font, but the reference research above showed border + ornament
  alone already delivers a distinct "stationery" feel without touching
  `PaperTexture`'s fixed tone — revisit paper-color variation only if these
  four themes feel insufficient after use).
- Editing a theme after a letter is sent (no edit flow exists for any letter
  field today).
- A sixth+ theme, or user-uploaded/custom ornaments.

## Sub-project

This is small enough to be a single sub-project — one column, one picker
row, one rendering module, three call sites. No further decomposition
needed before the implementation plan.
