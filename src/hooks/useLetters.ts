import { useCallback, useEffect, useRef, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import { usePoll } from './usePoll'
import { spliceConversation, detectPartnerArrivals } from './conversationPaging'
import type { Letter, LetterCursor } from '../data/types'
import type { BodyFont } from '../lib/validation'

/** Letters per page, both for the first load and every scroll-triggered fetch. */
const PAGE_SIZE = 30

export interface UseLetters {
  letters: Letter[]
  archived: Letter[]
  held: Letter[]
  /** The caller's own pending or bond-cancelled scheduled letters. */
  scheduled: Letter[]
  hasBond: boolean
  partnerName: string
  loading: boolean
  error: string | null
  /** True once a fetch has come back short of PAGE_SIZE — no further page exists. */
  hasMoreLetters: boolean
  /** True while a scroll-triggered page fetch is in flight. */
  loadingMore: boolean
  /** Fetches the next older page of `letters` and appends it. */
  loadMoreLetters(): Promise<void>
  /**
   * Partner-authored letters a poll found that were not loaded before.
   * Stays populated until the caller calls clearNewArrivals — meant to
   * drive a one-shot notification, not to be read on every render.
   */
  newArrivals: Letter[]
  clearNewArrivals(): void
  sendLetter(
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ): Promise<{ ok: boolean; error?: string }>
  sendHeld(id: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  deleteForMe(id: string): Promise<void>
  setShared(id: string, shared: boolean): Promise<{ ok: boolean; error?: string }>
  editScheduled(
    id: string,
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ): Promise<{ ok: boolean; error?: string }>
  reload(): Promise<void>
}

/**
 * The correspondence. Identity and partner resolution belong to AuthProvider;
 * this hook owns letters and reloads whenever the signed-in user changes.
 */
export function useLetters(): UseLetters {
  const { userId, profile, partnerName, loading: authLoading } = useAuth()
  const partnerId = profile?.partnerId ?? null

  const [letters, setLetters] = useState<Letter[]>([])
  const [archived, setArchived_] = useState<Letter[]>([])
  const [held, setHeld] = useState<Letter[]>([])
  const [scheduled, setScheduled] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMoreLetters, setHasMoreLetters] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [newArrivals, setNewArrivals] = useState<Letter[]>([])

  // A poll that lands mid-mutation overwrites the optimistic update with the
  // pre-write server value — the unread dot flickering back on a letter the
  // reader is looking at. A ref, not state: this must not cause a render, and
  // the poll needs the current value, not the one from its closure.
  const mutating = useRef(0)

  // Mirrors `letters` for reads inside load()/loadMoreLetters(), which must
  // stay stable (empty dependency array) so usePoll's interval is not torn
  // down and rebuilt on every fetch — the same reason `mutating` above is a
  // ref rather than state.
  const lettersRef = useRef<Letter[]>([])

  // Null until the user scrolls past the first page; frozen from then on.
  // See spliceConversation and the spec's "frozen boundary" decision.
  const pageBoundary = useRef<LetterCursor | null>(null)

  // Read inside load(), which must stay referentially stable — see
  // lettersRef above for why this can't just be the partnerId variable.
  const partnerIdRef = useRef<string | null>(null)

  const load = useCallback(async (id: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    // No boundary yet: this IS the first page, capped at PAGE_SIZE, same
    // shape as before pagination existed. A boundary frozen by
    // loadMoreLetters: refetch only what's newer than it and leave the
    // already-appended tail alone — see spliceConversation.
    const conversationOptions =
      pageBoundary.current === null ? { limit: PAGE_SIZE } : { newerThan: pageBoundary.current }
    const [conversation, archive, heldLetters, scheduledLetters] = await Promise.all([
      letterRepository.listConversation(id, conversationOptions),
      letterRepository.listArchived(id),
      letterRepository.listHeld(id),
      letterRepository.listScheduled(id),
    ])
    // All three failures must surface. Swallowing one would leave the
    // previous list on screen looking correct, and setArchived/deleteForMe
    // both call load(), so the staleness would recur after every action — a
    // wrong list the reader trusts is worse than a missing one they do not.
    //
    // Silent (polling) loads are the opposite: a failure here has a
    // last-known-good list to fall back on, the reader did not ask for the
    // refresh, and cannot act on its failure. So a silent failure changes
    // nothing on screen — it neither blanks a list nor sets the page error.
    if (conversation.error !== null) {
      if (!silent) setError(conversation.error)
    } else {
      const fresh = conversation.data
      if (pageBoundary.current === null) {
        setHasMoreLetters(fresh.length === PAGE_SIZE)
      }
      // Diffed BEFORE lettersRef is updated below — this is specifically
      // "what a silent poll found that wasn't already on screen."
      if (silent) {
        const arrivals = detectPartnerArrivals(fresh, lettersRef.current, partnerIdRef.current)
        if (arrivals.length > 0) setNewArrivals((current) => [...current, ...arrivals])
      }
      const next = spliceConversation(fresh, pageBoundary.current, lettersRef.current)
      lettersRef.current = next
      setLetters(next)
    }

    if (archive.error !== null) {
      if (!silent) setError(archive.error)
    } else setArchived_(archive.data)

    if (heldLetters.error !== null) {
      if (!silent) setError(heldLetters.error)
    } else setHeld(heldLetters.data)

    if (scheduledLetters.error !== null) {
      if (!silent) setError(scheduledLetters.error)
    } else setScheduled(scheduledLetters.data)

    if (
      !silent &&
      conversation.error === null &&
      archive.error === null &&
      heldLetters.error === null &&
      scheduledLetters.error === null
    ) {
      setError(null)
    }
  }, [])

  useEffect(() => {
    if (userId === null) {
      setLetters([])
      lettersRef.current = []
      pageBoundary.current = null
      setHasMoreLetters(false)
      setNewArrivals([])
      setArchived_([])
      setHeld([])
      setScheduled([])
      setLoading(authLoading)
      return
    }

    // A fresh sign-in (or a switch between accounts) starts a fresh
    // pagination cycle — a boundary or a tail left over from a previous
    // user would otherwise be spliced onto the new one's letters.
    pageBoundary.current = null
    lettersRef.current = []

    let cancelled = false
    setLoading(true)

    void (async () => {
      await load(userId)
      if (cancelled) return
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading, load])

  useEffect(() => {
    partnerIdRef.current = partnerId
  }, [partnerId])

  const reload = useCallback(async () => {
    if (userId !== null) await load(userId)
  }, [userId, load])

  const loadMoreLetters = useCallback(async () => {
    if (userId === null || !hasMoreLetters || loadingMore) return
    const last = lettersRef.current[lettersRef.current.length - 1]
    if (last === undefined) return
    setLoadingMore(true)
    try {
      // The first call freezes the boundary right here, at what was — until
      // now — the last loaded letter. Every refresh from this point on
      // refetches only what's newer than it; everything from here back was
      // loaded once and is never touched again.
      if (pageBoundary.current === null) {
        pageBoundary.current = { createdAt: last.createdAt, id: last.id }
      }
      const result = await letterRepository.listConversation(userId, {
        olderThan: { createdAt: last.createdAt, id: last.id },
        limit: PAGE_SIZE,
      })
      if (result.error !== null) {
        setError(result.error)
        return
      }
      const next = [...lettersRef.current, ...result.data]
      lettersRef.current = next
      setLetters(next)
      setHasMoreLetters(result.data.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [userId, hasMoreLetters, loadingMore])

  const clearNewArrivals = useCallback(() => setNewArrivals([]), [])

  const POLL_INTERVAL_MS = 30_000

  const poll = useCallback(() => {
    if (userId === null) return
    if (mutating.current > 0) return
    // A failed background refresh changes nothing on screen: it must not blank
    // the list and must not set the page error. The reader did not ask for it
    // and cannot act on it, and an error banner appearing on a timer while
    // someone is reading a letter is worse than no banner. The last good list
    // stays. This is deliberately the opposite of the rule for FOREGROUND
    // failures elsewhere in this app — the difference is that a poll has a
    // last-known-good answer to fall back on and a first load does not.
    void load(userId, { silent: true })
  }, [userId, load])

  usePoll(poll, POLL_INTERVAL_MS)

  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message, salutation, bodyFont, scheduledFor) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      // An unbonded author writes a HELD letter — receiverId null — rather
      // than being refused. The repository and the insert policy both enforce
      // that this is only allowed with no bond, so there is no check here.
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
        salutation,
        bodyFont,
        scheduledFor,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      await load(userId)
      return { ok: true }
    },
    [userId, partnerId, load],
  )

  const sendHeldFn = useCallback<UseLetters['sendHeld']>(
    async (id) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      mutating.current++
      try {
        const result = await letterRepository.sendHeld(id, userId)
        if (result.error !== null) return { ok: false, error: result.error }
        await load(userId)
        return { ok: true }
      } finally {
        mutating.current--
      }
    },
    [userId, load],
  )

  const markRead = useCallback<UseLetters['markRead']>(async (id) => {
    mutating.current++
    try {
      // Optimistic: the dot disappears the instant the letter opens.
      setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: true } : l)))
      const result = await letterRepository.markRead(id)
      if (result.error !== null) {
        setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: false } : l)))
      }
    } finally {
      mutating.current--
    }
  }, [])

  const setArchivedFn = useCallback<UseLetters['setArchived']>(
    async (id, next) => {
      if (userId === null) return
      mutating.current++
      try {
        const result = await letterRepository.setArchived(id, userId, next)
        // The error is set AFTER the reload, not before: load() clears the error
        // whenever both fetches succeed, which would otherwise wipe this one
        // within a render of it being set.
        await load(userId)
        if (result.error !== null) setError(result.error)
      } finally {
        mutating.current--
      }
    },
    [userId, load],
  )

  const deleteForMe = useCallback<UseLetters['deleteForMe']>(
    async (id) => {
      if (userId === null) return
      mutating.current++
      try {
        const result = await letterRepository.deleteForMe(id, userId)
        // The error is set AFTER the reload, not before: load() clears the error
        // whenever both fetches succeed, which would otherwise wipe this one
        // within a render of it being set.
        await load(userId)
        if (result.error !== null) setError(result.error)
      } finally {
        mutating.current--
      }
    },
    [userId, load],
  )

  const setSharedFn = useCallback<UseLetters['setShared']>(
    async (id, shared) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      mutating.current++
      try {
        const result = await letterRepository.setShared(id, shared)
        await load(userId)
        if (result.error !== null) {
          // Deliberately NOT setError: the routes early-return on page-level
          // error, which would replace the letter and the whole grid with one
          // line of text and leave no UI able to clear it. Share failures belong
          // in the toast, per the spec's one-notification-system rule.
          return { ok: false, error: result.error }
        }
        return { ok: true }
      } finally {
        mutating.current--
      }
    },
    [userId, load],
  )

  const editScheduledFn = useCallback<UseLetters['editScheduled']>(
    async (id, message, salutation, bodyFont, scheduledFor) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      mutating.current++
      try {
        const result = await letterRepository.editScheduled(
          id,
          userId,
          message,
          salutation,
          bodyFont,
          scheduledFor,
        )
        if (result.error !== null) return { ok: false, error: result.error }
        await load(userId)
        return { ok: true }
      } finally {
        mutating.current--
      }
    },
    [userId, load],
  )

  return {
    letters,
    archived,
    held,
    scheduled,
    hasBond: partnerId !== null,
    partnerName,
    loading: loading || authLoading,
    error,
    hasMoreLetters,
    loadingMore,
    loadMoreLetters,
    newArrivals,
    clearNewArrivals,
    sendLetter,
    sendHeld: sendHeldFn,
    markRead,
    setArchived: setArchivedFn,
    deleteForMe,
    setShared: setSharedFn,
    editScheduled: editScheduledFn,
    reload,
  }
}
