/** Shared helpers for 4-person group realtime sync (quorum + broadcast retries). */

import type { RealtimeChannel } from '@supabase/supabase-js'

export const GROUP_PARTICIPANT_IDS = ['P1', 'P2', 'P3', 'P4'] as const
export type GroupParticipantId = (typeof GROUP_PARTICIPANT_IDS)[number]

export function uniqueGroupParticipantIds(ids: Iterable<string>): GroupParticipantId[] {
  const seen = new Set<GroupParticipantId>()
  for (const raw of ids) {
    if (GROUP_PARTICIPANT_IDS.includes(raw as GroupParticipantId)) {
      seen.add(raw as GroupParticipantId)
    }
  }
  return GROUP_PARTICIPANT_IDS.filter((id) => seen.has(id))
}

export function hasGroupQuorum(ids: Iterable<string>, groupSize: number): boolean {
  return uniqueGroupParticipantIds(ids).length >= groupSize
}

/** One meta per presence key (latest wins) — avoids stale ready:false after rapid track(). */
export function presenceLatestMetas(
  presence: Record<string, unknown[] | unknown>,
): Record<string, unknown>[] {
  return Object.values(presence)
    .map((metas) => {
      const list = Array.isArray(metas) ? metas : [metas]
      return list.length > 0 ? (list[list.length - 1] as Record<string, unknown>) : null
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null)
}

export function presenceParticipantIds(
  presence: Record<string, unknown[] | unknown>,
): GroupParticipantId[] {
  return uniqueGroupParticipantIds(
    presenceLatestMetas(presence)
      .map((entry) => String(entry.anonId ?? ''))
      .filter(Boolean),
  )
}

export function presenceReadyParticipantIds(
  presence: Record<string, unknown[] | unknown>,
): GroupParticipantId[] {
  return uniqueGroupParticipantIds(
    presenceLatestMetas(presence)
      .filter((entry) => Boolean(entry.ready))
      .map((entry) => String(entry.anonId ?? '')),
  )
}

/**
 * Pull the `sessionId` advertised by each peer's latest presence meta. Used to scope
 * DB-backed quorum queries to the CURRENT run, so leftover rows from previous tests
 * (same group_id, different session_id) do not pollute quorum.
 */
export function presenceSessionIds(
  presence: Record<string, unknown[] | unknown>,
): string[] {
  const seen = new Set<string>()
  for (const entry of presenceLatestMetas(presence)) {
    const raw = String((entry as { sessionId?: unknown }).sessionId ?? '').trim()
    if (raw) seen.add(raw)
  }
  return [...seen]
}

/**
 * Send a realtime broadcast immediately and retry so one dropped message does not deadlock the group.
 * Returns a cleanup function (clear pending retries).
 */
/** Retries for group-critical broadcasts (votes, step advance, discussion end). */
export const GROUP_BROADCAST_RETRY_DELAYS_MS = [1500, 3000, 6000, 10_000]

export function scheduleBroadcastRetries(
  send: () => void,
  delaysMs: number[] = GROUP_BROADCAST_RETRY_DELAYS_MS,
): () => void {
  send()
  const timers = delaysMs.map((ms) => window.setTimeout(send, ms))
  return () => {
    for (const id of timers) window.clearTimeout(id)
  }
}

/**
 * Broadcast that uses WS when the channel is joined and explicit REST (httpSend) otherwise.
 * Avoids the implicit REST-fallback deprecation warning while still delivering the message.
 */
/**
 * Both `channel.send()` and the internal `httpSend()` return Promises that can reject with
 * `AbortError` when the underlying request is aborted (timeouts, channel transitions, etc).
 * Without a rejection handler these surface as `Uncaught (in promise) AbortError` in DevTools
 * and were drowning the console during testing. This helper attaches a no-op `.catch` to
 * keep delivery best-effort while keeping the console clean.
 */
function fireAndForget(result: unknown): void {
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    ;(result as Promise<unknown>).catch(() => {
      /* swallow: best-effort delivery */
    })
  }
}

export function broadcastViaChannel(
  channel: RealtimeChannel | null,
  isReady: boolean,
  event: string,
  payload: unknown,
): void {
  if (!channel) return
  if (isReady) {
    try {
      fireAndForget(channel.send({ type: 'broadcast', event, payload }))
    } catch {
      /* swallow */
    }
    return
  }
  const channelAny = channel as unknown as {
    httpSend?: (event: string, payload: unknown) => unknown
  }
  if (typeof channelAny.httpSend === 'function') {
    try {
      fireAndForget(channelAny.httpSend(event, payload))
    } catch {
      /* swallow */
    }
  } else {
    try {
      fireAndForget(channel.send({ type: 'broadcast', event, payload }))
    } catch {
      /* swallow */
    }
  }
}

/** Heartbeat payload so every client can reconcile step/phase/votes without fragile one-off events. */
export type GroupMemoryProgressPayload = {
  anonId: string
  step: number
  phase: 'discussion' | 'answer'
  endVoteForStep: number | null
  answerDoneForStep: number | null
  at: string
}

export const GROUP_PROGRESS_HEARTBEAT_MS = 4000
export const GROUP_SYNC_TICK_MS = 1500
