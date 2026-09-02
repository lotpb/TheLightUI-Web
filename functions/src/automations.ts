// The if/then automation engine, its per-collection triggers, and follow-up
// sequence processing.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db, auth } from './common'
import { sendTwilioSms, sendAutomationEmail, smsOptOutDocId } from './outbound'
import { notifyCompany, dispatchWebhooks } from './webhookDispatch'

// ── Sequence runner ────────────────────────────────────────────────────────────
// Runs daily at 9 AM ET. For each active enrollment whose nextRunAt has passed,
// executes the current step (add note or set follow-up), then advances or completes.
// DISABLED 2026-08-28 (unused feature, removed to avoid an idle Cloud Scheduler job
// while on Blaze). Uncomment and redeploy with `firebase deploy --only functions:runSequences`
// to re-enable.
/*
export const runSequences = functions.pubsub
  .schedule('0 9 * * *').timeZone('America/New_York')
  .onRun(async () => {
    const now = Timestamp.now()

    const enrollmentsSnap = await db.collection('sequenceEnrollments')
      .where('status', '==', 'active')
      .where('nextRunAt', '<=', now)
      .get()

    if (enrollmentsSnap.empty) return null

    for (const enrollDoc of enrollmentsSnap.docs) {
      try {
        const enr = enrollDoc.data()
        const seqSnap = await db.collection('sequences').doc(enr.sequenceId as string).get()
        if (!seqSnap.exists) { await enrollDoc.ref.update({ status: 'cancelled' }); continue }

        const steps = (seqSnap.data()!.steps ?? []) as Array<{ delayDays: number; action: string; message: string }>
        const stepIdx = (enr.nextStepIdx as number) ?? 0

        if (stepIdx >= steps.length) {
          await enrollDoc.ref.update({ status: 'completed' }); continue
        }

        const step = steps[stepIdx]
        const customerId = enr.customerId as string
        const startedAt  = (enr.startedAt as Timestamp).toDate()

        // Execute step
        if (step.action === 'note') {
          const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          const noteEntry = `--- [${dateStr}] ---\n[Sequence: ${seqSnap.data()!.name}] ${step.message}`
          const customerDoc = await db.collection('Customers').doc(customerId).get()
          if (customerDoc.exists) {
            const existing = (customerDoc.data()!.comments as string) ?? ''
            const merged = existing.trim() ? `${noteEntry}\n\n${existing}` : noteEntry
            await db.collection('Customers').doc(customerId).update({ comments: merged, lastUpdate: Timestamp.now() })
          }
        } else if (step.action === 'followup') {
          await db.collection('Customers').doc(customerId).update({
            followUpDate: Timestamp.now(),
            lastUpdate:   Timestamp.now(),
          })
        }

        // Advance
        const completedStepIndices = [...((enr.completedStepIndices as number[]) ?? []), stepIdx]
        const nextIdx = stepIdx + 1

        if (nextIdx >= steps.length) {
          await enrollDoc.ref.update({ status: 'completed', completedStepIndices, nextStepIdx: nextIdx })
        } else {
          const nextStep = steps[nextIdx]
          const nextRunAt = new Date(startedAt.getTime() + nextStep.delayDays * 86_400_000)
          await enrollDoc.ref.update({
            nextStepIdx: nextIdx,
            nextRunAt:   Timestamp.fromDate(nextRunAt),
            completedStepIndices,
          })
        }
      } catch (err) {
        console.error('runSequences error for enrollment', enrollDoc.id, err)
      }
    }
    return null
  })
*/

// ── Automation Rules engine ─────────────────────────────────────────────────────
// If/Then triggers authored in the `automationRules` collection. When a watched
// field changes (optionally to a specific value) on a Customer, Invoice,
// Service Request, Purchase Order, or Signing Request document, runs the
// rule's actions: set another field, add a note, set a follow-up date, or
// send an email. Service Requests / Purchase Orders / Signing Requests don't
// carry their own comments/followUpDate/email, so their actions resolve to
// the Customer record they're linked to. Fires are recorded in `automationLog`.

type AutomationEntityType = 'customer' | 'invoice' | 'serviceRequest' | 'purchaseOrder' | 'signingRequest'

