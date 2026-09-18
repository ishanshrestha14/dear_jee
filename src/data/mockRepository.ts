import { generateSlug } from '../lib/slug'
import { validateBodyFont, validateLetter, validateSalutation, validateScheduledFor } from '../lib/validation'
import type {
  Bond,
  BondRepository,
  Letter,
  LetterRepository,
  Profile,
  ProfileRepository,
  PublicLetter,
  Result,
  SendLetterInput,
} from './types'

export const MOCK_USER_ID = 'user-jee'
export const MOCK_PARTNER_ID = 'user-love'
export const MOCK_BOND_ID = 'bond-seed'

const ok = <T>(data: T): Result<T> => ({ data, error: null })
const fail = <T>(error: string): Result<T> => ({ data: null, error })

/** Today as `YYYY-MM-DD`, comparable directly against `scheduledFor`. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface MockOptions {
  /** Start with both profiles unlinked, to exercise the joining flow. */
  unlinked?: boolean
}

function seedProfiles(unlinked: boolean): Profile[] {
  return [
    {
      id: MOCK_USER_ID,
      fullName: 'Jee',
      partnerId: unlinked ? null : MOCK_PARTNER_ID,
      inviteCode: 'JEE7K2M',
      createdAt: '2026-01-01T09:00:00.000Z',
    },
    {
      id: MOCK_PARTNER_ID,
      fullName: 'Ishan',
      partnerId: unlinked ? null : MOCK_USER_ID,
      inviteCode: 'ISH4Q9P',
      createdAt: '2026-01-01T09:05:00.000Z',
    },
  ]
}

/**
 * The stored shape, mirroring the bonds TABLE rather than the Bond DTO. The
 * DTO resolves partnerId, partnerName and seenEndAt per caller, so it cannot
 * be what is stored.
 *
 * Named MockBondRow, not BondRow: supabaseRepository.ts has its own snake_case
 * BondRow for the same table, and two same-named types with different casing
 * in neighbouring files is how someone ends up mapping the wrong one.
 */
interface MockBondRow {
  id: string
  lowerId: string | null
  upperId: string | null
  lowerName: string | null
  upperName: string | null
  startedAt: string
  endedAt: string | null
  lowerSeenEndAt: string | null
  upperSeenEndAt: string | null
}

/** Canonical ordering, lower id first — the same rule the SQL uses. */
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function seedBonds(unlinked: boolean): MockBondRow[] {
  if (unlinked) return []
  const [lower, upper] = canonical(MOCK_USER_ID, MOCK_PARTNER_ID)
  return [
    {
      id: MOCK_BOND_ID,
      lowerId: lower,
      upperId: upper,
      lowerName: null,
      upperName: null,
      startedAt: '2026-01-01T09:10:00.000Z',
      endedAt: null,
      lowerSeenEndAt: null,
      upperSeenEndAt: null,
    },
  ]
}

function seedLetters(): Letter[] {
  const base = {
    senderId: MOCK_PARTNER_ID,
    receiverId: MOCK_USER_ID,
    isRead: false,
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
    bondId: MOCK_BOND_ID,
    sentAt: null,
    scheduledFor: null,
  }
  return [
    {
      ...base,
      id: 'letter-1',
      createdAt: '2026-02-14T08:15:00.000Z',
      message:
        'I woke up before the alarm again, and the first thing I did was work out what time it was where you are. Half past four. You were still asleep. I lay there imagining the exact shape of you under that blue blanket, and it was the happiest I have been all week.',
    },
    {
      ...base,
      id: 'letter-2',
      isRead: true,
      createdAt: '2026-02-11T21:40:00.000Z',
      message:
        'You said something on the phone last night that I have not stopped thinking about. That you are not waiting for the distance to end to be happy. I want you to know I heard it. I am not waiting either. I am just very glad it will end.',
    },
    {
      ...base,
      id: 'letter-3',
      isRead: true,
      createdAt: '2026-02-06T13:02:00.000Z',
      message:
        'It rained the whole afternoon and I walked home without an umbrella on purpose, because you once told me you liked the smell of wet pavement. Small silly things keep turning out to be about you.',
    },
  ]
}

