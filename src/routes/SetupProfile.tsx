import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'
import { profileRepository } from '../data'

interface LocationState {
  from?: string
}

export default function SetupProfile() {
  const { userId, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Where they were headed before setup interrupted them — an invite link,
  // usually. Falls back to the inbox for someone who came here directly.
  const from = (location.state as LocationState | null)?.from ?? '/'
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (userId === null) return
    setBusy(true)
    setError(null)
    const result = await profileRepository.updateName(userId, name)
    if (result.error !== null) {
      setBusy(false)
      setError(result.error)
      return
    }
    await refreshProfile()
    setBusy(false)
    navigate(from, { replace: true })
  }

  return (
    <div className="mx-auto max-w-[420px] pt-10">
      <PaperTexture className="p-8 sm:p-10">
        <h1 className="font-hand text-4xl text-ink-ui">What should they call you?</h1>
        <p className="mt-2 font-letter text-ink-letter">
          This is the name signed at the bottom of every letter you write.
        </p>

        <form onSubmit={handleSubmit} className="mt-8">
          <label htmlFor="name" className="font-ui text-xs text-ink-muted">
            Your name
          </label>
          <input
            id="name"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
          />

          {error && (
            <p role="alert" className="mt-3 font-ui text-sm text-accent">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="mt-6 w-full rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'One moment…' : 'Continue'}
          </button>
        </form>
      </PaperTexture>
    </div>
  )
}