interface AutomationTrigger {
  entityType: AutomationEntityType
  field: string
  type: 'changes_to' | 'any_change'
  value: string
}

interface AutomationAction {
  type: 'set_field' | 'add_note' | 'set_followup_days' | 'send_email' | 'send_sms'
  field?: string
  value?: string
  text?: string
  days?: number
  subject?: string
  body?: string
}

interface AutomationRuleDoc {
  companyId: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  actions: AutomationAction[]
}

// Entity types whose actions resolve to a linked Customer record rather than
// the triggering document itself.
const CUSTOMER_LINKED_TYPES = new Set<AutomationEntityType>(['serviceRequest', 'purchaseOrder', 'signingRequest'])

// Fields an automation is allowed to read a trigger from. Kept server-side
// (not client-supplied) so a rule document can never target arbitrary fields.
const AUTOMATION_TRIGGER_FIELD_ALLOW: Record<AutomationEntityType, string[]> = {
  customer:       ['category', 'leadStatus', 'employeeStatus', 'paymentStatus', 'salesman', 'callback'],
  invoice:        ['status'],
  serviceRequest: ['status'],
  purchaseOrder:  ['status'],
  signingRequest: ['status'],
}

// Fields a set_field action may write. Customer-linked source types always
// write Customer fields, since that's the document actually being updated.
function resolveActionFieldAllow(entityType: AutomationEntityType): string[] {
  return (entityType === 'customer' || CUSTOMER_LINKED_TYPES.has(entityType))
    ? AUTOMATION_TRIGGER_FIELD_ALLOW.customer
    : AUTOMATION_TRIGGER_FIELD_ALLOW.invoice
}

// Resolves which Customer record a customer-linked source document's actions
// should apply to. Service/Signing Requests carry customerId directly; a
// Purchase Order links to a job (jobId) or, failing that, its vendor.
function resolveTargetCustomerId(entityType: AutomationEntityType, after: Record<string, unknown>): string {
  if (entityType === 'purchaseOrder') return String(after['jobId'] || after['vendorId'] || '')
  return String(after['customerId'] ?? '')
}

function computeEntityLabel(
  entityType: AutomationEntityType, entityId: string, after: Record<string, unknown>, first: string, lastname: string,
): string {
  if (entityType === 'customer')       return [first, lastname].filter(Boolean).join(' ') || entityId
  if (entityType === 'invoice')        return String(after['invoiceNumber'] ?? entityId)
  if (entityType === 'purchaseOrder')  return String(after['poNumber'] ?? entityId)
  if (entityType === 'serviceRequest') return String(after['name'] ?? entityId)
  const doc = after['document'] as Record<string, unknown> | undefined // signingRequest
  return String(doc?.['customerName'] ?? entityId)
}

function automationMerge(s: string, ctx: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, key) => ctx[key.toLowerCase()] ?? m)
}
// Mirrors sendAutomationEmail above but for send_sms actions. Respects the
// smsOptOuts registry the same way the sendSms callable does — an automation
// firing is not a reason to text someone who's texted STOP — and logs to
// smsMessages so the sent text shows up in that customer's thread like any
// other outbound message.
async function sendAutomationSms(
  accountSid: string, authToken: string, companyId: string, customerId: string,
  fromNumber: string, toNumber: string, body: string,
): Promise<void> {
  if (!toNumber.trim() || !body.trim()) return

  const optOutSnap = await db.collection('smsOptOuts').doc(smsOptOutDocId(companyId, toNumber)).get()
  if (optOutSnap.exists) {
    console.log(`Automation SMS to ${toNumber} skipped — opted out`)
    return
  }

  const result = await sendTwilioSms(accountSid, authToken, fromNumber, toNumber, body)
  await db.collection('smsMessages').add({
    companyId, customerId,
    direction: 'outbound',
    fromNumber, toNumber, body,
    status: 'error' in result ? 'failed' : 'sent',
    errorMessage: 'error' in result ? result.error : '',
    twilioSid: 'sid' in result ? result.sid : '',
    createdAt: FieldValue.serverTimestamp(),
    read: true,
  })
  if ('error' in result) {
    console.error(`Automation SMS to ${toNumber} failed:`, result.error)
  }
}

