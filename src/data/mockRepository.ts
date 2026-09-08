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
    async listReceived(userId) {
      const received = letters
        .filter((l) => l.receiverId === userId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return ok(received.map((l) => ({ ...l })))
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

    async share(letterId) {
      const letter = letters.find((l) => l.id === letterId)
      if (!letter) return fail('Letter not found.')
      // Reuse an existing slug so links already sent keep resolving.
      letter.shareSlug = letter.shareSlug ?? generateSlug()
      letter.isPublic = true
      return ok({ ...letter })
    },

    async getBySlug(slug) {
      const letter = letters.find((l) => l.shareSlug === slug && l.isPublic)
      if (!letter) return fail('This letter is not available.')
      const view: PublicLetter = {
        message: letter.message,
        createdAt: letter.createdAt,
        senderName: findProfile(letter.senderId)?.fullName ?? 'Someone',
        receiverName: findProfile(letter.receiverId)?.fullName ?? 'you',
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

    async linkPartner(userId, inviteCode) {
      const self = findProfile(userId)
      if (!self) return fail('Profile not found.')
      if (self.partnerId) return fail('You are already connected.')

      const other = profiles.find((p) => p.inviteCode === inviteCode)
      if (!other) return fail('That invite link is not valid.')
      if (other.id === self.id) return fail('That invite link is your own.')
      if (other.partnerId) return fail('You are already connected.')

      // Both sides in one step: the link must not half-apply.
      self.partnerId = other.id
      other.partnerId = self.id
      return ok({ ...self })
    },
  }

  return { letters: letterRepository, profiles: profileRepository }
}
