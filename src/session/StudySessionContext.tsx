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
import { createPresentationOrders } from '../lib/presentationOrder'
import type {
  ConditionKey,
  DiscussionMessage,
  GroupSessionConditionKey,
  LogEvent,
  MemoryResponse,
  PresentationOrders,
  StudyBundle,
  StudyPhase,
} from '../types/study'
import { buildGroupConditionAssignmentPlan } from '../lib/groupConditionAssignment'

export type SessionConditionKey = ConditionKey | GroupSessionConditionKey
import { submitResults, type SubmissionPayload } from '../services/submitResults'

interface StudySessionValue {
  bundle: StudyBundle
  phase: StudyPhase
  setPhase: (p: StudyPhase) => void
  sessionId: string
  condition: SessionConditionKey | null
  setCondition: (c: SessionConditionKey) => void
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
  /** Group mode: replication-style memory test completed before discussion (same item order as the discussion round). */
  memoryResponsesPreDiscussion: MemoryResponse[]
  setMemoryResponsesPreDiscussion: (r: MemoryResponse[]) => void
  clearDiscussionLog: () => void
  fillerStats: Record<string, unknown>
  setFillerStats: (r: Record<string, unknown>) => void
  logEvent: (type: string, payload?: Record<string, unknown>) => void
  eventLog: LogEvent[]
  submitStatus: string | null
  submitMethod: 'supabase' | 'download' | null
  /**
   * Submit session payload to Supabase / download JSON.
   * Pass `memoryResponses` when the in-memory React state may not yet include the last trial (e.g. right after the final memory Continue click).
   */
  finalizeStudy: (opts?: { memoryResponses?: MemoryResponse[] }) => Promise<void>
  /** Maps each phase’s presentation order to indices in `slides.json` / `memory-items.json`. */
  presentationOrders: PresentationOrders
  groupId: string
  setGroupId: (v: string) => void
  anonId: 'P1' | 'P2' | 'P3' | 'P4'
  setAnonId: (v: 'P1' | 'P2' | 'P3' | 'P4') => void
  discussionMessages: DiscussionMessage[]
  addDiscussionMessage: (m: DiscussionMessage) => void
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
  const [condition, setCondition] = useState<SessionConditionKey | null>(null)
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
  const [memoryResponsesPreDiscussion, setMemoryResponsesPreDiscussion] = useState<MemoryResponse[]>(
    [],
  )
  const [fillerStats, setFillerStats] = useState<Record<string, unknown>>({})
  const [eventLog, setEventLog] = useState<LogEvent[]>([])
  const eventLogRef = useRef<LogEvent[]>([])
  const [submitStatus, setSubmitStatus] = useState<string | null>(null)
  const [submitMethod, setSubmitMethod] = useState<'supabase' | 'download' | null>(null)
  const [groupId, setGroupId] = useState('')
  const [anonId, setAnonId] = useState<'P1' | 'P2' | 'P3' | 'P4'>('P1')
  const [discussionMessages, setDiscussionMessages] = useState<DiscussionMessage[]>([])
  const submittedThisRunRef = useRef(false)

  const [presentationOrders] = useState(() => createPresentationOrders(bundle))

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

  const finalizeStudy = useCallback(async (opts?: { memoryResponses?: MemoryResponse[] }) => {
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
    const groupIdTrimmed = groupId.trim()
    let postResponses = opts?.memoryResponses ?? memoryResponses
    if (opts?.memoryResponses) {
      setMemoryResponses(opts.memoryResponses)
    }
    const isGroupSession = Boolean(groupIdTrimmed)
    const groupConditionPlan = isGroupSession
      ? buildGroupConditionAssignmentPlan(groupIdTrimmed, bundle.slides.slides)
      : null
    const memoryPayload: MemoryResponse[] = isGroupSession
      ? [
          ...memoryResponsesPreDiscussion.map((r) => ({
            ...r,
            memoryRound: 'pre_discussion' as const,
          })),
          ...postResponses.map((r) => ({
            ...r,
            memoryRound: 'post_discussion' as const,
          })),
        ]
      : postResponses
    let p = submitInflight.get(sessionId)
    if (!p) {
      p = (async () => {
        const participantIdRaw = demographicsAnswers.participant_id ?? demographicsAnswers.demo_name
        const participantId =
          participantIdRaw === undefined || participantIdRaw === null
            ? undefined
            : String(participantIdRaw).trim() || undefined
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
          memoryResponses: memoryPayload,
          eventLog: eventLogRef.current,
          fillerStats,
          groupId: groupIdTrimmed || undefined,
          anonId: groupIdTrimmed ? anonId : undefined,
          participantId,
          discussionMessages,
          groupConditionBySlide:
            isGroupSession && groupConditionPlan
              ? groupConditionPlan.byParticipant[anonId]
              : undefined,
          groupConditionExposureTable:
            isGroupSession && groupConditionPlan ? groupConditionPlan.exposureTable : undefined,
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
    memoryResponsesPreDiscussion,
    demographicsAnswers,
    preAnswers,
    attention2Answers,
    postAnswers,
    memoryResponses,
    fillerStats,
    groupId,
    anonId,
    discussionMessages,
    bundle.slides.slides,
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
      memoryResponsesPreDiscussion,
      setMemoryResponsesPreDiscussion,
      clearDiscussionLog: () => setDiscussionMessages([]),
      fillerStats,
      setFillerStats,
      logEvent,
      eventLog,
      submitStatus,
      submitMethod,
      finalizeStudy,
      presentationOrders,
      groupId,
      setGroupId,
      anonId,
      setAnonId,
      discussionMessages,
      addDiscussionMessage: (m: DiscussionMessage) => {
        setDiscussionMessages((prev) => {
          const exists = prev.some(
            (x) =>
              x.questionIndex === m.questionIndex &&
              x.slideId === m.slideId &&
              x.anonId === m.anonId &&
              x.message === m.message &&
              x.sentAt === m.sentAt,
          )
          return exists ? prev : [...prev, m]
        })
      },
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
      memoryResponsesPreDiscussion,
      fillerStats,
      logEvent,
      eventLog,
      submitStatus,
      submitMethod,
      finalizeStudy,
      presentationOrders,
      groupId,
      anonId,
      discussionMessages,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStudySession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStudySession outside provider')
  return v
}