async function runAutomationsFor(
  entityType: AutomationEntityType,
  collectionName: string,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  const companyId = after['companyId'] as string | undefined
  if (!companyId) return

  const rulesSnap = await db.collection('automationRules')
    .where('companyId', '==', companyId)
    .where('enabled', '==', true)
    .get()

  if (rulesSnap.empty) return

  const triggerAllowedFields = new Set(AUTOMATION_TRIGGER_FIELD_ALLOW[entityType])
  const actionAllowedFields  = new Set(resolveActionFieldAllow(entityType))
  const apiKey     = process.env.RESEND_API_KEY
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  const isCustomerLinked = entityType === 'customer' || CUSTOMER_LINKED_TYPES.has(entityType)

  // One read for the whole call (not per-rule): reviewlink feeds the
  // {reviewlink} merge tag and fromNumber is required for any send_sms action.
  const profileSnap  = await db.collection('companies').doc(companyId).collection('settings').doc('profile').get()
  const reviewLink   = String(profileSnap.data()?.['reviewLink'] ?? '')
  const smsFromNumber = String(profileSnap.data()?.['smsNumber']  ?? '')

  for (const ruleDoc of rulesSnap.docs) {
    const rule = ruleDoc.data() as AutomationRuleDoc
    const trigger = rule.trigger
    if (!trigger || trigger.entityType !== entityType || !triggerAllowedFields.has(trigger.field)) continue

    const beforeVal = String(before[trigger.field] ?? '')
    const afterVal  = String(after[trigger.field]  ?? '')
    if (beforeVal === afterVal) continue // trigger field didn't change on this write

    const fired = trigger.type === 'any_change' ? true : afterVal === trigger.value
    if (!fired) continue

    // Resolve the document actions actually write to: the triggering doc
    // itself for customer/invoice, or its linked Customer for the other types.
    let targetCollection = collectionName
    let targetId = entityId
    let targetData = after
    if (CUSTOMER_LINKED_TYPES.has(entityType)) {
      const custId = resolveTargetCustomerId(entityType, after)
      if (!custId) continue
      const custSnap = await db.collection('Customers').doc(custId).get()
      if (!custSnap.exists) continue
      targetCollection = 'Customers'
      targetId = custId
      targetData = custSnap.data() ?? {}
    }

    const updates: Record<string, unknown> = {}
    const summaries: string[] = []

    const first    = String(targetData['first']    ?? '')
    const lastname = String(targetData['lastname'] ?? '')
    const email    = String(targetData['email'] ?? targetData['customerEmail'] ?? '')
    const phone    = String(targetData['phone'] ?? targetData['customerPhone'] ?? '')
    const mergeCtx: Record<string, string> = {
      first, lastname,
      city:       String(targetData['city']     ?? ''),
      salesman:   String(targetData['salesman'] ?? ''),
      reviewlink: reviewLink,
    }

    for (const action of rule.actions ?? []) {
      try {
        if (action.type === 'set_field' && action.field
            && !(action.field === trigger.field && targetCollection === collectionName)
            && actionAllowedFields.has(action.field)) {
          updates[action.field] = action.value ?? ''
          summaries.push(`set ${action.field}="${action.value ?? ''}"`)
        } else if (action.type === 'add_note' && isCustomerLinked) {
          const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          const noteEntry = `--- [${dateStr}] ---\n[Automation: ${rule.name}] ${action.text ?? ''}`
          const existing = String(targetData['comments'] ?? '')
          updates['comments'] = existing.trim() ? `${noteEntry}\n\n${existing}` : noteEntry
          summaries.push('added note')
        } else if (action.type === 'set_followup_days' && isCustomerLinked) {
          const due = new Date()
          due.setDate(due.getDate() + (action.days ?? 0))
          updates['followUpDate'] = Timestamp.fromDate(due)
          summaries.push(`follow-up in ${action.days ?? 0}d`)
        } else if (action.type === 'send_email' && apiKey && email) {
          await sendAutomationEmail(
            apiKey,
            companyId,
            targetId,
            email,
            automationMerge(action.subject ?? '', mergeCtx),
            automationMerge(action.body    ?? '', mergeCtx),
          )
          summaries.push(`emailed ${email}`)
        } else if (action.type === 'send_sms' && accountSid && authToken && smsFromNumber && phone) {
          await sendAutomationSms(
            accountSid,
            authToken,
            companyId,
            targetId,
            smsFromNumber,
            phone,
            automationMerge(action.text ?? '', mergeCtx),
          )
          summaries.push(`texted ${phone}`)
        }
      } catch (err) {
        console.error(`Automation action failed for rule ${ruleDoc.id}:`, err)
      }
    }

    if (Object.keys(updates).length > 0) {
      updates['lastUpdate'] = Timestamp.now()
      updates['lastEditedByName'] = `Automation: ${rule.name}`
      await db.collection(targetCollection).doc(targetId).update(updates)
    }

    await ruleDoc.ref.update({
      runCount:  FieldValue.increment(1),
      lastRunAt: FieldValue.serverTimestamp(),
    })

    await db.collection('automationLog').add({
      companyId,
      ruleId:   ruleDoc.id,
      ruleName: rule.name,
      entityType,
      entityId,
      entityLabel: computeEntityLabel(entityType, entityId, after, first, lastname),
      actionsSummary: summaries.join('; ') || 'no matching actions',
      ranAt: FieldValue.serverTimestamp(),
    })
  }
}

