import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { assetUrl } from '../lib/assetUrl'
import { getSupabaseClient } from '../lib/supabaseClient'
import type { DiscussionMessage, MemoryItemDef } from '../types/study'

type AnonId = 'P1' | 'P2' | 'P3' | 'P4'
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

/** `anonId` values from realtime presence payloads (handles per-key arrays of metas). */
function presenceAnonIds(channel: RealtimeChannel): string[] {
  const raw = channel.presenceState() as Record<string, unknown>
  const ids: string[] = []
  for (const bucket of Object.values(raw)) {
    const list = Array.isArray(bucket) ? bucket : bucket != null ? [bucket] : []
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const o = entry as Record<string, unknown>
      const id = o.anonId != null ? String(o.anonId) : ''
      if (id) ids.push(id)
    }
  }
  return ids
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
  const [ready, setReady] = useState(false)
  const [readyIds, setReadyIds] = useState<string[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return
    const channel = client.channel(`phase-gate:${groupId.trim()}:${phaseKey}`, {
      config: { presence: { key: `${groupId.trim()}-${phaseKey}-${anonId}` } },
    })
    channelRef.current = channel
    const triggerStart = () => {
      if (startedRef.current) return
      startedRef.current = true
      onStart()
    }
    const sync = () => {
      const presence = channel.presenceState<Record<string, unknown>>()
      const ids = Object.values(presence)
        .flat()
        .filter((entry) => Boolean(entry.ready))
        .map((entry) => String(entry.anonId ?? ''))
        .filter(Boolean)
      const uniqueReady = Array.from(new Set(ids)).sort()
      setReadyIds(uniqueReady)
      if (!startedRef.current && uniqueReady.length >= groupSize) {
        void channel.send({
          type: 'broadcast',
          event: 'phase_start',
          payload: { phaseKey, at: new Date().toISOString() },
        })
        triggerStart()
      }
    }
    channel
      .on('broadcast', { event: 'phase_start' }, () => triggerStart())
      .on('presence', { event: 'sync' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            anonId,
            ready: false,
            phaseKey,
            joinedAt: new Date().toISOString(),
          })
        }
      })
    return () => {
      void channel.untrack()
      void client.removeChannel(channel)
    }
  }, [anonId, groupId, groupSize, onStart, phaseKey])

  return (
    <>
      <p className="muted small">Ready: {readyIds.length} / {groupSize}</p>
      {disabled && disabledReason ? <p className="muted small">{disabledReason}</p> : null}
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className="btn primary"
          disabled={Boolean(disabled) || ready}
          onClick={async () => {
            setReady(true)
            await channelRef.current?.track({
              anonId,
              ready: true,
              phaseKey,
              readyAt: new Date().toISOString(),
            })
          }}
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
  const [readyIds, setReadyIds] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const startedRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return
    const channel = client.channel(`group-lobby:${groupId.trim()}`, {
      config: { presence: { key: `${groupId.trim()}-${anonId}` } },
    })
    channelRef.current = channel
    const leaveLobby = () => {
      void channel.untrack()
      void client.removeChannel(channel)
    }
    const triggerStart = () => {
      if (startedRef.current) return
      startedRef.current = true
      onStart()
    }
    const sync = () => {
      const presence = channel.presenceState<Record<string, unknown>>()
      // Supabase presence can keep multiple metas per same presence key after track updates.
      // Normalize to "latest meta per key" to avoid false duplicate detection.
      const latestByKey = Object.entries(presence)
        .map(([, metas]) => {
          const list = Array.isArray(metas) ? metas : [metas]
          return list.length > 0 ? (list[list.length - 1] as Record<string, unknown>) : null
        })
        .filter((entry): entry is Record<string, unknown> => entry !== null)

      const ids = latestByKey
        .map((entry) => String(entry.anonId ?? ''))
        .filter(Boolean)
      const counts = new Map<string, number>()
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
      const duplicated = Array.from(counts.entries())
        .filter(([, n]) => n > 1)
        .map(([id]) => id)
        .sort()
      setOnlineIds(Array.from(new Set(ids)).sort())
      setDuplicateAnonIds(duplicated)
      const readySet = latestByKey
        .filter((entry) => Boolean(entry.ready))
        .map((entry) => String(entry.anonId ?? ''))
      const uniqueReady = Array.from(new Set(readySet)).sort()
      setReadyIds(uniqueReady)
      if (!startedRef.current && duplicated.length === 0 && uniqueReady.length >= groupSize) {
        void channel.send({
          type: 'broadcast',
          event: 'group_start',
          payload: {
            startedAt: new Date().toISOString(),
            triggeredBy: anonId,
          },
        })
        triggerStart()
      }
    }
    channel
      .on('broadcast', { event: 'group_start' }, () => {
        triggerStart()
      })
      .on('presence', { event: 'sync' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ anonId, ready: false, joinedAt: new Date().toISOString() })
        }
      })
    window.addEventListener('pagehide', leaveLobby)
    window.addEventListener('beforeunload', leaveLobby)
    return () => {
      window.removeEventListener('pagehide', leaveLobby)
      window.removeEventListener('beforeunload', leaveLobby)
      leaveLobby()
    }
  }, [anonId, groupId, groupSize, onStart])

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
          onClick={async () => {
            setReady(true)
            await channelRef.current?.track({
              anonId,
              ready: true,
              readyAt: new Date().toISOString(),
            })
          }}
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
  const [doneIds, setDoneIds] = useState<string[]>([])
  const proceededRef = useRef(false)
  const onProceedRef = useRef(onProceed)
  onProceedRef.current = onProceed

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return

    /** Union of everyone we've heard from via presence or ping (presence sync can lag per client). */
    const heard = new Set<string>([anonId])

    const triggerProceed = () => {
      if (proceededRef.current) return
      proceededRef.current = true
      onProceedRef.current()
    }

    const channel = client.channel(`memory-solo-wait:${groupId.trim()}`, {
      config: { presence: { key: `${groupId.trim()}-solo-${anonId}` } },
    })

    const sendPing = () => {
      void channel.send({
        type: 'broadcast',
        event: 'solo_wait_ping',
        payload: { anonId, at: new Date().toISOString() },
      })
    }

    const mergeAndUpdate = () => {
      for (const id of presenceAnonIds(channel)) heard.add(id)
      const unique = Array.from(heard).sort()
      setDoneIds(unique)
      if (!proceededRef.current && unique.length >= groupSize) {
        void channel.send({
          type: 'broadcast',
          event: 'memory_solo_all_done',
          payload: { at: new Date().toISOString(), triggeredBy: anonId },
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
        if (id) heard.add(id)
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
          await channel.track({
            anonId,
            soloMemoryWait: true,
            joinedAt: new Date().toISOString(),
          })
          sendPing()
          queueMicrotask(mergeAndUpdate)
          window.setTimeout(mergeAndUpdate, 50)
          window.setTimeout(mergeAndUpdate, 250)
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
  durationSec,
  prompt,
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
  durationSec: number
  prompt?: string
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
  const [submittedThisStep, setSubmittedThisStep] = useState(false)
  const [advanceForStep, setAdvanceForStep] = useState<number | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const sentAdvanceForStepRef = useRef<number | null>(null)
  const appliedAdvanceForStepRef = useRef<number>(-1)
  const advancedStepRef = useRef<number>(-1)
  const submittedStepRef = useRef<number | null>(null)
  const lastSkipSignalRef = useRef<number>(0)
  const item = items[step]
  const total = durationSec > 0 ? durationSec : 1
  const progressPct = Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100)))
  const participantChatStyle = useMemo(() => buildParticipantChatStyle(groupId, step), [groupId, step])

  useEffect(() => {
    setPhase('discussion')
    setLeft(durationSec)
    setMessages([])
    setAnsweredIds([])
    setSubmittedThisStep(false)
    setAdvanceForStep(null)
    setRecall(responses[step]?.recall ?? null)
    setConfidence(responses[step]?.confidence ?? null)
  }, [durationSec, step])

  useEffect(() => {
    if (phase !== 'discussion' || left <= 0) return
    const id = window.setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => window.clearTimeout(id)
  }, [phase, left])

  useEffect(() => {
    if (phase === 'discussion' && left <= 0) {
      onLog('group_discussion_timeout', { step, slideId: item.slideId })
      setPhase('answer')
    }
  }, [item.slideId, left, onLog, phase, step])

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client) return
    const channel = client.channel(`memory-discussion:${groupId}:${step}`)
    channelRef.current = channel
    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const incoming = payload as DiscussionMessage
        setMessages((prev) => [...prev, incoming])
        onMessagePersist(incoming)
      })
      .on('broadcast', { event: 'answer_done' }, ({ payload }) => {
        const typedPayload = payload as Record<string, unknown> | undefined
        const forStep = Number(typedPayload?.step ?? -1)
        if (forStep !== step) return
        const id = String(typedPayload?.anonId ?? '')
        if (!id) return
        setAnsweredIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      })
      .on('broadcast', { event: 'advance_step' }, ({ payload }) => {
        const typedPayload = payload as Record<string, unknown> | undefined
        const forStep = Number(typedPayload?.step ?? -1)
        if (forStep !== step) return
        if (forStep <= appliedAdvanceForStepRef.current) return
        appliedAdvanceForStepRef.current = forStep
        setAdvanceForStep(forStep)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          onLog('group_discussion_join', {
            groupId,
            step,
            configItemIndex: configItemIndexAtPresentation[step],
            slideId: item.slideId,
            anonId,
          })
        }
      })
    return () => {
      void client.removeChannel(channel)
    }
  }, [anonId, groupId, item.slideId, onLog, step, configItemIndexAtPresentation])

  useEffect(() => {
    if (!submittedThisStep || phase !== 'answer') return
    if (advanceForStep === step) return
    if (submittedStepRef.current !== step) return
    if (answeredIds.length < groupSize) return
    const coordinator = [...answeredIds].sort()[0]
    if (anonId !== coordinator) return
    if (sentAdvanceForStepRef.current === step) return
    sentAdvanceForStepRef.current = step
    appliedAdvanceForStepRef.current = step
    setAdvanceForStep(step)
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'advance_step',
      payload: {
        step,
        nextStep: step + 1,
        at: new Date().toISOString(),
      },
    })
  }, [submittedThisStep, phase, advanceForStep, answeredIds, groupSize, step, anonId])

  useEffect(() => {
    if (advanceForStep === null) return
    if (advanceForStep < step) {
      setAdvanceForStep(null)
      return
    }
    if (advanceForStep !== step) return
    if (advancedStepRef.current === step) {
      setAdvanceForStep(null)
      return
    }
    advancedStepRef.current = step
    if (step + 1 >= items.length) {
      setAdvanceForStep(null)
      onComplete()
      return
    }
    setAdvanceForStep(null)
    setStep(advanceForStep + 1)
  }, [advanceForStep, items.length, onComplete, step])

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
    const msg: DiscussionMessage = {
      questionIndex: step,
      slideId: item.slideId,
      anonId,
      participantId,
      message: trimmed,
      sentAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, msg])
    onMessagePersist(msg)
    await channelRef.current?.send({ type: 'broadcast', event: 'message', payload: msg })
  }

  const submitAnswer = () => {
    if (!recall || confidence === null) return
    onAnswer(step, recall, confidence)
    submittedStepRef.current = step
    setSubmittedThisStep(true)
    setAnsweredIds((prev) => (prev.includes(anonId) ? prev : [...prev, anonId]))
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'answer_done',
      payload: {
        step,
        anonId,
        answeredAt: new Date().toISOString(),
      },
    })
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
            systemPrompt={prompt?.trim() || 'What do you think was in the masked area?'}
          />
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
                ? `Waiting for others… (${answeredIds.length}/${groupSize})`
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
