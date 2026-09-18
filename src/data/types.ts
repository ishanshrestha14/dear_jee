import type { BodyFont } from '../lib/validation'

export type { BodyFont }

export interface Profile {
  id: string
  fullName: string
  /** Null until the two accounts are linked. A real, renderable state. */
  partnerId: string | null
  inviteCode: string
  createdAt: string
}

export interface Letter {
  id: string
  /** Null once that account has been deleted. The letter outlives them. */
  senderId: string | null
  receiverId: string | null
  message: string
  createdAt: string
  isRead: boolean
  shareSlug: string | null
  isPublic: boolean
  /** Set only when the profile is deleted, freezing the name as it then was. */
  senderName: string | null
  receiverName: string | null
  /**
   * How the writer addressed the recipient. Null means the recipient's name,
   * which is how every letter written before this feature reads.
   */
  salutation: string | null
  /** The face the letter was written in. Null means the default, Lora. */
  bodyFont: BodyFont | null
  senderArchivedAt: string | null
  receiverArchivedAt: string | null
  senderDeletedAt: string | null
  receiverDeletedAt: string | null
  /**
   * Which chapter this letter belongs to. Null means a HELD letter: written
   * while its author had no bond, belonging to no chapter until it is sent.
   */
  bondId: string | null
  /**
   * When it was delivered. Null while held. `createdAt` always means WRITTEN,
   * so a letter held for months keeps the date it was written and gains a
   * separate sent date — never a rewritten one.
   */
  sentAt: string | null
  /**
   * A future delivery instant (ISO timestamp). Null means deliver now, which
   * is what every letter has always done. While this is set to a moment
   * later than now, the letter is invisible to its receiver and its own
   * sender may still rewrite it — the one exception to a sent letter's usual
   * immutability. Chosen in the composer as a Kathmandu wall-clock date and
   * time, converted to this UTC instant before it's ever sent to a
   * repository — see `kathmanduDateTimeToUtcIso` in `src/lib/format.ts`.
   */
  scheduledFor: string | null
}

/** One relationship, open or ended. A chapter. */
export interface Bond {
  id: string
  /** The other person. Null once they delete their account. */
  partnerId: string | null
  /** Frozen at the end for a past chapter; the live name for the open one. */
  partnerName: string
  startedAt: string
  /** Null for the one live bond. */
  endedAt: string | null
  /**
   * Resolved per caller: whichever of the two database columns belongs to
   * this user. A caller never sees the other side's.
   */
  seenEndAt: string | null
  /**
   * Letters in this chapter the CALLER can still see — their own deletes are
   * already excluded, so it matches what opening the chapter shows.
   */
  letterCount: number
}

/** The narrow shape an anonymous reader is allowed to see. */
export interface PublicLetter {
  message: string
  createdAt: string
  senderName: string
  receiverName: string
  /**
   * How the writer addressed the recipient. Null means the recipient's name,
   * which is how every letter written before this feature reads.
   */
  salutation: string | null
  /** The face the letter was written in. Null means the default, Lora. */
  bodyFont: BodyFont | null
}

/** Repositories report failure in the value, never by throwing. */
export type Result<T> = { data: T; error: null } | { data: null; error: string }

export interface SendLetterInput {
  senderId: string
  /**
   * Null writes a HELD letter, permitted only when the sender has no bond.
   * Same act as sending, so it shares this one code path and one set of
   * validation rather than gaining a `hold` method of its own.
   */
  receiverId: string | null
  message: string
  /** Null leaves the recipient's name as the salutation. */
  salutation: string | null
  /** Null leaves the default face. */
  bodyFont: BodyFont | null
  /**
   * Optional, unlike every field above — deliberately. Every existing call
   * site (contractTests.ts has 21 of them) sends an ordinary letter and has
   * no reason to name this at all; unlike `salutation` or `bodyFont`, an
   * absent value has exactly one meaning (deliver now) with none of the
   * undefined/null ambiguity the other fields are required to avoid.
   * Implementations must treat a missing key the same as an explicit null.
   */
  scheduledFor?: string | null
}

