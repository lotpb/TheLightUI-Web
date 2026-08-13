import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return

    const returnFocus = document.activeElement as HTMLElement | null

    function focusables() {
      return Array.from(el!.querySelectorAll<HTMLElement>(FOCUSABLE))
    }

    // Move focus into the container if it isn't already inside
    if (!el.contains(document.activeElement)) {
      const first = focusables()[0]
      ;(first ?? el).focus()
    }

    function trapTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) { e.preventDefault(); return }

      const first   = els[0]
      const last    = els[els.length - 1]
      const current = document.activeElement

      if (e.shiftKey) {
        if (current === first || !el!.contains(current)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (current === last || !el!.contains(current)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', trapTab)
    return () => {
      document.removeEventListener('keydown', trapTab)
      returnFocus?.focus()
    }
  }, [active, ref])
}
