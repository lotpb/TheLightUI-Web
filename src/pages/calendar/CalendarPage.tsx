import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToCustomers } from '../../services/customerService'
import { subscribeToTodos } from '../../services/todoService'
import { subscribeToServicePlans } from '../../services/servicePlanService'
import { categoryMatches, fullName, type CustomerItem } from '../../models/customer'
import type { Todo } from '../../models/todo'
import type { ServicePlan } from '../../models/servicePlan'
import { useAuthStore } from '../../stores/authStore'
import { usePageTitle } from '../../hooks/usePageTitle'

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = 'appt' | 'job-start' | 'job-complete' | 'followup' | 'task' | 'serviceplan'
type ViewType  = 'month' | 'week' | 'list'

interface CalEvent {
  key:       string
  type:      EventType
  date:      Date
  name:      string
  sub?:      string
  salesman?: string
  linkTo:    string
}

const EVENT_CONFIG: Record<EventType, { label: string; color: string; dot: string; bg: string; icon: string }> = {
  'appt':         { label: 'Appointment', color: 'text-indigo-400', dot: 'bg-indigo-500',  bg: 'bg-indigo-500/15 text-indigo-200',  icon: '📅' },
  'job-start':    { label: 'Job Start',   color: 'text-teal-400',   dot: 'bg-teal-500',    bg: 'bg-teal-500/15 text-teal-200',      icon: '🔨' },
  'job-complete': { label: 'Job Done',    color: 'text-green-400',  dot: 'bg-green-500',   bg: 'bg-green-500/15 text-green-200',    icon: '✅' },
  'followup':     { label: 'Follow-up',   color: 'text-rose-400',   dot: 'bg-rose-500',    bg: 'bg-rose-500/15 text-rose-200',      icon: '🔔' },
  'task':         { label: 'Task',        color: 'text-violet-400', dot: 'bg-violet-500',  bg: 'bg-violet-500/15 text-violet-200',  icon: '☐'  },
  'serviceplan':  { label: 'Service',     color: 'text-amber-400',  dot: 'bg-amber-500',   bg: 'bg-amber-500/15 text-amber-200',    icon: '↻'  },
}

const DOT_PRIORITY: EventType[] = ['followup', 'appt', 'task', 'serviceplan', 'job-start', 'job-complete']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

function isValidDate(d: Date | null | undefined): d is Date {
  return !!d && !isNaN(d.getTime()) && d.getTime() > 86_400_000
}

function addToMap(map: Map<string, CalEvent[]>, d: Date, event: CalEvent) {
  const key  = dateKey(d)
  const list = map.get(key) ?? []
  list.push(event)
  map.set(key, list)
}

function buildEventMap(
  customers: CustomerItem[],
  todos:     Todo[],
  plans:     ServicePlan[],
): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()

  for (const c of customers) {
    const name     = fullName(c) || '—'
    const salesman = c.salesman

    if (c.isActive && categoryMatches(c.category, 'Lead') && isValidDate(c.startDate)) {
      addToMap(map, c.startDate, { key: `appt-${c.id}`,      type: 'appt',        date: c.startDate,     name, salesman, linkTo: `/records/${c.id}` })
    }
    if (c.isActive && categoryMatches(c.category, 'Customer') && isValidDate(c.startDate)) {
      addToMap(map, c.startDate, { key: `job-start-${c.id}`, type: 'job-start',   date: c.startDate,     name, salesman, linkTo: `/records/${c.id}` })
      if (isValidDate(c.completionDate) && c.completionDate.toDateString() !== c.startDate.toDateString()) {
        addToMap(map, c.completionDate, { key: `job-done-${c.id}`, type: 'job-complete', date: c.completionDate, name, salesman, linkTo: `/records/${c.id}` })
      }
    }
    if (isValidDate(c.followUpDate)) {
      addToMap(map, c.followUpDate, { key: `fu-${c.id}`, type: 'followup', date: c.followUpDate, name, salesman, linkTo: `/records/${c.id}` })
    }
  }

  for (const t of todos) {
    if (!t.isCompleted && isValidDate(t.dueDate)) {
      addToMap(map, t.dueDate, {
        key:    `task-${t.id}`,
        type:   'task',
        date:   t.dueDate,
        name:   t.title,
        sub:    t.priority === 'high' ? 'High priority' : t.priority === 'medium' ? 'Medium priority' : undefined,
        linkTo: `/todo/${t.id}/edit`,
      })
    }
  }

  for (const sp of plans) {
    if (sp.isActive && isValidDate(sp.nextDate)) {
      addToMap(map, sp.nextDate, {
        key:    `sp-${sp.id}`,
        type:   'serviceplan',
        date:   sp.nextDate,
        name:   sp.customerName,
        sub:    sp.title,
        linkTo: `/service-plans`,
      })
    }
  }

  for (const [key, events] of map) {
    map.set(key, events.sort((a, b) => DOT_PRIORITY.indexOf(a.type) - DOT_PRIORITY.indexOf(b.type)))
  }

  return map
}

