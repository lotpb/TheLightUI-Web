import { useEffect, useMemo, useRef, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToTimeEntries,
  clockIn as doClockIn,
  clockOut as doClockOut,
  deleteTimeEntry,
  type TimeEntry,
  type GeoPoint,
} from '../../services/timeTrackingService'
import { subscribeToCustomers } from '../../services/customerService'
import { categoryMatches, fullName, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtDate(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  if (day.getTime() === today.getTime()) return 'Today'
  if (day.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Best-effort GPS capture — resolves to null (never rejects) on denial,
// timeout, or an unsupported browser, so clock-in/out never blocks on it.
function getCurrentLocation(): Promise<GeoPoint | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  })
}

function mapsUrl(loc: GeoPoint): string {
  return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
}

function periodStart(period: string): Date {
  const now = new Date()
  if (period === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d
  }
  if (period === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d
  }
  if (period === 'month') {
    const d = new Date(now); d.setDate(d.getDate() - 30); return d
  }
  return new Date(0)
}

// ── Live timer hook ───────────────────────────────────────────────────────────

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

// ── Active entry card ─────────────────────────────────────────────────────────

function ActiveCard({ entry, now, onClockOut }: { entry: TimeEntry; now: number; onClockOut: () => void }) {
  const elapsed = now - entry.clockIn.getTime()
  return (
    <div className="flex items-center gap-4 bg-teal-900/30 border border-teal-600/40 rounded-xl px-4 py-3">
      <div className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-teal-300 truncate">{entry.customerName}</p>
        <p className="text-xs text-teal-500 truncate">
          {entry.clockedInBy} · clocked in {fmtTime(entry.clockIn)}
          {entry.clockInLocation && (
            <a href={mapsUrl(entry.clockInLocation)} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()} className="ml-1.5 text-teal-400 hover:underline">
              📍
            </a>
          )}
        </p>
        {entry.notes && <p className="text-xs text-gray-500 truncate mt-0.5">{entry.notes}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-lg font-mono font-semibold text-teal-400 tabular-nums">{fmtElapsed(elapsed)}</p>
      </div>
      <button
        onClick={onClockOut}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-500 transition-colors"
      >
        Clock Out
      </button>
    </div>
  )
}

// ── Clock-in form ─────────────────────────────────────────────────────────────

