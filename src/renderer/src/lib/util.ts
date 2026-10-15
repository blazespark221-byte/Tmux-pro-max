const home = window.tpm.info.homeDir
export const isMac = window.tpm.info.platform === 'darwin'

export function shortenPath(p: string): string {
  if (!p) return ''
  if (home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\'))) return '~' + p.slice(home.length)
  return p
}

/** `~/a/b/c/d` → `…/c/d` when it would be too long to show in full. */
export function compactPath(p: string, max = 30): string {
  const short = shortenPath(p)
  if (short.length <= max) return short
  const parts = short.split(/[\\/]/).filter(Boolean)
  const tail = parts.slice(-2).join('/')
  return tail.length + 2 <= max ? `…/${tail}` : `…/${parts[parts.length - 1]}`
}

export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  )
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
