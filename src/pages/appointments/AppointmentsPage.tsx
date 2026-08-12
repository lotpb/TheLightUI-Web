import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewType = 'month' | 'week' | 'list'

type ApptType = 'lead-appt' | 'job-start' | 'job-complete'

interface Appt {
  customerId: string
  name: string
  salesman: string
  phone: string
  category: string
  date: Date
  type: ApptType
}

// ─── Color helpers ────────────────────────────────────────────────────────────

const PALETTE = [
  { pill: 'bg-indigo-500/25 text-indigo-200',  dot: '#6366f1' },
  { pill: 'bg-violet-500/25 text-violet-200',  dot: '#8b5cf6' },
  { pill: 'bg-pink-500/25   text-pink-200',    dot: '#ec4899' },
  { pill: 'bg-amber-500/25  text-amber-200',   dot: '#f59e0b' },
  { pill: 'bg-emerald-500/25 text-emerald-200',dot: '#10b981' },
  { pill: 'bg-blue-500/25   text-blue-200',    dot: '#3b82f6' },
  { pill: 'bg-orange-500/25 text-orange-200',  dot: '#f97316' },
  { pill: 'bg-rose-500/25   text-rose-200',    dot: '#f43f5e' },
]

function repIdx(rep: string): number {
  let h = 0
  for (const ch of rep) h = (h * 31 + ch.charCodeAt(0)) % PALETTE.length
  return h
}

