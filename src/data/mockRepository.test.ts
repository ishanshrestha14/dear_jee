import { describe, it, expect, beforeEach } from 'vitest'
import { createMockRepositories, MOCK_USER_ID, MOCK_PARTNER_ID } from './mockRepository'
import type { LetterRepository, ProfileRepository } from './types'

let letters: LetterRepository
let profiles: ProfileRepository

beforeEach(() => {
  const repos = createMockRepositories()
  letters = repos.letters
  profiles = repos.profiles
})

describe('listReceived', () => {
  it('returns only letters addressed to the user', async () => {
    const { data } = await letters.listReceived(MOCK_USER_ID)
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((l) => l.receiverId === MOCK_USER_ID)).toBe(true)
  })

  it('orders newest first', async () => {
    const { data } = await letters.listReceived(MOCK_USER_ID)
    const times = data!.map((l) => Date.parse(l.createdAt))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})

describe('send', () => {
  it('stores a letter the receiver can then read', async () => {
    const sent = await letters.send({
      senderId: MOCK_USER_ID,
      receiverId: MOCK_PARTNER_ID,
      message: 'Good morning, you.',
    })
    expect(sent.error).toBeNull()

    const { data } = await letters.listReceived(MOCK_PARTNER_ID)
    expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
  })

  it('starts unread, unshared, and private', async () => {
    const { data } = await letters.send({
      senderId: MOCK_USER_ID,
      receiverId: MOCK_PARTNER_ID,
      message: 'Hello.',
    })
    expect(data!.isRead).toBe(false)
    expect(data!.shareSlug).toBeNull()
    expect(data!.isPublic).toBe(false)
  })

  it('rejects an empty letter without storing anything', async () => {
    const before = (await letters.listReceived(MOCK_PARTNER_ID)).data!.length
    const result = await letters.send({
      senderId: MOCK_USER_ID,
      receiverId: MOCK_PARTNER_ID,
      message: '   ',
    })
    expect(result.data).toBeNull()
    expect(result.error).toBe('A letter needs a few words.')
    expect((await letters.listReceived(MOCK_PARTNER_ID)).data!.length).toBe(before)
  })
})

describe('markRead', () => {
  it('flips isRead and persists it', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const target = inbox!.find((l) => !l.isRead)!
    await letters.markRead(target.id)
    const { data: after } = await letters.listReceived(MOCK_USER_ID)
    expect(after!.find((l) => l.id === target.id)!.isRead).toBe(true)
  })

  it('reports a missing letter rather than throwing', async () => {
    const result = await letters.markRead('does-not-exist')
    expect(result.data).toBeNull()
    expect(result.error).toBe('Letter not found.')
  })
})

describe('share', () => {
  it('makes the letter public and assigns a slug', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const { data } = await letters.share(inbox![0].id)
    expect(data!.isPublic).toBe(true)
    expect(data!.shareSlug).toHaveLength(12)
  })

  it('reuses the slug on a second share so old links keep working', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const first = await letters.share(inbox![0].id)
    const second = await letters.share(inbox![0].id)
    expect(second.data!.shareSlug).toBe(first.data!.shareSlug)
  })
})

describe('getBySlug', () => {
  it('returns only the publicly safe fields', async () => {
    const { data: inbox } = await letters.listReceived(MOCK_USER_ID)
    const shared = await letters.share(inbox![0].id)
    const { data } = await letters.getBySlug(shared.data!.shareSlug!)
    expect(Object.keys(data!).sort()).toEqual([
      'createdAt',
      'message',
      'receiverName',
      'senderName',
    ])
  })

  it('refuses an unknown slug', async () => {
    const result = await letters.getBySlug('nosuchslug12')
    expect(result.data).toBeNull()
    expect(result.error).toBe('This letter is not available.')
  })
})

describe('linkPartner', () => {
  it('links both profiles to each other', async () => {
    const repos = createMockRepositories({ unlinked: true })
    const partner = await repos.profiles.getById(MOCK_PARTNER_ID)
    const linked = await repos.profiles.linkPartner(MOCK_USER_ID, partner.data!.inviteCode)
    expect(linked.data!.partnerId).toBe(MOCK_PARTNER_ID)
    const other = await repos.profiles.getById(MOCK_PARTNER_ID)
    expect(other.data!.partnerId).toBe(MOCK_USER_ID)
  })

  it('refuses an unknown invite code', async () => {
    const repos = createMockRepositories({ unlinked: true })
    const result = await repos.profiles.linkPartner(MOCK_USER_ID, 'BADCODE')
    expect(result.data).toBeNull()
    expect(result.error).toBe('That invite link is not valid.')
  })

  it('refuses to link someone who already has a partner', async () => {
    const partner = await profiles.getById(MOCK_PARTNER_ID)
    const result = await profiles.linkPartner(MOCK_USER_ID, partner.data!.inviteCode)
    expect(result.data).toBeNull()
    expect(result.error).toBe('You are already connected.')
  })

  it('refuses to link a profile to itself', async () => {
    const repos = createMockRepositories({ unlinked: true })
    const self = await repos.profiles.getById(MOCK_USER_ID)
    const result = await repos.profiles.linkPartner(MOCK_USER_ID, self.data!.inviteCode)
    expect(result.data).toBeNull()
    expect(result.error).toBe('That invite link is your own.')
  })
})
