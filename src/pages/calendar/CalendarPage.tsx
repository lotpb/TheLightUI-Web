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
import { Icon, ICONS } from '../../components/Icon'

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

/**
 * `icon` is an SVG path, not an emoji.
 *
 * It held 📅 🔨 ✅ 🔔 ☐ ↻ — four colour emoji that ignore `color` and two text
 * dingbats that don't, so inside EventRow's hue-tinted circle four of the six
 * clashed with the ring they sat in and two matched it. As currentColor paths
 * they all take the type's hue, and in the month grid they give each type a
 * distinct *shape*, which is what stops that view being colour-only.
 */
const EVENT_CONFIG: Record<EventType, { label: string; color: string; dot: string; bg: string; icon: string | readonly string[] }> = {
  'appt':         { label: 'Appointment', color: 'text-indigo-400', dot: 'bg-indigo-500',  bg: 'bg-indigo-500/15 text-indigo-200',  icon: ICONS.calendar },
  'job-start':    { label: 'Job Start',   color: 'text-teal-400',   dot: 'bg-teal-500',    bg: 'bg-teal-500/15 text-teal-200',      icon: ICONS.wrench },
  'job-complete': { label: 'Job Done',    color: 'text-green-400',  dot: 'bg-green-500',   bg: 'bg-green-500/15 text-green-200',    icon: ICONS.checkCircle },
  'followup':     { label: 'Follow-up',   color: 'text-rose-400',   dot: 'bg-rose-500',    bg: 'bg-rose-500/15 text-rose-200',      icon: ICONS.bell },
  'task':         { label: 'Task',        color: 'text-violet-400', dot: 'bg-violet-500',  bg: 'bg-violet-500/15 text-violet-200',  icon: ICONS.clipboard },
  'serviceplan':  { label: 'Service',     color: 'text-amber-400',  dot: 'bg-amber-500',   bg: 'bg-amber-500/15 text-amber-200',    icon: ICONS.refresh },
}

const DOT_PRIORITY: EventType[] = ['followup', 'appt', 'task', 'serviceplan', 'job-start', 'job-complete']
/** How many upcoming days the list view renders before it stops. */
const LIST_DAY_LIMIT = 60
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

/**
 * Only as many weeks as the month actually spans.
 *
 * This padded unconditionally to 42 cells, so a five-week month got a sixth row
 * made entirely of greyed next-month dates — about 60px of dead grid, and the
 * month's shape changed between, say, February and August for no reason.
 */
function getCalendarDays(year: number, month: number): Date[] {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days: Date[] = []
  for (let i = firstDay - 1; i >= 0; i--) days.push(new Date(year, month, -i))
  for (let d = 1; d <= daysInMonth; d++)  days.push(new Date(year, month, d))
  const cells = Math.ceil(days.length / 7) * 7
  let next = 1
  while (days.length < cells) days.push(new Date(year, month + 1, next++))
  return days
}

/**
 * Today's key, refreshed when the day rolls over.
 *
 * This was a module-level `const`, computed once when the bundle loaded — so on
 * a tab left open past midnight "Today" stayed ringed on yesterday's cell and
 * the Today button navigated to the wrong date. This is a page people leave
 * open all day.
 */
function useTodayKey(): string {
  const [key, setKey] = useState(() => dateKey(new Date()))
  useEffect(() => {
    const now  = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    const id = setTimeout(() => setKey(dateKey(new Date())), next.getTime() - now.getTime())
    return () => clearTimeout(id)
  }, [key])
  return key
}

