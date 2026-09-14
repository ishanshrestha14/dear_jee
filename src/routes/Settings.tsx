import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'
import { useBonds } from '../hooks/useBonds'
import { profileRepository } from '../data'
import { isSupabaseConfigured } from '../data/supabaseClient'

export default function Settings() {
  const { userId, profile, partnerName, signOut, refreshProfile } = useAuth()
  const { current, loading, error: bondError, unlink } = useBonds()
  const navigate = useNavigate()
  const [name, setName] = useState(profile?.fullName ?? '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function saveName() {
    if (userId === null) return
    setSaving(true)
    setError(null)
    const result = await profileRepository.updateName(userId, name)
    setSaving(false)
    if (result.error !== null) {
      setError(result.error)
      return
    }
    await refreshProfile()
    setNotice('Saved.')
  }

  async function endBond() {
    setError(null)
    const result = await unlink()
    if (!result.ok) {
      setError(result.error ?? 'That did not work.')
      return
    }
    setConfirming(false)
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-[480px] pt-4">
      <PaperTexture className="p-8 sm:p-10">
        <h1 className="font-hand text-4xl text-ink-ui">You</h1>

        <label htmlFor="name" className="mt-8 block font-ui text-xs text-ink-muted">
          The name signed at the bottom of your letters
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setNotice(null)
          }}
          className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void saveName()}
          disabled={saving || name.trim().length === 0 || name === profile?.fullName}
          className="mt-3 rounded-full bg-accent px-5 py-2.5 font-ui text-sm font-medium text-paper-app disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'One moment…' : 'Save'}
        </button>
        {notice !== null && (
          <p className="mt-3 font-ui text-xs text-ink-muted">{notice}</p>
        )}

        <div className="mt-10 border-t border-paper-edge pt-6">
          <h2 className="font-ui text-xs tracking-wide text-ink-muted">Your bond</h2>
          {loading ? (
            <p className="mt-2 font-ui text-sm text-ink-muted">One moment…</p>
          ) : bondError !== null ? (
            <p role="alert" className="mt-2 font-ui text-sm text-accent">
              {bondError}
            </p>
          ) : current === null ? (
            <p className="mt-2 font-letter text-ink-letter">
              You are not connected to anyone.
            </p>
          ) : (
            <>
              <p className="mt-2 font-letter text-ink-letter">
                You and {partnerName || 'them'}.
              </p>
              {confirming ? (
                <div className="mt-4">
                  <p className="font-letter text-ink-letter">
                    {partnerName || 'They'} keeps every letter, and so do you — they move
                    to Past chapters. Both of you can bond with someone else afterwards.
                    This cannot be undone.
                  </p>
                  <div className="mt-4 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => void endBond()}
                      className="rounded-full bg-accent px-5 py-2.5 font-ui text-sm font-medium text-paper-app"
                    >
                      End this bond
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(false)
                        setError(null)
                      }}
                      className="font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="mt-4 font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
                >
                  End this bond
                </button>
              )}
            </>
          )}
        </div>

        {error !== null && (
          <p role="alert" className="mt-6 font-ui text-sm text-accent">
            {error}
          </p>
        )}

        {isSupabaseConfigured() && (
          <div className="mt-10 border-t border-paper-edge pt-6">
            <button
              type="button"
              onClick={() => void signOut()}
              className="font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
            >
              Sign out
            </button>
          </div>
        )}
      </PaperTexture>
    </div>
  )
}
