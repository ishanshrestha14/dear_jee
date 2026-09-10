import { useEffect, useState } from 'react'
import { letterRepository } from '../data'
import type { PublicLetter } from '../data/types'

interface UsePublicLetter {
  letter: PublicLetter | null
  loading: boolean
}

/**
 * The anonymous reader's path. Deliberately does NOT use useLetters, which
 * requires a signed-in user — this page is read by someone who has no account
 * and never will.
 */
export function usePublicLetter(slug: string | undefined): UsePublicLetter {
  const [letter, setLetter] = useState<PublicLetter | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (slug === undefined) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      const result = await letterRepository.getBySlug(slug)
      if (cancelled) return
      setLetter(result.error !== null ? null : result.data)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [slug])

  return { letter, loading }
}
