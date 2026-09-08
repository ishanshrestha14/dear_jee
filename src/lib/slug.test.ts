import { describe, it, expect } from 'vitest'
import { generateSlug, SLUG_LENGTH, SLUG_ALPHABET } from './slug'

describe('generateSlug', () => {
  it('is the declared length', () => {
    expect(generateSlug()).toHaveLength(SLUG_LENGTH)
  })

  it('uses only the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      for (const char of generateSlug()) {
        expect(SLUG_ALPHABET).toContain(char)
      }
    }
  })

  it('carries enough entropy that unlisted links cannot be guessed', () => {
    // Security here rests entirely on unguessability, so assert the floor.
    const bits = SLUG_LENGTH * Math.log2(SLUG_ALPHABET.length)
    expect(bits).toBeGreaterThan(60)
  })

  it('produces no collisions across a large sample', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20000; i += 1) seen.add(generateSlug())
    expect(seen.size).toBe(20000)
  })
})
