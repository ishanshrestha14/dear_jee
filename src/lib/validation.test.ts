import { describe, it, expect } from 'vitest'
import {
  validateLetter,
  MAX_LETTER_LENGTH,
  validateSalutation,
  validateBodyFont,
  BODY_FONTS,
  MAX_SALUTATION_LENGTH,
} from './validation'

describe('validateLetter', () => {
  it('accepts an ordinary letter', () => {
    expect(validateLetter('I miss you today.')).toEqual({ ok: true })
  })

  it('rejects an empty letter', () => {
    expect(validateLetter('')).toEqual({ ok: false, reason: 'A letter needs a few words.' })
  })

  it('rejects a whitespace-only letter', () => {
    expect(validateLetter('   \n\t  ')).toEqual({
      ok: false,
      reason: 'A letter needs a few words.',
    })
  })

  it('rejects a letter past the maximum length', () => {
    expect(validateLetter('a'.repeat(MAX_LETTER_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'This letter is a little too long to send.',
    })
  })

  it('accepts a letter exactly at the maximum length', () => {
    expect(validateLetter('a'.repeat(MAX_LETTER_LENGTH))).toEqual({ ok: true })
  })
})

describe('validateSalutation', () => {
  it('accepts null — the letter uses the recipient name', () => {
    expect(validateSalutation(null).ok).toBe(true)
  })

  it('accepts an ordinary salutation', () => {
    expect(validateSalutation('my love').ok).toBe(true)
  })

  it('rejects an empty or whitespace-only salutation', () => {
    expect(validateSalutation('').ok).toBe(false)
    expect(validateSalutation('   ').ok).toBe(false)
  })

  it('rejects one longer than the column allows', () => {
    expect(validateSalutation('a'.repeat(MAX_SALUTATION_LENGTH)).ok).toBe(true)
    expect(validateSalutation('a'.repeat(MAX_SALUTATION_LENGTH + 1)).ok).toBe(false)
  })
})

describe('validateBodyFont', () => {
  it('accepts null — the letter uses the default face', () => {
    expect(validateBodyFont(null).ok).toBe(true)
  })

  it('accepts every font in the published set', () => {
    for (const font of BODY_FONTS) {
      expect(validateBodyFont(font.id).ok).toBe(true)
    }
  })

  it('rejects a font outside the set', () => {
    expect(validateBodyFont('comic-sans').ok).toBe(false)
    expect(validateBodyFont('').ok).toBe(false)
  })

  it('rejects a CSS injection attempt', () => {
    expect(validateBodyFont('lora; background: url(x)').ok).toBe(false)
  })
})
