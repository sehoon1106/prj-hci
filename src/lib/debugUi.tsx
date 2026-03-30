import type { ReactNode } from 'react'

/** Pilot-only UI: `vite` dev server only; omitted from production bundles (`npm run build`). */
export const SHOW_DEBUG_UI = import.meta.env.DEV

export function DebugSkipBar({ children }: { children: ReactNode }) {
  if (!SHOW_DEBUG_UI) return null
  return <div className="debug-skip-bar">{children}</div>
}
