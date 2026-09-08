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
  senderId: string
  receiverId: string
  message: string
  createdAt: string
  isRead: boolean
  shareSlug: string | null
  isPublic: boolean
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
  listReceived(userId: string): Promise<Result<Letter[]>>
  send(input: SendLetterInput): Promise<Result<Letter>>
  markRead(letterId: string): Promise<Result<Letter>>
  /** Makes the letter publicly readable, generating a slug on first call. */
  share(letterId: string): Promise<Result<Letter>>
  getBySlug(slug: string): Promise<Result<PublicLetter>>
}

export interface ProfileRepository {
  getById(id: string): Promise<Result<Profile>>
  getByInviteCode(inviteCode: string): Promise<Result<Profile>>
  linkPartner(userId: string, inviteCode: string): Promise<Result<Profile>>
}
