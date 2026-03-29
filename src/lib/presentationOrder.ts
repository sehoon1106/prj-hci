import type { PresentationOrders, StudyBundle } from '../types/study'

export function shuffleIndices(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = arr[i]!
    arr[i] = arr[j]!
    arr[j] = a
  }
  return arr
}

function orderFor(length: number, randomize: boolean): number[] {
  if (length <= 0) return []
  if (!randomize) return Array.from({ length }, (_, i) => i)
  return shuffleIndices(length)
}

/** One shuffle per phase; arrays map presentation position → index in config (`slides` / `memory.items`). */
export function createPresentationOrders(bundle: StudyBundle): PresentationOrders {
  const meta = bundle.study
  const n = bundle.slides.slides.length
  const m = bundle.memory.items.length
  return {
    baseline: orderFor(n, meta.randomizeBaselineSlideOrder ?? true),
    condition: orderFor(n, meta.randomizeConditionSlideOrder ?? true),
    memory: orderFor(m, meta.randomizeMemoryItemOrder ?? true),
  }
}
