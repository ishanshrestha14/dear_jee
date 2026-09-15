import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Share2, X } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import { LetterSheet } from './LetterSheet'
import type { Letter } from '../data/types'

interface LetterModalProps {
  letter: Letter
  authorName: string
  recipientName: string
  archived: boolean
  /**
   * A letter in a past chapter. Hides the archive toggle, because with
   * listConversation scoped to the open bond an un-archived past letter would
   * appear in NEITHER home nor archive — it would simply vanish. Share and
   * Delete stay: both concern your own copy.
   */
  readOnly?: boolean
  trapActive: boolean
  onClose: () => void
  onArchive: () => void
  onDelete: () => void
  onShare: () => void
}

/**
 * The reading view. The panel carries the same layoutId as its card, so
 * Framer Motion grows it out of the card's position — the movement that
 * reads as a letter unfolding rather than a dialog appearing.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function LetterModal({
  letter,
  authorName,
  recipientName,
  archived,
  readOnly = false,
  trapActive,
  onClose,
  onArchive,
  onDelete,
  onShare,
}: LetterModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // A ref, not a dependency: the keydown listener is set up once per
  // mount (see the effect below), and reading trapActive through a ref lets
  // that same closure see the current value on every keystroke without
  // re-running the effect — and without a stale value from the render the
  // listener was created in.
  const trapActiveRef = useRef(trapActive)
  useEffect(() => {
    trapActiveRef.current = trapActive
  }, [trapActive])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      // Guard first, above Escape too: ShareModal registers its own window
      // keydown listener, so a single Escape reaches both. While the share
      // panel is open the letter must ignore Escape entirely and let
      // ShareModal handle it — otherwise the letter closes underneath it.
      if (!trapActiveRef.current) return
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !panel.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previouslyFocused?.focus()
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
      aria-label={`Letter from ${authorName}`}
    >
      <div className="fixed inset-0 bg-ink-ui/25 backdrop-blur-[2px]" aria-hidden />

      <motion.div
        ref={panelRef}
        tabIndex={-1}
        layoutId={`letter-${letter.id}`}
        onClick={(event) => event.stopPropagation()}
        transition={{ type: 'spring', stiffness: 210, damping: 26 }}
        className="relative w-full max-w-[600px] focus:outline-none"
      >
        <PaperTexture className="p-8 sm:p-12">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close letter"
            className="absolute right-4 top-4 z-10 rounded-full p-3 text-ink-muted transition-colors hover:text-accent"
          >
            <X size={18} />
          </button>

          <button
            type="button"
            onClick={onShare}
            aria-label="Share this letter"
            className="absolute right-16 top-4 z-10 rounded-full p-3 text-ink-muted transition-colors hover:text-accent"
          >
            <Share2 size={18} />
          </button>

          <LetterSheet
            salutation={letter.salutation}
            body={letter.message}
            bodyFont={letter.bodyFont}
            authorName={authorName}
            recipientName={recipientName}
            createdAt={letter.createdAt}
          />

          <div className="mt-10 flex items-center justify-end gap-4 border-t border-paper-edge pt-5">
            {confirmingDelete ? (
              <>
                <span className="font-ui text-xs text-ink-muted">
                  Delete this letter permanently?
                </span>
                <button
                  type="button"
                  onClick={onDelete}
                  className="px-3 py-3.5 font-ui text-xs text-accent underline underline-offset-4"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="px-3 py-3.5 font-ui text-xs text-ink-muted underline underline-offset-4"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={onArchive}
                    className="px-3 py-3.5 font-ui text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-accent"
                  >
                    {archived ? 'Move back' : 'Archive'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="px-3 py-3.5 font-ui text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-accent"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </PaperTexture>
      </motion.div>
    </motion.div>
  )
}
