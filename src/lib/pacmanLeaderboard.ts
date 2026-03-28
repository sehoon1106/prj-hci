import type { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 800
/** Cap total rows read so one visit does not download an unbounded table. */
const MAX_PAGES = 16

export interface PacmanLeaderboardEntry {
  /** Single grapheme (e.g. first syllable of Korean name, first letter of Latin). */
  initial: string
  score: number
}

export interface PacmanLeaderboardResult {
  entries: PacmanLeaderboardEntry[]
  truncated: boolean
  fetchFailed: boolean
}

function pickInitial(name: unknown): string {
  if (typeof name !== 'string') return '?'
  const t = name.trim()
  if (!t) return '?'
  try {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      for (const { segment } of seg.segment(t)) {
        if (segment) return segment
      }
    }
  } catch {
    /* use fallback */
  }
  return Array.from(t)[0] ?? '?'
}

function demoNameFromDemographics(d: unknown): unknown {
  if (!d || typeof d !== 'object') return undefined
  return (d as Record<string, unknown>).demo_name
}

function pacmanScoreFromFillerStats(stats: unknown): number | null {
  if (!stats || typeof stats !== 'object') return null
  const s = stats as Record<string, unknown>
  if (s.type !== 'pacman') return null
  if (s.debugSkip === true) return null
  const rawMax = s.maxPacmanScore
  const n = typeof rawMax === 'number' ? rawMax : Number(rawMax)
  if (Number.isFinite(n) && n >= 0) return n
  const rawDots = s.dotsEaten
  const d = typeof rawDots === 'number' ? rawDots : Number(rawDots)
  if (Number.isFinite(d) && d >= 0) return d
  return null
}

/**
 * Loads submitted sessions and builds a descending score list.
 * Uses initial from `demographics.demo_name` only (no full name in UI).
 */
export async function fetchPacmanLeaderboard(
  client: SupabaseClient,
): Promise<PacmanLeaderboardResult> {
  type Row = { demographics: unknown; filler_stats: unknown }
  const rows: Row[] = []
  let truncated = false

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await client
      .from('study_submissions')
      .select('demographics, filler_stats')
      .order('created_at', { ascending: true })
      .range(from, to)

    if (error) {
      console.warn('[pacman leaderboard]', error.message)
      return { entries: [], truncated: false, fetchFailed: true }
    }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < PAGE_SIZE) break
    if (page === MAX_PAGES - 1) truncated = true
  }

  const entries: PacmanLeaderboardEntry[] = []
  for (const r of rows) {
    const score = pacmanScoreFromFillerStats(r.filler_stats)
    if (score === null) continue
    entries.push({
      initial: pickInitial(demoNameFromDemographics(r.demographics)),
      score,
    })
  }
  entries.sort((a, b) => b.score - a.score)

  return { entries, truncated, fetchFailed: false }
}
