import { useEffect } from 'react'
import { motion } from 'framer-motion'

interface ToastProps {
  message: string
  onDone: () => void
  /** Present makes the toast clickable — e.g. "scroll to the new letter." */
  onClick?: () => void
  /** Defaults to 3000, matching every toast before this one. */
  durationMs?: number
}

/** Bottom-centre, warm, and gone on its own timer. The app's one notification. */
export function Toast({ message, onDone, onClick, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, durationMs)
    return () => window.clearTimeout(timer)
  }, [onDone, durationMs])

  const chrome = 'rounded-full bg-paper-letter px-5 py-2.5 font-ui text-sm text-ink-ui shadow-letter-lifted'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-8 z-[60] flex justify-center px-4"
    >
      {onClick ? (
        <button type="button" onClick={onClick} className={`${chrome} cursor-pointer`}>
          {message}
        </button>
      ) : (
        <p className={chrome}>{message}</p>
      )}
    </motion.div>
  )
}
