import { getSupabaseClient } from '../lib/supabaseClient'

interface DiscussionRow {
  session_id: string
  group_id: string
  anon_id: string
  participant_id: string
  question_index: number
  slide_id: string
  discussion_log: unknown[]
}

interface DiscussionMessageEntry {
  questionIndex: number
  slideId: string
  anonId: string
  participantId: string
  message: string
  sentAt: string
}

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
  groupId?: string
  anonId?: string
  participantId?: string
  discussionMessages?: unknown[]
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
      group_id: payload.groupId ?? null,
      anon_id: payload.anonId ?? null,
      participant_id: payload.participantId ?? null,
    })
    if (!error) {
      const discussionEntries: DiscussionMessageEntry[] = (payload.discussionMessages ?? [])
        .map((raw) => {
          if (!raw || typeof raw !== 'object') return null
          const m = raw as Record<string, unknown>
          const questionIndex = Number(m.questionIndex)
          const slideId = String(m.slideId ?? '')
          const anonId = String(m.anonId ?? '')
          const participantId = String(m.participantId ?? '')
          const message = String(m.message ?? '')
          const sentAt = String(m.sentAt ?? '')
          if (
            !Number.isFinite(questionIndex) ||
            !slideId ||
            !anonId ||
            !message ||
            !sentAt ||
            !payload.groupId
          ) {
            return null
          }
          return {
            questionIndex,
            slideId,
            anonId,
            participantId,
            message,
            sentAt,
          } satisfies DiscussionMessageEntry
        })
        .filter((row): row is DiscussionMessageEntry => row !== null)

      const groupedRows: DiscussionRow[] = []
      const byQuestion = new Map<string, DiscussionMessageEntry[]>()
      for (const row of discussionEntries) {
        const key = `${row.questionIndex}::${row.slideId}`
        const prev = byQuestion.get(key)
        if (prev) prev.push(row)
        else byQuestion.set(key, [row])
      }

      for (const [, rows] of byQuestion.entries()) {
        const first = rows[0]!
        const questionIndex = first.questionIndex
        const slideId = first.slideId
        const sorted = [...rows].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
        groupedRows.push({
          session_id: payload.sessionId,
          group_id: payload.groupId!,
          anon_id: payload.anonId ?? '',
          participant_id: payload.participantId ?? '',
          question_index: questionIndex,
          slide_id: slideId,
          discussion_log: sorted.map((r) => ({
            anon_id: r.anonId,
            participant_id: r.participantId || null,
            message: r.message,
            sent_at: r.sentAt,
          })),
        })
      }

      // Keep one discussion row per question at group level:
      // only the designated coordinator (P1) writes discussion rows.
      if (groupedRows.length > 0 && payload.anonId === 'P1') {
        const { error: discussionError } = await client.from('discussion_messages').insert(groupedRows)
        if (discussionError) {
          console.error('Supabase discussion_messages insert error:', discussionError)
          return {
            ok: true,
            method: 'supabase',
            error: `Main study data saved, but discussion logs failed to save separately: ${discussionError.message}`,
          }
        }
      }
      return { ok: true, method: 'supabase' }
    }
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
