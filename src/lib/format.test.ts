import { describe, it, expect } from 'vitest'
import { cancelledByBondEnding, formatLetterDate, snippet } from './format'

describe('formatLetterDate', () => {
  it('renders a warm long-form date', () => {
    expect(formatLetterDate('2026-02-14T09:30:00.000Z')).toBe('14 February 2026')
  })
})

describe('cancelledByBondEnding', () => {
  it('is false for a letter still pending (no deletion at all)', () => {
    expect(cancelledByBondEnding(null, '2026-09-25')).toBe(false)
  })

  it('is true when the deletion timestamp is before scheduledFor — unlink_partner can only fire while pending', () => {
    expect(cancelledByBondEnding('2026-09-20T14:30:00.000Z', '2026-09-25')).toBe(true)
  })

  it('is false when the deletion timestamp is on scheduledFor\'s own day — the letter delivered that day before being deleted', () => {
    expect(cancelledByBondEnding('2026-09-25T08:00:00.000Z', '2026-09-25')).toBe(false)
  })

  it('is false when the deletion timestamp is well after scheduledFor — a genuine delivery, read, then ordinary receiver delete', () => {
    expect(cancelledByBondEnding('2026-10-02T09:15:00.000Z', '2026-09-25')).toBe(false)
  })

  it('is false for a non-scheduled letter (scheduledFor null) even if receiverDeletedAt is set', () => {
    expect(cancelledByBondEnding('2026-09-20T14:30:00.000Z', null)).toBe(false)
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
