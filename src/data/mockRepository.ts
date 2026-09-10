import { generateSlug } from '../lib/slug'
import { validateLetter } from '../lib/validation'
import type {
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

const ok = <T>(data: T): Result<T> => ({ data, error: null })
const fail = <T>(error: string): Result<T> => ({ data: null, error })

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

function seedLetters(): Letter[] {
  const base = {
    senderId: MOCK_PARTNER_ID,
    receiverId: MOCK_USER_ID,
    isRead: false,
    shareSlug: null,
    isPublic: false,
    senderName: null,
    receiverName: null,
    senderArchivedAt: null,
    receiverArchivedAt: null,
    senderDeletedAt: null,
    receiverDeletedAt: null,
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
  if (l.receiverId === userId) return l.receiverDeletedAt === null
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
} {
  const profiles = seedProfiles(options.unlinked ?? false)
  const letters = seedLetters()

  const findProfile = (id: string) => profiles.find((p) => p.id === id)

  const letterRepository: LetterRepository = {
    async listConversation(userId) {
      const mine = letters
        .filter((l) => visibleTo(l, userId) && !isArchivedBy(l, userId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
    },

    async listArchived(userId) {
      const mine = letters
        .filter((l) => visibleTo(l, userId) && isArchivedBy(l, userId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(mine.map((l) => ({ ...l })))
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

    async send({ senderId, receiverId, message }: SendLetterInput) {
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)

      const letter: Letter = {
        id: `letter-${crypto.randomUUID()}`,
        senderId,
        receiverId,
        message: message.trim(),
        createdAt: new Date().toISOString(),
        isRead: false,
        shareSlug: null,
        isPublic: false,
        senderName: null,
        receiverName: null,
        senderArchivedAt: null,
        receiverArchivedAt: null,
        senderDeletedAt: null,
        receiverDeletedAt: null,
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
          l.receiverDeletedAt === null,
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
      return ok({ ...self })
    },
  }

  return { letters: letterRepository, profiles: profileRepository }
}
