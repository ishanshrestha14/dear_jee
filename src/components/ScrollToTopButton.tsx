import { useEffect, useState } from 'react'

const SHOW_AFTER_PX = 300

/** Scrolls to the top of the page. `scroll-behavior` in tokens.css decides whether that's smooth or instant. */
export function scrollToTop() {
  window.scrollTo({ top: 0 })
}

/**
 * Fixed bottom-right, appears once the page has scrolled past roughly a
 * screen's worth. Terracotta, matching the app's one accent color — nothing
 * here is a new color, per the fixed palette in tokens.css.
 */
export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-paper-app shadow-letter-lifted transition-opacity hover:opacity-90"
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M10 15V5M4 9l6-6 6 6" />
      </svg>
    </button>
  )
}
