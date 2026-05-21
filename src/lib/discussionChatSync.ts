import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscussionMessage } from '../types/study'

function dbEntryToMessage(
  entry: unknown,
  questionIndex: number,
  slideId: string,
): DiscussionMessage | null {
  if (!entry || typeof entry !== 'object') return null
  const o = entry as Record<string, unknown>
  const anonId = String(o.anon_id ?? o.anonId ?? '')
  const message = String(o.message ?? '')
  const sentAt = String(o.sent_at ?? o.sentAt ?? '')
  if (!anonId || !message || !sentAt) return null
  const participantId = o.participant_id ?? o.participantId
  return {
    questionIndex,
    slideId,
    anonId,
    participantId: participantId != null ? String(participantId) : undefined,
    message,
    sentAt,
  }
}

/** Append one chat line to the shared group row (deduped in DB). */
export async function appendDiscussionMessageLive(
  client: SupabaseClient,
  params: {
    sessionId: string
    groupId: string
    anonId: string
    participantId?: string
    message: DiscussionMessage
    conditionExposure?: unknown
  },
): Promise<void> {
  const { message } = params
  const row = {
    anon_id: message.anonId,
    participant_id: message.participantId ?? null,
    message: message.message,
    sent_at: message.sentAt,
  }
  const { error } = await client.rpc('upsert_discussion_log_row', {
    p_session_id: params.sessionId,
    p_group_id: params.groupId.trim(),
    p_anon_id: params.anonId,
    p_participant_id: params.participantId ?? '',
    p_question_index: message.questionIndex,
    p_slide_id: message.slideId,
    p_discussion_log: [row],
    p_condition_exposure: params.conditionExposure ?? null,
  })
  if (error) {
    console.warn('[discussion chat] live append failed:', error.message)
  }
}

export async function fetchDiscussionMessagesForQuestion(
  client: SupabaseClient,
  groupId: string,
  questionIndex: number,
  slideId: string,
  signal?: AbortSignal,
): Promise<DiscussionMessage[]> {
  if (signal?.aborted) return []
  let query = client
    .from('discussion_messages')
    .select('discussion_log')
    .eq('group_id', groupId.trim())
    .eq('question_index', questionIndex)
    .eq('slide_id', slideId)
    .maybeSingle()
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query

  if (error) {
    if (signal?.aborted) return []
    console.warn('[discussion chat] fetch failed:', error.message)
    return []
  }

  const raw = data?.discussion_log
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => dbEntryToMessage(entry, questionIndex, slideId))
    .filter((m): m is DiscussionMessage => m !== null)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}
