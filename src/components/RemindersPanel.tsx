import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Notification, NotifType, NotificationSupport, RecentActivity } from '../hooks/useReminders'
import type { AppNotification } from '../models/notification'
import DonutChart, { DonutLegend, type DonutSlice } from './DonutChart'

interface Props {
  notifications: Notification[]
  recentActivity: RecentActivity[]
  permission: NotificationPermission
  notificationSupport: NotificationSupport
  onRequestPermission: () => void
  onClose: () => void
  appNotifications: AppNotification[]
  onMarkNotificationRead: (id: string) => void
  onMarkAllNotificationsRead: () => void
}

const ACTIVITY_META: Record<RecentActivity['kind'], { icon: string; color: string }> = {
  lead:     { icon: '👤', color: 'text-indigo-400' },
  customer: { icon: '🏠', color: 'text-green-400'  },
  invoice:  { icon: '🧾', color: 'text-amber-400'  },
}

function fmtAgo(d: Date): string {
  const diff = Math.round((Date.now() - d.getTime()) / 60000)
  if (diff < 1)  return 'Just now'
  if (diff < 60) return `${diff}m ago`
  const hrs = Math.floor(diff / 60)
  if (hrs < 24) return hrs === 1 ? '1h ago' : `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return days === 1 ? '1d ago' : `${days}d ago`
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

/** Beyond this the legend stops being matchable to the arcs at 320px wide. */
const MAX_SLICES = 5

const URGENCY_SHORT: Record<Notification['urgency'], string> = {
  overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', soon: 'This week',
}

/** Activity notification types are free strings written by Cloud Functions. */
function humanise(type: string): string {
  const t = type.replace(/[_-]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : 'Other'
}

/**
 * Counts by key, largest first, with the tail folded into "Other".
 *
 * The activity feed's `type` is an open set, so without a cap a company with
 * nine notification kinds would get nine arcs in a 108px donut and a legend
 * nobody can match to them.
 */
function toSlices(counts: Map<string, number>, label: (k: string) => string): DonutSlice[] {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, MAX_SLICES)
  const tail = sorted.slice(MAX_SLICES)
  const slices: DonutSlice[] = head.map(([k, v], i) => ({ key: k, label: label(k), value: v, tone: i }))
  if (tail.length > 0) {
    slices.push({
      key: '__other',
      label: `Other (${tail.length})`,
      value: tail.reduce((s, [, v]) => s + v, 0),
      tone: MAX_SLICES,
    })
  }
  return slices
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function RemindersPanel({
  notifications, recentActivity, permission, notificationSupport, onRequestPermission, onClose,
  appNotifications, onMarkNotificationRead, onMarkAllNotificationsRead,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const [tab, setTab] = useState<'reminders' | 'activity'>('reminders')
  /** Two cuts of the same reminders, rather than two cramped donuts. */
  const [breakdown, setBreakdown] = useState<'urgency' | 'type'>('urgency')

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
  const unreadCount = appNotifications.filter(n => !n.read).length

  // Fixed order, so a slice keeps its colour as counts change — Overdue is
  // always red and Follow-up always amber, however many of each there are.
  const urgencySlices: DonutSlice[] = URGENCY_GROUPS.map((g, i) => ({
    key: g.key,
    label: URGENCY_SHORT[g.key],
    value: notifications.filter(n => n.urgency === g.key).length,
    tone: i,
  }))
  const typeSlices: DonutSlice[] = (Object.keys(TYPE_META) as NotifType[]).map((t, i) => ({
    key: t,
    label: TYPE_META[t].label,
    value: byType[t],
    tone: i,
  }))
  const reminderSlices = breakdown === 'urgency' ? urgencySlices : typeSlices

  const activitySlices = toSlices(
    appNotifications.reduce((m, n) => m.set(n.type, (m.get(n.type) ?? 0) + 1), new Map<string, number>()),
    humanise,
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-80 max-w-full h-full bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl">
            <button
              onClick={() => setTab('reminders')}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                tab === 'reminders' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Reminders{notifications.length > 0 && ` (${notifications.length})`}
            </button>
            <button
              onClick={() => setTab('activity')}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                tab === 'activity' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Activity{unreadCount > 0 && ` (${unreadCount})`}
            </button>
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

        {tab === 'activity' ? (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/60">
              <p className="text-xs text-gray-500">
                {appNotifications.length === 0 ? 'No activity yet' : `${appNotifications.length} recent event${appNotifications.length !== 1 ? 's' : ''}`}
              </p>
              {unreadCount > 0 && (
                <button onClick={onMarkAllNotificationsRead} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                  Mark all read
                </button>
              )}
            </div>
            {/* The feed answers "what happened"; the donut answers "what kind
                of thing keeps happening", which a reverse-chronological list
                can't show at all. */}
            {appNotifications.length > 0 && (
              <div className="flex items-center gap-3 px-3 py-3 border-b border-gray-800/60">
                <DonutChart
                  slices={activitySlices}
                  palette="category"
                  centerValue={String(appNotifications.length)}
                  centerLabel="events"
                />
                <DonutLegend slices={activitySlices} palette="category" />
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {appNotifications.length === 0 ? (
                <p className="p-6 text-sm text-gray-500 text-center">No notifications yet</p>
              ) : (
                <div className="divide-y divide-gray-800">
                  {appNotifications.map(n => (
                    <Link
                      key={n.id}
                      to={n.linkTo}
                      onClick={() => { if (!n.read) onMarkNotificationRead(n.id); onClose() }}
                      className={`block px-4 py-3 hover:bg-gray-800/60 transition-colors ${!n.read ? 'bg-indigo-950/20' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium ${n.read ? 'text-gray-300' : 'text-white'}`}>{n.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</p>
                          <p className="text-xs text-gray-600 mt-1">{fmtAgo(n.createdAt)}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
        <>
        {/* Was a flat strip of "3 Follow-ups" pills: the counts without the
            proportions, and only ever by type. The donut carries the same
            numbers in its legend and adds the split the pills couldn't show,
            with a toggle so the other cut isn't a second cramped chart. */}
        {hasAny && (
          <div className="px-3 py-3 border-b border-gray-800/60">
            <div role="group" aria-label="Break down by" className="flex rounded-lg overflow-hidden border border-gray-700 text-xs mb-3">
              {([['urgency', 'By urgency'], ['type', 'By type']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={breakdown === key}
                  onClick={() => setBreakdown(key)}
                  className={`flex-1 py-1 font-medium transition-colors
                              focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                    breakdown === key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <DonutChart
                slices={reminderSlices}
                palette={breakdown === 'urgency' ? 'urgency' : 'type'}
                centerValue={String(notifications.length)}
                centerLabel="due"
              />
              <DonutLegend slices={reminderSlices} palette={breakdown === 'urgency' ? 'urgency' : 'type'} />
            </div>
          </div>
        )}

        {/* Browser notification permission banner. iPhone/iPad Safari has no
            Notification API outside Home Screen web apps, so showing an
            "Enable" button there would do nothing — give install steps instead. */}
        {permission !== 'granted' && (
          <div className="mx-3 mt-3 bg-indigo-900/30 border border-indigo-700/40 rounded-xl px-3 py-3">
            {notificationSupport === 'needs-install' ? (
              <>
                <p className="text-xs text-indigo-300 font-medium">
                  iPhone and iPad only allow notifications for Home Screen apps.
                </p>
                <ol className="mt-2 text-xs text-indigo-300/80 space-y-1 list-decimal list-inside">
                  <li>Tap the Share button in Safari</li>
                  <li>Choose “Add to Home Screen”</li>
                  <li>Open TheLight from your Home Screen, then enable notifications here</li>
                </ol>
              </>
            ) : notificationSupport === 'unsupported' ? (
              <p className="text-xs text-indigo-300 font-medium">
                This browser doesn’t support notifications. Reminders below still update live.
              </p>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-3">
          {!hasAny && recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <svg className="w-10 h-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="text-sm text-gray-500">Nothing needs attention this week</p>
            </div>
          ) : (
            <>
              {grouped.map(group => (
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
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-sm ${m.bg}`}>
                            <span>{m.icon}</span>
                          </div>
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
              ))}

              {/* Recent Activity */}
              {recentActivity.length > 0 && (
                <div className="mb-4">
                  <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Recent Activity · {recentActivity.length}
                  </p>
                  <div className="space-y-1 px-3">
                    {recentActivity.map(item => {
                      const meta = ACTIVITY_META[item.kind]
                      return (
                        <Link
                          key={item.id}
                          to={item.linkTo}
                          onClick={onClose}
                          className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-800 transition-colors group"
                        >
                          <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0 text-sm">
                            <span>{meta.icon}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-200 truncate group-hover:text-white leading-tight">
                              {item.label}
                            </p>
                            <p className="text-xs text-gray-500 truncate mt-0.5">{item.sub}</p>
                          </div>
                          <span className="text-xs text-gray-600 shrink-0">{fmtAgo(item.createdAt)}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">
            Follow-ups · Tasks · Service Plans · Appointments · 24h activity
          </p>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
