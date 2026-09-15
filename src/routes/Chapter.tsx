import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Link, useParams } from 'react-router-dom'
import { LetterCard } from '../components/LetterCard'
import { LetterModal } from '../components/LetterModal'
import { ShareModal } from '../components/ShareModal'
import { Toast } from '../components/Toast'
import { useAuth } from '../auth/useAuth'
import { useBonds } from '../hooks/useBonds'
import { letterRepository } from '../data'
import type { Letter } from '../data/types'

export default function Chapter() {
  const { bondId } = useParams<{ bondId: string }>()
  const { userId, profile } = useAuth()
  const { past, reload: reloadBonds } = useBonds()
  const [letters, setLetters] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const bond = past.find((b) => b.id === bondId) ?? null

  // Derived, not captured — the same reason `sharing` is derived. Polling
  // replaces this list while a letter is open, and a captured Letter object
  // would leave the modal rendering a snapshot that no longer matches the
  // store.
  const open = openId === null ? null : (letters.find((l) => l.id === openId) ?? null)

  // Derived, not a snapshot: toggling sharing reloads the list below, and a
  // captured Letter would still say "Only you two" and show no link, seconds
  // after the user turned sharing on. Mirrors Archive.tsx.
  const sharing = sharingId === null ? null : (letters.find((l) => l.id === sharingId) ?? null)

  const load = useCallback(async () => {
    if (userId === null || bondId === undefined) return
    const result = await letterRepository.listChapter(userId, bondId)
    if (result.error !== null) setError(result.error)
    else {
      setLetters(result.data)
      setError(null)
    }
  }, [userId, bondId])

  useEffect(() => {
    if (userId === null || bondId === undefined) return
    let cancelled = false
    void (async () => {
      await load()
      if (cancelled) return
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [userId, bondId, load])

  const closeLetter = useCallback(() => setOpenId(null), [])
  const closeShare = useCallback(() => setSharingId(null), [])
  const openShare = useCallback(() => {
    if (open !== null) setSharingId(open.id)
  }, [open])

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
              onOpen={(letter) => setOpenId(letter.id)}
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
            // ShareModal registers its own Escape handler; while it is open the
            // letter modal must ignore Escape too, or one keypress closes both.
            // Mirrors Archive.tsx exactly.
            trapActive={sharingId === null}
            onClose={closeLetter}
            // readOnly hides the Archive control, so nothing can ever call
            // this. Kept as a no-op — not omitted — so the prop stays
            // required and the intent (unreachable, not forgotten) is clear.
            onArchive={() => {}}
            onDelete={() => {
              const letterId = open.id
              setOpenId(null)
              void (async () => {
                if (userId === null) return
                const result = await letterRepository.deleteForMe(letterId, userId)
                await load()
                // letterCount on /chapters is derived from this same delete,
                // so the bond list needs refreshing too or it goes stale.
                await reloadBonds()
                if (result.error !== null) setError(result.error)
              })()
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
                if (userId === null) return
                const result = await letterRepository.setShared(sharing.id, next)
                await load()
                if (result.error !== null) {
                  // Deliberately NOT setError: the routes above early-return on
                  // page-level error, which would replace the letter and the
                  // whole grid with one line of text and leave no UI able to
                  // clear it. Share failures belong in the toast.
                  setToast(result.error)
                }
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
