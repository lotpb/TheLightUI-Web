import { useEffect, useState } from 'react'

function read(): boolean {
  return typeof document !== 'undefined' &&
    document.documentElement.classList.contains('light-mode')
}

/**
 * Whether the app is in light mode, kept live.
 *
 * Almost everything reads the theme through the CSS variables in index.css and
 * never needs this. The exceptions are surfaces that can't use a Tailwind
 * token at all — SVG presentation attributes (recharts) and inline `style`
 * backgrounds computed from data (the /heatmap tiles). Those have to pick a
 * literal colour in JS, and one literal can't serve both themes.
 *
 * Settings toggles the class on <html> without a reload, so reading it once at
 * mount leaves those surfaces on the previous theme's colours until the next
 * navigation. The MutationObserver on that one attribute is what makes a theme
 * switch reach an SVG fill or an inline background.
 */
export function useIsLightMode(): boolean {
  const [light, setLight] = useState(read)

  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() => setLight(el.classList.contains('light-mode')))
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return light
}
