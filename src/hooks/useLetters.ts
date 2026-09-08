import { useCallback, useEffect, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

interface UseLetters {
  letters: Letter[]
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(message: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
}

/**
 * The inbox. Identity and partner resolution belong to AuthProvider; this
 * hook only owns letters, and reloads whenever the signed-in user changes.
 */
export function useLetters(): UseLetters {
  const { userId, profile, partnerName, loading: authLoading } = useAuth()
  const partnerId = profile?.partnerId ?? null

  const [letters, setLetters] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (userId === null) {
      setLetters([])
      setLoading(authLoading)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      const inbox = await letterRepository.listReceived(userId)
      if (cancelled) return
      if (inbox.error !== null) setError(inbox.error)
      else {
        setLetters(inbox.data)
        setError(null)
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

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
      return { ok: true }
    },
    [userId, partnerId],
  )

  const markRead = useCallback<UseLetters['markRead']>(async (id) => {
    // Optimistic: the dot disappears the instant the letter opens.
    setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: true } : l)))
    const result = await letterRepository.markRead(id)
    if (result.error !== null) {
      // Roll back: the server never confirmed the read, so the dot returns.
      setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: false } : l)))
    }
  }, [])

  return {
    letters,
    partnerName,
    loading: loading || authLoading,
    error,
    sendLetter,
    markRead,
  }
}
