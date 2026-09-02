// Facebook Lead Ads: OAuth, page subscription, and lead ingestion.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { db, assertCompanyAdmin, lastTenDigits, checkApiRateLimit } from './common'

// ─── Facebook Lead Ads ────────────────────────────────────────────────────────
//
// Auto-imports Facebook Lead Ad submissions as CRM leads so nobody has to
// re-type them out of Ads Manager.
//
// Setup: create an app at https://developers.facebook.com, add the Facebook
// Login product (Valid OAuth Redirect URI = the facebookOAuthCallback URL
// below) and the Webhooks product (object "Page", subscribed field "leadgen",
// callback = the facebookLeadWebhook URL, verify token =
// FACEBOOK_WEBHOOK_VERIFY_TOKEN). Set secrets FACEBOOK_APP_ID /
// FACEBOOK_APP_SECRET / FACEBOOK_WEBHOOK_VERIFY_TOKEN.
//
// leads_retrieval and pages_manage_metadata require Advanced Access via Meta
// App Review plus business verification — until that clears, only users with a
// role on the Meta app can complete the connect flow.
//
// Flow: facebookConnect → Meta OAuth → facebookOAuthCallback stores a
// long-lived user token plus one token per Page → facebookSubscribePage
// subscribes a Page to `leadgen` and registers it in facebookPageIndex →
// facebookLeadWebhook receives a leadgen_id, fetches the answers from the Graph
// API, and writes a Customers doc with category 'Lead' (which is what makes
// onLeadCreated fire the team notification — no extra wiring here).

