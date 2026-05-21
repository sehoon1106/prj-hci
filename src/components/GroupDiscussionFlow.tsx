import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { assetUrl } from '../lib/assetUrl'
import { getSupabaseClient } from '../lib/supabaseClient'
import {
  GROUP_PARTICIPANT_IDS,
  hasGroupQuorum,
  presenceLatestMetas,
  presenceParticipantIds,
  GROUP_BROADCAST_RETRY_DELAYS_MS,
  GROUP_SYNC_TICK_MS,
  broadcastViaChannel,
  scheduleBroadcastRetries,
  uniqueGroupParticipantIds,
  type GroupMemoryProgressPayload,
  type GroupParticipantId,
} from '../lib/groupSync'
import { useGroupPresenceReadyGate } from '../hooks/useGroupPresenceReadyGate'
import {
  appendDiscussionMessageLive,
  fetchDiscussionMessagesForQuestion,
} from '../lib/discussionChatSync'
import { fetchAnsweredAnonIdsForStep } from '../lib/memoryAnswerSync'
import { fetchGroupStepSignalAnons, recordGroupStepSignal } from '../lib/groupStepSignals'
import type { DiscussionMessage, MemoryItemDef } from '../types/study'

function isSameDiscussionMessage(a: DiscussionMessage, b: DiscussionMessage): boolean {
  return (
    a.questionIndex === b.questionIndex &&
    a.slideId === b.slideId &&
    a.anonId === b.anonId &&
    a.message === b.message &&
    a.sentAt === b.sentAt
  )
}

function appendDiscussionMessage(
  prev: DiscussionMessage[],
  incoming: DiscussionMessage,
): DiscussionMessage[] {
  if (prev.some((m) => isSameDiscussionMessage(m, incoming))) return prev
  return [...prev, incoming]
}

type AnonId = GroupParticipantId
const DISCUSSION_NICKNAMES = [
  'BlueFox',
  'GreenOwl',
  'SilverPanda',
  'AmberWhale',
  'CrimsonKoala',
  'IvoryTiger',
  'CopperHawk',
  'VioletDolphin',
  'GoldenFalcon',
  'CobaltRabbit',
  'MintJaguar',
  'CoralOtter',
  'IndigoLynx',
  'ScarletSeal',
  'TealMoose',
  'MaroonEagle',
  'AzureBear',
  'LimeHeron',
  'PlumWolf',
  'OnyxSwan',
  'RubyWhale',
  'KhakiPuma',
  'OliveRaven',
  'PearlShark',
  'SiennaBison',
  'NavyCrane',
  'LavenderMarten',
  'UmberGoose',
  'TurquoiseFennec',
  'MagentaYak',
  'BronzeMole',
  'GraphiteIbis',
  'SandViper',
  'AquaLeopard',
  'CyanBadger',
  'RoseMink',
  'SlateFalcon',
  'HoneyStoat',
  'PinePanther',
  'BlushEgret',
  'MauveStingray',
  'AmberWren',
  'TopazLlama',
  'JadePelican',
  'LilacFerret',
  'CharcoalPuffin',
  'ApricotManatee',
  'SteelKite',
  'MintGazelle',
  'CloverBoar',
  'RustCormorant',
  'CeruleanDingo',
  'OpalCobra',
  'PecanMantis',
  'QuartzTern',
  'FlintMongoose',
  'BurgundyMyna',
  'WillowZebra',
  'PeachPlover',
  'ChestnutSkink',
  'OrchidWalrus',
  'MapleOsprey',
  'IrisGibbon',
  'FogBumblebee',
] as const

/** Distinct hues for dark UI; paired with `${groupId}::colors::${step}` shuffle per question. */
const DISCUSSION_NAME_COLORS = ['#58d8ff', '#c4a8ff', '#f5c862', '#5eead4'] as const

