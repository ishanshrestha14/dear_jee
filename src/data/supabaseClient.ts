import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True when both env values are present. When false the app runs on the
 * in-memory mock, which is the intended state until the project exists.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

/**
 * The single client for the app. Null when unconfigured — callers must
 * check `isSupabaseConfigured()` first rather than assuming a client.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
