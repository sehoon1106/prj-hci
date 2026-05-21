import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStudySession } from '../session/StudySessionContext'
import { SurveyRunner } from './SurveyRunner'
import { FillerPacMan } from './FillerPacMan'
import {
  GroupLobby,
  GroupMemoryPhase,
  GroupPhaseStartGate,
  GroupSoloMemoryWaitGate,
} from './GroupDiscussionFlow'
import { assetUrl } from '../lib/assetUrl'
import {
  buildGroupConditionAssignmentPlan,
  GROUP_MIXED_SESSION_CONDITION,
  type GroupParticipantId,
} from '../lib/groupConditionAssignment'
import { persistMemoryAnswerLive } from '../lib/memoryAnswerSync'
import { getSupabaseClient } from '../lib/supabaseClient'
import { memoryTrialCorrectness, type ConditionKey, type MemoryItemDef, type MemoryResponse } from '../types/study'

/** Seconds the "Start viewing images" button stays disabled so participants read instructions. */
const VIEW_PREP_MIN_WAIT_SECONDS = 5
const GROUP_MEMBERS = ['P1', 'P2', 'P3', 'P4'] as const

type GroupMemorySubphase =
  | 'solo_gate'
  | 'solo'
  | 'solo_wait'
  | 'discussion_gate'
  | 'discussion'

function stableHash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function createDeterministicOrder(size: number, seedText: string): number[] {
  const out = Array.from({ length: size }, (_, i) => i)
  let seed = stableHash(seedText) || 1
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function usePrepScreenLock(viewingStarted: boolean) {
  const [secondsLeft, setSecondsLeft] = useState(VIEW_PREP_MIN_WAIT_SECONDS)
  useEffect(() => {
    if (viewingStarted) return
    setSecondsLeft(VIEW_PREP_MIN_WAIT_SECONDS)
    let remaining = VIEW_PREP_MIN_WAIT_SECONDS
    const id = window.setInterval(() => {
      remaining -= 1
      setSecondsLeft(Math.max(0, remaining))
      if (remaining <= 0) window.clearInterval(id)
    }, 1000)
    return () => window.clearInterval(id)
  }, [viewingStarted])
  return secondsLeft
}

function SlideCoverageProgress({
  seenCount,
  total,
}: {
  seenCount: number
  total: number
}) {
  const pct = total > 0 ? Math.round((seenCount / total) * 100) : 0
  return (
    <div className="slide-coverage-progress">
      <p className="slide-coverage-label">
        <span className="slide-coverage-heading">Image coverage</span>
        <span className="slide-coverage-count">
          {seenCount} / {total} unique slides viewed ({pct}%)
        </span>
      </p>
      <div
        className="slide-coverage-dots"
        role="img"
        aria-label={`${seenCount} of ${total} slides viewed at least once`}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`slide-coverage-dot ${i < seenCount ? 'slide-coverage-dot--filled' : ''}`}
            aria-hidden
          />
        ))}
      </div>
      <p className="slide-coverage-hint muted small">
        One dot per slide; filled dots count how many you have opened at least once (order does not
        matter).
      </p>
    </div>
  )
}

/** Elapsed time in this step; bar reaches full at durationSec, then the app auto-advances. */
function PhaseTimeProgress({
  elapsed,
  durationSec,
}: {
  elapsed: number
  durationSec: number
}) {
  const pct =
    durationSec > 0 ? Math.min(100, Math.round((elapsed / durationSec) * 100)) : 0
  return (
    <div className="phase-time-progress">
      <p className="phase-time-label">
        <span className="phase-time-heading">Step timer</span>
        <span className="phase-time-numbers">
          {elapsed}s / {durationSec}s — auto-advances when this reaches 100%
        </span>
      </p>
      <div
        className="phase-time-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="phase-time-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function formatParticipantIdForDisplay(answers: Record<string, string | number>): string {
  const raw = answers.participant_id ?? answers.demo_name
  if (raw === undefined || raw === '') return ''
  return String(raw).trim()
}

function parseConsentSections(consentText: string): { lead: string; items: string[] } {
  const normalized = consentText.replace(/\s+/g, ' ').trim()
  if (!normalized) return { lead: '', items: [] }
  const parts = normalized.split(/(?=\d+\)\s)/g).map((p) => p.trim()).filter(Boolean)
  const items: string[] = []
  let lead = ''
  for (const part of parts) {
    const m = part.match(/^(\d+)\)\s*(.*)$/)
    if (m) items.push(m[2]!.trim())
    else lead = lead ? `${lead} ${part}` : part
  }
  return { lead, items }
}

function CountdownFiller({
  seconds,
  onDone,
  groupSync,
}: {
  seconds: number
  onDone: () => void
  groupSync?: {
    groupId: string
    anonId: 'P1' | 'P2' | 'P3' | 'P4'
    groupSize: number
    phaseKey: string
    logEvent: (t: string, p?: Record<string, unknown>) => void
  }
}) {
  const [left, setLeft] = useState(seconds)
  const [started, setStarted] = useState(false)
  const endedRef = useRef(false)

  useEffect(() => {
    if (!started || left <= 0) return
    const id = window.setTimeout(() => setLeft((x) => x - 1), 1000)
    return () => clearTimeout(id)
  }, [started, left])

  useEffect(() => {
    if (!started || left > 0 || endedRef.current) return
    endedRef.current = true
    onDone()
  }, [started, left, onDone])
  if (!started) {
    return (
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        {groupSync ? (
          <GroupPhaseStartGate
            groupId={groupSync.groupId}
            anonId={groupSync.anonId}
            groupSize={groupSync.groupSize}
            phaseKey={groupSync.phaseKey}
            buttonLabel="Start timer"
            onStart={() => {
              groupSync.logEvent('group_phase_start', {
                phase: 'filler',
                groupId: groupSync.groupId,
                anonId: groupSync.anonId,
              })
              setStarted(true)
            }}
          />
        ) : (
          <button type="button" className="btn primary" onClick={() => setStarted(true)}>
            Start timer
          </button>
        )}
      </div>
    )
  }
  if (left <= 0) return <p className="muted">Continuing to the next step…</p>
  return (
    <p className="timer" style={{ textAlign: 'center', fontSize: '1.5rem' }}>
      {left}s
    </p>
  )
}

