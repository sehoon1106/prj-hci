/**
 * Filler embeds [react-pacman](https://www.npmjs.com/package/react-pacman):
 * - `npm install react-pacman`
 * - SCSS: use a Sass-capable bundler (Vite + `sass` package)
 * - Usage matches the npm readme: `import Pacman from 'react-pacman'` then `<Pacman />`
 *
 * Vite+CJS often provides `module.exports` as `{ default: Component }` — unwrap below.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import PacmanImport from 'react-pacman'
import { getSupabaseClient } from '../lib/supabaseClient'
import { fetchPacmanLeaderboard, type PacmanLeaderboardEntry } from '../lib/pacmanLeaderboard'
import { GroupPhaseStartGate } from './GroupDiscussionFlow'

type PacmanProps = { gridSize?: number; onEnd?: () => void }

const Pacman: ComponentType<PacmanProps> = (() => {
  const mod = PacmanImport as ComponentType<PacmanProps> | { default: ComponentType<PacmanProps> }
  if (typeof mod === 'function') return mod
  if (mod && typeof mod === 'object' && 'default' in mod && typeof mod.default === 'function') {
    return mod.default
  }
  throw new Error('react-pacman: invalid export (expected component or { default: component })')
})()

function parseRunningScore(): number {
  const el = document.querySelector('.pacman .running-score')
  if (!el?.textContent) return 0
  const m = el.textContent.match(/Score:\s*(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

/** Saved with the session; `dotsEaten` keeps the max score for older analysis scripts. */
export interface PacmanFillerStats {
  type: 'pacman'
  dotsEaten: number
  maxPacmanScore: number
  pacmanRoundScores: number[]
  durationMs: number
  keyStrokes: number
  gameLibrary: 'react-pacman'
  /** On-screen score when the filler countdown hit zero (not necessarily the session max). */
  fillerEndPacmanScore?: number
}

