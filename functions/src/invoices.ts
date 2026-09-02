// Recurring invoice generation and invoice/proposal reminder batches.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db, auth, fmtMoney, fmtDateShort, lineItemsTotal } from './common'
import { sendAutomationEmail } from './outbound'

// ── Recurring invoice scheduler ────────────────────────────────────────────────
// Runs daily at 8 AM UTC. Finds invoices with recurring set and nextRecurDate in
// the past, clones them (status=sent), and advances nextRecurDate by one interval.
export const generateRecurringInvoices = functions
  .pubsub.schedule('0 8 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    const snap = await db.collection('Invoices')
      .where('recurring', 'in', ['monthly', 'quarterly', 'yearly'])
      .where('nextRecurDate', '<=', Timestamp.fromDate(now))
      .get()

    let generated = 0
    for (const invoiceDoc of snap.docs) {
      try {
        const inv = invoiceDoc.data()
        const recurInterval: string = inv['recurring']
        const issueDate = new Date()
        const dueDate   = new Date()
        dueDate.setDate(dueDate.getDate() + 30)

        // Clone the invoice without the recurring schedule
        await db.collection('Invoices').add({
          ...inv,
          invoiceNumber:   generateInvNum(),
          issueDate:       Timestamp.fromDate(issueDate),
          dueDate:         Timestamp.fromDate(dueDate),
          status:          'sent',
          recurring:       null,
          nextRecurDate:   null,
          generatedFrom:   invoiceDoc.id,
          lastGeneratedAt: null,
          createdAt:       FieldValue.serverTimestamp(),
          updatedAt:       FieldValue.serverTimestamp(),
        })

        // Advance nextRecurDate on the template
        const prevDate   = inv['nextRecurDate'].toDate() as Date
        const nextDate   = advanceByInterval(prevDate, recurInterval)

        await invoiceDoc.ref.update({
          nextRecurDate:   Timestamp.fromDate(nextDate),
          lastGeneratedAt: FieldValue.serverTimestamp(),
        })

        generated++
      } catch (err) {
        console.error(`Failed to generate recurring invoice for ${invoiceDoc.id}:`, err)
      }
    }

    console.log(`generateRecurringInvoices: ${generated} invoice(s) created`)
    return null
  })

function advanceByInterval(date: Date, interval: string): Date {
  const d = new Date(date)
  if (interval === 'monthly')   d.setMonth(d.getMonth() + 1)
  else if (interval === 'quarterly') d.setMonth(d.getMonth() + 3)
  else                          d.setFullYear(d.getFullYear() + 1)
  return d
}

function generateInvNum(): string {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = String(now.getMonth() + 1).padStart(2, '0')
  const r   = Math.floor(Math.random() * 9000 + 1000)
  return `INV-${y}${m}-${r}`
}


export const bulkSendInvoiceReminders = functions
  .runWith({ secrets: ['RESEND_API_KEY'], timeoutSeconds: 300, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const companyId = context.auth.token.companyId as string
    if (!companyId) {
      throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')
    }
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new functions.https.HttpsError('unavailable', 'Email sending is not configured')
    }

    const { invoiceIds } = data as { invoiceIds: string[] }
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'invoiceIds is required')
    }
    if (invoiceIds.length > 500) {
      throw new functions.https.HttpsError('invalid-argument', 'Maximum 500 reminders per send')
    }

    let sent = 0
    let skipped = 0

    for (let i = 0; i < invoiceIds.length; i += 30) {
      const batch = invoiceIds.slice(i, i + 30)
      const snap = await db.collection('Invoices')
        .where('__name__', 'in', batch)
        .where('companyId', '==', companyId)
        .get()

      for (const doc of snap.docs) {
        const inv = doc.data()
        const email = String(inv['customerEmail'] ?? '').trim()
        if (!email || !email.includes('@')) { skipped++; continue }

        const total = fmtMoney(lineItemsTotal(inv))
        const dueDate = fmtDateShort(inv['dueDate'])
        const invoiceNumber = String(inv['invoiceNumber'] ?? doc.id)
        const shareToken = inv['shareToken'] ? String(inv['shareToken']) : ''
        const link = shareToken ? `https://thelightui.web.app/i/${shareToken}` : ''

        const subject = `Payment Reminder: Invoice ${invoiceNumber}`
        const body = [
          `Hi ${inv['customerName'] ?? ''},`,
          '',
          `This is a friendly reminder that invoice ${invoiceNumber} for ${total} is due${dueDate ? ` on ${dueDate}` : ''}.`,
          link ? `You can view and pay it here: ${link}` : 'Please contact us if you have any questions.',
        ].join('\n')

        await sendAutomationEmail(apiKey, companyId, String(inv['customerId'] ?? ''), email, subject, body)
        await doc.ref.update({ lastReminderSentAt: FieldValue.serverTimestamp() })
        sent++

        if (sent > 0 && sent % 10 === 0) await new Promise(r => setTimeout(r, 500))
      }
    }

    return { sent, skipped }
  })

export const bulkSendProposalReminders = functions
  .runWith({ secrets: ['RESEND_API_KEY'], timeoutSeconds: 300, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const companyId = context.auth.token.companyId as string
    if (!companyId) {
      throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')
    }
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new functions.https.HttpsError('unavailable', 'Email sending is not configured')
    }

    const { proposalIds } = data as { proposalIds: string[] }
    if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'proposalIds is required')
    }
    if (proposalIds.length > 500) {
      throw new functions.https.HttpsError('invalid-argument', 'Maximum 500 reminders per send')
    }

    let sent = 0
    let skipped = 0

    for (let i = 0; i < proposalIds.length; i += 30) {
      const batch = proposalIds.slice(i, i + 30)
      const snap = await db.collection('Proposals')
        .where('__name__', 'in', batch)
        .where('companyId', '==', companyId)
        .get()

      for (const doc of snap.docs) {
        const p = doc.data()
        const email = String(p['customerEmail'] ?? '').trim()
        if (!email || !email.includes('@')) { skipped++; continue }

        const total = fmtMoney(lineItemsTotal(p))
        const expires = fmtDateShort(p['expiresDate'])
        const proposalNumber = String(p['proposalNumber'] ?? doc.id)
        const shareToken = p['shareToken'] ? String(p['shareToken']) : ''
        const link = shareToken ? `https://thelightui.web.app/p/${shareToken}` : ''

        const subject = `Reminder: Proposal ${proposalNumber} awaiting your response`
        const body = [
          `Hi ${p['customerName'] ?? ''},`,
          '',
          `Just a reminder that proposal ${proposalNumber} for ${total} is still awaiting your response${expires ? `, and expires on ${expires}` : ''}.`,
          link ? `You can review and respond here: ${link}` : 'Please contact us if you have any questions.',
        ].join('\n')

        await sendAutomationEmail(apiKey, companyId, String(p['customerId'] ?? ''), email, subject, body)
        await doc.ref.update({ lastReminderSentAt: FieldValue.serverTimestamp() })
        sent++

        if (sent > 0 && sent % 10 === 0) await new Promise(r => setTimeout(r, 500))
      }
    }

    return { sent, skipped }
  })
