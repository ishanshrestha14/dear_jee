import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { useLetters } from '../hooks/useLetters'
import type { Letter } from '../data/types'

export default function Inbox() {
  const { letters, partnerName, loading, error, markRead } = useLetters()
  const [open, setOpen] = useState<Letter | null>(null)
  // `open` is read by LetterModal, mounted here in Task 9.
  void open

  function handleOpen(letter: Letter) {
    setOpen(letter)
    if (!letter.isRead) void markRead(letter.id)
  }

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">Opening the post…</p>
  }

  if (error) {
    return <p className="py-20 text-center font-ui text-sm text-accent">{error}</p>
  }

  if (letters.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">No letters yet</p>
        <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
          When {partnerName || 'they'} write to you, it will arrive here.
        </p>
        <Link
          to="/compose"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
        >
          Write the first one
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        {letters.map((letter) => (
          <LetterCard
            key={letter.id}
            letter={letter}
            senderName={partnerName}
            onOpen={handleOpen}
          />
        ))}
      </div>
      {/* LetterModal is mounted here in Task 9. */}
      <AnimatePresence>{null}</AnimatePresence>
    </>
  )
}
