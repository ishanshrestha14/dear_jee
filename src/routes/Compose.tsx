import { useCallback, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ComposeLetter } from '../components/ComposeLetter'
import { useDraft } from '../hooks/useDraft'
import { useLettersContext } from '../hooks/LettersProvider'
import { formatLetterDate } from '../lib/format'
import type { BodyFont } from '../lib/validation'

export default function Compose() {
  const { partnerName, loading, sendLetter, editScheduled, scheduled } = useLettersContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { userId } = useAuth()
  // Read once, synchronously, on the first render. The hook does this in a
  // useState initializer rather than an effect for the same reason the
  // `loading` guard below exists: ComposeLetter's useState reads its initial
  // values once, so a draft that arrives after first render never reaches
  // the textarea.
  const { restored, save, clear } = useDraft(userId)
  // Bumping this remounts ComposeLetter, which is how "Start fresh" empties
  // fields that live in the composer's own useState — the same remount
  // pattern the `editing` branch already relies on through `key={editing.id}`.
  // It also resets the scheduling toggle and date, which for a button called
  // "Start fresh" is the intended meaning rather than a side effect.
  const [freshCount, setFreshCount] = useState(0)
  const [noticeShown, setNoticeShown] = useState(restored !== null)

  const startFresh = useCallback(() => {
    clear()
    setNoticeShown(false)
    setFreshCount((n) => n + 1)
  }, [clear])

  // Wraps `save` so the notice hides itself the moment the composer's
  // content diverges from what was restored, rather than staying on screen
  // with a stale date for the whole session. ComposeLetter's reporting
  // effect fires once on mount with the restored values UNCHANGED, so that
  // first call compares equal here and does not hide the notice — only a
  // real edit does. Identity must stay stable (useCallback): ComposeLetter's
  // effect depends on this function, and `restored`/`save` are themselves
  // stable, so this only changes if the hook's own dependencies change.
  const handleDraftChange = useCallback(
    (draft: { message: string; salutation: string; bodyFont: BodyFont | null }) => {
      if (
        restored !== null &&
        (draft.message !== restored.message ||
          draft.salutation !== restored.salutation ||
          draft.bodyFont !== restored.bodyFont)
      ) {
        setNoticeShown(false)
      }
      save(draft)
    },
    [restored, save],
  )

  const editId = searchParams.get('edit')
  // Undefined while the id doesn't resolve to one of the caller's own
  // pending letters — a stale link, or one that has since delivered or been
  // cancelled. Falling through to an ordinary blank compose is the safe
  // default rather than an error page for what is, at worst, a dead link.
  const editing = editId === null ? null : (scheduled.find((l) => l.id === editId) ?? null)

  // Wait for the scheduled list to resolve before deciding anything. On a
  // cold load (direct navigation to /compose?edit=<id>, not an in-app Link
  // click) `loading` starts true and `scheduled` starts empty, so `editing`
  // would otherwise be null on the very first render — mounting the FRESH,
  // blank ComposeLetter instead of the editing one. Because both branches
  // render a ComposeLetter at the same JSX position, React would then reuse
  // that already-mounted instance once `editing` resolves, rather than
  // remounting it with the real content: useState only reads its initial
  // value once. Blocking on `loading` here means the composer only ever
  // mounts once `editing` is already resolved to its final value.
  if (editId !== null && loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">Opening the letter…</p>
  }

  if (editId !== null && editing === null) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">That letter isn't there anymore</p>
        <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
          It may have already arrived, or been cancelled.
        </p>
      </div>
    )
  }

  if (editing !== null) {
    return (
      <ComposeLetter
        key={editing.id}
        partnerName={partnerName}
        disabled={loading}
        initialMessage={editing.message}
        initialSalutation={editing.salutation ?? ''}
        initialBodyFont={editing.bodyFont}
        initialScheduledFor={editing.scheduledFor}
        submitLabel="Save changes"
        sendingLabel="Saving…"
        onCancel={() => navigate('/')}
        onSend={async (message, salutation, bodyFont, scheduledFor) => {
          const result = await editScheduled(editing.id, message, salutation, bodyFont, scheduledFor)
          if (result.ok) navigate('/')
          return result
        }}
      />
    )
  }

  return (
    <div>
      {noticeShown && restored !== null && (
        <p className="mx-auto mb-4 flex max-w-[600px] flex-wrap items-center gap-2 font-ui text-sm text-ink-muted">
          Unsent, from {formatLetterDate(restored.savedAt)}.
          <button
            type="button"
            onClick={startFresh}
            className="font-ui text-sm text-ink-muted underline underline-offset-4 transition-colors hover:text-accent"
          >
            Start fresh
          </button>
        </p>
      )}
      <ComposeLetter
        key={`new-${freshCount}`}
        partnerName={partnerName}
        disabled={loading}
        initialMessage={freshCount === 0 ? (restored?.message ?? '') : ''}
        initialSalutation={freshCount === 0 ? (restored?.salutation ?? '') : ''}
        initialBodyFont={freshCount === 0 ? (restored?.bodyFont ?? null) : null}
        onDraftChange={handleDraftChange}
        onCancel={() => {
          // Discarding must also throw away what was saved, or the letter they
          // just discarded is waiting for them next time.
          clear()
          navigate('/')
        }}
        onSend={async (message, salutation, bodyFont, scheduledFor) => {
          const result = await sendLetter(message, salutation, bodyFont, scheduledFor)
          if (result.ok) {
            clear()
            navigate('/')
          }
          return result
        }}
      />
    </div>
  )
}
