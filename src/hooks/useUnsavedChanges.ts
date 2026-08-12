import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

export function useUnsavedChanges(isDirty: boolean) {
  // Block in-app navigation (React Router)
  const blocker = useBlocker(isDirty)

  // Block browser refresh / tab close
  useEffect(() => {
    if (!isDirty) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  return blocker
}
