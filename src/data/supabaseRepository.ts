import { supabase } from './supabaseClient'
import { generateSlug } from '../lib/slug'
import { validateBodyFont, validateLetter, validateSalutation, validateScheduledFor } from '../lib/validation'
import type {
  Bond,
  BodyFont,
  BondRepository,
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
  sender_id: string | null
  receiver_id: string | null
  message: string
  created_at: string
  is_read: boolean
  share_slug: string | null
  is_public: boolean
  sender_name: string | null
  receiver_name: string | null
  salutation: string | null
  body_font: BodyFont | null
  sender_archived_at: string | null
  receiver_archived_at: string | null
  sender_deleted_at: string | null
  receiver_deleted_at: string | null
  bond_id: string | null
  sent_at: string | null
  scheduled_for: string | null
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
  senderName: r.sender_name,
  receiverName: r.receiver_name,
  salutation: r.salutation,
  bodyFont: r.body_font,
  senderArchivedAt: r.sender_archived_at,
  receiverArchivedAt: r.receiver_archived_at,
  senderDeletedAt: r.sender_deleted_at,
  receiverDeletedAt: r.receiver_deleted_at,
  bondId: r.bond_id,
  sentAt: r.sent_at,
  scheduledFor: r.scheduled_for,
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
  if (raw.includes('LINK_ALREADY_USED')) return 'That invite link has already been used.'
  if (raw.includes('ALREADY_LINKED')) return 'You are already connected to someone.'
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
  if (raw.includes('NO_BOND')) return 'You are not connected to anyone yet.'
  if (raw.includes('NOT_YOUR_SIDE')) return 'That is not yours to change.'
  if (raw.includes('IMMUTABLE_COLUMN')) return 'A sent letter cannot be edited.'
  if (raw.includes('SCHEDULED_FOR_PAST')) return 'That time has already passed.'
  if (raw.includes('ONLY_RECEIVER_MAY_READ')) return 'Only the person it was written to can open it.'
  if (raw.includes('new row violates')) return 'You are not connected to anyone yet.'
  if (raw.includes('row-level security')) return 'You do not have access to that letter.'
  if (raw.includes('violates check constraint')) return 'This letter is a little too long to send.'
  if (import.meta.env.DEV) console.error('[dear-jee] unmapped repository error', raw)
  return 'Something went wrong. Please try again.'
}

/**
 * The function's exception names, turned into sentences. Matching on message
 * text is what the existing linkErrorMessage does too — PostgREST does not
 * pass through SQLSTATE for a plpgsql `raise exception`.
 */
function heldErrorMessage(message: string): string {
  if (message.includes('NO_BOND')) return 'You are not connected to anyone yet.'
  if (message.includes('LETTER_NOT_FOUND_OR_ALREADY_SENT')) {
    return 'That letter has already been sent.'
  }
  if (message.includes('NOT_SIGNED_IN')) return 'You are not signed in.'
  return 'That letter could not be sent.'
}

/**
 * Postgres error text is a diagnostic, not product copy. The raw message is
 * logged in dev; the user gets something they can act on.
 */
function profileErrorMessage(raw: string): string {
  if (raw.includes('permission denied')) return 'That change is not allowed.'
  if (raw.includes('row-level security')) return 'You do not have access to that profile.'
  if (import.meta.env.DEV) console.error('[dear-jee] unmapped profile error', raw)
  return 'Something went wrong. Please try again.'
}

/**
 * The Result contract says these methods never throw. The Supabase client
 * makes no such promise — an auth refresh, an aborted request or a network
 * failure can reject — so every call goes through here.
 */
/** The bonds table, snake_case. Not the Bond DTO — that is resolved per caller. */
interface BondRow {
  id: string
  lower_id: string | null
  upper_id: string | null
  lower_name: string | null
  upper_name: string | null
  started_at: string
  ended_at: string | null
  lower_seen_end_at: string | null
  upper_seen_end_at: string | null
}

async function guard<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await operation()
  } catch (cause) {
    if (import.meta.env.DEV) console.error('[dear-jee] repository call threw', cause)
    return fail('Something went wrong. Please try again.')
  }
}

function archivedBy(l: Letter, userId: string): boolean {
  if (l.senderId === userId) return l.senderArchivedAt !== null
  if (l.receiverId === userId) return l.receiverArchivedAt !== null
  return false
}

