import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { ShareModal } from '../components/ShareModal'
import { Toast } from '../components/Toast'
import { useLetters } from '../hooks/useLetters'
import { useAuth } from '../auth/useAuth'
import { InviteLink } from '../components/InviteLink'
import type { Letter } from '../data/types'

export default function Inbox() {
  const { letters, archived, partnerName, loading, error, markRead, setArchived, deleteForMe, setShared } =
    useLetters()
  const { userId, profile } = useAuth()
  const [open, setOpen] = useState<Letter | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Derived, not a snapshot. Toggling sharing reloads the list, and the modal
  // must re-render with the new isPublic and the newly minted slug — a
  // captured Letter object would still say "Only you two" and show no link,
  // seconds after the user turned sharing on.
  const sharing = sharingId === null ? null : (letters.find((l) => l.id === sharingId) ?? null)

  const authorOf = (letter: Letter): string => {
    if (letter.senderId === userId) return profile?.fullName ?? 'You'
    return letter.senderName ?? partnerName ?? ''
  }

  const recipientOf = (letter: Letter): string => {
    if (letter.receiverId === userId) return profile?.fullName ?? 'you'
    return letter.receiverName ?? partnerName ?? ''
  }

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

        {archived.length > 0 && (
          <p className="mt-8 font-ui text-sm text-ink-muted">
            Your letters with them are in the{' '}
            <Link to="/archive" className="underline underline-offset-4 hover:text-accent">
              archive
            </Link>
            .
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      {archived.length > 0 && (
        <div className="mb-6 text-right">
          <Link
            to="/archive"
            className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
          >
            Archive
          </Link>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {letters.map((letter) => (
          <LetterCard
            key={letter.id}
            letter={letter}
            authorName={authorOf(letter)}
            unread={letter.receiverId === userId && !letter.isRead}
            onOpen={handleOpen}
          />
        ))}
      </div>
      <AnimatePresence>
        {open && (
          <LetterModal
            letter={open}
            authorName={authorOf(open)}
            recipientName={recipientOf(open)}
            archived={false}
            trapActive={sharingId === null}
            onClose={() => setOpen(null)}
            onArchive={() => {
              void setArchived(open.id, true)
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
