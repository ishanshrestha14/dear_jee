import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { useLetters } from '../hooks/useLetters'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

export default function Archive() {
  const { archived, partnerName, loading, setArchived, deleteForMe } = useLetters()
  const { userId, profile } = useAuth()
  const [open, setOpen] = useState<Letter | null>(null)

  const authorOf = (letter: Letter): string =>
    letter.senderId === userId ? (profile?.fullName ?? 'You') : (letter.senderName ?? partnerName)

  const recipientOf = (letter: Letter): string =>
    letter.receiverId === userId ? (profile?.fullName ?? 'you') : (letter.receiverName ?? partnerName)

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (archived.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">Nothing kept here yet</p>
        <Link
          to="/"
          className="mt-6 inline-block font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Back to your letters
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-hand text-3xl text-ink-ui">Kept</h1>
        <Link
          to="/"
          className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Back
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {archived.map((letter) => (
          <LetterCard
            key={letter.id}
            letter={letter}
            authorName={authorOf(letter)}
            unread={letter.receiverId === userId && !letter.isRead}
            onOpen={setOpen}
          />
        ))}
      </div>

      <AnimatePresence>
        {open && (
          <LetterModal
            letter={open}
            authorName={authorOf(open)}
            recipientName={recipientOf(open)}
            archived
            onClose={() => setOpen(null)}
            onArchive={() => {
              void setArchived(open.id, false)
              setOpen(null)
            }}
            onDelete={() => {
              void deleteForMe(open.id)
              setOpen(null)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
