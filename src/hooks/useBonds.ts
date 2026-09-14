import { useCallback, useEffect, useState } from 'react'
import { bondRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import type { Bond } from '../data/types'

interface UseBonds {
  /** The open bond, or null when unbonded. */
  current: Bond | null
  /** Ended bonds, newest first. */
  past: Bond[]
  loading: boolean
  error: string | null
  unlink(): Promise<{ ok: boolean; error?: string }>
  acknowledgeEnd(bondId: string): Promise<void>
  reload(): Promise<void>
}

/**
 * Chapters. Kept out of useLetters because a bond's lifecycle is not a
 * letter's: Settings needs unlink without touching letters, and Chapters
 * needs the list without loading a conversation.
 */
export function useBonds(): UseBonds {
  const { userId, loading: authLoading, refreshProfile } = useAuth()
  const [bonds, setBonds] = useState<Bond[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    const result = await bondRepository.list(id)
    if (result.error !== null) setError(result.error)
    else {
      setBonds(result.data)
      setError(null)
    }
  }, [])

  useEffect(() => {
    if (userId === null) {
      setBonds([])
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

  const unlink = useCallback<UseBonds['unlink']>(async () => {
    if (userId === null) return { ok: false, error: 'You are not signed in.' }
    const result = await bondRepository.unlink(userId)
    if (result.error !== null) return { ok: false, error: result.error }
    // The profile's partnerId drives the whole signed-in UI, so it must be
    // refreshed before anything re-reads it.
    await refreshProfile()
    await load(userId)
    return { ok: true }
  }, [userId, load, refreshProfile])

  const acknowledgeEnd = useCallback<UseBonds['acknowledgeEnd']>(
    async (bondId) => {
      if (userId === null) return
      await bondRepository.acknowledgeEnd(userId, bondId)
      await load(userId)
    },
    [userId, load],
  )

  const reload = useCallback(async () => {
    if (userId !== null) await load(userId)
  }, [userId, load])

  return {
    current: bonds.find((b) => b.endedAt === null) ?? null,
    past: bonds.filter((b) => b.endedAt !== null),
    loading: loading || authLoading,
    error,
    unlink,
    acknowledgeEnd,
    reload,
  }
}
