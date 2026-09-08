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

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (userId === null) {
    // Remember where they were headed so /join/:code survives a sign-in.
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />
  }

  const needsSetup = profile !== null && profile.fullName.trim() === ''
  if (needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }

  return <>{children}</>
}
