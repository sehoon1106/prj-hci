import { useEffect, useRef, useState } from 'react'
import { useStudySession } from '../session/StudySessionContext'
import { SurveyRunner } from './SurveyRunner'
import { FillerPacMan } from './FillerPacMan'
import type { MemoryResponse } from '../types/study'

function SlideCoverageProgress({
  seenCount,
  total,
}: {
  seenCount: number
  total: number
}) {
  const pct = total > 0 ? Math.round((seenCount / total) * 100) : 0
  return (
    <div className="media-progress">
      <p className="media-progress-label">
        Images seen at least once: {seenCount} / {total} ({pct}%)
      </p>
      <div
        className="media-progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="media-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
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
    condition,
    consentAccepted,
    setConsentAccepted,
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
    finalizeStudy,
  } = useStudySession()

  const meta = bundle.study
  const slides = bundle.slides.slides
  const memoryItems = bundle.memory.items

  if (phase === 'intro') {
    return (
      <div className="card">
        <header className="card-header">
          <h1>{meta.title}</h1>
          <p className="muted">{meta.shortDescription}</p>
        </header>
        <p className="consent">{meta.consentText}</p>
        {meta.showConditionKeyToParticipant ? (
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
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            disabled={!consentAccepted}
            onClick={() => {
              logEvent('phase_enter', { phase: 'pre_survey' })
              setPhase('pre_survey')
            }}
          >
            Begin
          </button>
        </div>
        <div className="debug-skip-bar">
          <button
            type="button"
            className="btn debug-skip"
            onClick={() => {
              logEvent('intro_debug_skip', {})
              setConsentAccepted(true)
              logEvent('phase_enter', { phase: 'pre_survey' })
              setPhase('pre_survey')
            }}
          >
            [Debug] Skip intro (auto-check consent, skip Begin)
          </button>
        </div>
      </div>
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
        slides={slides}
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
        <div className="debug-skip-bar">
          <button type="button" className="btn debug-skip" onClick={skipFillerDebug}>
            [Debug] Skip filler timer
          </button>
        </div>
        {bundle.filler.type === 'pacman' ? (
          <FillerPacMan
            durationSeconds={bundle.filler.minDurationSeconds}
            onStats={(s) => {
              setFillerStats(s)
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
    return (
      <ConditionPhase
        title={meta.conditionPhaseTitle}
        instructions={meta.conditionPhaseInstructions}
        slides={slides}
        condition={condition}
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
    return (
      <MemoryPhase
        title={meta.memoryPhaseTitle}
        instructions={meta.memoryPhaseInstructions}
        items={memoryItems}
        responses={memoryResponses}
        onChange={setMemoryResponses}
        onComplete={() => {
          logEvent('phase_enter', { phase: 'post_survey' })
          setPhase('post_survey')
        }}
        logEvent={logEvent}
      />
    )
  }

  if (phase === 'post_survey') {
    return (
      <SurveyRunner
        config={bundle.postSurvey}
        answers={postAnswers}
        onChange={setPostAnswers}
        logSurveyId="post"
        onLog={logEvent}
        onComplete={() => {
          logEvent('phase_enter', { phase: 'complete' })
          setPhase('complete')
        }}
        onDebugSkipEntireSurvey={() => {
          logEvent('phase_enter', { phase: 'complete' })
          setPhase('complete')
        }}
      />
    )
  }

  if (phase === 'complete') {
    return (
      <CompleteScreen
        submitStatus={submitStatus}
        finalizeStudy={finalizeStudy}
        logEvent={logEvent}
      />
    )
  }

  return null
}

function BaselinePhase({
  title,
  instructions,
  slides,
  durationSec,
  onComplete,
  logEvent,
}: {
  title: string
  instructions: string
  slides: { id: string; baselineSrc: string }[]
  durationSec: number
  onComplete: () => void
  logEvent: (t: string, p?: Record<string, unknown>) => void
}) {
  const [idx, setIdx] = useState(0)
  const [maxIdx, setMaxIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [seenIndices, setSeenIndices] = useState<Set<number>>(() => new Set([0]))
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const prevIdxRef = useRef<number | null>(null)
  const autoAdvancedRef = useRef(false)

  useEffect(() => {
    setSeenIndices((prev) => {
      if (prev.has(idx)) return prev
      const next = new Set(prev)
      next.add(idx)
      return next
    })
  }, [idx])

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (autoAdvancedRef.current || elapsed < durationSec) return
    autoAdvancedRef.current = true
    logEvent('baseline_complete', {
      elapsed,
      maxIdx,
      autoAdvanceAfterMinDuration: true,
    })
    onComplete()
  }, [elapsed, durationSec, maxIdx, logEvent, onComplete])

  useEffect(() => {
    for (const slide of slides) {
      const img = new Image()
      img.src = slide.baselineSrc
    }
  }, [slides])

  useEffect(() => {
    setMaxIdx((m) => Math.max(m, idx))
    const prev = prevIdxRef.current
    prevIdxRef.current = idx
    if (prev !== null && prev !== idx) {
      logEvent('baseline_slide', { slideId: slides[idx].id, index: idx })
    }
  }, [idx, slides, logEvent])

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

  return (
    <div className="card media-card">
      <header className="card-header">
        <h2>{title}</h2>
        <p className="muted">{instructions}</p>
        <p className="timer">
          Elapsed {elapsed}s / minimum {durationSec}s · slide {idx + 1} / {slides.length}
        </p>
        <SlideCoverageProgress seenCount={seenIndices.size} total={slides.length} />
        <p className="muted small">
          When the minimum time is reached, the study will continue automatically.
        </p>
      </header>
      <div className="debug-skip-bar">
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
          [Debug] Skip baseline (ignore minimum time and last-slide requirement)
        </button>
      </div>
      <div
        className="swipe-stage"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          key={s.id}
          src={s.baselineSrc}
          alt=""
          className="stage-img"
          draggable={false}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <div className="visually-hidden" aria-hidden>
        {slides.map((sl) => (
          <img key={`preload-${sl.id}`} src={sl.baselineSrc} alt="" decoding="async" />
        ))}
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
  condition,
  durationSec,
  onComplete,
  logEvent,
}: {
  title: string
  instructions: string
  slides: import('../types/study').SlideDef[]
  condition: import('../types/study').ConditionKey
  durationSec: number
  onComplete: () => void
  logEvent: (t: string, p?: Record<string, unknown>) => void
}) {
  const [idx, setIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [seenIndices, setSeenIndices] = useState<Set<number>>(() => new Set([0]))
  const autoAdvancedRef = useRef(false)

  useEffect(() => {
    setIdx(0)
  }, [condition])

  useEffect(() => {
    setSeenIndices((prev) => {
      if (prev.has(idx)) return prev
      const next = new Set(prev)
      next.add(idx)
      return next
    })
  }, [idx])

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (autoAdvancedRef.current || elapsed < durationSec) return
    autoAdvancedRef.current = true
    logEvent('condition_complete', {
      condition,
      elapsed,
      autoAdvanceAfterMinDuration: true,
    })
    onComplete()
  }, [elapsed, durationSec, condition, logEvent, onComplete])

  const go = (dir: 1 | -1) => {
    setIdx((i) => Math.min(slides.length - 1, Math.max(0, i + dir)))
  }

  useEffect(() => {
    const slide = slides[idx]
    logEvent('condition_slide', {
      slideId: slide.id,
      index: idx,
      condition,
      media: slide.conditionMediaType[condition],
      src: slide.conditionSrc[condition],
    })
  }, [idx, slides, condition, logEvent])

  const slide = slides[idx]
  const src = slide.conditionSrc[condition]
  const media = slide.conditionMediaType[condition]

  return (
    <div className="card media-card">
      <header className="card-header">
        <p className="eyebrow ai-label">{title}</p>
        <h2>Stimulus set</h2>
        <p className="muted">{instructions}</p>
        <p className="timer">
          Elapsed {elapsed}s / minimum {durationSec}s · slide {idx + 1} / {slides.length}
        </p>
        <SlideCoverageProgress seenCount={seenIndices.size} total={slides.length} />
        <p className="muted small">
          When the minimum time is reached, the study will continue automatically.
        </p>
      </header>
      <div className="debug-skip-bar">
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
      </div>
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
        <button
          type="button"
          className="btn secondary"
          disabled={idx <= 0}
          onClick={() => go(-1)}
        >
          ← Previous
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={idx >= slides.length - 1}
          onClick={() => go(1)}
        >
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
  responses,
  onChange,
  onComplete,
  logEvent,
}: {
  title: string
  instructions: string
  items: import('../types/study').MemoryItemDef[]
  responses: MemoryResponse[]
  onChange: (r: MemoryResponse[]) => void
  onComplete: () => void
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
    const next = [...responses]
    next[step] = {
      itemIndex: step,
      slideId: item.slideId,
      recall,
      confidence,
    }
    onChange(next)
    logEvent('memory_answer', {
      step,
      slideId: item.slideId,
      recall,
      confidence,
    })
    if (step + 1 >= items.length) onComplete()
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
      <div className="debug-skip-bar">
        <button
          type="button"
          className="btn debug-skip"
          onClick={() => {
            const stub = items.map((it, i) => ({
              itemIndex: i,
              slideId: it.slideId,
              recall: 'unsure' as const,
              confidence: 4,
            }))
            onChange(stub)
            logEvent('memory_phase_debug_skip', {
              itemCount: items.length,
              filledWith: 'unsure/4',
            })
            onComplete()
          }}
        >
          [Debug] Skip entire memory test (fill all as Not sure / confidence 4)
        </button>
      </div>
      <img
        key={item.slideId}
        src={item.maskedSrc}
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

function CompleteScreen({
  submitStatus,
  finalizeStudy,
  logEvent,
}: {
  submitStatus: string | null
  finalizeStudy: () => Promise<void>
  logEvent: (t: string, p?: Record<string, unknown>) => void
}) {
  const [busy, setBusy] = useState(true)

  useEffect(() => {
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
  }, [finalizeStudy, logEvent])

  return (
    <div className="card">
      <header className="card-header">
        <h2>Thank you for participating</h2>
        <p className="muted">
          Your responses have been saved. You may close the browser when you are done.
        </p>
      </header>
      {busy && !submitStatus ? <p>Saving…</p> : null}
      {submitStatus ? <p className="status-msg">{submitStatus}</p> : null}
      <div className="debug-skip-bar">
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
      </div>
    </div>
  )
}
