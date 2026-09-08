import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

interface LayoutProps {
  children: ReactNode
}

/** App shell: warm ground, a quiet header, and a centred content column. */
export function Layout({ children }: LayoutProps) {
  const { userId, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-paper-app">
      <header className="mx-auto flex max-w-3xl items-baseline justify-between px-6 pt-10 pb-6">
        <Link to="/" className="font-hand text-3xl text-ink-ui transition-colors hover:text-accent">
          Dear Jee
        </Link>
        {userId !== null && (
          <nav className="flex items-center gap-5">
            <Link
              to="/compose"
              className="font-ui text-sm font-medium text-ink-muted transition-colors hover:text-accent"
            >
              Write a letter
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="font-ui text-sm text-ink-muted transition-colors hover:text-accent"
            >
              Sign out
            </button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24">{children}</main>
    </div>
  )
}
