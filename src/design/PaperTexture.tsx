import type { ReactNode } from 'react'

/**
 * A paper surface: the letter tone, a warm shadow, and a very low-opacity
 * fibre texture so the rectangle never reads as flat digital fill.
 *
 * The texture is an inline SVG feTurbulence encoded as a data URI — no
 * network request, and resolution-independent at any size.
 */
const TEXTURE_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")"

interface PaperTextureProps {
  children: ReactNode
  className?: string
  /**
   * Edge decoration — a folded corner, say — that must resolve against the
   * paper itself, not the padded content column. Rendered as a sibling of the
   * content wrapper, inside the outer `relative overflow-hidden` div: that
   * makes the outer div the containing block, so an inset means inset from
   * the paper edge rather than from the text, and, because the content
   * wrapper below is itself positioned and comes later in source, keeps the
   * decoration underneath the words in paint order.
   *
   * Passing decoration as an ordinary child instead resolves it against the
   * INNER wrapper — inset by the caller's padding — and paints it over the
   * letter.
   */
  ornament?: ReactNode
}

export function PaperTexture({ children, className = '', ornament }: PaperTextureProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-letter bg-paper-letter shadow-letter ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-multiply opacity-[0.035]"
        style={{ backgroundImage: TEXTURE_URI }}
      />
      {ornament}
      <div className="relative">{children}</div>
    </div>
  )
}