/** Per-type counts for a day, for the month cell's accessible summary. */
function summarise(events: CalEvent[]): string {
  if (events.length === 0) return 'No events'
  const counts = new Map<EventType, number>()
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [...counts.entries()]
    .map(([t, n]) => `${n} ${EVENT_CONFIG[t].label}${n === 1 ? '' : 's'}`)
    .join(', ')
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  usePageTitle('Calendar')
  const TODAY_KEY = useTodayKey()
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

  const [viewDate, setViewDate] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState<string>(() => dateKey(new Date()))

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
    setViewDate(new Date())
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
    // Capped, and the caller is told so. This silently sliced to 60 day-groups
    // with nothing on screen indicating there was more beyond it.
    const all = [...groups.entries()]
    return { groups: all.slice(0, LIST_DAY_LIMIT), truncated: all.length > LIST_DAY_LIMIT }
  }, [eventMap, filterType])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Calendar</h1>
          <p className="text-sm text-gray-400 mt-0.5">Appointments, jobs, follow-ups, tasks and service plans</p>
        </div>
        <label htmlFor="cal-rep" className="sr-only">Filter by rep</label>
        <select
          id="cal-rep"
          value={repFilter}
          onChange={e => setRepFilter(e.target.value)}
          className="input-field text-sm py-1.5 w-36 shrink-0"
        >
          <option value="">All Reps</option>
          {reps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {/* The calendar was read-only: every event linked out to a record, a
            task or /service-plans, and nothing linked in — no way to add
            anything, and clicking a free day only selected it. Tasks are the
            one event type this app creates directly, so that's the action. */}
        <Link to="/todo" className="btn-primary inline-flex items-center gap-1.5 text-sm px-3 py-1.5 shrink-0">
          <Icon d={ICONS.plus} className="w-4 h-4 shrink-0" />
          New Task
        </Link>
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
                <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-gray-200 min-w-[180px] text-center">{monthLabel}</span>
              <button onClick={nextPeriod} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
                <Icon d={ICONS.chevronRight} className="w-4 h-4" />
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
                    <div key={w} className="py-2 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
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
                    // One icon per *type* present, not one per event: three
                    // anonymous 6px dots told you nothing about what was on a
                    // day, and colour was the only channel — indigo-500 at
                    // 3.29:1 and violet-500 at 3.47:1 are adjacent in hue and
                    // barely over the 3:1 non-text floor, so a colour-blind
                    // reader got nothing from this grid at all. Distinct shapes
                    // carry the type; the count carries the volume.
                    const typesPresent = [...new Set(events.map(e => e.type))]
                      .sort((a, b) => DOT_PRIORITY.indexOf(a) - DOT_PRIORITY.indexOf(b))
                    const visibleTypes = typesPresent.slice(0, 3)
                    const hiddenTypes  = typesPresent.length - visibleTypes.length
                    const isLastInRow = i % 7 === 6

                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedKey(key)}
                        aria-label={`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — ${summarise(events)}`}
                        aria-pressed={isSelected}
                        title={summarise(events)}
                        className={[
                          'relative flex flex-col items-start p-1.5 min-h-[64px] border-b border-gray-800/40 text-left transition-colors',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                          !isLastInRow ? 'border-r border-gray-800/40' : '',
                          isToday ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/50' : '',
                          isSelected ? 'bg-indigo-600/15' : !isToday ? 'hover:bg-gray-800/40' : '',
                        ].join(' ')}
                      >
                        {isToday && (
                          <span className="absolute top-1 right-1.5 text-[8px] font-bold text-indigo-400 uppercase tracking-wide">
                            Today
                          </span>
                        )}
                        <span className={[
                          'inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full mb-1 shrink-0',
                          isToday    ? 'bg-indigo-500 text-white' :
                          isSelected ? 'bg-gray-600 text-white'   :
                          inMonth    ? 'text-gray-200'             : 'text-gray-400',
                        ].join(' ')}>
                          {day.getDate()}
                        </span>

                        {events.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {visibleTypes.map(t => (
                              <Icon
                                key={t}
                                d={EVENT_CONFIG[t].icon}
                                className={`w-3 h-3 shrink-0 ${EVENT_CONFIG[t].color}`}
                              />
                            ))}
                            {hiddenTypes > 0 && (
                              <span className="text-[10px] text-gray-400 leading-none">+{hiddenTypes}</span>
                            )}
                            <span className="text-[10px] font-semibold text-gray-300 leading-none tabular-nums ml-auto">
                              {events.length}
                            </span>
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
                    <p className="px-4 py-4 text-sm text-gray-400">
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
            <div className="flex flex-col md:flex-row gap-4">
              {/* Scrolls rather than squeezing. Seven columns inside
                  max-w-4xl minus the 260px mini-month left each day about
                  87px, which is why the event cards had dropped to 9–10px
                  type. A 108px floor per column plus horizontal scroll lets the
                  text be legible instead. */}
              <div className="card overflow-x-auto flex-1 min-w-0">
                <div className="grid grid-cols-7 border-b border-gray-700/50 min-w-[756px]">
                  {weekDays.map((day, i) => {
                    const isToday = sameDay(day, new Date())
                    return (
                      <div key={i} className={`py-3 text-center ${i > 0 ? 'border-l border-gray-700/50' : ''}`}>
                        <p className="text-xs text-gray-400">{WEEKDAYS[day.getDay()]}</p>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold mx-auto mt-0.5 ${
                          isToday ? 'bg-indigo-600 text-white' : 'text-gray-300'
                        }`}>
                          {day.getDate()}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="grid grid-cols-7 min-w-[756px]">
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
                              title={`${e.name} — ${e.sub ?? cfg.label}${e.salesman ? ` · ${e.salesman}` : ''}`}
                              className={`block p-1.5 rounded-lg mb-1 ${cfg.bg} hover:opacity-80 transition-opacity
                                          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                            >
                              <p className="flex items-center gap-1 text-xs font-semibold">
                                <Icon d={cfg.icon} className="w-3 h-3 shrink-0" />
                                <span className="truncate">{e.name}</span>
                              </p>
                              <p className="text-[11px] opacity-80 truncate">{e.sub ?? cfg.label}</p>
                              {e.salesman && <p className="text-[11px] opacity-70 truncate">{e.salesman}</p>}
                            </Link>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Mini month overview — shows where the current week sits in the month */}
              <div className="card md:w-[260px] shrink-0 p-3">
                <p className="text-xs font-semibold text-gray-400 mb-2 text-center">
                  {viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </p>
                <div className="grid grid-cols-7 gap-y-1">
                  {WEEKDAYS.map(w => (
                    <div key={w} className="text-center text-[9px] font-semibold text-gray-400 uppercase">
                      {w[0]}
                    </div>
                  ))}
                  {days.map((day, i) => {
                    const key       = dateKey(day)
                    const inMonth   = day.getMonth() === curMonth
                    const isToday   = key === TODAY_KEY
                    const inWeek    = weekDays.some(d => sameDay(d, day))
                    const hasEvents = (eventMap.get(key) ?? []).some(e => filterType === 'all' || e.type === filterType)

                    return (
                      <button
                        key={i}
                        onClick={() => setViewDate(day)}
                        title={day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        className={[
                          'relative flex items-center justify-center aspect-square rounded-md text-[10px] transition-colors',
                          isToday ? 'bg-indigo-500 text-white font-semibold' :
                          inWeek  ? 'bg-indigo-600/20 text-indigo-200' :
                          inMonth ? 'text-gray-300 hover:bg-gray-800/60' : 'text-gray-400 hover:bg-gray-800/40',
                        ].join(' ')}
                      >
                        {day.getDate()}
                        {hasEvents && (
                          <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isToday ? 'bg-white' : 'bg-indigo-400'}`} />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── LIST VIEW ───────────────────────────────────────────────────── */}
          {view === 'list' && (
            <div className="space-y-4">
              {upcomingList.groups.length === 0 ? (
                <div className="card p-12 text-center space-y-2">
                  <Icon d={ICONS.calendar} className="w-8 h-8 mx-auto text-gray-400" />
                  <p className="text-gray-400 text-sm">No upcoming events found.</p>
                  <p className="text-xs text-gray-400">Events are pulled from lead appointments, job dates, follow-ups, tasks and service plans.</p>
                </div>
              ) : (
                upcomingList.groups.map(([key, events]) => (
                  <div key={key}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      {fmtDay(events[0].date)}
                    </p>
                    <div className="card divide-y divide-gray-700/30 overflow-hidden">
                      {events.map(e => <EventRow key={e.key} event={e} />)}
                    </div>
                  </div>
                ))
              )}
              {upcomingList.truncated && (
                <p className="text-xs text-gray-400 text-center">
                  Showing the next {LIST_DAY_LIMIT} days with events. Use Month or Week view to look further ahead.
                </p>
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
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.dot} bg-opacity-20`}>
        <Icon d={cfg.icon} className={`w-4 h-4 ${cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-100 truncate">{e.name}</p>
        <div className="flex items-center gap-2 text-xs mt-0.5 flex-wrap">
          {e.salesman && <span className="text-gray-400">{e.salesman}</span>}
          {e.salesman && <span aria-hidden className="text-gray-400">·</span>}
          <span className={cfg.color}>{e.sub ?? cfg.label}</span>
        </div>
      </div>
      <Icon d={ICONS.chevronRight} className="w-4 h-4 text-gray-400 shrink-0" />
    </Link>
  )
}
