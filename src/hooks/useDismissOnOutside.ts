import { useEffect } from 'react'

/**
 * Close a popover on an outside click or Escape.
 *
 * CustomerListPage grew its own copy of this; /team had no equivalent at all
 * and tried `onBlur` on a non-focusable `<div>`, which never fires — so the
 * member menu could only be dismissed by pressing the same button again.
 */
export function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, ref, onClose])
}
