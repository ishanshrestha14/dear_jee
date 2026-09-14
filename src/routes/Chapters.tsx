import { Link } from 'react-router-dom'
import { useBonds } from '../hooks/useBonds'

function chapterDates(startedAt: string, endedAt: string | null): string {
  const format = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  if (endedAt === null) return `since ${format(startedAt)}`
  return `${format(startedAt)} – ${format(endedAt)}`
}

export default function Chapters() {
  const { past, loading, error } = useBonds()

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (error !== null) {
    return <p className="py-20 text-center font-ui text-sm text-accent">{error}</p>
  }

  if (past.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">No past chapters</p>
        <Link
          to="/"
          className="mt-6 inline-block font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Back to your letters
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-hand text-3xl text-ink-ui">Past chapters</h1>
        <Link
          to="/"
          className="font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Back
        </Link>
      </div>

      <ul className="space-y-4">
        {past.map((bond) => (
          <li key={bond.id}>
            <Link
              to={`/chapters/${bond.id}`}
              className="block rounded-letter border border-paper-edge bg-paper-letter px-6 py-5 transition-shadow hover:shadow-letter-lifted"
            >
              <span className="font-hand text-2xl text-ink-ui">
                {bond.partnerName || 'Someone'}
              </span>
              <p className="mt-1 font-ui text-xs tracking-wide text-ink-muted">
                {bond.letterCount} {bond.letterCount === 1 ? 'letter' : 'letters'} ·{' '}
                {chapterDates(bond.startedAt, bond.endedAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
