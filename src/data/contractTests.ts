import { describe, it, expect, beforeEach } from 'vitest'
import type { LetterRepository, ProfileRepository } from './types'

/** Everything a contract run needs from one repository implementation. */
export interface ContractFixture {
  letters: LetterRepository
  profiles: ProfileRepository
  userId: string
  partnerId: string
  /** A second, unlinked pair, for the partner-linking cases. */
  unlinked: () => Promise<ContractFixture>
}

export type ContractSetup = () => Promise<ContractFixture>

/**
 * The behavioural contract every repository implementation must satisfy.
 *
 * Phase 2's mock and Phase 3's Supabase adapter both run this identical
 * suite, which is the only way the swap-in claim is actually verified
 * rather than assumed.
 */
export function describeRepositoryContract(name: string, setup: ContractSetup): void {
  describe(`${name} — repository contract`, () => {
    let fx: ContractFixture

    beforeEach(async () => {
      fx = await setup()
    })

    describe('listConversation', () => {
      it('returns letters the user received', async () => {
        const { data } = await fx.letters.listConversation(fx.userId)
        expect(data!.length).toBeGreaterThan(0)
        expect(data!.some((l) => l.receiverId === fx.userId)).toBe(true)
      })

      it('also returns letters the user SENT', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Something I wrote.',
        })
        const { data } = await fx.letters.listConversation(fx.userId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('orders newest first', async () => {
        const { data } = await fx.letters.listConversation(fx.userId)
        const times = data!.map((l) => Date.parse(l.createdAt))
        expect([...times].sort((a, b) => b - a)).toEqual(times)
      })

      it('excludes letters this user archived', async () => {
        const { data: before } = await fx.letters.listConversation(fx.userId)
        const target = before![0]
        await fx.letters.setArchived(target.id, fx.userId, true)
        const { data: after } = await fx.letters.listConversation(fx.userId)
        expect(after!.some((l) => l.id === target.id)).toBe(false)
      })
    })

    describe('send', () => {
      it('stores a letter the receiver can then read', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Good morning, you.',
        })
        expect(sent.error).toBeNull()

        const { data } = await fx.letters.listConversation(fx.partnerId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('starts unread, unshared, and private', async () => {
        const { data } = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Hello.',
        })
        expect(data!.isRead).toBe(false)
        expect(data!.shareSlug).toBeNull()
        expect(data!.isPublic).toBe(false)
      })

      it('rejects an empty letter without storing anything', async () => {
        const before = (await fx.letters.listConversation(fx.partnerId)).data!.length
        const result = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: '   ',
        })
        expect(result.data).toBeNull()
        expect(result.error).toBe('A letter needs a few words.')
        expect((await fx.letters.listConversation(fx.partnerId)).data!.length).toBe(before)
      })
    })

    describe('markRead', () => {
      it('flips isRead and persists it', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const target = inbox!.find((l) => !l.isRead)!
        await fx.letters.markRead(target.id)
        const { data: after } = await fx.letters.listConversation(fx.userId)
        expect(after!.find((l) => l.id === target.id)!.isRead).toBe(true)
      })

      it('reports a missing letter rather than throwing', async () => {
        const result = await fx.letters.markRead('00000000-0000-4000-8000-000000000000')
        expect(result.data).toBeNull()
        expect(result.error).toBe('Letter not found.')
      })
    })

    describe('archive', () => {
      it('moves the letter to the archive listing', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const target = inbox![0]
        await fx.letters.setArchived(target.id, fx.userId, true)
        const { data: archived } = await fx.letters.listArchived(fx.userId)
        expect(archived!.some((l) => l.id === target.id)).toBe(true)
      })

      it('is reversible', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const target = inbox![0]
        await fx.letters.setArchived(target.id, fx.userId, true)
        await fx.letters.setArchived(target.id, fx.userId, false)
        const { data: after } = await fx.letters.listConversation(fx.userId)
        expect(after!.some((l) => l.id === target.id)).toBe(true)
      })

      it('does NOT archive it for the other person', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Still yours.',
        })
        await fx.letters.setArchived(sent.data!.id, fx.userId, true)
        const { data: theirs } = await fx.letters.listConversation(fx.partnerId)
        expect(theirs!.some((l) => l.id === sent.data!.id)).toBe(true)
      })
    })

    describe('deleteForMe', () => {
      it('removes the letter from this user only', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Gone from my side.',
        })
        await fx.letters.deleteForMe(sent.data!.id, fx.userId)

        const { data: mine } = await fx.letters.listConversation(fx.userId)
        expect(mine!.some((l) => l.id === sent.data!.id)).toBe(false)

        const { data: theirs } = await fx.letters.listConversation(fx.partnerId)
        expect(theirs!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('removes it from the archive as well, when it was archived', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Not in the archive either.',
        })
        // Archive FIRST. Deleting a letter that was never archived and then
        // asserting it is absent from the archive is a tautology — it would
        // pass against a deleteForMe that did nothing at all. Archiving first
        // is what makes this test the interaction it claims to be.
        await fx.letters.setArchived(sent.data!.id, fx.userId, true)
        const { data: before } = await fx.letters.listArchived(fx.userId)
        expect(before!.some((l) => l.id === sent.data!.id)).toBe(true)

        await fx.letters.deleteForMe(sent.data!.id, fx.userId)
        const { data: archived } = await fx.letters.listArchived(fx.userId)
        expect(archived!.some((l) => l.id === sent.data!.id)).toBe(false)
      })

      it('reports a missing letter rather than throwing', async () => {
        const result = await fx.letters.deleteForMe(
          '00000000-0000-4000-8000-000000000000',
          fx.userId,
        )
        expect(result.data).toBeNull()
        expect(result.error).toBe('Letter not found.')
      })
    })

    describe('share', () => {
      it('makes the letter public and assigns a slug', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const { data } = await fx.letters.share(inbox![0].id)
        expect(data!.isPublic).toBe(true)
        expect(data!.shareSlug).toHaveLength(12)
      })

      it('reuses the slug on a second share so old links keep working', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const first = await fx.letters.share(inbox![0].id)
        const second = await fx.letters.share(inbox![0].id)
        expect(second.data!.shareSlug).toBe(first.data!.shareSlug)
      })
    })

    describe('getBySlug', () => {
      it('returns only the publicly safe fields', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const shared = await fx.letters.share(inbox![0].id)
        const { data } = await fx.letters.getBySlug(shared.data!.shareSlug!)
        expect(Object.keys(data!).sort()).toEqual([
          'createdAt',
          'message',
          'receiverName',
          'senderName',
        ])
      })

      it('refuses an unknown slug', async () => {
        const result = await fx.letters.getBySlug('nosuchslug12')
        expect(result.data).toBeNull()
        expect(result.error).toBe('This letter is not available.')
      })
    })

    describe('linkPartner', () => {
      it('links both profiles to each other', async () => {
        const u = await fx.unlinked()
        const partner = await u.profiles.getById(u.partnerId)
        const linked = await u.profiles.linkPartner(u.userId, partner.data!.inviteCode)
        expect(linked.data!.partnerId).toBe(u.partnerId)
        const other = await u.profiles.getById(u.partnerId)
        expect(other.data!.partnerId).toBe(u.userId)
      })

      it('refuses an unknown invite code', async () => {
        const u = await fx.unlinked()
        const result = await u.profiles.linkPartner(u.userId, 'BADCODE')
        expect(result.data).toBeNull()
        expect(result.error).toBe('That invite link is not valid.')
      })

      it('refuses to link someone who already has a partner', async () => {
        const partner = await fx.profiles.getById(fx.partnerId)
        const result = await fx.profiles.linkPartner(fx.userId, partner.data!.inviteCode)
        expect(result.data).toBeNull()
        expect(result.error).toBe('You are already connected to someone.')
      })

      it('refuses to link a profile to itself', async () => {
        const u = await fx.unlinked()
        const self = await u.profiles.getById(u.userId)
        const result = await u.profiles.linkPartner(u.userId, self.data!.inviteCode)
        expect(result.data).toBeNull()
        expect(result.error).toBe('That invite link is your own.')
      })
    })
  })
}