function ClockInForm({
  jobs,
  onSubmit,
  onCancel,
}: {
  jobs: CustomerItem[]
  onSubmit: (customerId: string, customerName: string, notes: string) => Promise<void>
  onCancel: () => void
}) {
  const [jobId, setJobId]     = useState('')
  const [notes, setNotes]     = useState('')
  const [query, setQuery]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [showList, setShowList] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q ? jobs.filter(j => fullName(j).toLowerCase().includes(q)).slice(0, 10) : jobs.slice(0, 10)
  }, [jobs, query])

  const selectedJob = jobs.find(j => j.id === jobId)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowList(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedJob) return
    setSaving(true)
    try {
      await onSubmit(selectedJob.id, fullName(selectedJob), notes)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="card p-4 space-y-3 border border-teal-500/30">
      <p className="text-sm font-semibold text-white">Clock In</p>

      {/* Job picker */}
      <div ref={ref} className="relative">
        <label className="text-xs text-gray-400 mb-1 block">Job / Customer *</label>
        <input
          type="text"
          value={selectedJob ? fullName(selectedJob) : query}
          onChange={e => { setQuery(e.target.value); setJobId(''); setShowList(true) }}
          onFocus={() => setShowList(true)}
          placeholder="Search jobs…"
          className="input-field w-full text-sm py-1.5"
          autoComplete="off"
        />
        {showList && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl max-h-48 overflow-y-auto">
            {filtered.map(j => (
              <button
                key={j.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
                onClick={() => { setJobId(j.id); setQuery(''); setShowList(false) }}
              >
                {fullName(j)}
                {j.job && <span className="ml-2 text-xs text-gray-500">{j.job}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Notes (optional)</label>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="What are you working on?"
          className="input-field w-full text-sm py-1.5"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={!selectedJob || saving}
          className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-500 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Clocking in…' : '▶ Clock In'}
        </button>
      </div>
    </form>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Period = 'today' | 'week' | 'month' | 'all'

export default function TimeTrackingPage() {
  usePageTitle('Time Tracking')
  const user      = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)
  const toast     = useToast()
  const now       = useNow()

  const [entries, setEntries]     = useState<TimeEntry[]>([])
  const [jobs, setJobs]           = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [period, setPeriod]       = useState<Period>('week')
  const [jobFilter, setJobFilter] = useState('')
  const [clockingOut, setClockingOut] = useState<string | null>(null)
  const [deleteId, setDeleteId]   = useState<string | null>(null)

  // Subscribe to time entries
  useEffect(() => {
    const unsub = subscribeToTimeEntries(
      e => { setEntries(e); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [companyId])

  // Subscribe to active customers for job picker
  useEffect(() => {
    const unsub = subscribeToCustomers(
      items => setJobs(items.filter(c => categoryMatches(c.category, 'Customer') && c.isActive)),
      () => {},
    )
    return unsub
  }, [companyId])

  // Active entries (no clock-out)
  const active = useMemo(() => entries.filter(e => e.clockOut === null), [entries])

  // Completed entries filtered by period + job
  const completed = useMemo(() => {
    const start = periodStart(period)
    const jq = jobFilter.toLowerCase()
    return entries.filter(e => {
      if (e.clockOut === null) return false
      if (e.clockIn < start) return false
      if (jq && !e.customerName.toLowerCase().includes(jq)) return false
      return true
    })
  }, [entries, period, jobFilter])

  // Per-job totals
  const jobTotals = useMemo(() => {
    const map = new Map<string, { name: string; minutes: number; count: number }>()
    for (const e of completed) {
      if (e.durationMinutes == null) continue
      const existing = map.get(e.customerId)
      if (existing) {
        existing.minutes += e.durationMinutes
        existing.count++
      } else {
        map.set(e.customerId, { name: e.customerName, minutes: e.durationMinutes, count: 1 })
      }
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes)
  }, [completed])

  const totalMinutes = jobTotals.reduce((s, j) => s + j.minutes, 0)

  async function handleClockIn(customerId: string, customerName: string, notes: string) {
    const workerName = user?.displayName || user?.email || 'Unknown'
    const workerId   = user?.uid ?? ''
    const location = await getCurrentLocation()
    await doClockIn({ customerId, customerName, workerName, workerId, notes, location })
    setShowForm(false)
    toast(`Clocked in on ${customerName}`, 'success')
  }

  async function handleClockOut(entry: TimeEntry) {
    setClockingOut(entry.id)
    try {
      const location = await getCurrentLocation()
      await doClockOut(entry, location)
      toast('Clocked out', 'success')
    } catch {
      toast('Could not clock out', 'error')
    } finally {
      setClockingOut(null)
    }
  }

  async function handleDelete(id: string) {
    await deleteTimeEntry(id)
    setDeleteId(null)
    toast('Entry deleted', 'success')
  }

  // Group completed entries by date label
  const grouped = useMemo(() => {
    const map = new Map<string, TimeEntry[]>()
    for (const e of completed) {
      const label = fmtDate(e.clockIn)
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(e)
    }
    return [...map.entries()]
  }, [completed])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Time Tracking</h1>
          <p className="text-sm text-gray-400 mt-0.5">Clock in/out on jobs — logs hours automatically</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-500 transition-colors"
          >
            ▶ Clock In
          </button>
        )}
      </div>

      {/* Clock-in form */}
      {showForm && (
        <ClockInForm
          jobs={jobs}
          onSubmit={handleClockIn}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Active entries */}
      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-500 px-1">Active</p>
          {active.map(e => (
            <ActiveCard
              key={e.id}
              entry={e}
              now={now}
              onClockOut={() => {
                if (clockingOut) return
                handleClockOut(e)
              }}
            />
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-xl border border-gray-700 overflow-hidden text-xs font-medium">
          {(['today', 'week', 'month', 'all'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 transition-colors ${period === p ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {p === 'today' ? 'Today' : p === 'week' ? '7 Days' : p === 'month' ? '30 Days' : 'All'}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={jobFilter}
          onChange={e => setJobFilter(e.target.value)}
          placeholder="Filter by job…"
          className="input-field text-sm py-1.5 flex-1 min-w-32"
        />
      </div>

      {/* Summary totals strip */}
      {jobTotals.length > 0 && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Hours by Job</p>
            <p className="text-sm font-bold text-white">{fmtDuration(totalMinutes)} total</p>
          </div>
          {jobTotals.map(j => {
            const pct = totalMinutes > 0 ? (j.minutes / totalMinutes) * 100 : 0
            return (
              <div key={j.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-300 truncate">{j.name}</span>
                  <span className="text-gray-400 ml-2 shrink-0">{fmtDuration(j.minutes)} · {j.count} {j.count === 1 ? 'session' : 'sessions'}</span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* History */}
      {loading ? (
        <div className="card animate-pulse h-48" />
      ) : completed.length === 0 && active.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-3xl mb-3">⏱️</p>
          <p className="text-gray-400 text-sm">No time entries yet.</p>
          <p className="text-gray-600 text-xs mt-1">Click "Clock In" to start tracking time on a job.</p>
        </div>
      ) : completed.length === 0 ? null : (
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-1">History</p>
          {grouped.map(([dateLabel, dayEntries]) => (
            <div key={dateLabel}>
              <p className="text-xs text-gray-500 mb-2 px-1">{dateLabel}</p>
              <div className="card divide-y divide-gray-700/40">
                {dayEntries.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-gray-800/30 transition-colors">
                    {/* Job + notes */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-200 truncate">{e.customerName}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {e.clockedInBy} · {fmtTime(e.clockIn)}
                        {e.clockInLocation && (
                          <a href={mapsUrl(e.clockInLocation)} target="_blank" rel="noopener noreferrer"
                            className="ml-1 hover:underline">📍</a>
                        )}
                        {'–'}{e.clockOut ? fmtTime(e.clockOut) : '?'}
                        {e.clockOutLocation && (
                          <a href={mapsUrl(e.clockOutLocation)} target="_blank" rel="noopener noreferrer"
                            className="ml-1 hover:underline">📍</a>
                        )}
                        {e.notes && ` · ${e.notes}`}
                      </p>
                    </div>

                    {/* Duration */}
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-teal-400">
                        {e.durationMinutes != null ? fmtDuration(e.durationMinutes) : '—'}
                      </p>
                    </div>

                    {/* Delete */}
                    <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {deleteId === e.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleDelete(e.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded">Delete</button>
                          <button onClick={() => setDeleteId(null)} className="text-xs text-gray-500 hover:text-gray-300 px-1 py-1">Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteId(e.id)}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-gray-700 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <p className="text-xs text-gray-600 text-center pb-2">
          {completed.length} {completed.length === 1 ? 'session' : 'sessions'} · {fmtDuration(totalMinutes)} logged
        </p>
      )}
    </div>
  )
}
