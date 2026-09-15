import { useEffect } from 'react'
import { formatLetterTimestamp } from '../lib/format'
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
        break-words is load-bearing, not cosmetic: whitespace-pre-wrap breaks
        at word boundaries only, so a pasted URL — one unbroken token longer
        than the column — would push the sheet past a 375px viewport. Named in
        the 2026-09-10 responsive audit as the most likely way a real letter
        breaks the page.
      */}
      <p
        className="mt-5 whitespace-pre-wrap break-words text-[17px] leading-[1.85] text-ink-letter"
        style={{ fontFamily: fontStack(bodyFont) }}
      >
        {body}
      </p>

      <div className="mt-8 text-right">
        <p className="font-hand text-3xl text-ink-ui">With love, {authorName}</p>
        {/*
          The date as a postmark rather than a caption: a ring of paper-edge
          around it, set small and wide. Still the same formatted date string.
        */}
        <p className="mt-3 inline-block rounded-full border border-paper-edge px-3 py-1 font-ui text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          {formatLetterTimestamp(createdAt)}
        </p>
      </div>
    </div>
  )
}