export function StudyFlow() {
  const showDebugUi = import.meta.env.DEV
  const {
    bundle,
    phase,
    setPhase,
    sessionId,
    condition,
    setCondition,
    consentAccepted,
    setConsentAccepted,
    demographicsAnswers,
    setDemographicsAnswers,
    preAnswers,
    setPreAnswers,
    attention2Answers,
    setAttention2Answers,
    postAnswers,
    setPostAnswers,
    memoryResponses,
    setMemoryResponses,
    memoryResponsesPreDiscussion,
    setMemoryResponsesPreDiscussion,
    discussionMessages,
    clearDiscussionLog,
    setFillerStats,
    logEvent,
    submitStatus,
    submitMethod,
    finalizeStudy,
    presentationOrders,
    groupId,
    setGroupId,
    anonId,
    setAnonId,
    addDiscussionMessage,
  } = useStudySession()

  const meta = bundle.study
  const groupCfg = meta.groupDiscussion
  const groupModeEnabled = Boolean(groupCfg?.enabled)
  const [groupModeRequested, setGroupModeRequested] = useState(() => groupModeEnabled)
  const [groupMemorySubphase, setGroupMemorySubphase] = useState<GroupMemorySubphase>('solo_gate')
  const slides = bundle.slides.slides
  const memoryItems = bundle.memory.items
  const orderedBaselineSlides = useMemo(
    () => presentationOrders.baseline.map((i) => slides[i]!),
    [slides, presentationOrders.baseline],
  )
  const orderedConditionSlides = useMemo(
    () => presentationOrders.condition.map((i) => slides[i]!),
    [slides, presentationOrders.condition],
  )
  const orderedMemoryItems = useMemo(
    () => presentationOrders.memory.map((i) => memoryItems[i]!),
    [memoryItems, presentationOrders.memory],
  )
  const groupMemoryOrder = useMemo(() => {
    if (!groupModeRequested || !groupId.trim()) return presentationOrders.memory
    return createDeterministicOrder(memoryItems.length, `group-memory:${groupId.trim().toLowerCase()}`)
  }, [groupModeRequested, groupId, presentationOrders.memory, memoryItems.length])
  const groupOrderedMemoryItems = useMemo(
    () => groupMemoryOrder.map((i) => memoryItems[i]!),
    [groupMemoryOrder, memoryItems],
  )
  const groupConditionPlan = useMemo(() => {
    if (!groupModeRequested || !groupId.trim()) return null
    return buildGroupConditionAssignmentPlan(groupId.trim(), slides)
  }, [groupModeRequested, groupId, slides])
  const groupConditionBySlideId = useMemo(
    () => groupConditionPlan?.byParticipant[anonId as GroupParticipantId] ?? null,
    [groupConditionPlan, anonId],
  )
  const conditionViewedForSlide = (slideId: string): ConditionKey | undefined =>
    groupConditionBySlideId?.[slideId]
  const consentSections = useMemo(() => parseConsentSections(meta.consentText), [meta.consentText])
  const fillMissingMemoryResponses = (
    existing: MemoryResponse[],
    itemsForPhase: MemoryItemDef[],
    order: number[],
  ): MemoryResponse[] => {
    const next = [...existing]
    for (let i = 0; i < itemsForPhase.length; i += 1) {
      if (next[i]) continue
      const it = itemsForPhase[i]!
      const expected = it.expectedAnswer
      const viewed = conditionViewedForSlide(it.slideId)
      next[i] = {
        itemIndex: order[i]!,
        presentationIndex: i,
        slideId: it.slideId,
        recall: 'unsure',
        confidence: 4,
        ...(viewed !== undefined ? { conditionViewed: viewed } : {}),
        ...(expected !== undefined ? { expectedAnswer: expected } : {}),
        isCorrect: memoryTrialCorrectness('unsure', expected),
      }
    }
    return next
  }
  const fillMissingDiscussionLogs = (
    itemsForPhase: MemoryItemDef[],
    participantId?: string,
  ): { autoFilledChats: number } => {
    const now = new Date().toISOString()
    let autoFilledChats = 0
    for (let i = 0; i < itemsForPhase.length; i += 1) {
      const it = itemsForPhase[i]!
      const hasDiscussionForQuestion = discussionMessages.some((m) => m.questionIndex === i)
      if (hasDiscussionForQuestion) continue
      addDiscussionMessage({
        questionIndex: i,
        slideId: it.slideId,
        anonId,
        participantId,
        message: `[debug] synthetic chat for item ${i + 1}`,
        sentAt: now,
      })
      autoFilledChats += 1
    }
    return { autoFilledChats }
  }

  /** Memory (external form flow) runs `finalizeStudy` before this screen; in-app post survey defers submit here. */
  const [submitCompletedBeforeEndScreen, setSubmitCompletedBeforeEndScreen] = useState(false)
  const [debugOverlayOpen, setDebugOverlayOpen] = useState(true)
  const [discussionSkipSignal, setDiscussionSkipSignal] = useState(0)
  const canJumpToDiscussionGate = groupModeRequested && Boolean(groupId.trim())
  const canSkipCurrentDiscussion =
    groupModeRequested && phase === 'memory' && groupMemorySubphase === 'discussion'
  const ensureDebugCondition = () => {
    if (condition !== null) return condition
    const fallback = groupModeRequested ? GROUP_MIXED_SESSION_CONDITION : 'no_edit'
    setCondition(fallback)
    return fallback
  }
  const completeToPostSurveyWithFill = () => {
    if (groupModeRequested) {
      const participantId = formatParticipantIdForDisplay(demographicsAnswers) || undefined
      const prePrev = memoryResponsesPreDiscussion.filter(Boolean).length
      const postPrev = memoryResponses.filter(Boolean).length
      const preFilled = fillMissingMemoryResponses(
        memoryResponsesPreDiscussion,
        groupOrderedMemoryItems,
        groupMemoryOrder,
      )
      const postFilled = fillMissingMemoryResponses(memoryResponses, groupOrderedMemoryItems, groupMemoryOrder)
      const preAdded = preFilled.filter(Boolean).length - prePrev
      const postAdded = postFilled.filter(Boolean).length - postPrev
      const { autoFilledChats } = fillMissingDiscussionLogs(groupOrderedMemoryItems, participantId)
      if (preAdded > 0) setMemoryResponsesPreDiscussion(preFilled)
      if (postAdded > 0) setMemoryResponses(postFilled)
      logEvent('group_memory_overlay_skip_to_post', {
        fromPhase: phase,
        fromSubphase: groupMemorySubphase,
        autoFilledPreResponses: Math.max(0, preAdded),
        autoFilledPostResponses: Math.max(0, postAdded),
        autoFilledChats,
      })
      setGroupMemorySubphase('solo_gate')
    } else {
      const prev = memoryResponses.filter(Boolean).length
      const filled = fillMissingMemoryResponses(memoryResponses, orderedMemoryItems, presentationOrders.memory)
      const added = filled.filter(Boolean).length - prev
      if (added > 0) setMemoryResponses(filled)
      logEvent('memory_overlay_skip_to_post', { fromPhase: phase, autoFilledResponses: Math.max(0, added) })
    }
    logEvent('phase_enter', { phase: 'post_survey', via: 'overlay_debug_skip' })
    setPhase('post_survey')
  }
  const jumpToStudyPhase = (
    target:
      | 'group_lobby'
      | 'demographics'
      | 'pre_survey'
      | 'baseline'
      | 'filler'
      | 'attention2'
      | 'condition'
      | 'memory_solo_gate'
      | 'memory_discussion_gate'
      | 'post_survey'
      | 'complete',
  ) => {
    setConsentAccepted(true)
    if (target !== 'group_lobby') ensureDebugCondition()
    if (target === 'group_lobby') {
      if (!groupModeRequested || !groupId.trim()) return
      setPhase('group_lobby')
      logEvent('debug_jump', { to: 'group_lobby' })
      return
    }
    if (target === 'memory_solo_gate') {
      setGroupMemorySubphase('solo_gate')
      setPhase('memory')
      logEvent('debug_jump', { to: 'memory', subphase: 'solo_gate' })
      return
    }
    if (target === 'filler') {
      setFillerStats({
        type: bundle.filler.type,
        durationSeconds: bundle.filler.minDurationSeconds,
        debugSkip: true,
        viaOverlay: true,
      })
    }
    if (target === 'memory_discussion_gate') {
      jumpToDiscussionGate()
      return
    }
    if (target === 'complete') {
      setSubmitCompletedBeforeEndScreen(false)
      setPhase('complete')
      logEvent('debug_jump', { to: 'complete' })
      return
    }
    if (target === 'post_survey') {
      completeToPostSurveyWithFill()
      return
    }
    const targetPhase = target as Exclude<typeof target, 'memory_solo_gate' | 'memory_discussion_gate' | 'complete'>
    setPhase(targetPhase)
    logEvent('debug_jump', { to: targetPhase })
  }
  const jumpToDiscussionGate = () => {
    if (!canJumpToDiscussionGate) return
    const prevAnswered = memoryResponsesPreDiscussion.filter(Boolean).length
    const filledPre = fillMissingMemoryResponses(
      memoryResponsesPreDiscussion,
      groupOrderedMemoryItems,
      groupMemoryOrder,
    )
    const filledCount = filledPre.filter(Boolean).length - prevAnswered
    if (filledCount > 0) setMemoryResponsesPreDiscussion(filledPre)
    logEvent('group_memory_debug_jump_discussion_gate', {
      fromPhase: phase,
      fromSubphase: groupMemorySubphase,
      preservedAnswers: prevAnswered,
      autoFilledAnswers: Math.max(0, filledCount),
    })
    setGroupMemorySubphase('discussion_gate')
    setPhase('memory')
  }
  const skipCurrentDiscussionOnly = () => {
    if (!canSkipCurrentDiscussion) return
    setDiscussionSkipSignal((v) => v + 1)
    logEvent('group_discussion_debug_skip_request', { phase, subphase: groupMemorySubphase })
  }
  const globalDebugCorner = (
    <div className="debug-corner-wrap">
      {debugOverlayOpen ? (
        <div className="debug-corner-panel">
          <div className="debug-corner-head">
            <p className="debug-corner-title">Debug jump</p>
            <button type="button" className="btn debug-corner-collapse" onClick={() => setDebugOverlayOpen(false)}>
              Hide
            </button>
          </div>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('demographics')}>
            Go to demographics
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('pre_survey')}>
            Go to pre survey
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('baseline')}>
            Go to image session 1
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('filler')}>
            Go to filler task
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('attention2')}>
            Go to attention check
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('condition')}>
            Go to image session 2
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('memory_solo_gate')}>
            Go to memory test start
          </button>
          <button
            type="button"
            className="btn debug-corner-btn"
            onClick={() => jumpToStudyPhase('memory_discussion_gate')}
            disabled={!canJumpToDiscussionGate}
            title={canJumpToDiscussionGate ? undefined : 'Enable group mode and set Group ID first.'}
          >
            Go to just before group discussion
          </button>
          <button
            type="button"
            className="btn debug-corner-btn"
            onClick={skipCurrentDiscussionOnly}
            disabled={!canSkipCurrentDiscussion}
            title={canSkipCurrentDiscussion ? undefined : 'Available only during an active group discussion timer.'}
          >
            Skip current discussion only
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('post_survey')}>
            {phase === 'memory' && groupModeRequested && groupMemorySubphase === 'discussion'
              ? 'End group discussion now (fill + next)'
              : 'Skip to post survey (fill missing)'}
          </button>
          <button type="button" className="btn debug-corner-btn" onClick={() => jumpToStudyPhase('complete')}>
            Go to complete
          </button>
          <button type="button" className="btn debug-corner-btn debug-corner-hide-bottom" onClick={() => setDebugOverlayOpen(false)}>
            Hide panel
          </button>
        </div>
      ) : (
        <button type="button" className="btn debug-corner-launcher" onClick={() => setDebugOverlayOpen(true)}>
          Debug
        </button>
      )}
    </div>
  )
  const renderWithGlobalDebug = (content: ReactNode) => (
    showDebugUi ? (
      <>
        {globalDebugCorner}
        {content}
      </>
    ) : (
      <>{content}</>
    )
  )

  if (phase === 'intro') {
    return renderWithGlobalDebug(
      <div className="card">
        <header className="card-header">
          <h1>{meta.title}</h1>
          <p className="muted">{meta.shortDescription}</p>
        </header>
        <div className="intro-no-refresh" role="alert">
          <p className="intro-no-refresh-title">Do not refresh or use the browser Back button</p>
          <p className="intro-no-refresh-body">
            <strong>Do not refresh, reload, use the Back button, or close this tab</strong> while you are in the study.
            Doing so can lose your answers and you may need to start over.
          </p>
        </div>
        {meta.procedureSteps && meta.procedureSteps.length > 0 ? (
          <section className="intro-procedure" aria-labelledby="intro-procedure-heading">
            <h2 id="intro-procedure-heading" className="intro-procedure-heading">
              What you will do
            </h2>
            <ul className="procedure-steps">
              {meta.procedureSteps.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="consent consent-card" aria-label="Consent details">
          {consentSections.lead ? <p className="consent-lead">{consentSections.lead}</p> : null}
          {consentSections.items.length > 0 ? (
            <ol className="consent-list">
              {consentSections.items.map((itemText, idx) => (
                <li key={idx}>{itemText}</li>
              ))}
            </ol>
          ) : (
            <p className="consent-lead">{meta.consentText}</p>
          )}
        </section>
        {groupModeEnabled ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={groupModeRequested}
              onChange={(e) => setGroupModeRequested(e.target.checked)}
            />
            <span>Run in group discussion mode</span>
          </label>
        ) : null}
        {!groupModeRequested ? (
          <fieldset
            className="intro-condition-fieldset"
            aria-label="Choose Option A or Option B as you were instructed"
          >
            <legend className="visually-hidden">Option A or Option B</legend>
            <div className="intro-condition-options">
              <label
                className={`intro-condition-option ${condition === 'no_edit' ? 'intro-condition-option--active' : ''}`}
              >
                <input
                  type="radio"
                  name="assigned_study_option"
                  checked={condition === 'no_edit'}
                  onChange={() => {
                    setCondition('no_edit')
                    logEvent('participant_condition_pick', { optionLetter: 'A', conditionKey: 'no_edit' })
                  }}
                />
                <span>Option A</span>
              </label>
              <label
                className={`intro-condition-option ${condition === 'ai_edited_image' ? 'intro-condition-option--active' : ''}`}
              >
                <input
                  type="radio"
                  name="assigned_study_option"
                  checked={condition === 'ai_edited_image'}
                  onChange={() => {
                    setCondition('ai_edited_image')
                    logEvent('participant_condition_pick', { optionLetter: 'B', conditionKey: 'ai_edited_image' })
                  }}
                />
                <span>Option B</span>
              </label>
            </div>
          </fieldset>
        ) : null}
        {meta.showConditionKeyToParticipant && condition ? (
          <p className="muted small">
            Assigned condition (debug):{' '}
            {condition === GROUP_MIXED_SESSION_CONDITION
              ? 'Group: mixed per slide (see event log)'
              : bundle.study.conditionLabels[condition]}
          </p>
        ) : null}
        <label className="check-row">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={(e) => setConsentAccepted(e.target.checked)}
          />
          <span>I have read and agree to the above.</span>
        </label>
        {groupModeEnabled && groupModeRequested ? (
          <section className="intro-procedure" aria-label="Group setup">
            <h2 className="intro-procedure-heading">Group setup</h2>
            <div className="survey-block">
              <label className="survey-prompt" htmlFor="group-id">
                Group ID
              </label>
              <input
                id="group-id"
                className="survey-input"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="e.g., G1"
              />
            </div>
            <fieldset className="survey-fieldset">
              <legend className="survey-prompt">Anonymous label</legend>
              <div className="recall-row">
                {GROUP_MEMBERS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn choice ${anonId === id ? 'active' : ''}`}
                    onClick={() => setAnonId(id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>
        ) : null}
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            disabled={
              !consentAccepted ||
              (!groupModeRequested && condition === null) ||
              (groupModeRequested && !groupId.trim())
            }
            onClick={() => {
              let startCondition = condition
              if (groupModeRequested) {
                const plan = buildGroupConditionAssignmentPlan(groupId.trim(), slides)
                startCondition = GROUP_MIXED_SESSION_CONDITION
                setCondition(startCondition)
                logEvent('group_condition_plan', {
                  groupId: groupId.trim(),
                  anonId,
                  sessionConditionKey: startCondition,
                  participantSummary: plan.participantSummary[anonId as GroupParticipantId],
                  conditionBySlideId: plan.byParticipant[anonId as GroupParticipantId],
                  exposureTable: plan.exposureTable,
                })
              }
              if (startCondition === null) return
              logEvent('session_start', {
                sessionId,
                condition: startCondition,
                conditionLabel:
                  startCondition === GROUP_MIXED_SESSION_CONDITION
                    ? 'group_mixed_per_slide'
                    : bundle.study.conditionLabels[startCondition],
                userAgent: navigator.userAgent,
                groupModeRequested,
                groupId: groupModeRequested ? groupId : undefined,
                anonId: groupModeRequested ? anonId : undefined,
                presentationOrders: {
                  baseline: [...presentationOrders.baseline],
                  condition: [...presentationOrders.condition],
                  memory: [...presentationOrders.memory],
                },
              })
              if (groupModeRequested) {
                logEvent('phase_enter', { phase: 'group_lobby', groupId, anonId })
                setPhase('group_lobby')
              } else {
                logEvent('phase_enter', { phase: 'demographics' })
                setPhase('demographics')
              }
            }}
          >
            Begin
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'group_lobby' && groupModeRequested) {
    return renderWithGlobalDebug(
      <GroupLobby
        groupId={groupId}
        anonId={anonId}
        groupSize={groupCfg?.groupSize ?? 4}
        onStart={() => {
          logEvent('group_lobby_start', { groupId, anonId })
          logEvent('phase_enter', { phase: 'demographics' })
          setPhase('demographics')
        }}
      />
    )
  }

  if (phase === 'demographics') {
    return renderWithGlobalDebug(
      <SurveyRunner
        config={bundle.demographics}
        answers={demographicsAnswers}
        onChange={setDemographicsAnswers}
        logSurveyId="demographics"
        onLog={logEvent}
        disableSubmitUntilValid
        onComplete={() => {
          logEvent('phase_enter', { phase: 'pre_survey' })
          setPhase('pre_survey')
        }}
        onDebugSkipEntireSurvey={() => {
          logEvent('phase_enter', { phase: 'pre_survey' })
          setPhase('pre_survey')
        }}
      />
    )
  }

  if (phase === 'pre_survey') {
    return renderWithGlobalDebug(
      <SurveyRunner
        config={bundle.preSurvey}
        answers={preAnswers}
        onChange={setPreAnswers}
        logSurveyId="pre"
        onLog={logEvent}
        disableSubmitUntilValid
        onComplete={() => {
          logEvent('phase_enter', { phase: 'baseline' })
          setPhase('baseline')
        }}
        onDebugSkipEntireSurvey={() => {
          logEvent('phase_enter', { phase: 'baseline' })
          setPhase('baseline')
        }}
      />
    )
  }

  if (phase === 'baseline') {
    return renderWithGlobalDebug(
      <BaselinePhase
        title={meta.baselinePhaseTitle}
        instructions={meta.baselinePhaseInstructions}
        slides={orderedBaselineSlides}
        configIndexAtPresentation={presentationOrders.baseline}
        durationSec={meta.baselineDurationSeconds}
        groupSync={
          groupModeRequested
            ? {
                groupId,
                anonId,
                groupSize: groupCfg?.groupSize ?? 4,
                phaseKey: 'baseline',
                logEvent,
              }
            : undefined
        }
        onComplete={() => {
          logEvent('phase_enter', { phase: 'filler' })
          setPhase('filler')
        }}
        logEvent={logEvent}
      />
    )
  }

  if (phase === 'filler') {
    return renderWithGlobalDebug(
      <div className="card">
        <header className="card-header">
          <h2>{bundle.filler.title}</h2>
          <p className="muted">{bundle.filler.instructions}</p>
        </header>
        {bundle.filler.type === 'pacman' ? (
          <FillerPacMan
            durationSeconds={bundle.filler.minDurationSeconds}
            groupSync={
              groupModeRequested
                ? {
                    groupId,
                    anonId,
                    groupSize: groupCfg?.groupSize ?? 4,
                    phaseKey: 'filler',
                    logEvent,
                  }
                : undefined
            }
            onStats={(s) => {
              setFillerStats(s as unknown as Record<string, unknown>)
              logEvent('filler_complete', s as unknown as Record<string, unknown>)
            }}
            onDone={() => {
              logEvent('phase_enter', { phase: 'attention2' })
              setPhase('attention2')
            }}
          />
        ) : (
          <CountdownFiller
            seconds={bundle.filler.minDurationSeconds}
            groupSync={
              groupModeRequested
                ? {
                    groupId,
                    anonId,
                    groupSize: groupCfg?.groupSize ?? 4,
                    phaseKey: 'filler',
                    logEvent,
                  }
                : undefined
            }
            onDone={() => {
              setFillerStats({ type: bundle.filler.type, durationSeconds: bundle.filler.minDurationSeconds })
              logEvent('filler_complete', { type: bundle.filler.type })
              logEvent('phase_enter', { phase: 'attention2' })
              setPhase('attention2')
            }}
          />
        )}
      </div>
    )
  }

  if (phase === 'attention2') {
    return renderWithGlobalDebug(
      <SurveyRunner
        config={bundle.attention2}
        answers={attention2Answers}
        onChange={setAttention2Answers}
        logSurveyId="attention2"
        onLog={logEvent}
        disableSubmitUntilValid
        onComplete={() => {
          logEvent('phase_enter', { phase: 'condition' })
          setPhase('condition')
        }}
        onDebugSkipEntireSurvey={() => {
          logEvent('phase_enter', { phase: 'condition' })
          setPhase('condition')
        }}
      />
    )
  }

  if (phase === 'condition') {
    const conditionKey = condition
    if (!conditionKey) {
      return renderWithGlobalDebug(
        <div className="card error-card">
          <p>No Option A/B was recorded. Please return to the start and select the option your researcher assigned.</p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => setPhase('intro')}>
              Back to start
            </button>
          </div>
        </div>
      )
    }
    return renderWithGlobalDebug(
      <ConditionPhase
        title={meta.conditionPhaseTitle}
        instructions={meta.conditionPhaseInstructions}
        slides={orderedConditionSlides}
        configIndexAtPresentation={presentationOrders.condition}
        condition={conditionKey === GROUP_MIXED_SESSION_CONDITION ? 'no_edit' : conditionKey}
        conditionBySlideId={groupModeRequested ? groupConditionBySlideId ?? undefined : undefined}
        durationSec={meta.conditionDurationSeconds}
        groupSync={
          groupModeRequested
            ? {
                groupId,
                anonId,
                groupSize: groupCfg?.groupSize ?? 4,
                phaseKey: 'condition',
                logEvent,
              }
            : undefined
        }
        onComplete={() => {
          logEvent('phase_enter', { phase: 'memory' })
          if (groupModeRequested) {
            setGroupMemorySubphase('solo_gate')
            setMemoryResponsesPreDiscussion([])
            setMemoryResponses([])
            clearDiscussionLog()
          }
          setPhase('memory')
        }}
        logEvent={logEvent}
      />
    )
  }

  if (phase === 'memory') {
    const externalPostUrl = meta.postStudyExternalFormUrl?.trim()
    if (groupModeRequested) {
      const groupSize = groupCfg?.groupSize ?? 4
      const discSec = groupCfg?.discussionDurationSeconds ?? 120

      if (groupMemorySubphase === 'solo_gate') {
        return renderWithGlobalDebug(
          <div className="card">
            <header className="card-header">
              <h2>{meta.memoryPhaseTitle}</h2>
              <p className="muted">{meta.memoryPhaseInstructions}</p>
              <p className="muted small">
                First, you will answer <strong>on your own</strong> for each masked image (same format as the main
                study). Work at your own pace. When everyone has finished, you will move on together.
              </p>
            </header>
            <GroupPhaseStartGate
              groupId={groupId}
              anonId={anonId}
              groupSize={groupSize}
              phaseKey="memory_solo"
              buttonLabel="Start individual memory test"
              onStart={() => {
                logEvent('group_phase_start', { phase: 'memory_solo', groupId, anonId })
                setMemoryResponsesPreDiscussion([])
                setGroupMemorySubphase('solo')
              }}
            />
          </div>
        )
      }

      if (groupMemorySubphase === 'solo') {
        return renderWithGlobalDebug(
          <MemoryPhase
            title={meta.memoryPhaseTitle}
            instructions={`${meta.memoryPhaseInstructions} Answer each item on your own; this part is not a group discussion.`}
            items={groupOrderedMemoryItems}
            configItemIndexAtPresentation={groupMemoryOrder}
            responses={memoryResponsesPreDiscussion}
            onChange={setMemoryResponsesPreDiscussion}
            onComplete={(finalSnapshot) => {
              setMemoryResponsesPreDiscussion(finalSnapshot)
              logEvent('group_memory_solo_complete', {
                groupId,
                anonId,
                answeredCount: finalSnapshot.filter(Boolean).length,
              })
              setGroupMemorySubphase('solo_wait')
            }}
            advanceButtonLabel="Next item"
            finalAdvanceButtonLabel="Finish individual test"
            memoryAnswerLogExtras={{ groupMode: true, memoryRound: 'pre_discussion' }}
            conditionViewedForSlide={groupConditionBySlideId ? conditionViewedForSlide : undefined}
            logEvent={logEvent}
            livePersist={{
              sessionId,
              groupId,
              anonId,
              participantId: formatParticipantIdForDisplay(demographicsAnswers) || undefined,
              conditionKey: GROUP_MIXED_SESSION_CONDITION,
              memoryRound: 'pre_discussion',
            }}
          />
        )
      }

      if (groupMemorySubphase === 'solo_wait') {
        return renderWithGlobalDebug(
          <GroupSoloMemoryWaitGate
            groupId={groupId}
            anonId={anonId}
            groupSize={groupSize}
            onProceed={() => {
              logEvent('group_memory_all_solo_done', { groupId, anonId })
              setGroupMemorySubphase('discussion_gate')
            }}
          />
        )
      }

      if (groupMemorySubphase === 'discussion_gate') {
        return renderWithGlobalDebug(
          <div className="card">
            <header className="card-header">
              <h2>{meta.memoryPhaseTitle}</h2>
              <p className="muted">{meta.memoryPhaseInstructions}</p>
              <p className="muted">
                Some of the images you saw were original, while others were versions where certain elements were
                altered by AI. Your group's goal is to discuss together and reconstruct as accurately as possible what
                was actually in the original image. Each person's memory is a clue, and differences between memories
                are also clues that you should reason through together to decide what was real.
              </p>
              <p className="muted small">
                Next, you will see the same questions again with <strong>group discussion</strong>: for each item you
                will chat anonymously for about {discSec} seconds, then submit your answer on your own. All
                participants must press Start to begin together.
              </p>
            </header>
            <GroupPhaseStartGate
              groupId={groupId}
              anonId={anonId}
              groupSize={groupSize}
              phaseKey="memory_discussion"
              buttonLabel="Start group discussion memory test"
              onStart={() => {
                logEvent('group_phase_start', { phase: 'memory_discussion', groupId, anonId })
                setGroupMemorySubphase('discussion')
              }}
            />
          </div>
        )
      }

      return renderWithGlobalDebug(
        <GroupMemoryPhase
          title={meta.memoryPhaseTitle}
          instructions={meta.memoryPhaseInstructions}
          items={groupOrderedMemoryItems}
          configItemIndexAtPresentation={groupMemoryOrder}
          groupId={groupId}
          anonId={anonId}
          groupSize={groupSize}
          sessionId={sessionId}
          durationSec={discSec}
          participantId={formatParticipantIdForDisplay(demographicsAnswers) || undefined}
          responses={memoryResponses}
          onLog={logEvent}
          onMessagePersist={addDiscussionMessage}
          onAnswer={(step, recall, confidence) => {
            const item = groupOrderedMemoryItems[step]!
            const expected = item.expectedAnswer
            const isCorrect = memoryTrialCorrectness(recall, expected)
            const configItemIndex = groupMemoryOrder[step]!
            const viewed = conditionViewedForSlide(item.slideId)
            const next = [...memoryResponses]
            next[step] = {
              itemIndex: configItemIndex,
              presentationIndex: step,
              slideId: item.slideId,
              recall,
              confidence,
              ...(viewed !== undefined ? { conditionViewed: viewed } : {}),
              ...(expected !== undefined ? { expectedAnswer: expected } : {}),
              isCorrect,
            }
            setMemoryResponses(next)
            const saved = next[step]!
            logEvent('memory_answer', {
              step,
              presentationIndex: step,
              configItemIndex,
              slideId: item.slideId,
              recall,
              confidence,
              expectedAnswer: expected,
              isCorrect,
              conditionViewed: viewed,
              groupMode: true,
              memoryRound: 'post_discussion',
            })
            const client = getSupabaseClient()
            if (client && sessionId.trim() && groupId.trim()) {
              void persistMemoryAnswerLive(client, {
                sessionId,
                groupId,
                anonId,
                participantId: formatParticipantIdForDisplay(demographicsAnswers) || undefined,
                conditionKey: GROUP_MIXED_SESSION_CONDITION,
                memoryRound: 'post_discussion',
                answer: { ...saved, memoryRound: 'post_discussion' },
              })
            }
          }}
          skipCurrentDiscussionSignal={discussionSkipSignal}
          onComplete={() => {
            // CRITICAL: transition the UI synchronously FIRST so the polling-heavy
            // GroupDiscussionFlow unmounts and frees its in-flight fetches. Awaiting
            // finalizeStudy here while the network is congested by stale polls causes
            // the submit to hang and locks the screen on "Waiting for others... (4/4)".
            // The end-of-study screen handles submit completion on its own.
            if (externalPostUrl) {
              logEvent('phase_enter', { phase: 'complete' })
              setGroupMemorySubphase('solo_gate')
              setPhase('complete')
              logEvent('submit_start', {})
              void finalizeStudy()
                .then(() => {
                  logEvent('submit_done', {})
                  setSubmitCompletedBeforeEndScreen(true)
                })
                .catch((err) => {
                  console.error('[study] finalizeStudy failed:', err)
                })
            } else {
              logEvent('phase_enter', { phase: 'post_survey' })
              setGroupMemorySubphase('solo_gate')
              setPhase('post_survey')
            }
          }}
        />
      )
    }
    return renderWithGlobalDebug(
      <MemoryPhase
        title={meta.memoryPhaseTitle}
        instructions={meta.memoryPhaseInstructions}
        items={orderedMemoryItems}
        configItemIndexAtPresentation={presentationOrders.memory}
        responses={memoryResponses}
        onChange={setMemoryResponses}
        onComplete={async (finalSnapshot) => {
          if (externalPostUrl) {
            logEvent('submit_start', {})
            await finalizeStudy({ memoryResponses: finalSnapshot })
            logEvent('submit_done', {})
            setSubmitCompletedBeforeEndScreen(true)
            logEvent('phase_enter', { phase: 'complete' })
            setPhase('complete')
          } else {
            logEvent('phase_enter', { phase: 'post_survey' })
            setPhase('post_survey')
          }
        }}
        logEvent={logEvent}
      />
    )
  }

  if (phase === 'post_survey') {
    const hasPostSurveyQuestions = bundle.postSurvey.pages.some((page) => page.items.length > 0)
    if (!hasPostSurveyQuestions) {
      setSubmitCompletedBeforeEndScreen(false)
      logEvent('post_survey_auto_skip_empty', {})
      logEvent('phase_enter', { phase: 'complete' })
      setPhase('complete')
      return null
    }
    return renderWithGlobalDebug(
      <SurveyRunner
        config={bundle.postSurvey}
        answers={postAnswers}
        onChange={setPostAnswers}
        logSurveyId="post"
        onLog={logEvent}
        onComplete={() => {
          setSubmitCompletedBeforeEndScreen(false)
          logEvent('phase_enter', { phase: 'complete' })
          setPhase('complete')
        }}
        onDebugSkipEntireSurvey={() => {
          setSubmitCompletedBeforeEndScreen(false)
          logEvent('phase_enter', { phase: 'complete' })
          setPhase('complete')
        }}
      />
    )
  }

  if (phase === 'complete') {
    const externalPostUrl = meta.postStudyExternalFormUrl?.trim()
    return renderWithGlobalDebug(
      <SessionEndScreen
        submitStatus={submitStatus}
        submitMethod={submitMethod}
        finalizeStudy={finalizeStudy}
        logEvent={logEvent}
        submitCompletedBeforeMount={submitCompletedBeforeEndScreen}
        externalFormUrl={externalPostUrl || undefined}
        participantIdDisplay={formatParticipantIdForDisplay(demographicsAnswers)}
      />
    )
  }

  return null
}

function BaselinePhase({
  title,
  instructions,
  slides,
  configIndexAtPresentation,
  durationSec,
  groupSync,
  onComplete,
  logEvent,
}: {
  title: string
  instructions: string
  slides: { id: string; baselineSrc: string }[]
  /** Same length as `slides`: config row index in `slides.json` for each presentation position. */
  configIndexAtPresentation: number[]
  durationSec: number
  groupSync?: {
    groupId: string
    anonId: 'P1' | 'P2' | 'P3' | 'P4'
    groupSize: number
    phaseKey: string
    logEvent: (t: string, p?: Record<string, unknown>) => void
  }
  onComplete: () => void
  logEvent: (t: string, p?: Record<string, unknown>) => void
}) {
  const [viewingStarted, setViewingStarted] = useState(false)
  const [idx, setIdx] = useState(0)
  const [maxIdx, setMaxIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [seenIndices, setSeenIndices] = useState<Set<number>>(() => new Set([0]))
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const prevIdxRef = useRef<number | null>(null)
  const autoAdvancedRef = useRef(false)
  const prepLockSecondsLeft = usePrepScreenLock(viewingStarted)

  useEffect(() => {
    if (!viewingStarted) return
    setSeenIndices((prev) => {
      if (prev.has(idx)) return prev
      const next = new Set(prev)
      next.add(idx)
      return next
    })
  }, [idx, viewingStarted])

  useEffect(() => {
    if (!viewingStarted) return
    const id = window.setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [viewingStarted])

  useEffect(() => {
    if (!viewingStarted || autoAdvancedRef.current || elapsed < durationSec) return
    autoAdvancedRef.current = true
    logEvent('baseline_complete', {
      elapsed,
      maxIdx,
      autoAdvanceAfterMinDuration: true,
    })
    onComplete()
  }, [viewingStarted, elapsed, durationSec, maxIdx, logEvent, onComplete])

  useEffect(() => {
    if (!viewingStarted || slides.length === 0) return
    const n = slides.length
    const want = new Set([idx, (idx + 1) % n, (idx - 1 + n) % n])
    for (const i of want) {
      const img = new Image()
      img.src = assetUrl(slides[i]!.baselineSrc)
    }
  }, [viewingStarted, idx, slides])

  useEffect(() => {
    if (!viewingStarted) return
    setMaxIdx((m) => Math.max(m, idx))
    const prev = prevIdxRef.current
    prevIdxRef.current = idx
    if (prev !== null && prev !== idx) {
      logEvent('baseline_slide', {
        slideId: slides[idx].id,
        presentationIndex: idx,
        configSlideIndex: configIndexAtPresentation[idx],
      })
    }
  }, [idx, slides, logEvent, viewingStarted, configIndexAtPresentation])

  const go = (dir: 1 | -1) => {
    setIdx((i) => (i + dir + slides.length) % slides.length)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current
    touchStart.current = null
    if (!s || !e.changedTouches[0]) return
    const dx = e.changedTouches[0].clientX - s.x
    const dy = e.changedTouches[0].clientY - s.y
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) go(dx > 0 ? -1 : 1)
    else if (Math.abs(dy) > 40) go(dy > 0 ? -1 : 1)
  }

  const s = slides[idx]

  if (!viewingStarted) {
    return (
      <div className="card media-card">
        <header className="card-header">
          <h2>{title}</h2>
          <p className="muted">{instructions}</p>
        </header>
        <div className="media-reminder" role="status">
          <p className="media-reminder-lead">
            <strong>Before you start:</strong> You have <strong>{durationSec} seconds</strong> (about one minute) to view{' '}
            <strong>all {slides.length} images</strong>. Try to see each one at least once. When the timer reaches{' '}
            <strong>{durationSec}s</strong>, this step <strong>ends automatically</strong> and the study moves on—you
            cannot extend or pause this block.
          </p>
        </div>
        {prepLockSecondsLeft > 0 ? (
          <p className="muted small" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
            Please read the instructions above. Start button unlocks in{' '}
            <strong>{prepLockSecondsLeft}</strong>s.
          </p>
        ) : null}
        {groupSync ? (
          <GroupPhaseStartGate
            groupId={groupSync.groupId}
            anonId={groupSync.anonId}
            groupSize={groupSync.groupSize}
            phaseKey={groupSync.phaseKey}
            buttonLabel="Start viewing images"
            disabled={prepLockSecondsLeft > 0}
            disabledReason={
              prepLockSecondsLeft > 0
                ? `Please read the instructions. Unlocks in ${prepLockSecondsLeft}s.`
                : undefined
            }
            onStart={() => {
              groupSync.logEvent('group_phase_start', {
                phase: 'baseline',
                groupId: groupSync.groupId,
                anonId: groupSync.anonId,
              })
              logEvent('baseline_viewing_prepare_ack', {
                slideCount: slides.length,
                durationSec,
                groupSync: true,
              })
              setViewingStarted(true)
            }}
          />
        ) : (
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn primary"
              disabled={prepLockSecondsLeft > 0}
              title={
                prepLockSecondsLeft > 0
                  ? `Read the instructions. Unlocks in ${prepLockSecondsLeft}s.`
                  : undefined
              }
              onClick={() => {
                logEvent('baseline_viewing_prepare_ack', {
                  slideCount: slides.length,
                  durationSec,
                })
                setViewingStarted(true)
              }}
            >
              Start viewing images
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card media-card">
      <header className="card-header">
        <h2>{title}</h2>
        <p className="muted">{instructions}</p>
        <p className="media-reminder-inline muted small">
          <strong>Note:</strong> Try to view all {slides.length} images before the timer ends.
        </p>
        <p className="timer">
          Elapsed {elapsed}s / {durationSec}s · slide {idx + 1} / {slides.length}
        </p>
        <PhaseTimeProgress elapsed={elapsed} durationSec={durationSec} />
        <SlideCoverageProgress seenCount={seenIndices.size} total={slides.length} />
        <p className="muted small">
          When the timer hits {durationSec}s, the next step starts automatically.
        </p>
      </header>
      <div
        className="swipe-stage"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          key={s.id}
          src={assetUrl(s.baselineSrc)}
          alt=""
          className="stage-img"
          draggable={false}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <div className="swipe-hint muted small">
        On mobile, swipe left/right or up/down to change slides.
      </div>
      <div className="btn-row spread">
        <button type="button" className="btn secondary" onClick={() => go(-1)}>
          ← Previous
        </button>
        <button type="button" className="btn secondary" onClick={() => go(1)}>
          Next →
        </button>
      </div>
    </div>
  )
}

function ConditionPhase({
  title,
  instructions,
  slides,
  configIndexAtPresentation,
  condition,
  conditionBySlideId,
  durationSec,
  groupSync,
  onComplete,
  logEvent,
}: {
  title: string
  instructions: string
  slides: import('../types/study').SlideDef[]
  configIndexAtPresentation: number[]
  condition: ConditionKey
  /** Group mode: slideId → condition key (stable object; do not pass inline functions). */
  conditionBySlideId?: Record<string, ConditionKey>
  durationSec: number
  groupSync?: {
    groupId: string
    anonId: 'P1' | 'P2' | 'P3' | 'P4'
    groupSize: number
    phaseKey: string
    logEvent: (t: string, p?: Record<string, unknown>) => void
  }
  onComplete: () => void
  logEvent: (t: string, p?: Record<string, unknown>) => void
}) {
  const [viewingStarted, setViewingStarted] = useState(false)
  const [idx, setIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [seenIndices, setSeenIndices] = useState<Set<number>>(() => new Set([0]))
  const autoAdvancedRef = useRef(false)
  const prepLockSecondsLeft = usePrepScreenLock(viewingStarted)
  const resolveCondition = (slideId: string): ConditionKey =>
    conditionBySlideId?.[slideId] ?? condition

  useEffect(() => {
    setIdx(0)
    setSeenIndices(new Set([0]))
    setElapsed(0)
    autoAdvancedRef.current = false
  }, [condition, slides.length])

  useEffect(() => {
    if (!viewingStarted) return
    setSeenIndices((prev) => {
      if (prev.has(idx)) return prev
      const next = new Set(prev)
      next.add(idx)
      return next
    })
  }, [idx, viewingStarted])

  useEffect(() => {
    if (!viewingStarted) return
    const id = window.setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [viewingStarted])

  useEffect(() => {
    if (!viewingStarted || autoAdvancedRef.current || elapsed < durationSec) return
    autoAdvancedRef.current = true
    logEvent('condition_complete', {
      condition,
      perSlideAssignment: Boolean(conditionBySlideId),
      elapsed,
      autoAdvanceAfterMinDuration: true,
    })
    onComplete()
  }, [viewingStarted, elapsed, durationSec, condition, conditionBySlideId, logEvent, onComplete])

  const go = (dir: 1 | -1) => {
    setIdx((i) => (i + dir + slides.length) % slides.length)
  }

  useEffect(() => {
    if (!viewingStarted) return
    const slide = slides[idx]
    const slideCondition = resolveCondition(slide.id)
    logEvent('condition_slide', {
      slideId: slide.id,
      presentationIndex: idx,
      configSlideIndex: configIndexAtPresentation[idx],
      condition: slideCondition,
      media: slide.conditionMediaType[slideCondition],
      src: slide.conditionSrc[slideCondition],
    })
  }, [idx, slides, condition, conditionBySlideId, logEvent, viewingStarted, configIndexAtPresentation])

  useEffect(() => {
    if (!viewingStarted || slides.length === 0) return
    const n = slides.length
    const want = new Set([idx, (idx + 1) % n, (idx - 1 + n) % n])
    for (const i of want) {
      const sl = slides[i]!
      const slideCondition = resolveCondition(sl.id)
      if (sl.conditionMediaType[slideCondition] !== 'image') continue
      const img = new Image()
      img.src = assetUrl(sl.conditionSrc[slideCondition])
    }
  }, [viewingStarted, idx, slides, condition, conditionBySlideId])

  const slide = slides[idx]
  const activeCondition = resolveCondition(slide.id)
  const src = assetUrl(slide.conditionSrc[activeCondition])
  const media = slide.conditionMediaType[activeCondition]

  if (!viewingStarted) {
    return (
      <div className="card media-card">
        <header className="card-header">
          <p className="eyebrow ai-label">{title}</p>
          <h2>Stimulus set</h2>
          <p className="muted">{instructions}</p>
        </header>
        <div className="media-reminder" role="status">
          <p className="media-reminder-lead">
            <strong>Before you start:</strong> You have <strong>{durationSec} seconds</strong> (about one minute) to view{' '}
            <strong>all {slides.length} images</strong>. Try to see each one at least once. When the timer reaches{' '}
            <strong>{durationSec}s</strong>, this step <strong>ends automatically</strong> and the study moves on—you
            cannot extend or pause this block.
          </p>
        </div>
        {prepLockSecondsLeft > 0 ? (
          <p className="muted small" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
            Please read the instructions above. Start button unlocks in{' '}
            <strong>{prepLockSecondsLeft}</strong>s.
          </p>
        ) : null}
        {groupSync ? (
          <GroupPhaseStartGate
            groupId={groupSync.groupId}
            anonId={groupSync.anonId}
            groupSize={groupSync.groupSize}
            phaseKey={groupSync.phaseKey}
            buttonLabel="Start viewing images"
            disabled={prepLockSecondsLeft > 0}
            disabledReason={
              prepLockSecondsLeft > 0
                ? `Please read the instructions. Unlocks in ${prepLockSecondsLeft}s.`
                : undefined
            }
            onStart={() => {
              groupSync.logEvent('group_phase_start', {
                phase: 'condition',
                groupId: groupSync.groupId,
                anonId: groupSync.anonId,
              })
              logEvent('condition_viewing_prepare_ack', {
                slideCount: slides.length,
                durationSec,
                perSlideAssignment: Boolean(conditionBySlideId),
                groupSync: true,
              })
              setViewingStarted(true)
            }}
          />
        ) : (
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn primary"
              disabled={prepLockSecondsLeft > 0}
              title={
                prepLockSecondsLeft > 0
                  ? `Read the instructions. Unlocks in ${prepLockSecondsLeft}s.`
                  : undefined
              }
              onClick={() => {
                logEvent('condition_viewing_prepare_ack', {
                  slideCount: slides.length,
                  durationSec,
                  perSlideAssignment: Boolean(conditionBySlideId),
                })
                setViewingStarted(true)
              }}
            >
              Start viewing images
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card media-card">
      <header className="card-header">
        <p className="eyebrow ai-label">{title}</p>
        <h2>Stimulus set</h2>
        <p className="muted">{instructions}</p>
        <p className="media-reminder-inline muted small">
          <strong>Note:</strong> Try to view all {slides.length} images before the timer ends.
        </p>
        <p className="timer">
          Elapsed {elapsed}s / {durationSec}s · slide {idx + 1} / {slides.length}
        </p>
        <PhaseTimeProgress elapsed={elapsed} durationSec={durationSec} />
        <SlideCoverageProgress seenCount={seenIndices.size} total={slides.length} />
        <p className="muted small">
          When the timer hits {durationSec}s, the next step starts automatically.
        </p>
      </header>
      <div className="swipe-stage">
        {media === 'video' ? (
          <video
            key={slide.id}
            className="stage-img"
            src={src}
            controls
            playsInline
            autoPlay
            loop
            muted
            preload="auto"
          />
        ) : (
          <img
            key={`${slide.id}-${activeCondition}`}
            src={src}
            alt=""
            className="stage-img"
            draggable={false}
            decoding="async"
            fetchPriority="high"
          />
        )}
      </div>
      <div className="btn-row spread">
        <button type="button" className="btn secondary" onClick={() => go(-1)}>
          ← Previous
        </button>
        <button type="button" className="btn secondary" onClick={() => go(1)}>
          Next →
        </button>
      </div>
    </div>
  )
}

function MemoryPhase({
  title,
  instructions,
  items,
  configItemIndexAtPresentation,
  responses,
  onChange,
  onComplete,
  logEvent,
  advanceButtonLabel = 'Next item',
  finalAdvanceButtonLabel = 'Continue to questionnaire',
  memoryAnswerLogExtras,
  conditionViewedForSlide,
  livePersist,
}: {
  title: string
  instructions: string
  items: import('../types/study').MemoryItemDef[]
  configItemIndexAtPresentation: number[]
  responses: MemoryResponse[]
  onChange: (r: MemoryResponse[]) => void
  onComplete: (finalResponses: MemoryResponse[]) => void | Promise<void>
  logEvent: (t: string, p?: Record<string, unknown>) => void
  advanceButtonLabel?: string
  finalAdvanceButtonLabel?: string
  memoryAnswerLogExtras?: Record<string, unknown>
  conditionViewedForSlide?: (slideId: string) => ConditionKey | undefined
  livePersist?: {
    sessionId: string
    groupId: string
    anonId: 'P1' | 'P2' | 'P3' | 'P4'
    participantId?: string
    conditionKey: string
    memoryRound: 'pre_discussion' | 'post_discussion'
  }
}) {
  const [step, setStep] = useState(0)
  const item = items[step]
  const existing = responses[step]

  const [recall, setRecall] = useState<
    'agree' | 'disagree' | 'unsure' | null
  >(existing?.recall ?? null)
  const [confidence, setConfidence] = useState<number | null>(
    existing?.confidence ?? null,
  )

  useEffect(() => {
    const ex = responses[step]
    setRecall(ex?.recall ?? null)
    setConfidence(ex?.confidence ?? null)
  }, [step, responses])

  const saveAndNext = () => {
    if (!recall || confidence === null) return
    const expected = item.expectedAnswer
    const isCorrect = memoryTrialCorrectness(recall, expected)
    const configItemIndex = configItemIndexAtPresentation[step]!
    const viewed = conditionViewedForSlide?.(item.slideId)
    const next = [...responses]
    next[step] = {
      itemIndex: configItemIndex,
      presentationIndex: step,
      slideId: item.slideId,
      recall,
      confidence,
      ...(viewed !== undefined ? { conditionViewed: viewed } : {}),
      ...(expected !== undefined ? { expectedAnswer: expected } : {}),
      isCorrect,
    }
    onChange(next)
    const saved = next[step]!
    logEvent('memory_answer', {
      step,
      presentationIndex: step,
      configItemIndex,
      slideId: item.slideId,
      recall,
      confidence,
      expectedAnswer: expected,
      isCorrect,
      ...(viewed !== undefined ? { conditionViewed: viewed } : {}),
      ...(memoryAnswerLogExtras ?? {}),
    })
    if (livePersist) {
      const client = getSupabaseClient()
      if (client && livePersist.sessionId.trim() && livePersist.groupId.trim()) {
        void persistMemoryAnswerLive(client, {
          ...livePersist,
          answer: {
            ...saved,
            memoryRound: livePersist.memoryRound,
          },
        })
      }
    }
    if (step + 1 >= items.length) void onComplete(next)
    else setStep((s) => s + 1)
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
      <img
        key={item.slideId}
        src={assetUrl(item.maskedSrc)}
        alt=""
        className="masked-img"
        decoding="async"
        fetchPriority="high"
      />
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
        <p className="likert-labels">
          <span>Not at all confident</span>
          <span>Very confident</span>
        </p>
        <div className="likert-row">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <label key={n} className="likert-cell">
              <input
                type="radio"
                name="conf"
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
          disabled={!recall || confidence === null}
          onClick={saveAndNext}
        >
          {step + 1 >= items.length ? finalAdvanceButtonLabel : advanceButtonLabel}
        </button>
      </div>
    </div>
  )
}

function SessionEndScreen({
  submitStatus,
  submitMethod,
  finalizeStudy,
  logEvent,
  submitCompletedBeforeMount,
  externalFormUrl,
  participantIdDisplay,
}: {
  submitStatus: string | null
  submitMethod: 'supabase' | 'download' | null
  finalizeStudy: (opts?: { memoryResponses?: MemoryResponse[] }) => Promise<void>
  logEvent: (t: string, p?: Record<string, unknown>) => void
  /** True when `finalizeStudy` already ran (e.g. after the last memory trial with an external post form). */
  submitCompletedBeforeMount: boolean
  externalFormUrl?: string
  participantIdDisplay: string
}) {
  const [busy, setBusy] = useState(!submitCompletedBeforeMount)

  useEffect(() => {
    if (submitCompletedBeforeMount) {
      setBusy(false)
      return
    }
    let alive = true
    ;(async () => {
      logEvent('submit_start', {})
      await finalizeStudy()
      if (alive) {
        logEvent('submit_done', {})
        setBusy(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [finalizeStudy, logEvent, submitCompletedBeforeMount])

  return (
    <div className="card">
      <header className="card-header">
        <h2>Thank you for participating</h2>
        {submitCompletedBeforeMount ? (
          <p className="muted">
            Your session responses from this website have been saved. If there is a follow-up questionnaire below,
            please complete it when you are ready.
          </p>
        ) : (
          <>
            <p className="muted">
              <strong>Please stay on this page</strong> until saving finishes and a status line appears below.
            </p>
            <p className="muted">
              When you see <strong>Saved to the server (Supabase)</strong>, your session is complete and you may close
              the browser (after any external survey below, if applicable).
            </p>
          </>
        )}
        <p className="muted">
          If <strong>a JSON file downloads</strong> instead of a Supabase confirmation, something went wrong with the
          online save—please send that file to the <strong>researcher who recruited you</strong> so your data are not
          lost.
        </p>
      </header>
      {busy && !submitStatus ? (
        <p className="complete-saving">Uploading your responses… please wait.</p>
      ) : null}
      {submitStatus ? <p className="status-msg">{submitStatus}</p> : null}
      {submitMethod === 'download' ? (
        <p className="muted small complete-download-note">
          A JSON backup was saved in your browser downloads folder. Please email or otherwise share that file with your
          researcher unless they tell you otherwise.
        </p>
      ) : null}
      {externalFormUrl ? (
        <section className="session-end-external-form" aria-labelledby="session-end-external-heading">
          <h3 id="session-end-external-heading" className="session-end-external-title">
            Post-study questionnaire
          </h3>
          <p className="muted">
            Please complete the <strong>Team Othee Post-Study Survey</strong> in Google Forms. Use the
            <strong> Participant ID </strong>
            below if the form asks for it.
          </p>
          <div
            className="external-survey-actions"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.85rem',
              marginTop: '0.35rem',
            }}
          >
            {participantIdDisplay ? (
              <p className="external-survey-id" role="status">
                <span className="muted small">Your Participant ID</span>
                <strong className="external-survey-id-value">{participantIdDisplay}</strong>
              </p>
            ) : (
              <p className="muted small" role="status">
                No Participant ID was stored from this session. If the form asks for one, use the same ID you were given
                by the researcher.
              </p>
            )}
            <a
              className="btn primary"
              href={externalFormUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                logEvent('post_study_external_open', {
                  url: externalFormUrl,
                  participantId: participantIdDisplay || undefined,
                })
              }}
            >
              Open survey (new tab)
            </a>
          </div>
          <p className="muted small" style={{ marginTop: '1rem' }}>
            <span className="external-survey-warning-strong">Important:</span> Do not close this tab until
            you finish and submit the Google Form. You may close this tab only after form submission.
          </p>
        </section>
      ) : null}
    </div>
  )
}
