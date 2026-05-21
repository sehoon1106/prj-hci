import type { SupabaseClient } from '@supabase/supabase-js'
import { uniqueGroupParticipantIds, type GroupParticipantId } from './groupSync'

/**
 * Realtime broadcasts and presence can drop or be rate-limited. To keep the 4-person
 * coordination deadlock-free, every per-step signal (end-of-discussion vote, answer ack)
 * is *also* persisted to `group_step_signals` and polled from each client. The DB row is
 * the source of truth for "did this participant complete this step's signal?".
 */
export type GroupStepSignalType =
  | 'end_vote'
  | 'answer_done'
  | 'discussion_end'
  | 'step_advance'

export async function recordGroupStepSignal(
  client: SupabaseClient,
  params: {
    groupId: string
    sessionId: string
    presentationIndex: number
    signalType: GroupStepSignalType
    anonId: string
  },
): Promise<void> {
  const groupId = params.groupId.trim()
  const sessionId = params.sessionId.trim()
  const anonId = params.anonId.trim()
  if (!groupId || !sessionId || !anonId) return
  const { error } = await client.rpc('record_group_step_signal', {
    p_group_id: groupId,
    p_session_id: sessionId,
    p_presentation_index: params.presentationIndex,
    p_signal_type: params.signalType,
    p_anon_id: anonId,
  })
  if (error) {
    console.warn('[group signal] record failed:', error.message)
  }
}

/**
 * Scoped per-session lookup: a stale row from a previous test run with the same
 * `group_id` MUST not satisfy the new run's quorum, so callers pass in the set of
 * session IDs known to belong to the current group's active participants.
 */
export async function fetchGroupStepSignalAnons(
  client: SupabaseClient,
  params: {
    groupId: string
    sessionIds: string[]
    presentationIndex: number
    signalType: GroupStepSignalType
  },
): Promise<GroupParticipantId[]> {
  const groupId = params.groupId.trim()
  const sessionIds = params.sessionIds.map((s) => s.trim()).filter(Boolean)
  if (!groupId || sessionIds.length === 0) return []
  const { data, error } = await client
    .from('group_step_signals')
    .select('anon_id')
    .eq('group_id', groupId)
    .eq('presentation_index', params.presentationIndex)
    .eq('signal_type', params.signalType)
    .in('session_id', sessionIds)
  if (error) {
    console.warn('[group signal] fetch failed:', error.message)
    return []
  }
  const ids = (data ?? [])
    .map((row) => String((row as { anon_id?: string | null }).anon_id ?? ''))
    .filter(Boolean)
  return uniqueGroupParticipantIds(ids)
}
