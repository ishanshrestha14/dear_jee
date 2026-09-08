import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'

type Mode = 'signIn' | 'signUp'

interface LocationState {
  from?: string
}

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = mode === 'signIn' ? await signIn(email, password) : await signUp(email, password)
    setBusy(false)
    if (result.ok) navigate(from, { replace: true })
    else setError(result.error ?? 'That did not work.')
  }

  return (
    <div className="mx-auto max-w-[420px] pt-10">
      <PaperTexture className="p-8 sm:p-10">
        <h1 className="font-hand text-4xl text-ink-ui">Dear Jee</h1>
        <p className="mt-2 font-letter text-ink-letter">
          {mode === 'signIn' ? 'Welcome back.' : 'Letters, for the two of you.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="font-ui text-xs text-ink-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="font-ui text-xs text-ink-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="font-ui text-sm text-accent">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'One moment…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn')
            setError(null)
          }}
          className="mt-6 font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          {mode === 'signIn' ? 'Need an account?' : 'Already have an account?'}
        </button>
      </PaperTexture>
    </div>
  )
}
