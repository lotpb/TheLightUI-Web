import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToCustomers } from '../../services/customerService'
import { categoryMatches, fullName, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePageTitle } from '../../hooks/usePageTitle'

type EventType = 'appt' | 'job-start' | 'job-complete' | 'followup'

interface CalEvent {
  key: string
  type: EventType
  name: string
  customerId: string
}

const EVENT_CONFIG: Record<EventType, { label: string; color: string; dot: string }> = {
  'appt':         { label: 'Appointment', color: 'text-indigo-400', dot: 'bg-indigo-500' },
  'job-start':    { label: 'Job Start',   color: 'text-teal-400',   dot: 'bg-teal-500'   },
  'job-complete': { label: 'Job Done',    color: 'text-green-400',  dot: 'bg-green-500'  },
  'followup':     { label: 'Follow-up',   color: 'text-rose-400',   dot: 'bg-rose-500'   },
}

const DOT_PRIORITY: EventType[] = ['followup', 'appt', 'job-start', 'job-complete']

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildEventMap(customers: CustomerItem[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()

  function add(d: Date | null | undefined, event: Omit<CalEvent, 'key'>) {
    if (!d || isNaN(d.getTime())) return
    const key = dateKey(d)
    const list = map.get(key) ?? []
    list.push({ key: `${event.customerId}-${event.type}`, ...event })
    map.set(key, list)
  }

  for (const c of customers) {
    const name = fullName(c) || '—'

    if (c.isActive && categoryMatches(c.category, 'Lead')) {
      add(c.startDate, { type: 'appt', name, customerId: c.id })
    }
    if (c.isActive && categoryMatches(c.category, 'Customer')) {
      add(c.startDate, { type: 'job-start', name, customerId: c.id })
      // Only add completion if it differs from start date
      if (
        c.completionDate &&
        c.startDate &&
        c.completionDate.toDateString() !== c.startDate.toDateString()
      ) {
        add(c.completionDate, { type: 'job-complete', name, customerId: c.id })
      }
    }
    if (c.followUpDate) {
      add(c.followUpDate, { type: 'followup', name, customerId: c.id })
    }
  }

  // Sort each day's events by priority
  for (const [key, events] of map) {
    map.set(key, events.sort((a, b) => DOT_PRIORITY.indexOf(a.type) - DOT_PRIORITY.indexOf(b.type)))
  }

  return map
}

function getCalendarDays(year: number, month: number): Date[] {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days: Date[] = []

  // Trailing days of previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i))
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(year, month, d))
  }
  // Leading days of next month (fill to 42 = 6 rows)
  let next = 1
  while (days.length < 42) {
    days.push(new Date(year, month + 1, next++))
  }
  return days
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TODAY_KEY = dateKey(new Date())

export default function CalendarPage() {
  usePageTitle('Calendar')
  const companyId = useAuthStore(s => s.companyId)
  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [viewDate, setViewDate] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [selectedKey, setSelectedKey] = useState<string>(TODAY_KEY)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const eventMap = useMemo(() => buildEventMap(all), [all])

  const days = useMemo(
    () => getCalendarDays(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate],
  )

  const selectedEvents = eventMap.get(selectedKey) ?? []
  const curMonth       = viewDate.getMonth()
  const monthLabel     = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  function prevMonth() { setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)) }
  function nextMonth() { setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)) }
  function goToday()   {
    const n = new Date()
    setViewDate(new Date(n.getFullYear(), n.getMonth(), 1))
    setSelectedKey(TODAY_KEY)
  }

  const selectedLabel = (() => {
    const d = new Date(selectedKey + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  })()

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-white">Calendar</h1>
        <div className="flex items-center gap-1.5">
          <button onClick={goToday} className="btn-secondary text-sm px-3 py-1.5">Today</button>
          <button onClick={prevMonth} className="btn-secondary text-sm px-2.5 py-1.5 font-bold">‹</button>
          <span className="text-sm font-medium text-gray-300 w-32 text-center">{monthLabel}</span>
          <button onClick={nextMonth} className="btn-secondary text-sm px-2.5 py-1.5 font-bold">›</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {(Object.entries(EVENT_CONFIG) as [EventType, (typeof EVENT_CONFIG)[EventType]][]).map(([type, cfg]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
            <span className="text-xs text-gray-400">{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="card overflow-hidden select-none">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-gray-700/50">
          {WEEKDAYS.map(w => (
            <div key={w} className="py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              {w}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key            = dateKey(day)
            const inMonth        = day.getMonth() === curMonth
            const isToday        = key === TODAY_KEY
            const isSelected     = key === selectedKey
            const events         = eventMap.get(key) ?? []
            const visibleDots    = events.slice(0, 3)
            const overflowCount  = events.length - visibleDots.length
            const isLastInRow    = i % 7 === 6

            return (
              <button
                key={i}
                onClick={() => setSelectedKey(key)}
                className={[
                  'relative flex flex-col items-start p-1.5 min-h-[60px] border-b border-gray-800/40 text-left transition-colors',
                  !isLastInRow ? 'border-r' : '',
                  isSelected ? 'bg-indigo-600/15' : 'hover:bg-gray-800/40',
                ].join(' ')}
              >
                {/* Day number */}
                <span className={[
                  'inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full mb-1 shrink-0',
                  isToday    ? 'bg-indigo-500 text-white' :
                  isSelected ? 'bg-gray-600 text-white'   :
                  inMonth    ? 'text-gray-200'             : 'text-gray-600',
                ].join(' ')}>
                  {day.getDate()}
                </span>

                {/* Event dots */}
                {visibleDots.length > 0 && (
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {visibleDots.map((e, ei) => (
                      <span key={ei} className={`w-1.5 h-1.5 rounded-full shrink-0 ${EVENT_CONFIG[e.type].dot}`} />
                    ))}
                    {overflowCount > 0 && (
                      <span className="text-[9px] text-gray-500 leading-none">+{overflowCount}</span>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected day event list */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <p className="section-header mb-0">{selectedLabel}</p>
          {selectedEvents.length > 0 && (
            <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-gray-700">
              {selectedEvents.length}
            </span>
          )}
        </div>
        <div className="card divide-y divide-gray-700/50">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-gray-400 text-sm">
              <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          ) : selectedEvents.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-500">No events on this day</p>
          ) : (
            selectedEvents.map(e => {
              const cfg = EVENT_CONFIG[e.type]
              return (
                <Link
                  key={e.key}
                  to={`/records/${e.customerId}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-100 truncate">{e.name}</p>
                    <p className={`text-xs mt-0.5 ${cfg.color}`}>{cfg.label}</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
