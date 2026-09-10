import { Link } from 'react-router-dom'

/**
 * Reached by a mangled share link as well as by a bad in-app path, so it must
 * read as an absence rather than a fault — a stranger who lost a character to
 * a line break should not meet an error page.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-app px-6">
      <div className="text-center">
        <p className="font-hand text-3xl text-ink-ui">Nothing here</p>
        <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
          The link may be incomplete, or the letter put away.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          Go to Dear Jee
        </Link>
      </div>
    </div>
  )
}