const FACEBOOK_GRAPH_VERSION = 'v21.0'
const FACEBOOK_GRAPH_BASE    = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`
const FACEBOOK_REDIRECT_URI  = 'https://us-central1-thelightui.cloudfunctions.net/facebookOAuthCallback'
const FACEBOOK_SCOPES        = 'pages_show_list,pages_read_engagement,pages_manage_metadata,leads_retrieval'
const FACEBOOK_LEAD_SOURCE   = 'Facebook Lead Ad'

interface FacebookPageToken { id: string; name: string; accessToken: string }

// Graph error codes that mean the stored credentials no longer work and the
// user has to reconnect, rather than a transient failure worth retrying.
const FACEBOOK_REAUTH_CODES = new Set([102, 190, 200, 458, 463, 467])

class FacebookGraphError extends Error {
  code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = 'FacebookGraphError'
    this.code = code
  }
}

function facebookTokensRef(companyId: string) {
  return db.collection('facebookTokens').doc(companyId)
}

function facebookStatusRef(companyId: string) {
  return db.collection('companies').doc(companyId).collection('settings').doc('facebookStatus')
}

async function graphGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res  = await fetch(`${FACEBOOK_GRAPH_BASE}${path}?${new URLSearchParams(params).toString()}`)
  const json = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const error = json['error'] as Record<string, unknown> | undefined
    throw new FacebookGraphError(
      String(error?.['message'] ?? `Graph request failed (${res.status})`),
      Number(error?.['code'] ?? 0),
    )
  }
  return json
}


export const facebookConnect = functions
  .runWith({ secrets: ['FACEBOOK_APP_ID'] })
  .https.onCall(async (_data, context) => {
    const companyId = await assertCompanyAdmin(context)

    const appId = process.env.FACEBOOK_APP_ID
    if (!appId) throw new functions.https.HttpsError('unavailable', 'Facebook integration is not configured')

    const state = randomUUID()
    await db.collection('oauthStates').doc(state).set({
      companyId, provider: 'facebook', createdAt: FieldValue.serverTimestamp(),
    })

    const url = `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth?` + new URLSearchParams({
      client_id: appId,
      redirect_uri: FACEBOOK_REDIRECT_URI,
      response_type: 'code',
      scope: FACEBOOK_SCOPES,
      state,
    }).toString()

    return { url }
  })

export const facebookOAuthCallback = functions
  .runWith({ secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] })
  .https.onRequest(async (req, res) => {
    const { code, state } = req.query as Record<string, string>
    try {
      if (!code || !state) throw new Error('Missing code/state')

      const stateSnap = await db.collection('oauthStates').doc(state).get()
      if (!stateSnap.exists) throw new Error('Invalid or expired state')
      const stateData = stateSnap.data() ?? {}
      const companyId = String(stateData['companyId'] ?? '')
      await stateSnap.ref.delete()
      if (!companyId) throw new Error('No company on state')
      if (String(stateData['provider'] ?? '') !== 'facebook') throw new Error('State was not issued for Facebook')

      const appId     = process.env.FACEBOOK_APP_ID!
      const appSecret = process.env.FACEBOOK_APP_SECRET!

      const shortJson  = await graphGet('/oauth/access_token', {
        client_id: appId, client_secret: appSecret, redirect_uri: FACEBOOK_REDIRECT_URI, code,
      })
      const shortToken = String(shortJson['access_token'] ?? '')
      if (!shortToken) throw new Error('No access token returned')

      // Short-lived tokens last ~1h; exchanging gives ~60 days, which is what
      // makes unattended lead ingestion viable between reconnects.
      const longJson  = await graphGet('/oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken,
      })
      const userToken = String(longJson['access_token'] ?? shortToken)
      const expiresIn = Number(longJson['expires_in'] ?? 0)
      const expiresAt = expiresIn > 0 ? Timestamp.fromMillis(Date.now() + expiresIn * 1000) : null

      const me       = await graphGet('/me', { access_token: userToken, fields: 'id,name' })
      const accounts = await graphGet('/me/accounts', { access_token: userToken, fields: 'id,name,access_token' })

      const pages: FacebookPageToken[] = (Array.isArray(accounts['data']) ? accounts['data'] : [])
        .map((raw) => {
          const page = raw as Record<string, unknown>
          return {
            id:          String(page['id']           ?? ''),
            name:        String(page['name']         ?? ''),
            accessToken: String(page['access_token'] ?? ''),
          }
        })
        .filter(p => p.id && p.accessToken)

      await facebookTokensRef(companyId).set({
        userAccessToken: userToken,
        userTokenExpiresAt: expiresAt,
        pages,
        scopes: FACEBOOK_SCOPES.split(','),
        updatedAt: FieldValue.serverTimestamp(),
      })

      // Merged, not overwritten: a reconnect must not drop subscribedPages,
      // which is what facebookPageIndex is keyed against.
      await facebookStatusRef(companyId).set({
        connected: true,
        connectedAt: FieldValue.serverTimestamp(),
        fbUserName: String(me['name'] ?? ''),
        availablePages: pages.map(p => ({ id: p.id, name: p.name })),
        userTokenExpiresAt: expiresAt,
        needsReauth: false,
        lastError: '',
      }, { merge: true })

      res.redirect(302, 'https://thelightui.web.app/facebook-leads?connected=1')
    } catch (err) {
      console.error('facebookOAuthCallback error:', err)
      res.redirect(302, 'https://thelightui.web.app/facebook-leads?connected=0')
    }
  })

export const facebookSubscribePage = functions
  .runWith({ secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] })
  .https.onCall(async (data, context) => {
    const companyId = await assertCompanyAdmin(context)
    const pageId    = String((data ?? {}).pageId ?? '')
    const subscribe = (data ?? {}).subscribe !== false
    if (!pageId) throw new functions.https.HttpsError('invalid-argument', 'pageId is required')

    const tokenSnap = await facebookTokensRef(companyId).get()
    if (!tokenSnap.exists) throw new functions.https.HttpsError('failed-precondition', 'Facebook is not connected')
    const pages = (tokenSnap.data()?.['pages'] ?? []) as FacebookPageToken[]
    const page  = pages.find(p => p.id === pageId)
    if (!page) throw new functions.https.HttpsError('not-found', 'That Page is not available on this connection')

    // facebookPageIndex is the tenancy lookup for the webhook, so a Page can
    // only ever route to one company.
    const indexRef  = db.collection('facebookPageIndex').doc(pageId)
    const indexSnap = await indexRef.get()
    const owner     = String(indexSnap.data()?.['companyId'] ?? '')
    if (subscribe && owner && owner !== companyId) {
      throw new functions.https.HttpsError('already-exists', 'That Facebook Page is already connected to another account')
    }

    const url = `${FACEBOOK_GRAPH_BASE}/${pageId}/subscribed_apps?` + new URLSearchParams({
      access_token: page.accessToken,
      subscribed_fields: 'leadgen',
    }).toString()
    const graphRes  = await fetch(url, { method: subscribe ? 'POST' : 'DELETE' })
    const graphJson = await graphRes.json().catch(() => ({})) as Record<string, unknown>
    if (!graphRes.ok) {
      const error   = graphJson['error'] as Record<string, unknown> | undefined
      const message = String(error?.['message'] ?? 'Facebook rejected the subscription request')
      if (FACEBOOK_REAUTH_CODES.has(Number(error?.['code'] ?? 0))) {
        await facebookStatusRef(companyId).set({
          needsReauth: true, lastError: message, lastErrorAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      throw new functions.https.HttpsError('internal', message)
    }

    const entry = { id: page.id, name: page.name }
    if (subscribe) {
      await indexRef.set({
        companyId,
        pageName: page.name,
        subscribedAt: FieldValue.serverTimestamp(),
        rateLimitWindowStart: Timestamp.now(),
        rateLimitCount: 0,
      })
      await facebookStatusRef(companyId).set({
        subscribedPages: FieldValue.arrayUnion(entry),
      }, { merge: true })
    } else {
      if (owner === companyId) await indexRef.delete().catch(() => {})
      await facebookStatusRef(companyId).set({
        subscribedPages: FieldValue.arrayRemove(entry),
      }, { merge: true })
    }

    return { success: true }
  })

export const facebookDisconnect = functions
  .runWith({ secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] })
  .https.onCall(async (_data, context) => {
    const companyId = await assertCompanyAdmin(context)

    const tokenRef  = facebookTokensRef(companyId)
    const tokenSnap = await tokenRef.get()
    const data      = tokenSnap.data() ?? {}
    const pages     = (data['pages'] ?? []) as FacebookPageToken[]
    const userToken = String(data['userAccessToken'] ?? '')

    for (const page of pages) {
      try {
        await fetch(
          `${FACEBOOK_GRAPH_BASE}/${page.id}/subscribed_apps?access_token=${encodeURIComponent(page.accessToken)}`,
          { method: 'DELETE' },
        )
      } catch (err) {
        console.error('facebookDisconnect: unsubscribe failed for page', page.id, err)
      }
      // Only clear index entries this company actually owns.
      const indexRef  = db.collection('facebookPageIndex').doc(page.id)
      const indexSnap = await indexRef.get()
      if (String(indexSnap.data()?.['companyId'] ?? '') === companyId) {
        await indexRef.delete().catch(() => {})
      }
    }

    if (userToken) {
      try {
        await fetch(
          `${FACEBOOK_GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(userToken)}`,
          { method: 'DELETE' },
        )
      } catch (err) {
        console.error('facebookDisconnect: permission revoke failed (clearing local connection anyway):', err)
      }
    }

    await tokenRef.delete()
    await facebookStatusRef(companyId).set({
      connected: false, subscribedPages: [], availablePages: [],
      needsReauth: false, lastError: '',
    }, { merge: true })

    return { success: true }
  })

// ── Facebook lead field mapping ───────────────────────────────────────────────
//
// Mirror of src/models/facebookLead.ts, which is unit tested — Cloud Functions
// can't import from src/. Keep the two in sync when editing.

interface FacebookFieldDatum { name: string; values: string[] }

interface MappedFacebookLead {
  first: string; lastname: string; email: string; phone: string; street: string
  city: string; state: string; zip: string; companyName: string
  comments: string; customFields: Record<string, string>
}

const FACEBOOK_DIRECT_FIELDS: Record<string, keyof MappedFacebookLead> = {
  email:          'email',
  phone_number:   'phone',
  street_address: 'street',
  city:           'city',
  state:          'state',
  province:       'state',
  zip_code:       'zip',
  post_code:      'zip',
  company_name:   'companyName',
}

const FACEBOOK_NAME_FIELDS = new Set(['full_name', 'first_name', 'last_name'])

function splitFullName(full: string): { first: string; lastname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', lastname: '' }
  if (parts.length === 1) return { first: parts[0], lastname: '' }
  return { first: parts.slice(0, -1).join(' '), lastname: parts[parts.length - 1] }
}

function humanizeFieldName(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim()
  if (!spaced) return name
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function mapFacebookLeadFields(fieldData: FacebookFieldDatum[]): MappedFacebookLead {
  const lead: MappedFacebookLead = {
    first: '', lastname: '', email: '', phone: '', street: '',
    city: '', state: '', zip: '', companyName: '', comments: '', customFields: {},
  }
  if (!Array.isArray(fieldData)) return lead

  let fullName = ''
  let explicitFirst = ''
  let explicitLast = ''
  const commentLines: string[] = []

  for (const datum of fieldData) {
    const name = typeof datum?.name === 'string' ? datum.name.trim().toLowerCase() : ''
    if (!name) continue

    const value = Array.isArray(datum.values)
      ? datum.values.map(v => String(v ?? '').trim()).filter(Boolean).join(', ')
      : ''
    if (!value) continue

    if (FACEBOOK_NAME_FIELDS.has(name)) {
      if (name === 'full_name')  fullName = value
      if (name === 'first_name') explicitFirst = value
      if (name === 'last_name')  explicitLast = value
      continue
    }

    const target = FACEBOOK_DIRECT_FIELDS[name]
    if (target) {
      if (!lead[target]) (lead[target] as string) = value
      continue
    }

    lead.customFields[datum.name] = value
    commentLines.push(`${humanizeFieldName(datum.name)}: ${value}`)
  }

  const fromFull = splitFullName(fullName)
  lead.first    = explicitFirst || fromFull.first
  lead.lastname = explicitLast  || fromFull.lastname
  lead.comments = commentLines.join('\n')

  return lead
}

// Builds the Firestore-shaped Customer doc. Mirrors customerToFirestore() in
// src/models/customer.ts, including the empty defaults, so a Facebook lead
// parses identically to one created in the app.
function facebookLeadToCustomerDoc(
  lead: MappedFacebookLead,
  meta: {
    companyId: string; pageId: string; formId: string
    adId: string; leadgenId: string; creationDate: Timestamp
  },
): Record<string, unknown> {
  return {
    first: lead.first,
    lastname: lead.lastname,
    phone: lead.phone,
    email: lead.email,
    street: lead.street,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    companyName: lead.companyName,
    comments: lead.comments,

    // category 'Lead' is what makes onLeadCreated fire.
    category: 'Lead',
    active: '1',
    leadSource: FACEBOOK_LEAD_SOURCE,
    leadStatus: 'New',
    tags: [FACEBOOK_LEAD_SOURCE],
    adNo: meta.adId,

    // Unassigned on arrival; assigning later triggers onCustomerAssigned.
    assignedToUid: '',
    salesman: '',

    companyId: meta.companyId,
    createdByName: 'Facebook Lead Ads',
    creationDate: meta.creationDate,
    lastUpdate: Timestamp.now(),

    customFields: {
      ...lead.customFields,
      fbLeadgenId: meta.leadgenId,
      fbFormId: meta.formId,
      fbPageId: meta.pageId,
    },

    contractor: '', job: '', product: '', spouse: '', photo: '',
    callback: '', birthDate: '', driverLicense: '', profession: '', manager: '',
    paymentTerms: '', taxId: '', accountNumber: '', payType: '',
    userRole: '', lastLogin: '', employeeStatus: '', paymentStatus: '',
    lastContactDate: '',
    amount: 0, rate: 0, quan: 0, commissionRate: 0, contactAttempts: 0,
    start: null, completion: null, followUpDate: null,
  }
}

async function recordFacebookLeadError(
  companyId: string, pageId: string, leadgenId: string, stage: string, message: string,
): Promise<void> {
  await db.collection('facebookLeadErrors').add({
    companyId, pageId, leadgenId, stage, message, createdAt: FieldValue.serverTimestamp(),
  }).catch(err => console.error('recordFacebookLeadError failed:', err))
}

async function facebookPageAccessToken(companyId: string, pageId: string): Promise<string> {
  const snap  = await facebookTokensRef(companyId).get()
  const pages = (snap.data()?.['pages'] ?? []) as FacebookPageToken[]
  const page  = pages.find(p => p.id === pageId)
  if (!page?.accessToken) {
    throw new FacebookGraphError(`No stored access token for Page ${pageId}; reconnect Facebook`, 190)
  }
  return page.accessToken
}

// Verifies Meta's X-Hub-Signature-256: HMAC-SHA256 of the *raw* body keyed by
// the app secret. Must use rawBody — re-serializing the parsed JSON changes
// byte-for-byte content and the digest won't match.
function verifyFacebookSignature(rawBody: Buffer, header: string, appSecret: string): boolean {
  const provided = header.startsWith('sha256=') ? header.slice(7) : ''
  if (!provided) return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(provided, 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// Checks for an existing Customer before a Facebook lead creates a new one —
// the app already has a Duplicates page for this exact problem, and without
// this check every repeat ad click or existing customer re-submitting a lead
// form creates a fresh record. Mirrors smsInboundWebhook's phone-matching
// shape (exact match first, then a bounded scan for free-text formats /
// mixed-case emails that an exact query would miss), extended to also check
// email since Facebook lead forms usually supply one.
async function findExistingCustomerForFacebookLead(
  companyId: string, phone: string, email: string,
): Promise<string> {
  if (phone) {
    const exact = await db.collection('Customers')
      .where('companyId', '==', companyId).where('phone', '==', phone).limit(1).get()
    if (!exact.empty) return exact.docs[0].id
  }
  if (email) {
    const exact = await db.collection('Customers')
      .where('companyId', '==', companyId).where('email', '==', email).limit(1).get()
    if (!exact.empty) return exact.docs[0].id
  }
  if (!phone && !email) return ''

  const targetPhone = phone ? lastTenDigits(phone) : ''
  const targetEmail = email.toLowerCase()
  const scanSnap = await db.collection('Customers').where('companyId', '==', companyId).limit(2000).get()
  const match = scanSnap.docs.find(d => {
    const data = d.data()
    if (targetPhone && lastTenDigits(String(data['phone'] ?? '')) === targetPhone) return true
    if (targetEmail && String(data['email'] ?? '').toLowerCase() === targetEmail) return true
    return false
  })
  return match?.id ?? ''
}

async function ingestFacebookLead(value: Record<string, unknown>): Promise<void> {
  const leadgenId   = String(value['leadgen_id'] ?? '')
  const pageId      = String(value['page_id']    ?? '')
  const formId      = String(value['form_id']    ?? '')
  const adId        = String(value['ad_id']      ?? '')
  const createdTime = Number(value['created_time'] ?? 0)

  if (!leadgenId || !pageId) {
    console.error('facebookLeadWebhook: change is missing leadgen_id/page_id', value)
    return
  }

  const indexRef  = db.collection('facebookPageIndex').doc(pageId)
  const indexSnap = await indexRef.get()
  const companyId = String(indexSnap.data()?.['companyId'] ?? '')
  if (!companyId) {
    console.error('facebookLeadWebhook: no company mapped for page', pageId)
    return
  }

  if (!await checkApiRateLimit(indexRef)) {
    console.error('facebookLeadWebhook: rate limit exceeded for page', pageId)
    await recordFacebookLeadError(
      companyId, pageId, leadgenId, 'rate-limit',
      'More leads arrived for this Page than the per-minute limit allows; this one was dropped',
    )
    return
  }

  // Idempotency: Meta retries deliveries and can send duplicates, so a claim
  // doc keyed on leadgen_id is created first — a duplicate loses the race and
  // returns without writing a second lead.
  const claimRef = db.collection('facebookLeadgenIds').doc(leadgenId)
  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(claimRef)).exists) throw new Error('DUPLICATE_LEAD')
      tx.create(claimRef, {
        companyId, pageId, formId, adId, customerId: '',
        receivedAt: FieldValue.serverTimestamp(),
      })
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'DUPLICATE_LEAD') return
    throw err
  }

  try {
    const pageToken = await facebookPageAccessToken(companyId, pageId)
    const detail    = await graphGet(`/${leadgenId}`, {
      access_token: pageToken,
      fields: 'field_data,created_time,ad_id,form_id',
    })

    const fieldData = (Array.isArray(detail['field_data']) ? detail['field_data'] : []) as FacebookFieldDatum[]
    const mapped    = mapFacebookLeadFields(fieldData)

    const existingCustomerId = await findExistingCustomerForFacebookLead(companyId, mapped.phone, mapped.email)

    let customerId: string
    if (existingCustomerId) {
      // Already a Customer/Lead — add a note instead of creating a duplicate.
      // Deliberately doesn't touch category/status: a repeat lead doesn't
      // necessarily mean they're a fresh lead again, that's a judgment call
      // for staff, not something this webhook should decide.
      customerId = existingCustomerId
      const existingSnap = await db.collection('Customers').doc(existingCustomerId).get()
      const existingComments = String(existingSnap.data()?.['comments'] ?? '')
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const noteBody = mapped.comments ? `Submitted another Facebook lead form:\n${mapped.comments}` : 'Submitted another Facebook lead form.'
      const noteEntry = `--- [${dateStr}] ---\n[Facebook Lead Ad] ${noteBody}`
      await db.collection('Customers').doc(existingCustomerId).update({
        comments: existingComments.trim() ? `${noteEntry}\n\n${existingComments}` : noteEntry,
      })
    } else {
      const customerRef = await db.collection('Customers').add(facebookLeadToCustomerDoc(mapped, {
        companyId,
        pageId,
        formId: formId || String(detail['form_id'] ?? ''),
        adId:   adId   || String(detail['ad_id']   ?? ''),
        leadgenId,
        creationDate: createdTime > 0 ? Timestamp.fromMillis(createdTime * 1000) : Timestamp.now(),
      }))
      customerId = customerRef.id
    }

    await claimRef.update({ customerId })
    await facebookStatusRef(companyId).set({
      lastLeadAt: FieldValue.serverTimestamp(), lastError: '',
    }, { merge: true })
  } catch (err) {
    // Release the claim so Meta's retry gets another chance at this lead.
    await claimRef.delete().catch(() => {})

    const message = err instanceof Error ? err.message : String(err)
    const code    = err instanceof FacebookGraphError ? err.code : 0
    const update: Record<string, unknown> = {
      lastError: message, lastErrorAt: FieldValue.serverTimestamp(),
    }
    if (FACEBOOK_REAUTH_CODES.has(code)) update['needsReauth'] = true

    await facebookStatusRef(companyId).set(update, { merge: true })
    await recordFacebookLeadError(companyId, pageId, leadgenId, 'fetch-or-write', message)
    console.error('facebookLeadWebhook: failed to ingest lead', leadgenId, err)
  }
}

export const facebookLeadWebhook = functions
  .runWith({ secrets: ['FACEBOOK_APP_SECRET', 'FACEBOOK_WEBHOOK_VERIFY_TOKEN'] })
  .https.onRequest(async (req, res) => {
    // Verification handshake — Meta calls this once when the webhook is saved.
    if (req.method === 'GET') {
      const expected = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN ?? ''
      const mode     = String(req.query['hub.mode']         ?? '')
      const token    = String(req.query['hub.verify_token'] ?? '')
      if (mode === 'subscribe' && expected && token === expected) {
        res.status(200).send(String(req.query['hub.challenge'] ?? ''))
      } else {
        console.error('facebookLeadWebhook: verification handshake failed')
        res.status(403).send('forbidden')
      }
      return
    }

    if (req.method !== 'POST') {
      res.status(405).send('method not allowed')
      return
    }

    const appSecret = process.env.FACEBOOK_APP_SECRET ?? ''
    const signature = req.get('X-Hub-Signature-256') ?? ''
    if (!appSecret || !req.rawBody || !verifyFacebookSignature(req.rawBody, signature, appSecret)) {
      console.error('facebookLeadWebhook: signature verification failed')
      res.status(403).send('forbidden')
      return
    }

    // Past this point always 200: Meta retries on any non-2xx and disables the
    // subscription after repeated failures, so per-lead problems are recorded
    // in facebookLeadErrors rather than surfaced as an HTTP error.
    try {
      const body    = (req.body ?? {}) as Record<string, unknown>
      const entries = Array.isArray(body['entry']) ? body['entry'] : []
      for (const entryRaw of entries) {
        const changes = (entryRaw as Record<string, unknown>)['changes']
        for (const changeRaw of Array.isArray(changes) ? changes : []) {
          const change = changeRaw as Record<string, unknown>
          if (String(change['field'] ?? '') !== 'leadgen') continue
          await ingestFacebookLead((change['value'] ?? {}) as Record<string, unknown>)
        }
      }
    } catch (err) {
      console.error('facebookLeadWebhook error:', err)
    }

    res.status(200).send('ok')
  })
