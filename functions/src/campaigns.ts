// Email campaign sending and open/click tracking.
//
// The /campaigns page shipped without any of this. `sendCampaign` in
// src/services/campaignService.ts wrote campaignRecipients rows, stamped the
// campaign `status: 'sent'` with a sentCount, and returned — no mail provider
// call anywhere, no Cloud Function, no trigger on campaignRecipients. So the
// page reported "Campaign sent to 412 contacts", showed a green Sent badge,
// and nothing left the system. `interpolateCampaign` was defined in the model
// and called from nowhere, which was the tell.
//
// openCount and clickCount were likewise only ever written as 0 at creation,
// so "Opened", "Clicked", "Open rate", "Total Opened" and "Avg Open Rate"
// could not read anything but zero. The two HTTP endpoints below are what
// make those numbers real.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db, escapeHtml, assertCompanyAdmin } from './common'
import { replyToFor, logOutboundEmail } from './outbound'

const CAMPAIGNS = 'campaigns'
const RECIPIENTS = 'campaignRecipients'

/** Region-qualified base for the tracking endpoints below. */
function functionsBase(): string {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? ''
  return `https://us-central1-${project}.cloudfunctions.net`
}

/**
 * Merge fields, mirroring interpolateCampaign in src/models/campaign.ts.
 *
 * Kept in step by campaign.test.ts on the client, which runs both
 * substitutions over the same inputs. A missing field becomes an empty
 * string rather than leaving the token visible in someone's inbox.
 */
function interpolate(template: string, r: Record<string, unknown>): string {
  const s = (k: string) => String(r[k] ?? '')
  const first = s('customerFirst')
  const last = s('customerLast')
  return template
    .replace(/\{\{firstName\}\}/g, first)
    .replace(/\{\{lastName\}\}/g, last)
    .replace(/\{\{fullName\}\}/g, `${first} ${last}`.trim())
    .replace(/\{\{email\}\}/g, s('customerEmail'))
    .replace(/\{\{phone\}\}/g, s('customerPhone'))
    .replace(/\{\{city\}\}/g, s('customerCity'))
    .replace(/\{\{salesman\}\}/g, s('customerSalesman'))
}

/**
 * Rewrites bare URLs through the click endpoint, then wraps the body.
 *
 * The body is plain text typed into a textarea, so it is escaped before any
 * markup is added — a customer record or a pasted line containing
 * "<img onerror=…>" must not become markup, the same reasoning as
 * bulkSendEmail in outreach.ts.
 */
function buildHtml(bodyText: string, recipientId: string): string {
  const escaped = escapeHtml(bodyText)
  const base = functionsBase()
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    (url) => `<a href="${base}/campaignClick?r=${encodeURIComponent(recipientId)}&u=${encodeURIComponent(url)}" style="color:#4f46e5">${url}</a>`,
  )
  const paragraphs = withLinks
    .split('\n')
    .map(p => (p.trim() ? `<p style="margin:0 0 16px">${p}</p>` : ''))
    .join('')
  // 1x1 pixel last, so a client that stops loading images part-way still
  // renders the message.
  const pixel = `<img src="${base}/campaignOpen?r=${encodeURIComponent(recipientId)}" width="1" height="1" alt="" style="display:block;border:0" />`
  return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1f2937;line-height:1.6">${paragraphs}${pixel}</div>`
}