export interface LetterRepository {
  /**
   * The CURRENT chapter: letters exchanged with your present partner, newest
   * first, minus the ones you archived.
   *
   * SCOPED TO THE OPEN BOND — this is the central semantic change of the
   * bonds work and the easiest thing to miss in a diff. It is NOT "every
   * letter you participate in". Letters from a past relationship live in
   * listChapter, and held letters in listHeld; neither appears here.
   */
  listConversation(userId: string): Promise<Result<Letter[]>>
  /** The ones you archived WITHIN the current chapter, newest first. */
  listArchived(userId: string): Promise<Result<Letter[]>>
  send(input: SendLetterInput): Promise<Result<Letter>>
  markRead(letterId: string): Promise<Result<Letter>>
  /** Archives or unarchives for the calling user only. */
  setArchived(letterId: string, userId: string, archived: boolean): Promise<Result<Letter>>
  /** Removes the letter from this user's side only. Permanent. */
  deleteForMe(letterId: string, userId: string): Promise<Result<Letter>>
  /**
   * Publishes or un-publishes the letter. The slug is generated on first
   * share and PRESERVED when un-shared, so sharing again revives the same
   * URL rather than minting a new one.
   *
   * Note it takes no userId, unlike setArchived and deleteForMe. Those need
   * one so the mock can reimplement the per-side rule the database enforces;
   * sharing has no per-side column, and the participant check lives only in
   * the letters_update_participant policy. The mock therefore does NOT
   * enforce participation here — the one place in this interface where the
   * mock is deliberately weaker than the database.
   */
  setShared(letterId: string, shared: boolean): Promise<Result<Letter>>
  getBySlug(slug: string): Promise<Result<PublicLetter>>
  /**
   * Your held letters — written with no bond, addressed to nobody, newest
   * first. Visible to their author and to no one else, ever.
   */
  listHeld(userId: string): Promise<Result<Letter[]>>
  /**
   * Addresses a held letter to the caller's current partner. Fails when the
   * letter is already sent, is not yours, or you have no bond. `createdAt` is
   * never altered.
   */
  sendHeld(letterId: string, userId: string): Promise<Result<Letter>>
  /** One past chapter's letters, newest first. Read-only by construction. */
  listChapter(userId: string, bondId: string): Promise<Result<Letter[]>>
  /**
   * The caller's own letters scheduled for a future instant, newest first —
   * including one whose bond has since ended and will never deliver, AND one
   * that delivered normally and was later deleted by its receiver (both set
   * `receiverDeletedAt`, so that alone does not distinguish them). Tell them
   * apart in the UI by comparing `receiverDeletedAt` against `scheduledFor`
   * (see `cancelledByBondEnding` in `src/lib/format.ts`): `unlink_partner`
   * can only cancel a letter while it is still pending, so a bond-ending
   * deletion always lands before its `scheduledFor` instant; an ordinary
   * post-delivery deletion can only happen once `scheduledFor` has already
   * passed, so it always lands on or after it. A letter the caller cancelled
   * themselves — `senderDeletedAt` set — never appears here at all.
   */
  listScheduled(userId: string): Promise<Result<Letter[]>>
  /**
   * Rewrites a pending scheduled letter: its words, its salutation, its
   * face, or the date itself. Fails once the letter has delivered, once its
   * bond has ended, or for anyone but its own sender — the same window
   * `enforce_letter_update` enforces in the database.
   */
  editScheduled(
    letterId: string,
    userId: string,
    message: string,
    salutation: string | null,
    bodyFont: BodyFont | null,
    scheduledFor: string | null,
  ): Promise<Result<Letter>>
}

export interface ProfileRepository {
  getById(id: string): Promise<Result<Profile>>
  getByInviteCode(inviteCode: string): Promise<Result<Profile>>
  updateName(userId: string, fullName: string): Promise<Result<Profile>>
  linkPartner(userId: string, inviteCode: string): Promise<Result<Profile>>
}

export interface BondRepository {
  /** Every bond this user has had, newest first. The open one, if any, is first. */
  list(userId: string): Promise<Result<Bond[]>>
  /**
   * Ends the caller's current bond. Symmetric and immediate: both people are
   * freed, both get a fresh invite code, and the whole correspondence moves to
   * both archives. Returns the caller's updated profile.
   */
  unlink(userId: string): Promise<Result<Profile>>
  /** Marks the ended-bond notice as seen by this user, so it stops showing. */
  acknowledgeEnd(userId: string, bondId: string): Promise<Result<void>>
}
