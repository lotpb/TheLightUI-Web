import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fullName, formatCurrency, type CustomerItem } from '../models/customer'
interface Props {
  items: CustomerItem[]
  permission: NotificationPermission
  onRequestPermission: () => void
  onClose: () => void
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Group {
  label: string
  colorClass: string
  items: CustomerItem[]
}

function buildGroups(items: CustomerItem[]): Group[] {
  const now   = new Date()
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  const tomorrowStart = new Date(today); tomorrowStart.setDate(today.getDate() + 1)
  const tomorrowEnd   = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999)

  const overdue: CustomerItem[]   = []
  const todayList: CustomerItem[] = []
  const tomorrow: CustomerItem[]  = []
  const later: CustomerItem[]     = []

  for (const c of items) {
    if (!c.followUpDate) continue
    const d = c.followUpDate
    if (d < today)          overdue.push(c)
    else if (d <= todayEnd) todayList.push(c)
    else if (d <= tomorrowEnd) tomorrow.push(c)
    else later.push(c)
  }

  const groups: Group[] = []
  if (overdue.length)   groups.push({ label: 'Overdue',   colorClass: 'text-red-400',    items: overdue })
  if (todayList.length) groups.push({ label: 'Today',     colorClass: 'text-yellow-400', items: todayList })
  if (tomorrow.length)  groups.push({ label: 'Tomorrow',  colorClass: 'text-blue-400',   items: tomorrow })
  if (later.length)     groups.push({ label: 'This Week', colorClass: 'text-gray-400',   items: later })
  return groups
}

export default function RemindersPanel({ items, permission, onRequestPermission, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const groups = buildGroups(items)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-80 max-w-full h-full bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">Reminders</h2>
            <p className="text-xs text-gray-500 mt-0.5">Follow-up appointments</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-100 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Permission banner */}
        {permission !== 'granted' && (
          <div className="mx-3 mt-3 bg-indigo-900/30 border border-indigo-700/40 rounded-xl px-3 py-3">
            <p className="text-xs text-indigo-300 font-medium">
              {permission === 'denied'
                ? 'Browser notifications are blocked. Enable them in your browser settings to get alerts.'
                : 'Enable browser notifications to get alerts when follow-ups are due.'}
            </p>
            {permission !== 'denied' && (
              <button
                onClick={onRequestPermission}
                className="mt-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Enable Notifications
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <svg className="w-10 h-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              <p className="text-sm text-gray-500">No upcoming follow-ups</p>
            </div>
          ) : (
            groups.map(group => (
              <div key={group.label} className="mb-4">
                <p className={`px-4 py-1 text-xs font-semibold uppercase tracking-wider ${group.colorClass}`}>
                  {group.label}
                </p>
                <div className="space-y-1 px-3">
                  {group.items.map(c => (
                    <Link
                      key={c.id}
                      to={`/records/${c.id}`}
                      onClick={onClose}
                      className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-gray-800 transition-colors group"
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-semibold text-gray-300">
                          {[c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase() || '?'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-200 truncate group-hover:text-white">
                          {fullName(c) || '—'}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {c.followUpDate
                            ? `${fmtDate(c.followUpDate)} at ${fmtTime(c.followUpDate)}`
                            : ''}
                          {c.phone ? ` · ${c.phone}` : ''}
                        </p>
                        {c.amount > 0 && (
                          <p className="text-xs text-green-500/70 mt-0.5">{formatCurrency(c.amount)}</p>
                        )}
                      </div>
                      <svg className="w-4 h-4 text-gray-600 shrink-0 mt-1 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">
            Showing follow-ups from yesterday through next 2 weeks
          </p>
        </div>
      </div>
    </div>
  )
}
