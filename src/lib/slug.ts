/**
 * Base58: the digits and letters minus 0, O, I, and l, so a slug read
 * aloud or retyped from a screenshot cannot be mistranscribed.
 */
export const SLUG_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export const SLUG_LENGTH = 12

/**
 * Generates the unlisted-URL identifier for a shared letter.
 *
 * Uses the CSPRNG, not Math.random: an unlisted link is only private
 * while it is unguessable, and rejection sampling keeps the character
 * distribution uniform.
 */
export function generateSlug(): string {
  const limit = 256 - (256 % SLUG_ALPHABET.length)
  const out: string[] = []
  const buffer = new Uint8Array(SLUG_LENGTH * 2)

  while (out.length < SLUG_LENGTH) {
    crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (byte >= limit) continue // discard, or common characters skew high
      out.push(SLUG_ALPHABET[byte % SLUG_ALPHABET.length])
      if (out.length === SLUG_LENGTH) break
    }
  }

  return out.join('')
}
