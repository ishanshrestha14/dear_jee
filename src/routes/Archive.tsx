import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { ShareModal } from '../components/ShareModal'
import { Toast } from '../components/Toast'
import { useLetters } from '../hooks/useLetters'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

export default function Archive() {
  const { archived, partnerName, loading, error, setArchived, deleteForMe, setShared } = useLetters()
  const { userId, profile } = useAuth()
  const [open, setOpen] = useState<Letter | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Derived, not a snapshot. Toggling sharing reloads the list, and the modal
  // must re-render with the new isPublic and the newly minted slug — a
  // captured Letter object would still say "Only you two" and show no link,
  // seconds after the user turned sharing on.
  const sharing = sharingId === null ? null : (archived.find((l) => l.id === sharingId) ?? null)

  const authorOf = (letter: Letter): string =>
    letter.senderId === userId ? (profile?.fullName ?? 'You') : (letter.senderName ?? partnerName)

  const recipientOf = (letter: Letter): string =>
    letter.receiverId === userId ? (profile?.fullName ?? 'you') : (letter.receiverName ?? partnerName)

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (error !== null) {
    return <p className="py-20 text-center font-ui text-sm text-accent">{error}</p>
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
            trapActive={sharingId === null}
            onClose={() => setOpen(null)}
            onArchive={() => {
              void setArchived(open.id, false)
              setOpen(null)
            }}
            onDelete={() => {
              void deleteForMe(open.id)
              setOpen(null)
            }}
            onShare={() => setSharingId(open.id)}
          />
        )}
        {sharing && (
          <ShareModal
            letter={sharing}
            onClose={() => setSharingId(null)}
            onSetShared={(next) => {
              // Deliberately does NOT close the modal. Turning sharing on and
              // immediately dismissing the panel would hide the link at the
              // exact moment the user wanted it.
              void setShared(sharing.id, next)
            }}
            onCopied={() => setToast('Link copied! Send it to them on WhatsApp 💌')}
          />
        )}
        {toast !== null && <Toast message={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </>
  )
}
