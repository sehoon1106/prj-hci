import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'
import { loadStudyBundle } from '../lib/loadStudyConfig'
import type { ConditionKey, StudyBundle, SurveyConfig, SurveyItem } from '../types/study'
import type { GroupSlideConditionExposure } from '../lib/groupConditionAssignment'

const LIST_LIMIT = 500

interface MemoryResponseRow {
  itemIndex: number
  presentationIndex: number
  slideId: string
  recall: 'agree' | 'disagree' | 'unsure'
  confidence: number
  memoryRound?: 'pre_discussion' | 'post_discussion'
  conditionViewed?: ConditionKey
  expectedAnswer?: 'agree' | 'disagree'
  isCorrect: boolean | null
}

interface EventLogRow {
  t: string
  type: string
  payload?: Record<string, unknown>
}

interface ParticipantSummaryFromLog {
  no_edit?: number
  ai_edited_image?: number
  congruent_edited?: number
  incongruent_edited?: number
  slideCount?: number
  scheme?: 'A' | 'B' | 'C' | 'D'
}

export interface StudySubmissionRow {
  id: string
  created_at: string
  session_id: string
  condition_key: string
  submitted_at: string
  user_agent: string | null
  schema_version: number
  demographics?: Record<string, unknown>
  pre_survey: Record<string, unknown>
  attention2: Record<string, unknown>
  post_survey: Record<string, unknown>
  memory_responses: MemoryResponseRow[]
  event_log: EventLogRow[]
  filler_stats: Record<string, unknown>
  group_id: string | null
  anon_id: string | null
  participant_id: string | null
  group_condition_by_slide: Record<string, ConditionKey> | null
  group_condition_exposure_table: GroupSlideConditionExposure[] | null
}

interface DiscussionLogEntry {
  anon_id: string
  participant_id: string | null
  message: string
  sent_at: string
}

interface DiscussionMessageRow {
  id: string
  session_id: string
  group_id: string
  anon_id: string | null
  participant_id: string | null
  question_index: number
  slide_id: string
  discussion_log: DiscussionLogEntry[]
  condition_exposure: GroupSlideConditionExposure | null
  created_at: string
}

function participantIdFromRow(row: StudySubmissionRow): string {
  const direct = row.participant_id
  if (direct && String(direct).trim() !== '') return String(direct).trim()
  const demo = row.demographics
  if (demo) {
    const raw = demo.participant_id ?? demo.demo_name
    if (raw !== undefined && raw !== '') return String(raw).trim()
  }
  return '—'
}

function conditionOptionLetter(conditionKey: string, orderedKeys: string[]): string | null {
  const i = orderedKeys.indexOf(conditionKey)
  if (i < 0) return null
  return String.fromCharCode(65 + i)
}

