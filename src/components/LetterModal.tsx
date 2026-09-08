import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import { formatLetterDate } from '../lib/format'
import type { Letter } from '../data/types'

interface LetterModalProps {
  letter: Letter
  senderName: string
  receiverName: string
  onClose: () => void
}

/**
 * The reading view. The panel carries the same layoutId as its card, so
 * Framer Motion grows it out of the card's position — the movement that
 * reads as a letter unfolding rather than a dialog appearing.
 */
export function LetterModal({ letter, senderName, receiverName, onClose }: LetterModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10 sm:py-16"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-ink-ui/25 backdrop-blur-[2px]" aria-hidden />

      <motion.div
        layoutId={`letter-${letter.id}`}
        onClick={(event) => event.stopPropagation()}
        transition={{ type: 'spring', stiffness: 210, damping: 26 }}
        className="relative w-full max-w-[600px]"
      >
        <PaperTexture className="p-8 sm:p-12">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close letter"
            className="absolute right-4 top-4 rounded-full p-2 text-ink-muted transition-colors hover:text-accent"
          >
            <X size={18} />
          </button>

          <p className="font-letter text-lg text-ink-letter">Dear {receiverName},</p>

          <p className="mt-6 whitespace-pre-wrap font-letter text-[17px] leading-[1.85] text-ink-letter">
            {letter.message}
          </p>

          <div className="mt-10 text-right">
            <p className="font-hand text-3xl text-ink-ui">With love, {senderName}</p>
            <p className="mt-2 font-ui text-xs tracking-wide text-ink-muted">
              {formatLetterDate(letter.createdAt)}
            </p>
          </div>
        </PaperTexture>
      </motion.div>
    </motion.div>
  )
}
