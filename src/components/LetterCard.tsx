import { motion } from 'framer-motion'
import { PaperTexture } from '../design/PaperTexture'
import { formatLetterDate, snippet } from '../lib/format'
import type { Letter } from '../data/types'

interface LetterCardProps {
  letter: Letter
  /** Whoever wrote it — hers on hers, yours on yours. */
  authorName: string
  /** Only ever true for a letter you received and have not opened. */
  unread: boolean
  onOpen: (letter: Letter) => void
}

/** Inbox preview. Hover lifts the shadow rather than moving the card. */
export function LetterCard({ letter, authorName, unread, onOpen }: LetterCardProps) {
  return (
    <motion.button
      type="button"
      layoutId={`letter-${letter.id}`}
      onClick={() => onOpen(letter)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ boxShadow: 'var(--shadow-letter-lifted)' }}
      className="w-full rounded-letter text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <PaperTexture className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <span className="font-hand text-2xl text-ink-ui">{authorName}</span>
          {unread && (
            <span
              role="img"
              aria-label="Unread"
              className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
            />
          )}
        </div>
        <p className="mt-3 font-letter text-[15px] leading-relaxed text-ink-letter">
          {snippet(letter.message, 140)}
        </p>
        <p className="mt-4 font-ui text-xs tracking-wide text-ink-muted">
          {formatLetterDate(letter.createdAt)}
        </p>
      </PaperTexture>
    </motion.button>
  )
}
