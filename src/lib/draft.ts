import { validateBodyFont } from './validation'
import type { BodyFont } from './validation'

/**
 * The three methods this module uses, rather than the DOM `Storage` type.
 * Taking storage as an argument is what makes this testable without jsdom —
 * a test passes a plain object.
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * One unfinished letter. Note what is absent: the scheduled date. A date
 * chosen on Tuesday and restored on Friday may already be past, and
 * `validateScheduledFor` would reject it at send — silently losing a picker
 * selection is a smaller harm than silently restoring an invalid one.
 */
export interface LetterDraft {
  message: string
  salutation: string
  bodyFont: BodyFont | null
  /** ISO. Not an expiry — a draft does not rot. Shown in the restore notice. */
  savedAt: string
}

/**
 * Namespaced by user, and the user id is not optional. Two accounts on one
 * device is not hypothetical in an app whose premise is two people: an
 * unkeyed draft would show one person's unsent words to the other on a
 * shared laptop.
 */
export function draftKey(userId: string): string {
  return `dearjee:draft:${userId}`
}

/**
 * Reads, and does not trust what it reads. localStorage is user-writable and
 * outlives deploys, so a stored entry is an untrusted string from an unknown
 * version of this app. Anything that does not match the shape is treated as
 * no draft at all.
 */
export function readDraft(storage: StorageLike, userId: string): LetterDraft | null {
  let raw: string | null
  try {
    raw = storage.getItem(draftKey(userId))
  } catch {
    // A private window, or site data blocked: the safety net silently does
    // not exist. A composer that cannot save must still open.
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.message !== 'string') return null
  if (typeof candidate.salutation !== 'string') return null
  if (typeof candidate.savedAt !== 'string') return null

  const font = candidate.bodyFont
  if (font !== null && typeof font !== 'string') return null
  // Reuses the validator the composer and the database already agree on, so
  // adding a sixth font does not need a second font check kept in step.
  if (!validateBodyFont(font).ok) return null

  return {
    message: candidate.message,
    salutation: candidate.salutation,
    bodyFont: font as BodyFont | null,
    savedAt: candidate.savedAt,
  }
}

export function writeDraft(storage: StorageLike, userId: string, draft: LetterDraft): void {
  try {
    storage.setItem(draftKey(userId), JSON.stringify(draft))
  } catch {
    // Over quota or denied. Nothing to tell the writer: they did not ask for
    // this to happen and cannot act on it.
  }
}

export function clearDraft(storage: StorageLike, userId: string): void {
  try {
    storage.removeItem(draftKey(userId))
  } catch {
    // As above.
  }
}
