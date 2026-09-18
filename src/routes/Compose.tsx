import { useNavigate, useSearchParams } from 'react-router-dom'
import { ComposeLetter } from '../components/ComposeLetter'
import { useLettersContext } from '../hooks/LettersProvider'

export default function Compose() {
  const { partnerName, loading, sendLetter, editScheduled, scheduled } = useLettersContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  // Undefined while the id doesn't resolve to one of the caller's own
  // pending letters — a stale link, or one that has since delivered or been
  // cancelled. Falling through to an ordinary blank compose is the safe
  // default rather than an error page for what is, at worst, a dead link.
  const editing = editId === null ? null : (scheduled.find((l) => l.id === editId) ?? null)

  if (editId !== null && editing === null && !loading) {
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
    <ComposeLetter
      partnerName={partnerName}
      disabled={loading}
      onCancel={() => navigate('/')}
      onSend={async (message, salutation, bodyFont, scheduledFor) => {
        const result = await sendLetter(message, salutation, bodyFont, scheduledFor)
        if (result.ok) navigate('/')
        return result
      }}
    />
  )
}
