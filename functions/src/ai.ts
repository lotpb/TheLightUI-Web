// Model-backed features: lead scoring and reply drafting, with per-company
// daily quotas.

import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { db, auth } from './common'

// ── AI Lead Scoring ────────────────────────────────────────────────────────────
// Callable: fetches active leads for the company, sends them to Claude API,
// and stores scores in LeadScores/{companyId}.
// Set secret: printf 'sk-ant-...' | npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY --data-file -
export const scoreLeads = functions
  .runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const companyId = context.auth.token.companyId as string
    if (!companyId) {
      throw new functions.https.HttpsError('failed-precondition', 'Account not set up')
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new functions.https.HttpsError('unavailable', 'ANTHROPIC_API_KEY secret not configured')
    }

    // Fetch all active records for the company, filter to leads in JS
    const snap = await db.collection('Customers')
      .where('companyId', '==', companyId)
      .limit(200)
      .get()

    const now = Date.now()
    const leads = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((r: Record<string, unknown>) =>
        r['active'] !== '0' &&
        (r['category'] as string | undefined)?.toLowerCase() === 'lead'
      )
      .slice(0, 60)  // cap at 60 to keep token usage reasonable
      .map((r: Record<string, unknown>) => {
        // Customers docs store the creation time as `creationDate` (see
        // customerToFirestore in src/models/customer.ts) — there is no
        // `createdAt` field, so reading one made daysOld ~20,700 for every
        // lead and the "older than 30 days" signal fired universally.
        const created    = (r['creationDate'] as { toMillis?: () => number } | null)?.toMillis?.() ?? 0
        const followUpMs = (r['followUpDate'] as { toMillis?: () => number } | null)?.toMillis?.() ?? null
        const startMs    = (r['start'] as { toMillis?: () => number } | null)?.toMillis?.() ?? null
        const comments   = typeof r['comments'] === 'string' ? r['comments'].trim() : ''
        return {
          id:              r['id'] as string,
          amount:          Number(r['amount']) || 0,
          hasPhone:        Boolean(r['phone']),
          hasEmail:        Boolean(r['email']),
          // `callback` is a Yes/No contacted flag on lead records. It carries a
          // different meaning on vendor records — don't reuse this mapping there.
          isContacted:     (r['callback'] as string | undefined)?.toLowerCase() === 'yes',
          hasAppointment:  startMs !== null && startMs > now,
          // created === 0 means the record predates creationDate being written;
          // report 0 rather than ~20,700 days so the signal stays meaningful.
          daysOld:         created > 0 ? Math.floor((now - created) / 86_400_000) : 0,
          followUpOverdue: followUpMs !== null && followUpMs < now,
          followUpSoon:    followUpMs !== null && followUpMs >= now && followUpMs - now < 3 * 86_400_000,
          // `comments` is a single string on this model, not an array.
          hasComments:     comments.length > 0,
          hasLocation:     Boolean(r['city'] || r['state']),
        }
      })

    if (leads.length === 0) {
      return { scored: 0, message: 'No active leads found' }
    }

    const prompt = `You are a CRM analyst for a home services company. Score each lead 1-10 for likelihood to convert to a paying customer (10 = very hot, 1 = very cold).

Key signals to weigh:
- Has appointment set → strong positive
- isContacted (called back) → positive
- followUpSoon → positive
- Has phone + email → positive
- amount > 0 → positive
- followUpOverdue → negative (missed opportunity)
- daysOld > 30 → slight negative
- hasComments → positive (engagement)

Leads:
${JSON.stringify(leads)}

Respond with ONLY valid JSON, no markdown, no explanation:
{"scores":[{"id":"...","score":7,"reason":"One concise sentence."}]}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('Anthropic API error:', res.status, text)
      throw new functions.https.HttpsError('internal', `AI API error ${res.status}`)
    }

    const json = await res.json() as { content: { type: string; text: string }[] }
    const raw  = json.content.find(c => c.type === 'text')?.text ?? ''

    let parsed: { scores: { id: string; score: number; reason: string }[] }
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('Failed to parse AI response:', raw.slice(0, 500))
      throw new functions.https.HttpsError('internal', 'AI returned invalid JSON')
    }

    const scoresMap: Record<string, { score: number; reason: string }> = {}
    for (const s of parsed.scores) {
      if (s.id && typeof s.score === 'number') {
        scoresMap[s.id] = { score: Math.min(10, Math.max(1, Math.round(s.score))), reason: s.reason ?? '' }
      }
    }

    await db.collection('LeadScores').doc(companyId).set({
      scores:      scoresMap,
      scoredAt:    FieldValue.serverTimestamp(),
      scoredCount: Object.keys(scoresMap).length,
    })

    return { scored: Object.keys(scoresMap).length }
  })

// ── AI-drafted replies ────────────────────────────────────────────────────────
//
// Callable: given a customer and a channel, drafts a suggested reply from the
// recent message thread plus a little customer context. It NEVER sends —
// drafting and sending are separate calls so a human always approves the text
// that goes out.
//
// Uses the same ANTHROPIC_API_KEY secret as scoreLeads. Unlike scoreLeads this
// asks for plain text rather than JSON: a draft has no reason to be wrapped in
// a structure, and JSON.parse on model output is needlessly brittle.
//
// The pure parsing/rendering helpers below mirror src/models/aiDraft.ts, which
// is unit tested — Functions can't import from src/. Keep the two in sync.

type DraftChannel = 'sms' | 'email'

interface DraftThreadMessage {
  direction: 'inbound' | 'outbound'
  body: string
  subject?: string
}

const DRAFT_THREAD_LIMIT = 20

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
}

function parseDraft(raw: string, channel: DraftChannel): { subject: string; body: string } {
  const text = stripCodeFence(raw).trim()
  if (channel === 'sms') return { subject: '', body: text }

  const match = /^subject\s*:\s*(.*)$/im.exec(text.split('\n')[0] ?? '')
  if (!match) return { subject: '', body: text }

  const subject = match[1].trim()
  const body = text.split('\n').slice(1).join('\n').trim()
  if (!body) return { subject: '', body: text }
  return { subject, body }
}

function renderTranscript(messages: DraftThreadMessage[]): string {
  if (!Array.isArray(messages)) return '(no previous messages)'
  const nonEmpty = messages.filter(m => (m?.body ?? '').trim().length > 0)
  if (nonEmpty.length === 0) return '(no previous messages)'

  return nonEmpty
    .slice(-DRAFT_THREAD_LIMIT)
    .map(m => {
      const who = m.direction === 'inbound' ? 'Customer' : 'Us'
      const subject = m.subject?.trim()
      const body = m.body.trim()
      return `${who}: ${subject ? `[${subject}] ${body}` : body}`
    })
    .join('\n')
}

// Per-company daily cap. There's no rate limiting on scoreLeads today; a stuck
// client retry loop calling a paid API is worth guarding against cheaply.
const AI_DRAFTS_PER_DAY = 200

async function checkAiDailyQuota(companyId: string): Promise<boolean> {
  const ref = db.collection('aiUsage').doc(companyId)
  const dayKey = new Date().toISOString().slice(0, 10)
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() ?? {}
    const sameDay = data['dayKey'] === dayKey
    const count = sameDay && typeof data['draftCount'] === 'number' ? data['draftCount'] : 0
    if (count >= AI_DRAFTS_PER_DAY) return false
    tx.set(ref, { dayKey, draftCount: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return true
  })
}

export const draftReply = functions
  .runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    const companyId = context.auth.token.companyId as string
    if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'Account not set up')

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new functions.https.HttpsError('unavailable', 'ANTHROPIC_API_KEY secret not configured')

    const customerId  = String((data ?? {}).customerId ?? '')
    const channel     = String((data ?? {}).channel ?? '') as DraftChannel
    const instruction = String((data ?? {}).instruction ?? '').slice(0, 300).trim()
    if (!customerId) throw new functions.https.HttpsError('invalid-argument', 'customerId is required')
    if (channel !== 'sms' && channel !== 'email') {
      throw new functions.https.HttpsError('invalid-argument', "channel must be 'sms' or 'email'")
    }

    // Never trust a client-supplied customerId — confirm tenancy first.
    const custSnap = await db.collection('Customers').doc(customerId).get()
    const cust = custSnap.data()
    if (!custSnap.exists || String(cust?.['companyId'] ?? '') !== companyId) {
      throw new functions.https.HttpsError('not-found', 'Customer not found')
    }

    if (!await checkAiDailyQuota(companyId)) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Daily limit of ${AI_DRAFTS_PER_DAY} AI drafts reached for this account. Try again tomorrow.`,
      )
    }

    const collectionName = channel === 'sms' ? 'smsMessages' : 'emailMessages'
    const threadSnap = await db.collection(collectionName)
      .where('companyId', '==', companyId)
      .where('customerId', '==', customerId)
      .orderBy('createdAt', 'desc')
      .limit(DRAFT_THREAD_LIMIT)
      .get()

    // Query is newest-first so the limit keeps recent messages; reverse for the
    // transcript so the model reads the conversation forwards.
    const messages: DraftThreadMessage[] = threadSnap.docs.reverse().map(d => {
      const m = d.data()
      return {
        direction: m['direction'] === 'inbound' ? 'inbound' : 'outbound',
        body: String(m['body'] ?? ''),
        subject: channel === 'email' ? String(m['subject'] ?? '') : undefined,
      }
    })

    const profileSnap = await db.collection('companies').doc(companyId)
      .collection('settings').doc('profile').get()
    const businessName = String(profileSnap.data()?.['name'] ?? '').trim()

    const followUpMs = (cust?.['followUpDate'] as { toMillis?: () => number } | null)?.toMillis?.() ?? null
    const customerContext = {
      name:       [cust?.['first'], cust?.['lastname']].filter(Boolean).join(' '),
      city:       String(cust?.['city']  ?? ''),
      state:      String(cust?.['state'] ?? ''),
      category:   String(cust?.['category']   ?? ''),
      leadStatus: String(cust?.['leadStatus'] ?? ''),
      leadSource: String(cust?.['leadSource'] ?? ''),
      job:        String(cust?.['job']     ?? ''),
      product:    String(cust?.['product'] ?? ''),
      amount:     Number(cust?.['amount']) || 0,
      followUpDate: followUpMs ? new Date(followUpMs).toISOString().slice(0, 10) : '',
    }

    const channelRules = channel === 'sms'
      ? [
          '- Plain text only. No markdown, no formatting, no subject line.',
          '- Under 300 characters — this is a text message.',
          '- Do not add a signature block or sign-off name.',
        ].join('\n')
      : [
          '- Start with one line "Subject: <subject>", then a blank line, then the body.',
          '- Body under 150 words.',
          '- Plain text only, no markdown.',
        ].join('\n')

    const prompt = `You are drafting a reply on behalf of ${businessName || 'a home services company'} to one of its customers. Output only the reply itself — no preamble, no explanation, no surrounding quotes.

Customer context:
${JSON.stringify(customerContext)}

Conversation so far (most recent last):
${renderTranscript(messages)}
${instruction ? `\nSpecific instruction from the user: ${instruction}\n` : ''}
Rules:
${channelRules}
- Be warm, direct and professional. Match the customer's tone.
- Never invent prices, dates, appointment times, warranty terms, or any commitment. If a specific fact is needed, leave a short bracketed placeholder like [confirm price] rather than guessing.
- If the customer asked something you cannot answer from the context above, acknowledge it and say someone will confirm shortly.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('draftReply: Anthropic API error', res.status, text)
      throw new functions.https.HttpsError('internal', `AI API error ${res.status}`)
    }

    const json = await res.json() as { content: { type: string; text: string }[] }
    const raw  = json.content.find(c => c.type === 'text')?.text ?? ''
    if (!raw.trim()) {
      throw new functions.https.HttpsError('internal', 'AI returned an empty draft')
    }

    const { subject, body } = parseDraft(raw, channel)
    return { draft: body, subject, threadLength: messages.length }
  })
