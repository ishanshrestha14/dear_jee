import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Link as LinkIcon, X } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import type { Letter } from '../data/types'

interface ShareModalProps {
  letter: Letter
  onClose: () => void
  onSetShared: (shared: boolean) => void
  onCopied: () => void
}

/**
 * The access panel, modelled on Drive's "General access" section — the only
 * part of that dialog that means anything in a two-person app. There are no
 * roles to grant and nobody to invite; there is only "can a stranger with the
 * link read this".
 */
export function ShareModal({ letter, onClose, onSetShared, onCopied }: ShareModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const url = letter.shareSlug === null ? '' : `${window.location.origin}/letter/${letter.shareSlug}`

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus()
    }
  }, [onClose])

  async function copy() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Dear Jee', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      onCopied()
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // The share sheet was dismissed, or the clipboard was refused. The URL
      // is on screen to copy by hand; nothing to recover from.
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[55] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share this letter"
    >
      <div className="fixed inset-0 bg-ink-ui/30 backdrop-blur-[2px]" aria-hidden />

      <motion.div
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        initial={{ scale: 0.96 }}
        animate={{ scale: 1 }}
        className="relative w-full max-w-[420px] focus:outline-none"
      >
        <PaperTexture className="p-7">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sharing"
            className="absolute right-4 top-4 rounded-full p-2 text-ink-muted transition-colors hover:text-accent"
          >
            <X size={16} />
          </button>

          <h2 className="font-hand text-3xl text-ink-ui">Share this letter</h2>
          <p className="mt-2 font-ui text-sm text-ink-muted">
            {letter.isPublic
              ? 'Anyone with the link can read this.'
              : 'Only the two of you can read this.'}
          </p>

          <label htmlFor="access" className="mt-6 block font-ui text-xs text-ink-muted">
            Who can read it
          </label>
          <select
            id="access"
            value={letter.isPublic ? 'public' : 'private'}
            onChange={(event) => onSetShared(event.target.value === 'public')}
            className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
          >
            <option value="private">Only you two</option>
            <option value="public">Anyone with the link</option>
          </select>

          {letter.isPublic && letter.shareSlug !== null && (
            <>
              <p className="mt-5 break-all rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-xs text-ink-muted">
                {url}
              </p>
              <button
                type="button"
                onClick={() => void copy()}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
              >
                {copied ? <Check size={15} /> : <LinkIcon size={15} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </>
          )}
        </PaperTexture>
      </motion.div>
    </motion.div>
  )
}
