import { useCallback, useEffect, useRef, useState } from 'react'

function useLatest<T>(v: T) {
  const r = useRef(v)
  r.current = v
  return r
}

const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
] as const

type KeyName = 'ArrowUp' | 'ArrowRight' | 'ArrowDown' | 'ArrowLeft'
const KEY_TO_DIR: Record<KeyName, number> = {
  ArrowUp: 0,
  ArrowRight: 1,
  ArrowDown: 2,
  ArrowLeft: 3,
}

/** 20×20 grid: # wall, . pellet, P player start, G ghosts (3) */
const MAZE_LINES = [
  '####################',
  '#P.......##......G.#',
  '#.####.##.##.####..#',
  '#..................#',
  '#.##.#.####.#.##.G.#',
  '#....#..##..#......#',
  '####.#.####.#.######',
  '#..................#',
  '#.####..##..####.G.#',
  '#......#....#......#',
  '######.#.##.#.######',
  '#..................#',
  '#.##.####..####.##.#',
  '#..................#',
  '#.####.##..##.####.#',
  '#..................#',
  '#.##.##.####.##.##.#',
  '#..................#',
  '#.####.##..##.####.#',
  '#..................#',
  '####################',
]

function parseMaze() {
  const h = MAZE_LINES.length
  const w = MAZE_LINES[0].length
  const walls: boolean[][] = []
  const dots: boolean[][] = []
  let px = 1
  let py = 1
  const ghosts: { x: number; y: number }[] = []
  for (let y = 0; y < h; y++) {
    walls[y] = []
    dots[y] = []
    for (let x = 0; x < w; x++) {
      const c = MAZE_LINES[y][x]
      walls[y][x] = c === '#'
      if (c === 'P') {
        px = x
        py = y
        dots[y][x] = false
      } else if (c === 'G') {
        ghosts.push({ x, y })
        dots[y][x] = false
      } else {
        dots[y][x] = c === '.'
      }
    }
  }
  return { walls, dots, w, h, px, py, ghosts }
}

function cloneDots(d: boolean[][]) {
  return d.map((row) => row.slice())
}

function countDots(dots: boolean[][]) {
  let n = 0
  for (const row of dots) for (const cell of row) if (cell) n++
  return n
}

