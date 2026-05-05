import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { assetUrl } from '../lib/assetUrl'
import { getSupabaseClient } from '../lib/supabaseClient'
import type { DiscussionMessage, MemoryItemDef } from '../types/study'
import { DebugSkipBar } from '../lib/debugUi'

type AnonId = 'P1' | 'P2' | 'P3' | 'P4'

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
    const triggerStart = () => {
      if (startedRef.current) return
      startedRef.current = true
      onStart()
    }
    const sync = () => {
      const presence = channel.presenceState<Record<string, unknown>>()
      const ids = Object.values(presence)
        .flat()
        .map((entry) => String(entry.anonId ?? ''))
        .filter(Boolean)
      setOnlineIds(Array.from(new Set(ids)).sort())
      const readySet = Object.values(presence)
        .flat()
        .filter((entry) => Boolean(entry.ready))
        .map((entry) => String(entry.anonId ?? ''))
      const uniqueReady = Array.from(new Set(readySet)).sort()
      setReadyIds(uniqueReady)
      if (!startedRef.current && uniqueReady.length >= groupSize) {
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
    return () => {
      void channel.untrack()
      void client.removeChannel(channel)
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
  onLog,
  onMessagePersist,
  onAnswer,
  responses,
  onDebugSkip,
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
  onLog: (t: string, p?: Record<string, unknown>) => void
  onMessagePersist: (m: DiscussionMessage) => void
  onAnswer: (step: number, recall: 'agree' | 'disagree' | 'unsure', confidence: number) => void
  responses: Array<{ recall: 'agree' | 'disagree' | 'unsure'; confidence: number } | undefined>
  onDebugSkip: () => void
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
  const [advancePending, setAdvancePending] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const sentAdvanceForStepRef = useRef<number | null>(null)
  const appliedAdvanceForStepRef = useRef<number | null>(null)
  const item = items[step]
  const total = durationSec > 0 ? durationSec : 1
  const progressPct = Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100)))

  useEffect(() => {
    setPhase('discussion')
    setLeft(durationSec)
    setMessages([])
    setAnsweredIds([])
    setSubmittedThisStep(false)
    setAdvancePending(false)
    sentAdvanceForStepRef.current = null
    appliedAdvanceForStepRef.current = null
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
      })
      .on('broadcast', { event: 'answer_done' }, ({ payload }) => {
        const id = String((payload as Record<string, unknown>).anonId ?? '')
        if (!id) return
        setAnsweredIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      })
      .on('broadcast', { event: 'advance_step' }, ({ payload }) => {
        const typedPayload = payload as Record<string, unknown> | undefined
        const forStep = Number(typedPayload?.step ?? -1)
        if (forStep !== step) return
        if (appliedAdvanceForStepRef.current === step) return
        appliedAdvanceForStepRef.current = step
        setAdvancePending(true)
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
    if (!submittedThisStep || phase !== 'answer' || advancePending) return
    if (answeredIds.length < groupSize) return
    const coordinator = [...answeredIds].sort()[0]
    if (anonId !== coordinator) return
    if (sentAdvanceForStepRef.current === step) return
    sentAdvanceForStepRef.current = step
    appliedAdvanceForStepRef.current = step
    setAdvancePending(true)
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'advance_step',
      payload: {
        step,
        nextStep: step + 1,
        at: new Date().toISOString(),
      },
    })
  }, [submittedThisStep, phase, advancePending, answeredIds, groupSize, step, anonId])

  useEffect(() => {
    if (!advancePending) return
    if (step + 1 >= items.length) {
      setAdvancePending(false)
      onComplete()
      return
    }
    setAdvancePending(false)
    setStep((s) => s + 1)
  }, [advancePending, items.length, onComplete, step])

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const msg: DiscussionMessage = {
      questionIndex: step,
      slideId: item.slideId,
      anonId,
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
      <DebugSkipBar>
        <button type="button" className="btn debug-skip" onClick={onDebugSkip}>
          [Debug] Skip group memory (fill answers + fake chat)
        </button>
      </DebugSkipBar>
      <img src={assetUrl(item.maskedSrc)} alt="" className="masked-img" />
      {phase === 'discussion' ? (
        <div className="discussion-wrap">
          {prompt ? <p className="muted">{prompt}</p> : null}
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
          <ChatBox messages={messages} onSend={sendMessage} />
          <DebugSkipBar>
            <button
              type="button"
              className="btn debug-skip"
              onClick={() => {
                onMessagePersist({
                  questionIndex: step,
                  slideId: item.slideId,
                  anonId,
                  message: '[debug] skipped discussion timer',
                  sentAt: new Date().toISOString(),
                })
                onLog('group_discussion_debug_skip', { step, slideId: item.slideId, anonId })
                setLeft(0)
                setPhase('answer')
              }}
            >
              [Debug] Skip this discussion
            </button>
          </DebugSkipBar>
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
}: {
  messages: DiscussionMessage[]
  onSend: (text: string) => Promise<void>
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
        {list.map((m, idx) => (
          <p key={`${m.sentAt}-${idx}`} className="chat-msg">
            <strong>{m.anonId}:</strong> {m.message}
          </p>
        ))}
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
