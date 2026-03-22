import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'

const LIST_LIMIT = 500

export interface StudySubmissionRow {
  id: string
  created_at: string
  session_id: string
  condition_key: string
  submitted_at: string
  user_agent: string | null
  schema_version: number
  pre_survey: Record<string, unknown>
  attention2: Record<string, unknown>
  post_survey: Record<string, unknown>
  memory_responses: unknown[]
  event_log: unknown[]
  filler_stats: Record<string, unknown>
}

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function TeamSubmissionsDashboard() {
  const supabase = getSupabaseClient()
  const [rows, setRows] = useState<StudySubmissionRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [selected, setSelected] = useState<StudySubmissionRow | null>(null)

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
            <p className="eyebrow">Researcher</p>
            <h1>Study submissions</h1>
            <p className="muted small">
              이 목록은 로그인 없이 열람합니다. 배포 사이트의 anon 키로 읽으므로,{' '}
              <strong className="admin-warn-strong">URL을 아는 사람은 누구나</strong> 이 데이터에 접근할 수
              있습니다. 민감한 응답이면 Supabase에서 anon SELECT 정책을 제거하고 Auth 기반으로 다시
              보호하는 편이 안전합니다.
            </p>
          </div>
          <div className="admin-header-actions">
            <button type="button" className="btn secondary" onClick={() => void loadRows()} disabled={loadingList}>
              {loadingList ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {loadError ? <div className="error-banner admin-banner">{loadError}</div> : null}
        <p className="muted small admin-meta">
          Showing up to {LIST_LIMIT} rows, newest first.
          {rows.length >= LIST_LIMIT ? ' Older rows are not loaded.' : ''}
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Session</th>
                <th>Condition</th>
                <th>Schema</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loadingList ? (
                <tr>
                  <td colSpan={5} className="admin-empty">
                    No rows yet, or RLS does not allow anon SELECT (run{' '}
                    <code className="inline-code">anon_select_study_submissions</code> in{' '}
                    <code className="inline-code">public/supabase-schema.sql</code>).
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatTs(r.submitted_at)}</td>
                  <td className="admin-mono">{r.session_id.slice(0, 8)}…</td>
                  <td>{r.condition_key}</td>
                  <td>{r.schema_version}</td>
                  <td>
                    <button type="button" className="btn secondary btn-tiny" onClick={() => setSelected(r)}>
                      JSON
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <div className="admin-modal-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <div
            className="card admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-head">
              <h2 id="admin-modal-title">Submission</h2>
              <button type="button" className="btn secondary btn-tiny" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <p className="muted small admin-mono">session_id: {selected.session_id}</p>
            <pre className="admin-json">{JSON.stringify(selected, null, 2)}</pre>
          </div>
        </div>
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
