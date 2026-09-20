import type { Letter, LetterCursor } from '../data/types'

/**
 * Splices a freshly refetched prefix onto the tail that loadMoreLetters
 * appended earlier and that a poll or a mutation must leave untouched — see
 * the infinite-scroll spec's "frozen boundary" decision. Refetching a fixed-
 * width window instead (e.g. always "the newest 30") would let a letter fall
 * through the seam whenever new ones arrive while pages are loaded: the
 * refreshed prefix and the already-appended tail would no longer meet
 * exactly where they used to.
 *
 * Deduping by id is cheap insurance against the one edge case where the
 * boundary letter itself was archived or deleted out from under it, which
 * would otherwise make where `tail` starts ambiguous.
 */
export function spliceConversation(
  fresh: Letter[],
  boundary: LetterCursor | null,
  previous: Letter[],
): Letter[] {
  if (boundary === null) return fresh
  const boundaryIndex = previous.findIndex((l) => l.id === boundary.id)
  const tail = boundaryIndex === -1 ? previous : previous.slice(boundaryIndex)
  const freshIds = new Set(fresh.map((l) => l.id))
  return [...fresh, ...tail.filter((l) => !freshIds.has(l.id))]
}

/**
 * Letters in `fresh` that are new since `previous` AND written by the
 * partner — never the reader's own letter, including their own scheduled
 * letter delivering itself while their tab happens to be open. A toast
 * announcing your own letter to yourself would read as a bug, not a
 * feature.
 */
export function detectPartnerArrivals(
  fresh: Letter[],
  previous: Letter[],
  partnerId: string | null,
): Letter[] {
  if (partnerId === null) return []
  const previousIds = new Set(previous.map((l) => l.id))
  return fresh.filter((l) => l.senderId === partnerId && !previousIds.has(l.id))
}
