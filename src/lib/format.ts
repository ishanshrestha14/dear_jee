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
