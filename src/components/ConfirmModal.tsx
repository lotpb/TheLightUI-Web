import { useEffect } from 'react'

interface Props {
  isOpen: boolean
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ isOpen, message, confirmLabel = 'Delete', onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-slide-up">
        <p className="text-gray-100 text-sm leading-relaxed mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-sm font-medium rounded-xl bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className="flex-1 py-2 text-sm font-medium rounded-xl bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
