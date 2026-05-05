import { useEffect, useMemo, useRef, useState } from 'react'
import { useStudySession } from '../session/StudySessionContext'
import { SurveyRunner } from './SurveyRunner'
import { FillerPacMan } from './FillerPacMan'
import { GroupLobby, GroupMemoryPhase } from './GroupDiscussionFlow'
import { assetUrl } from '../lib/assetUrl'
import { DebugSkipBar } from '../lib/debugUi'
import { memoryTrialCorrectness, type MemoryResponse } from '../types/study'

/** Seconds the "Start viewing images" button stays disabled so participants read instructions. */
const VIEW_PREP_MIN_WAIT_SECONDS = 5
const GROUP_MEMBERS = ['P1', 'P2', 'P3', 'P4'] as const
const EDITED_PAIRS: ReadonlyArray<readonly ['P1' | 'P2' | 'P3' | 'P4', 'P1' | 'P2' | 'P3' | 'P4']> = [
  ['P1', 'P2'],
  ['P1', 'P3'],
  ['P1', 'P4'],
  ['P2', 'P3'],
  ['P2', 'P4'],
  ['P3', 'P4'],
]

function stableHash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function assignGroupCondition(groupId: string, anonId: 'P1' | 'P2' | 'P3' | 'P4') {
  const pair = EDITED_PAIRS[stableHash(groupId.trim().toLowerCase()) % EDITED_PAIRS.length]!
  return pair.includes(anonId) ? ('ai_edited_image' as const) : ('no_edit' as const)
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

function CountdownFiller({
  seconds,
  onDone,
}: {
  seconds: number
  onDone: () => void
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
        <button type="button" className="btn primary" onClick={() => setStarted(true)}>
          Start timer
        </button>
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
  const [groupModeRequested, setGroupModeRequested] = useState(false)
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

  /** Memory (external form flow) runs `finalizeStudy` before this screen; in-app post survey defers submit here. */
  const [submitCompletedBeforeEndScreen, setSubmitCompletedBeforeEndScreen] = useState(false)

  if (phase === 'intro') {
    return (
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
        <p className="consent">{meta.consentText}</p>
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
            Assigned condition (debug): {bundle.study.conditionLabels[condition]}
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
                startCondition = assignGroupCondition(groupId, anonId)
                setCondition(startCondition)
                logEvent('group_condition_auto_assigned', {
                  groupId,
                  anonId,
                  assignedCondition: startCondition,
                })
              }
              if (startCondition === null) return
              logEvent('session_start', {
                sessionId,
                condition: startCondition,
                conditionLabel: bundle.study.conditionLabels[startCondition],
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
        <DebugSkipBar>
          <button
            type="button"
            className="btn debug-skip"
            onClick={() => {
              logEvent('intro_debug_skip', {})
              setConsentAccepted(true)
              setCondition('no_edit')
              logEvent('session_start', {
                sessionId,
                condition: 'no_edit',
                conditionLabel: bundle.study.conditionLabels.no_edit,
                userAgent: navigator.userAgent,
                debugSkip: true,
                presentationOrders: {
                  baseline: [...presentationOrders.baseline],
                  condition: [...presentationOrders.condition],
                  memory: [...presentationOrders.memory],
                },
              })
              logEvent('phase_enter', { phase: 'demographics' })
              setPhase('demographics')
            }}
          >
            [Debug] Skip intro (auto-check consent, skip Begin)
          </button>
        </DebugSkipBar>
      </div>
    )
  }

  if (phase === 'group_lobby' && groupModeRequested) {
    return (
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
    return (
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
    return (
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
    return (
      <BaselinePhase
        title={meta.baselinePhaseTitle}
        instructions={meta.baselinePhaseInstructions}
        slides={orderedBaselineSlides}
        configIndexAtPresentation={presentationOrders.baseline}
        durationSec={meta.baselineDurationSeconds}
        onComplete={() => {
          logEvent('phase_enter', { phase: 'filler' })
          setPhase('filler')
        }}
        logEvent={logEvent}
      />
    )
  }

  if (phase === 'filler') {
    const skipFillerDebug = () => {
      logEvent('filler_debug_skip', {
        fillerType: bundle.filler.type,
        minDurationSeconds: bundle.filler.minDurationSeconds,
      })
      if (bundle.filler.type === 'pacman') {
        setFillerStats({
          type: 'pacman',
          debugSkip: true,
          note: 'Debug: filler duration skipped',
        })
      } else {
        setFillerStats({
          type: bundle.filler.type,
          durationSeconds: bundle.filler.minDurationSeconds,
          debugSkip: true,
        })
      }
      logEvent('phase_enter', { phase: 'attention2' })
      setPhase('attention2')
    }

    return (
      <div className="card">
        <header className="card-header">
          <h2>{bundle.filler.title}</h2>
          <p className="muted">{bundle.filler.instructions}</p>
        </header>
        <DebugSkipBar>
          <button type="button" className="btn debug-skip" onClick={skipFillerDebug}>
            [Debug] Skip filler timer
          </button>
        </DebugSkipBar>
        {bundle.filler.type === 'pacman' ? (
          <FillerPacMan
            durationSeconds={bundle.filler.minDurationSeconds}
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
    return (
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
      return (
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
    return (
      <ConditionPhase
        title={meta.conditionPhaseTitle}
        instructions={meta.conditionPhaseInstructions}
        slides={orderedConditionSlides}
        configIndexAtPresentation={presentationOrders.condition}
        condition={conditionKey}
        durationSec={meta.conditionDurationSeconds}
        onComplete={() => {
          logEvent('phase_enter', { phase: 'memory' })
          setPhase('memory')
        }}
        logEvent={logEvent}
      />
    )
  }

  if (phase === 'memory') {
    const externalPostUrl = meta.postStudyExternalFormUrl?.trim()
    if (groupModeRequested) {
      return (
        <GroupMemoryPhase
          title={meta.memoryPhaseTitle}
          instructions={meta.memoryPhaseInstructions}
          items={groupOrderedMemoryItems}
          configItemIndexAtPresentation={groupMemoryOrder}
          groupId={groupId}
          anonId={anonId}
          groupSize={groupCfg?.groupSize ?? 4}
          durationSec={groupCfg?.discussionDurationSeconds ?? 180}
          prompt={groupCfg?.prompt}
          responses={memoryResponses}
          onLog={logEvent}
          onMessagePersist={addDiscussionMessage}
          onAnswer={(step, recall, confidence) => {
            const item = groupOrderedMemoryItems[step]!
            const expected = item.expectedAnswer
            const isCorrect = memoryTrialCorrectness(recall, expected)
            const configItemIndex = groupMemoryOrder[step]!
            const next = [...memoryResponses]
            next[step] = {
              itemIndex: configItemIndex,
              presentationIndex: step,
              slideId: item.slideId,
              recall,
              confidence,
              ...(expected !== undefined ? { expectedAnswer: expected } : {}),
              isCorrect,
            }
            setMemoryResponses(next)
            logEvent('memory_answer', {
              step,
              presentationIndex: step,
              configItemIndex,
              slideId: item.slideId,
              recall,
              confidence,
              expectedAnswer: expected,
              isCorrect,
              groupMode: true,
            })
          }}
          onDebugSkip={() => {
            const now = new Date().toISOString()
            const fake = groupOrderedMemoryItems.map((it, i) => {
              const expected = it.expectedAnswer
              const recall = 'unsure' as const
              const configItemIndex = groupMemoryOrder[i]!
              return {
                itemIndex: configItemIndex,
                presentationIndex: i,
                slideId: it.slideId,
                recall,
                confidence: 4,
                ...(expected !== undefined ? { expectedAnswer: expected } : {}),
                isCorrect: memoryTrialCorrectness(recall, expected),
              }
            })
            setMemoryResponses(fake)
            groupOrderedMemoryItems.forEach((it, i) => {
              addDiscussionMessage({
                questionIndex: i,
                slideId: it.slideId,
                anonId,
                message: `[debug] synthetic chat for item ${i + 1}`,
                sentAt: now,
              })
            })
            logEvent('group_memory_debug_skip', {
              itemCount: groupOrderedMemoryItems.length,
              filledWith: 'unsure/4',
              fakeChatPerItem: true,
            })
            logEvent('phase_enter', { phase: 'post_survey' })
            setPhase('post_survey')
          }}
          onComplete={async () => {
            if (externalPostUrl) {
              logEvent('submit_start', {})
              await finalizeStudy()
              logEvent('submit_done', {})
              setSubmitCompletedBeforeEndScreen(true)
              logEvent('phase_enter', { phase: 'complete' })
              setPhase('complete')
            } else {
              logEvent('phase_enter', { phase: 'post_survey' })
              setPhase('post_survey')
            }
          }}
        />
      )
    }
    return (
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
    return (
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
    return (
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
  onComplete,
  logEvent,
}: {
  title: string
  instructions: string
  slides: { id: string; baselineSrc: string }[]
  /** Same length as `slides`: config row index in `slides.json` for each presentation position. */
  configIndexAtPresentation: number[]
  durationSec: number
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
        <DebugSkipBar>
          <button
            type="button"
            className="btn debug-skip"
            onClick={() => {
              if (autoAdvancedRef.current) return
              autoAdvancedRef.current = true
              logEvent('baseline_debug_skip', {
                elapsed,
                idx,
                maxIdx,
                durationSec,
                slideCount: slides.length,
                beforeViewingStart: true,
                prepLockBypass: prepLockSecondsLeft > 0,
              })
              logEvent('baseline_complete', { elapsed, maxIdx, debugSkip: true })
              onComplete()
            }}
          >
            [Debug] Skip baseline (ignore timer)
          </button>
        </DebugSkipBar>
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
      <DebugSkipBar>
        <button
          type="button"
          className="btn debug-skip"
          onClick={() => {
            if (autoAdvancedRef.current) return
            autoAdvancedRef.current = true
            logEvent('baseline_debug_skip', {
              elapsed,
              idx,
              maxIdx,
              durationSec,
              slideCount: slides.length,
            })
            logEvent('baseline_complete', { elapsed, maxIdx, debugSkip: true })
            onComplete()
          }}
        >
          [Debug] Skip baseline (ignore timer)
        </button>
      </DebugSkipBar>
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
  durationSec,
  onComplete,
  logEvent,
}: {
  title: string
  instructions: string
  slides: import('../types/study').SlideDef[]
  configIndexAtPresentation: number[]
  condition: import('../types/study').ConditionKey
  durationSec: number
  onComplete: () => void
  logEvent: (t: string, p?: Record<string, unknown>) => void
}) {
  const [viewingStarted, setViewingStarted] = useState(false)
  const [idx, setIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [seenIndices, setSeenIndices] = useState<Set<number>>(() => new Set([0]))
  const autoAdvancedRef = useRef(false)
  const prepLockSecondsLeft = usePrepScreenLock(viewingStarted)

  useEffect(() => {
    setIdx(0)
  }, [condition])

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
      elapsed,
      autoAdvanceAfterMinDuration: true,
    })
    onComplete()
  }, [viewingStarted, elapsed, durationSec, condition, logEvent, onComplete])

  const go = (dir: 1 | -1) => {
    setIdx((i) => (i + dir + slides.length) % slides.length)
  }

  useEffect(() => {
    if (!viewingStarted) return
    const slide = slides[idx]
    logEvent('condition_slide', {
      slideId: slide.id,
      presentationIndex: idx,
      configSlideIndex: configIndexAtPresentation[idx],
      condition,
      media: slide.conditionMediaType[condition],
      src: slide.conditionSrc[condition],
    })
  }, [idx, slides, condition, logEvent, viewingStarted, configIndexAtPresentation])

  useEffect(() => {
    if (!viewingStarted || slides.length === 0) return
    const n = slides.length
    const want = new Set([idx, (idx + 1) % n, (idx - 1 + n) % n])
    for (const i of want) {
      const sl = slides[i]!
      if (sl.conditionMediaType[condition] !== 'image') continue
      const img = new Image()
      img.src = assetUrl(sl.conditionSrc[condition])
    }
  }, [viewingStarted, idx, slides, condition])

  const slide = slides[idx]
  const src = assetUrl(slide.conditionSrc[condition])
  const media = slide.conditionMediaType[condition]

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
                condition,
              })
              setViewingStarted(true)
            }}
          >
            Start viewing images
          </button>
        </div>
        <DebugSkipBar>
          <button
            type="button"
            className="btn debug-skip"
            onClick={() => {
              if (!autoAdvancedRef.current) autoAdvancedRef.current = true
              logEvent('condition_debug_skip', {
                idx,
                condition,
                elapsed,
                beforeViewingStart: true,
                prepLockBypass: prepLockSecondsLeft > 0,
              })
              logEvent('condition_complete', { condition, debugSkip: true })
              onComplete()
            }}
          >
            [Debug] Skip stimulus set (ignore timer)
          </button>
        </DebugSkipBar>
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
      <DebugSkipBar>
        <button
          type="button"
          className="btn debug-skip"
          onClick={() => {
            if (!autoAdvancedRef.current) autoAdvancedRef.current = true
            logEvent('condition_debug_skip', { idx, condition, elapsed })
            logEvent('condition_complete', { condition, debugSkip: true })
            onComplete()
          }}
        >
          [Debug] Skip stimulus set (ignore timer)
        </button>
      </DebugSkipBar>
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
            key={slide.id}
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
}: {
  title: string
  instructions: string
  items: import('../types/study').MemoryItemDef[]
  configItemIndexAtPresentation: number[]
  responses: MemoryResponse[]
  onChange: (r: MemoryResponse[]) => void
  onComplete: (finalResponses: MemoryResponse[]) => void | Promise<void>
  logEvent: (t: string, p?: Record<string, unknown>) => void
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
    const next = [...responses]
    next[step] = {
      itemIndex: configItemIndex,
      presentationIndex: step,
      slideId: item.slideId,
      recall,
      confidence,
      ...(expected !== undefined ? { expectedAnswer: expected } : {}),
      isCorrect,
    }
    onChange(next)
    logEvent('memory_answer', {
      step,
      presentationIndex: step,
      configItemIndex,
      slideId: item.slideId,
      recall,
      confidence,
      expectedAnswer: expected,
      isCorrect,
    })
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
      <DebugSkipBar>
        <button
          type="button"
          className="btn debug-skip"
          onClick={() => {
            const stub = items.map((it, i) => {
              const expected = it.expectedAnswer
              const recall = 'unsure' as const
              const configItemIndex = configItemIndexAtPresentation[i]!
              return {
                itemIndex: configItemIndex,
                presentationIndex: i,
                slideId: it.slideId,
                recall,
                confidence: 4,
                ...(expected !== undefined ? { expectedAnswer: expected } : {}),
                isCorrect: memoryTrialCorrectness(recall, expected),
              }
            })
            onChange(stub)
            logEvent('memory_phase_debug_skip', {
              itemCount: items.length,
              filledWith: 'unsure/4',
            })
            onComplete(stub)
          }}
        >
          [Debug] Skip follow-up block (fill all as Not sure / confidence 4)
        </button>
      </DebugSkipBar>
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
          {step + 1 >= items.length ? 'Continue to questionnaire' : 'Next item'}
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
          <DebugSkipBar>
            <button
              type="button"
              className="btn debug-skip"
              onClick={() => {
                logEvent('post_study_external_debug_skip', { url: externalFormUrl })
              }}
            >
              [Debug] Log pretend external survey done
            </button>
          </DebugSkipBar>
        </section>
      ) : null}
      <DebugSkipBar>
        <button
          type="button"
          className="btn debug-skip"
          onClick={() => {
            logEvent('complete_debug_reload', {})
            window.location.reload()
          }}
        >
          [Debug] Reload (session / cache testing)
        </button>
      </DebugSkipBar>
    </div>
  )
}
