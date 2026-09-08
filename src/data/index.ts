import { createMockRepositories, MOCK_USER_ID } from './mockRepository'

/**
 * The single swap point between mock and real data.
 *
 * Phase 3 adds `createSupabaseRepositories()` and selects it here when
 * VITE_SUPABASE_URL is present.
 *
 * `currentUserId` below is a module-level constant standing in for auth.
 * Under real auth the signed-in user's id is only known after an async
 * session fetch, and it changes on sign-in/sign-out — it cannot stay a
 * static export. Phase 3 must thread the user id through as an argument
 * or context instead; `useLetters`, which currently imports it directly
 * and runs its load effect with `[]` deps, will need that id in its
 * dependency array so it can re-run when the signed-in user changes.
 */
const repositories = createMockRepositories()

export const letterRepository = repositories.letters
export const profileRepository = repositories.profiles

/** Stands in for the signed-in user until auth arrives in Phase 3. */
export const currentUserId = MOCK_USER_ID

export type { Letter, Profile, PublicLetter, Result } from './types'