/** Timed wrapper around the npm component; stats mirror the previous filler shape. */
export function FillerPacMan({
  durationSeconds,
  onDone,
  onStats,
  groupSync,
}: {
  durationSeconds: number
  onDone: () => void
  onStats: (s: PacmanFillerStats) => void
  groupSync?: {
    groupId: string
    anonId: 'P1' | 'P2' | 'P3' | 'P4'
    groupSize: number
    phaseKey: string
    logEvent: (t: string, p?: Record<string, unknown>) => void
  }
}) {
  const [started, setStarted] = useState(false)
  const [remaining, setRemaining] = useState(durationSeconds)
  /** Bump to remount `react-pacman` after game over (library has no built-in restart). */
  const [pacmanKey, setPacmanKey] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [roundScores, setRoundScores] = useState<number[]>([])
  const [liveScore, setLiveScore] = useState(0)
  const [leaderboard, setLeaderboard] = useState<{
    entries: PacmanLeaderboardEntry[]
    truncated: boolean
    status: 'loading' | 'no_supabase' | 'error' | 'ok'
  }>({ entries: [], truncated: false, status: 'loading' })
  /** Last parsed score while playing; used at filler buzzer so we do not miss the final frame if DOM lags. */
  const liveScoreRef = useRef(0)
  const roundScoresRef = useRef<number[]>([])
  const keyStrokesRef = useRef(0)
  const startMsRef = useRef(0)
  const endedRef = useRef(false)

  const syncRoundRef = (next: number[]) => {
    roundScoresRef.current = next
    setRoundScores(next)
  }

  const handlePacmanGameOver = useCallback(() => {
    setGameOver(true)
  }, [])

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client) {
      setLeaderboard({ entries: [], truncated: false, status: 'no_supabase' })
      return
    }
    let cancelled = false
    const run = async () => {
      const { entries, truncated, fetchFailed } = await fetchPacmanLeaderboard(client)
      if (cancelled) return
      setLeaderboard({
        entries,
        truncated,
        status: fetchFailed ? 'error' : 'ok',
      })
    }
    void run()
    const id = window.setInterval(run, 50_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  /** End of a visible round: snapshot score before remounting. */
  const restartPacman = useCallback(() => {
    const closing = parseRunningScore()
    const merged = [...roundScoresRef.current, closing]
    syncRoundRef(merged)
    setGameOver(false)
    setPacmanKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!started) return

    const WASD_TO_ARROW: Record<string, string> = {
      w: 'ArrowUp',
      W: 'ArrowUp',
      s: 'ArrowDown',
      S: 'ArrowDown',
      a: 'ArrowLeft',
      A: 'ArrowLeft',
      d: 'ArrowRight',
      D: 'ArrowRight',
    }

    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        restartPacman()
        return
      }

      const arrowFromWasd = WASD_TO_ARROW[e.key]
      if (arrowFromWasd) {
        e.preventDefault()
        keyStrokesRef.current += 1
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: arrowFromWasd,
            code: arrowFromWasd,
            bubbles: true,
            cancelable: true,
          }),
        )
        return
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (e.isTrusted) keyStrokesRef.current += 1
      }
    }

    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [started, restartPacman])

  useEffect(() => {
    if (!started) {
      setLiveScore(0)
      liveScoreRef.current = 0
      return
    }
    const tick = () => {
      const s = parseRunningScore()
      liveScoreRef.current = s
      setLiveScore(s)
    }
    tick()
    const id = window.setInterval(tick, 300)
    return () => clearInterval(id)
  }, [started, pacmanKey])

  const finish = useCallback(() => {
    // Filler time ended (game may still be running): take buzzer from DOM + last polled value
    const fromDom = parseRunningScore()
    const buzzerScore = Math.max(fromDom, liveScoreRef.current)
    const allRounds = [...roundScoresRef.current, buzzerScore]
    const maxPacmanScore = allRounds.length ? Math.max(...allRounds) : 0
    roundScoresRef.current = allRounds
    setRoundScores(allRounds)
    setLiveScore(buzzerScore)
    onStats({
      type: 'pacman',
      dotsEaten: maxPacmanScore,
      maxPacmanScore,
      pacmanRoundScores: allRounds,
      /** Score shown when the filler timer expired (may be lower than maxPacmanScore). */
      fillerEndPacmanScore: buzzerScore,
      durationMs: Date.now() - startMsRef.current,
      keyStrokes: keyStrokesRef.current,
      gameLibrary: 'react-pacman',
    })
    onDone()
  }, [onDone, onStats])

  // Library shows "Game over!" before/without always calling onEnd — sync hint state from DOM.
  useEffect(() => {
    if (!started) return
    const root = document.querySelector('.pac-wrap--library .pacman')
    if (!root) return
    const sync = () => {
      setGameOver(!!root.querySelector('.game-over'))
    }
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { subtree: true, childList: true, characterData: true })
    return () => obs.disconnect()
  }, [started, pacmanKey])

  useEffect(() => {
    if (!started) return
    endedRef.current = false
    startMsRef.current = Date.now()
    keyStrokesRef.current = 0
    roundScoresRef.current = []
    setRoundScores([])
    setLiveScore(0)
    liveScoreRef.current = 0
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startMsRef.current
      const sec = durationSeconds - Math.floor(elapsed / 1000)
      setRemaining(Math.max(0, sec))
      if (elapsed >= durationSeconds * 1000) {
        clearInterval(id)
        if (endedRef.current) return
        endedRef.current = true
        // Next frame: give react-pacman one paint so Score text matches the buzzer moment
        requestAnimationFrame(() => {
          finish()
        })
      }
    }, 250)
    return () => clearInterval(id)
  }, [started, durationSeconds, finish])

  const bestCompleted =
    roundScores.length > 0 ? Math.max(...roundScores) : 0
  const bestOverall = Math.max(bestCompleted, started ? liveScore : 0)

  const breakElapsedSec = started ? durationSeconds - remaining : 0
  const breakTimePct =
    durationSeconds > 0
      ? Math.min(100, Math.round((breakElapsedSec / durationSeconds) * 100))
      : 0

  const showGlobalList =
    leaderboard.status === 'ok' && leaderboard.entries.length > 0

  return (
    <div className="pac-wrap pac-wrap--library">
      <p className="pac-hud">
        <span>Time left: {remaining}s</span>
        {started ? (
          <span>
            This break — best score: <strong className="pac-hud-strong">{bestOverall}</strong>
          </span>
        ) : null}
      </p>
      <div className="phase-time-progress pac-filler-time">
        <p className="phase-time-label">
          <span className="phase-time-heading">Break timer</span>
          <span className="phase-time-numbers">
            {started
              ? `${breakElapsedSec}s / ${durationSeconds}s — auto-advances at ${durationSeconds}s (${breakTimePct}%)`
              : `${durationSeconds}s total — press Start game when ready`}
          </span>
        </p>
        <div
          className="phase-time-track"
          role="progressbar"
          aria-valuenow={breakTimePct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="phase-time-fill" style={{ width: `${breakTimePct}%` }} />
        </div>
      </div>

      <div className="pac-scoreboard card">
        <p className="eyebrow">All-time Pac-Man leaderboard</p>
        <p className="muted small pac-scoreboard-leader-caption">
          Only includes participants who finished and submitted. Names show the <strong>first character</strong> only;
          the score is each person’s <strong>highest</strong> score during this break task.
        </p>
        {leaderboard.status === 'loading' ? (
          <p className="muted small">Loading leaderboard…</p>
        ) : null}
        {leaderboard.status === 'no_supabase' ? (
          <p className="muted small">
            This build has no Supabase connection, so no all-time leaderboard is available. You can still play locally.
          </p>
        ) : null}
        {leaderboard.status === 'error' ? (
          <p className="muted small pac-scoreboard-warn">
            Could not load the leaderboard. Try refreshing, or check your network and database access (RLS).
          </p>
        ) : null}
        {leaderboard.status === 'ok' && leaderboard.entries.length === 0 ? (
          <p className="muted small">No saved Pac-Man scores yet. Entries appear after the first full submission.</p>
        ) : null}
        {showGlobalList ? (
          <>
            <ol className="pac-leaderboard">
              {leaderboard.entries.slice(0, 5).map((e, i) => (
                <li key={`lb-${i}-${e.score}-${e.initial}`} className="pac-leaderboard-row">
                  <span className="pac-leaderboard-who" aria-label="Participant initial">
                    {e.initial}
                  </span>
                  <span className="pac-leaderboard-score">{e.score}</span>
                </li>
              ))}
            </ol>
            {leaderboard.truncated ? (
              <p className="muted small pac-scoreboard-truncate-note">
                Many sessions are stored; only a subset was loaded. Rankings reflect that subset.
              </p>
            ) : null}
          </>
        ) : null}

        <div className="pac-session-stats">
          <p className="pac-session-stats-title">This break (you)</p>
          {!started ? (
            <p className="muted small pac-scoreboard-empty">
              After you start, scores stack up each round; when the break ends, your best score is submitted and can
              appear on the board above (after you finish the full study).
            </p>
          ) : (
            <>
              <p className="pac-scoreboard-max pac-scoreboard-max--session">
                Session best: <strong>{bestOverall}</strong>
                {roundScores.length === 0 ? null : (
                  <span className="muted small pac-scoreboard-live-inline">
                    {' '}
                    · Current round: {liveScore}
                  </span>
                )}
              </p>
              {roundScores.length === 0 ? (
                <p className="muted small">
                  When a round ends (or the timer ends), completed round scores are listed below.
                </p>
              ) : (
                <ul className="pac-scoreboard-list pac-scoreboard-list--session">
                  {roundScores.map((s, i) => (
                    <li key={`${i}-${s}`}>
                      Round {i + 1}: <span className="pac-scoreboard-num">{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {!started ? (
        groupSync ? (
          <GroupPhaseStartGate
            groupId={groupSync.groupId}
            anonId={groupSync.anonId}
            groupSize={groupSync.groupSize}
            phaseKey={groupSync.phaseKey}
            buttonLabel="Start game"
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
          <button
            type="button"
            className="btn primary pac-start"
            onClick={() => setStarted(true)}
          >
            Start game
          </button>
        )
      ) : (
        <>
          <div className="pacman-library-mount">
            <Pacman key={pacmanKey} gridSize={12} onEnd={handlePacmanGameOver} />
          </div>
          <div className="pac-restart-row">
            <button type="button" className="btn secondary" onClick={restartPacman}>
              Play again
            </button>
            <span className="muted small pac-restart-hint">
              or press <kbd className="pac-kbd">R</kbd>
            </span>
          </div>
          {gameOver ? (
            <p className="muted small pac-gameover-hint">
              Game over — use <strong>Play again</strong> or <kbd className="pac-kbd">R</kbd> to start a new round. The
              break timer keeps running.
            </p>
          ) : null}
        </>
      )}
      <p className="muted small" style={{ textAlign: 'center', marginTop: 8 }}>
        Use <kbd className="pac-kbd">W</kbd> <kbd className="pac-kbd">A</kbd> <kbd className="pac-kbd">S</kbd>{' '}
        <kbd className="pac-kbd">D</kbd> to move. If nothing happens, your keyboard may be in Korean input mode—press the{' '}
        <strong>한/영</strong> (Korean/English) key so Latin letters are active, then try again. Movement may begin a few
        seconds after you start. Game:{' '}
        <a href="https://www.npmjs.com/package/react-pacman" target="_blank" rel="noreferrer">
          react-pacman
        </a>
        .
      </p>
    </div>
  )
}
