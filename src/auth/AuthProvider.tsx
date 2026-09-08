import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '../data/supabaseClient'
import { profileRepository } from '../data'
import { MOCK_USER_ID } from '../data/mockRepository'
import type { Profile } from '../data/types'
import { AuthContext, type AuthState } from './useAuth'

/**
 * Owns the session and the profile, including the partner's name.
 *
 * Partner resolution lives here rather than in useLetters so that Inbox and
 * Compose share one load instead of each mounting their own and racing.
 *
 * With no Supabase configuration the provider signs in as the mock user
 * immediately, so the app remains fully usable on mock data.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [partnerName, setPartnerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // loadProfile is fired from three uncoordinated callers (boot getSession,
  // every onAuthStateChange event including TOKEN_REFRESHED, and
  // refreshProfile). Without sequencing, a stale response can land after a
  // newer one and overwrite it. Each call captures the sequence number at
  // start and every state update checks it is still current before applying.
  const loadSeq = useRef(0)

  /** Loads the profile and, when linked, the partner's display name. */
  const loadProfile = useCallback(async (id: string) => {
    const seq = ++loadSeq.current
    const me = await profileRepository.getById(id)
    if (seq !== loadSeq.current) return
    if (me.error !== null) {
      setError(me.error)
      setProfile(null)
      return
    }
    setProfile(me.data)
    setError(null)

    if (me.data.partnerId === null) {
      setPartnerName('')
      return
    }
    const partner = await profileRepository.getById(me.data.partnerId)
    if (seq !== loadSeq.current) return
    setPartnerName(partner.error !== null ? '' : partner.data.fullName)
  }, [])

  useEffect(() => {
    let cancelled = false

    // Mock mode: no session to fetch, sign straight in as the seeded user.
    if (!isSupabaseConfigured() || supabase === null) {
      void (async () => {
        await loadProfile(MOCK_USER_ID)
        if (cancelled) return
        setUserId(MOCK_USER_ID)
        setLoading(false)
      })()
      return () => {
        cancelled = true
      }
    }

    const db = supabase

    void (async () => {
      try {
        const { data } = await db.auth.getSession()
        if (cancelled) return
        const id = data.session?.user.id ?? null
        if (id !== null) await loadProfile(id)
        if (cancelled) return
        setUserId(id)
        setLoading(false)
      } catch {
        // Storage refused (e.g. Safari private mode): without this, loading
        // never clears and the app hangs on the loading line forever.
        if (cancelled) return
        setError('Could not restore your session.')
        setLoading(false)
      }
    })()

    // Keeps every tab in step, and handles token refresh and sign-out.
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null
      setUserId(id)
      if (id === null) {
        setProfile(null)
        setPartnerName('')
        setError(null)
      } else {
        void loadProfile(id)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signUp = useCallback<AuthState['signUp']>(async (email, password) => {
    if (supabase === null) return { ok: false, error: 'Supabase is not configured.' }
    const { data, error: err } = await supabase.auth.signUp({ email, password })
    if (err) return { ok: false, error: err.message }
    // Email confirmation is off, so a session is expected here. If one is
    // missing, confirmation is still enabled in the dashboard.
    if (data.session === null) {
      return { ok: false, error: 'Check your email to confirm your account, then sign in.' }
    }
    return { ok: true }
  }, [])

  const signIn = useCallback<AuthState['signIn']>(async (email, password) => {
    if (supabase === null) return { ok: false, error: 'Supabase is not configured.' }
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) return { ok: false, error: err.message }
    return { ok: true }
  }, [])

  const signOut = useCallback<AuthState['signOut']>(async () => {
    if (supabase === null) return
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback<AuthState['refreshProfile']>(async () => {
    if (userId !== null) await loadProfile(userId)
  }, [userId, loadProfile])

  const value = useMemo<AuthState>(
    () => ({
      userId,
      profile,
      partnerName,
      loading,
      error,
      signUp,
      signIn,
      signOut,
      refreshProfile,
    }),
    [userId, profile, partnerName, loading, error, signUp, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
