import { useParams } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { LetterSheet } from '../components/LetterSheet'
import { usePublicLetter } from '../hooks/usePublicLetter'

export default function PublicLetter() {
  const { slug } = useParams<{ slug: string }>()
  const { letter, loading } = usePublicLetter(slug)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-app">
        <p className="font-ui text-sm text-ink-muted">One moment…</p>
      </div>
    )
  }

  if (letter === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-app px-6">
        <div className="text-center">
          <p className="font-hand text-3xl text-ink-ui">This letter isn't available</p>
          <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
            The link may have been turned off, or the letter put away.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper-app px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-[600px]">
        <PaperTexture className="p-8 sm:p-12">
          <LetterSheet
            salutation={letter.salutation}
            body={letter.message}
            bodyFont={letter.bodyFont}
            authorName={letter.senderName}
            recipientName={letter.receiverName}
            createdAt={letter.createdAt}
          />
        </PaperTexture>

        <p className="mt-8 text-center font-hand text-xl text-ink-muted">Dear Jee</p>
        <p className="mt-2 text-center font-ui text-xs text-ink-muted">
          Made with{' '}
          <span role="img" aria-label="love">
            ❤️
          </span>{' '}
          by Pin3appl3ishan
        </p>
      </div>
    </div>
  )
}
