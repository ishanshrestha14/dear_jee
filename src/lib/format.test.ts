import { describe, it, expect } from 'vitest'
import { formatLetterDate, snippet } from './format'

describe('formatLetterDate', () => {
  it('renders a warm long-form date', () => {
    expect(formatLetterDate('2026-02-14T09:30:00.000Z')).toBe('14 February 2026')
  })
})

describe('snippet', () => {
  it('returns short text unchanged', () => {
    expect(snippet('I miss you.', 40)).toBe('I miss you.')
  })

  it('truncates at a word boundary and appends an ellipsis', () => {
    expect(snippet('I have been thinking about you all morning', 20)).toBe('I have been thinking…')
  })

  it('collapses newlines into single spaces', () => {
    expect(snippet('one\n\ntwo', 40)).toBe('one two')
  })
})
