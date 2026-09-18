// Both people read letters against Nepal time, not UTC or their own device's
// timezone — that's the shared clock the relationship runs on.
const LETTER_TIME_ZONE = 'Asia/Kathmandu'

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
 * while it is still pending, i.e. while `scheduledFor > current_date` was
 * still true, so that deletion always lands strictly before `scheduledFor`.
 * An ordinary post-delivery deletion can only happen once the letter has
 * actually delivered, i.e. once `scheduledFor <= current_date` was already
 * true, so that deletion always lands on or after `scheduledFor`. Comparing
 * the two as `YYYY-MM-DD` strings (`receiverDeletedAt` sliced to its date
 * portion) sorts correctly, the same trick `validateScheduledFor` and
 * `mockRepository`'s `today()` already rely on.
 */
export function cancelledByBondEnding(
  receiverDeletedAt: string | null,
  scheduledFor: string | null,
): boolean {
  if (receiverDeletedAt === null || scheduledFor === null) return false
  return receiverDeletedAt.slice(0, 10) < scheduledFor
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
