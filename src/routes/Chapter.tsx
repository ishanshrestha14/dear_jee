import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link, useParams } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { useAuth } from '../auth/useAuth'
import { useBonds } from '../hooks/useBonds'
import { letterRepository } from '../data'
import type { Letter } from '../data/types'

export default function Chapter() {
  const { bondId } = useParams<{ bondId: string }>()
  const { userId, profile } = useAuth()
  const { past } = useBonds()
  const [letters, setLetters] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Letter | null>(null)

  const bond = past.find((b) => b.id === bondId) ?? null

  useEffect(() => {
    if (userId === null || bondId === undefined) return
    let cancelled = false
    void (async () => {
      const result = await letterRepository.listChapter(userId, bondId)
      if (cancelled) return
      if (result.error !== null) setError(result.error)
      else setLetters(result.data)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [userId, bondId])

  const closeLetter = useCallback(() => setOpen(null), [])

  // The frozen name on the letter answers first: after unbonding, nothing can
  // resolve the other person's profile, so a live lookup would render blank.
  const authorOf = (letter: Letter): string =>
    letter.senderId === userId
      ? (profile?.fullName ?? 'You')
      : (letter.senderName ?? bond?.partnerName ?? 'Someone')

  const recipientOf = (letter: Letter): string =>
    letter.receiverId === userId
      ? (profile?.fullName ?? 'you')
      : (letter.receiverName ?? bond?.partnerName ?? 'them')

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (error !== null) {
    return <p className="py-20 text-center font-ui text-sm text-accent">{error}</p>
  }

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-hand text-3xl text-ink-ui">
          {bond?.partnerName || 'Someone'}
        </h1>
        <Link
          to="/chapters"
          className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          All chapters
        </Link>
      </div>

      {letters.length === 0 ? (
        <p className="py-20 text-center font-ui text-sm text-ink-muted">
          Nothing left in this chapter.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {letters.map((letter) => (
            <LetterCard
              key={letter.id}
              letter={letter}
              authorName={authorOf(letter)}
              unread={false}
              onOpen={setOpen}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <LetterModal
            key="letter"
            letter={open}
            authorName={authorOf(open)}
            recipientName={recipientOf(open)}
            archived
            readOnly
            trapActive
            onClose={closeLetter}
            onArchive={() => {}}
            onDelete={() => {}}
            onShare={() => {}}
          />
        )}
      </AnimatePresence>
    </>
  )
}
