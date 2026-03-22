import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SubmissionPayload {
  schemaVersion: number
  sessionId: string
  conditionKey: string
  submittedAt: string
  userAgent: string
  preSurvey: Record<string, unknown>
  attention2: Record<string, unknown>
  postSurvey: Record<string, unknown>
  memoryResponses: unknown[]
  eventLog: unknown[]
  fillerStats?: Record<string, unknown>
}

function downloadJson(data: SubmissionPayload) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `study-${data.sessionId}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

let supabaseClient: SupabaseClient | null = null
let loggedMissingSupabaseEnv = false

function getSupabase(): SupabaseClient | null {
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
  if (!supabaseClient) supabaseClient = createClient(url, key)
  return supabaseClient
}

/**
 * Saving to Supabase requires a `study_submissions` table in the public schema.
 * See public/supabase-schema.sql for the SQL.
 */
export async function submitResults(
  payload: SubmissionPayload,
): Promise<{ ok: boolean; method: 'supabase' | 'download' | 'failed'; error?: string }> {
  const client = getSupabase()
  if (client) {
    const { error } = await client.from('study_submissions').insert({
      session_id: payload.sessionId,
      condition_key: payload.conditionKey,
      submitted_at: payload.submittedAt,
      user_agent: payload.userAgent,
      schema_version: payload.schemaVersion,
      pre_survey: payload.preSurvey,
      attention2: payload.attention2,
      post_survey: payload.postSurvey,
      memory_responses: payload.memoryResponses,
      event_log: payload.eventLog,
      filler_stats: payload.fillerStats ?? {},
    })
    if (!error) return { ok: true, method: 'supabase' }
    console.error('Supabase insert error:', error)
    downloadJson(payload)
    return {
      ok: true,
      method: 'download',
      error: `Supabase save failed; saved locally as JSON instead: ${error.message}`,
    }
  }
  downloadJson(payload)
  return { ok: true, method: 'download' }
}
