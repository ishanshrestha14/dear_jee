import { useCallback, useEffect, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(message: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  deleteForMe(id: string): Promise<void>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    const [conversation, archive] = await Promise.all([
      letterRepository.listConversation(id),
      letterRepository.listArchived(id),
    ])
    // Both failures must surface. Swallowing the archive's would leave the
    // previous list on screen looking correct, and setArchived/deleteForMe
    // both call load(), so the staleness would recur after every action — a
    // wrong list the reader trusts is worse than a missing one they do not.
    if (conversation.error !== null) setError(conversation.error)
    else setLetters(conversation.data)

    if (archive.error !== null) setError(archive.error)
    else setArchived_(archive.data)

    if (conversation.error === null && archive.error === null) setError(null)
  }, [])

  useEffect(() => {
    if (userId === null) {
      setLetters([])
      setArchived_([])
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
      if (partnerId === null) return { ok: false, error: 'You are not connected to anyone yet.' }
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, partnerId, load],
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

  return {
    letters,
    archived,
    partnerName,
    loading: loading || authLoading,
    error,
    sendLetter,
    markRead,
    setArchived: setArchivedFn,
    deleteForMe,
    reload,
  }
}