function formatConditionCell(row: StudySubmissionRow, study: StudyBundle['study'] | null): string {
  if (row.condition_key === 'group_mixed') return 'Group · mixed per slide'
  const label = study?.conditionLabels[row.condition_key as keyof typeof study.conditionLabels]
  const letter = study?.conditionKeys
    ? conditionOptionLetter(row.condition_key, study.conditionKeys)
    : null
  if (letter && label) return `Option ${letter} · ${label}`
  if (label) return String(label)
  if (letter) return `Option ${letter} · ${row.condition_key}`
  return row.condition_key
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function formatShortTs(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function memoryRoundLabel(round?: 'pre_discussion' | 'post_discussion'): string {
  if (round === 'pre_discussion') return 'Pre'
  if (round === 'post_discussion') return 'Post'
  return '—'
}

function recallLabel(recall: MemoryResponseRow['recall']): string {
  return recall === 'agree' ? 'Agree' : recall === 'disagree' ? 'Disagree' : 'Unsure'
}

function correctnessCell(r: MemoryResponseRow): { text: string; klass: string } {
  if (r.isCorrect === true) return { text: 'Correct', klass: 'admin-pill admin-pill--ok' }
  if (r.isCorrect === false) return { text: 'Wrong', klass: 'admin-pill admin-pill--bad' }
  return { text: '—', klass: 'admin-pill admin-pill--neutral' }
}

function conditionViewedLabel(v?: ConditionKey): string {
  if (v === 'no_edit') return 'Original'
  if (v === 'ai_edited_image') return 'AI-edited'
  return '—'
}

function editTypeBadge(t?: 'congruent' | 'incongruent'): { text: string; klass: string } {
  if (t === 'congruent') return { text: 'congruent', klass: 'admin-pill admin-pill--congruent' }
  if (t === 'incongruent') return { text: 'incongruent', klass: 'admin-pill admin-pill--incongruent' }
  return { text: '—', klass: 'admin-pill admin-pill--neutral' }
}

function flattenSurveyItems(cfg: SurveyConfig | undefined): SurveyItem[] {
  if (!cfg) return []
  return cfg.pages.flatMap((p) => p.items)
}

function buildItemLookup(items: SurveyItem[]): Map<string, SurveyItem> {
  const m = new Map<string, SurveyItem>()
  for (const it of items) m.set(it.id, it)
  return m
}

function describeAnswer(item: SurveyItem | undefined, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (!item) return String(value)
  if (item.type === 'attention_mc' || item.type === 'single_choice') {
    const opt = item.options.find((o) => o.value === value)
    return opt ? `${opt.label}` : String(value)
  }
  return String(value)
}

function findParticipantSummaryInEventLog(
  events: EventLogRow[],
): ParticipantSummaryFromLog | null {
  for (const ev of events) {
    if (ev.type !== 'group_condition_plan') continue
    const payload = ev.payload
    if (!payload || typeof payload !== 'object') continue
    const summary = (payload as Record<string, unknown>).participantSummary
    if (summary && typeof summary === 'object') {
      return summary as ParticipantSummaryFromLog
    }
  }
  return null
}

interface DashboardSummaryStats {
  total: number
  groupSessions: number
  individualSessions: number
  uniqueGroups: number
  uniqueParticipants: number
}

function computeStats(rows: StudySubmissionRow[]): DashboardSummaryStats {
  const groups = new Set<string>()
  const participants = new Set<string>()
  let groupSessions = 0
  let individualSessions = 0
  for (const r of rows) {
    if (r.group_id) {
      groupSessions += 1
      groups.add(r.group_id)
    } else {
      individualSessions += 1
    }
    const pid = participantIdFromRow(r)
    if (pid && pid !== '—') participants.add(pid)
  }
  return {
    total: rows.length,
    groupSessions,
    individualSessions,
    uniqueGroups: groups.size,
    uniqueParticipants: participants.size,
  }
}

function filterRows(rows: StudySubmissionRow[], query: string): StudySubmissionRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => {
    const pid = participantIdFromRow(r).toLowerCase()
    return (
      pid.includes(q) ||
      (r.group_id ?? '').toLowerCase().includes(q) ||
      (r.anon_id ?? '').toLowerCase().includes(q) ||
      r.session_id.toLowerCase().includes(q) ||
      r.condition_key.toLowerCase().includes(q)
    )
  })
}

