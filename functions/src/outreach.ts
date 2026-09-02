// Customer-facing email and SMS: bulk sends, and the inbound Twilio and
// Resend webhooks that thread replies back onto the customer.

import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { createHmac } from 'crypto'
import { db, auth, escapeHtml, lastTenDigits } from './common'
import { replyToFor, logOutboundEmail, sendTwilioSms, smsOptOutDocId } from './outbound'

// ── Bulk email send ────────────────────────────────────────────────────────────
// Callable: sends a personalized email to each selected customer record.
// Merge tags: {first} {lastname} {city} {salesman}
// Returns { sent, skipped } — skipped = no/invalid email or API error.
export const bulkSendEmail = functions
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

    const { customerIds, subject, body } = data as {
      customerIds: string[]
      subject: string
      body: string
    }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'customerIds is required')
    }
    if (!subject?.trim() || !body?.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'subject and body are required')
    }
    if (customerIds.length > 500) {
      throw new functions.https.HttpsError('invalid-argument', 'Maximum 500 recipients per send')
    }

    // Fetch customers in batches of 30 (Firestore 'in' operator limit)
    const allDocs: Record<string, unknown>[] = []
    for (let i = 0; i < customerIds.length; i += 30) {
      const batch = customerIds.slice(i, i + 30)
      const snap = await db.collection('Customers')
        .where('__name__', 'in', batch)
        .where('companyId', '==', companyId)
        .get()
      snap.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }))
    }

    let sent = 0
    let skipped = 0

    for (const cust of allDocs) {
      const email = (cust['email'] as string | undefined)?.trim()
      if (!email || !email.includes('@')) { skipped++; continue }

      const first    = (cust['first']    as string) || ''
      const lastname = (cust['lastname'] as string) || ''
      const city     = (cust['city']     as string) || ''
      const salesman = (cust['salesman'] as string) || ''

      function merge(s: string): string {
        return s
          .replace(/\{first\}/gi,    first)
          .replace(/\{lastname\}/gi, lastname)
          .replace(/\{city\}/gi,     city)
          .replace(/\{salesman\}/gi, salesman)
      }

      const personalizedSubject = merge(subject)
      const personalizedBody    = merge(body)
      // personalizedBody is composed from a plain-text textarea plus
      // Firestore customer fields (first/lastname/city/salesman), neither of
      // which is meant to be interpreted as HTML — escape before wrapping in
      // <p> tags so a customer record containing e.g. "<img onerror=...>"
      // can't inject markup into the outgoing email.
      const escapedBody = escapeHtml(personalizedBody)
      const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1f2937;line-height:1.6">
        ${escapedBody.split('\n').map(p => p.trim() ? `<p style="margin:0 0 16px">${p}</p>` : '').join('')}
      </div>`

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'TheLight CRM <onboarding@resend.dev>',
            reply_to: replyToFor(companyId),
            to: [email],
            subject: personalizedSubject,
            html,
          }),
        })
        if (res.ok) {
          sent++
          await logOutboundEmail(companyId, String(cust.id), 'onboarding@resend.dev', email, personalizedSubject, personalizedBody)
        } else {
          const errText = await res.text()
          console.error(`Email to ${email} failed ${res.status}:`, errText)
          skipped++
        }
      } catch (err) {
        console.error(`Email to ${email} threw:`, err)
        skipped++
      }

      // Pause briefly every 10 sends to stay within Resend rate limits
      if (sent > 0 && sent % 10 === 0) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    return { sent, skipped }
  })


export const sendSms = functions
  .runWith({ secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const companyId = context.auth.token.companyId as string
    if (!companyId) {
      throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken  = process.env.TWILIO_AUTH_TOKEN
    if (!accountSid || !authToken) {
      throw new functions.https.HttpsError('unavailable', 'SMS sending is not configured')
    }

    const { customerId, body } = data as { customerId: string; body: string }
    if (!customerId || !body?.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'customerId and body are required')
    }

    const profileSnap = await db.collection('companies').doc(companyId).collection('settings').doc('profile').get()
    const fromNumber = String(profileSnap.data()?.['smsNumber'] ?? '')
    if (!fromNumber) {
      throw new functions.https.HttpsError('failed-precondition', 'No SMS number configured for this company')
    }

    const custSnap = await db.collection('Customers').doc(customerId).get()
    if (!custSnap.exists || custSnap.data()?.['companyId'] !== companyId) {
      throw new functions.https.HttpsError('not-found', 'Customer not found')
    }
    const toNumber = String(custSnap.data()?.['phone'] ?? '').trim()
    if (!toNumber) {
      throw new functions.https.HttpsError('failed-precondition', 'This customer has no phone number on file')
    }

    const optOutSnap = await db.collection('smsOptOuts').doc(smsOptOutDocId(companyId, toNumber)).get()
    if (optOutSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'This customer has opted out of SMS')
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
      throw new functions.https.HttpsError('internal', result.error)
    }
    return { sid: result.sid }
  })

// Validates Twilio's X-Twilio-Signature header per Twilio's documented
// algorithm: HMAC-SHA1 (auth token as key) over the full request URL with
// each POST param's key+value appended in sorted-key order, base64-encoded.
function validateTwilioSignature(
  authToken: string, url: string, params: Record<string, unknown>, signature: string,
): boolean {
  let data = url
  for (const key of Object.keys(params).sort()) {
    data += key + String(params[key])
  }
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
  return expected === signature
}
// SMS opt-out registry, keyed by company + phone (not just customerId) so a
// number that texts STOP stays blocked even if it's later linked to a
// different or newly-created customer record. Carrier-standard keywords per
// the CTIA/TCPA short-code guidelines.
const SMS_STOP_KEYWORDS  = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']
const SMS_START_KEYWORDS = ['start', 'unstop']

export const smsInboundWebhook = functions
  .runWith({ secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] })
  .https.onRequest(async (req, res) => {
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN
      const signature = req.get('X-Twilio-Signature') ?? ''
      const url = `https://${req.get('host')}${req.originalUrl}`
      const params = (req.body ?? {}) as Record<string, unknown>

      if (!authToken || !validateTwilioSignature(authToken, url, params, signature)) {
        console.error('smsInboundWebhook: signature verification failed')
        res.status(403).send('forbidden')
        return
      }

      const fromNumber = String(params['From'] ?? '')
      const toNumber   = String(params['To'] ?? '')
      const body       = String(params['Body'] ?? '')
      const messageSid = String(params['MessageSid'] ?? '')

      if (!fromNumber || !toNumber) {
        res.status(200).send('<Response></Response>')
        return
      }

      const indexSnap = await db.collection('smsNumberIndex').doc(toNumber).get()
      const companyId = String(indexSnap.data()?.['companyId'] ?? '')
      if (!companyId) {
        console.error('smsInboundWebhook: no company configured for number', toNumber)
        res.status(200).send('<Response></Response>')
        return
      }

      // Exact match first (fast path for E.164-formatted records), falling
      // back to a bounded scan comparing last-10-digits for free-text phone
      // formats like "(555) 123-4567".
      let customerId = ''
      const exactSnap = await db.collection('Customers')
        .where('companyId', '==', companyId)
        .where('phone', '==', fromNumber)
        .limit(1)
        .get()
      if (!exactSnap.empty) {
        customerId = exactSnap.docs[0].id
      } else {
        const target = lastTenDigits(fromNumber)
        const scanSnap = await db.collection('Customers')
          .where('companyId', '==', companyId)
          .limit(2000)
          .get()
        const match = scanSnap.docs.find(d => lastTenDigits(String(d.data()['phone'] ?? '')) === target)
        if (match) customerId = match.id
      }

      await db.collection('smsMessages').add({
        companyId, customerId,
        direction: 'inbound',
        fromNumber, toNumber, body,
        status: 'received',
        errorMessage: '',
        twilioSid: messageSid,
        createdAt: FieldValue.serverTimestamp(),
        read: false,
      })

      const normalizedBody = body.trim().toLowerCase()
      const accountSid = process.env.TWILIO_ACCOUNT_SID
      const optOutRef = db.collection('smsOptOuts').doc(smsOptOutDocId(companyId, fromNumber))

      if (SMS_STOP_KEYWORDS.includes(normalizedBody)) {
        await optOutRef.set({ companyId, phone: lastTenDigits(fromNumber), optedOutAt: FieldValue.serverTimestamp() })
        if (customerId) await db.collection('Customers').doc(customerId).update({ smsOptOut: true })
        if (accountSid && authToken) {
          await sendTwilioSms(accountSid, authToken, toNumber, fromNumber, 'You have been unsubscribed and will not receive further texts. Reply START to resubscribe.')
        }
      } else if (SMS_START_KEYWORDS.includes(normalizedBody)) {
        await optOutRef.delete()
        if (customerId) await db.collection('Customers').doc(customerId).update({ smsOptOut: false })
        if (accountSid && authToken) {
          await sendTwilioSms(accountSid, authToken, toNumber, fromNumber, 'You have been resubscribed to text messages.')
        }
      }

      res.set('Content-Type', 'text/xml')
      res.status(200).send('<Response></Response>')
    } catch (err) {
      console.error('smsInboundWebhook error:', err)
      res.status(500).send('error')
    }
  })