function getCalendarDays(year: number, month: number): Date[] {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days: Date[] = []
  for (let i = firstDay - 1; i >= 0; i--) days.push(new Date(year, month, -i))
  for (let d = 1; d <= daysInMonth; d++)  days.push(new Date(year, month, d))
  let next = 1
  while (days.length < 42) days.push(new Date(year, month + 1, next++))
  return days
}

function getWeekDays(anchor: Date): Date[] {
  const ws = new Date(anchor)
  ws.setDate(ws.getDate() - ws.getDay())
  ws.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws)
    d.setDate(ws.getDate() + i)
    return d
  })
}

function fmtDay(d: Date): string {
  const today = new Date()
  if (sameDay(d, today)) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (sameDay(d, tomorrow)) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

const TODAY_KEY = dateKey(new Date())

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  usePageTitle('Calendar')
  const companyId = useAuthStore(s => s.companyId)
  const user      = useAuthStore(s => s.user)
  const isReady   = useAuthStore(s => s.isReady)

  const [customers,  setCustomers]  = useState<CustomerItem[]>([])
  const [todos,      setTodos]      = useState<Todo[]>([])
  const [plans,      setPlans]      = useState<ServicePlan[]>([])
  const [loading,    setLoading]    = useState(true)
  const [view,       setView]       = useState<ViewType>('month')
  const [filterType, setFilterType] = useState<EventType | 'all'>('all')
  const [repFilter,  setRepFilter]  = useState('')

  const [viewDate, setViewDate] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [selectedKey, setSelectedKey] = useState<string>(TODAY_KEY)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setCustomers(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  useEffect(() => {
    if (!user || !isReady) return
    return subscribeToTodos(items => setTodos(items), () => {})
  }, [user?.uid, isReady])

  useEffect(() => {
    if (!isReady) return
    return subscribeToServicePlans(items => setPlans(items), () => {})
  }, [companyId, isReady])

  const reps = useMemo(() => {
    const s = new Set<string>()
    for (const c of customers) if (c.salesman) s.add(c.salesman)
    return [...s].sort()
  }, [customers])

  const rawEventMap = useMemo(() => buildEventMap(customers, todos, plans), [customers, todos, plans])

  // Apply rep filter — tasks and service plans have no salesman so they always show
  const eventMap = useMemo(() => {
    if (!repFilter) return rawEventMap
    const filtered = new Map<string, CalEvent[]>()
    for (const [key, events] of rawEventMap) {
      const f = events.filter(e => !e.salesman || e.salesman === repFilter)
      if (f.length) filtered.set(key, f)
    }
    return filtered
  }, [rawEventMap, repFilter])

  const days     = useMemo(() => getCalendarDays(viewDate.getFullYear(), viewDate.getMonth()), [viewDate])
  const weekDays = useMemo(() => getWeekDays(viewDate), [viewDate])
  const curMonth = viewDate.getMonth()

  const monthLabel = view === 'week'
    ? (() => {
        const ws = weekDays[0]
        const we = weekDays[6]
        return `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      })()
    : viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const allSelectedEvents = eventMap.get(selectedKey) ?? []
  const selectedEvents    = filterType === 'all'
    ? allSelectedEvents
    : allSelectedEvents.filter(e => e.type === filterType)

  function prevPeriod() {
    if (view === 'week') {
      setViewDate(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
    } else {
      setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    }
  }
  function nextPeriod() {
    if (view === 'week') {
      setViewDate(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
    } else {
      setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    }
  }
  function goToday() {
    const n = new Date()
    setViewDate(new Date(n.getFullYear(), n.getMonth(), 1))
    setSelectedKey(TODAY_KEY)
  }

  const selectedLabel = (() => {
    const d = new Date(selectedKey + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  })()

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<EventType, number>> = {}
    for (const events of eventMap.values()) {
      for (const e of events) {
        counts[e.type] = (counts[e.type] ?? 0) + 1
      }
    }
    return counts
  }, [eventMap])

  // Flat upcoming list for list view, grouped by day
  const upcomingList = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const allEvents: CalEvent[] = []
    for (const events of eventMap.values()) {
      for (const e of events) {
        if (e.date >= today && (filterType === 'all' || e.type === filterType)) {
          allEvents.push(e)
        }
      }
    }
    allEvents.sort((a, b) => a.date.getTime() - b.date.getTime())
    const groups = new Map<string, CalEvent[]>()
    for (const e of allEvents) {
      const k   = e.date.toDateString()
      const arr = groups.get(k) ?? []
      arr.push(e)
      groups.set(k, arr)
    }
    return [...groups.entries()].slice(0, 60)
  }, [eventMap, filterType])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Calendar</h1>
          <p className="text-sm text-gray-400 mt-0.5">Appointments, jobs, follow-ups, tasks and service plans</p>
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

      {/* View toggle + nav */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-gray-800 rounded-xl p-1 gap-0.5">
          {(['month', 'week', 'list'] as ViewType[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                view === v ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {view !== 'list' && (
          <>
            <div className="flex items-center gap-1">
              <button onClick={prevPeriod} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm font-medium text-gray-200 min-w-[180px] text-center">{monthLabel}</span>
              <button onClick={nextPeriod} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
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
      </div>

      {/* Event type filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilterType('all')}
          className={`text-xs px-3 py-1 rounded-full border transition-colors font-medium ${
            filterType === 'all'
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
          }`}
        >
          All
        </button>
        {(Object.entries(EVENT_CONFIG) as [EventType, typeof EVENT_CONFIG[EventType]][]).map(([type, cfg]) => {
          const count = typeCounts[type] ?? 0
          if (!count) return null
          return (
            <button
              key={type}
              onClick={() => setFilterType(f => f === type ? 'all' : type)}
              className={`flex items-center gap-1 text-xs px-3 py-1 rounded-full border transition-colors font-medium ${
                filterType === type
                  ? `${cfg.dot} bg-opacity-100 border-transparent text-white`
                  : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
              {cfg.label}
              <span className="opacity-70">({count})</span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="card p-12 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── MONTH VIEW ──────────────────────────────────────────────────── */}
          {view === 'month' && (
            <>
              <div className="card overflow-hidden select-none">
                <div className="grid grid-cols-7 border-b border-gray-700/50">
                  {WEEKDAYS.map(w => (
                    <div key={w} className="py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      {w}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {days.map((day, i) => {
                    const key         = dateKey(day)
                    const inMonth     = day.getMonth() === curMonth
                    const isToday     = key === TODAY_KEY
                    const isSelected  = key === selectedKey
                    const events      = (eventMap.get(key) ?? []).filter(e => filterType === 'all' || e.type === filterType)
                    const visibleDots = events.slice(0, 3)
                    const overflow    = events.length - visibleDots.length
                    const isLastInRow = i % 7 === 6

                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedKey(key)}
                        className={[
                          'relative flex flex-col items-start p-1.5 min-h-[60px] border-b border-gray-800/40 text-left transition-colors',
                          !isLastInRow ? 'border-r border-gray-800/40' : '',
                          isSelected ? 'bg-indigo-600/15' : 'hover:bg-gray-800/40',
                        ].join(' ')}
                      >
                        <span className={[
                          'inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full mb-1 shrink-0',
                          isToday    ? 'bg-indigo-500 text-white' :
                          isSelected ? 'bg-gray-600 text-white'   :
                          inMonth    ? 'text-gray-200'             : 'text-gray-600',
                        ].join(' ')}>
                          {day.getDate()}
                        </span>

                        {visibleDots.length > 0 && (
                          <div className="flex items-center gap-0.5 flex-wrap">
                            {visibleDots.map((e, ei) => (
                              <span key={ei} className={`w-1.5 h-1.5 rounded-full shrink-0 ${EVENT_CONFIG[e.type].dot}`} />
                            ))}
                            {overflow > 0 && (
                              <span className="text-[9px] text-gray-500 leading-none">+{overflow}</span>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Selected day panel */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <p className="section-header mb-0">{selectedLabel}</p>
                  {allSelectedEvents.length > 0 && (
                    <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-gray-700">
                      {selectedEvents.length}{filterType !== 'all' && `/${allSelectedEvents.length}`}
                    </span>
                  )}
                </div>
                <div className="card divide-y divide-gray-700/50">
                  {selectedEvents.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-gray-500">
                      {allSelectedEvents.length > 0 ? 'No matching events — try "All"' : 'No events on this day'}
                    </p>
                  ) : (
                    selectedEvents.map(e => <EventRow key={e.key} event={e} />)
                  )}
                </div>
              </section>
            </>
          )}

          {/* ── WEEK VIEW ───────────────────────────────────────────────────── */}
          {view === 'week' && (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-700/50">
                {weekDays.map((day, i) => {
                  const isToday = sameDay(day, new Date())
                  return (
                    <div key={i} className={`py-3 text-center ${i > 0 ? 'border-l border-gray-700/50' : ''}`}>
                      <p className="text-xs text-gray-500">{WEEKDAYS[day.getDay()]}</p>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold mx-auto mt-0.5 ${
                        isToday ? 'bg-indigo-600 text-white' : 'text-gray-300'
                      }`}>
                        {day.getDate()}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-7">
                {weekDays.map((day, i) => {
                  const key    = dateKey(day)
                  const events = (eventMap.get(key) ?? []).filter(e => filterType === 'all' || e.type === filterType)
                  return (
                    <div key={i} className={`min-h-[180px] p-1.5 ${i > 0 ? 'border-l border-gray-700/50' : ''}`}>
                      {events.map((e, j) => {
                        const cfg = EVENT_CONFIG[e.type]
                        return (
                          <Link
                            key={j}
                            to={e.linkTo}
                            className={`block p-1.5 rounded-lg mb-1 ${cfg.bg} hover:opacity-80 transition-opacity`}
                          >
                            <p className="text-[10px] font-semibold truncate">{e.name}</p>
                            <p className="text-[9px] opacity-70">{e.sub ?? cfg.label}</p>
                            {e.salesman && <p className="text-[9px] opacity-60 truncate">{e.salesman}</p>}
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
              {upcomingList.length === 0 ? (
                <div className="card p-12 text-center space-y-2">
                  <p className="text-3xl">📅</p>
                  <p className="text-gray-400 text-sm">No upcoming events found.</p>
                  <p className="text-xs text-gray-600">Events are pulled from lead appointments, job dates, follow-ups, tasks and service plans.</p>
                </div>
              ) : (
                upcomingList.map(([key, events]) => (
                  <div key={key}>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      {fmtDay(events[0].date)}
                    </p>
                    <div className="card divide-y divide-gray-700/30 overflow-hidden">
                      {events.map(e => <EventRow key={e.key} event={e} />)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Shared event row ─────────────────────────────────────────────────────────

function EventRow({ event: e }: { event: CalEvent }) {
  const cfg = EVENT_CONFIG[e.type]
  return (
    <Link
      to={e.linkTo}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${cfg.dot} bg-opacity-20`}>
        <span>{cfg.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-100 truncate">{e.name}</p>
        <div className="flex items-center gap-2 text-xs mt-0.5 flex-wrap">
          {e.salesman && <span className="text-gray-500">{e.salesman}</span>}
          {e.salesman && <span className="text-gray-700">·</span>}
          <span className={cfg.color}>{e.sub ?? cfg.label}</span>
        </div>
      </div>
      <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
