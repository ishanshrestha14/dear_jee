import { describe, it, expect, beforeEach, vi } from 'vitest'
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
          salutation: null,
          bodyFont: null,
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
          salutation: null,
          bodyFont: null,
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
          salutation: null,
          bodyFont: null,
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
          salutation: null,
          bodyFont: null,
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
          salutation: null,
          bodyFont: null,
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
          salutation: null,
          bodyFont: null,
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
          salutation: null,
          bodyFont: null,
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
          'bodyFont',
          'createdAt',
          'message',
          'receiverName',
          'salutation',
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
          salutation: null,
          bodyFont: null,
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

    describe('held letters', () => {
      it('an unbonded author can write one, and only they can see it', async () => {
        const solo = await fx.unlinked()
        const written = await solo.letters.send({
          senderId: solo.userId,
          receiverId: null,
          message: 'Dear whoever you turn out to be,',
          salutation: null,
          bodyFont: null,
        })
        expect(written.error).toBe(null)
        expect(written.data!.receiverId).toBe(null)
        expect(written.data!.bondId).toBe(null)
        expect(written.data!.sentAt).toBe(null)

        const held = await solo.letters.listHeld(solo.userId)
        expect(held.data!).toHaveLength(1)

        const other = await solo.letters.listHeld(solo.partnerId)
        expect(other.data!).toEqual([])
      })

      it('a held letter is in no chapter', async () => {
        const solo = await fx.unlinked()
        await solo.letters.send({
          senderId: solo.userId,
          receiverId: null,
          message: 'Not sent yet.',
          salutation: null,
          bodyFont: null,
        })
        const current = await solo.letters.listConversation(solo.userId)
        expect(current.data).toEqual([])
        const archived = await solo.letters.listArchived(solo.userId)
        expect(archived.data).toEqual([])
      })

      it('a bonded author cannot write one', async () => {
        const result = await fx.letters.send({
          senderId: fx.userId,
          receiverId: null,
          message: 'Should be refused.',
          salutation: null,
          bodyFont: null,
        })
        expect(result.error).not.toBe(null)
      })

      it('sending one keeps the date it was written', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Written long before it was sent.',
            salutation: null,
            bodyFont: null,
          })
        ).data!

        const theirs = (await solo.profiles.getById(solo.partnerId)).data!
        await solo.profiles.linkPartner(solo.userId, theirs.inviteCode)

        const sent = await solo.letters.sendHeld(written.id, solo.userId)
        expect(sent.error).toBe(null)
        expect(sent.data!.createdAt).toBe(written.createdAt)
        expect(sent.data!.sentAt).not.toBe(null)
        expect(sent.data!.receiverId).toBe(solo.partnerId)
        expect(sent.data!.bondId).not.toBe(null)
      })

      it('a sent held letter joins the current chapter and leaves the held list', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'On its way at last.',
            salutation: null,
            bodyFont: null,
          })
        ).data!
        const theirs = (await solo.profiles.getById(solo.partnerId)).data!
        await solo.profiles.linkPartner(solo.userId, theirs.inviteCode)
        await solo.letters.sendHeld(written.id, solo.userId)

        const held = await solo.letters.listHeld(solo.userId)
        expect(held.data).toEqual([])
        const current = await solo.letters.listConversation(solo.userId)
        expect(current.data!.map((l) => l.id)).toContain(written.id)
      })

      it('refuses a second send of the same letter', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Only once.',
            salutation: null,
            bodyFont: null,
          })
        ).data!
        const theirs = (await solo.profiles.getById(solo.partnerId)).data!
        await solo.profiles.linkPartner(solo.userId, theirs.inviteCode)

        expect((await solo.letters.sendHeld(written.id, solo.userId)).error).toBe(null)
        expect((await solo.letters.sendHeld(written.id, solo.userId)).error).not.toBe(null)
      })

      it('refuses to send when the author has no bond', async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Nobody to send it to.',
            salutation: null,
            bodyFont: null,
          })
        ).data!
        const result = await solo.letters.sendHeld(written.id, solo.userId)
        expect(result.error).not.toBe(null)
      })

      it("refuses to send someone else's held letter", async () => {
        const solo = await fx.unlinked()
        const written = (
          await solo.letters.send({
            senderId: solo.userId,
            receiverId: null,
            message: 'Mine alone.',
            salutation: null,
            bodyFont: null,
          })
        ).data!
        const theirs = (await solo.profiles.getById(solo.partnerId)).data!
        await solo.profiles.linkPartner(solo.userId, theirs.inviteCode)

        const result = await solo.letters.sendHeld(written.id, solo.partnerId)
        expect(result.error).not.toBe(null)

        const held = await solo.letters.listHeld(solo.userId)
        expect(held.data!.map((l) => l.id)).toContain(written.id)
        const stillHeld = held.data!.find((l) => l.id === written.id)!
        expect(stillHeld.receiverId).toBe(null)
        expect(stillHeld.sentAt).toBe(null)
      })
    })

    describe('scheduled delivery', () => {
      function daysFromNow(n: number): string {
        return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      }

      it('is invisible to the receiver before its date', async () => {
        const future = daysFromNow(7)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'A letter for later.',
          salutation: null,
          bodyFont: null,
          scheduledFor: future,
        })
        expect(sent.error).toBeNull()

        // fx.userId is the sender; a fresh unlinked-then-relinked fixture has
        // no separate "log in as the partner" call, so this checks the
        // receiver's own read path the same way listScheduled below checks
        // the sender's — via listConversation, which the receiver would use.
        const { data } = await fx.letters.listConversation(fx.partnerId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(false)
      })

      it('appears to the receiver once its date arrives', async () => {
        const today = daysFromNow(0)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Arriving today.',
          salutation: null,
          bodyFont: null,
          scheduledFor: today,
        })
        const { data } = await fx.letters.listConversation(fx.partnerId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('is excluded from the sender\'s own listConversation while pending', async () => {
        const future = daysFromNow(7)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Not in the grid yet.',
          salutation: null,
          bodyFont: null,
          scheduledFor: future,
        })
        const { data } = await fx.letters.listConversation(fx.userId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(false)
      })

      it('listScheduled returns the sender\'s own pending letters', async () => {
        const future = daysFromNow(7)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'On the list.',
          salutation: null,
          bodyFont: null,
          scheduledFor: future,
        })
        const { data } = await fx.letters.listScheduled(fx.userId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('editScheduled rewrites a pending letter', async () => {
        const future = daysFromNow(7)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Original wording.',
          salutation: null,
          bodyFont: null,
          scheduledFor: future,
        })
        const laterStill = daysFromNow(14)
        const edited = await fx.letters.editScheduled(
          sent.data!.id,
          fx.userId,
          'Rewritten wording.',
          'darling',
          'caveat',
          laterStill,
        )
        expect(edited.error).toBeNull()
        expect(edited.data!.message).toBe('Rewritten wording.')
        expect(edited.data!.salutation).toBe('darling')
        expect(edited.data!.bodyFont).toBe('caveat')
        expect(edited.data!.scheduledFor).toBe(laterStill)
      })

      it('editScheduled refuses a letter that has already delivered', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Already sent.',
          salutation: null,
          bodyFont: null,
        })
        const result = await fx.letters.editScheduled(
          sent.data!.id,
          fx.userId,
          'Trying to rewrite it.',
          null,
          null,
          null,
        )
        expect(result.error).toBe('A sent letter cannot be edited.')
      })

      it('editScheduled refuses anyone but the letter\'s own sender', async () => {
        const future = daysFromNow(7)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Not yours to rewrite.',
          salutation: null,
          bodyFont: null,
          scheduledFor: future,
        })
        const result = await fx.letters.editScheduled(
          sent.data!.id,
          fx.partnerId,
          'Trying to rewrite someone else\'s letter.',
          null,
          null,
          future,
        )
        expect(result.error).toBe('A sent letter cannot be edited.')
      })

      it('cancels a pending letter when the bond it was scheduled for ends, keeping the sender\'s own view', async () => {
        const future = daysFromNow(7)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Never arrives.',
          salutation: null,
          bodyFont: null,
          scheduledFor: future,
        })
        await fx.bonds.unlink(fx.userId)

        const { data: scheduled } = await fx.letters.listScheduled(fx.userId)
        const cancelled = scheduled!.find((l) => l.id === sent.data!.id)
        expect(cancelled).toBeDefined()
        expect(cancelled!.receiverDeletedAt).not.toBeNull()
      })

      it('a delivered scheduled letter can still be marked read and archived', async () => {
        // Regression: a CHECK constraint re-validated on every update used to
        // raise once scheduled_for was in the past, breaking markRead and
        // setArchived on any letter that had already delivered. The rule now
        // lives in the update trigger, gated to only fire when a client is
        // actually changing scheduled_for — an unrelated column update on an
        // already-delivered letter must succeed.
        const today = daysFromNow(0)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Arrived, and now just an ordinary letter.',
          salutation: null,
          bodyFont: null,
          scheduledFor: today,
        })
        expect(sent.error).toBeNull()

        const read = await fx.letters.markRead(sent.data!.id)
        expect(read.error).toBeNull()
        expect(read.data!.isRead).toBe(true)

        const archived = await fx.letters.setArchived(sent.data!.id, fx.partnerId, true)
        expect(archived.error).toBeNull()
      })

      it('a bond-cancelled letter keeps showing in listScheduled once its date passes', async () => {
        // Regression: listScheduled used to filter on `scheduledFor > today`,
        // so a bond-cancelled letter (receiverDeletedAt set, but never
        // delivered) dropped off the list the moment its date arrived,
        // resurfacing unlabelled among ordinary past letters instead. This
        // needs the cancellation to happen while the date is still in the
        // future (so unlink's own `scheduledFor > current_date` check fires
        // and sets receiverDeletedAt) and THEN for time to pass the date —
        // hence the fake clock, rather than a same-day scheduledFor.
        vi.useFakeTimers()
        try {
          vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
          const sent = await fx.letters.send({
            senderId: fx.userId,
            receiverId: fx.partnerId,
            message: 'Cancelled, and its date will pass.',
            salutation: null,
            bodyFont: null,
            scheduledFor: '2026-06-03',
          })
          await fx.bonds.unlink(fx.userId)

          vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'))
          const { data: scheduled } = await fx.letters.listScheduled(fx.userId)
          const cancelled = scheduled!.find((l) => l.id === sent.data!.id)
          expect(cancelled).toBeDefined()
          expect(cancelled!.receiverDeletedAt).not.toBeNull()
        } finally {
          vi.useRealTimers()
        }
      })

      it('editScheduled refuses a bond-cancelled letter even while nominally still pending', async () => {
        // Regression: only ownership and delivery were enforced, not
        // "the bond is still open" — a letter the bond-ending already
        // cancelled (receiverDeletedAt set) was still rewritable through
        // editScheduled as long as its date had not yet arrived.
        const future = daysFromNow(7)
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Still pending by date, but the bond just ended.',
          salutation: null,
          bodyFont: null,
          scheduledFor: future,
        })
        await fx.bonds.unlink(fx.userId)

        const result = await fx.letters.editScheduled(
          sent.data!.id,
          fx.userId,
          'Trying to rewrite a cancelled letter.',
          null,
          null,
          future,
        )
        expect(result.error).toBe('A sent letter cannot be edited.')
      })
    })

    describe('salutation and face', () => {
      it('stores and returns both', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Written in a particular hand.',
          salutation: 'my love',
          bodyFont: 'courier-prime',
        })
        expect(sent.error).toBe(null)
        expect(sent.data!.salutation).toBe('my love')
        expect(sent.data!.bodyFont).toBe('courier-prime')
      })

      it('accepts null for both, which is how older letters read', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Plain, like the ones before.',
          salutation: null,
          bodyFont: null,
        })
        expect(sent.error).toBe(null)
        expect(sent.data!.salutation).toBe(null)
        expect(sent.data!.bodyFont).toBe(null)
      })

      it('leaves the seeded letters untouched', async () => {
        const existing = await fx.letters.listConversation(fx.userId)
        expect(existing.error).toBe(null)
        for (const letter of existing.data!) {
          expect(letter.salutation).toBe(null)
          expect(letter.bodyFont).toBe(null)
        }
      })

      it('refuses a font outside the published set', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Should not send.',
          salutation: null,
          bodyFont: 'comic-sans' as never,
        })
        expect(sent.error).not.toBe(null)
      })

      it('refuses a salutation longer than the column allows', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Should not send.',
          salutation: 'a'.repeat(61),
          bodyFont: null,
        })
        expect(sent.error).not.toBe(null)
      })

      it('a shared letter carries both to the public view', async () => {
        const sent = (
          await fx.letters.send({
            senderId: fx.userId,
            receiverId: fx.partnerId,
            message: 'For anyone with the link.',
            salutation: 'dearest',
            bodyFont: 'dancing-script',
          })
        ).data!
        await fx.letters.setShared(sent.id, true)
        const reread = (await fx.letters.listConversation(fx.userId)).data!.find(
          (l) => l.id === sent.id,
        )!
        const view = await fx.letters.getBySlug(reread.shareSlug!)
        expect(view.error).toBe(null)
        expect(view.data!.salutation).toBe('dearest')
        expect(view.data!.bodyFont).toBe('dancing-script')
      })
    })
  })
}