export const onCustomerAutomation = functions
  .runWith({ secrets: ['RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] })
  .firestore.document('Customers/{id}')
  .onUpdate(async (change, context) => {
    const id = context.params.id as string
    await runAutomationsFor('customer', 'Customers', id, change.before.data() ?? {}, change.after.data() ?? {})
    return null
  })

export const onInvoiceAutomation = functions
  .runWith({ secrets: ['RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] })
  .firestore.document('Invoices/{id}')
  .onUpdate(async (change, context) => {
    const id = context.params.id as string
    await runAutomationsFor('invoice', 'Invoices', id, change.before.data() ?? {}, change.after.data() ?? {})
    return null
  })

export const onServiceRequestAutomation = functions
  .runWith({ secrets: ['RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] })
  .firestore.document('serviceRequests/{id}')
  .onUpdate(async (change, context) => {
    const id = context.params.id as string
    await runAutomationsFor('serviceRequest', 'serviceRequests', id, change.before.data() ?? {}, change.after.data() ?? {})
    return null
  })

export const onServiceRequestCreated = functions.firestore
  .document('serviceRequests/{id}')
  .onCreate(async (snap, context) => {
    const id = context.params.id as string
    const data = snap.data() ?? {}
    const companyId = String(data['companyId'] ?? '')
    if (!companyId) return null
    await dispatchWebhooks(companyId, 'serviceRequest.created', {
      id, name: data['name'] ?? '', description: data['description'] ?? '', customerId: data['customerId'] ?? '',
    })
    await notifyCompany(
      companyId, 'serviceRequest.created',
      'New Service Request', String(data['name'] ?? 'A customer') + ' submitted a request', '/service-requests',
    )
    return null
  })

// ── Portal day availability ─────────────────────────────────────────────────
// Callable, no authentication required — this is reached by an anonymous
// customer-portal visitor picking a preferred day on the service-request
// form, same trust tier as createStripeCheckout. Computed live from
// dispatchAssignments on every call rather than a denormalized public
// snapshot (the pattern used by publicInvoices/publicProposals/
// customerPortals): a per-day visit count changes on every dispatch
// create/move/delete/cancel, and keeping a cached counter in sync across all
// of those paths risks silent drift (e.g. missing the cancellation case would
// leave a day stuck "full" forever). Recomputing avoids that entirely.
//
// Returns counts and a full/not-full flag only — never assignment, customer,
// or tech details — so no auth beyond a valid portal token is needed.
export const getPortalDayAvailability = functions
  .https.onCall(async (data, _context) => {
    const { token, startDate, endDate } = data as { token: string; startDate: string; endDate: string }
    if (!token || !startDate || !endDate) {
      throw new functions.https.HttpsError('invalid-argument', 'token, startDate, and endDate are required')
    }

    // A stale/invalid portal link shouldn't hard-fail the request form —
    // just report nothing, which the client treats as "no data yet, show
    // every day as open" rather than an error.
    const portalSnap = await db.collection('customerPortals').doc(token).get()
    const companyId = String(portalSnap.data()?.['companyId'] ?? '')
    if (!companyId) return { availability: {} }

    const profileSnap = await db.collection('companies').doc(companyId).collection('settings').doc('profile').get()
    const maxPerDay = Number(profileSnap.data()?.['maxVisitsPerDay']) || 0

    // Firestore only allows one field with a range/inequality filter per
    // query, so status !=  'cancelled' is applied client-side below rather
    // than combined with the startAt range in the query itself.
    const snap = await db.collection('dispatchAssignments')
      .where('companyId', '==', companyId)
      .where('startAt', '>=', Timestamp.fromDate(new Date(`${startDate}T00:00:00`)))
      .where('startAt', '<', Timestamp.fromDate(new Date(`${endDate}T00:00:00`)))
      .get()

    // toISOString() is UTC and would misfile a visit near midnight into the
    // wrong calendar day — this app has no per-company timezone field, so
    // America/New_York is used as the implicit local day boundary, matching
    // the one other place in this file that's timezone-explicit
    // (warrantyExpirationReminders' schedule).
    const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }) // en-CA -> YYYY-MM-DD
    const counts: Record<string, number> = {}
    for (const doc of snap.docs) {
      const d = doc.data()
      if (d['status'] === 'cancelled') continue
      const startAt = (d['startAt'] as Timestamp | undefined)?.toDate()
      if (!startAt) continue
      const dateStr = dayFormatter.format(startAt)
      counts[dateStr] = (counts[dateStr] ?? 0) + 1
    }

    const availability: Record<string, { count: number; full: boolean }> = {}
    for (const [dateStr, count] of Object.entries(counts)) {
      availability[dateStr] = { count, full: maxPerDay > 0 && count >= maxPerDay }
    }

    return { availability }
  })

export const onPurchaseOrderAutomation = functions
  .runWith({ secrets: ['RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] })
  .firestore.document('purchaseOrders/{id}')
  .onUpdate(async (change, context) => {
    const id = context.params.id as string
    const before = change.before.data() ?? {}
    const after  = change.after.data()  ?? {}
    await runAutomationsFor('purchaseOrder', 'purchaseOrders', id, before, after)

    const companyId = String(after['companyId'] ?? '')
    if (companyId && before['status'] !== 'received' && after['status'] === 'received') {
      await dispatchWebhooks(companyId, 'purchaseOrder.received', {
        id, poNumber: after['poNumber'] ?? '', vendorId: after['vendorId'] ?? '', vendorName: after['vendorName'] ?? '',
      })
      await notifyCompany(
        companyId, 'purchaseOrder.received',
        'Purchase Order Received', `${after['poNumber'] ?? ''} from ${after['vendorName'] ?? 'vendor'}`, '/purchase-orders',
      )
    }
    return null
  })

export const onSigningRequestAutomation = functions
  .runWith({ secrets: ['RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] })
  .firestore.document('signingRequests/{id}')
  .onUpdate(async (change, context) => {
    const id = context.params.id as string
    const before = change.before.data() ?? {}
    const after  = change.after.data()  ?? {}
    await runAutomationsFor('signingRequest', 'signingRequests', id, before, after)

    const companyId = String(after['companyId'] ?? '')
    if (companyId && before['status'] !== 'signed' && after['status'] === 'signed') {
      const doc = after['document'] as Record<string, unknown> | undefined
      await dispatchWebhooks(companyId, 'signingRequest.signed', {
        id, customerId: after['customerId'] ?? '', customerName: doc?.['customerName'] ?? '', signerName: after['signerName'] ?? '',
      })
      await notifyCompany(
        companyId, 'signingRequest.signed',
        'Document Signed', `${doc?.['customerName'] ?? after['signerName'] ?? 'A customer'} signed a document`, '/signing-requests',
      )
    }
    return null
  })
