import { useEffect, type RefObject } from 'react'

export function useSearchShortcut(
  inputRef: RefObject<HTMLInputElement | null>,
  onClear: () => void,
) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === '/' && !isEditable && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }

      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onClear()
        inputRef.current?.blur()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inputRef, onClear])
}
