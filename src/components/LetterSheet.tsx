import { useEffect } from 'react'
import { formatLetterDate } from '../lib/format'
import { fontStack, loadLetterFont } from '../design/letterFonts'
import type { BodyFont } from '../lib/validation'

interface LetterSheetProps {
  /** Null renders the recipient's name, which is how older letters read. */
  salutation: string | null
  body: string
  bodyFont: BodyFont | null
  authorName: string
  recipientName: string
  createdAt: string
}

/**
 * The letter itself — the paper, not the chrome around it.
 *
 * Shared by LetterModal and PublicLetter because they render the same object
 * and had already drifted apart once. A redesign applied to only one of them
 * would leave a stranger reading a plainer letter than the recipient does,
 * which is backwards: the public page is the one someone chooses to show
 * people.
 */
export function LetterSheet({
  salutation,
  body,
  bodyFont,
  authorName,
  recipientName,
  createdAt,
}: LetterSheetProps) {
  useEffect(() => {
    void loadLetterFont(bodyFont)
  }, [bodyFont])

  return (
    <div className="relative min-h-[480px] px-2 sm:px-6">
      <p className="text-lg text-ink-letter" style={{ fontFamily: fontStack(bodyFont) }}>
        Dear {salutation ?? recipientName},
      </p>

      {/*
        break-words is load-bearing, not cosmetic: whitespace-pre-wrap breaks
        at word boundaries only, so a pasted URL — one unbroken token longer
        than the column — would push the sheet past a 375px viewport. Named in
        the 2026-09-10 responsive audit as the most likely way a real letter
        breaks the page.
      */}
      <p
        className="mt-6 whitespace-pre-wrap break-words text-[17px] leading-[1.85] text-ink-letter"
        style={{ fontFamily: fontStack(bodyFont) }}
      >
        {body}
      </p>

      {/*
        The folds. A letter would have been tri-folded to fit an envelope —
        two creases, at roughly a third and two-thirds down the page, not one
        at the midpoint. Positions are fixed fractions of the sheet, but a
        fraction of an auto-height wrapper is still content-relative: a short
        letter's wrapper is barely taller than its own text, so 33%/66% of it
        used to land inside the salutation or signature line instead of the
        whitespace around them. The wrapper below carries a min-height for
        exactly this reason — it approximates a real page so the creases have
        somewhere to fall for a short letter, while a long letter that already
        exceeds it is unaffected.

        Each crease is a soft gradient band (fading in from nothing, out to
        nothing again) rather than a 1px rule. A hairline laid over
        leading-[1.85] prose has no way to know where a text line ends and
        can land inside a glyph, reading as a stray strikethrough. A band
        with no hard edge cannot do that — it reads as a valley in the paper
        instead. Colour comes only from the existing paper-edge token and an
        ink-derived shadow at low opacity; no new colour values.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[33%] h-2 -translate-y-1/2"
        style={{
          background: 'linear-gradient(to bottom, transparent, var(--color-paper-edge), transparent)',
          boxShadow: 'inset 0 1px 2px rgba(44, 40, 37, 0.08)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[66%] h-2 -translate-y-1/2"
        style={{
          background: 'linear-gradient(to bottom, transparent, var(--color-paper-edge), transparent)',
          boxShadow: 'inset 0 1px 2px rgba(44, 40, 37, 0.08)',
        }}
      />

      <div className="mt-10 text-right">
        <p className="font-hand text-3xl text-ink-ui">With love, {authorName}</p>
        {/*
          The date as a postmark rather than a caption: a ring of paper-edge
          around it, set small and wide. Still the same formatted date string.
        */}
        <p className="mt-3 inline-block rounded-full border border-paper-edge px-3 py-1 font-ui text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          {formatLetterDate(createdAt)}
        </p>
      </div>
    </div>
  )
}