function typeLabel(t: ApptType): string {
  if (t === 'lead-appt')   return 'Appointment'
  if (t === 'job-start')   return 'Job Start'
  return 'Job Complete'
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

function buildMonthGrid(year: number, month: number): Date[] {
  const firstDow = new Date(year, month, 1).getDay()
  const days: Date[] = []
  for (let i = 1 - firstDow; days.length < 42; i++) {
    days.push(new Date(year, month, i))
  }
  return days
}

function weekStart(anchor: Date): Date {
  const d = new Date(anchor)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

function isValid(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime()) && d.getTime() > 86_400_000
}

const DAYS_SHORT  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AppointmentsPage() {
  usePageTitle('Appointments')
  const companyId = useAuthStore(s => s.companyId)

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [view, setView]           = useState<ViewType>('month')
  const [anchor, setAnchor]       = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [repFilter, setRepFilter] = useState('')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      items => { setCustomers(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const reps = useMemo(() => {
    const s = new Set<string>()
    for (const c of customers) if (c.salesman) s.add(c.salesman)
    return [...s].sort()
  }, [customers])

  // Collect all appointments from customer records
  const allAppts = useMemo<Appt[]>(() => {
    const list: Appt[] = []
    for (const c of customers) {
      const base = {
        customerId: c.id,
        name: fullName(c),
        salesman: c.salesman,
        phone: c.phone,
        category: c.category,
      }
      if (c.category.toLowerCase() === 'lead' && isValid(c.startDate)) {
        list.push({ ...base, date: c.startDate, type: 'lead-appt' })
      }
      if (c.category.toLowerCase() === 'customer' && isValid(c.startDate)) {
        list.push({ ...base, date: c.startDate, type: 'job-start' })
      }
      if (c.category.toLowerCase() === 'customer' && isValid(c.completionDate) && c.completionDate > c.startDate) {
        list.push({ ...base, date: c.completionDate, type: 'job-complete' })
      }
    }
    return list.sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [customers])

  const appts = useMemo(() =>
    repFilter ? allAppts.filter(a => a.salesman === repFilter) : allAppts,
  [allAppts, repFilter])

  // Lookup: day key → appointments
  const byDay = useMemo(() => {
    const m = new Map<string, Appt[]>()
    for (const a of appts) {
      const k = a.date.toDateString()
      const arr = m.get(k) ?? []
      arr.push(a)
      m.set(k, arr)
    }
    return m
  }, [appts])

  // Navigation
  function prev() {
    if (view === 'month') {
      setAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    } else {
      setAnchor(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
    }
    setSelectedDay(null)
  }
  function next() {
    if (view === 'month') {
      setAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    } else {
      setAnchor(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
    }
    setSelectedDay(null)
  }
  function goToday() { setAnchor(new Date()); setSelectedDay(null) }

  const monthGrid = useMemo(() => buildMonthGrid(anchor.getFullYear(), anchor.getMonth()), [anchor])
  const weekDays  = useMemo(() => {
    const ws = weekStart(anchor)
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return d })
  }, [anchor])

  const navLabel = view === 'month'
    ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    : (() => {
        const ws = weekStart(anchor)
        const we = new Date(ws); we.setDate(ws.getDate() + 6)
        return `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      })()

  // Selected day appointments
  const selectedAppts = selectedDay ? (byDay.get(selectedDay.toDateString()) ?? []) : []

  // Upcoming list (from today)
  const upcomingGroups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const upcoming = appts.filter(a => a.date >= today)
    const groups = new Map<string, Appt[]>()
    for (const a of upcoming) {
      const k = a.date.toDateString()
      const arr = groups.get(k) ?? []
      arr.push(a)
      groups.set(k, arr)
    }
    return [...groups.entries()].slice(0, 60)
  }, [appts])

  function fmtDay(d: Date): string {
    const today = new Date()
    if (sameDay(d, today)) return 'Today'
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    if (sameDay(d, tomorrow)) return 'Tomorrow'
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Appointments</h1>
          <p className="text-sm text-gray-400 mt-0.5">Lead appointments &amp; job dates from all records</p>
        </div>
        <select
          value={repFilter}
          onChange={e => setRepFilter(e.target.value)}
          className="input-field text-sm py-1.5 w-36 shrink-0"
        >
          <option value="">All Reps</option>
          {reps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* View + nav controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* View toggle */}
        <div className="flex bg-gray-800 rounded-xl p-1 gap-0.5">
          {(['month', 'week', 'list'] as ViewType[]).map(v => (
            <button
              key={v}
              onClick={() => { setView(v); setSelectedDay(null) }}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                view === v ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Nav */}
        {view !== 'list' && (
          <>
            <div className="flex items-center gap-1">
              <button onClick={prev} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm font-medium text-gray-200 min-w-[180px] text-center">{navLabel}</span>
              <button onClick={next} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <button onClick={goToday} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              Today
            </button>
          </>
        )}

        <div className="ml-auto text-xs text-gray-600">
          {appts.length} total appointments
        </div>
      </div>

      {loading ? (
        <div className="card p-12 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── MONTH VIEW ──────────────────────────────────────────────────── */}
          {view === 'month' && (
            <div className="card overflow-hidden">
              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 border-b border-gray-700/50">
                {DAYS_SHORT.map(d => (
                  <div key={d} className="py-2 text-center text-xs font-semibold text-gray-500">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {monthGrid.map((day, idx) => {
                  const dayAppts  = byDay.get(day.toDateString()) ?? []
                  const inMonth   = day.getMonth() === anchor.getMonth()
                  const isToday   = sameDay(day, new Date())
                  const isSel     = selectedDay && sameDay(day, selectedDay)
                  const hasBorder = idx >= 7  // skip top border on first row (card has it)
                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedDay(isSel ? null : day)}
                      className={`
                        min-h-[72px] p-1.5 cursor-pointer transition-colors select-none
                        ${hasBorder ? 'border-t border-gray-800/60' : ''}
                        ${idx % 7 !== 0 ? 'border-l border-gray-800/60' : ''}
                        ${isSel ? 'bg-indigo-600/10' : inMonth ? 'hover:bg-gray-700/20' : 'bg-gray-900/40 hover:bg-gray-800/30'}
                      `}
                    >
                      {/* Day number */}
                      <div className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold mb-1
                        ${isToday ? 'bg-indigo-600 text-white' : inMonth ? 'text-gray-300' : 'text-gray-600'}
                      `}>
                        {day.getDate()}
                      </div>

                      {/* Appointment pills */}
                      <div className="space-y-0.5">
                        {dayAppts.slice(0, 2).map((a, i) => {
                          const color = PALETTE[repIdx(a.salesman)]
                          return (
                            <div
                              key={i}
                              className={`text-[9px] leading-tight truncate px-1 py-0.5 rounded ${color.pill}`}
                              title={`${a.name} — ${typeLabel(a.type)}`}
                            >
                              {a.name}
                            </div>
                          )
                        })}
                        {dayAppts.length > 2 && (
                          <div className="text-[9px] text-gray-500 px-1">+{dayAppts.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Selected day detail */}
              {selectedDay && (
                <div className="border-t border-gray-700/50 bg-gray-800/30">
                  <div className="px-4 py-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-200">{fmtDay(selectedDay)}</p>
                    <button onClick={() => setSelectedDay(null)} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
                      Close ✕
                    </button>
                  </div>
                  {selectedAppts.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-gray-500">No appointments this day.</p>
                  ) : (
                    <div className="divide-y divide-gray-700/30 pb-1">
                      {selectedAppts.map((a, i) => (
                        <ApptRow key={i} appt={a} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── WEEK VIEW ───────────────────────────────────────────────────── */}
          {view === 'week' && (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-700/50">
                {weekDays.map((day, i) => {
                  const isToday = sameDay(day, new Date())
                  return (
                    <div key={i} className={`py-3 text-center ${i > 0 ? 'border-l border-gray-700/50' : ''}`}>
                      <p className="text-xs text-gray-500">{DAYS_SHORT[day.getDay()]}</p>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold mx-auto mt-0.5
                        ${isToday ? 'bg-indigo-600 text-white' : 'text-gray-300'}
                      `}>
                        {day.getDate()}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-7">
                {weekDays.map((day, i) => {
                  const dayAppts = byDay.get(day.toDateString()) ?? []
                  return (
                    <div key={i} className={`min-h-[200px] p-1.5 ${i > 0 ? 'border-l border-gray-700/50' : ''}`}>
                      {dayAppts.map((a, j) => {
                        const color = PALETTE[repIdx(a.salesman)]
                        return (
                          <Link
                            key={j}
                            to={`/records/${a.customerId}`}
                            className={`block p-1.5 rounded-lg mb-1 ${color.pill} hover:opacity-80 transition-opacity`}
                          >
                            <p className="text-[10px] font-semibold truncate">{a.name}</p>
                            <p className="text-[9px] opacity-70">{typeLabel(a.type)}</p>
                            {a.salesman && <p className="text-[9px] opacity-60 truncate">{a.salesman}</p>}
                          </Link>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── LIST VIEW ───────────────────────────────────────────────────── */}
          {view === 'list' && (
            <div className="space-y-4">
              {upcomingGroups.length === 0 ? (
                <div className="card p-12 text-center space-y-2">
                  <p className="text-3xl">📅</p>
                  <p className="text-gray-400 text-sm">No upcoming appointments found.</p>
                  <p className="text-xs text-gray-600">Appointments are pulled from lead appointment dates and job start/completion dates.</p>
                </div>
              ) : (
                upcomingGroups.map(([key, dayAppts]) => (
                  <div key={key}>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      {fmtDay(dayAppts[0].date)}
                    </p>
                    <div className="card divide-y divide-gray-700/30 overflow-hidden">
                      {dayAppts.map((a, i) => (
                        <ApptRow key={i} appt={a} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Rep legend */}
          {repFilter === '' && reps.length > 0 && view !== 'list' && (
            <div className="flex flex-wrap gap-2 pt-1">
              {reps.map(rep => {
                const color = PALETTE[repIdx(rep)]
                return (
                  <button
                    key={rep}
                    onClick={() => setRepFilter(rep)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${color.pill} hover:opacity-80 transition-opacity`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color.dot }} />
                    {rep}
                  </button>
                )
              })}
              <span className="text-xs text-gray-600 self-center">Click a rep to filter</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Shared appointment row ────────────────────────────────────────────────────

function ApptRow({ appt }: { appt: Appt }) {
  const color = PALETTE[repIdx(appt.salesman)]
  return (
    <Link
      to={`/records/${appt.customerId}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/20 transition-colors"
    >
      <div className={`w-2 h-2 rounded-full shrink-0`} style={{ background: color.dot }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200 truncate">{appt.name}</p>
        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
          <span>{appt.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          {appt.salesman && <><span className="text-gray-700">·</span><span>{appt.salesman}</span></>}
          <span className="text-gray-700">·</span>
          <span className={`font-medium ${appt.type === 'lead-appt' ? 'text-indigo-400' : appt.type === 'job-start' ? 'text-amber-400' : 'text-green-400'}`}>
            {typeLabel(appt.type)}
          </span>
        </div>
      </div>
      {appt.phone && (
        <a
          href={`tel:${appt.phone}`}
          onClick={e => e.stopPropagation()}
          className="text-gray-500 hover:text-green-400 transition-colors shrink-0 no-print"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
          </svg>
        </a>
      )}
    </Link>
  )
}
