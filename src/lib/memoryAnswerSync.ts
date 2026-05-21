import type { SupabaseClient } from '@supabase/supabase-js'
import { uniqueGroupParticipantIds, type GroupParticipantId } from './groupSync'
import type { MemoryResponse } from '../types/study'

export type MemoryAnswerRound = 'pre_discussion' | 'post_discussion'

/** Persist one memory trial to the participant's session row (merged in DB). */
export async function persistMemoryAnswerLive(
  client: SupabaseClient,
  params: {
    sessionId: string
    groupId: string
    anonId: string
    participantId?: string
    conditionKey: string
    memoryRound: MemoryAnswerRound
    answer: MemoryResponse
  },
): Promise<void> {
  const answer: MemoryResponse = {
    ...params.answer,
    memoryRound: params.answer.memoryRound ?? params.memoryRound,
  }
  const { error } = await client.rpc('upsert_study_memory_answer', {
    p_session_id: params.sessionId,
    p_group_id: params.groupId.trim(),
    p_anon_id: params.anonId,
    p_participant_id: params.participantId ?? '',
    p_condition_key: params.conditionKey,
    p_answer: answer,
  })
  if (error) {
    console.warn('[memory answer] live persist failed:', error.message)
  }
}

/**
 * DB-backed quorum: who in this group has already submitted an answer for the given
 * presentation step + round? Used as a reliability backstop when Realtime broadcasts drop.
 *
 * Scoped per-session: callers pass in the set of session_ids belonging to the current
 * run's participants, otherwise stale `study_submissions` rows from a previous test
 * (same `group_id`, different `session_id`) would prematurely satisfy quorum.
 */
export async function fetchAnsweredAnonIdsForStep(
  client: SupabaseClient,
  params: {
    groupId: string
    sessionIds: string[]
    presentationIndex: number
    memoryRound: MemoryAnswerRound
  },
): Promise<GroupParticipantId[]> {
  const sessionIds = params.sessionIds.map((s) => s.trim()).filter(Boolean)
  if (sessionIds.length === 0) return []
  const { data, error } = await client
    .from('study_submissions')
    .select('anon_id, memory_responses')
    .eq('group_id', params.groupId.trim())
    .in('session_id', sessionIds)
  if (error) {
    console.warn('[memory answer] fetch acks failed:', error.message)
    return []
  }
  const matched: string[] = []
  for (const row of data ?? []) {
    const r = row as { anon_id?: string | null; memory_responses?: unknown }
    const anonId = String(r.anon_id ?? '')
    if (!anonId) continue
    const arr = r.memory_responses
    if (!Array.isArray(arr)) continue
    const hit = arr.some((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const e = entry as Record<string, unknown>
      return (
        Number(e.presentationIndex) === params.presentationIndex &&
        String(e.memoryRound ?? '') === params.memoryRound
      )
    })
    if (hit) matched.push(anonId)
  }
  return uniqueGroupParticipantIds(matched)
}