/** The client is guaranteed non-null here; index.ts only calls this when configured. */
export function createSupabaseRepositories(): {
  letters: LetterRepository
  profiles: ProfileRepository
  bonds: BondRepository
} {
  if (supabase === null) {
    throw new Error('createSupabaseRepositories called without configuration')
  }
  const db = supabase

  /**
   * The caller's open bond. Two round trips rather than a join: PostgREST
   * cannot express "letters whose bond is my open one" in a single filtered
   * select without an embedded resource, and the embedded form is harder to
   * read than the extra request is to pay for.
   *
   * No `or(lower_id.eq…,upper_id.eq…)` filter: bonds_select_member already
   * restricts the rows to this user's, and the bonds_one_active_* partial
   * unique indexes guarantee at most one open one. A client-side filter here
   * would duplicate the policy and drift from it.
   *
   * Returns a Result, not a bare nullable: `.maybeSingle()` already reports
   * "no open bond" as `{ data: null, error: null }`, distinct from a genuine
   * query failure. Collapsing both into one null (as this used to do) turned
   * a network blip or an RLS regression into a false "you have no partner" —
   * a returning, bonded user would see a successful empty inbox instead of
   * an error. Callers must tell the two apart.
   */
  const openBond = async (): Promise<Result<BondRow | null>> => {
    const { data, error } = await db
      .from('bonds')
      .select('*')
      .is('ended_at', null)
      .maybeSingle()
    if (error) return fail(letterErrorMessage(error.message))
    return ok(data as BondRow | null)
  }

  const letterRepository: LetterRepository = {
    async listConversation(userId, options) {
      return guard(async () => {
        // Scoped to the OPEN bond: this is the current chapter, not every
        // letter the user has ever exchanged. No open bond is a real,
        // renderable state — an unbonded person's home is empty — not an
        // error. A failed lookup is a different thing entirely and must
        // surface as one, not silently resolve to the same empty inbox.
        //
        // RLS already hides letters this user deleted, so there is no delete
        // filter here — unlike the mock, which has no policies to lean on.
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])

        const nowIso = new Date().toISOString()
        let query = db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          // Not archived by this side. Mirrors archivedBy() below, in SQL:
          // pushed into the where clause (rather than filtered in JS, as
          // every other list method here still does) because a `limit`
          // further down has to apply to the CORRECT row set, or a page
          // can come back short.
          .or(
            `and(sender_id.eq.${userId},sender_archived_at.is.null),` +
              `and(receiver_id.eq.${userId},receiver_archived_at.is.null)`,
          )
          // De Morgan's of "not (I'm the sender AND it's still pending)":
          // not-sender, OR no schedule, OR its date has already passed.
          .or(`sender_id.neq.${userId},scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })

        // Mirrors mockRepository.ts's compareNewestFirst: `created_at desc,
        // id desc`, so a `lt`/`gt` tuple comparison against that same pair
        // is the correct cursor in either direction.
        if (options?.olderThan !== undefined) {
          const { createdAt, id } = options.olderThan
          query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`)
        }
        if (options?.newerThan !== undefined) {
          const { createdAt, id } = options.newerThan
          query = query.or(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`)
        }
        if (options?.limit !== undefined) {
          query = query.limit(options.limit)
        }

        const { data, error } = await query
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },

    async listArchived(userId) {
      return guard(async () => {
        // Archived WITHIN the current chapter, for the same reason as above.
        const bondResult = await openBond()
        if (bondResult.error !== null) return fail(bondResult.error)
        if (bondResult.data === null) return ok([])
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondResult.data.id)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        const rows = (data as LetterRow[]).map(toLetter)
        const now = Date.now()
        return ok(
          rows.filter(
            (l) =>
              archivedBy(l, userId) &&
              !(l.senderId === userId && l.scheduledFor !== null && Date.parse(l.scheduledFor) > now),
          ),
        )
      })
    },

    async setArchived(letterId, userId, archived) {
      return guard(async () => {
        const existing = await db.from('letters').select('*').eq('id', letterId).maybeSingle()
        if (existing.error) return fail(letterErrorMessage(existing.error.message))
        if (existing.data === null) return fail('Letter not found.')

        const row = existing.data as LetterRow
        const at = archived ? new Date().toISOString() : null
        const patch =
          row.sender_id === userId
            ? { sender_archived_at: at }
            : row.receiver_id === userId
              ? { receiver_archived_at: at }
              : null
        if (patch === null) return fail('Letter not found.')

        const { data, error } = await db
          .from('letters')
          .update(patch)
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return fail('Letter not found.')
        return ok(toLetter(data as LetterRow))
      })
    },

    async deleteForMe(letterId, userId) {
      return guard(async () => {
        const existing = await db.from('letters').select('*').eq('id', letterId).maybeSingle()
        if (existing.error) return fail(letterErrorMessage(existing.error.message))
        if (existing.data === null) return fail('Letter not found.')

        const row = existing.data as LetterRow
        const at = new Date().toISOString()
        const patch =
          row.sender_id === userId
            ? { sender_deleted_at: at }
            : row.receiver_id === userId
              ? { receiver_deleted_at: at }
              : null
        if (patch === null) return fail('Letter not found.')

        // The row is returned before RLS hides it, so the caller still gets
        // the Result it expects rather than a confusing not-found.
        const { data, error } = await db
          .from('letters')
          .update(patch)
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return ok(toLetter({ ...row, ...patch } as LetterRow))
        return ok(toLetter(data as LetterRow))
      })
    },

    async send({ senderId, receiverId, message, salutation, bodyFont, scheduledFor = null }: SendLetterInput) {
      return guard(async () => {
        // bond_id is deliberately absent from this insert: `grant insert
        // (sender_id, receiver_id, message, salutation, body_font)` forbids
        // it, and the insert policy already proves receiver_id is the
        // caller's partner. A client that could choose bond_id could file a
        // letter into someone else's chapter. The set_letter_bond trigger
        // derives it instead.
        //
        // Validate before the round trip. The DB CHECKs are the backstop, but
        // this is what produces the exact user-facing copy.
        const validation = validateLetter(message)
        if (!validation.ok) return fail(validation.reason)
        const salutationCheck = validateSalutation(salutation)
        if (!salutationCheck.ok) return fail(salutationCheck.reason)
        const fontCheck = validateBodyFont(bodyFont)
        if (!fontCheck.ok) return fail(fontCheck.reason)
        const scheduledCheck = validateScheduledFor(scheduledFor)
        if (!scheduledCheck.ok) return fail(scheduledCheck.reason)

        const { data, error } = await db
          .from('letters')
          .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            message: message.trim(),
            salutation: salutation === null ? null : salutation.trim(),
            body_font: bodyFont,
            scheduled_for: scheduledFor,
          })
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

    async setShared(letterId, shared) {
      return guard(async () => {
        // Two statements, made race-safe by the `share_slug is null` guard:
        // under READ COMMITTED a second concurrent caller blocks on the row
        // lock, re-evaluates the guard against the committed new version,
        // matches nothing, and falls through to the second statement — so both
        // callers end up with the same slug. Neither statement reads before it
        // writes, which is what the old implementation did wrong.
        // `coalesce` preserves an existing slug, which is what lets an
        // un-shared letter come back on the SAME URL.
        const { data, error } = await db
          .from('letters')
          .update({ share_slug: generateSlug(), is_public: shared })
          .eq('id', letterId)
          .is('share_slug', null)
          .select()
          .maybeSingle()

        if (error) return fail(letterErrorMessage(error.message))
        if (data !== null) return ok(toLetter(data as LetterRow))

        // No row matched the `share_slug is null` guard, which means the
        // letter already has one. Flip is_public and keep it.
        const existing = await db
          .from('letters')
          .update({ is_public: shared })
          .eq('id', letterId)
          .select()
          .maybeSingle()

        if (existing.error) return fail(letterErrorMessage(existing.error.message))
        if (existing.data === null) return fail('Letter not found.')
        return ok(toLetter(existing.data as LetterRow))
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
          | {
              message: string
              created_at: string
              sender_name: string
              receiver_name: string
              salutation: string | null
              body_font: BodyFont | null
            }[]
          | null
        if (rows === null || rows.length === 0) return fail('This letter is not available.')

        const row = rows[0]
        const view: PublicLetter = {
          message: row.message,
          createdAt: row.created_at,
          senderName: row.sender_name || 'Someone',
          receiverName: row.receiver_name || 'you',
          salutation: row.salutation,
          bodyFont: row.body_font,
        }
        return ok(view)
      })
    },

    async listChapter(_userId, bondId) {
      return guard(async () => {
        // No membership check here, unlike the mock: bonds_select_member and
        // letters_select_participant both apply, so a guessed bond id returns
        // an empty list rather than someone else's letters. The mock has to
        // check by hand because it has no policies.
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('bond_id', bondId)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },

    async listHeld(userId) {
      return guard(async () => {
        const { data, error } = await db
          .from('letters')
          .select('*')
          .is('bond_id', null)
          .eq('sender_id', userId)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },

    async listScheduled(userId) {
      return guard(async () => {
        const now = new Date().toISOString()
        // Still in its pending window, OR cancelled by a bond ending
        // (receiver_deleted_at set) — either way it never reached, or will
        // never reach, the receiver, so it stays listed here rather than
        // dropping out unlabelled once its moment passes.
        const { data, error } = await db
          .from('letters')
          .select('*')
          .eq('sender_id', userId)
          .not('scheduled_for', 'is', null)
          .or(`scheduled_for.gt.${now},receiver_deleted_at.not.is.null`)
          .order('created_at', { ascending: false })
        if (error) return fail(letterErrorMessage(error.message))
        return ok((data as LetterRow[]).map(toLetter))
      })
    },

    async editScheduled(letterId, _userId, message, salutation, bodyFont, scheduledFor) {
      return guard(async () => {
        const validation = validateLetter(message)
        if (!validation.ok) return fail(validation.reason)
        const salutationCheck = validateSalutation(salutation)
        if (!salutationCheck.ok) return fail(salutationCheck.reason)
        const fontCheck = validateBodyFont(bodyFont)
        if (!fontCheck.ok) return fail(fontCheck.reason)
        const scheduledCheck = validateScheduledFor(scheduledFor)
        if (!scheduledCheck.ok) return fail(scheduledCheck.reason)

        const { data, error } = await db
          .from('letters')
          .update({
            message: message.trim(),
            salutation: salutation === null ? null : salutation.trim(),
            body_font: bodyFont,
            scheduled_for: scheduledFor,
          })
          .eq('id', letterId)
          .select()
          .maybeSingle()
        if (error) return fail(letterErrorMessage(error.message))
        if (data === null) return fail('A sent letter cannot be edited.')
        return ok(toLetter(data as LetterRow))
      })
    },

    async sendHeld(letterId, _userId) {
      return guard(async () => {
        // An RPC, not an update: receiver_id, bond_id and sent_at are all
        // blocked by the column grants AND by enforce_letter_update, and only
        // a security definer function may fill them in.
        const { data, error } = await db.rpc('send_held_letter', { letter_id: letterId })
        if (error) return fail(heldErrorMessage(error.message))
        if (data === null) return fail('That letter could not be sent.')
        return ok(toLetter(data as LetterRow))
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
        if (error) return fail(profileErrorMessage(error.message))
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
        if (error) return fail(profileErrorMessage(error.message))
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
        if (error) return fail(profileErrorMessage(error.message))
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

  const bondRepository: BondRepository = {
    async list(userId) {
      return guard(async () => {
        const { data, error } = await db
          .from('bonds')
          .select('*')
          .order('started_at', { ascending: false })
        if (error) return fail('Your chapters could not be loaded.')
        const rows = data as BondRow[]

        // One count query for every chapter rather than one per chapter.
        const { data: letterData, error: letterError } = await db
          .from('letters')
          .select('bond_id')
        if (letterError) return fail('Your chapters could not be loaded.')
        const counts = new Map<string, number>()
        for (const row of letterData as { bond_id: string | null }[]) {
          if (row.bond_id === null) continue
          counts.set(row.bond_id, (counts.get(row.bond_id) ?? 0) + 1)
        }

        // profiles_select_self_or_partner permits reading exactly this user's
        // own profile and their CURRENT partner's — nobody else's — so an
        // unfiltered select returns at most those two rows, which is exactly
        // what the open bond needs to resolve its live name.
        const { data: profileData, error: profileError } = await db
          .from('profiles')
          .select('id, full_name')
        if (profileError) return fail('Your chapters could not be loaded.')
        const liveNames = new Map<string, string>()
        for (const row of profileData as { id: string; full_name: string }[]) {
          liveNames.set(row.id, row.full_name)
        }

        const bonds: Bond[] = rows.map((row) => {
          const iAmLower = row.lower_id === userId
          const partnerId = iAmLower ? row.upper_id : row.lower_id
          const frozen = iAmLower ? row.upper_name : row.lower_name
          const live = partnerId === null ? undefined : liveNames.get(partnerId)
          return {
            id: row.id,
            partnerId,
            // Frozen name wins for an ended bond — that is WHY it was frozen,
            // and the partner's profile may no longer be readable at all.
            // For the OPEN bond the frozen columns are null, so the live name
            // from the lookup above answers instead.
            partnerName: frozen ?? live ?? '',
            startedAt: row.started_at,
            endedAt: row.ended_at,
            seenEndAt: iAmLower ? row.lower_seen_end_at : row.upper_seen_end_at,
            letterCount: counts.get(row.id) ?? 0,
          }
        })
        return ok(bonds)
      })
    },

    async unlink(_userId) {
      return guard(async () => {
        const { data, error } = await db.rpc('unlink_partner')
        if (error) {
          if (error.message.includes('NO_BOND')) return fail('You are not connected to anyone.')
          return fail('That did not work. Please try again.')
        }
        if (data === null) return fail('You are not connected to anyone.')
        return ok(toProfile(data as ProfileRow))
      })
    },

    async acknowledgeEnd(_userId, bondId) {
      return guard(async () => {
        const { error } = await db.rpc('acknowledge_bond_end', { bond_id: bondId })
        if (error) return fail('That did not work.')
        return ok(undefined)
      })
    },
  }

  return { letters: letterRepository, profiles: profileRepository, bonds: bondRepository }
}
