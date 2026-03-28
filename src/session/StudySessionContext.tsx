import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const submitInflight = new Map<string, Promise<void>>()
import type {
  ConditionKey,
  LogEvent,
  MemoryResponse,
  StudyBundle,
  StudyPhase,
} from '../types/study'
import { submitResults, type SubmissionPayload } from '../services/submitResults'

interface StudySessionValue {
  bundle: StudyBundle
  phase: StudyPhase
  setPhase: (p: StudyPhase) => void
  sessionId: string
  condition: ConditionKey | null
  setCondition: (c: ConditionKey) => void
  consentAccepted: boolean
  setConsentAccepted: (v: boolean) => void
  demographicsAnswers: Record<string, string | number>
  setDemographicsAnswers: (r: Record<string, string | number>) => void
  preAnswers: Record<string, string | number>
  setPreAnswers: (r: Record<string, string | number>) => void
  attention2Answers: Record<string, string | number>
  setAttention2Answers: (r: Record<string, string | number>) => void
  postAnswers: Record<string, string | number>
  setPostAnswers: (r: Record<string, string | number>) => void
  memoryResponses: MemoryResponse[]
  setMemoryResponses: (r: MemoryResponse[]) => void
  fillerStats: Record<string, unknown>
  setFillerStats: (r: Record<string, unknown>) => void
  logEvent: (type: string, payload?: Record<string, unknown>) => void
  eventLog: LogEvent[]
  submitStatus: string | null
  submitMethod: 'supabase' | 'download' | null
  finalizeStudy: () => Promise<void>
}

const Ctx = createContext<StudySessionValue | null>(null)

export function StudySessionProvider({
  bundle,
  children,
}: {
  bundle: StudyBundle
  children: ReactNode
}) {
  const sessionIdRef = useRef<string | null>(null)
  if (!sessionIdRef.current) {
    sessionIdRef.current = crypto.randomUUID()
  }
  const sessionId = sessionIdRef.current

  const [phase, setPhase] = useState<StudyPhase>('intro')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [demographicsAnswers, setDemographicsAnswers] = useState<
    Record<string, string | number>
  >({})
  const [condition, setCondition] = useState<ConditionKey | null>(null)
  const [preAnswers, setPreAnswers] = useState<
    Record<string, string | number>
  >({})
  const [attention2Answers, setAttention2Answers] = useState<
    Record<string, string | number>
  >({})
  const [postAnswers, setPostAnswers] = useState<
    Record<string, string | number>
  >({})
  const [memoryResponses, setMemoryResponses] = useState<MemoryResponse[]>([])
  const [fillerStats, setFillerStats] = useState<Record<string, unknown>>({})
  const [eventLog, setEventLog] = useState<LogEvent[]>([])
  const eventLogRef = useRef<LogEvent[]>([])
  const [submitStatus, setSubmitStatus] = useState<string | null>(null)
  const [submitMethod, setSubmitMethod] = useState<'supabase' | 'download' | null>(null)
  const submittedThisRunRef = useRef(false)

  const logEvent = useCallback((type: string, payload?: Record<string, unknown>) => {
    const ev: LogEvent = {
      t: new Date().toISOString(),
      type,
      payload,
    }
    setEventLog((prev) => {
      const next = [...prev, ev]
      eventLogRef.current = next
      return next
    })
  }, [])

  const finalizeStudy = useCallback(async () => {
    if (submittedThisRunRef.current) {
      setSubmitStatus(
        (prev) => prev ?? 'This run has already been submitted. Reload the page to start a new session.',
      )
      return
    }
    if (condition === null) {
      setSubmitMethod(null)
      setSubmitStatus(
        'Could not submit: no study option (A/B) was selected. Please reload the page and start again.',
      )
      return
    }
    let p = submitInflight.get(sessionId)
    if (!p) {
      p = (async () => {
        const payload: SubmissionPayload = {
          schemaVersion: 1,
          sessionId,
          conditionKey: condition,
          submittedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          demographics: demographicsAnswers,
          preSurvey: preAnswers,
          attention2: attention2Answers,
          postSurvey: postAnswers,
          memoryResponses,
          eventLog: eventLogRef.current,
          fillerStats,
        }
        const r = await submitResults(payload)
        submittedThisRunRef.current = true
        if (r.method === 'supabase') {
          setSubmitMethod('supabase')
          setSubmitStatus('Saved to the server (Supabase).')
        } else {
          setSubmitMethod('download')
          setSubmitStatus(
            r.error ??
              'Saved as a JSON file in your browser. Configure Supabase to also upload to a server.',
          )
        }
      })().finally(() => submitInflight.delete(sessionId))
      submitInflight.set(sessionId, p)
    }
    await p
  }, [
    sessionId,
    condition,
    demographicsAnswers,
    preAnswers,
    attention2Answers,
    postAnswers,
    memoryResponses,
    fillerStats,
  ])

  const value = useMemo(
    () => ({
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
      fillerStats,
      setFillerStats,
      logEvent,
      eventLog,
      submitStatus,
      submitMethod,
      finalizeStudy,
    }),
    [
      bundle,
      phase,
      sessionId,
      condition,
      setCondition,
      consentAccepted,
      demographicsAnswers,
      preAnswers,
      attention2Answers,
      postAnswers,
      memoryResponses,
      fillerStats,
      logEvent,
      eventLog,
      submitStatus,
      submitMethod,
      finalizeStudy,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStudySession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStudySession outside provider')
  return v
}
