import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { useLetters } from '../hooks/useLetters'
import { useAuth } from '../auth/useAuth'
import { InviteLink } from '../components/InviteLink'
import type { Letter } from '../data/types'

export default function Inbox() {
  const { letters, partnerName, loading, error, markRead } = useLetters()
  const { profile } = useAuth()
  const [open, setOpen] = useState<Letter | null>(null)

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
    const unlinked = profile !== null && profile.partnerId === null

    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">
          {unlinked ? 'Just you so far' : 'No letters yet'}
        </p>
        <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
          {unlinked
            ? 'Send them this link. Once they open it, you can write to each other.'
            : `When ${partnerName || 'they'} write to you, it will arrive here.`}
        </p>

        {unlinked && profile !== null ? (
          <InviteLink inviteCode={profile.inviteCode} />
        ) : (
          <Link
            to="/compose"
            className="mt-8 inline-block rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
          >
            Write the first one
          </Link>
        )}
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
      <AnimatePresence>
        {open && (
          <LetterModal
            letter={open}
            senderName={partnerName}
            receiverName="you"
            onClose={() => setOpen(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
