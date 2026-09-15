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
    <div className="px-2 sm:px-6">
      <p className="text-lg text-ink-letter" style={{ fontFamily: fontStack(bodyFont) }}>
        Dear {salutation ?? recipientName},
      </p>

      {/*
        The first fold. A letter would have been tri-folded to fit an
        envelope, but a crease positioned by a FRACTION of the sheet's
        height is still content-relative: a short letter's sheet is barely
        taller than its own text, so a percentage-based crease landed inside
        the salutation or signature line instead of the whitespace around
        them, and inflating the sheet with a fixed min-height to give it
        somewhere to fall just made a short letter's modal mostly blank
        space. Placing the crease as a real element between the blocks, sized
        by its own margin rather than the sheet's total height, fixes both:
        it always falls in the gap that is already there, and it never asks
        for a page taller than the letter needs.

        A soft gradient band (fading in from nothing, out to nothing again)
        rather than a 1px rule, because a hairline laid over leading-[1.85]
        prose has no way to know where a text line ends and can land inside a
        glyph, reading as a stray strikethrough. Colour comes only from the
        existing paper-edge token and an ink-derived shadow at low opacity;
        no new colour values.
      */}
      <div
        aria-hidden
        className="my-6 h-2 w-full"
        style={{
          background: 'linear-gradient(to bottom, transparent, var(--color-paper-edge), transparent)',
          boxShadow: 'inset 0 1px 2px rgba(44, 40, 37, 0.08)',
        }}
      />

      {/*
        break-words is load-bearing, not cosmetic: whitespace-pre-wrap breaks
        at word boundaries only, so a pasted URL — one unbroken token longer
        than the column — would push the sheet past a 375px viewport. Named in
        the 2026-09-10 responsive audit as the most likely way a real letter
        breaks the page.
      */}
      <p
        className="whitespace-pre-wrap break-words text-[17px] leading-[1.85] text-ink-letter"
        style={{ fontFamily: fontStack(bodyFont) }}
      >
        {body}
      </p>

      {/* The second fold, same reasoning as the first. */}
      <div
        aria-hidden
        className="my-8 h-2 w-full"
        style={{
          background: 'linear-gradient(to bottom, transparent, var(--color-paper-edge), transparent)',
          boxShadow: 'inset 0 1px 2px rgba(44, 40, 37, 0.08)',
        }}
      />

      <div className="text-right">
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
