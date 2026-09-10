import { useEffect } from 'react'
import { motion } from 'framer-motion'

interface ToastProps {
  message: string
  onDone: () => void
}

/** Bottom-centre, warm, and gone in three seconds. The app's one notification. */
export function Toast({ message, onDone }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 3000)
    return () => window.clearTimeout(timer)
  }, [onDone])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-8 z-[60] flex justify-center px-4"
    >
      <p className="rounded-full bg-paper-letter px-5 py-2.5 font-ui text-sm text-ink-ui shadow-letter-lifted">
        {message}
      </p>
    </motion.div>
  )
}
