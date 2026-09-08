import { useEffect, useState } from 'react'

/**
 * Tracks a CSS media query from JavaScript.
 *
 * Needed where a breakpoint changes behaviour rather than appearance: the
 * record list's split view changes what clicking a row *does* — select in place
 * versus navigate to the full page — and a Tailwind `xl:` variant can't express
 * that.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    // Re-read on mount: the query string can change between renders, and the
    // window may have been resized before the listener was attached.
    setMatches(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
