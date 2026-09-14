import { useCallback, useEffect, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  held: Letter[]
  hasBond: boolean
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(message: string): Promise<{ ok: boolean; error?: string }>
  sendHeld(id: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  deleteForMe(id: string): Promise<void>
  setShared(id: string, shared: boolean): Promise<{ ok: boolean; error?: string }>
  reload(): Promise<void>
}

/**
 * The correspondence. Identity and partner resolution belong to AuthProvider;
 * this hook owns letters and reloads whenever the signed-in user changes.
 */
export function useLetters(): UseLetters {
  const { userId, profile, partnerName, loading: authLoading } = useAuth()
  const partnerId = profile?.partnerId ?? null

  const [letters, setLetters] = useState<Letter[]>([])
  const [archived, setArchived_] = useState<Letter[]>([])
  const [held, setHeld] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    const [conversation, archive, heldLetters] = await Promise.all([
      letterRepository.listConversation(id),
      letterRepository.listArchived(id),
      letterRepository.listHeld(id),
    ])
    // All three failures must surface. Swallowing one would leave the
    // previous list on screen looking correct, and setArchived/deleteForMe
    // both call load(), so the staleness would recur after every action — a
    // wrong list the reader trusts is worse than a missing one they do not.
    if (conversation.error !== null) setError(conversation.error)
    else setLetters(conversation.data)

    if (archive.error !== null) setError(archive.error)
    else setArchived_(archive.data)

    if (heldLetters.error !== null) setError(heldLetters.error)
    else setHeld(heldLetters.data)

    if (conversation.error === null && archive.error === null && heldLetters.error === null) {
      setError(null)
    }
  }, [])

  useEffect(() => {
    if (userId === null) {
      setLetters([])
      setArchived_([])
      setHeld([])
      setLoading(authLoading)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      await load(userId)
      if (cancelled) return
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading, load])

  const reload = useCallback(async () => {
    if (userId !== null) await load(userId)
  }, [userId, load])

  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      // An unbonded author writes a HELD letter — receiverId null — rather
      // than being refused. The repository and the insert policy both enforce
      // that this is only allowed with no bond, so there is no check here.
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
        // The composer does not yet offer these — a later task wires the
        // picker through. Null is the documented default for both.
        salutation: null,
        bodyFont: null,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, partnerId, load],
  )

  const sendHeldFn = useCallback<UseLetters['sendHeld']>(
    async (id) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      const result = await letterRepository.sendHeld(id, userId)
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, load],
  )

  const markRead = useCallback<UseLetters['markRead']>(async (id) => {
    // Optimistic: the dot disappears the instant the letter opens.
    setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: true } : l)))
    const result = await letterRepository.markRead(id)
    if (result.error !== null) {
      setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: false } : l)))
    }
  }, [])

  const setArchivedFn = useCallback<UseLetters['setArchived']>(
    async (id, next) => {
      if (userId === null) return
      const result = await letterRepository.setArchived(id, userId, next)
      // The error is set AFTER the reload, not before: load() clears the error
      // whenever both fetches succeed, which would otherwise wipe this one
      // within a render of it being set.
      await load(userId)
      if (result.error !== null) setError(result.error)
    },
    [userId, load],
  )

  const deleteForMe = useCallback<UseLetters['deleteForMe']>(
    async (id) => {
      if (userId === null) return
      const result = await letterRepository.deleteForMe(id, userId)
      // The error is set AFTER the reload, not before: load() clears the error
      // whenever both fetches succeed, which would otherwise wipe this one
      // within a render of it being set.
      await load(userId)
      if (result.error !== null) setError(result.error)
    },
    [userId, load],
  )

  const setSharedFn = useCallback<UseLetters['setShared']>(
    async (id, shared) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      const result = await letterRepository.setShared(id, shared)
      await load(userId)
      if (result.error !== null) {
        // Deliberately NOT setError: the routes early-return on page-level
        // error, which would replace the letter and the whole grid with one
        // line of text and leave no UI able to clear it. Share failures belong
        // in the toast, per the spec's one-notification-system rule.
        return { ok: false, error: result.error }
      }
      return { ok: true }
    },
    [userId, load],
  )

  return {
    letters,
    archived,
    held,
    hasBond: partnerId !== null,
    partnerName,
    loading: loading || authLoading,
    error,
    sendLetter,
    sendHeld: sendHeldFn,
    markRead,
    setArchived: setArchivedFn,
    deleteForMe,
    setShared: setSharedFn,
    reload,
  }
}