// Twilio's status callback for messages sent via sendSms — updates the
// matching smsMessages doc (looked up by twilioSid) as it moves through
// queued/sent/delivered/failed.
export const smsStatusWebhook = functions
  .runWith({ secrets: ['TWILIO_AUTH_TOKEN'] })
  .https.onRequest(async (req, res) => {
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN
      const signature = req.get('X-Twilio-Signature') ?? ''
      const url = `https://${req.get('host')}${req.originalUrl}`
      const params = (req.body ?? {}) as Record<string, unknown>

      if (!authToken || !validateTwilioSignature(authToken, url, params, signature)) {
        console.error('smsStatusWebhook: signature verification failed')
        res.status(403).send('forbidden')
        return
      }

      const messageSid = String(params['MessageSid'] ?? '')
      const status      = String(params['MessageStatus'] ?? '')
      const errorMessage = String(params['ErrorMessage'] ?? '')
      if (!messageSid || !status) { res.status(200).send('ok'); return }

      const matchSnap = await db.collection('smsMessages').where('twilioSid', '==', messageSid).limit(1).get()
      if (!matchSnap.empty) {
        await matchSnap.docs[0].ref.update({ status, ...(errorMessage ? { errorMessage } : {}) })
      }

      res.status(200).send('ok')
    } catch (err) {
      console.error('smsStatusWebhook error:', err)
      res.status(500).send('error')
    }
  })

