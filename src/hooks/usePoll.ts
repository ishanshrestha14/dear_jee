import { useEffect, useRef } from 'react'

/**
 * Runs `callback` on an interval, but ONLY while the tab is visible — and
 * immediately when it becomes visible again.
 *
 * The refocus call is the one that will actually be felt: you switch back to
 * the tab and the letter is already there. The interval is the safety net for
 * someone who leaves the page open.
 *
 * Nothing runs while the tab is hidden. A backgrounded tab polling a database
 * every thirty seconds is a battery cost with no reader to benefit from it.
 *
 * The callback is held in a ref so that a caller passing a fresh closure on
 * every render does not tear the interval down and rebuild it each time —
 * which would mean the timer never actually fires.
 */
export function usePoll(callback: () => void, intervalMs: number): void {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])

  useEffect(() => {
    let timer: number | undefined

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }

    const start = () => {
      stop()
      timer = window.setInterval(() => saved.current(), intervalMs)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        saved.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
}
