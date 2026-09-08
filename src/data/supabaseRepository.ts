import { supabase } from './supabaseClient'
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

const ok = <T>(data: T): Result<T> => ({ data, error: null })
const fail = <T>(error: string): Result<T> => ({ data: null, error })

/** Postgres rows are snake_case; the domain is camelCase. */
interface LetterRow {
  id: string
  sender_id: string
  receiver_id: string
  message: string
  created_at: string
  is_read: boolean
  share_slug: string | null
  is_public: boolean
}

interface ProfileRow {
  id: string
  full_name: string
  partner_id: string | null
  invite_code: string
  created_at: string
}

const toLetter = (r: LetterRow): Letter => ({
  id: r.id,
  senderId: r.sender_id,
  receiverId: r.receiver_id,
  message: r.message,
  createdAt: r.created_at,
  isRead: r.is_read,
  shareSlug: r.share_slug,
  isPublic: r.is_public,
})

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  fullName: r.full_name,
  partnerId: r.partner_id,
  inviteCode: r.invite_code,
  createdAt: r.created_at,
})

/**
 * Maps the errors `link_partners` raises to the exact user-facing copy the
 * contract asserts. Postgres wraps the raised message, so match on substring.
 */
function linkErrorMessage(raw: string): string {
  if (raw.includes('ALREADY_LINKED')) return 'You are already connected.'
  if (raw.includes('OWN_CODE')) return 'That invite link is your own.'
  if (raw.includes('INVALID_CODE')) return 'That invite link is not valid.'
  if (raw.includes('PROFILE_NOT_FOUND')) return 'Profile not found.'
  return 'That invite link could not be used.'
}

/**
 * Postgres error text is a diagnostic, not product copy. The raw message is
 * logged in dev; the user gets something they can act on.
 */
function letterErrorMessage(raw: string): string {
  if (raw.includes('IMMUTABLE_COLUMN')) return 'A sent letter cannot be edited.'
  if (raw.includes('ONLY_RECEIVER_MAY_READ')) return 'Only the person it was written to can open it.'
  if (raw.includes('row-level security')) return 'You do not have access to that letter.'
  if (raw.includes('violates check constraint')) return 'That letter is too long to send.'
  if (import.meta.env.DEV) console.error('[dear-jee] unmapped repository error', raw)
  return 'Something went wrong. Please try again.'
}

/**
 * The Result contract says these methods never throw. The Supabase client
 * makes no such promise — an auth refresh, an aborted request or a network
 * failure can reject — so every call goes through here.
 */
async function guard<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await operation()
  } catch (cause) {
    if (import.meta.env.DEV) console.error('[dear-jee] repository call threw', cause)
    return fail('Something went wrong. Please try again.')
  }
}

/** The client is guaranteed non-null here; index.ts only calls this when configured. */
export function createSupabaseRepositories(): {
  letters: LetterRepository
  profiles: ProfileRepository
} {
  if (supabase === null) {
    throw new Error('createSupabaseRepositories called without configuration')
  }
  const db = supabase

  const letterRepository: LetterRepository = {
    async listReceived(userId) {
      return guard(async () => {
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('receiver_id', userId)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },

    async send({ senderId, receiverId, message }: SendLetterInput) {
      return guard(async () => {
        // Validate before the round trip. The DB CHECK is the backstop, but
        // this is what produces the exact user-facing copy.
        const validation = validateLetter(message)
        if (!validation.ok) return fail(validation.reason)

        const { data, error } = await db
          .from('letters')
          .insert({ sender_id: senderId, receiver_id: receiverId, message: message.trim() })
          .select()
          .single()
        if (error) return fail(letterErrorMessage(error.message))
        return ok(toLetter(data as LetterRow))
      })
    },

    async markRead(letterId) {
      return guard(async () => {
        const { data, error } = await db
          .from('letters')
          .update({ is_read: true })
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return fail('Letter not found.')
        return ok(toLetter(data as LetterRow))
      })
    },

    async share(letterId) {
      return guard(async () => {
        const existing = await db
          .from('letters')
          .select('*')
          .eq('id', letterId)
          .maybeSingle()
        if (existing.error) return fail(letterErrorMessage(existing.error.message))
        if (existing.data === null) return fail('Letter not found.')

        const row = existing.data as LetterRow
        // Reuse the slug so links already sent keep resolving.
        const slug = row.share_slug ?? generateSlug()

        const { data, error } = await db
          .from('letters')
          .update({ is_public: true, share_slug: slug })
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return fail('Letter not found.')
        return ok(toLetter(data as LetterRow))
      })
    },

    async getBySlug(slug) {
      return guard(async () => {
        // Calls a security-definer function, NOT a table or view. A view
        // granted to `anon` could be selected with no filter, listing every
        // shared letter; a function makes the slug a mandatory argument, so
        // possession of the link is the only way in. It returns exactly the
        // four columns an anonymous reader may see.
        const { data, error } = await db.rpc('get_public_letter', { slug })
        if (error) return fail(letterErrorMessage(error.message))

        const rows = data as
          | { message: string; created_at: string; sender_name: string; receiver_name: string }[]
          | null
        if (rows === null || rows.length === 0) return fail('This letter is not available.')

        const row = rows[0]
        const view: PublicLetter = {
          message: row.message,
          createdAt: row.created_at,
          senderName: row.sender_name || 'Someone',
          receiverName: row.receiver_name || 'you',
        }
        return ok(view)
      })
    },
  }

  const profileRepository: ProfileRepository = {
    async getById(id) {
      return guard(async () => {
        const { data, error } = await db
          .from('profiles')
          .select('*')
          .eq('id', id)
          .maybeSingle()
        if (error) return fail(error.message)
        if (data === null) return fail('Profile not found.')
        return ok(toProfile(data as ProfileRow))
      })
    },

    async getByInviteCode(inviteCode) {
      return guard(async () => {
        const { data, error } = await db
          .from('profiles')
          .select('*')
          .eq('invite_code', inviteCode)
          .maybeSingle()
        if (error) return fail(error.message)
        if (data === null) return fail('That invite link is not valid.')
        return ok(toProfile(data as ProfileRow))
      })
    },

    async updateName(userId, fullName) {
      return guard(async () => {
        const trimmed = fullName.trim()
        if (trimmed.length === 0) return fail('Please enter a name.')
        const { data, error } = await db
          .from('profiles')
          .update({ full_name: trimmed })
          .eq('id', userId)
          .select()
          .maybeSingle()
        if (error) return fail(error.message)
        if (data === null) return fail('Profile not found.')
        return ok(toProfile(data as ProfileRow))
      })
    },

    async linkPartner(_userId, inviteCode) {
      return guard(async () => {
        // One transaction in the database: the link must not half-apply.
        // _userId is unused because the function reads auth.uid() server-side,
        // which is also what stops a client linking somebody else's account.
        const { data, error } = await db.rpc('link_partners', { code: inviteCode })
        if (error) return fail(linkErrorMessage(error.message))
        if (data === null) return fail('That invite link could not be used.')
        return ok(toProfile(data as ProfileRow))
      })
    },
  }

  return { letters: letterRepository, profiles: profileRepository }
}
