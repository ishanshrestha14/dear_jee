import { createMockRepositories } from './mockRepository'
import { createSupabaseRepositories } from './supabaseRepository'
import { isSupabaseConfigured } from './supabaseClient'

/**
 * The single swap point between mock and real data.
 *
 * With no .env the app runs on the in-memory mock, which is how it is
 * developed and how the test suite runs. With VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY present it talks to Postgres. Nothing above this
 * module knows which is active.
 */
const repositories = isSupabaseConfigured()
  ? createSupabaseRepositories()
  : createMockRepositories()

export const letterRepository = repositories.letters
export const profileRepository = repositories.profiles
export const bondRepository = repositories.bonds

/** Which adapter is live. */
export const usingSupabase = isSupabaseConfigured()

// Surfaced at boot so "which backend am I talking to?" is never a guess.
// Dev only — this must not appear in a production console.
if (import.meta.env.DEV) {
  console.info(`[dear-jee] data source: ${usingSupabase ? 'supabase' : 'mock'}`)
}

export type { Bond, Letter, Profile, PublicLetter, Result } from './types'
