import { describe, it, expect, vi } from 'vitest'
import {
  cancelledByBondEnding,
  formatLetterDate,
  kathmanduDateTimeToUtcIso,
  snippet,
  todayInKathmandu,
  utcIsoToKathmanduParts,
} from './format'

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

describe('todayInKathmandu', () => {
  it('is a day ahead of UTC late in the UTC evening', () => {
    // 22:00 UTC is 03:45 the next day in Kathmandu (UTC+5:45) — the exact
    // window plain `new Date().toISOString().slice(0, 10)` gets wrong.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-18T22:00:00.000Z'))
      expect(todayInKathmandu()).toBe('2026-09-19')
    } finally {
      vi.useRealTimers()
    }
  })

  it('matches UTC\'s date during the shared morning hours', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-18T10:00:00.000Z'))
      expect(todayInKathmandu()).toBe('2026-09-18')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('kathmanduDateTimeToUtcIso', () => {
  it('converts a Kathmandu morning to the correct UTC instant', () => {
    // 09:00 in Kathmandu (UTC+5:45) is 03:15 UTC the same day.
    expect(kathmanduDateTimeToUtcIso('2026-09-25', '09:00')).toBe('2026-09-25T03:15:00.000Z')
  })

  it('rolls over to the previous UTC day when Kathmandu time is early enough', () => {
    // 02:00 in Kathmandu is 20:15 UTC the day before.
    expect(kathmanduDateTimeToUtcIso('2026-09-25', '02:00')).toBe('2026-09-24T20:15:00.000Z')
  })
})

describe('utcIsoToKathmanduParts', () => {
  it('is the exact inverse of kathmanduDateTimeToUtcIso', () => {
    const utc = kathmanduDateTimeToUtcIso('2026-09-25', '09:00')
    expect(utcIsoToKathmanduParts(utc)).toEqual({ date: '2026-09-25', time: '09:00' })
  })

  it('recovers the pre-midnight-rollover case too', () => {
    const utc = kathmanduDateTimeToUtcIso('2026-09-25', '02:00')
    expect(utcIsoToKathmanduParts(utc)).toEqual({ date: '2026-09-25', time: '02:00' })
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
