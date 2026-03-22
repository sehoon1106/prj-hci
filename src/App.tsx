import { useEffect, useState } from 'react'
import { loadStudyBundle } from './lib/loadStudyConfig'
import { StudySessionProvider } from './session/StudySessionContext'
import { StudyFlow } from './components/StudyFlow'
import { StudyMediaPreload } from './components/StudyMediaPreload'
import type { StudyBundle } from './types/study'
import './App.css'

function App() {
  const [bundle, setBundle] = useState<StudyBundle | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    loadStudyBundle()
      .then(setBundle)
      .catch((e: Error) => setErr(e.message))
  }, [])

  if (err) {
    return (
      <div className="shell">
        <div className="card error-card">
          <h1>Could not load configuration</h1>
          <p>{err}</p>
          <p className="muted small">
            Check that the JSON files exist under public/config.
          </p>
        </div>
      </div>
    )
  }

  if (!bundle) {
    return (
      <div className="shell">
        <p className="loading">Loading…</p>
      </div>
    )
  }

  return (
    <StudySessionProvider bundle={bundle}>
      <div className="shell">
        <StudyMediaPreload />
        <StudyFlow />
      </div>
    </StudySessionProvider>
  )
}

export default App
