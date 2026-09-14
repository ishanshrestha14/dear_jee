import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

interface LayoutProps {
  children: ReactNode
}

/** App shell: warm ground, a quiet header, and a centred content column. */
export function Layout({ children }: LayoutProps) {
  const { userId } = useAuth()
  // Everyone signed in may write. With no bond the letter is HELD rather than
  // sent, which the composer and the repository both handle; refusing here
  // would make the app's central act conditional on having a partner.
  const canWrite = userId !== null
  // Settings holds name editing, bond status and "End this bond" as well as
  // sign out, all of which work on both the mock and Supabase paths — so the
  // link itself only needs a signed-in user. (Sign out alone is a no-op on
  // the mock path; Settings.tsx gates just that button on isSupabaseConfigured.)
  const canOpenSettings = userId !== null

  return (
    <div className="min-h-screen bg-paper-app">
      <header className="mx-auto flex max-w-3xl items-baseline justify-between px-6 pt-10 pb-6">
        <Link to="/" className="font-hand text-3xl text-ink-ui transition-colors hover:text-accent">
          Dear Jee
        </Link>
        {(canWrite || canOpenSettings) && (
          <nav className="flex items-center gap-5">
            {canWrite && (
              <Link
                to="/compose"
                className="font-ui text-sm font-medium text-ink-muted transition-colors hover:text-accent"
              >
                Write a letter
              </Link>
            )}
            {canOpenSettings && (
              <Link
                to="/settings"
                className="font-ui text-sm text-ink-muted transition-colors hover:text-accent"
              >
                You
              </Link>
            )}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24">{children}</main>
    </div>
  )
}
