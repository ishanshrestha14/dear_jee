import { describe, it, expect, beforeEach } from 'vitest'
import type { BondRepository, LetterRepository, ProfileRepository } from './types'

/** Everything a contract run needs from one repository implementation. */
export interface ContractFixture {
  letters: LetterRepository
  profiles: ProfileRepository
  bonds: BondRepository
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

    describe('setShared', () => {
      it('publishes the letter and assigns a slug', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const { data } = await fx.letters.setShared(inbox![0].id, true)
        expect(data!.isPublic).toBe(true)
        expect(data!.shareSlug).toHaveLength(12)
      })

      it('reuses the slug on a second share so old links keep working', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const first = await fx.letters.setShared(inbox![0].id, true)
        const second = await fx.letters.setShared(inbox![0].id, true)
        expect(second.data!.shareSlug).toBe(first.data!.shareSlug)
      })

      it('un-sharing keeps the slug so the same URL can come back', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const shared = await fx.letters.setShared(inbox![0].id, true)
        const off = await fx.letters.setShared(inbox![0].id, false)
        expect(off.data!.isPublic).toBe(false)
        expect(off.data!.shareSlug).toBe(shared.data!.shareSlug)

        const on = await fx.letters.setShared(inbox![0].id, true)
        expect(on.data!.shareSlug).toBe(shared.data!.shareSlug)
      })

      it('reports a missing letter rather than throwing', async () => {
        const result = await fx.letters.setShared(
          '00000000-0000-4000-8000-000000000000',
          true,
        )
        expect(result.data).toBeNull()
        expect(result.error).toBe('Letter not found.')
      })
    })

    describe('getBySlug', () => {
      it('returns only the publicly safe fields', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const shared = await fx.letters.setShared(inbox![0].id, true)
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

      it('stops resolving once the letter is un-shared', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const shared = await fx.letters.setShared(inbox![0].id, true)
        const slug = shared.data!.shareSlug!
        await fx.letters.setShared(inbox![0].id, false)

        const result = await fx.letters.getBySlug(slug)
        expect(result.data).toBeNull()
        expect(result.error).toBe('This letter is not available.')
      })

      it('stops resolving when the RECEIVER deletes it', async () => {
        // Every seeded letter has fx.userId as receiver, so deleting here sets
        // receiverDeletedAt alone.
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const target = inbox![0]
        const shared = await fx.letters.setShared(target.id, true)
        const slug = shared.data!.shareSlug!
        await fx.letters.deleteForMe(target.id, fx.userId)

        const result = await fx.letters.getBySlug(slug)
        expect(result.data).toBeNull()
        expect(result.error).toBe('This letter is not available.')
      })

      it('stops resolving when the SENDER deletes it', async () => {
        // The other half of "either person". Without this case an
        // implementation that checks only receiverDeletedAt passes the one
        // above while leaving the sender unable to revoke a link to their own
        // letter — and the suite would report that as correct.
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Shared, then withdrawn.',
        })
        const shared = await fx.letters.setShared(sent.data!.id, true)
        const slug = shared.data!.shareSlug!
        await fx.letters.deleteForMe(sent.data!.id, fx.userId)

        const result = await fx.letters.getBySlug(slug)
        expect(result.data).toBeNull()
        expect(result.error).toBe('This letter is not available.')
      })

      it('KEEPS resolving when the letter is merely archived', async () => {
        const { data: inbox } = await fx.letters.listConversation(fx.userId)
        const target = inbox![0]
        const shared = await fx.letters.setShared(target.id, true)
        const slug = shared.data!.shareSlug!
        await fx.letters.setArchived(target.id, fx.userId, true)

        // Unlinking archives the whole correspondence, so revoking on archive
        // would mean a breakup silently broke every link ever sent.
        const { data } = await fx.letters.getBySlug(slug)
        expect(data).not.toBeNull()
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

    describe('bonds', () => {
      it('reports one open bond for a linked pair', async () => {
        const result = await fx.bonds.list(fx.userId)
        expect(result.error).toBe(null)
        expect(result.data).not.toBe(null)
        const open = result.data!.filter((b) => b.endedAt === null)
        expect(open).toHaveLength(1)
        expect(open[0].partnerId).toBe(fx.partnerId)
      })

      it('reports no bond at all for an unlinked account', async () => {
        const solo = await fx.unlinked()
        const result = await solo.bonds.list(solo.userId)
        expect(result.error).toBe(null)
        expect(result.data).toEqual([])
      })

      it('unlinking closes the bond and frees both sides', async () => {
        const unlinked = await fx.bonds.unlink(fx.userId)
        expect(unlinked.error).toBe(null)
        expect(unlinked.data!.partnerId).toBe(null)

        const mine = await fx.profiles.getById(fx.userId)
        const theirs = await fx.profiles.getById(fx.partnerId)
        expect(mine.data!.partnerId).toBe(null)
        expect(theirs.data!.partnerId).toBe(null)

        const bonds = await fx.bonds.list(fx.userId)
        expect(bonds.data!.filter((b) => b.endedAt === null)).toHaveLength(0)
        expect(bonds.data!).toHaveLength(1)
      })

      it('unlinking issues both people a fresh invite code', async () => {
        const before = (await fx.profiles.getById(fx.userId)).data!.inviteCode
        const beforeTheirs = (await fx.profiles.getById(fx.partnerId)).data!.inviteCode
        await fx.bonds.unlink(fx.userId)
        const after = (await fx.profiles.getById(fx.userId)).data!.inviteCode
        const afterTheirs = (await fx.profiles.getById(fx.partnerId)).data!.inviteCode
        expect(after).not.toBe(before)
        expect(afterTheirs).not.toBe(beforeTheirs)
      })

      it('unlinking moves the whole correspondence out of the current chapter', async () => {
        const before = await fx.letters.listConversation(fx.userId)
        expect(before.data!.length).toBeGreaterThan(0)
        await fx.bonds.unlink(fx.userId)
        const after = await fx.letters.listConversation(fx.userId)
        expect(after.data).toEqual([])
      })

      it('a past chapter keeps its letters and its partner name', async () => {
        await fx.bonds.unlink(fx.userId)
        const bonds = await fx.bonds.list(fx.userId)
        const past = bonds.data![0]
        expect(past.endedAt).not.toBe(null)
        expect(past.partnerName).not.toBe('')
        expect(past.letterCount).toBeGreaterThan(0)

        const chapter = await fx.letters.listChapter(fx.userId, past.id)
        expect(chapter.error).toBe(null)
        expect(chapter.data!.length).toBe(past.letterCount)
      })

      it('refuses to unlink someone who has no bond', async () => {
        const solo = await fx.unlinked()
        const result = await solo.bonds.unlink(solo.userId)
        expect(result.error).not.toBe(null)
      })

      it('re-bonding the same person opens a distinct chapter', async () => {
        await fx.bonds.unlink(fx.userId)
        const theirs = (await fx.profiles.getById(fx.partnerId)).data!
        const relinked = await fx.profiles.linkPartner(fx.userId, theirs.inviteCode)
        expect(relinked.error).toBe(null)

        const bonds = await fx.bonds.list(fx.userId)
        expect(bonds.data!).toHaveLength(2)
        expect(bonds.data!.filter((b) => b.endedAt === null)).toHaveLength(1)
        const ids = new Set(bonds.data!.map((b) => b.id))
        expect(ids.size).toBe(2)
      })

      it('a letter from the old chapter never reappears in the new one', async () => {
        const original = (await fx.letters.listConversation(fx.userId)).data!
        expect(original.length).toBeGreaterThan(0)
        await fx.bonds.unlink(fx.userId)
        const theirs = (await fx.profiles.getById(fx.partnerId)).data!
        await fx.profiles.linkPartner(fx.userId, theirs.inviteCode)

        const now = await fx.letters.listConversation(fx.userId)
        expect(now.data).toEqual([])
        const archived = await fx.letters.listArchived(fx.userId)
        expect(archived.data).toEqual([])
      })

      it('acknowledging the end stops the notice for that user only', async () => {
        await fx.bonds.unlink(fx.userId)
        const past = (await fx.bonds.list(fx.userId)).data![0]
        expect(past.seenEndAt).toBe(null)

        const ack = await fx.bonds.acknowledgeEnd(fx.userId, past.id)
        expect(ack.error).toBe(null)

        const mine = (await fx.bonds.list(fx.userId)).data![0]
        expect(mine.seenEndAt).not.toBe(null)
        const theirs = (await fx.bonds.list(fx.partnerId)).data![0]
        expect(theirs.seenEndAt).toBe(null)
      })
    })
  })
}