// ── Send ──────────────────────────────────────────────────────────────────────
// Callable: sends a campaign to the recipient rows the client has already
// written, and reports what actually went out.
export const sendCampaignEmails = functions
  .runWith({ secrets: ['RESEND_API_KEY'], timeoutSeconds: 540, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const companyId = await assertCompanyAdmin(context)

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new functions.https.HttpsError('unavailable', 'Email sending is not configured')
    }

    const { campaignId } = data as { campaignId?: string }
    if (!campaignId) {
      throw new functions.https.HttpsError('invalid-argument', 'campaignId is required')
    }

    const campSnap = await db.collection(CAMPAIGNS).doc(campaignId).get()
    const camp = campSnap.data()
    if (!campSnap.exists || String(camp?.['companyId'] ?? '') !== companyId) {
      throw new functions.https.HttpsError('not-found', 'Campaign not found')
    }
    // Re-sending would double-mail everyone; the client hides the action but
    // the guard belongs here.
    if (camp?.['status'] === 'sent') {
      throw new functions.https.HttpsError('failed-precondition', 'This campaign has already been sent')
    }

    const subject = String(camp?.['subject'] ?? '').trim()
    const body = String(camp?.['body'] ?? '').trim()
    if (!subject || !body) {
      throw new functions.https.HttpsError('invalid-argument', 'Campaign needs a subject and a body')
    }

    const pending = await db.collection(RECIPIENTS)
      .where('campaignId', '==', campaignId)
      .where('companyId', '==', companyId)
      .where('status', '==', 'pending')
      .get()

    if (pending.empty) {
      throw new functions.https.HttpsError('failed-precondition', 'This campaign has no pending recipients')
    }

    let sent = 0
    let failed = 0

    for (const rcpt of pending.docs) {
      const r = rcpt.data()
      const email = String(r['customerEmail'] ?? '').trim()
      if (!email || !email.includes('@')) {
        await rcpt.ref.update({ status: 'bounced', failedReason: 'No email address' })
        failed++
        continue
      }

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'TheLight CRM <onboarding@resend.dev>',
            reply_to: replyToFor(companyId),
            to: [email],
            subject: interpolate(subject, r),
            html: buildHtml(interpolate(body, r), rcpt.id),
          }),
        })
        if (res.ok) {
          await rcpt.ref.update({ status: 'sent', sentAt: Timestamp.now() })
          await logOutboundEmail(
            companyId, String(r['customerId'] ?? ''), 'onboarding@resend.dev',
            email, interpolate(subject, r), interpolate(body, r),
          )
          sent++
        } else {
          const text = await res.text()
          console.error(`Campaign ${campaignId} → ${email} failed ${res.status}:`, text)
          await rcpt.ref.update({ status: 'bounced', failedReason: `HTTP ${res.status}` })
          failed++
        }
      } catch (err) {
        console.error(`Campaign ${campaignId} → ${email} threw:`, err)
        await rcpt.ref.update({ status: 'bounced', failedReason: 'Network error' })
        failed++
      }

      // Resend's rate limit. Same pause bulkSendEmail uses.
      if (sent > 0 && sent % 10 === 0) await new Promise(r => setTimeout(r, 500))
    }

    // sentCount is what was actually accepted, not the size of the audience —
    // otherwise the open rate's denominator is wrong.
    await db.collection(CAMPAIGNS).doc(campaignId).update({
      status: 'sent',
      sentAt: Timestamp.now(),
      sentCount: sent,
      failedCount: failed,
      updatedAt: FieldValue.serverTimestamp(),
    })

    console.log(`sendCampaignEmails ${campaignId}: ${sent} sent, ${failed} failed`)
    return { sent, failed }
  })

// ── Open tracking ─────────────────────────────────────────────────────────────
// A 1x1 gif. Counted once per recipient, so a message opened five times is
// one open — otherwise the rate can exceed 100%.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64')

export const campaignOpen = functions.https.onRequest(async (req, res) => {
  const recipientId = String(req.query['r'] ?? '')
  res.set('Content-Type', 'image/gif')
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  if (!recipientId) { res.status(200).send(PIXEL); return }

  try {
    const ref = db.collection(RECIPIENTS).doc(recipientId)
    const snap = await ref.get()
    const data = snap.data()
    if (snap.exists && !data?.['openedAt']) {
      await ref.update({ openedAt: Timestamp.now(), status: data?.['status'] === 'clicked' ? 'clicked' : 'opened' })
      const campaignId = String(data?.['campaignId'] ?? '')
      if (campaignId) {
        await db.collection(CAMPAIGNS).doc(campaignId).update({ openCount: FieldValue.increment(1) })
      }
    }
  } catch (err) {
    // A tracking failure must never break the image.
    console.error('campaignOpen failed:', err)
  }
  res.status(200).send(PIXEL)
})

// ── Click tracking ────────────────────────────────────────────────────────────
export const campaignClick = functions.https.onRequest(async (req, res) => {
  const recipientId = String(req.query['r'] ?? '')
  const target = String(req.query['u'] ?? '')

  // Only ever redirect to http(s), so the endpoint can't be used to bounce
  // someone to a javascript: or data: URL.
  let safe: string | null = null
  try {
    const parsed = new URL(target)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') safe = parsed.toString()
  } catch { /* unparseable */ }

  if (recipientId) {
    try {
      const ref = db.collection(RECIPIENTS).doc(recipientId)
      const snap = await ref.get()
      const data = snap.data()
      if (snap.exists && !data?.['clickedAt']) {
        await ref.update({ clickedAt: Timestamp.now(), status: 'clicked' })
        const campaignId = String(data?.['campaignId'] ?? '')
        if (campaignId) {
          await db.collection(CAMPAIGNS).doc(campaignId).update({ clickCount: FieldValue.increment(1) })
        }
      }
    } catch (err) {
      console.error('campaignClick failed:', err)
    }
  }

  if (!safe) { res.status(400).send('Invalid link'); return }
  res.redirect(302, safe)
})