function stableHash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function seededShuffle<T>(arr: T[], seedText: string): T[] {
  const out = [...arr]
  let seed = stableHash(seedText) || 1
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function buildParticipantChatStyle(
  groupId: string,
  step: number,
): Record<AnonId, { nickname: string; color: string }> {
  const ids = seededShuffle<AnonId>(['P1', 'P2', 'P3', 'P4'], `${groupId}::ids::${step}`)
  const shuffledPool = seededShuffle<string>([...DISCUSSION_NICKNAMES], `${groupId}::pool`)
  const chunkStart = (step * 4) % shuffledPool.length
  const selected = Array.from({ length: 4 }, (_, i) => shuffledPool[(chunkStart + i) % shuffledPool.length]!)
  const colors = seededShuffle<string>([...DISCUSSION_NAME_COLORS], `${groupId}::colors::${step}`)
  const map: Record<AnonId, { nickname: string; color: string }> = {
    P1: { nickname: '', color: '' },
    P2: { nickname: '', color: '' },
    P3: { nickname: '', color: '' },
    P4: { nickname: '', color: '' },
  }
  for (let i = 0; i < 4; i += 1) {
    map[ids[i]!] = { nickname: selected[i]!, color: colors[i]! }
  }
  return map
}

export function GroupPhaseStartGate({
  groupId,
  anonId,
  groupSize,
  phaseKey,
  buttonLabel,
  waitingLabel,
  disabled,
  disabledReason,
  onStart,
}: {
  groupId: string
  anonId: AnonId
  groupSize: number
  phaseKey: string
  buttonLabel: string
  waitingLabel?: string
  disabled?: boolean
  disabledReason?: string
  onStart: () => void
}) {
  const trimmedGroupId = groupId.trim()
  const { ready, readyIds, markReady } = useGroupPresenceReadyGate({
    groupId,
    anonId,
    groupSize,
    channelName: `phase-gate:${trimmedGroupId}:${phaseKey}`,
    presenceKey: `${trimmedGroupId}-${phaseKey}-${anonId}`,
    broadcastEvent: 'phase_start',
    getBroadcastPayload: () => ({ phaseKey, at: new Date().toISOString() }),
    getInitialTrackPayload: (localReady) => ({
      anonId,
      ready: localReady,
      phaseKey,
      joinedAt: new Date().toISOString(),
    }),
    getReadyTrackPayload: () => ({
      anonId,
      ready: true,
      phaseKey,
      readyAt: new Date().toISOString(),
    }),
    onQuorum: onStart,
  })

  return (
    <>
      <p className="muted small">Ready: {readyIds.length} / {groupSize}</p>
      {disabled && disabledReason ? <p className="muted small">{disabledReason}</p> : null}
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className="btn primary"
          disabled={Boolean(disabled) || ready}
          onClick={() => void markReady()}
        >
          {ready ? waitingLabel ?? 'Waiting for others…' : buttonLabel}
        </button>
      </div>
    </>
  )
}

export function GroupLobby({
  groupId,
  anonId,
  groupSize,
  onStart,
}: {
  groupId: string
  anonId: AnonId
  groupSize: number
  onStart: () => void
}) {
  const [onlineIds, setOnlineIds] = useState<string[]>([])
  const [duplicateAnonIds, setDuplicateAnonIds] = useState<string[]>([])
  const duplicateIdsRef = useRef<string[]>([])
  const trimmedGroupId = groupId.trim()

  const { ready, readyIds, markReady } = useGroupPresenceReadyGate({
    groupId,
    anonId,
    groupSize,
    channelName: `group-lobby:${trimmedGroupId}`,
    presenceKey: `${trimmedGroupId}-${anonId}`,
    broadcastEvent: 'group_start',
    getBroadcastPayload: () => ({
      startedAt: new Date().toISOString(),
      triggeredBy: anonId,
    }),
    getInitialTrackPayload: (localReady) => ({
      anonId,
      ready: localReady,
      joinedAt: new Date().toISOString(),
    }),
    getReadyTrackPayload: () => ({
      anonId,
      ready: true,
      readyAt: new Date().toISOString(),
    }),
    onQuorum: onStart,
    leaveChannelOnUnmount: true,
    canFireQuorum: () => duplicateIdsRef.current.length === 0,
    onPresenceMetas: (latest) => {
      const ids = latest.map((entry) => String(entry.anonId ?? '')).filter(Boolean)
      const counts = new Map<string, number>()
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
      const duplicated = Array.from(counts.entries())
        .filter(([, n]) => n > 1)
        .map(([id]) => id)
        .sort()
      duplicateIdsRef.current = duplicated
      setOnlineIds(uniqueGroupParticipantIds(ids))
      setDuplicateAnonIds(duplicated)
    },
  })

  return (
    <div className="card">
      <header className="card-header">
        <h2>Group waiting room</h2>
        <p className="muted">All {groupSize} participants must be online and ready.</p>
      </header>
      <p>
        Group: <strong>{groupId}</strong> · You are <strong>{anonId}</strong>
      </p>
      {duplicateAnonIds.length > 0 ? (
        <p className="group-lobby-warning">
          Warning: duplicate anonymous label detected ({duplicateAnonIds.join(', ')}). Someone should refresh and
          choose a different P#.
        </p>
      ) : null}
      <p className="muted small">Online: {onlineIds.join(', ') || 'None yet'}</p>
      <p className="muted small">Ready: {readyIds.join(', ') || 'None yet'}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          disabled={ready}
          onClick={() => void markReady()}
        >
          {ready ? 'Waiting for others…' : 'I am ready'}
        </button>
      </div>
    </div>
  )
}

/** After each client finishes the individual (pre-discussion) memory test, wait until all have finished before the discussion round. */
export function GroupSoloMemoryWaitGate({
  groupId,
  anonId,
  groupSize,
  onProceed,
}: {
  groupId: string
  anonId: AnonId
  groupSize: number
  onProceed: () => void
}) {
  const [doneIds, setDoneIds] = useState<GroupParticipantId[]>(() => [anonId])
  const proceededRef = useRef(false)
  const onProceedRef = useRef(onProceed)
  onProceedRef.current = onProceed
  const localSoloDoneRef = useRef(true)

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return

    /** Union of everyone we've heard from via presence or ping (presence sync can lag per client). */
    const heard = new Set<string>([anonId])
    const subscribedRef = { current: false }

    const triggerProceed = () => {
      if (proceededRef.current) return
      proceededRef.current = true
      onProceedRef.current()
    }

    const channel = client.channel(`memory-solo-wait:${groupId.trim()}`, {
      config: { presence: { key: `${groupId.trim()}-solo-${anonId}` } },
    })

    const sendPing = () => {
      broadcastViaChannel(channel, subscribedRef.current, 'solo_wait_ping', {
        anonId,
        at: new Date().toISOString(),
      })
    }

    const mergeAndUpdate = () => {
      const presence = channel.presenceState<Record<string, unknown[] | unknown>>()
      for (const id of presenceParticipantIds(presence)) heard.add(id)
      const unique = uniqueGroupParticipantIds(heard)
      setDoneIds(unique)
      if (!proceededRef.current && hasGroupQuorum(unique, groupSize)) {
        scheduleBroadcastRetries(() => {
          broadcastViaChannel(channel, subscribedRef.current, 'memory_solo_all_done', {
            at: new Date().toISOString(),
            triggeredBy: anonId,
          })
        })
        triggerProceed()
      }
    }

    channel
      .on('broadcast', { event: 'memory_solo_all_done' }, () => {
        triggerProceed()
      })
      .on('broadcast', { event: 'solo_wait_ping' }, ({ payload }) => {
        const p = payload as { anonId?: string } | undefined
        const id = String(p?.anonId ?? '')
        if (GROUP_PARTICIPANT_IDS.includes(id as GroupParticipantId)) heard.add(id)
        mergeAndUpdate()
      })
      .on('presence', { event: 'sync' }, () => {
        queueMicrotask(mergeAndUpdate)
      })
      .on('presence', { event: 'join' }, () => {
        queueMicrotask(mergeAndUpdate)
      })
      .on('presence', { event: 'leave' }, () => {
        queueMicrotask(mergeAndUpdate)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          subscribedRef.current = true
          await channel.track({
            anonId,
            soloMemoryWait: localSoloDoneRef.current,
            joinedAt: new Date().toISOString(),
          })
          heard.add(anonId)
          sendPing()
          mergeAndUpdate()
          queueMicrotask(mergeAndUpdate)
          window.setTimeout(mergeAndUpdate, 50)
          window.setTimeout(mergeAndUpdate, 250)
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          subscribedRef.current = false
        }
      })

    const pingEveryMs = 1200
    const pingId = window.setInterval(() => {
      sendPing()
      mergeAndUpdate()
    }, pingEveryMs)

    return () => {
      window.clearInterval(pingId)
      void channel.untrack()
      void client.removeChannel(channel)
    }
  }, [anonId, groupId, groupSize])

  return (
    <div className="card">
      <header className="card-header">
        <h2>Waiting for your group</h2>
        <p className="muted">
          You finished the individual memory test. The next step (group discussion per question) starts after everyone completes this part.
        </p>
      </header>
      <p className="muted small">
        Finished: {doneIds.length} / {groupSize}
      </p>
      <p className="muted small">{doneIds.length ? doneIds.join(', ') : '(no signals yet)'}</p>
    </div>
  )
}

