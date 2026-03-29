/**
 * Prefix root-relative asset paths (`/stimuli/...`) with Vite `base` so deploys under a
 * subpath (e.g. GitHub Pages `https://user.github.io/repo-name/`) resolve correctly.
 * Absolute `http(s):` and `data:` / `blob:` URLs are unchanged.
 */
export function assetUrl(href: string): string {
  if (!href) return href
  const t = href.trim()
  if (/^https?:\/\//i.test(t)) return href
  if (t.startsWith('data:') || t.startsWith('blob:')) return href
  if (t.startsWith('//')) return href

  const base = import.meta.env.BASE_URL || '/'
  const pathFromRoot = t.startsWith('/') ? t : `/${t}`
  if (base === '/' || base === '') return pathFromRoot
  const baseNoTrail = base.replace(/\/$/, '')
  return `${baseNoTrail}${pathFromRoot}`
}
