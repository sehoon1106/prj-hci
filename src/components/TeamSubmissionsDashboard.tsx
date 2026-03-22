import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'
import type { User } from '@supabase/supabase-js'

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
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  const loadRows = useCallback(async () => {
    if (!supabase || !user) return
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
  }, [supabase, user])

  useEffect(() => {
    if (user) void loadRows()
    else setRows([])
  }, [user, loadRows])

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setAuthBusy(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) setAuthError(error.message)
    setAuthBusy(false)
  }

  const signOut = async () => {
    if (!supabase) return
    setAuthError(null)
    await supabase.auth.signOut()
    setSelected(null)
  }

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

  if (!authReady) {
    return (
      <div className="shell admin-shell">
        <p className="loading">Loading…</p>
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
              Sign in with a Supabase Auth account your team was given. Participant responses stay
              private from anonymous visitors; only logged-in users with SELECT permission can see
              this list.
            </p>
          </div>
          {user ? (
            <div className="admin-header-actions">
              <span className="muted small">{user.email}</span>
              <button type="button" className="btn secondary" onClick={() => void loadRows()} disabled={loadingList}>
                {loadingList ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" className="btn secondary" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          ) : null}
        </header>

        {!user ? (
          <form className="admin-login" onSubmit={(e) => void signIn(e)}>
            {authError ? <div className="error-banner admin-banner">{authError}</div> : null}
            <label className="survey-block">
              <span className="survey-prompt">Email</span>
              <input
                className="survey-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="survey-block">
              <span className="survey-prompt">Password</span>
              <input
                className="survey-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <div className="btn-row">
              <button type="submit" className="btn primary" disabled={authBusy}>
                {authBusy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
            <p className="muted small admin-hint">
              Add team accounts in Supabase → Authentication → Users, and run the SQL in{' '}
              <code className="inline-code">public/supabase-schema.sql</code> (including the
              authenticated SELECT policy).
            </p>
          </form>
        ) : (
          <>
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
                        No rows yet, or you lack permission to read the table.
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
          </>
        )}
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
