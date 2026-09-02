// The public read-only HTTP API, authenticated by hashed API key.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { db, checkApiRateLimit, API_RATE_LIMIT_WINDOW_MS, API_RATE_LIMIT_PER_WINDOW } from './common'

// ── Inbound read API ──────────────────────────────────────────────────────────
// Read-only REST API for external tools, authenticated with an API key
// (Authorization: Bearer <key>) managed from the API Keys page. Only the
// SHA-256 hash of a key is ever stored, so this endpoint hashes the incoming
// key and looks up the matching `apiKeys` doc to resolve companyId + scopes —
// every query below is additionally filtered by that companyId for isolation.

function serializeCustomerForApi(doc: DocumentSnapshot): Record<string, unknown> {
  const d = doc.data() ?? {}
  return {
    id: doc.id,
    first: d['first'] ?? '', lastname: d['lastname'] ?? '',
    email: d['email'] ?? '', phone: d['phone'] ?? '',
    category: d['category'] ?? '', street: d['street'] ?? '', city: d['city'] ?? '',
    state: d['state'] ?? '', zip: d['zip'] ?? '', amount: d['amount'] ?? 0,
  }
}

function serializeInvoiceForApi(doc: DocumentSnapshot): Record<string, unknown> {
  const d = doc.data() ?? {}
  const issueDate = d['issueDate'] as Timestamp | undefined
  const dueDate   = d['dueDate']   as Timestamp | undefined
  return {
    id: doc.id,
    invoiceNumber: d['invoiceNumber'] ?? '', status: d['status'] ?? '',
    customerId: d['customerId'] ?? '', customerName: d['customerName'] ?? '', customerEmail: d['customerEmail'] ?? '',
    issueDate: issueDate?.toDate?.().toISOString() ?? null,
    dueDate:   dueDate?.toDate?.().toISOString()   ?? null,
    lineItems: d['lineItems'] ?? [], taxRate: d['taxRate'] ?? 0,
    currency: d['currency'] ?? 'USD',
  }
}


export const apiRead = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET')
    res.set('Access-Control-Allow-Headers', 'Authorization')
    res.status(204).send('')
    return
  }

  const authHeader = req.get('Authorization') ?? ''
  const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!rawKey) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <key> header' })
    return
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const keySnap = await db.collection('apiKeys').where('keyHash', '==', keyHash).limit(1).get()
  if (keySnap.empty) {
    res.status(401).json({ error: 'Invalid API key' })
    return
  }

  const keyDoc = keySnap.docs[0]
  const keyData = keyDoc.data()
  if (keyData['enabled'] !== true) {
    res.status(403).json({ error: 'API key has been revoked' })
    return
  }

  const withinLimit = await checkApiRateLimit(keyDoc.ref)
  if (!withinLimit) {
    res.set('Retry-After', String(API_RATE_LIMIT_WINDOW_MS / 1000))
    res.status(429).json({ error: `Rate limit exceeded: max ${API_RATE_LIMIT_PER_WINDOW} requests per minute per API key` })
    return
  }

  const companyId = String(keyData['companyId'] ?? '')
  const scopes: string[] = Array.isArray(keyData['scopes']) ? keyData['scopes'] : []
  if (!companyId) {
    res.status(500).json({ error: 'API key is missing a company' })
    return
  }
  await keyDoc.ref.update({ lastUsedAt: FieldValue.serverTimestamp() })

  const segments = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const [resource, sub] = segments

  try {
    if (resource === 'customers') {
      if (!scopes.includes('customers.read')) {
        res.status(403).json({ error: 'API key is missing scope: customers.read' })
        return
      }

      if (sub === 'lookup') {
        const email = String(req.query.email ?? '').trim().toLowerCase()
        if (!email) {
          res.status(400).json({ error: 'Provide ?email= to look up a customer' })
          return
        }
        const snap = await db.collection('Customers')
          .where('companyId', '==', companyId)
          .where('email', '==', email)
          .limit(5)
          .get()
        res.json({ data: snap.docs.map(serializeCustomerForApi) })
        return
      }

      if (sub) {
        const doc = await db.collection('Customers').doc(sub).get()
        if (!doc.exists || doc.data()?.['companyId'] !== companyId) {
          res.status(404).json({ error: 'Customer not found' })
          return
        }
        res.json({ data: serializeCustomerForApi(doc) })
        return
      }

      res.status(400).json({ error: 'Specify /customers/:id or /customers/lookup?email=' })
      return
    }

    if (resource === 'invoices') {
      if (!scopes.includes('invoices.read')) {
        res.status(403).json({ error: 'API key is missing scope: invoices.read' })
        return
      }

      if (sub) {
        const doc = await db.collection('Invoices').doc(sub).get()
        if (!doc.exists || doc.data()?.['companyId'] !== companyId) {
          res.status(404).json({ error: 'Invoice not found' })
          return
        }
        res.json({ data: serializeInvoiceForApi(doc) })
        return
      }

      const status = req.query.status ? String(req.query.status) : null
      let q = db.collection('Invoices').where('companyId', '==', companyId) as FirebaseFirestore.Query
      if (status) q = q.where('status', '==', status)
      const snap = await q.limit(50).get()
      res.json({ data: snap.docs.map(serializeInvoiceForApi) })
      return
    }

    res.status(404).json({ error: 'Unknown resource. Available: /customers, /invoices' })
  } catch (err) {
    console.error('apiRead error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})
