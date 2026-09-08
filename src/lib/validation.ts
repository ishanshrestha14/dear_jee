export const MAX_LETTER_LENGTH = 5000

export type ValidationResult = { ok: true } | { ok: false; reason: string }

/** Guards the one field the app writes. Messages are user-facing copy. */
export function validateLetter(message: string): ValidationResult {
  if (message.trim().length === 0) {
    return { ok: false, reason: 'A letter needs a few words.' }
  }
  if (message.length > MAX_LETTER_LENGTH) {
    return { ok: false, reason: 'This letter is a little too long to send.' }
  }
  return { ok: true }
}
