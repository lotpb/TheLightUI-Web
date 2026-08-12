import { createContext, useCallback, useContext, useRef, useState } from 'react'

type Variant = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  variant: Variant
  message: string
}

interface ToastCtx {
  toast: (message: string, variant?: Variant) => void
}

const Ctx = createContext<ToastCtx | null>(null)

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx.toast
}

const ICONS: Record<Variant, React.ReactNode> = {
  success: (
    <svg className="w-4 h-4 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.008v.008H12v-.008Z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
    </svg>
  ),
}

const BAR: Record<Variant, string> = {
  success: 'bg-green-500',
  error:   'bg-red-500',
  info:    'bg-indigo-500',
}

const AUTO_DISMISS_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, variant: Variant = 'info') => {
    const id = `${Date.now()}-${Math.random()}`
    setItems(prev => [...prev, { id, variant, message }])
    const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    timers.current.set(id, timer)
  }, [dismiss])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}

      {/* Toast stack — fixed bottom-right on desktop, bottom-center on mobile */}
      <div
        className="fixed bottom-20 md:bottom-6 right-0 md:right-6 left-0 md:left-auto z-[9999] flex flex-col gap-2 px-4 md:px-0 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map(item => (
          <div
            key={item.id}
            className="pointer-events-auto flex items-start gap-3 w-full md:w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-slide-up"
            role="status"
          >
            {/* Accent bar */}
            <div className={`w-1 self-stretch shrink-0 ${BAR[item.variant]}`} />
            <div className="flex items-start gap-2.5 flex-1 py-3 pr-3">
              {ICONS[item.variant]}
              <p className="text-sm text-gray-100 leading-snug flex-1">{item.message}</p>
              <button
                onClick={() => dismiss(item.id)}
                className="text-gray-500 hover:text-gray-300 transition-colors mt-0.5 shrink-0"
                aria-label="Dismiss"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
