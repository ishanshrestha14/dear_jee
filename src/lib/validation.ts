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

/** The salutation column is `check (char_length between 1 and 60)`. */
export const MAX_SALUTATION_LENGTH = 60

/**
 * The five faces a letter may be written in. `id` is what is stored and what
 * the check constraint allows; `stack` is the CSS font-family; `label` is what
 * the picker shows, set in the face itself.
 *
 * Adding to this list means ALSO adding to the check constraint in
 * schema.sql and to the loader in src/design/letterFonts.ts. All three must
 * agree or a letter becomes unwritable, unreadable, or unstyled.
 */
export const BODY_FONTS = [
  { id: 'lora', label: 'Lora', stack: "'Lora', ui-serif, Georgia, serif" },
  { id: 'eb-garamond', label: 'EB Garamond', stack: "'EB Garamond', ui-serif, Georgia, serif" },
  { id: 'courier-prime', label: 'Courier Prime', stack: "'Courier Prime', ui-monospace, monospace" },
  { id: 'caveat', label: 'Caveat', stack: "'Caveat', ui-serif, cursive" },
  { id: 'dancing-script', label: 'Dancing Script', stack: "'Dancing Script', ui-serif, cursive" },
] as const

export type BodyFont = (typeof BODY_FONTS)[number]['id']

const FONT_IDS: readonly string[] = BODY_FONTS.map((f) => f.id)

/** Null means "use the recipient's name", which is always valid. */
export function validateSalutation(salutation: string | null): ValidationResult {
  if (salutation === null) return { ok: true }
  if (salutation.trim().length === 0) {
    return { ok: false, reason: 'A salutation needs a word, or leave it as their name.' }
  }
  if (salutation.length > MAX_SALUTATION_LENGTH) {
    return { ok: false, reason: 'That salutation is a little too long.' }
  }
  return { ok: true }
}

/** Null means "use the default face", which is always valid. */
export function validateBodyFont(bodyFont: string | null): ValidationResult {
  if (bodyFont === null) return { ok: true }
  if (!FONT_IDS.includes(bodyFont)) {
    return { ok: false, reason: 'That is not a font this app can write in.' }
  }
  return { ok: true }
}

/** Null means "deliver now". A chosen date must be today or later. */
export function validateScheduledFor(scheduledFor: string | null): ValidationResult {
  if (scheduledFor === null) return { ok: true }
  const today = new Date().toISOString().slice(0, 10)
  if (scheduledFor < today) {
    return { ok: false, reason: 'That date has already passed.' }
  }
  return { ok: true }
}
