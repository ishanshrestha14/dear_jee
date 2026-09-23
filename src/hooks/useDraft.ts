import { useCallback, useEffect, useRef, useState } from 'react'
import { clearDraft, readDraft, writeDraft } from '../lib/draft'
import type { LetterDraft, StorageLike } from '../lib/draft'

/** ~600ms: a synchronous write per keystroke janks a 5000-character letter. */
const DEBOUNCE_MS = 600

/**
 * Reaching localStorage is itself a throw in some browsers, so even naming it
 * goes through a try/catch. A null store means the safety net does not exist,
 * which every path below already handles.
 */
function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The composer's safety net. `restored` is read ONCE, synchronously, on the
 * first render — see the comment at the call site in Compose.tsx for why an
 * effect would be a silent no-op.
 */
export function useDraft(userId: string | null) {
  const storageRef = useRef<StorageLike | null>(null)
  if (storageRef.current === null) storageRef.current = browserStorage()
  const storage = storageRef.current

  const [restored] = useState<LetterDraft | null>(() =>
    storage === null || userId === null ? null : readDraft(storage, userId),
  )

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<LetterDraft | null>(null)
  // Once cleared, the unmount flush must NOT write the pending text back.
  // Without this, discarding a letter would save the very words the person
  // just threw away, and they would be waiting in the composer next time.
  const suppressed = useRef(false)

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const draft = pending.current
    pending.current = null
    if (draft === null || suppressed.current) return
    if (storage === null || userId === null) return
    if (draft.message.trim() === '') clearDraft(storage, userId)
    else writeDraft(storage, userId, draft)
  }, [storage, userId])

  const save = useCallback(
    (draft: Omit<LetterDraft, 'savedAt'>) => {
      if (storage === null || userId === null) return
      suppressed.current = false
      pending.current = { ...draft, savedAt: new Date().toISOString() }
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, DEBOUNCE_MS)
    },
    [storage, userId, flush],
  )

  const clear = useCallback(() => {
    suppressed.current = true
    pending.current = null
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (storage === null || userId === null) return
    clearDraft(storage, userId)
  }, [storage, userId])

  // Flush on unmount so words typed in the last 600ms before navigating away
  // are not the ones that get lost.
  useEffect(() => flush, [flush])

  return { restored, save, clear }
}
