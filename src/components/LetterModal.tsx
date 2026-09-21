import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Archive, ArchiveRestore, Heart, Share2, Trash2, X } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import { FoldedCorner } from '../design/FoldedCorner'
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
  /** Whether this letter's corner is currently turned down. */
  folded: boolean
  /**
   * Folds or unfolds. Absent means no control — the writer, the archive and a
   * past chapter all see the fold but cannot change it.
   */
  onFold?: () => void
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
  folded,
  onFold,
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
      {/*
        will-change keeps this on its own compositing layer for as long as
        the modal is mounted — otherwise Chrome drops the backdrop-filter
        once the panel's layoutId transform animation settles, so the blur
        is visible mid-open and then vanishes. Deliberately NOT a `transform`
        hack: combining `transform` with `backdrop-filter` on the same
        element is a known Safari bug that kills the filter outright.
      */}
      <div
        className="fixed inset-0 bg-ink-ui/25 backdrop-blur-sm"
        style={{ willChange: 'backdrop-filter' }}
        aria-hidden
      />

      <motion.div
        ref={panelRef}
        tabIndex={-1}
        layoutId={`letter-${letter.id}`}
        onClick={(event) => event.stopPropagation()}
        transition={{ type: 'spring', stiffness: 210, damping: 26 }}
        className="relative w-full max-w-[600px] focus:outline-none"
      >
        <PaperTexture className="p-8 sm:p-12" ornament={folded ? <FoldedCorner /> : null}>
          {/*
            Close lives as an overlay above LetterSheet (not inside it —
            LetterSheet is the letter's own content, shared with the public
            page, which has no close button) but nudged to land level with
            the salutation it sits beside rather than floating off on its
            own. Share moved down to the bottom action row with Archive and
            Delete; the previous top-right Share button here was a
            duplicate left over from an earlier pass.
          */}
          <motion.button
            type="button"
            onClick={onClose}
            aria-label="Close letter"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            className="absolute right-6 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-paper-edge/50 text-ink-muted ring-1 ring-paper-edge transition-colors hover:bg-accent-soft/50 hover:text-accent sm:right-10"
          >
            <X size={16} strokeWidth={2.25} />
          </motion.button>

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
                {onFold !== undefined && (
                  <motion.button
                    type="button"
                    onClick={onFold}
                    aria-pressed={folded}
                    aria-label="Love this letter"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    className={`rounded-full p-1.5 transition-colors ${
                      folded ? 'text-accent' : 'text-ink-muted hover:text-accent'
                    }`}
                  >
                    {/*
                      The heart is the verb; the turned-down corner it leaves on
                      the page is the trace. Filled when loved, outline when not
                      — the state has to survive without colour, since text-accent
                      alone would not reach a low-vision reader, and aria-pressed
                      carries it for a screen reader.

                      No animation on the fill: a heart that pops is the chat-app
                      instinct this app keeps declining, and it would need a
                      reduced-motion story the whileTap scale already provides.
                    */}
                    <Heart size={18} fill={folded ? 'currentColor' : 'none'} />
                  </motion.button>
                )}
                <motion.button
                  type="button"
                  onClick={onShare}
                  aria-label="Share this letter"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="rounded-full p-1.5 text-ink-muted transition-colors hover:text-accent"
                >
                  <Share2 size={18} />
                </motion.button>
                {!readOnly && (
                  <motion.button
                    type="button"
                    onClick={onArchive}
                    aria-label={archived ? 'Move back to inbox' : 'Archive this letter'}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    className="rounded-full p-1.5 text-ink-muted transition-colors hover:text-accent"
                  >
                    {archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                  </motion.button>
                )}
                <motion.button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label="Delete this letter"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="rounded-full p-1.5 text-ink-muted transition-colors hover:text-accent"
                >
                  <Trash2 size={18} />
                </motion.button>
              </>
            )}
          </div>
        </PaperTexture>
      </motion.div>
    </motion.div>
  )
}
