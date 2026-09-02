import {
    collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
    onSnapshot, query, where, limit, Timestamp, serverTimestamp,
    type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId, getCurrentUserLabel } from '../stores/authStore'
import {
    assignmentFromDoc, assignmentToFirestore, computeJobSpan,
    type DispatchAssignment, type DispatchStatus,
} from '../models/dispatchAssignment'
import { getServiceRequest, updateServiceRequestStatus } from './serviceRequestService'

const COL = 'dispatchAssignments'

// Safety cap for the real-time listener — same reasoning as customerService's
// REALTIME_LIMIT.
export const DISPATCH_REALTIME_LIMIT = 5_000

export function subscribeToAssignments(
    weekStart: Date,
    weekEnd: Date,
    onData: (items: DispatchAssignment[], hitCap: boolean) => void,
    onError: (err: Error) => void,
): Unsubscribe {
    const companyId = getCompanyId()
    if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
    return onSnapshot(
        query(
            collection(db, COL),
            where('companyId', '==', companyId),
            where('startAt', '<', Timestamp.fromDate(weekEnd)),
            limit(DISPATCH_REALTIME_LIMIT),
        ),
        snap => {
            const hitCap = snap.size === DISPATCH_REALTIME_LIMIT
            if (hitCap) {
                console.warn(`[subscribeToAssignments] hit ${DISPATCH_REALTIME_LIMIT}-document cap for company ${companyId}.`)
            }
            const items: DispatchAssignment[] = []
            for (const d of snap.docs) {
                try {
                    const a = assignmentFromDoc(d.id, d.data())
                    // Firestore only filters startAt < weekEnd server-side (no
                    // composite range on two fields without a second index);
                    // multi-day assignments that end within the week but
                    // started before it are caught here instead.
                    if (a.endAt >= weekStart) items.push(a)
                } catch { /* skip malformed doc */ }
            }
            onData(items, hitCap)
        },
        onError,
    )
}

export interface CreateAssignmentInput {
    sourceType: DispatchAssignment['sourceType']
    sourceId: string
    customerId: string
    customerName: string
    title: string
    assignedToUid: string
    assignedToName: string
    startAt: Date
    endAt: Date
    notes?: string
}

export async function createAssignment(input: CreateAssignmentInput): Promise<string> {
    const companyId = getCompanyId()
    if (!companyId) throw new Error('Not authenticated')

    const ref = await addDoc(collection(db, COL), {
        ...assignmentToFirestore({
            companyId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            customerId: input.customerId,
            customerName: input.customerName,
            title: input.title,
            assignedToUid: input.assignedToUid,
            assignedToName: input.assignedToName,
            startAt: input.startAt,
            endAt: input.endAt,
            status: 'scheduled',
            notes: input.notes ?? '',
            createdByName: getCurrentUserLabel().name,
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    })

    if (input.sourceType === 'job') await syncJobSpanFromAssignments(input.customerId)
    if (input.sourceType === 'serviceRequest') {
        // Fetch the real record rather than faking one — updateServiceRequestStatus
        // only sets firstContactedAt/resolvedAt when they're not already set, and
        // a synthetic stub with those fields undefined would always look "unset"
        // and stomp a real audit timestamp that was already there.
        const request = await getServiceRequest(input.sourceId)
        if (request) await updateServiceRequestStatus(request, 'scheduled').catch(() => {})
    }
    // servicePlan visits deliberately do NOT advance ServicePlan.nextDate here
    // — that stays owned by completion, not scheduling, so a cancelled visit
    // doesn't silently skip a cycle.

    return ref.id
}

export async function moveAssignment(
    id: string,
    fields: { assignedToUid?: string; assignedToName?: string; startAt?: Date; endAt?: Date },
    customerId: string,
    sourceType: DispatchAssignment['sourceType'],
): Promise<void> {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (fields.assignedToUid  !== undefined) updates.assignedToUid  = fields.assignedToUid
    if (fields.assignedToName !== undefined) updates.assignedToName = fields.assignedToName
    if (fields.startAt        !== undefined) updates.startAt        = Timestamp.fromDate(fields.startAt)
    if (fields.endAt          !== undefined) updates.endAt          = Timestamp.fromDate(fields.endAt)
    await updateDoc(doc(db, COL, id), updates)

    if (sourceType === 'job' && (fields.startAt !== undefined || fields.endAt !== undefined)) {
        await syncJobSpanFromAssignments(customerId)
    }
}

export async function updateAssignmentStatus(id: string, status: DispatchStatus): Promise<void> {
    await updateDoc(doc(db, COL, id), { status, updatedAt: serverTimestamp() })
}

export async function deleteAssignment(
    id: string,
    customerId: string,
    sourceType: DispatchAssignment['sourceType'],
): Promise<void> {
    await deleteDoc(doc(db, COL, id))
    if (sourceType === 'job') await syncJobSpanFromAssignments(customerId)
}

// Recomputes a job's overall span (min startAt / max endAt across all its
// dispatchAssignments) and mirrors it onto Customers.start/completion — this
// is what keeps JobsPage/CalendarPage/forecast correct without touching any
// of them. Deliberately one-directional: dispatchAssignments is the source
// of truth. Clears both fields back to null when the job has no assignments
// left (e.g. its last one was just deleted).
export async function syncJobSpanFromAssignments(customerId: string): Promise<void> {
    const companyId = getCompanyId()
    if (!companyId || !customerId) return

    const snap = await getDocs(query(
        collection(db, COL),
        where('companyId', '==', companyId),
        where('customerId', '==', customerId),
        where('sourceType', '==', 'job'),
    ))
    const assignments = snap.docs.map(d => assignmentFromDoc(d.id, d.data()))
    const { start, end } = computeJobSpan(assignments)

    await updateDoc(doc(db, 'Customers', customerId), {
        start: start ? Timestamp.fromDate(start) : null,
        completion: end ? Timestamp.fromDate(end) : null,
    })
}
