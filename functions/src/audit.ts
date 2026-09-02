// Change-history triggers and the proposal-response mirror.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from './common'
import { INBOUND_REPLY_DOMAIN } from './outbound'
import { notifyCompany, dispatchWebhooks } from './webhookDispatch'

// ── Audit Log ────────────────────────────────────────────────────────────────────
// Records who changed what on Customers/Invoices: creation, field-level updates
// (diffed before vs after), and deletion. Attribution comes from createdByName /
// lastEditedByName, which client writes stamp with the signed-in user's name and
// the automation engine stamps with "Automation: <rule name>".

const AUDIT_IGNORE_FIELDS = new Set([
  'lastUpdate', 'updatedAt', 'createdAt', 'lastEditedByName', 'createdByName',
  'lastReminderSentAt', 'companyId',
  // Redundant with the 'salesman' diff (same assignment, human-readable name) —
  // showing the raw Firebase uid alongside it would just be noise.
  'assignedToUid',
])

function auditValueLabel(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Timestamp) return v.toDate().toLocaleDateString('en-US')
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80)
  return String(v).slice(0, 120)
}

async function auditDiff(
  entityType: 'customer' | 'invoice' | 'proposal',
  entityId: string,
  entityLabel: (d: Record<string, unknown>) => string,
  beforeExists: boolean, before: Record<string, unknown>,
  afterExists: boolean, after: Record<string, unknown>,
): Promise<void> {
  if (!beforeExists && afterExists) {
    const companyId = String(after['companyId'] ?? '')
    if (!companyId) return
    const changedBy = String(after['createdByName'] ?? after['lastEditedByName'] ?? 'Unknown')
    await db.collection('auditLog').add({
      companyId, entityType, entityId,
      entityLabel: entityLabel(after),
      action: 'created', changedBy, changes: [],
      createdAt: FieldValue.serverTimestamp(),
    })
    if (entityType === 'customer') {
      await dispatchWebhooks(companyId, 'customer.created', { id: entityId, name: entityLabel(after), category: after['category'] ?? '' })
      // No in-app notification here — bulk CSV/JSON imports create many Customer
      // docs at once and would flood the bell with one entry per record.
    } else if (entityType === 'invoice') {
      await dispatchWebhooks(companyId, 'invoice.created', { id: entityId, invoiceNumber: entityLabel(after), customerId: after['customerId'] ?? '' })
      await notifyCompany(companyId, 'invoice.created', 'Invoice Created', entityLabel(after), `/invoices/${entityId}`)
    } else if (entityType === 'proposal') {
      await dispatchWebhooks(companyId, 'proposal.created', { id: entityId, proposalNumber: entityLabel(after), customerId: after['customerId'] ?? '' })
    }
    return
  }

  if (beforeExists && !afterExists) {
    const companyId = String(before['companyId'] ?? '')
    if (!companyId) return
    // The client stamps lastEditedByName immediately before calling delete
    // (see deleteCustomer/deleteInvoice) specifically so this "before" snapshot
    // — the only data left once the doc is gone — can attribute the deletion.
    const changedBy = String(before['lastEditedByName'] ?? before['createdByName'] ?? 'Unknown')
    await db.collection('auditLog').add({
      companyId, entityType, entityId,
      entityLabel: entityLabel(before),
      action: 'deleted', changedBy, changes: [],
      createdAt: FieldValue.serverTimestamp(),
    })
    return
  }

  if (!beforeExists || !afterExists) return

  const companyId = String(after['companyId'] ?? '')
  if (!companyId) return

  const changes: { field: string; from: string; to: string }[] = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (AUDIT_IGNORE_FIELDS.has(key)) continue
    const b = auditValueLabel(before[key])
    const a = auditValueLabel(after[key])
    if (b !== a) changes.push({ field: key, from: b, to: a })
  }
  if (changes.length === 0) return

  const changedBy = String(after['lastEditedByName'] ?? 'Unknown')
  await db.collection('auditLog').add({
    companyId, entityType, entityId,
    entityLabel: entityLabel(after),
    action: 'updated', changedBy, changes,
    createdAt: FieldValue.serverTimestamp(),
  })

  if (entityType === 'proposal') {
    const statusChange = changes.find(c => c.field === 'status')
    if (statusChange?.to === 'accepted') {
      await dispatchWebhooks(companyId, 'proposal.accepted', { id: entityId, proposalNumber: entityLabel(after), customerId: after['customerId'] ?? '' })
      await notifyCompany(companyId, 'proposal.accepted', 'Proposal Accepted', entityLabel(after), `/proposals/${entityId}`)
    } else if (statusChange?.to === 'declined') {
      await dispatchWebhooks(companyId, 'proposal.declined', { id: entityId, proposalNumber: entityLabel(after), customerId: after['customerId'] ?? '' })
      await notifyCompany(companyId, 'proposal.declined', 'Proposal Declined', entityLabel(after), `/proposals/${entityId}`)
    }
  }

  if (entityType === 'invoice' && changes.some(c => c.field === 'status' && c.to === 'paid')) {
    await dispatchWebhooks(companyId, 'invoice.paid', { id: entityId, invoiceNumber: entityLabel(after), customerId: after['customerId'] ?? '' })
    await notifyCompany(companyId, 'invoice.paid', 'Invoice Paid', entityLabel(after), `/invoices/${entityId}`)
  }
}

