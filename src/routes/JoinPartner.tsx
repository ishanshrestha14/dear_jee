import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'
import { profileRepository } from '../data'

type Status = 'working' | 'linked' | 'failed'

export default function JoinPartner() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const { userId, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('working')
  const [message, setMessage] = useState('')
  // The link must be applied exactly once, even under StrictMode's
  // double-invoked effects — a second attempt would report ALREADY_LINKED
  // against the link this very component just made.
  const attempted = useRef(false)

  useEffect(() => {
    if (userId === null || inviteCode === undefined) return
    if (attempted.current) return
    attempted.current = true

    void (async () => {
      const result = await profileRepository.linkPartner(userId, inviteCode)
      if (result.error !== null) {
        setStatus('failed')
        setMessage(result.error)
        return
      }
      await refreshProfile()
      setStatus('linked')
    })()
  }, [userId, inviteCode, refreshProfile])

  const alreadyLinked = profile?.partnerId != null && status === 'failed'

  return (
    <div className="mx-auto max-w-[420px] pt-10">
      <PaperTexture className="p-8 text-center sm:p-10">
        {status === 'working' && (
          <p className="font-letter text-ink-letter">Connecting you two…</p>
        )}

        {status === 'linked' && (
          <>
            <h1 className="font-hand text-4xl text-ink-ui">You're connected</h1>
            <p className="mt-3 font-letter text-ink-letter">
              Write them something.
            </p>
            <button
              type="button"
              onClick={() => navigate('/compose', { replace: true })}
              className="mt-6 rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
            >
              Write a letter
            </button>
          </>
        )}

        {status === 'failed' && (
          <>
            <h1 className="font-hand text-3xl text-ink-ui">
              {alreadyLinked ? 'Already connected' : 'That link did not work'}
            </h1>
            <p className="mt-3 font-letter text-ink-letter">{message}</p>
            <Link
              to="/"
              className="mt-6 inline-block font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
            >
              Back to your letters
            </Link>
          </>
        )}
      </PaperTexture>
    </div>
  )
}
