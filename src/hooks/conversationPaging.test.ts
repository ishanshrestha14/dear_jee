import { describe, it, expect } from 'vitest'
import { spliceConversation, detectPartnerArrivals } from './conversationPaging'
import type { Letter } from '../data/types'

function letter(id: string, senderId: string, overrides: Partial<Letter> = {}): Letter {
  return {
    id,
    senderId,
    receiverId: 'someone',
    message: 'x',
    createdAt: '2026-01-01T00:00:00.000Z',
    isRead: false,
    acknowledgedAt: null,
    shareSlug: null,
    isPublic: false,
    senderName: null,
    receiverName: null,
    salutation: null,
    bodyFont: null,
    senderArchivedAt: null,
    receiverArchivedAt: null,
    senderDeletedAt: null,
    receiverDeletedAt: null,
    bondId: 'bond-1',
    sentAt: null,
    scheduledFor: null,
    ...overrides,
  }
}

describe('spliceConversation', () => {
  it('returns fresh unchanged when there is no boundary yet', () => {
    const fresh = [letter('a', 'p'), letter('b', 'p')]
    expect(spliceConversation(fresh, null, [])).toEqual(fresh)
  })

  it('keeps everything from the boundary onward, untouched', () => {
    const previous = [letter('a', 'p'), letter('b', 'p'), letter('c', 'p'), letter('d', 'p')]
    const fresh = [letter('new', 'p'), letter('a', 'p')] // 'a' refetched identically
    const result = spliceConversation(fresh, { createdAt: previous[1].createdAt, id: 'b' }, previous)
    expect(result.map((l) => l.id)).toEqual(['new', 'a', 'b', 'c', 'd'])
  })

  it('falls back to the whole previous list, deduped, if the boundary letter is gone', () => {
    const previous = [letter('a', 'p'), letter('b', 'p')]
    const fresh = [letter('new', 'p'), letter('a', 'p')]
    const result = spliceConversation(
      fresh,
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'missing' },
      previous,
    )
    expect(result.map((l) => l.id)).toEqual(['new', 'a', 'b'])
  })
})

describe('detectPartnerArrivals', () => {
  it('flags a letter new to the list and written by the partner', () => {
    const previous = [letter('a', 'partner')]
    const fresh = [letter('a', 'partner'), letter('b', 'partner')]
    expect(detectPartnerArrivals(fresh, previous, 'partner').map((l) => l.id)).toEqual(['b'])
  })

  it('ignores a new letter the reader wrote themselves', () => {
    const previous: Letter[] = []
    const fresh = [letter('a', 'me')]
    expect(detectPartnerArrivals(fresh, previous, 'partner')).toEqual([])
  })

  it('ignores a letter that was already loaded', () => {
    const previous = [letter('a', 'partner')]
    const fresh = [letter('a', 'partner')]
    expect(detectPartnerArrivals(fresh, previous, 'partner')).toEqual([])
  })

  it('returns nothing with no partner', () => {
    expect(detectPartnerArrivals([letter('a', 'x')], [], null)).toEqual([])
  })
})
