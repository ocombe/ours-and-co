import { useCallback, useEffect, useState } from 'react'
import { fold } from './text'

/**
 * Navigation lives in the URL hash ("#/courses/marche") so the browser's back and
 * forward buttons work. A hash, because GitHub Pages cannot serve other paths. Hashes
 * that do not start with "#/" (the sign-in callback "#access_token=…") are left alone.
 */
function readPath(): string[] | null {
  const h = location.hash
  return h.startsWith('#/') ? h.slice(2).split('/').filter(Boolean).map(decodeURIComponent) : null
}

export function useHashPath() {
  const [path, setPath] = useState(readPath)

  useEffect(() => {
    const onChange = () => setPath(readPath())
    window.addEventListener('popstate', onChange)
    window.addEventListener('hashchange', onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('hashchange', onChange)
    }
  }, [])

  /** Go to a path: a new history entry, or `replace` the current one (no extra step back). */
  const go = useCallback((segments: string[], replace = false) => {
    const hash = '#/' + segments.map(encodeURIComponent).join('/')
    if (hash !== location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash)
    setPath(segments)
  }, [])

  return { path, go }
}

/** URL-friendly name: "Marché" -> "marche". */
export function slug(name: string) {
  return fold(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
