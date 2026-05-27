import { conditionExposureForSlide } from '../lib/groupConditionAssignment'
import type { GroupSlideConditionExposure } from '../lib/groupConditionAssignment'
import { getSupabaseClient } from '../lib/supabaseClient'

interface DiscussionRow {
  session_id: string
  group_id: string
  anon_id: string
  participant_id: string
  question_index: number
  slide_id: string
  discussion_log: DiscussionLogEntry[]
  condition_exposure: GroupSlideConditionExposure | null
}

interface DiscussionLogEntry {
  anon_id: string
  participant_id: string | null
  message: string
  sent_at: string
}

interface DiscussionMessageEntry {
  questionIndex: number
  slideId: string
  anonId: string
  participantId: string
  message: string
  sentAt: string
}

export interface StudySubmissionExportRow {
  session_id: string
  condition_key: string
  submitted_at: string
  user_agent: string
  schema_version: number
  demographics: Record<string, unknown>
  pre_survey: Record<string, unknown>
  attention2: Record<string, unknown>
  post_survey: Record<string, unknown>
  memory_responses: unknown[]
  event_log: unknown[]
  filler_stats: Record<string, unknown>
  group_id: string | null
  anon_id: string | null
  participant_id: string | null
  group_condition_by_slide: Record<string, string> | null
  group_condition_exposure_table: unknown[] | null
}

/** Same shape as rows upserted into `public.discussion_messages`. */
export type DiscussionMessageExportRow = DiscussionRow

/** JSON backup mirrors Supabase table rows (snake_case column names). */
export interface SupabaseStudyExport {
  study_submission: StudySubmissionExportRow
  discussion_messages: DiscussionMessageExportRow[]
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
  /** Group mode: slideId → `no_edit` | `ai_edited_image` for this participant. */
  groupConditionBySlide?: Record<string, string>
  /** Group mode: full 2×2 assignment table (same for all group members). */
  groupConditionExposureTable?: unknown[]
}

function parseDiscussionEntries(payload: SubmissionPayload): DiscussionMessageEntry[] {
  return (payload.discussionMessages ?? [])
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
}

function buildDiscussionMessageRows(payload: SubmissionPayload): DiscussionMessageExportRow[] {
  const discussionEntries = parseDiscussionEntries(payload)
  if (discussionEntries.length === 0 || !payload.groupId) return []

  const exposureTable = (payload.groupConditionExposureTable ?? []) as GroupSlideConditionExposure[]
  const groupedRows: DiscussionMessageExportRow[] = []
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
      group_id: payload.groupId,
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
      condition_exposure: conditionExposureForSlide(exposureTable, slideId) ?? null,
    })
  }

  return groupedRows
}

/** Build the exact row shapes written to Supabase (`study_submissions` + `discussion_messages`). */
export function buildSupabaseExport(payload: SubmissionPayload): SupabaseStudyExport {
  return {
    study_submission: {
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
      group_condition_by_slide: payload.groupConditionBySlide ?? null,
      group_condition_exposure_table: payload.groupConditionExposureTable ?? null,
    },
    discussion_messages: buildDiscussionMessageRows(payload),
  }
}

function downloadStudyExport(data: SupabaseStudyExport) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `study-${data.study_submission.session_id}-${Date.now()}.json`
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
  const exportData = buildSupabaseExport(payload)
  const client = getSupabaseClient()
  if (client) {
    const { error } = await client.from('study_submissions').upsert(exportData.study_submission, {
      onConflict: 'session_id',
    })
    if (!error) {
      // Merge per-question discussion rows at DB level.
      // Any participant may submit; DB function dedupes/merges by (group_id, question_index, slide_id).
      if (exportData.discussion_messages.length > 0) {
        for (const row of exportData.discussion_messages) {
          const { error: rpcError } = await client.rpc('upsert_discussion_log_row', {
            p_session_id: row.session_id,
            p_group_id: row.group_id,
            p_anon_id: row.anon_id,
            p_participant_id: row.participant_id,
            p_question_index: row.question_index,
            p_slide_id: row.slide_id,
            p_discussion_log: row.discussion_log,
            p_condition_exposure: row.condition_exposure,
          })
          if (!rpcError) continue

          // Fallback for environments where the RPC function is not installed yet.
          const { error: fallbackError } = await client.from('discussion_messages').upsert(row, {
            onConflict: 'group_id,question_index,slide_id',
          })
          if (fallbackError) {
            console.error('Supabase discussion_messages upsert error:', fallbackError)
            downloadStudyExport(exportData)
            return {
              ok: true,
              method: 'supabase',
              error: `Main study data saved, but discussion logs failed to save separately: ${fallbackError.message}`,
            }
          }
        }
      }
      downloadStudyExport(exportData)
      return { ok: true, method: 'supabase' }
    }
    console.error('Supabase insert error:', error)
    downloadStudyExport(exportData)
    return {
      ok: true,
      method: 'download',
      error: `Supabase save failed; saved locally as JSON instead: ${error.message}`,
    }
  }
  downloadStudyExport(exportData)
  return {
    ok: true,
    method: 'download',
    error:
      'This build has no Supabase URL/key (they must be set as GitHub Actions secrets or variables when the site is built, then redeploy).',
  }
}
