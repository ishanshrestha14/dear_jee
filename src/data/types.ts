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
  senderArchivedAt: string | null
  receiverArchivedAt: string | null
  senderDeletedAt: string | null
  receiverDeletedAt: string | null
}

/** The narrow shape an anonymous reader is allowed to see. */
export interface PublicLetter {
  message: string
  createdAt: string
  senderName: string
  receiverName: string
}

/** Repositories report failure in the value, never by throwing. */
export type Result<T> = { data: T; error: null } | { data: null; error: string }

export interface SendLetterInput {
  senderId: string
  receiverId: string
  message: string
}

export interface LetterRepository {
  /** Every letter you sent or received, newest first, minus your archived ones. */
  listConversation(userId: string): Promise<Result<Letter[]>>
  /** The ones you archived, newest first. */
  listArchived(userId: string): Promise<Result<Letter[]>>
  send(input: SendLetterInput): Promise<Result<Letter>>
  markRead(letterId: string): Promise<Result<Letter>>
  /** Archives or unarchives for the calling user only. */
  setArchived(letterId: string, userId: string, archived: boolean): Promise<Result<Letter>>
  /** Removes the letter from this user's side only. Permanent. */
  deleteForMe(letterId: string, userId: string): Promise<Result<Letter>>
  /** Makes the letter publicly readable, generating a slug on first call. */
  share(letterId: string): Promise<Result<Letter>>
  getBySlug(slug: string): Promise<Result<PublicLetter>>
}

export interface ProfileRepository {
  getById(id: string): Promise<Result<Profile>>
  getByInviteCode(inviteCode: string): Promise<Result<Profile>>
  updateName(userId: string, fullName: string): Promise<Result<Profile>>
  linkPartner(userId: string, inviteCode: string): Promise<Result<Profile>>
}
