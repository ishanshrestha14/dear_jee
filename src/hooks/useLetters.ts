import { useCallback, useEffect, useState } from 'react'
import { currentUserId, letterRepository, profileRepository } from '../data'
import type { Letter } from '../data/types'

interface UseLetters {
  letters: Letter[]
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(message: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
}

/** Loads the inbox once on mount and keeps it in sync with local actions. */
export function useLetters(): UseLetters {
  const [letters, setLetters] = useState<Letter[]>([])
  const [partnerName, setPartnerName] = useState('')
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const inbox = await letterRepository.listReceived(currentUserId)
      const me = await profileRepository.getById(currentUserId)
      if (cancelled) return

      if (inbox.error !== null) setError(inbox.error)
      else setLetters(inbox.data)

      if (me.data?.partnerId) {
        setPartnerId(me.data.partnerId)
        const partner = await profileRepository.getById(me.data.partnerId)
        if (!cancelled && partner.data) setPartnerName(partner.data.fullName)
      }
      if (!cancelled) setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message) => {
      if (!partnerId) return { ok: false, error: 'You are not connected to anyone yet.' }
      const result = await letterRepository.send({
        senderId: currentUserId,
        receiverId: partnerId,
        message,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      return { ok: true }
    },
    [partnerId],
  )

  const markRead = useCallback<UseLetters['markRead']>(async (id) => {
    // Optimistic: the dot disappears the instant the letter opens.
    setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: true } : l)))
    await letterRepository.markRead(id)
  }, [])

  return { letters, partnerName, loading, error, sendLetter, markRead }
}
