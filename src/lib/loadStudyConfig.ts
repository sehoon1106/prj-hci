import type { StudyBundle } from '../types/study'

const CONFIG_BASE = import.meta.env.BASE_URL + 'config/'

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${CONFIG_BASE}${name}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load config: ${name} (${res.status})`)
  return res.json() as Promise<T>
}

export async function loadStudyBundle(): Promise<StudyBundle> {
  const [study, filler, preSurvey, attention2, postSurvey, slides, memory] =
    await Promise.all([
      fetchJson<StudyBundle['study']>('study.json'),
      fetchJson<StudyBundle['filler']>('filler.json'),
      fetchJson<StudyBundle['preSurvey']>('pre-survey.json'),
      fetchJson<StudyBundle['attention2']>('attention-2.json'),
      fetchJson<StudyBundle['postSurvey']>('post-survey.json'),
      fetchJson<StudyBundle['slides']>('slides.json'),
      fetchJson<StudyBundle['memory']>('memory-items.json'),
    ])

  return {
    study,
    filler,
    preSurvey,
    attention2,
    postSurvey,
    slides,
    memory,
  }
}