export const onCustomerAudit = functions.firestore
  .document('Customers/{id}')
  .onWrite(async (change, context) => {
    const id = context.params.id as string
    await auditDiff(
      'customer', id,
      d => [String(d['first'] ?? ''), String(d['lastname'] ?? '')].filter(Boolean).join(' ') || id,
      change.before.exists, change.before.data() ?? {},
      change.after.exists, change.after.data() ?? {},
    )
    return null
  })

export const onInvoiceAudit = functions.firestore
  .document('Invoices/{id}')
  .onWrite(async (change, context) => {
    const id = context.params.id as string
    await auditDiff(
      'invoice', id,
      d => String(d['invoiceNumber'] ?? id),
      change.before.exists, change.before.data() ?? {},
      change.after.exists, change.after.data() ?? {},
    )
    return null
  })

export const onProposalAudit = functions.firestore
  .document('Proposals/{id}')
  .onWrite(async (change, context) => {
    const id = context.params.id as string
    await auditDiff(
      'proposal', id,
      d => String(d['proposalNumber'] ?? id),
      change.before.exists, change.before.data() ?? {},
      change.after.exists, change.after.data() ?? {},
    )
    return null
  })

// Customer clicks Accept/Decline on the public proposal page, which (per
// firestore.rules) may only flip publicProposals/{token}.status from 'sent'
// to 'accepted'/'declined'. That snapshot is a copy — this trigger mirrors
// the response back onto the real Proposals doc, which is what the company
// actually sees and where onProposalAudit fires the accepted/declined
// notification + webhook.
export const onProposalResponse = functions.firestore
  .document('publicProposals/{token}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after = change.after.data()
    if (before.status === after.status) return null
    if (after.status !== 'accepted' && after.status !== 'declined') return null

    const proposalId = String(after.proposalId ?? '')
    if (!proposalId) return null

    await db.collection('Proposals').doc(proposalId).update({
      status: after.status,
      respondedAt: FieldValue.serverTimestamp(),
      lastEditedByName: after.status === 'accepted' ? 'Customer (accepted online)' : 'Customer (declined online)',
    })
    return null
  })

// ── Inbound email webhook ────────────────────────────────────────────────────────
// Two-way email sync: outbound sends (bulkSendEmail, automation send_email) set
// reply_to to replies+<companyId>@INBOUND_REPLY_DOMAIN. When a customer replies,
// Resend's inbound email routing (once the domain is verified and inbound MX +
// webhook are configured in the Resend dashboard) POSTs the message here. The
// companyId is recovered from the "+tag" on the To address; the sender's email
// is matched against Customers to link the reply to a thread.
//
// NOTE: this handler parses a best-guess shape for the inbound payload (Resend's
// inbound email webhook is still evolving) — check functions logs after the first
// real webhook fires and adjust field names below if they don't line up.
// Keeps a top-level companyId lookup in sync whenever a company sets/changes
// its Twilio "from" number in companies/{companyId}/settings/profile, so
// smsInboundWebhook can resolve the owning company in a single doc read
// (Firestore has no way to query "which company doc has this field value"
// without a collection-group index, which this sidesteps entirely).
export const onCompanyProfileWrite = functions.firestore
  .document('companies/{companyId}/settings/profile')
  .onWrite(async (change, context) => {
    const { companyId } = context.params as { companyId: string }
    const before = change.before.exists ? String(change.before.data()?.['smsNumber'] ?? '') : ''
    const after  = change.after.exists  ? String(change.after.data()?.['smsNumber']  ?? '') : ''
    if (before === after) return null

    if (before) await db.collection('smsNumberIndex').doc(before).delete().catch(() => {})
    if (after)  await db.collection('smsNumberIndex').doc(after).set({ companyId })
    return null
  })
