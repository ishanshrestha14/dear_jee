import { useCallback, useEffect, useRef, useState } from 'react'
import { clearDraft, readDraft, writeDraft } from '../lib/draft'
import type { LetterDraft, StorageLike } from '../lib/draft'

/** ~600ms: a synchronous write per keystroke janks a 5000-character letter. */
const DEBOUNCE_MS = 600

/**
 * The debounce timer above resets on every keystroke, so sub-600ms typing
 * rhythm can keep pushing the write out indefinitely — a fast typist could
 * write for a minute with no write ever landing. This ceiling is started
 * once, on the first unsaved keystroke of a run, and is NOT reset by later
 * keystrokes, so a write lands at most this long after that first keystroke
 * regardless of how fast or evenly someone types.
 */
const MAX_DEBOUNCE_MS = 5000

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
 * effect would be a silent no-op. This is only correct because `RequireAuth`
 * guarantees a resolved, non-null `userId` before `Compose` mounts; called
 * from a route outside that guard, `userId` would still be null on first
 * render, `restored` would freeze to `null` forever, and nothing here would
 * surface the mistake.
 */
export function useDraft(userId: string | null) {
  const [storage] = useState<StorageLike | null>(() => browserStorage())

  const [restored] = useState<LetterDraft | null>(() =>
    storage === null || userId === null ? null : readDraft(storage, userId),
  )

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Started on the first unsaved keystroke of a run and left alone by every
  // keystroke after that — the ceiling `flush` described at MAX_DEBOUNCE_MS.
  const ceilingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<LetterDraft | null>(null)
  // Once cleared, the unmount flush must NOT write the pending text back.
  // Without this, discarding a letter would save the very words the person
  // just threw away, and they would be waiting in the composer next time.
  const suppressed = useRef(false)

  // The content (not the timestamp) of the last draft that was persisted or
  // restored. ComposeLetter's reporting effect fires once on mount with the
  // restored values themselves, so without this, `save` would stamp a fresh
  // `savedAt` on every visit even when nobody typed anything — and the
  // notice would drift to showing when the composer was last OPENED rather
  // than when it was last WRITTEN in.
  const lastContent = useRef<Omit<LetterDraft, 'savedAt'> | null>(
    restored === null
      ? null
      : { message: restored.message, salutation: restored.salutation, bodyFont: restored.bodyFont },
  )
  const lastSavedAt = useRef<string | null>(restored?.savedAt ?? null)

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (ceilingTimer.current !== null) {
      clearTimeout(ceilingTimer.current)
      ceilingTimer.current = null
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
      const last = lastContent.current
      const unchanged =
        last !== null &&
        last.message === draft.message &&
        last.salutation === draft.salutation &&
        last.bodyFont === draft.bodyFont
      const savedAt =
        unchanged && lastSavedAt.current !== null ? lastSavedAt.current : new Date().toISOString()
      lastContent.current = draft
      lastSavedAt.current = savedAt
      pending.current = { ...draft, savedAt }
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, DEBOUNCE_MS)
      // Only armed when nothing was already pending a ceiling flush — later
      // keystrokes in the same run must NOT push this back out.
      if (ceilingTimer.current === null) {
        ceilingTimer.current = setTimeout(flush, MAX_DEBOUNCE_MS)
      }
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
    if (ceilingTimer.current !== null) {
      clearTimeout(ceilingTimer.current)
      ceilingTimer.current = null
    }
    // Deliberately NOT reset here. A blank message routes to `clearDraft`
    // rather than `writeDraft` in `flush`/`save`, so a stale `lastContent` of
    // "what used to be there" cannot cause a blank draft to be persisted; and
    // `startFresh` remounts the composer, which remounts this hook and
    // re-seeds both refs from a fresh (null) `restored`. Resetting them here
    // would be redundant, not protective.
    if (storage === null || userId === null) return
    clearDraft(storage, userId)
  }, [storage, userId])

  // Flush on unmount so words typed in the last 600ms before navigating away
  // are not the ones that get lost. This covers in-app navigation, but
  // browsers do not run React effect cleanups on an actual tab close.
  useEffect(() => flush, [flush])

  // `pagehide` is what actually fires on a real tab close, reload, or bfcache
  // navigation — unlike `beforeunload`, it is reliable on mobile, and unlike
  // an unmount it fires even when React never gets to clean up. Also listen
  // for `visibilitychange` going to 'hidden', because iOS Safari typically
  // backgrounds and discards a tab rather than unloading it, and 'hidden' is
  // the only signal that path gives before the tab may vanish. The effect
  // re-registers whenever `flush` changes, so the listener always closes over
  // the current `flush` rather than a stale one from an earlier render.
  useEffect(() => {
    const onPageHide = () => flush()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [flush])

  return { restored, save, clear }
}
