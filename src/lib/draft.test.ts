import { describe, it, expect } from 'vitest'
import { clearDraft, draftKey, readDraft, writeDraft } from './draft'
import type { LetterDraft, StorageLike } from './draft'

/** A plain object standing in for localStorage. No jsdom involved. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    } satisfies StorageLike,
  }
}

/** Storage that throws on every access, as a private window does. */
const hostileStorage: StorageLike = {
  getItem() {
    throw new DOMException('denied')
  },
  setItem() {
    throw new DOMException('denied')
  },
  removeItem() {
    throw new DOMException('denied')
  },
}

const draft: LetterDraft = {
  message: 'I walked past the bakery today and thought of you.',
  salutation: 'Jee',
  bodyFont: 'caveat',
  savedAt: '2026-09-21T04:15:00.000Z',
}

describe('draftKey', () => {
  it('namespaces the key by user', () => {
    expect(draftKey('user-a')).toBe('dearjee:draft:user-a')
  })
})

describe('readDraft / writeDraft', () => {
  it('round-trips a draft', () => {
    const { storage } = fakeStorage()
    writeDraft(storage, 'user-a', draft)
    expect(readDraft(storage, 'user-a')).toEqual(draft)
  })

  it('returns null when nothing is stored', () => {
    const { storage } = fakeStorage()
    expect(readDraft(storage, 'user-a')).toBeNull()
  })

  it("does not leak one user's draft to another on the same device", () => {
    const { storage } = fakeStorage()
    writeDraft(storage, 'user-a', draft)
    expect(readDraft(storage, 'user-b')).toBeNull()
  })

  it('reads malformed JSON as no draft', () => {
    const { storage } = fakeStorage({ 'dearjee:draft:user-a': 'not json{' })
    expect(readDraft(storage, 'user-a')).toBeNull()
  })

  it('reads a non-object as no draft', () => {
    const { storage } = fakeStorage({ 'dearjee:draft:user-a': 'null' })
    expect(readDraft(storage, 'user-a')).toBeNull()
  })

  it('rejects an entry whose message is missing or not a string', () => {
    const { storage } = fakeStorage({
      'dearjee:draft:user-a': JSON.stringify({ ...draft, message: 42 }),
    })
    expect(readDraft(storage, 'user-a')).toBeNull()
  })

  it('rejects an entry whose salutation is not a string', () => {
    const { storage } = fakeStorage({
      'dearjee:draft:user-a': JSON.stringify({ ...draft, salutation: null }),
    })
    expect(readDraft(storage, 'user-a')).toBeNull()
  })

  it('rejects an entry whose savedAt is not a string', () => {
    const { storage } = fakeStorage({
      'dearjee:draft:user-a': JSON.stringify({ ...draft, savedAt: 0 }),
    })
    expect(readDraft(storage, 'user-a')).toBeNull()
  })

  it('rejects a font this app cannot write in', () => {
    const { storage } = fakeStorage({
      'dearjee:draft:user-a': JSON.stringify({ ...draft, bodyFont: 'comic-sans' }),
    })
    expect(readDraft(storage, 'user-a')).toBeNull()
  })

  it('accepts a null font, which means the default face', () => {
    const { storage } = fakeStorage()
    writeDraft(storage, 'user-a', { ...draft, bodyFont: null })
    expect(readDraft(storage, 'user-a')?.bodyFont).toBeNull()
  })

  it('keeps an empty salutation, which is a real value and not an absence', () => {
    const { storage } = fakeStorage()
    writeDraft(storage, 'user-a', { ...draft, salutation: '' })
    expect(readDraft(storage, 'user-a')?.salutation).toBe('')
  })
})

describe('clearDraft', () => {
  it("removes only that user's draft", () => {
    const { storage, map } = fakeStorage()
    writeDraft(storage, 'user-a', draft)
    writeDraft(storage, 'user-b', draft)
    clearDraft(storage, 'user-a')
    expect(map.has('dearjee:draft:user-a')).toBe(false)
    expect(map.has('dearjee:draft:user-b')).toBe(true)
  })
})

describe('a storage that throws, as in a private window', () => {
  it('reads as no draft rather than propagating', () => {
    expect(readDraft(hostileStorage, 'user-a')).toBeNull()
  })

  it('writes without propagating', () => {
    expect(() => writeDraft(hostileStorage, 'user-a', draft)).not.toThrow()
  })

  it('clears without propagating', () => {
    expect(() => clearDraft(hostileStorage, 'user-a')).not.toThrow()
  })
})
