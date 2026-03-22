import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null
let loggedMissingSupabaseEnv = false

/** Single browser client: anonymous inserts (study) + Auth sessions (team dashboard). */
export function getSupabaseClient(): SupabaseClient | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  if (!url || !key) {
    if (import.meta.env.DEV && !loggedMissingSupabaseEnv) {
      loggedMissingSupabaseEnv = true
      console.info(
        '[memory-study] Supabase is off: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
          'Add them to .env, then restart the dev server. See .env.example.',
      )
    }
    return null
  }
  if (!supabaseClient) {
    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return supabaseClient
}