export function GroupMemoryPhase({
  title,
  instructions,
  items,
  configItemIndexAtPresentation,
  groupId,
  anonId,
  groupSize,
  sessionId,
  durationSec,
  participantId,
  onLog,
  onMessagePersist,
  onAnswer,
  responses,
  skipCurrentDiscussionSignal,
  onComplete,
}: {
  title: string
  instructions: string
  items: MemoryItemDef[]
  configItemIndexAtPresentation: number[]
  groupId: string
  anonId: AnonId
  groupSize: number
  sessionId: string
  durationSec: number
  participantId?: string
  onLog: (t: string, p?: Record<string, unknown>) => void
  onMessagePersist: (m: DiscussionMessage) => void
  onAnswer: (step: number, recall: 'agree' | 'disagree' | 'unsure', confidence: number) => void
  responses: Array<{ recall: 'agree' | 'disagree' | 'unsure'; confidence: number } | undefined>
  skipCurrentDiscussionSignal?: number
  onComplete: () => void
}) {
  const [step, setStep] = useState(0)
  const [phase, setPhase] = useState<'discussion' | 'answer'>('discussion')
  const [left, setLeft] = useState(durationSec)
  const [recall, setRecall] = useState<'agree' | 'disagree' | 'unsure' | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [messages, setMessages] = useState<DiscussionMessage[]>([])
  const [answeredIds, setAnsweredIds] = useState<string[]>([])
  const [endDiscussionVotes, setEndDiscussionVotes] = useState<string[]>([])
  const [votedToEndDiscussion, setVotedToEndDiscussion] = useState(false)
  const [submittedThisStep, setSubmittedThisStep] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const sentAdvanceForStepRef = useRef<number | null>(null)
  /** Last presentation step we have already advanced past (prevents double step++). */
  const advancedPastStepRef = useRef<number>(-1)
  /** Which step `answeredIds` belong to; blocks stale quorum after step++. */
  const answersForStepRef = useRef(0)
  const stepRef = useRef(step)
  stepRef.current = step
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const itemsRef = useRef(items)
  itemsRef.current = items
  const appliedDiscussionEndRef = useRef<number>(-1)
  const sentDiscussionEndRef = useRef<number | null>(null)
  /** End-discussion votes belong to this step only (blocks stale votes after step++). */
  const endVotesForStepRef = useRef(-1)
  /** True after the countdown has ticked for the current step (blocks stale left===0). */
  const discussionTimerArmedRef = useRef(false)
  const submittedStepRef = useRef<number | null>(null)
  const lastSkipSignalRef = useRef<number>(0)
  const onMessagePersistRef = useRef(onMessagePersist)
  onMessagePersistRef.current = onMessagePersist
  const onLogRef = useRef(onLog)
  onLogRef.current = onLog
  const participantIdRef = useRef(participantId)
  participantIdRef.current = participantId
  const channelReadyRef = useRef(false)
  /** Step index we voted to end (presence survives channel hiccups). */
  const localEndVoteStepRef = useRef<number | null>(null)
  /** Monotonic vote set for current step — never shrink on partial presence snapshots. */
  const endVoteIdsRef = useRef<GroupParticipantId[]>([])
  /** Monotonic answer set for current step — never shrink on partial presence snapshots. */
  const answeredIdsRef = useRef<GroupParticipantId[]>([])
  const localAnswerDoneStepRef = useRef<number | null>(null)
  const peerProgressRef = useRef<Map<string, GroupMemoryProgressPayload>>(new Map())
  // Session IDs advertised by every connected client (incl. self). Used to scope DB-backed
  // quorum queries to the CURRENT run only — without this filter, rows from a previous test
  // with the same `group_id` would erroneously satisfy quorum on a fresh run.
  const peerSessionIdsRef = useRef<Set<string>>(new Set([sessionId]))
  const configItemIndexAtPresentationRef = useRef(configItemIndexAtPresentation)
  configItemIndexAtPresentationRef.current = configItemIndexAtPresentation
  const submittedThisStepRef = useRef(submittedThisStep)
  submittedThisStepRef.current = submittedThisStep
  const item = items[step]
  const total = durationSec > 0 ? durationSec : 1
  const progressPct = Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100)))
  const participantChatStyle = useMemo(() => buildParticipantChatStyle(groupId, step), [groupId, step])
  const uniqueEndVotes = useMemo(
    () => uniqueGroupParticipantIds(endDiscussionVotes),
    [endDiscussionVotes],
  )
  const uniqueAnsweredIds = useMemo(() => uniqueGroupParticipantIds(answeredIds), [answeredIds])

  const tryAdvanceFromStep = useCallback(
    (fromStep: number): boolean => {
      const currentStep = stepRef.current
      if (fromStep !== currentStep) return false
      if (fromStep <= advancedPastStepRef.current) return false
      advancedPastStepRef.current = fromStep
      const nextStep = fromStep + 1

      // Clear quorum before setStep: on the next render, phase/answeredIds can still
      // reflect the previous step for one effect pass and would trigger a second advance.
      answersForStepRef.current = -1
      endVotesForStepRef.current = -1
      answeredIdsRef.current = []
      setAnsweredIds([])
      endVoteIdsRef.current = []
      localAnswerDoneStepRef.current = null
      setEndDiscussionVotes([])
      setVotedToEndDiscussion(false)
      localEndVoteStepRef.current = null
      setSubmittedThisStep(false)
      sentAdvanceForStepRef.current = null
      appliedDiscussionEndRef.current = -1
      sentDiscussionEndRef.current = null
      discussionTimerArmedRef.current = false

      if (nextStep >= items.length) {
        onComplete()
        return true
      }
      peerProgressRef.current.clear()
      setLeft(durationSec)
      setPhase('discussion')
      setStep(nextStep)
      queueMicrotask(() => broadcastMyProgressWithRetriesRef.current())
      return true
    },
    [durationSec, items.length, onComplete],
  )

  const mergeRemoteMessages = useCallback((incoming: DiscussionMessage[]) => {
    if (incoming.length === 0) return
    setMessages((prev) => {
      let next = prev
      for (const m of incoming) {
        if (m.questionIndex !== stepRef.current) continue
        next = appendDiscussionMessage(next, m)
        onMessagePersistRef.current(m)
      }
      return next
    })
  }, [])

  const refreshMessagesFromDb = useCallback(
    async (signal?: AbortSignal) => {
      const client = getSupabaseClient()
      if (!client || !sessionId.trim() || !groupId.trim()) return
      const currentStep = stepRef.current
      const slideId = items[currentStep]?.slideId
      if (!slideId) return
      const fetched = await fetchDiscussionMessagesForQuestion(
        client,
        groupId,
        currentStep,
        slideId,
        signal,
      )
      if (signal?.aborted) return
      mergeRemoteMessages(fetched)
    },
    [groupId, items, mergeRemoteMessages, sessionId],
  )

  const endDiscussionForStep = useCallback(
    (forStep: number, via: string, shouldBroadcast: boolean) => {
      const currentStep = stepRef.current
      if (forStep !== currentStep) return

      if (appliedDiscussionEndRef.current === currentStep) {
        if (phaseRef.current === 'discussion') {
          setPhase('answer')
          setLeft(0)
        }
        return
      }

      appliedDiscussionEndRef.current = currentStep
      const slideId = itemsRef.current[currentStep]?.slideId
      onLogRef.current('group_discussion_ended_by_vote', {
        step: currentStep,
        slideId,
        groupId: groupId.trim(),
        anonId,
        via,
        voters: endVoteIdsRef.current,
      })
      setPhase('answer')
      setLeft(0)
      broadcastMyProgressWithRetriesRef.current()

      // DB-backed fallback: persist the fact that THIS client ended discussion at this step.
      // Lagging peers poll the table and follow regardless of broadcast / presence health.
      const client = getSupabaseClient()
      if (client && groupId.trim()) {
        void recordGroupStepSignal(client, {
          groupId,
          sessionId,
          presentationIndex: currentStep,
          signalType: 'discussion_end',
          anonId,
        })
      }

      if (!shouldBroadcast) return
      if (sentDiscussionEndRef.current === currentStep) return
      sentDiscussionEndRef.current = currentStep

      scheduleBroadcastRetries(
        () => {
          broadcastViaChannel(
            channelRef.current,
            channelReadyRef.current,
            'discussion_end',
            { step: currentStep, at: new Date().toISOString() },
          )
        },
        GROUP_BROADCAST_RETRY_DELAYS_MS,
      )
    },
    [anonId, groupId, sessionId],
  )

  const maybeEndDiscussionFromQuorum = useCallback(() => {
    if (phaseRef.current !== 'discussion') return
    const currentStep = stepRef.current
    if (endVotesForStepRef.current !== currentStep) return
    if (!hasGroupQuorum(endVoteIdsRef.current, groupSize)) return
    endDiscussionForStep(currentStep, 'local_quorum', true)
  }, [endDiscussionForStep, groupSize])

  const applyEndVotes = useCallback(
    (incoming: Iterable<string>) => {
      const currentStep = stepRef.current
      const merged = uniqueGroupParticipantIds([...endVoteIdsRef.current, ...incoming])
      const prevKey = endVoteIdsRef.current.join('|')
      const nextKey = merged.join('|')
      if (prevKey === nextKey) return merged
      endVoteIdsRef.current = merged
      endVotesForStepRef.current = currentStep
      setEndDiscussionVotes(merged)
      if (merged.includes(anonId)) {
        setVotedToEndDiscussion(true)
        localEndVoteStepRef.current = currentStep
      }
      maybeEndDiscussionFromQuorum()
      return merged
    },
    [anonId, maybeEndDiscussionFromQuorum],
  )

  const advanceStepFromAnswerQuorum = useCallback(
    (forStep: number, via: string, shouldBroadcast: boolean) => {
      const currentStep = stepRef.current
      if (forStep !== currentStep) return
      if (phaseRef.current !== 'answer') return
      if (currentStep <= advancedPastStepRef.current) return

      const fromPeerSignal =
        via === 'advance_step_broadcast' || via === 'db_poll_peer_advance'
      if (!fromPeerSignal && !hasGroupQuorum(answeredIdsRef.current, groupSize)) return

      const didAdvance = tryAdvanceFromStep(forStep)
      if (!didAdvance) return

      // DB-backed fallback so lagging clients can follow even when the broadcast is lost.
      const client = getSupabaseClient()
      if (client && groupId.trim()) {
        void recordGroupStepSignal(client, {
          groupId,
          sessionId,
          presentationIndex: forStep,
          signalType: 'step_advance',
          anonId,
        })
      }

      if (!shouldBroadcast) return
      if (sentAdvanceForStepRef.current === forStep) return
      sentAdvanceForStepRef.current = forStep

      scheduleBroadcastRetries(
        () => {
          broadcastViaChannel(
            channelRef.current,
            channelReadyRef.current,
            'advance_step',
            { step: forStep, nextStep: forStep + 1, at: new Date().toISOString() },
          )
        },
        GROUP_BROADCAST_RETRY_DELAYS_MS,
      )
    },
    [anonId, groupId, groupSize, sessionId, tryAdvanceFromStep],
  )

  const maybeAdvanceFromAnswerQuorum = useCallback(() => {
    advanceStepFromAnswerQuorum(stepRef.current, 'local_quorum', true)
  }, [advanceStepFromAnswerQuorum])

  const applyAnsweredIds = useCallback(
    (incoming: Iterable<string>) => {
      const currentStep = stepRef.current
      const merged = uniqueGroupParticipantIds([...answeredIdsRef.current, ...incoming])
      const prevKey = answeredIdsRef.current.join('|')
      const nextKey = merged.join('|')
      if (prevKey === nextKey) return merged
      answeredIdsRef.current = merged
      answersForStepRef.current = currentStep
      setAnsweredIds(merged)
      maybeAdvanceFromAnswerQuorum()
      return merged
    },
    [maybeAdvanceFromAnswerQuorum],
  )

  const syncProgressFromPresence = useCallback(
    (channel: RealtimeChannel) => {
      const currentStep = stepRef.current
      const presence = channel.presenceState<Record<string, unknown[] | unknown>>()
      const latest = presenceLatestMetas(presence)

      // Accumulate known session IDs. We deliberately DO NOT replace the set on each sync —
      // if a peer's presence transiently drops (network blip, Supabase grace period), losing
      // their sessionId would permanently exclude their `study_submissions` / `group_step_signals`
      // rows from quorum and deadlock the run. Once we have seen a sessionId, we keep it.
      peerSessionIdsRef.current.add(sessionId)
      for (const entry of latest) {
        const sid = String((entry as { sessionId?: unknown }).sessionId ?? '').trim()
        if (sid) peerSessionIdsRef.current.add(sid)
      }

      // IMPORTANT: a participant whose presence has `endVoteForStep: null` (never voted yet)
      // must NOT count as a step-0 voter. `Number(null) === 0` is true in JS, so the previous
      // `Number(entry.endVoteForStep) === currentStep` check silently treated every fresh peer
      // as having voted to end discussion at step 0 — which auto-skipped the very first
      // discussion and answer phase. Same trap applies to `answerDoneForStep`. The strict
      // `typeof === 'number'` guard rejects null/undefined explicitly.
      const fromVotePresence = uniqueGroupParticipantIds(
        latest
          .filter((entry) => {
            const v = (entry as { endVoteForStep?: unknown }).endVoteForStep
            return typeof v === 'number' && v === currentStep
          })
          .map((entry) => String(entry.anonId ?? '')),
      )
      if (fromVotePresence.length > 0) applyEndVotes(fromVotePresence)

      const fromAnswerPresence = uniqueGroupParticipantIds(
        latest
          .filter((entry) => {
            const v = (entry as { answerDoneForStep?: unknown }).answerDoneForStep
            return typeof v === 'number' && v === currentStep
          })
          .map((entry) => String(entry.anonId ?? '')),
      )
      if (fromAnswerPresence.length > 0) applyAnsweredIds(fromAnswerPresence)

      maybeEndDiscussionFromQuorum()
      maybeAdvanceFromAnswerQuorum()
    },
    [
      applyAnsweredIds,
      applyEndVotes,
      maybeAdvanceFromAnswerQuorum,
      maybeEndDiscussionFromQuorum,
      sessionId,
    ],
  )

  const buildMyProgressPayload = useCallback((): GroupMemoryProgressPayload => {
    return {
      anonId,
      step: stepRef.current,
      phase: phaseRef.current,
      endVoteForStep: localEndVoteStepRef.current,
      answerDoneForStep: localAnswerDoneStepRef.current,
      at: new Date().toISOString(),
    }
  }, [anonId])

  const broadcastMyProgress = useCallback(() => {
    broadcastViaChannel(
      channelRef.current,
      channelReadyRef.current,
      'group_progress',
      buildMyProgressPayload(),
    )
  }, [buildMyProgressPayload])

  const broadcastMyProgressWithRetries = useCallback(() => {
    scheduleBroadcastRetries(broadcastMyProgress, [200, 600, 1200])
  }, [broadcastMyProgress])

  const reconcileFromPeerProgress = useCallback(() => {
    const currentStep = stepRef.current
    const peers = [...peerProgressRef.current.values()].filter((p) => p.anonId !== anonId)

    const endVoters = uniqueGroupParticipantIds(
      peers
        .filter((p) => p.endVoteForStep === currentStep)
        .map((p) => p.anonId)
        .concat(localEndVoteStepRef.current === currentStep ? [anonId] : []),
    )
    if (endVoters.length > 0) applyEndVotes(endVoters)

    const answerers = uniqueGroupParticipantIds(
      peers
        .filter((p) => p.answerDoneForStep === currentStep)
        .map((p) => p.anonId)
        .concat(localAnswerDoneStepRef.current === currentStep ? [anonId] : []),
    )
    if (answerers.length > 0) applyAnsweredIds(answerers)

    if (phaseRef.current === 'discussion') {
      const peersInAnswerOnStep = peers.filter(
        (p) => p.step === currentStep && p.phase === 'answer',
      ).length
      if (peersInAnswerOnStep >= groupSize - 1) {
        endDiscussionForStep(currentStep, 'peer_progress_phase', false)
      }
    }

    if (phaseRef.current === 'answer') {
      const peersAhead = peers.filter((p) => p.step > currentStep).length
      if (peersAhead >= groupSize - 1) {
        advanceStepFromAnswerQuorum(currentStep, 'peer_progress_step', false)
      }
    }

    maybeEndDiscussionFromQuorum()
    maybeAdvanceFromAnswerQuorum()
  }, [
    advanceStepFromAnswerQuorum,
    anonId,
    applyAnsweredIds,
    applyEndVotes,
    endDiscussionForStep,
    groupSize,
    maybeAdvanceFromAnswerQuorum,
    maybeEndDiscussionFromQuorum,
  ])

  const syncRealtimeProgress = useCallback(
    (channel: RealtimeChannel) => {
      syncProgressFromPresence(channel)
      reconcileFromPeerProgress()
    },
    [reconcileFromPeerProgress, syncProgressFromPresence],
  )

  const applyEndVotesRef = useRef(applyEndVotes)
  applyEndVotesRef.current = applyEndVotes
  const applyAnsweredIdsRef = useRef(applyAnsweredIds)
  applyAnsweredIdsRef.current = applyAnsweredIds
  const maybeEndDiscussionFromQuorumRef = useRef(maybeEndDiscussionFromQuorum)
  maybeEndDiscussionFromQuorumRef.current = maybeEndDiscussionFromQuorum
  const maybeAdvanceFromAnswerQuorumRef = useRef(maybeAdvanceFromAnswerQuorum)
  maybeAdvanceFromAnswerQuorumRef.current = maybeAdvanceFromAnswerQuorum
  const advanceStepFromAnswerQuorumRef = useRef(advanceStepFromAnswerQuorum)
  advanceStepFromAnswerQuorumRef.current = advanceStepFromAnswerQuorum
  const endDiscussionForStepRef = useRef(endDiscussionForStep)
  endDiscussionForStepRef.current = endDiscussionForStep
  const tryAdvanceFromStepRef = useRef(tryAdvanceFromStep)
  tryAdvanceFromStepRef.current = tryAdvanceFromStep
  const syncRealtimeProgressRef = useRef(syncRealtimeProgress)
  syncRealtimeProgressRef.current = syncRealtimeProgress
  const reconcileFromPeerProgressRef = useRef(reconcileFromPeerProgress)
  reconcileFromPeerProgressRef.current = reconcileFromPeerProgress
  const broadcastMyProgressRef = useRef(broadcastMyProgress)
  broadcastMyProgressRef.current = broadcastMyProgress
  const broadcastMyProgressWithRetriesRef = useRef(broadcastMyProgressWithRetries)
  broadcastMyProgressWithRetriesRef.current = broadcastMyProgressWithRetries

  useEffect(() => {
    if (phase !== 'discussion') return
    let inFlight = false
    const controller = new AbortController()
    const tick = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      try {
        await refreshMessagesFromDb(controller.signal)
      } finally {
        inFlight = false
      }
    }
    void tick()
    const pollId = window.setInterval(() => void tick(), 1500)
    return () => {
      window.clearInterval(pollId)
      controller.abort()
    }
  }, [phase, refreshMessagesFromDb, step])

  useEffect(() => {
    answersForStepRef.current = step
    endVotesForStepRef.current = step
    discussionTimerArmedRef.current = false
    setPhase('discussion')
    setLeft(durationSec)
    setMessages([])
    answeredIdsRef.current = []
    setAnsweredIds([])
    endVoteIdsRef.current = []
    setEndDiscussionVotes([])
    setVotedToEndDiscussion(false)
    localEndVoteStepRef.current = null
    localAnswerDoneStepRef.current = null
    peerProgressRef.current.clear()
    appliedDiscussionEndRef.current = -1
    sentDiscussionEndRef.current = null
    sentAdvanceForStepRef.current = null
    setSubmittedThisStep(false)
    setRecall(responses[step]?.recall ?? null)
    setConfidence(responses[step]?.confidence ?? null)
  }, [durationSec, step])

  useEffect(() => {
    if (phase !== 'discussion' || left <= 0) return
    discussionTimerArmedRef.current = true
    const id = window.setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => window.clearTimeout(id)
  }, [phase, left])

  useEffect(() => {
    if (phase !== 'discussion' || left > 0) return
    if (!discussionTimerArmedRef.current) return
    if (appliedDiscussionEndRef.current === step) return
    appliedDiscussionEndRef.current = step
    onLog('group_discussion_timeout', { step, slideId: item.slideId })
    setLeft(0)
    setPhase('answer')
    const client = getSupabaseClient()
    if (client && groupId.trim()) {
      void recordGroupStepSignal(client, {
        groupId,
        sessionId,
        presentationIndex: step,
        signalType: 'discussion_end',
        anonId,
      })
    }
  }, [anonId, groupId, item.slideId, left, onLog, phase, sessionId, step])

  const voteToEndDiscussion = () => {
    if (phase !== 'discussion' || votedToEndDiscussion) return
    const currentStep = stepRef.current
    applyEndVotes([anonId])
    const channel = channelRef.current
    if (channel) {
      void channel
        .track({
          anonId,
          sessionId,
          endVoteForStep: currentStep,
          endVoteAt: new Date().toISOString(),
        })
        .then(() => {
          syncRealtimeProgress(channel)
          broadcastMyProgressWithRetries()
        })
    }
    scheduleBroadcastRetries(
      () => {
        broadcastViaChannel(
          channelRef.current,
          channelReadyRef.current,
          'end_discussion_vote',
          { step: currentStep, anonId, at: new Date().toISOString() },
        )
      },
      GROUP_BROADCAST_RETRY_DELAYS_MS,
    )
    broadcastMyProgressWithRetries()
    const client = getSupabaseClient()
    if (client && groupId.trim()) {
      void recordGroupStepSignal(client, {
        groupId,
        sessionId,
        presentationIndex: currentStep,
        signalType: 'end_vote',
        anonId,
      })
    }
    maybeEndDiscussionFromQuorum()
  }

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return
    const trimmedGroupId = groupId.trim()
    const channel = client.channel(`memory-discussion:${trimmedGroupId}`, {
      config: { presence: { key: `${trimmedGroupId}-${anonId}` } },
    })
    channelRef.current = channel
    channelReadyRef.current = false

    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const incoming = payload as DiscussionMessage
        if (incoming.questionIndex !== stepRef.current) return
        if (incoming.anonId === anonId) return
        setMessages((prev) => appendDiscussionMessage(prev, incoming))
        onMessagePersistRef.current(incoming)
      })
      .on('broadcast', { event: 'group_progress' }, ({ payload }) => {
        const incoming = payload as GroupMemoryProgressPayload
        if (!incoming?.anonId || incoming.anonId === anonId) return
        if (!GROUP_PARTICIPANT_IDS.includes(incoming.anonId as GroupParticipantId)) return
        peerProgressRef.current.set(incoming.anonId, incoming)
        reconcileFromPeerProgressRef.current()
      })
      .on('broadcast', { event: 'answer_done' }, ({ payload }) => {
        const typedPayload = payload as Record<string, unknown> | undefined
        const forStep = Number(typedPayload?.step ?? -1)
        if (forStep !== stepRef.current) return
        const id = String(typedPayload?.anonId ?? '')
        if (!GROUP_PARTICIPANT_IDS.includes(id as GroupParticipantId)) return
        applyAnsweredIdsRef.current([id])
        maybeAdvanceFromAnswerQuorumRef.current()
      })
      .on('broadcast', { event: 'end_discussion_vote' }, ({ payload }) => {
        const typedPayload = payload as Record<string, unknown> | undefined
        const forStep = Number(typedPayload?.step ?? -1)
        if (forStep !== stepRef.current) return
        const id = String(typedPayload?.anonId ?? '')
        if (!GROUP_PARTICIPANT_IDS.includes(id as GroupParticipantId)) return
        applyEndVotesRef.current([id])
      })
      .on('presence', { event: 'sync' }, () => {
        syncRealtimeProgressRef.current(channel)
      })
      .on('broadcast', { event: 'discussion_end' }, ({ payload }) => {
        const typedPayload = payload as Record<string, unknown> | undefined
        const forStep = Number(typedPayload?.step ?? -1)
        if (!Number.isFinite(forStep)) return
        endDiscussionForStepRef.current(forStep, 'discussion_end_broadcast', false)
      })
      .on('broadcast', { event: 'advance_step' }, ({ payload }) => {
        const typedPayload = payload as Record<string, unknown> | undefined
        const forStep = Number(typedPayload?.step ?? -1)
        if (!Number.isFinite(forStep)) return
        advanceStepFromAnswerQuorumRef.current(forStep, 'advance_step_broadcast', false)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          channelReadyRef.current = true
          const currentStep = stepRef.current
          await channel.track({
            anonId,
            sessionId,
            step: currentStep,
            phase: phaseRef.current,
            endVoteForStep: localEndVoteStepRef.current,
            answerDoneForStep: localAnswerDoneStepRef.current,
            joinedAt: new Date().toISOString(),
          })
          syncRealtimeProgressRef.current(channel)
          broadcastMyProgressWithRetriesRef.current()
          if (localEndVoteStepRef.current === currentStep) {
            scheduleBroadcastRetries(
              () => {
                broadcastViaChannel(
                  channel,
                  channelReadyRef.current,
                  'end_discussion_vote',
                  { step: currentStep, anonId, at: new Date().toISOString() },
                )
              },
              GROUP_BROADCAST_RETRY_DELAYS_MS,
            )
          }
          if (localAnswerDoneStepRef.current === currentStep) {
            scheduleBroadcastRetries(
              () => {
                broadcastViaChannel(
                  channel,
                  channelReadyRef.current,
                  'answer_done',
                  {
                    step: currentStep,
                    anonId,
                    answeredAt: new Date().toISOString(),
                  },
                )
              },
              GROUP_BROADCAST_RETRY_DELAYS_MS,
            )
          }
          maybeEndDiscussionFromQuorumRef.current()
          maybeAdvanceFromAnswerQuorumRef.current()
          onLogRef.current('group_discussion_join', {
            groupId: trimmedGroupId,
            step: currentStep,
            configItemIndex: configItemIndexAtPresentationRef.current[currentStep],
            slideId: itemsRef.current[currentStep]?.slideId,
            anonId,
          })
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          channelReadyRef.current = false
        }
      })
    return () => {
      channelReadyRef.current = false
      void channel.untrack()
      void client.removeChannel(channel)
    }
  }, [anonId, groupId])

  useEffect(() => {
    maybeEndDiscussionFromQuorum()
  }, [maybeEndDiscussionFromQuorum, phase, step, uniqueEndVotes.length])

  useEffect(() => {
    maybeAdvanceFromAnswerQuorum()
  }, [maybeAdvanceFromAnswerQuorum, phase, step, uniqueAnsweredIds.length])

  useEffect(() => {
    const tick = () => {
      const ch = channelRef.current
      if (!ch) return
      syncRealtimeProgressRef.current(ch)
      broadcastMyProgressRef.current()
      if (phaseRef.current === 'discussion') {
        maybeEndDiscussionFromQuorumRef.current()
      } else if (phaseRef.current === 'answer') {
        advanceStepFromAnswerQuorumRef.current(stepRef.current, 'answer_recovery_tick', true)
      }
    }
    tick()
    const id = window.setInterval(tick, GROUP_SYNC_TICK_MS)
    return () => window.clearInterval(id)
  }, [phase, step])

  useEffect(() => {
    broadcastMyProgressWithRetries()
  }, [broadcastMyProgressWithRetries, phase, step])

  useEffect(() => {
    const channel = channelRef.current
    if (!channel || !channelReadyRef.current) return
    void channel.track({
      anonId,
      sessionId,
      step: stepRef.current,
      phase: phaseRef.current,
      endVoteForStep: localEndVoteStepRef.current,
      answerDoneForStep: localAnswerDoneStepRef.current,
      progressAt: new Date().toISOString(),
    })
    broadcastMyProgressWithRetriesRef.current()
  }, [anonId, phase, sessionId, step])

  // Three concurrent polls fire every ~1.5s. Without an in-flight guard AND an AbortController,
  // a slow round-trip plus the React effect re-mount per step transition let pending fetches
  // pile up indefinitely in the browser connection pool — eventually surfacing as
  // `net::ERR_INSUFFICIENT_RESOURCES` and blocking even the final submit. Both guards together
  // ensure: (a) only one fetch per poll type is in flight at any moment, (b) leftover fetches
  // from a previous step/phase are cancelled, freeing connections immediately.
  useEffect(() => {
    if (phase !== 'answer') return
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return
    let cancelled = false
    let inFlight = false
    const controller = new AbortController()
    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const stepAtRequest = stepRef.current
        const knownSessionIds = [...peerSessionIdsRef.current]
        const answered = await fetchAnsweredAnonIdsForStep(client, {
          groupId,
          sessionIds: knownSessionIds,
          presentationIndex: stepAtRequest,
          memoryRound: 'post_discussion',
          signal: controller.signal,
        })
        if (cancelled) return
        if (stepAtRequest !== stepRef.current) return
        if (answered.length === 0) return
        applyAnsweredIdsRef.current(answered)
        maybeAdvanceFromAnswerQuorumRef.current()
      } finally {
        inFlight = false
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1500)
    return () => {
      cancelled = true
      window.clearInterval(id)
      controller.abort()
    }
  }, [groupId, phase, step])

  // DB-backed fallback for end-of-discussion sync. Realtime broadcasts can be dropped
  // or rate-limited, so we also persist (a) each vote and (b) the fact that ANY peer
  // finalised the discussion. A lagging client follows as soon as either condition is
  // visible in the DB, even if WS / presence sync goes silent for them.
  useEffect(() => {
    if (phase !== 'discussion') return
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return
    let cancelled = false
    let inFlight = false
    const controller = new AbortController()
    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const stepAtRequest = stepRef.current
        const knownSessionIds = [...peerSessionIdsRef.current]
        const [voters, enders] = await Promise.all([
          fetchGroupStepSignalAnons(client, {
            groupId,
            sessionIds: knownSessionIds,
            presentationIndex: stepAtRequest,
            signalType: 'end_vote',
            signal: controller.signal,
          }),
          fetchGroupStepSignalAnons(client, {
            groupId,
            sessionIds: knownSessionIds,
            presentationIndex: stepAtRequest,
            signalType: 'discussion_end',
            signal: controller.signal,
          }),
        ])
        if (cancelled) return
        if (stepAtRequest !== stepRef.current) return
        if (phaseRef.current !== 'discussion') return
        if (voters.length > 0) {
          applyEndVotesRef.current(voters)
          maybeEndDiscussionFromQuorumRef.current()
        }
        if (enders.length > 0) {
          // At least one peer has already ended this discussion -> follow them.
          endDiscussionForStepRef.current(stepAtRequest, 'db_poll_peer_end', false)
        }
      } finally {
        inFlight = false
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1500)
    return () => {
      cancelled = true
      window.clearInterval(id)
      controller.abort()
    }
  }, [groupId, phase, step])

  // DB-backed fallback for step advance during the answer phase. If any peer has already
  // advanced past the current step (recorded as a `step_advance` signal), this client should
  // follow even when its WS / presence sync is silent.
  useEffect(() => {
    if (phase !== 'answer') return
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return
    let cancelled = false
    let inFlight = false
    const controller = new AbortController()
    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const stepAtRequest = stepRef.current
        const knownSessionIds = [...peerSessionIdsRef.current]
        const advancers = await fetchGroupStepSignalAnons(client, {
          groupId,
          sessionIds: knownSessionIds,
          presentationIndex: stepAtRequest,
          signalType: 'step_advance',
          signal: controller.signal,
        })
        if (cancelled) return
        if (stepAtRequest !== stepRef.current) return
        if (phaseRef.current !== 'answer') return
        if (advancers.length === 0) return
        advanceStepFromAnswerQuorumRef.current(stepAtRequest, 'db_poll_peer_advance', false)
      } finally {
        inFlight = false
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1500)
    return () => {
      cancelled = true
      window.clearInterval(id)
      controller.abort()
    }
  }, [groupId, phase, step])

  useEffect(() => {
    if (!skipCurrentDiscussionSignal) return
    if (skipCurrentDiscussionSignal <= lastSkipSignalRef.current) return
    lastSkipSignalRef.current = skipCurrentDiscussionSignal
    if (phase !== 'discussion') return
    onMessagePersist({
      questionIndex: step,
      slideId: item.slideId,
      anonId,
      participantId,
      message: '[debug] skipped current discussion',
      sentAt: new Date().toISOString(),
    })
    onLog('group_discussion_debug_skip', { step, slideId: item.slideId, anonId, source: 'overlay' })
    setLeft(0)
    setPhase('answer')
  }, [anonId, item.slideId, onLog, onMessagePersist, participantId, phase, skipCurrentDiscussionSignal, step])

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const currentStep = stepRef.current
    const slideId = items[currentStep]?.slideId
    if (!slideId) return
    const msg: DiscussionMessage = {
      questionIndex: currentStep,
      slideId,
      anonId,
      participantId: participantIdRef.current,
      message: trimmed,
      sentAt: new Date().toISOString(),
    }
    setMessages((prev) => appendDiscussionMessage(prev, msg))
    onMessagePersistRef.current(msg)

    const client = getSupabaseClient()
    if (client && sessionId.trim() && groupId.trim()) {
      void appendDiscussionMessageLive(client, {
        sessionId,
        groupId,
        anonId,
        participantId: participantIdRef.current,
        message: msg,
      })
    }

    scheduleBroadcastRetries(() => {
      broadcastViaChannel(channelRef.current, channelReadyRef.current, 'message', msg)
    })
  }

  const submitAnswer = () => {
    if (!recall || confidence === null) return
    const currentStep = stepRef.current
    onAnswer(currentStep, recall, confidence)
    submittedStepRef.current = currentStep
    setSubmittedThisStep(true)
    localAnswerDoneStepRef.current = currentStep
    applyAnsweredIds([anonId])
    const channel = channelRef.current
    if (channel) {
      void channel
        .track({
          anonId,
          sessionId,
          endVoteForStep: localEndVoteStepRef.current,
          answerDoneForStep: currentStep,
          answerDoneAt: new Date().toISOString(),
        })
        .then(() => {
          syncRealtimeProgress(channel)
          broadcastMyProgressWithRetries()
        })
    }
    scheduleBroadcastRetries(
      () => {
        broadcastViaChannel(
          channelRef.current,
          channelReadyRef.current,
          'answer_done',
          {
            step: currentStep,
            anonId,
            answeredAt: new Date().toISOString(),
          },
        )
      },
      GROUP_BROADCAST_RETRY_DELAYS_MS,
    )
    broadcastMyProgressWithRetries()
    maybeAdvanceFromAnswerQuorum()
  }

  return (
    <div className="card memory-card">
      <header className="card-header">
        <h2>{title}</h2>
        <p className="muted">{instructions}</p>
        <p className="small muted">
          {step + 1} / {items.length}
        </p>
      </header>
      <img src={assetUrl(item.maskedSrc)} alt="" className="masked-img" />
      {phase === 'discussion' ? (
        <div className="discussion-wrap">
          <p className="timer">Discussion time left: {left}s</p>
          <div
            className="discussion-time-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
          >
            <div className="discussion-time-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <ChatBox
            messages={messages}
            onSend={sendMessage}
            participantChatStyle={participantChatStyle}
            myAnonId={anonId}
            systemPrompt={item.prompt}
          />
          <div className="discussion-end-vote">
            <p className="muted small">
              Votes to end discussion: {uniqueEndVotes.length} / {groupSize}
            </p>
            <button
              type="button"
              className="btn secondary discussion-end-vote-btn"
              disabled={votedToEndDiscussion}
              onClick={voteToEndDiscussion}
            >
              {votedToEndDiscussion
                ? 'You voted to end — waiting for others'
                : 'Vote to end discussion'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="memory-prompt">{item.prompt}</p>
          <div className="recall-row">
            {(
              [
                ['agree', 'Agree'],
                ['disagree', 'Disagree'],
                ['unsure', 'Not sure'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`btn choice ${recall === v ? 'active' : ''}`}
                onClick={() => setRecall(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <fieldset className="survey-fieldset">
            <legend className="survey-prompt">How confident are you? (1–7)</legend>
            <div className="likert-row">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <label key={n} className="likert-cell">
                  <input
                    type="radio"
                    name={`conf-${step}`}
                    checked={confidence === n}
                    onChange={() => setConfidence(n)}
                  />
                  <span>{n}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              disabled={!recall || confidence === null || submittedThisStep}
              onClick={submitAnswer}
            >
              {submittedThisStep
                ? `Waiting for others… (${uniqueAnsweredIds.length}/${groupSize})`
                : step + 1 >= items.length
                  ? 'Submit answer'
                  : 'Submit answer'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ChatBox({
  messages,
  onSend,
  participantChatStyle,
  myAnonId,
  systemPrompt,
}: {
  messages: DiscussionMessage[]
  onSend: (text: string) => Promise<void>
  participantChatStyle: Record<AnonId, { nickname: string; color: string }>
  myAnonId: AnonId
  systemPrompt: string
}) {
  const [draft, setDraft] = useState('')
  const list = useMemo(() => messages.slice(-80), [messages])
  const logRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    if (!logRef.current || !stickToBottomRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [list.length])

  const updateStickiness = () => {
    if (!logRef.current) return
    const el = logRef.current
    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 24
    stickToBottomRef.current = nearBottom
  }

  return (
    <div className="chat-box">
      <div ref={logRef} className="chat-log" onScroll={updateStickiness}>
        <p className="chat-msg chat-msg-system">{systemPrompt}</p>
        {list.map((m, idx) => {
          const aid = m.anonId as AnonId
          const style = participantChatStyle[aid]
          const label = style?.nickname?.trim() ? style.nickname : 'Anon'
          const color = style?.color ?? '#dbe0ee'
          const isMe = aid === myAnonId
          return (
            <p key={`${m.sentAt}-${idx}`} className="chat-msg">
              <strong className="chat-msg-name" style={{ color }}>
                {label}
                {isMe ? <span className="chat-msg-me"> (me)</span> : null}:
              </strong>{' '}
              {m.message}
            </p>
          )
        })}
      </div>
      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault()
          void onSend(draft)
          setDraft('')
        }}
      >
        <input
          className="survey-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type your message"
          maxLength={240}
        />
        <button type="submit" className="btn secondary" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
