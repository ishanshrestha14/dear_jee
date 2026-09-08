import { createContext, useContext } from 'react'
import type { Profile } from '../data/types'

export interface AuthState {
  userId: string | null
  profile: Profile | null
  partnerName: string
  loading: boolean
  error: string | null
  signUp(email: string, password: string): Promise<{ ok: boolean; error?: string }>
  signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }>
  signOut(): Promise<void>
  refreshProfile(): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

/** Throws outside the provider — a missing provider is a wiring bug, not a state. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
