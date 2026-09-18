import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import { fontStack, loadLetterFont } from '../design/letterFonts'
import {
  BODY_FONTS,
  MAX_LETTER_LENGTH,
  MAX_SALUTATION_LENGTH,
  validateLetter,
  validateScheduledFor,
} from '../lib/validation'
import type { BodyFont } from '../lib/validation'

interface ComposeLetterProps {
  partnerName: string
  onSend: (
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ) => Promise<{ ok: boolean; error?: string }>
  onCancel: () => void
  disabled?: boolean
  /** Pre-fills the page for editing an existing pending letter. */
  initialMessage?: string
  initialSalutation?: string
  initialBodyFont?: BodyFont | null
  initialScheduledFor?: string | null
  /** Swaps the button's resting and in-flight copy for the edit case. */
  submitLabel?: string
  sendingLabel?: string
}

/** A blank page. Nothing on screen competes with the writing. */
export function ComposeLetter({
  partnerName,
  onSend,
  onCancel,
  disabled = false,
  initialMessage = '',
  initialSalutation = '',
  initialBodyFont = null,
  initialScheduledFor = null,
  submitLabel = 'Send letter',
  sendingLabel = 'Sending…',
}: ComposeLetterProps) {
  const [message, setMessage] = useState(initialMessage)
  const [salutation, setSalutation] = useState(initialSalutation)
  const [bodyFont, setBodyFont] = useState<BodyFont | null>(initialBodyFont)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  // Pre-checked when editing an already-scheduled letter; off by default for
  // a fresh letter, which is exactly today's "send now" behaviour.
  const [scheduling, setScheduling] = useState(initialScheduledFor !== null)
  const [scheduledFor, setScheduledFor] = useState(initialScheduledFor ?? '')
  const todayIso = new Date().toISOString().slice(0, 10)

  const words = message.trim() === '' ? 0 : message.trim().split(/\s+/).length
  const valid = validateLetter(message).ok
  const dirty = message.trim().length > 0

  async function handleSend() {
    const validation = validateLetter(message)
    if (!validation.ok) {
      setError(validation.reason)
      return
    }
    if (scheduling && scheduledFor === '') {
      setError('Choose a date for this letter to arrive.')
      return
    }
    const chosenDate = scheduling && scheduledFor !== '' ? scheduledFor : null
    const dateCheck = validateScheduledFor(chosenDate)
    if (!dateCheck.ok) {
      setError(dateCheck.reason)
      return
    }
    setSending(true)
    const result = await onSend(
      message,
      salutation.trim() === '' ? null : salutation.trim(),
      bodyFont,
      chosenDate,
    )
    setSending(false)
    if (result.ok) {
      setMessage('')
      setSalutation('')
    } else setError(result.error ?? 'The letter could not be sent.')
  }

  // Nothing written: leave silently. Something written: ask. Losing ten
  // minutes of writing to someone you miss is the worst failure this screen
  // has, and it is worth one extra tap to prevent.
  function handleCancel() {
    if (!dirty) {
      onCancel()
      return
    }
    setConfirmingCancel(true)
  }

  return (
    <div className="mx-auto max-w-[600px]">
      <PaperTexture className="p-8 sm:p-12">
        <p className="font-letter text-lg text-ink-letter">
          Dear{' '}
          <input
            type="text"
            value={salutation}
            onChange={(event) => setSalutation(event.target.value)}
            maxLength={MAX_SALUTATION_LENGTH}
            placeholder={partnerName || 'you'}
            aria-label="How to address them"
            className="border-b border-paper-edge bg-transparent font-letter text-lg text-ink-letter placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
            size={Math.max((salutation || partnerName || 'you').length, 4)}
          />
          ,
        </p>

        <textarea
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            if (error) setError(null)
          }}
          rows={12}
          autoFocus
          disabled={disabled}
          aria-label="Your letter"
          aria-describedby="compose-word-count"
          placeholder="Tell them what you were thinking about this morning…"
          style={{ fontFamily: fontStack(bodyFont) }}
          className="mt-5 w-full resize-none bg-transparent text-[17px] leading-[1.85] text-ink-letter placeholder:text-ink-muted/60 focus:outline-none disabled:opacity-60"
        />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-paper-edge pt-5">
          <span id="compose-word-count" className="font-ui text-xs text-ink-muted">
            {words} {words === 1 ? 'word' : 'words'}
            {message.length > 4500 && ` · ${MAX_LETTER_LENGTH - message.length} characters left`}
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {BODY_FONTS.map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => {
                  setBodyFont(font.id)
                  void loadLetterFont(font.id)
                }}
                aria-pressed={bodyFont === font.id}
                style={{ fontFamily: font.stack }}
                className={`rounded-full px-3 py-3 text-sm transition-colors ${
                  bodyFont === font.id
                    ? 'bg-accent-soft text-ink-ui'
                    : 'text-ink-muted hover:text-accent'
                }`}
              >
                {font.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-paper-edge pt-4">
          <label className="flex items-center gap-2 font-ui text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={scheduling}
              onChange={(event) => {
                setScheduling(event.target.checked)
                if (!event.target.checked) setScheduledFor('')
              }}
            />
            Schedule for later
          </label>
          {scheduling && (
            <input
              type="date"
              value={scheduledFor}
              min={todayIso}
              onChange={(event) => setScheduledFor(event.target.value)}
              aria-label="Deliver on"
              className="rounded-full border border-paper-edge bg-transparent px-3 py-1.5 font-ui text-xs text-ink-ui focus:border-accent focus:outline-none"
            />
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-4">
          {confirmingCancel ? (
            <>
              <span className="font-ui text-xs text-ink-muted">Discard this letter?</span>
              <button
                type="button"
                onClick={onCancel}
                className="font-ui text-xs text-accent underline underline-offset-4"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                className="font-ui text-xs text-ink-muted underline underline-offset-4"
              >
                Keep writing
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCancel}
                className="font-ui text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-accent"
              >
                Cancel
              </button>

              <motion.button
                type="button"
                onClick={handleSend}
                disabled={!valid || sending || disabled}
                whileHover={valid && !sending && !disabled ? { boxShadow: 'var(--shadow-letter-lifted)' } : undefined}
                whileTap={valid && !sending && !disabled ? { scale: 0.97 } : undefined}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={15} />
                {sending ? sendingLabel : submitLabel}
              </motion.button>
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 font-ui text-sm text-accent">
            {error}
          </p>
        )}
      </PaperTexture>
    </div>
  )
}
