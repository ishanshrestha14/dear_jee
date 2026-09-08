import { describe, it, expect } from 'vitest'
import { validateLetter, MAX_LETTER_LENGTH } from './validation'

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
