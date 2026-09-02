import { Timestamp, type DocumentData } from 'firebase/firestore'

export type DispatchSourceType = 'job' | 'serviceRequest' | 'servicePlan'
export type DispatchStatus = 'scheduled' | 'in_progress' | 'done' | 'cancelled'

export interface DispatchAssignment {
    id: string
    companyId: string
    sourceType: DispatchSourceType
    sourceId: string
    customerId: string
    customerName: string
    title: string
    assignedToUid: string
    assignedToName: string
    startAt: Date
    endAt: Date
    status: DispatchStatus
    notes: string
    createdAt: Date
    updatedAt: Date
    createdByName: string
}

export function emptyAssignment(): Omit<DispatchAssignment, 'id' | 'createdAt' | 'updatedAt'> {
    const now = new Date()
    return {
        companyId: '',
        sourceType: 'job',
        sourceId: '',
        customerId: '',
        customerName: '',
        title: '',
        assignedToUid: '',
        assignedToName: '',
        startAt: now,
        endAt: now,
        status: 'scheduled',
        notes: '',
        createdByName: '',
    }
}

function toDate(v: unknown): Date {
    if (v instanceof Timestamp) return v.toDate()
    return new Date()
}

export function assignmentFromDoc(id: string, data: DocumentData): DispatchAssignment {
    return {
        id,
        companyId: String(data.companyId ?? ''),
        sourceType: (data.sourceType as DispatchSourceType) ?? 'job',
        sourceId: String(data.sourceId ?? ''),
        customerId: String(data.customerId ?? ''),
        customerName: String(data.customerName ?? ''),
        title: String(data.title ?? ''),
        assignedToUid: String(data.assignedToUid ?? ''),
        assignedToName: String(data.assignedToName ?? ''),
        startAt: toDate(data.startAt),
        endAt: toDate(data.endAt),
        status: (data.status as DispatchStatus) ?? 'scheduled',
        notes: String(data.notes ?? ''),
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
        createdByName: String(data.createdByName ?? ''),
    }
}

export function assignmentToFirestore(
    a: Omit<DispatchAssignment, 'id' | 'createdAt' | 'updatedAt'>,
): Record<string, unknown> {
    return {
        companyId: a.companyId,
        sourceType: a.sourceType,
        sourceId: a.sourceId,
        customerId: a.customerId,
        customerName: a.customerName,
        title: a.title,
        assignedToUid: a.assignedToUid,
        assignedToName: a.assignedToName,
        startAt: Timestamp.fromDate(a.startAt),
        endAt: Timestamp.fromDate(a.endAt),
        status: a.status,
        notes: a.notes,
        createdByName: a.createdByName,
    }
}

// ─── Pure week-layout helpers ──────────────────────────────────────────────
// Sunday-first, matching the WEEKDAYS convention already used in CalendarPage.

const DAY_MS = 86_400_000

function atMidnight(d: Date): Date {
    const out = new Date(d)
    out.setHours(0, 0, 0, 0)
    return out
}

/** The Sunday that starts the week containing `date`, at local midnight. */
export function getWeekStart(date: Date): Date {
    const d = atMidnight(date)
    d.setDate(d.getDate() - d.getDay())
    return d
}

/** The 7 local-midnight dates (Sun..Sat) of the week starting at `weekStart`. */
export function getWeekDays(weekStart: Date): Date[] {
    const start = atMidnight(weekStart)
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start)
        d.setDate(d.getDate() + i)
        return d
    })
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * Which column (0=Sun..6=Sat) an assignment's start day falls into within the
 * given week, or -1 if its start day is outside that week entirely. Used to
 * bucket assignments into day columns on the board.
 */
export function dayIndexInWeek(date: Date, weekStart: Date): number {
    const start = atMidnight(weekStart)
    const target = atMidnight(date)
    const diffDays = Math.round((target.getTime() - start.getTime()) / DAY_MS)
    return diffDays >= 0 && diffDays < 7 ? diffDays : -1
}

/**
 * Clips a (possibly multi-day) assignment span to the 7-day window
 * [weekStart, weekStart+7d). Returns null if the span doesn't overlap the
 * week at all — e.g. a job that started three weeks ago and is still open.
 */
export function clipSpanToWeek(
    startAt: Date, endAt: Date, weekStart: Date,
): { start: Date; end: Date } | null {
    const winStart = atMidnight(weekStart)
    const winEnd = new Date(winStart.getTime() + 7 * DAY_MS)
    const start = startAt < winStart ? winStart : startAt
    const end = endAt > winEnd ? winEnd : endAt
    if (start >= end && !sameDay(startAt, endAt)) return null
    if (start > winEnd || end < winStart) return null
    return { start, end }
}

/**
 * A job's overall span is the min start / max end across all its
 * assignments — this is what gets mirrored onto Customers.start/completion.
 * Returns nulls when the list is empty, which is the deliberate signal to
 * clear those fields back to null when a job's last assignment is deleted.
 */
export function computeJobSpan(
    assignments: { startAt: Date; endAt: Date }[],
): { start: Date | null; end: Date | null } {
    if (assignments.length === 0) return { start: null, end: null }
    let start = assignments[0].startAt
    let end = assignments[0].endAt
    for (const a of assignments) {
        if (a.startAt < start) start = a.startAt
        if (a.endAt > end) end = a.endAt
    }
    return { start, end }
}
