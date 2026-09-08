import { createMockRepositories, MOCK_USER_ID } from './mockRepository'

/**
 * The single swap point between mock and real data.
 *
 * Phase 3 adds `createSupabaseRepositories()` and selects it here when
 * VITE_SUPABASE_URL is present. Nothing above this module changes.
 */
const repositories = createMockRepositories()

export const letterRepository = repositories.letters
export const profileRepository = repositories.profiles

/** Stands in for the signed-in user until auth arrives in Phase 3. */
export const currentUserId = MOCK_USER_ID

export type { Letter, Profile, PublicLetter, Result } from './types'