// Verifies Resend's webhook signature, which follows the Standard Webhooks /
// Svix scheme: HMAC-SHA256 (the "whsec_..." secret, base64-decoded, as key)
// over "{svix-id}.{svix-timestamp}.{rawBody}", compared against any of the
// space-separated "v1,<sig>" values in the svix-signature header.
function validateResendWebhookSignature(
  secret: string, svixId: string, svixTimestamp: string, svixSignature: string, rawBody: Buffer,
): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString('utf-8')}`
  const expected = createHmac('sha256', key).update(signedContent).digest('base64')
  return svixSignature.split(' ').some(part => part.split(',')[1] === expected)
}

export const emailInboundWebhook = functions
  .runWith({ secrets: ['RESEND_WEBHOOK_SECRET'] })
  .https.onRequest(async (req, res) => {
    try {
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
      if (webhookSecret) {
        const svixId        = req.get('svix-id') ?? ''
        const svixTimestamp = req.get('svix-timestamp') ?? ''
        const svixSignature = req.get('svix-signature') ?? ''
        const verified = svixId && svixTimestamp && svixSignature
          && validateResendWebhookSignature(webhookSecret, svixId, svixTimestamp, svixSignature, req.rawBody)
        if (!verified) {
          console.error('emailInboundWebhook: signature verification failed')
          res.status(403).send('forbidden')
          return
        }
      } else {
        console.warn('RESEND_WEBHOOK_SECRET not set — accepting inbound webhook without signature verification.')
      }

      const payload = (req.body?.data ?? req.body ?? {}) as Record<string, unknown>

      const toRaw = payload['to']
      const toAddress = Array.isArray(toRaw) ? String(toRaw[0]) : String(toRaw ?? payload['to_address'] ?? '')
      const fromRaw = payload['from']
      const fromAddress = (typeof fromRaw === 'object' && fromRaw)
        ? String((fromRaw as Record<string, unknown>)['email'] ?? '')
        : String(fromRaw ?? payload['from_address'] ?? '')
      const subject = String(payload['subject'] ?? '')
      const body = String(payload['text'] ?? payload['html'] ?? payload['body'] ?? '')

      const tagMatch = toAddress.match(/\+([^@]+)@/)
      const companyId = tagMatch ? tagMatch[1] : ''

      if (!companyId || !fromAddress.includes('@')) {
        console.error('emailInboundWebhook: could not determine companyId or sender', { toAddress, fromAddress })
        res.status(200).send('ignored')
        return
      }

      const custSnap = await db.collection('Customers')
        .where('companyId', '==', companyId)
        .where('email', '==', fromAddress)
        .limit(1)
        .get()
      const customerId = custSnap.empty ? '' : custSnap.docs[0].id

      await db.collection('emailMessages').add({
        companyId,
        customerId,
        direction: 'inbound',
        fromAddress,
        toAddress,
        subject,
        body,
        createdAt: FieldValue.serverTimestamp(),
        read: false,
      })

      res.status(200).send('ok')
    } catch (err) {
      console.error('emailInboundWebhook error:', err)
      res.status(500).send('error')
    }
  })
