/**
 * Shared day arithmetic for task due dates.
 *
 * Due dates are day-granular and every write path lands them on UTC midnight
 * (`new Date('2026-09-12')` from a date input, `safeDate` in the CSV import),
 * so the day the user picked only survives if it's read back in UTC. A bare
 * toLocaleDateString() renders the day before for anyone west of UTC.
 *
 * This lives here rather than in a page because /todo and /dashboard both need
 * to answer "is this overdue?" and they have to agree. Two surfaces computing
 * the same thing two ways is how the customer health badge ended up saying
 * "Good" on one screen and "At Risk" on the next.
 */

/** Whole-day index for a date, read in UTC. */
export function dayIndexUTC(d: Date): number {
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000)
}

/** Today as the same kind of index, from the viewer's local calendar day. */
export function todayIndexLocal(): number {
    const now = new Date()
    return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000)
}

/** Whole days from today until `due`. Negative means overdue, 0 means today. */
export function daysUntilDue(due: Date): number {
    return dayIndexUTC(due) - todayIndexLocal()
}

/** True when the due date fell before today. Today itself is not overdue. */
export function isOverdue(due: Date): boolean {
    return daysUntilDue(due) < 0
}

/** Formats a due date in the timezone it was written in, so it doesn't shift. */
export function fmtDue(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export type DueStatus = 'overdue' | 'today' | 'tomorrow' | 'later' | 'done'

/**
 * Due-date urgency: red + medium weight once late, amber inside the next day,
 * plain gray beyond that. A completed task is never urgent no matter how late
 * it was.
 *
 * Shared so /todo and /dashboard render the same task's due date identically.
 * The dashboard previously printed a flat indigo date built from a bare
 * toLocaleDateString(), which both dropped the urgency and displayed the day
 * before for anyone west of UTC.
 */
export function dueMeta(due: Date, isCompleted: boolean): { status: DueStatus; label: string; cls: string } {
    if (isCompleted) return { status: 'done', label: `Due ${fmtDue(due)}`, cls: 'text-gray-400' }

    const days = daysUntilDue(due)
    if (days < 0) {
        const late = -days
        return {
            status: 'overdue',
            label: `Due ${fmtDue(due)} · ${late} day${late === 1 ? '' : 's'} overdue`,
            cls: 'text-red-400 font-medium',
        }
    }
    if (days === 0) return { status: 'today', label: 'Due today', cls: 'text-amber-400 font-medium' }
    if (days === 1) return { status: 'tomorrow', label: 'Due tomorrow', cls: 'text-amber-400' }
    return { status: 'later', label: `Due ${fmtDue(due)}`, cls: 'text-gray-400' }
}
