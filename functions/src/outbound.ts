// Outbound email and SMS primitives, shared by the outreach, alert, and
// automation modules.

import { FieldValue } from 'firebase-admin/firestore'
import { db, lastTenDigits } from './common'

// Domain used for reply-to addresses so customer replies can be routed back
// into their thread. Requires the domain to be verified in Resend with
// inbound routing configured (MX records + Resend inbound webhook pointed
// at emailInboundWebhook) — until then, replies just won't be captured.
export const INBOUND_REPLY_DOMAIN = 'mail.thelightui.com'

export function replyToFor(companyId: string): string {
  return `replies+${companyId}@${INBOUND_REPLY_DOMAIN}`
}


export async function logOutboundEmail(
  companyId: string, customerId: string, fromAddress: string, toAddress: string, subject: string, body: string,
): Promise<void> {
  await db.collection('emailMessages').add({
    companyId, customerId,
    direction: 'outbound',
    fromAddress, toAddress, subject, body,
    createdAt: FieldValue.serverTimestamp(),
    read: true,
  })
}

// ── SMS (Twilio) ─────────────────────────────────────────────────────────────
// Two-way texting per customer. Sending goes through this callable; replies
// and delivery updates arrive via smsInboundWebhook / smsStatusWebhook below.
// Each company configures its own Twilio "from" number in
// companies/{companyId}/settings/profile (field: smsNumber) so a single
// Twilio account can serve multiple tenants.

export async function sendTwilioSms(
  accountSid: string, authToken: string, from: string, to: string, body: string,
): Promise<{ sid: string } | { error: string }> {
  const params = new URLSearchParams({ From: from, To: to, Body: body })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const json = await res.json() as Record<string, unknown>
  if (!res.ok) {
    return { error: String(json['message'] ?? `Twilio error ${res.status}`) }
  }
  return { sid: String(json['sid'] ?? '') }
}

export async function sendAutomationEmail(
  apiKey: string, companyId: string, customerId: string, to: string, subject: string, body: string,
): Promise<void> {
  if (!to.includes('@')) return
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1f2937;line-height:1.6">
    ${body.split('\n').map(p => p.trim() ? `<p style="margin:0 0 16px">${p}</p>` : '').join('')}
  </div>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TheLight CRM <onboarding@resend.dev>',
        reply_to: replyToFor(companyId),
        to: [to], subject, html,
      }),
    })
    if (res.ok) {
      await logOutboundEmail(companyId, customerId, 'onboarding@resend.dev', to, subject, body)
    } else {
      console.error(`Automation email to ${to} failed ${res.status}:`, await res.text())
    }
  } catch (err) {
    console.error(`Automation email to ${to} threw:`, err)
  }
}


export function smsOptOutDocId(companyId: string, phone: string): string {
  return `${companyId}_${lastTenDigits(phone)}`
}
