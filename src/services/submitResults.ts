import { getSupabaseClient } from '../lib/supabaseClient'

export interface SubmissionPayload {
  schemaVersion: number
  sessionId: string
  conditionKey: string
  submittedAt: string
  userAgent: string
  demographics: Record<string, unknown>
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

/**
 * Saving to Supabase requires a `study_submissions` table in the public schema.
 * See public/supabase-schema.sql for the SQL.
 */
export async function submitResults(
  payload: SubmissionPayload,
): Promise<{ ok: boolean; method: 'supabase' | 'download' | 'failed'; error?: string }> {
  const client = getSupabaseClient()
  if (client) {
    const { error } = await client.from('study_submissions').insert({
      session_id: payload.sessionId,
      condition_key: payload.conditionKey,
      submitted_at: payload.submittedAt,
      user_agent: payload.userAgent,
      schema_version: payload.schemaVersion,
      demographics: payload.demographics,
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
  return {
    ok: true,
    method: 'download',
    error:
      'This build has no Supabase URL/key (they must be set as GitHub Actions secrets or variables when the site is built, then redeploy).',
  }
}
