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
}

export function PaperTexture({ children, className = '' }: PaperTextureProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-letter bg-paper-letter shadow-letter ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-multiply opacity-[0.035]"
        style={{ backgroundImage: TEXTURE_URI }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
