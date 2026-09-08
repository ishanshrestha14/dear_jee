import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

/**
 * Gates the authenticated routes. Also pushes a signed-in user who has not
 * named themselves to /setup, so the app never renders "Dear ," to anyone.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, profile, loading } = useAuth()
  const location = useLocation()

  // A signed-in user whose profile has not arrived yet is NOT "set up
  // already" — it is not known yet. AuthProvider sets userId synchronously
  // from onAuthStateChange and loads the profile afterwards, so without this
  // second condition there is a window where children render with no profile:
  // the "Dear ," flash this guard exists to prevent, and a skipped /setup
  // redirect for a brand-new account. Against the mock the window is zero;
  // behind Supabase it is a network round trip.
  if (loading || (userId !== null && profile === null)) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (userId === null) {
    // Remember where they were headed so /join/:code survives a sign-in.
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />
  }

  const needsSetup = profile !== null && profile.fullName.trim() === ''
  if (needsSetup && location.pathname !== '/setup') {
    // Carry the attempted path through setup as well. A new account arriving
    // on an invite link is the COMMON case — B gets a link from A and has
    // never used the app — and without this the code is lost at the setup
    // detour: they name themselves, land on an empty inbox, and nothing on
    // screen says the invite did not take.
    return <Navigate to="/setup" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
