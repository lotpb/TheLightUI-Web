// In-app notifications and outbound webhook delivery, fanned out from the
// audit, automation, and alert triggers.

import { FieldValue } from 'firebase-admin/firestore'
import { createHmac } from 'crypto'
import { db } from './common'

// ── Outbound Webhooks ──────────────────────────────────────────────────────────
// Lets external tools (Zapier, custom integrations) subscribe to CRM events.
// Subscriptions live in `webhookSubscriptions`, managed from the Integrations
// page. Each delivery is HMAC-signed with the subscription's secret so the
// receiver can verify it actually came from this app.

export type WebhookEventName =
  | 'customer.created'
  | 'invoice.created'
  | 'invoice.paid'
  | 'proposal.created'
  | 'proposal.accepted'
  | 'proposal.declined'
  | 'purchaseOrder.received'
  | 'serviceRequest.created'
  | 'signingRequest.signed'
  | 'customer.assigned'

// Writes a persistent in-app notification (bell icon) for the whole company.
// Independent of webhook subscriptions — always fires for these events.
export async function notifyCompany(
  companyId: string, type: WebhookEventName, title: string, body: string, linkTo: string,
): Promise<void> {
  await db.collection('notifications').add({
    companyId, type, title, body, linkTo,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  })
}

export async function dispatchWebhooks(
  companyId: string, event: WebhookEventName, data: Record<string, unknown>,
): Promise<void> {
  const subsSnap = await db.collection('webhookSubscriptions')
    .where('companyId', '==', companyId)
    .where('enabled', '==', true)
    .get()
  if (subsSnap.empty) return

  const body = JSON.stringify({ event, companyId, data, timestamp: new Date().toISOString() })

  for (const subDoc of subsSnap.docs) {
    const sub = subDoc.data()
    const events: unknown[] = Array.isArray(sub['events']) ? sub['events'] : []
    if (!events.includes(event)) continue

    const url = String(sub['url'] ?? '')
    if (!url) continue
    const secret = String(sub['secret'] ?? '')
    const signature = createHmac('sha256', secret).update(body).digest('hex')

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TheLight-Event': event,
          'X-TheLight-Signature': signature,
        },
        body,
      })
      await subDoc.ref.update({
        lastTriggeredAt: FieldValue.serverTimestamp(),
        lastStatus: res.ok ? 'success' : 'failure',
        lastError: res.ok ? null : `HTTP ${res.status}`,
        failureCount: res.ok ? 0 : FieldValue.increment(1),
      })
    } catch (err) {
      console.error(`Webhook delivery to ${url} failed:`, err)
      await subDoc.ref.update({
        lastTriggeredAt: FieldValue.serverTimestamp(),
        lastStatus: 'failure',
        lastError: err instanceof Error ? err.message : 'Unknown error',
        failureCount: FieldValue.increment(1),
      })
    }
  }
}