export function TeamSubmissionsDashboard() {
  const supabase = getSupabaseClient()
  const [bundle, setBundle] = useState<StudyBundle | null>(null)
  const [bundleError, setBundleError] = useState<string | null>(null)
  const [rows, setRows] = useState<StudySubmissionRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [selected, setSelected] = useState<StudySubmissionRow | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const loadRows = useCallback(async () => {
    if (!supabase) return
    setLoadingList(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('study_submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT)

    if (error) {
      setLoadError(error.message)
      setRows([])
    } else {
      setRows((data ?? []) as StudySubmissionRow[])
    }
    setLoadingList(false)
  }, [supabase])

  useEffect(() => {
    if (supabase) void loadRows()
  }, [supabase, loadRows])

  useEffect(() => {
    let cancelled = false
    void loadStudyBundle()
      .then((b) => {
        if (!cancelled) {
          setBundle(b)
          setBundleError(null)
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setBundle(null)
          setBundleError(e.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const study = bundle?.study ?? null
  const filteredRows = useMemo(() => filterRows(rows, query), [rows, query])
  const stats = useMemo(() => computeStats(rows), [rows])

  if (!supabase) {
    return (
      <div className="shell admin-shell">
        <div className="card error-card">
          <h1>Team dashboard unavailable</h1>
          <p className="muted">
            This build has no Supabase URL or anon key. Set{' '}
            <code className="inline-code">VITE_SUPABASE_URL</code> and{' '}
            <code className="inline-code">VITE_SUPABASE_ANON_KEY</code> when building.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="shell admin-shell">
      <div className="card">
        <header className="card-header admin-header">
          <div>
            <p className="eyebrow">Researcher dashboard</p>
            <h1>{study?.title ?? 'Study submissions'}</h1>
            <p className="muted small admin-dashboard-lead">
              Submissions ordered by newest first. Click a row to see a structured breakdown of the
              session (demographics, condition exposure, memory responses, discussion logs, …).
            </p>
            {bundleError ? (
              <p className="muted small admin-hint" role="status">
                Could not load study config ({bundleError}). Showing raw values without labels.
              </p>
            ) : null}
          </div>
          <div className="admin-header-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => void loadRows()}
              disabled={loadingList}
            >
              {loadingList ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        <section className="admin-stats">
          <StatChip label="Submissions" value={stats.total} />
          <StatChip label="Group sessions" value={stats.groupSessions} />
          <StatChip label="Individual" value={stats.individualSessions} />
          <StatChip label="Unique groups" value={stats.uniqueGroups} />
          <StatChip label="Unique participants" value={stats.uniqueParticipants} />
        </section>

        {loadError ? <div className="error-banner admin-banner">{loadError}</div> : null}

        <div className="admin-toolbar">
          <input
            type="search"
            className="admin-search"
            placeholder="Filter by participant ID, group ID, anon ID, session ID, condition…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter submissions"
          />
          <p className="muted small admin-meta">
            Showing {filteredRows.length} of {rows.length} loaded
            {rows.length >= LIST_LIMIT ? ` (capped at ${LIST_LIMIT})` : ''}.
          </p>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Participant ID</th>
                <th>Group</th>
                <th>Anon</th>
                <th>Condition</th>
                <th>Memory items</th>
                <th>Session</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && !loadingList ? (
                <tr>
                  <td colSpan={8} className="admin-empty">
                    {rows.length === 0
                      ? 'No rows yet, or RLS does not allow anon SELECT.'
                      : 'No rows match the filter.'}
                  </td>
                </tr>
              ) : null}
              {filteredRows.map((r) => {
                const memCount = r.memory_responses?.length ?? 0
                return (
                  <tr key={r.id} onClick={() => setSelected(r)} className="admin-row">
                    <td>{formatShortTs(r.submitted_at)}</td>
                    <td className="admin-participant-id">{participantIdFromRow(r)}</td>
                    <td className="admin-mono">{r.group_id ?? '—'}</td>
                    <td className="admin-mono">{r.anon_id ?? '—'}</td>
                    <td>{formatConditionCell(r, study)}</td>
                    <td className="admin-mono">{memCount}</td>
                    <td className="admin-mono" title={r.session_id}>
                      {r.session_id.slice(0, 8)}…
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary btn-tiny"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelected(r)
                        }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <SubmissionDetailModal
          row={selected}
          bundle={bundle}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <p className="muted small admin-footer">
        <button
          type="button"
          className="admin-back-link"
          onClick={() => {
            window.location.hash = ''
          }}
        >
          ← Back to study
        </button>
      </p>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-stat-chip">
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  )
}

function SubmissionDetailModal({
  row,
  bundle,
  onClose,
}: {
  row: StudySubmissionRow
  bundle: StudyBundle | null
  onClose: () => void
}) {
  const supabase = getSupabaseClient()
  const [discussions, setDiscussions] = useState<DiscussionMessageRow[] | null>(null)
  const [discussionError, setDiscussionError] = useState<string | null>(null)
  const [discussionLoading, setDiscussionLoading] = useState(false)

  useEffect(() => {
    if (!supabase || !row.group_id) return
    let cancelled = false
    setDiscussionLoading(true)
    setDiscussionError(null)
    void supabase
      .from('discussion_messages')
      .select('*')
      .eq('group_id', row.group_id)
      .order('question_index', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setDiscussionError(error.message)
          setDiscussions([])
        } else {
          setDiscussions((data ?? []) as DiscussionMessageRow[])
        }
        setDiscussionLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [row.group_id, supabase])

  const summaryFromLog = useMemo(
    () => findParticipantSummaryInEventLog(row.event_log ?? []),
    [row.event_log],
  )

  return (
    <div className="admin-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="card admin-modal admin-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-head">
          <h2 id="admin-modal-title">
            Submission · {participantIdFromRow(row)}
            {row.anon_id ? ` (${row.anon_id})` : ''}
          </h2>
          <button type="button" className="btn secondary btn-tiny" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="admin-modal-body">
          <OverviewSection row={row} summary={summaryFromLog} bundle={bundle} />
          <DemographicsSection row={row} bundle={bundle} />
          <GroupExposureSection row={row} />
          <MemoryResponsesSection row={row} />
          <SurveyAnswersSection
            title="Pre-survey"
            answers={row.pre_survey}
            config={bundle?.preSurvey}
          />
          <SurveyAnswersSection
            title="Attention check (after first image set)"
            answers={row.attention2}
            config={bundle?.attention2}
          />
          <SurveyAnswersSection
            title="Post-survey"
            answers={row.post_survey}
            config={bundle?.postSurvey}
          />
          <FillerStatsSection stats={row.filler_stats} />
          {row.group_id ? (
            <DiscussionSection
              loading={discussionLoading}
              error={discussionError}
              rows={discussions}
              participantAnonId={row.anon_id}
            />
          ) : null}
          <EventLogSection events={row.event_log ?? []} />
          <RawJsonSection row={row} discussions={discussions} />
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  defaultOpen = false,
  children,
  meta,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
  meta?: string
}) {
  return (
    <details className="admin-section" open={defaultOpen}>
      <summary className="admin-section-summary">
        <span className="admin-section-title">{title}</span>
        {meta ? <span className="admin-section-meta">{meta}</span> : null}
      </summary>
      <div className="admin-section-body">{children}</div>
    </details>
  )
}

function OverviewSection({
  row,
  summary,
  bundle,
}: {
  row: StudySubmissionRow
  summary: ParticipantSummaryFromLog | null
  bundle: StudyBundle | null
}) {
  const rows: [string, React.ReactNode][] = [
    ['Submitted at', formatTs(row.submitted_at)],
    ['Created at', formatTs(row.created_at)],
    ['Session ID', <span className="admin-mono">{row.session_id}</span>],
    ['Condition key', <span className="admin-mono">{row.condition_key}</span>],
    ['Condition label', formatConditionCell(row, bundle?.study ?? null)],
    ['Schema version', String(row.schema_version)],
    ['Group ID', row.group_id ?? '—'],
    ['Anon ID', row.anon_id ?? '—'],
    ['Participant ID (top-level)', row.participant_id ?? '—'],
    ['Scheme', summary?.scheme ?? '—'],
    [
      'Plan counts',
      summary ? (
        <span className="admin-mono">
          original={summary.no_edit ?? '—'} · congruent_edited={summary.congruent_edited ?? '—'} ·
          incongruent_edited={summary.incongruent_edited ?? '—'} · total={summary.slideCount ?? '—'}
        </span>
      ) : (
        '—'
      ),
    ],
    [
      'User agent',
      <span className="admin-mono admin-truncate" title={row.user_agent ?? ''}>
        {row.user_agent ?? '—'}
      </span>,
    ],
  ]
  return (
    <Section title="Overview" defaultOpen>
      <table className="admin-kv-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function DemographicsSection({
  row,
  bundle,
}: {
  row: StudySubmissionRow
  bundle: StudyBundle | null
}) {
  const lookup = useMemo(
    () => buildItemLookup(flattenSurveyItems(bundle?.demographics)),
    [bundle?.demographics],
  )
  const demo = row.demographics ?? {}
  const entries = Object.entries(demo)
  if (entries.length === 0) {
    return (
      <Section title="Demographics">
        <p className="muted small">No demographics on this row.</p>
      </Section>
    )
  }
  return (
    <Section title="Demographics" meta={`${entries.length} fields`}>
      <table className="admin-kv-table">
        <tbody>
          {entries.map(([key, value]) => {
            const item = lookup.get(key)
            return (
              <tr key={key}>
                <th title={item?.prompt}>{item?.prompt ?? key}</th>
                <td>{describeAnswer(item, value)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

function GroupExposureSection({ row }: { row: StudySubmissionRow }) {
  const table = row.group_condition_exposure_table
  if (!table || table.length === 0) {
    return (
      <Section title="Group condition exposure">
        <p className="muted small">No group exposure table on this row (individual session?).</p>
      </Section>
    )
  }
  const myAnon = row.anon_id
  return (
    <Section
      title="Group condition exposure"
      defaultOpen
      meta={`${table.length} slides`}
    >
      <p className="muted small admin-section-note">
        For each slide: which 2 of the 4 participants saw original, which 2 saw AI-edited. Highlighted
        cells = this participant's view.
      </p>
      <div className="admin-inner-table-wrap">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Slide</th>
              <th>Image type</th>
              <th>Edit type</th>
              <th>Saw original</th>
              <th>Saw AI-edited</th>
              <th>This participant</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => {
              const youSawEdited = myAnon ? r.aiEditedParticipants.includes(myAnon as never) : false
              const youSawOriginal = myAnon ? r.noEditParticipants.includes(myAnon as never) : false
              const yourView = youSawEdited
                ? `AI-edited (${r.editType})`
                : youSawOriginal
                ? 'Original'
                : '—'
              const badge = editTypeBadge(r.editType)
              return (
                <tr key={r.slideId}>
                  <td className="admin-mono">{r.configSlideIndex + 1}</td>
                  <td className="admin-mono">{r.slideId}</td>
                  <td>{r.imageType}</td>
                  <td>
                    <span className={badge.klass}>{badge.text}</span>
                  </td>
                  <td>
                    <ParticipantTags ids={r.noEditParticipants} highlight={myAnon ?? null} />
                  </td>
                  <td>
                    <ParticipantTags ids={r.aiEditedParticipants} highlight={myAnon ?? null} />
                  </td>
                  <td
                    className={
                      youSawEdited
                        ? 'admin-cell-emph admin-cell-emph--edited'
                        : youSawOriginal
                        ? 'admin-cell-emph admin-cell-emph--original'
                        : ''
                    }
                  >
                    {yourView}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function ParticipantTags({ ids, highlight }: { ids: string[]; highlight: string | null }) {
  return (
    <span className="admin-participant-tags">
      {ids.map((id) => (
        <span
          key={id}
          className={`admin-tag ${id === highlight ? 'admin-tag--highlight' : ''}`}
        >
          {id}
        </span>
      ))}
    </span>
  )
}

function MemoryResponsesSection({ row }: { row: StudySubmissionRow }) {
  const all = row.memory_responses ?? []
  const exposureBySlide = useMemo(() => {
    const m = new Map<string, GroupSlideConditionExposure>()
    for (const r of row.group_condition_exposure_table ?? []) m.set(r.slideId, r)
    return m
  }, [row.group_condition_exposure_table])

  if (all.length === 0) {
    return (
      <Section title="Memory responses">
        <p className="muted small">No memory responses on this row.</p>
      </Section>
    )
  }

  const correctCount = all.filter((r) => r.isCorrect === true).length
  const wrongCount = all.filter((r) => r.isCorrect === false).length
  const unsureCount = all.filter((r) => r.isCorrect === null).length
  const sorted = [...all].sort((a, b) => {
    const roundOrder = (r: MemoryResponseRow) =>
      r.memoryRound === 'pre_discussion' ? 0 : r.memoryRound === 'post_discussion' ? 1 : 2
    if (roundOrder(a) !== roundOrder(b)) return roundOrder(a) - roundOrder(b)
    return a.presentationIndex - b.presentationIndex
  })

  return (
    <Section
      title="Memory responses"
      defaultOpen
      meta={`${all.length} total · ${correctCount} correct · ${wrongCount} wrong · ${unsureCount} unsure`}
    >
      <div className="admin-inner-table-wrap">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>#</th>
              <th>Slide</th>
              <th>Image type</th>
              <th>Edit type</th>
              <th>Viewed</th>
              <th>Recall</th>
              <th>Expected</th>
              <th>Conf.</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const exposure = exposureBySlide.get(r.slideId)
              const editBadge = editTypeBadge(exposure?.editType)
              const result = correctnessCell(r)
              return (
                <tr key={`${r.memoryRound ?? 'x'}-${r.presentationIndex}-${i}`}>
                  <td>{memoryRoundLabel(r.memoryRound)}</td>
                  <td className="admin-mono">{r.presentationIndex + 1}</td>
                  <td className="admin-mono">{r.slideId}</td>
                  <td>{exposure?.imageType ?? '—'}</td>
                  <td>
                    <span className={editBadge.klass}>{editBadge.text}</span>
                  </td>
                  <td>{conditionViewedLabel(r.conditionViewed)}</td>
                  <td>{recallLabel(r.recall)}</td>
                  <td>{r.expectedAnswer ? recallLabel(r.expectedAnswer) : '—'}</td>
                  <td className="admin-mono">{r.confidence}</td>
                  <td>
                    <span className={result.klass}>{result.text}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function SurveyAnswersSection({
  title,
  answers,
  config,
}: {
  title: string
  answers: Record<string, unknown> | undefined
  config: SurveyConfig | undefined
}) {
  const lookup = useMemo(() => buildItemLookup(flattenSurveyItems(config)), [config])
  const entries = Object.entries(answers ?? {})
  if (entries.length === 0) {
    return (
      <Section title={title}>
        <p className="muted small">No answers on this row.</p>
      </Section>
    )
  }
  return (
    <Section title={title} meta={`${entries.length} answers`}>
      <table className="admin-kv-table">
        <tbody>
          {entries.map(([key, value]) => {
            const item = lookup.get(key)
            return (
              <tr key={key}>
                <th title={item?.prompt}>
                  <span className="admin-survey-key admin-mono">{key}</span>
                  {item?.prompt ? (
                    <span className="admin-survey-prompt">{item.prompt}</span>
                  ) : null}
                </th>
                <td>{describeAnswer(item, value)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

function FillerStatsSection({ stats }: { stats: Record<string, unknown> | undefined }) {
  const entries = Object.entries(stats ?? {})
  if (entries.length === 0) {
    return (
      <Section title="Filler (pac-man) stats">
        <p className="muted small">No filler stats.</p>
      </Section>
    )
  }
  return (
    <Section title="Filler (pac-man) stats" meta={`${entries.length} fields`}>
      <table className="admin-kv-table">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td className="admin-mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function DiscussionSection({
  loading,
  error,
  rows,
  participantAnonId,
}: {
  loading: boolean
  error: string | null
  rows: DiscussionMessageRow[] | null
  participantAnonId: string | null
}) {
  if (loading) {
    return (
      <Section title="Group discussion logs">
        <p className="muted small">Loading discussion messages…</p>
      </Section>
    )
  }
  if (error) {
    return (
      <Section title="Group discussion logs">
        <p className="error-banner">{error}</p>
      </Section>
    )
  }
  if (!rows || rows.length === 0) {
    return (
      <Section title="Group discussion logs">
        <p className="muted small">No discussion rows for this group.</p>
      </Section>
    )
  }
  const totalMessages = rows.reduce((acc, r) => acc + r.discussion_log.length, 0)
  return (
    <Section
      title="Group discussion logs"
      meta={`${rows.length} slides · ${totalMessages} messages`}
    >
      <div className="admin-discussion-list">
        {rows.map((r) => (
          <div key={r.id} className="admin-discussion-card">
            <div className="admin-discussion-head">
              <span className="admin-discussion-q">Q{r.question_index + 1}</span>
              <span className="admin-mono">{r.slide_id}</span>
              {r.condition_exposure ? (
                <>
                  <span className="admin-mono">{r.condition_exposure.imageType}</span>
                  <span className={editTypeBadge(r.condition_exposure.editType).klass}>
                    {editTypeBadge(r.condition_exposure.editType).text}
                  </span>
                </>
              ) : null}
            </div>
            {r.discussion_log.length === 0 ? (
              <p className="muted small">(no messages)</p>
            ) : (
              <ul className="admin-discussion-msgs">
                {r.discussion_log.map((m, i) => (
                  <li
                    key={`${i}-${m.sent_at}`}
                    className={`admin-discussion-msg ${
                      m.anon_id === participantAnonId ? 'admin-discussion-msg--self' : ''
                    }`}
                  >
                    <span className="admin-discussion-author">
                      {m.anon_id}
                      {m.participant_id ? ` · ${m.participant_id}` : ''}
                    </span>
                    <span className="admin-discussion-time">{formatShortTs(m.sent_at)}</span>
                    <p className="admin-discussion-text">{m.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

function EventLogSection({ events }: { events: EventLogRow[] }) {
  if (events.length === 0) {
    return (
      <Section title="Event log">
        <p className="muted small">No events.</p>
      </Section>
    )
  }
  return (
    <Section title="Event log" meta={`${events.length} events`}>
      <div className="admin-inner-table-wrap">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={`${ev.t}-${i}`}>
                <td className="admin-mono">{formatShortTs(ev.t)}</td>
                <td className="admin-mono">{ev.type}</td>
                <td className="admin-mono admin-truncate" title={JSON.stringify(ev.payload)}>
                  {ev.payload ? JSON.stringify(ev.payload) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function RawJsonSection({
  row,
  discussions,
}: {
  row: StudySubmissionRow
  discussions: DiscussionMessageRow[] | null
}) {
  return (
    <Section title="Raw JSON (fallback)">
      <p className="muted small">
        Includes the row and any loaded discussion messages. Useful when a field is missing from the
        structured view above.
      </p>
      <pre className="admin-json">
        {JSON.stringify({ row, discussions }, null, 2)}
      </pre>
    </Section>
  )
}
