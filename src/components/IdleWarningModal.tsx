import { useEffect, useRef } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  secondsLeft: number
  onStay: () => void
  onSignOut: () => void
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export default function IdleWarningModal({ secondsLeft, onStay, onSignOut }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef)

  // Escape means "I'm here" — dismissing the dialog keeps the session.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onStay()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onStay])

  return (
    // z-[60] so it sits above the other modals (search, confirm) at z-50.
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-warning-title"
        aria-describedby="idle-warning-body"
        className="relative bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-slide-up"
      >
        <div className="flex items-start gap-3 mb-4">
          <span className="shrink-0 mt-0.5 text-amber-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="idle-warning-title" className="text-gray-100 text-sm font-semibold">
              Still there?
            </h2>
            <p id="idle-warning-body" className="text-gray-400 text-sm leading-relaxed mt-1">
              You'll be signed out in{' '}
              <span className="font-semibold text-amber-300 tabular-nums" aria-live="polite">
                {formatCountdown(secondsLeft)}
              </span>{' '}
              to keep customer data off an unattended screen. Unsaved changes will be lost.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onSignOut}
            className="flex-1 py-2 text-sm font-medium rounded-xl bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            Sign Out Now
          </button>
          <button
            autoFocus
            onClick={onStay}
            className="flex-1 py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            Stay Signed In
          </button>
        </div>
      </div>
    </div>
  )
}