export function FillerPacMan({
  durationSeconds,
  onDone,
  onStats,
}: {
  durationSeconds: number
  onDone: () => void
  onStats: (s: {
    dotsEaten: number
    durationMs: number
    keyStrokes: number
  }) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [remaining, setRemaining] = useState(durationSeconds)
  const [dotsLeft, setDotsLeft] = useState(0)
  const [started, setStarted] = useState(false)
  const onDoneRef = useLatest(onDone)
  const onStatsRef = useLatest(onStats)
  const endedRef = useRef(false)
  const hudTickRef = useRef(0)

  const parsed = useRef(parseMaze())
  const stateRef = useRef({
    px: parsed.current.px,
    py: parsed.current.py,
    dir: 1 as number,
    wantDir: 1 as number,
    dots: cloneDots(parsed.current.dots),
    ghosts: parsed.current.ghosts.map((g) => ({ ...g, dir: 1 })),
    dotsEaten: 0,
    keyStrokes: 0,
    startMs: 0,
    lastTurn: 0,
    lastGhost: 0,
  })

  const initGame = useCallback(() => {
    const p = parseMaze()
    parsed.current = p
    stateRef.current = {
      px: p.px,
      py: p.py,
      dir: 1,
      wantDir: 1,
      dots: cloneDots(p.dots),
      ghosts: p.ghosts.map((g) => ({ ...g, dir: 1 })),
      dotsEaten: 0,
      keyStrokes: 0,
      startMs: Date.now(),
      lastTurn: 0,
      lastGhost: 0,
    }
    setDotsLeft(countDots(stateRef.current.dots))
  }, [])

  useEffect(() => {
    initGame()
  }, [initGame])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const d = KEY_TO_DIR[e.key as KeyName]
      if (d === undefined) return
      e.preventDefault()
      stateRef.current.wantDir = d
      stateRef.current.keyStrokes += 1
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!started) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h } = parsed.current
    const CELL = canvas.width / w
    const TURN_MS = 130
    const GHOST_MS = 180

    const walkable = (x: number, y: number) =>
      y >= 0 && y < h && x >= 0 && x < w && !parsed.current.walls[y][x]

    const moveGhost = (g: { x: number; y: number; dir: number }) => {
      const opts: number[] = []
      for (let d = 0; d < 4; d++) {
        const nx = g.x + DIRS[d].x
        const ny = g.y + DIRS[d].y
        if (walkable(nx, ny)) opts.push(d)
      }
      if (opts.length === 0) return
      if (Math.random() < 0.35 && opts.includes(g.dir)) {
        const nx = g.x + DIRS[g.dir].x
        const ny = g.y + DIRS[g.dir].y
        if (walkable(nx, ny)) {
          g.x = nx
          g.y = ny
          return
        }
      }
      g.dir = opts[Math.floor(Math.random() * opts.length)]
      g.x += DIRS[g.dir].x
      g.y += DIRS[g.dir].y
    }

    const scatterGhost = (g: { x: number; y: number }, px: number, py: number) => {
      for (let t = 0; t < 80; t++) {
        const gx = 1 + Math.floor(Math.random() * (w - 2))
        const gy = 1 + Math.floor(Math.random() * (h - 2))
        if (!walkable(gx, gy) || (gx === px && gy === py)) continue
        g.x = gx
        g.y = gy
        return
      }
    }

    let rafId = 0
    let mouth = 0

    const draw = () => {
      const st = stateRef.current
      mouth += 0.12

      ctx.fillStyle = '#0a0e18'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = x * CELL
          const sy = y * CELL
          if (parsed.current.walls[y][x]) {
            ctx.fillStyle = '#1e3a8a'
            ctx.fillRect(sx, sy, CELL + 0.5, CELL + 0.5)
            ctx.strokeStyle = '#3b5bdb'
            ctx.strokeRect(sx + 0.5, sy + 0.5, CELL - 1, CELL - 1)
          } else if (st.dots[y][x]) {
            ctx.fillStyle = '#fde68a'
            ctx.beginPath()
            ctx.arc(sx + CELL / 2, sy + CELL / 2, Math.max(1.5, CELL * 0.12), 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }

      const cx = st.px * CELL + CELL / 2
      const cy = st.py * CELL + CELL / 2
      const r = CELL * 0.38
      const open = 0.2 + 0.2 * Math.sin(mouth)
      const base = st.dir * (Math.PI / 2)
      ctx.fillStyle = '#facc15'
      ctx.beginPath()
      ctx.arc(cx, cy, r, base + open, base + Math.PI * 2 - open)
      ctx.lineTo(cx, cy)
      ctx.fill()

      const colors = ['#f472b6', '#22d3ee', '#a78bfa']
      st.ghosts.forEach((g, i) => {
        const gx = g.x * CELL + CELL / 2
        const gy = g.y * CELL + CELL / 2
        const gr = CELL * 0.36
        ctx.fillStyle = colors[i % colors.length]
        ctx.beginPath()
        ctx.arc(gx, gy, gr, Math.PI, 0)
        ctx.lineTo(gx + gr, gy + gr * 0.9)
        for (let s = -1; s <= 1; s += 2) {
          ctx.lineTo(gx + s * gr * 0.33, gy + gr * 0.55)
        }
        ctx.closePath()
        ctx.fill()
      })

      hudTickRef.current += 1
      if (hudTickRef.current % 12 === 0) {
        setDotsLeft(countDots(st.dots))
      }

      rafId = requestAnimationFrame(tick)
    }

    const tick = (now: number) => {
      const st = stateRef.current
      if (now - st.lastTurn >= TURN_MS) {
        st.lastTurn = now
        if (walkable(st.px + DIRS[st.wantDir].x, st.py + DIRS[st.wantDir].y)) {
          st.dir = st.wantDir
        }
        const nx = st.px + DIRS[st.dir].x
        const ny = st.py + DIRS[st.dir].y
        if (walkable(nx, ny)) {
          st.px = nx
          st.py = ny
          if (st.dots[ny][nx]) {
            st.dots[ny][nx] = false
            st.dotsEaten += 1
          }
        }
      }
      if (now - st.lastGhost >= GHOST_MS) {
        st.lastGhost = now
        for (const g of st.ghosts) moveGhost(g)
        for (const g of st.ghosts) {
          if (g.x === st.px && g.y === st.py) scatterGhost(g, st.px, st.py)
        }
      }
      draw()
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [started])

  useEffect(() => {
    if (!started) return
    endedRef.current = false
    const t0 = Date.now()
    const id = window.setInterval(() => {
      const sec = durationSeconds - Math.floor((Date.now() - t0) / 1000)
      setRemaining(Math.max(0, sec))
      if (sec <= 0) {
        clearInterval(id)
        if (endedRef.current) return
        endedRef.current = true
        const st = stateRef.current
        onStatsRef.current({
          dotsEaten: st.dotsEaten,
          durationMs: Date.now() - st.startMs,
          keyStrokes: st.keyStrokes,
        })
        onDoneRef.current()
      }
    }, 250)
    return () => clearInterval(id)
  }, [started, durationSeconds])

  const nudge = (key: KeyName) => {
    stateRef.current.wantDir = KEY_TO_DIR[key]
    stateRef.current.keyStrokes += 1
  }

  return (
    <div className="pac-wrap">
      <div className="pac-hud">
        <span>Time left: {remaining}s</span>
        <span>Pellets left: {dotsLeft}</span>
      </div>
      <canvas ref={canvasRef} width={400} height={400} className="pac-canvas" />
      {!started ? (
        <button
          type="button"
          className="btn primary pac-start"
          onClick={() => {
            initGame()
            setStarted(true)
          }}
        >
          Start game
        </button>
      ) : null}
      <p className="muted small" style={{ textAlign: 'center', marginTop: 8 }}>
        Use the arrow keys to move. If a ghost catches you, only the ghost moves to another cell.
      </p>
      <div className="pac-touch">
        <button type="button" className="btn icon" onClick={() => nudge('ArrowUp')}>
          ↑
        </button>
        <div className="pac-touch-mid">
          <button type="button" className="btn icon" onClick={() => nudge('ArrowLeft')}>
            ←
          </button>
          <button type="button" className="btn icon" onClick={() => nudge('ArrowRight')}>
            →
          </button>
        </div>
        <button type="button" className="btn icon" onClick={() => nudge('ArrowDown')}>
          ↓
        </button>
      </div>
    </div>
  )
}
