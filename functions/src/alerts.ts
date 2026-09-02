// Firestore triggers that notify staff: new chat messages, new leads,
// assignment, and warranty expiry.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { type MulticastMessage } from 'firebase-admin/messaging'
import { randomUUID } from 'crypto'
import { db, messaging, escapeHtml } from './common'
import { replyToFor, sendAutomationEmail } from './outbound'
import { notifyCompany } from './webhookDispatch'

// ── Chat push notifications ─────────────────────────────────────────────────────
// Triggers when a new message is written. Sends an FCM push to the recipient's
// registered devices. Cleans up any stale tokens that FCM rejects.
export const onNewChatMessage = functions.firestore
  .document('messages/{fromId}/{toId}/{messageId}')
  .onCreate(async (snap, context) => {
    const { fromId, toId } = context.params as { fromId: string; toId: string }
    if (fromId === toId) return null  // no self-notifications

    const message = snap.data()

    // Fetch recipient's FCM tokens
    const recipientDoc = await db.collection('users').doc(toId).get()
    if (!recipientDoc.exists) return null
    const recipient = recipientDoc.data() ?? {}
    if (recipient.notifyChatMessages === false) return null  // opted out
    const fcmTokens: string[] = recipient.fcmTokens ?? []
    if (fcmTokens.length === 0) return null

    // Sender display name for the notification title
    const senderDoc = await db.collection('users').doc(fromId).get()
    const s = senderDoc.data() ?? {}
    const senderName = [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email || 'New message'

    const bodyText: string = message.messageType === 'image' ? '📷 Photo' : (message.text ?? '')

    const payload: MulticastMessage = {
      tokens: fcmTokens,
      notification: { title: senderName, body: bodyText },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      data: { fromId, toId, type: 'chat_message' },
    }

    const result = await messaging.sendEachForMulticast(payload)

    // Remove tokens that FCM says are no longer valid
    const stale = fcmTokens.filter((_, i) => {
      const code = result.responses[i]?.error?.code ?? ''
      return code === 'messaging/invalid-registration-token' ||
             code === 'messaging/registration-token-not-registered'
    })
    if (stale.length > 0) {
      await db.collection('users').doc(toId).update({
        fcmTokens: FieldValue.arrayRemove(...stale),
      })
    }

    return null
  })

// ── New lead notification ────────────────────────────────────────────────────────
// Notifies team members in the same company when a new lead record is created.
// Respects each user's notifyNewLeads toggle (Settings page); absent = opted in.
export const onLeadCreated = functions.firestore
  .document('Customers/{id}')
  .onCreate(async (snap) => {
    const lead = snap.data()
    const companyId = lead.companyId as string | undefined
    const category = typeof lead.category === 'string' ? lead.category.toLowerCase() : ''
    if (!companyId || category !== 'lead') return null

    const usersSnap = await db.collection('users').where('companyId', '==', companyId).get()
    if (usersSnap.empty) return null

    const name = [lead.first, lead.lastname].filter(Boolean).join(' ') || 'New lead'
    const bodyParts = [lead.city, lead.phone].filter(Boolean)
    const bodyText = bodyParts.length > 0 ? bodyParts.join(' · ') : 'Tap to view details'

    const perUserTokens: { uid: string; tokens: string[] }[] = []
    for (const userDoc of usersSnap.docs) {
      const u = userDoc.data()
      if (u.notifyNewLeads === false) continue
      const tokens: string[] = u.fcmTokens ?? []
      if (tokens.length > 0) perUserTokens.push({ uid: userDoc.id, tokens })
    }
    const allTokens = perUserTokens.flatMap(u => u.tokens)
    if (allTokens.length === 0) return null

    const payload: MulticastMessage = {
      tokens: allTokens,
      notification: { title: `New lead: ${name}`, body: bodyText },
      apns: { payload: { aps: { sound: 'default' } } },
      data: { leadId: snap.id, type: 'new_lead' },
    }
    const result = await messaging.sendEachForMulticast(payload)

    // Remove invalid tokens, mapping multicast response indices back to their owning user
    let cursor = 0
    for (const { uid, tokens } of perUserTokens) {
      const stale = tokens.filter((_, i) => {
        const code = result.responses[cursor + i]?.error?.code ?? ''
        return code === 'messaging/invalid-registration-token' ||
               code === 'messaging/registration-token-not-registered'
      })
      cursor += tokens.length
      if (stale.length > 0) {
        await db.collection('users').doc(uid).update({ fcmTokens: FieldValue.arrayRemove(...stale) })
      }
    }

    return null
  })

// ── Lead/customer assignment notification ────────────────────────────────────
// Fires when a Lead or Customer's assignedToUid changes to a new, non-empty
// value (see bulkAssignSalesmanUser / SalesmanAssigneeInput on the client).
// Sends a dedicated push (respects notifyAssignment) and also drops an
// automated message into the salesman's chat inbox from the system account —
// that message write is what triggers onNewChatMessage's own push, gated by
// the recipient's separate notifyChatMessages toggle. Two independent
// notifications by design: one is an actionable "you were assigned" alert,
// the other is a persistent note in their inbox.
const SYSTEM_CHAT_ID = 'thelight-system'
const SYSTEM_CHAT_EMAIL = 'support@thelightui.com'

export const onCustomerAssigned = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .firestore
  .document('Customers/{id}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after = change.after.data()
    const companyId = after.companyId as string | undefined
    const category = typeof after.category === 'string' ? after.category.toLowerCase() : ''
    if (!companyId || (category !== 'lead' && category !== 'customer')) {
      console.log(`onCustomerAssigned[${change.after.id}]: skip — companyId=${companyId} category=${category}`)
      return null
    }

    const newUid = after.assignedToUid as string | undefined
    const oldUid = before.assignedToUid as string | undefined
    if (!newUid || newUid === oldUid) {
      console.log(`onCustomerAssigned[${change.after.id}]: skip — newUid=${newUid} oldUid=${oldUid}`)
      return null
    }

    const userDoc = await db.collection('users').doc(newUid).get()
    if (!userDoc.exists) {
      console.log(`onCustomerAssigned[${change.after.id}]: skip — no users/${newUid} doc`)
      return null
    }
    const u = userDoc.data() ?? {}
    if (u.companyId !== companyId) {
      console.log(`onCustomerAssigned[${change.after.id}]: skip — user companyId=${u.companyId} != ${companyId}`)
      return null
    }

    const recordName = [after.first, after.lastname].filter(Boolean).join(' ') || `this ${category}`
    const assignerName = typeof after.lastEditedByName === 'string' && after.lastEditedByName
      ? after.lastEditedByName
      : 'Someone'
    const noun = category === 'customer' ? 'customer' : 'lead'
    const bodyText = `${assignerName} assigned you ${recordName}`
    const salesmanName = [u.firstName, u.lastName].filter(Boolean).join(' ') || (typeof u.email === 'string' ? u.email : 'a team member')

    // Company-wide feed (bell icon / Notifications tab) — separate from the
    // salesman's personal push + chat message below; every team member sees this.
    await notifyCompany(
      companyId, 'customer.assigned',
      `New ${noun} assigned`,
      `${assignerName} assigned ${recordName} to ${salesmanName}`,
      `/records/${change.after.id}`,
    )

    if (u.notifyAssignment !== false) {
      const tokens: string[] = u.fcmTokens ?? []
      console.log(`onCustomerAssigned[${change.after.id}]: push — uid=${newUid} tokenCount=${tokens.length}`)
      if (tokens.length > 0) {
        const payload: MulticastMessage = {
          tokens,
          notification: { title: `New ${noun} assigned`, body: bodyText },
          apns: { payload: { aps: { sound: 'default' } } },
          data: { leadId: change.after.id, type: 'lead_assigned' },
        }
        const result = await messaging.sendEachForMulticast(payload)
        console.log(`onCustomerAssigned[${change.after.id}]: push result — success=${result.successCount} failure=${result.failureCount} errors=${JSON.stringify(result.responses.map(r => r.error?.code ?? null))}`)
        const stale = tokens.filter((_, i) => {
          const code = result.responses[i]?.error?.code ?? ''
          return code === 'messaging/invalid-registration-token' ||
                 code === 'messaging/registration-token-not-registered'
        })
        if (stale.length > 0) {
          await db.collection('users').doc(newUid).update({ fcmTokens: FieldValue.arrayRemove(...stale) })
        }
      }
    } else {
      console.log(`onCustomerAssigned[${change.after.id}]: push skipped — notifyAssignment=false for uid=${newUid}`)
    }

    const salesmanEmail = typeof u.email === 'string' ? u.email.trim() : ''
    const resendApiKey = process.env.RESEND_API_KEY
    if (u.notifyAssignmentEmail !== false && salesmanEmail && resendApiKey) {
      const recordUrl = `https://thelightui.web.app/records/${change.after.id}`
      const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1f2937;line-height:1.6">
        <p style="margin:0 0 16px">${escapeHtml(bodyText)}.</p>
        <p style="margin:0 0 16px"><a href="${recordUrl}" style="color:#4f46e5">View ${noun} →</a></p>
      </div>`
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'TheLight CRM <onboarding@resend.dev>',
            reply_to: replyToFor(companyId),
            to: [salesmanEmail],
            subject: `New ${noun} assigned: ${recordName}`,
            html,
          }),
        })
        if (!res.ok) {
          console.error(`Assignment email to ${salesmanEmail} failed ${res.status}:`, await res.text())
        }
      } catch (err) {
        console.error(`Assignment email to ${salesmanEmail} threw:`, err)
      }
    }

    const timestamp = Timestamp.now()
    const messageId = randomUUID()
    const text = `📋 ${bodyText}.`
    const messageData = { fromId: SYSTEM_CHAT_ID, toId: newUid, text, messageType: 'text', timestamp, leadId: change.after.id }
    const batch = db.batch()
    batch.set(db.collection('messages').doc(SYSTEM_CHAT_ID).collection(newUid).doc(messageId), messageData)
    batch.set(db.collection('messages').doc(newUid).collection(SYSTEM_CHAT_ID).doc(messageId), messageData)
    batch.set(db.collection('recent_messages').doc(SYSTEM_CHAT_ID).collection('messages').doc(newUid), {
      timestamp, text, fromId: SYSTEM_CHAT_ID, toId: newUid, profileImageUrl: '', email: (u.email as string) ?? '',
    })
    batch.set(db.collection('recent_messages').doc(newUid).collection('messages').doc(SYSTEM_CHAT_ID), {
      timestamp, text, fromId: SYSTEM_CHAT_ID, toId: newUid, profileImageUrl: '', email: SYSTEM_CHAT_EMAIL,
    })
    await batch.commit()

    return null
  })

// ── Warranty expiration reminders ────────────────────────────────────────────
// Runs daily. Emails the customer once when their warranty first enters the
// 30-day expiration window — lastReminderSentAt gates it to a single send per
// warranty, same pattern as the invoice/proposal reminder callables above.
export const warrantyExpirationReminders = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .pubsub.schedule('0 9 * * *').timeZone('America/New_York')
  .onRun(async () => {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return null

    const now = Timestamp.now()
    const in30Days = Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000)

    const snap = await db.collection('Warranties')
      .where('isActive', '==', true)
      .where('expirationDate', '<=', in30Days)
      .get()

    for (const doc of snap.docs) {
      const w = doc.data()
      if (w['lastReminderSentAt']) continue // already reminded once for this warranty
      const expirationDate = w['expirationDate'] as Timestamp | undefined
      if (!expirationDate || expirationDate.toMillis() < now.toMillis()) continue // already expired

      const companyId  = String(w['companyId']  ?? '')
      const customerId = String(w['customerId'] ?? '')
      if (!companyId || !customerId) continue

      try {
        const custSnap = await db.collection('Customers').doc(customerId).get()
        const email = String(custSnap.data()?.['email'] ?? '').trim()
        if (!email || !email.includes('@')) continue

        const title   = String(w['title'] ?? 'Your warranty')
        const expDate = expirationDate.toDate().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        const subject = `${title} is expiring soon`
        const body = [
          `Hi ${w['customerName'] ?? ''},`,
          '',
          `This is a reminder that "${title}" is set to expire on ${expDate}.`,
          'Reach out if you would like to discuss renewal or coverage options.',
        ].join('\n')

        await sendAutomationEmail(apiKey, companyId, customerId, email, subject, body)
        await doc.ref.update({ lastReminderSentAt: FieldValue.serverTimestamp() })
      } catch (err) {
        console.error(`warrantyExpirationReminders: failed for warranty ${doc.id}:`, err)
      }
    }

    return null
  })