/**
 * The mock has no row-level security, so it must apply the delete rule the
 * Supabase policy applies for the real adapter. Without this the two
 * implementations diverge and the contract suite passes on a lie.
 */
function visibleTo(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderDeletedAt === null
  if (l.receiverId === userId) {
    return l.receiverDeletedAt === null && (l.scheduledFor === null || l.scheduledFor <= today())
  }
  return false
}

function isArchivedBy(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderArchivedAt !== null
  if (l.receiverId === userId) return l.receiverArchivedAt !== null
  return false
}

/**
 * In-memory implementation of the repository contracts.
 *
 * This is the only data source in Phases 1 and 2, and it doubles as the
 * fixture for the contract tests, so the suite needs no network.
 */
export function createMockRepositories(options: MockOptions = {}): {
  letters: LetterRepository
  profiles: ProfileRepository
  bonds: BondRepository
} {
  const profiles = seedProfiles(options.unlinked ?? false)
  const letters = seedLetters()
  const bonds = seedBonds(options.unlinked ?? false)

  const findProfile = (id: string) => profiles.find((p) => p.id === id)

  const openBondFor = (userId: string): MockBondRow | undefined =>
    bonds.find((b) => b.endedAt === null && (b.lowerId === userId || b.upperId === userId))

  const bondsFor = (userId: string): MockBondRow[] =>
    bonds
      .filter((b) => b.lowerId === userId || b.upperId === userId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))

  const letterRepository: LetterRepository = {
    async listConversation(userId) {
      // Scoped to the OPEN bond. No bond means no current chapter, which is a
      // real and renderable state, not an error: an unbonded person's home is
      // empty and their held letters are in listHeld.
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      const mine = letters
        .filter(
          (l) =>
            l.bondId === open.id &&
            visibleTo(l, userId) &&
            !isArchivedBy(l, userId) &&
            !(l.senderId === userId && l.scheduledFor !== null && l.scheduledFor > today()),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listArchived(userId) {
      const open = openBondFor(userId)
      if (open === undefined) return ok([])
      const mine = letters
        .filter(
          (l) =>
            l.bondId === open.id &&
            visibleTo(l, userId) &&
            isArchivedBy(l, userId) &&
            !(l.senderId === userId && l.scheduledFor !== null && l.scheduledFor > today()),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listChapter(userId, bondId) {
      // Membership is checked here because the mock has no RLS. The database
      // gets this from bonds_select_member plus letters_select_participant;
      // without this check the two implementations diverge and a chapter id
      // guessed in development would return someone else's letters.
      const bond = bonds.find((b) => b.id === bondId)
      if (bond === undefined) return fail('Chapter not found.')
      if (bond.lowerId !== userId && bond.upperId !== userId) {
        return fail('Chapter not found.')
      }
      const mine = letters
        .filter((l) => l.bondId === bondId && visibleTo(l, userId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listHeld(userId) {
      // A held letter has no receiver, so visibleTo cannot speak for it: the
      // author is the only person who may ever see one. visibleTo still does
      // the senderDeletedAt check that keeps a deleted author's held letters
      // from lingering, matching letters_select_participant in production.
      const mine = letters
        .filter((l) => l.bondId === null && l.senderId === userId && visibleTo(l, userId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listScheduled(userId) {
      // Still in its pending-date window, OR cancelled by a bond ending
      // (receiverDeletedAt set) — either way it never reached, or will
      // never reach, the receiver, so it stays listed here rather than
      // dropping out unlabelled once its date passes.
      const mine = letters
        .filter(
          (l) =>
            l.senderId === userId &&
            l.senderDeletedAt === null &&
            l.scheduledFor !== null &&
            (l.scheduledFor > today() || l.receiverDeletedAt !== null),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async editScheduled(letterId, userId, message, salutation, bodyFont, scheduledFor) {
      const letter = letters.find((l) => l.id === letterId)
      if (letter === undefined) return fail('Letter not found.')
      // Mirrors enforce_letter_update's sender_editing_pending: only the
      // letter's own sender, only while it has not yet delivered, and only
      // while its bond is still open — a letter a bond-ending has already
      // cancelled gains nothing from being rewritten.
      if (
        letter.senderId !== userId ||
        letter.scheduledFor === null ||
        letter.scheduledFor <= today() ||
        letter.receiverDeletedAt !== null
      ) {
        return fail('A sent letter cannot be edited.')
      }
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)
      const salutationCheck = validateSalutation(salutation)
      if (!salutationCheck.ok) return fail(salutationCheck.reason)
      const fontCheck = validateBodyFont(bodyFont)
      if (!fontCheck.ok) return fail(fontCheck.reason)
      const scheduledCheck = validateScheduledFor(scheduledFor)
      if (!scheduledCheck.ok) return fail(scheduledCheck.reason)

      letter.message = message.trim()
      letter.salutation = salutation === null ? null : salutation.trim()
      letter.bodyFont = bodyFont
      letter.scheduledFor = scheduledFor
      return ok({ ...letter })
    },

    async sendHeld(letterId, userId) {
      const letter = letters.find((l) => l.id === letterId)
      if (letter === undefined) return fail('Letter not found.')
      if (letter.senderId !== userId) return fail('Letter not found.')
      // Mirrors the trigger: receiverId is fillable exactly once, from null.
      // The sentAt half matters too: a recipient's account deletion returns
      // receiverId to null via on delete set null, and without this check a
      // delivered letter would re-enter the held window and could be
      // re-sent to a NEW partner while carrying its original date.
      if (letter.receiverId !== null || letter.sentAt !== null) {
        return fail('That letter has already been sent.')
      }
      const open = openBondFor(userId)
      if (open === undefined) return fail('You are not connected to anyone yet.')
      const partner = open.lowerId === userId ? open.upperId : open.lowerId
      if (partner === null) return fail('You are not connected to anyone yet.')
      letter.receiverId = partner
      letter.bondId = open.id
      letter.sentAt = new Date().toISOString()
      // createdAt deliberately untouched: the letter's date is when it was
      // written, which is the entire reason for holding it.
      return ok({ ...letter })
    },

    async setArchived(letterId, userId, archived) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      if (!visibleTo(letter, userId)) return fail('Letter not found.')
      const at = archived ? new Date().toISOString() : null
      if (letter.senderId === userId) letter.senderArchivedAt = at
      else if (letter.receiverId === userId) letter.receiverArchivedAt = at
      else return fail('Letter not found.')
      return ok({ ...letter })
    },

    async deleteForMe(letterId, userId) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      if (!visibleTo(letter, userId)) return fail('Letter not found.')
      const at = new Date().toISOString()
      if (letter.senderId === userId) letter.senderDeletedAt = at
      else if (letter.receiverId === userId) letter.receiverDeletedAt = at
      else return fail('Letter not found.')
      return ok({ ...letter })
    },

    async send({ senderId, receiverId, message, salutation, bodyFont, scheduledFor = null }: SendLetterInput) {
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)
      // The database has check constraints for these three; the mock has
      // none, so it enforces them here or the two implementations disagree
      // about what is a valid letter.
      const salutationCheck = validateSalutation(salutation)
      if (!salutationCheck.ok) return fail(salutationCheck.reason)
      const fontCheck = validateBodyFont(bodyFont)
      if (!fontCheck.ok) return fail(fontCheck.reason)
      const scheduledCheck = validateScheduledFor(scheduledFor)
      if (!scheduledCheck.ok) return fail(scheduledCheck.reason)

      const open = openBondFor(senderId)
      // Mirrors letters_insert_own_to_partner: to a partner when you have
      // one, to nobody when you do not, and never to anyone else.
      if (receiverId === null) {
        if (open !== undefined) return fail('You are connected to someone.')
      } else {
        if (open === undefined) return fail('You are not connected to anyone yet.')
        const partner = open.lowerId === senderId ? open.upperId : open.lowerId
        if (receiverId !== partner) return fail('You can only write to your partner.')
      }

      const now = new Date().toISOString()
      const letter: Letter = {
        id: `letter-${crypto.randomUUID()}`,
        senderId,
        receiverId,
        message: message.trim(),
        createdAt: now,
        isRead: false,
        shareSlug: null,
        isPublic: false,
        senderName: null,
        receiverName: null,
        salutation: salutation === null ? null : salutation.trim(),
        bodyFont,
        senderArchivedAt: null,
        receiverArchivedAt: null,
        senderDeletedAt: null,
        receiverDeletedAt: null,
        bondId: receiverId === null ? null : open!.id,
        sentAt: receiverId === null ? null : now,
        scheduledFor,
      }
      letters.push(letter)
      return ok({ ...letter })
    },

    async markRead(letterId) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      letter.isRead = true
      return ok({ ...letter })
    },

    async setShared(letterId, shared) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      // The slug is generated once and never cleared. Un-sharing only flips
      // isPublic, so sharing again revives the same URL.
      letter.shareSlug = letter.shareSlug ?? generateSlug()
      letter.isPublic = shared
      return ok({ ...letter })
    },

    async getBySlug(slug) {
      // The Supabase adapter gets this filtering from get_public_letter. The
      // mock has no SQL function, so it applies the identical conditions here
      // — otherwise the two implementations diverge and the app behaves one
      // way in development and another in production.
      //
      // Note what is absent: archived letters STILL resolve. Only deletion
      // revokes a link.
      const letter = letters.find(
        (l) =>
          l.shareSlug === slug &&
          l.isPublic &&
          l.senderDeletedAt === null &&
          l.receiverDeletedAt === null &&
          (l.scheduledFor === null || l.scheduledFor <= today()),
      )
      if (!letter) return fail('This letter is not available.')
      const view: PublicLetter = {
        message: letter.message,
        createdAt: letter.createdAt,
        senderName:
          (letter.senderId !== null ? findProfile(letter.senderId)?.fullName : letter.senderName) ||
          'Someone',
        receiverName:
          (letter.receiverId !== null
            ? findProfile(letter.receiverId)?.fullName
            : letter.receiverName) || 'you',
        salutation: letter.salutation,
        bodyFont: letter.bodyFont,
      }
      return ok(view)
    },
  }

  const profileRepository: ProfileRepository = {
    async getById(id) {
      const profile = findProfile(id)
      return profile ? ok({ ...profile }) : fail('Profile not found.')
    },

    async getByInviteCode(inviteCode) {
      const profile = profiles.find((p) => p.inviteCode === inviteCode)
      return profile ? ok({ ...profile }) : fail('That invite link is not valid.')
    },

    async updateName(userId, fullName) {
      const profile = findProfile(userId)
      if (!profile) return fail('Profile not found.')
      const trimmed = fullName.trim()
      if (trimmed.length === 0) return fail('Please enter a name.')
      profile.fullName = trimmed
      return ok({ ...profile })
    },

    async linkPartner(userId, inviteCode) {
      const self = findProfile(userId)
      if (!self) return fail('Profile not found.')
      if (self.partnerId) return fail('You are already connected to someone.')

      const other = profiles.find((p) => p.inviteCode === inviteCode)
      if (!other) return fail('That invite link is not valid.')
      if (other.id === self.id) return fail('That invite link is your own.')
      if (other.partnerId) return fail('That invite link has already been used.')

      // Both sides in one step: the link must not half-apply.
      self.partnerId = other.id
      other.partnerId = self.id
      // Mirrors link_partners: a re-bond of the same pair opens a SECOND row
      // rather than reopening the first, which is what makes a reunion its
      // own chapter.
      const [lower, upper] = canonical(self.id, other.id)
      bonds.push({
        id: `bond-${crypto.randomUUID()}`,
        lowerId: lower,
        upperId: upper,
        lowerName: null,
        upperName: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        lowerSeenEndAt: null,
        upperSeenEndAt: null,
      })
      return ok({ ...self })
    },
  }

  const toBondDto = (row: MockBondRow, userId: string): Bond => {
    const iAmLower = row.lowerId === userId
    const partnerId = iAmLower ? row.upperId : row.lowerId
    const frozen = iAmLower ? row.upperName : row.lowerName
    const live = partnerId === null ? undefined : findProfile(partnerId)?.fullName
    return {
      id: row.id,
      partnerId,
      // Frozen name wins for an ended bond; the live profile answers for the
      // open one. Falls back to '' rather than throwing — a nameless past
      // partner is a renderable state, an exception is not.
      partnerName: frozen ?? live ?? '',
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      seenEndAt: iAmLower ? row.lowerSeenEndAt : row.upperSeenEndAt,
      letterCount: letters.filter((l) => l.bondId === row.id && visibleTo(l, userId))
        .length,
    }
  }

  const bondRepository: BondRepository = {
    async list(userId) {
      return ok(bondsFor(userId).map((row) => toBondDto(row, userId)))
    },

    async unlink(userId) {
      const me = findProfile(userId)
      if (me === undefined) return fail('Profile not found.')
      const open = openBondFor(userId)
      if (open === undefined) return fail('You are not connected to anyone.')
      const otherId = open.lowerId === userId ? open.upperId : open.lowerId
      const other = otherId === null ? undefined : findProfile(otherId)

      const at = new Date().toISOString()
      // Freeze both names BEFORE clearing partnerId, exactly as
      // unlink_partner does: afterwards neither profile can resolve the
      // other, so a chapter with no frozen title would render blank.
      open.endedAt = at
      open.lowerName =
        open.lowerName ?? (open.lowerId === userId ? me.fullName : (other?.fullName ?? ''))
      open.upperName =
        open.upperName ?? (open.upperId === userId ? me.fullName : (other?.fullName ?? ''))

      for (const letter of letters) {
        if (letter.bondId !== open.id) continue
        // Pending and never delivered: cancel it instead of archiving it.
        // Archiving would put it in the sender's own Archive, looking like
        // an ordinary delivered letter instead of one that never arrived.
        // Only the receiver's side is gated, the same column a self-delete
        // already uses — the sender keeps their own copy, and the app
        // tells the two states apart by checking receiverDeletedAt on a
        // letter only its sender can see.
        if (letter.scheduledFor !== null && letter.scheduledFor > today()) {
          letter.receiverDeletedAt ??= at
          continue
        }
        if (letter.senderId !== null) letter.senderArchivedAt ??= at
        if (letter.receiverId !== null) letter.receiverArchivedAt ??= at
        letter.senderName ??= letter.senderId === null ? null : findProfile(letter.senderId)?.fullName ?? null
        letter.receiverName ??= letter.receiverId === null ? null : findProfile(letter.receiverId)?.fullName ?? null
      }

      me.partnerId = null
      me.inviteCode = `${me.inviteCode}-2`
      if (other !== undefined) {
        other.partnerId = null
        other.inviteCode = `${other.inviteCode}-2`
      }
      return ok({ ...me })
    },

    async acknowledgeEnd(userId, bondId) {
      const row = bonds.find((b) => b.id === bondId)
      if (row === undefined) return fail('Chapter not found.')
      if (row.lowerId !== userId && row.upperId !== userId) {
        return fail('Chapter not found.')
      }
      if (row.endedAt === null) return fail('That bond has not ended.')
      const at = new Date().toISOString()
      if (row.lowerId === userId) row.lowerSeenEndAt ??= at
      else row.upperSeenEndAt ??= at
      return ok(undefined)
    },
  }

  return { letters: letterRepository, profiles: profileRepository, bonds: bondRepository }
}
