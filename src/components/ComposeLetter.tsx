import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { PaperTexture } from '../design/PaperTexture'
import { MAX_LETTER_LENGTH, validateLetter } from '../lib/validation'

interface ComposeLetterProps {
  partnerName: string
  onSend: (message: string) => Promise<{ ok: boolean; error?: string }>
}

/** A blank page. Nothing on screen competes with the writing. */
export function ComposeLetter({ partnerName, onSend }: ComposeLetterProps) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const words = message.trim() === '' ? 0 : message.trim().split(/\s+/).length
  const valid = validateLetter(message).ok

  async function handleSend() {
    const validation = validateLetter(message)
    if (!validation.ok) {
      setError(validation.reason)
      return
    }
    setSending(true)
    const result = await onSend(message)
    setSending(false)
    if (result.ok) setMessage('')
    else setError(result.error ?? 'The letter could not be sent.')
  }

  return (
    <div className="mx-auto max-w-[600px]">
      <PaperTexture className="p-8 sm:p-12">
        <p className="font-letter text-lg text-ink-letter">Dear {partnerName || 'you'},</p>

        <textarea
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            if (error) setError(null)
          }}
          rows={12}
          maxLength={MAX_LETTER_LENGTH}
          autoFocus
          placeholder="Tell them what you were thinking about this morning…"
          className="mt-5 w-full resize-none bg-transparent font-letter text-[17px] leading-[1.85] text-ink-letter placeholder:text-ink-muted/60 focus:outline-none"
        />

        <div className="mt-6 flex items-center justify-between border-t border-paper-edge pt-5">
          <span className="font-ui text-xs text-ink-muted">
            {words} {words === 1 ? 'word' : 'words'}
          </span>

          <motion.button
            type="button"
            onClick={handleSend}
            disabled={!valid || sending}
            whileHover={valid && !sending ? { boxShadow: 'var(--shadow-letter-lifted)' } : undefined}
            whileTap={valid && !sending ? { scale: 0.97 } : undefined}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={15} />
            {sending ? 'Sending…' : 'Send letter'}
          </motion.button>
        </div>

        {error && <p className="mt-4 font-ui text-sm text-accent">{error}</p>}
      </PaperTexture>
    </div>
  )
}
