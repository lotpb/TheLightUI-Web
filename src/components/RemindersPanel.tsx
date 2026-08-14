import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { Notification, NotifType } from '../hooks/useReminders'

interface Props {
  notifications: Notification[]
  permission: NotificationPermission
  onRequestPermission: () => void
  onClose: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  const today    = new Date(); today.setHours(0, 0, 0, 0)
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  const diff     = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0)   return `${Math.abs(diff)}d overdue`
  if (diff === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const TYPE_META: Record<NotifType, { label: string; icon: string; bg: string; text: string }> = {
  followup:    { label: 'Follow-up',    icon: '🔔', bg: 'bg-yellow-900/30', text: 'text-yellow-400' },
  task:        { label: 'Task',         icon: '✓',  bg: 'bg-violet-900/30', text: 'text-violet-400' },
  serviceplan: { label: 'Service Plan', icon: '↻',  bg: 'bg-teal-900/30',   text: 'text-teal-400'   },
  appointment: { label: 'Appointment',  icon: '📅', bg: 'bg-orange-900/30', text: 'text-orange-400' },
}

const URGENCY_GROUPS: Array<{ key: Notification['urgency']; label: string; labelColor: string }> = [
  { key: 'overdue',  label: 'Overdue',   labelColor: 'text-red-400' },
  { key: 'today',    label: 'Today',     labelColor: 'text-yellow-400' },
  { key: 'tomorrow', label: 'Tomorrow',  labelColor: 'text-blue-400' },
  { key: 'soon',     label: 'This Week', labelColor: 'text-gray-400' },
]

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function RemindersPanel({ notifications, permission, onRequestPermission, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const grouped = URGENCY_GROUPS.map(g => ({
    ...g,
    items: notifications.filter(n => n.urgency === g.key),
  })).filter(g => g.items.length > 0)

  // Count by type for the summary strip
  const byType = notifications.reduce<Record<NotifType, number>>(
    (acc, n) => { acc[n.type] = (acc[n.type] ?? 0) + 1; return acc },
    { followup: 0, task: 0, serviceplan: 0, appointment: 0 },
  )
  const hasAny = notifications.length > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-80 max-w-full h-full bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">Notifications</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {notifications.length === 0 ? 'All clear' : `${notifications.length} item${notifications.length !== 1 ? 's' : ''} need attention`}
            </p>
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

        {/* Type summary strip */}
        {hasAny && (
          <div className="flex gap-2 px-3 py-2 border-b border-gray-800/60 flex-wrap">
            {(Object.entries(byType) as [NotifType, number][])
              .filter(([, count]) => count > 0)
              .map(([type, count]) => {
                const m = TYPE_META[type]
                return (
                  <span key={type} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${m.bg} ${m.text} font-medium`}>
                    {m.icon} {count} {m.label}{count !== 1 ? 's' : ''}
                  </span>
                )
              })}
          </div>
        )}

        {/* Browser notification permission banner */}
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
          {!hasAny ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <svg className="w-10 h-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="text-sm text-gray-500">Nothing needs attention this week</p>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.key} className="mb-4">
                <p className={`px-4 py-1 text-xs font-semibold uppercase tracking-wider ${group.labelColor}`}>
                  {group.label} · {group.items.length}
                </p>
                <div className="space-y-1 px-3">
                  {group.items.map(n => {
                    const m = TYPE_META[n.type]
                    return (
                      <Link
                        key={n.id}
                        to={n.linkTo}
                        onClick={onClose}
                        className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-gray-800 transition-colors group"
                      >
                        {/* Type icon */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-sm ${m.bg}`}>
                          <span>{m.icon}</span>
                        </div>

                        {/* Text */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide ${m.text}`}>{m.label}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-200 truncate group-hover:text-white leading-tight">
                            {n.title}
                          </p>
                          {n.subtitle && (
                            <p className="text-xs text-gray-500 truncate mt-0.5">{n.subtitle}</p>
                          )}
                        </div>

                        {/* Due date */}
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <span className={`text-xs font-medium ${
                            group.key === 'overdue' ? 'text-red-400' :
                            group.key === 'today'   ? 'text-yellow-400' :
                            group.key === 'tomorrow'? 'text-blue-400' :
                            'text-gray-500'
                          }`}>
                            {fmtDate(n.dueDate)}
                          </span>
                          <svg className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">
            Follow-ups · Tasks · Service Plans · this week
          </p>
        </div>
      </div>
    </div>
  )
}
