// Both people read letters against Nepal time, not UTC or their own device's
// timezone — that's the shared clock the relationship runs on.
const LETTER_TIME_ZONE = 'Asia/Kathmandu'

// Nepal Time has no daylight saving, so this offset is always correct — no
// timezone library needed anywhere a Kathmandu wall-clock value is produced
// or read back.
const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * 60 * 1000

/**
 * Today's calendar date as observed in Kathmandu right now, `YYYY-MM-DD`.
 * Used as the scheduler's earliest selectable day — plain UTC "today" can
 * be a day behind Kathmandu's for several hours each evening (UTC+5:45), so
 * using UTC here would let someone pick a day that has already started, or
 * technically finished, on the shared clock.
 */
export function todayInKathmandu(): string {
  return new Date(Date.now() + KATHMANDU_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Combines a calendar date and a time-of-day, both understood as Kathmandu
 * wall-clock values (from the scheduler's date picker and time input), into
 * the UTC instant they refer to — what actually gets stored.
 */
export function kathmanduDateTimeToUtcIso(date: string, time: string): string {
  const asIfUtc = Date.parse(`${date}T${time}:00.000Z`)
  return new Date(asIfUtc - KATHMANDU_OFFSET_MS).toISOString()
}

/**
 * The inverse of `kathmanduDateTimeToUtcIso`: reads a stored UTC instant
 * back as the Kathmandu calendar date and time-of-day it displays as, so an
 * edit can pre-fill the picker with what the sender originally chose.
 */
export function utcIsoToKathmanduParts(iso: string): { date: string; time: string } {
  const shifted = new Date(Date.parse(iso) + KATHMANDU_OFFSET_MS).toISOString()
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) }
}

/** Formats an ISO timestamp as the date shown beneath a letter's sign-off. */
export function formatLetterDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: LETTER_TIME_ZONE,
  })
}

/** Formats an ISO timestamp with the exact time, for the open letter view. */
export function formatLetterTimestamp(iso: string): string {
  const date = formatLetterDate(iso)
  const time = new Date(iso).toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: LETTER_TIME_ZONE,
  })
  return `${date} at ${time}`
}

/**
 * True when a scheduled letter's `receiverDeletedAt` means "the bond ended
 * before this could ever arrive," rather than "it arrived, and the receiver
 * later deleted it normally." Both cases set `receiverDeletedAt` — that
 * widening (see `listScheduled`) is what keeps a bond-cancelled letter
 * visible in its sender's Scheduled section after its date has passed — so a
 * plain non-null check can no longer tell them apart.
 *
 * The discriminator is timing: `unlink_partner` can only cancel a letter
 * while it is still pending, i.e. while `scheduledFor > now()` was still
 * true, so that deletion always lands strictly before `scheduledFor`. An
 * ordinary post-delivery deletion can only happen once the letter has
 * actually delivered, i.e. once `scheduledFor <= now()` was already true,
 * so that deletion always lands on or after `scheduledFor`. Both are full
 * ISO instants now, so a plain chronological comparison (via `Date.parse`,
 * not string comparison — the two values are not guaranteed the same
 * string width) settles it directly.
 */
export function cancelledByBondEnding(
  receiverDeletedAt: string | null,
  scheduledFor: string | null,
): boolean {
  if (receiverDeletedAt === null || scheduledFor === null) return false
  return Date.parse(receiverDeletedAt) < Date.parse(scheduledFor)
}

/**
 * Produces a single-line preview of a letter body, cut at a word boundary
 * so the inbox never shows a word sliced in half.
 */
export function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat

  const cut = flat.slice(0, max)
  // If the cut landed exactly on a space, it is already a clean boundary
  // and trimming back to the previous space would drop a whole word.
  if (flat[max] === ' ') return `${cut.trimEnd()}…`

  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
