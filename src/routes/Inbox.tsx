import { useCallback, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { ShareModal } from '../components/ShareModal'
import { Toast } from '../components/Toast'
import { useLetters } from '../hooks/useLetters'
import { useBonds } from '../hooks/useBonds'
import { useAuth } from '../auth/useAuth'
import { InviteLink } from '../components/InviteLink'
import { formatLetterDate, snippet } from '../lib/format'
import type { Letter } from '../data/types'

export default function Inbox() {
  const {
    letters,
    archived,
    held,
    hasBond,
    partnerName,
    loading,
    error,
    markRead,
    setArchived,
    deleteForMe,
    setShared,
    sendHeld,
  } = useLetters()
  const { userId, profile } = useAuth()
  const { past, acknowledgeEnd } = useBonds()
  // Only a bond whose ending this person has not yet seen. seenEndAt is
  // resolved per caller by the repository, so this never fires for the other
  // side's acknowledgement.
  const unseenEnd = past.find((b) => b.seenEndAt === null) ?? null
  const [open, setOpen] = useState<Letter | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Derived, not a snapshot. Toggling sharing reloads the list, and the modal
  // must re-render with the new isPublic and the newly minted slug — a
  // captured Letter object would still say "Only you two" and show no link,
  // seconds after the user turned sharing on.
  const sharing = sharingId === null ? null : (letters.find((l) => l.id === sharingId) ?? null)

  const closeLetter = useCallback(() => setOpen(null), [])
  const closeShare = useCallback(() => setSharingId(null), [])
  const openShare = useCallback(() => {
    setOpen((current) => {
      if (current !== null) setSharingId(current.id)
      return current
    })
  }, [])

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

  const endedBondNotice = unseenEnd !== null && (
    <div className="mb-6 rounded-letter border border-paper-edge bg-paper-letter px-5 py-4 text-left">
      <p className="font-letter text-ink-letter">
        Your bond with {unseenEnd.partnerName || 'them'} ended. Your letters are in{' '}
        <Link to="/chapters" className="underline underline-offset-4 hover:text-accent">
          Past chapters
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={() => void acknowledgeEnd(unseenEnd.id)}
        className="mt-3 font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
      >
        Thanks, I know
      </button>
    </div>
  )

  // Held letters live outside any chapter, so this list belongs above the
  // letters.length === 0 branch and renders for bonded and unbonded users
  // alike: a bonded person with leftover held letters must still be able to
  // reach and send them, not just someone who has never bonded.
  const unsent = held.length > 0 && (
    <div className="mx-auto mt-12 max-w-sm text-left">
      <h2 className="font-ui text-xs tracking-wide text-ink-muted">Unsent · {held.length}</h2>
      <ul className="mt-3 space-y-3">
        {held.map((letter) => (
          <li
            key={letter.id}
            className="rounded-letter border border-paper-edge bg-paper-letter px-4 py-3"
          >
            <p className="font-letter text-[15px] leading-relaxed text-ink-letter">
              {snippet(letter.message, 100)}
            </p>
            <p className="mt-2 font-ui text-xs tracking-wide text-ink-muted">
              Written {formatLetterDate(letter.createdAt)}
            </p>
            {hasBond && (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const result = await sendHeld(letter.id)
                    if (!result.ok) setToast(result.error ?? 'That did not work.')
                  })()
                }}
                className="mt-3 font-ui text-xs text-accent underline underline-offset-4"
              >
                Send to {partnerName || 'them'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )

  if (letters.length === 0) {
    const unlinked = profile !== null && profile.partnerId === null

    return (
      <div className="py-24 text-center">
        {endedBondNotice}

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

        {unsent}

        <AnimatePresence>
          {toast !== null && <Toast key="toast" message={toast} onDone={() => setToast(null)} />}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <>
      {endedBondNotice}

      {(archived.length > 0 || past.length > 0) && (
        <div className="mb-6 text-right">
          {archived.length > 0 && (
            <Link
              to="/archive"
              className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
            >
              Archive
            </Link>
          )}
          {past.length > 0 && (
            <Link
              to="/chapters"
              className="ml-4 font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
            >
              Past chapters
            </Link>
          )}
        </div>
      )}

      {unsent}

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
            key="letter"
            letter={open}
            authorName={authorOf(open)}
            recipientName={recipientOf(open)}
            archived={false}
            trapActive={sharingId === null}
            onClose={closeLetter}
            onArchive={() => {
              void setArchived(open.id, true)
              setOpen(null)
            }}
            onDelete={() => {
              void deleteForMe(open.id)
              setOpen(null)
            }}
            onShare={openShare}
          />
        )}
        {sharing && (
          <ShareModal
            key="share"
            letter={sharing}
            onClose={closeShare}
            onSetShared={(next) => {
              // Deliberately does NOT close the modal. Turning sharing on and
              // immediately dismissing the panel would hide the link at the
              // exact moment the user wanted it.
              void (async () => {
                const result = await setShared(sharing.id, next)
                if (!result.ok) setToast(result.error ?? 'That did not work.')
              })()
            }}
            onCopied={() => setToast('Link copied! Send it to them on WhatsApp 💌')}
          />
        )}
        {toast !== null && <Toast key="toast" message={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </>
  )
}
