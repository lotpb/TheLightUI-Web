import { formatCurrency, type CustomerItem } from './customer'

/**
 * Duplicate detection and merge planning for /duplicates.
 *
 * Lived inline in the page, where three things were wrong in ways a reader
 * couldn't see: detection ran over deactivated records so a completed merge
 * kept reappearing forever, the fuzzy pass was O(n²) blocked only by one
 * letter, and the merge plan wrote a field name no other write path uses.
 */

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function normalizeName(c: Pick<CustomerItem, 'first' | 'lastname'>): string {
  return `${c.first.trim()} ${c.lastname.trim()}`.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Classic single-row Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1])
    }
    prev = row
  }
  return prev[b.length]
}

export type DupeReason = 'phone' | 'email' | 'name' | 'fuzzy-name'

export const REASON_LABEL: Record<DupeReason, string> = {
  phone: 'Same phone',
  email: 'Same email',
  name: 'Same name',
  'fuzzy-name': 'Similar name',
}

/**
 * Badge classes per reason.
 *
 * All four combinations have explicit light-mode rules in index.css keyed on
 * this exact `bg-X-900/40` + `text-X-400` pairing, so these strings and that
 * stylesheet have to stay in step — duplicates.test.ts checks they do.
 */
export const REASON_BADGE: Record<DupeReason, string> = {
  phone: 'bg-orange-900/40 text-orange-400',
  email: 'bg-sky-900/40 text-sky-400',
  name: 'bg-yellow-900/40 text-yellow-400',
  'fuzzy-name': 'bg-violet-900/40 text-violet-400',
}

const REASON_ORDER: Record<DupeReason, number> = {
  phone: 0, email: 1, name: 2, 'fuzzy-name': 3,
}

export interface DupePair {
  /** Stable, order-independent id for the pair. */
  key: string
  reason: DupeReason
  matchValue: string
  /** 0–1, only set for fuzzy-name. */
  similarity?: number
  a: CustomerItem
  b: CustomerItem
}

export interface DetectionResult {
  pairs: DupePair[]
  /** Records considered, after dropping deactivated ones. */
  scanned: number
  /**
   * True when the fuzzy pass stopped early.
   *
   * The comparison budget exists because the pass was blocked only by the
   * first letter of the last name: on a five-thousand record book an "S"
   * block can hold five hundred people, which is 125,000 Levenshtein calls
   * synchronously inside a useMemo, freezing the tab with `loading` already
   * false so nothing on screen explains the stall.
   */
  fuzzyTruncated: boolean
}

/** Ceiling on fuzzy comparisons per detection run. */
export const FUZZY_COMPARISON_BUDGET = 200_000

/** Edit distance a fuzzy match allows, which also bounds the length prefilter. */
const FUZZY_MAX_DISTANCE = 3
const FUZZY_MIN_SIMILARITY = 0.75
const FUZZY_MIN_LENGTH = 5

function pairsWithin<T>(group: T[], visit: (a: T, b: T) => void): void {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) visit(group[i], group[j])
  }
}

function groupBy(items: CustomerItem[], keyOf: (c: CustomerItem) => string | null): Map<string, CustomerItem[]> {
  const map = new Map<string, CustomerItem[]>()
  for (const c of items) {
    const k = keyOf(c)
    if (k === null) continue
    const group = map.get(k)
    if (group) group.push(c)
    else map.set(k, [c])
  }
  return map
}

export function findDuplicates(items: CustomerItem[]): DetectionResult {
  /**
   * Deactivated records are excluded, which is what makes a merge actually
   * leave the queue. Detection ran over everything, so the record a merge had
   * just retired kept matching its survivor forever, and the only thing hiding
   * it was a local dismissal. It also means a three-way duplicate resolves
   * correctly: merging A into B retires A, B–C survives as a real pair, and
   * A–C disappears rather than offering to merge into a retired record.
   */
  const active = items.filter(c => c.isActive)

  const pairs = new Map<string, DupePair>()

  function addPair(a: CustomerItem, b: CustomerItem, reason: DupeReason, matchValue: string, similarity?: number) {
    const [id1, id2] = [a.id, b.id].sort()
    const key = `${id1}|${id2}`
    const existing = pairs.get(key)
    // An exact match outranks a fuzzy guess about the same two records.
    if (!existing || (existing.reason === 'fuzzy-name' && reason !== 'fuzzy-name')) {
      pairs.set(key, { key, reason, matchValue, similarity, a, b })
    }
  }

  // Phone — digits only, at least 7 so extensions and junk don't collide.
  for (const [phone, group] of groupBy(active, c => {
    const p = normalizePhone(c.phone)
    return p.length >= 7 ? p : null
  })) {
    if (group.length > 1) pairsWithin(group, (a, b) => addPair(a, b, 'phone', phone))
  }

  // Email
  for (const [email, group] of groupBy(active, c => {
    const e = normalizeEmail(c.email)
    return e.includes('@') ? e : null
  })) {
    if (group.length > 1) pairsWithin(group, (a, b) => addPair(a, b, 'email', email))
  }

  // Exact name — both parts required, so a record with only a surname doesn't
  // match every other record with only that surname.
  for (const [name, group] of groupBy(active, c =>
    c.first.trim() && c.lastname.trim() ? normalizeName(c) : null,
  )) {
    if (group.length > 1) pairsWithin(group, (a, b) => addPair(a, b, 'name', name))
  }

  // Fuzzy name — catches typos and nicknames exact matching misses.
  let comparisons = 0
  let fuzzyTruncated = false

  const blocks = groupBy(active, c => {
    const last = c.lastname.trim()
    return last.length >= 2 ? last[0].toLowerCase() : null
  })

  for (const group of blocks.values()) {
    if (group.length < 2) continue
    // Precomputed once per record instead of once per comparison, and sorted
    // by length so the prefilter below can stop scanning a row early.
    const prepared = group
      .map(c => ({ c, name: normalizeName(c) }))
      .filter(x => x.name.length >= FUZZY_MIN_LENGTH)
      .sort((x, y) => x.name.length - y.name.length)

    for (let i = 0; i < prepared.length; i++) {
      for (let j = i + 1; j < prepared.length; j++) {
        const a = prepared[i], b = prepared[j]
        // Sorted by length, so once the gap exceeds the maximum distance
        // nothing further in this row can match either.
        if (b.name.length - a.name.length > FUZZY_MAX_DISTANCE) break
        if (a.name === b.name) continue

        if (comparisons >= FUZZY_COMPARISON_BUDGET) { fuzzyTruncated = true; break }
        comparisons++

        const maxLen = Math.max(a.name.length, b.name.length)
        const dist = levenshtein(a.name, b.name)
        const similarity = 1 - dist / maxLen
        if (dist > 0 && dist <= FUZZY_MAX_DISTANCE && similarity >= FUZZY_MIN_SIMILARITY) {
          addPair(a.c, b.c, 'fuzzy-name', `${a.name} ≈ ${b.name}`, similarity)
        }
      }
      if (fuzzyTruncated) break
    }
    if (fuzzyTruncated) break
  }

  const sorted = [...pairs.values()].sort((x, y) =>
    x.reason !== y.reason
      ? REASON_ORDER[x.reason] - REASON_ORDER[y.reason]
      : x.matchValue.localeCompare(y.matchValue),
  )

  return { pairs: sorted, scanned: active.length, fuzzyTruncated }
}

export type FilterMode = 'all' | DupeReason

export const DUPE_FILTERS: { id: FilterMode; label: string }[] = [
  { id: 'all',        label: 'All' },
  { id: 'phone',      label: REASON_LABEL.phone },
  { id: 'email',      label: REASON_LABEL.email },
  { id: 'name',       label: REASON_LABEL.name },
  { id: 'fuzzy-name', label: REASON_LABEL['fuzzy-name'] },
]

export function countByReason(pairs: DupePair[]): Record<FilterMode, number> {
  const counts: Record<FilterMode, number> = {
    all: pairs.length, phone: 0, email: 0, name: 0, 'fuzzy-name': 0,
  }
  for (const p of pairs) counts[p.reason]++
  return counts
}

export function filterPairs(
  pairs: DupePair[], dismissed: ReadonlySet<string>, filter: FilterMode,
): DupePair[] {
  const live = pairs.filter(p => !dismissed.has(p.key))
  return filter === 'all' ? live : live.filter(p => p.reason === filter)
}

// ── Merge planning ────────────────────────────────────────────────────────────

export interface MergeChange {
  label: string
  from: string
  action: 'fill' | 'combine'
  firestoreKey: string
  value: unknown
}

/**
 * Fields a merge can carry across, and the Firestore key each writes to.
 *
 * `street` used to be written as `address`. That still worked — fromFirestore
 * documents a `street || address` fallback — but it was the only writer in the
 * app targeting the legacy alias, leaving a field that customerToFirestore
 * would never update again. It writes `street` now, like everything else.
 */
const MERGE_STRING_FIELDS: { key: keyof CustomerItem; label: string; fsKey: string }[] = [
  { key: 'phone',         label: 'Phone',        fsKey: 'phone' },
  { key: 'email',         label: 'Email',        fsKey: 'email' },
  { key: 'street',        label: 'Street',       fsKey: 'street' },
  { key: 'city',          label: 'City',         fsKey: 'city' },
  { key: 'state',         label: 'State',        fsKey: 'state' },
  { key: 'zip',           label: 'ZIP',          fsKey: 'zip' },
  { key: 'salesman',      label: 'Salesman',     fsKey: 'salesman' },
  { key: 'adNo',          label: 'Ad source',    fsKey: 'adNo' },
  { key: 'leadSource',    label: 'Lead source',  fsKey: 'leadSource' },
  { key: 'product',       label: 'Product',      fsKey: 'product' },
  { key: 'contractor',    label: 'Contractor',   fsKey: 'contractor' },
  { key: 'job',           label: 'Job',          fsKey: 'job' },
  { key: 'spouse',        label: 'Spouse',       fsKey: 'spouse' },
  { key: 'birthDate',     label: 'Birth date',   fsKey: 'birthDate' },
  { key: 'driverLicense', label: "Driver's lic", fsKey: 'driverLicense' },
]

export interface MergePlan {
  updates: Record<string, unknown>
  changes: MergeChange[]
  /**
   * Values the secondary holds that the primary already has, and which will
   * therefore be discarded. The dialog only ever listed what flowed *in*, so
   * nothing said what was about to be lost.
   */
  discarded: { label: string; keeping: string; losing: string }[]
}

export function computeMergePlan(primary: CustomerItem, secondary: CustomerItem): MergePlan {
  const updates: Record<string, unknown> = {}
  const changes: MergeChange[] = []
  const discarded: MergePlan['discarded'] = []

  for (const { key, label, fsKey } of MERGE_STRING_FIELDS) {
    const pVal = (primary[key] as string | undefined)?.trim() ?? ''
    const sVal = (secondary[key] as string | undefined)?.trim() ?? ''
    if (!sVal) continue
    if (!pVal) {
      updates[fsKey] = sVal
      changes.push({ label, from: sVal, action: 'fill', firestoreKey: fsKey, value: sVal })
    } else if (pVal.toLowerCase() !== sVal.toLowerCase()) {
      discarded.push({ label, keeping: pVal, losing: sVal })
    }
  }

  if (secondary.amount) {
    if (!primary.amount) {
      updates['amount'] = secondary.amount
      changes.push({
        label: 'Amount', from: formatCurrency(secondary.amount),
        action: 'fill', firestoreKey: 'amount', value: secondary.amount,
      })
    } else if (primary.amount !== secondary.amount) {
      discarded.push({
        label: 'Amount',
        keeping: formatCurrency(primary.amount),
        losing: formatCurrency(secondary.amount),
      })
    }
  }

  if (secondary.photo && !primary.photo) {
    updates['photo'] = secondary.photo
    changes.push({ label: 'Photo', from: 'from secondary', action: 'fill', firestoreKey: 'photo', value: secondary.photo })
  }

  const pComments = primary.comments?.trim() ?? ''
  const sComments = secondary.comments?.trim() ?? ''
  if (sComments) {
    if (pComments) {
      const merged = `${pComments}\n\n--- (merged) ---\n${sComments}`
      updates['comments'] = merged
      changes.push({ label: 'Comments', from: 'combined from both', action: 'combine', firestoreKey: 'comments', value: merged })
    } else {
      updates['comments'] = sComments
      changes.push({
        label: 'Comments',
        from: sComments.slice(0, 60) + (sComments.length > 60 ? '…' : ''),
        action: 'fill', firestoreKey: 'comments', value: sComments,
      })
    }
  }

  const pTags = primary.tags ?? []
  const sTags = secondary.tags ?? []
  const newTags = sTags.filter(t => !pTags.includes(t))
  if (newTags.length > 0) {
    updates['tags'] = [...pTags, ...newTags]
    changes.push({ label: 'Tags', from: newTags.join(', '), action: 'combine', firestoreKey: 'tags', value: [...pTags, ...newTags] })
  }

  return { updates, changes, discarded }
}

// ── Related-record counts ─────────────────────────────────────────────────────

export type RelatedCounts = Record<string, number>

/** Human labels for the collections a merge moves. */
export const COLLECTION_LABELS: Record<string, string> = {
  Invoices:            'Invoices',
  Proposals:           'Proposals',
  Warranties:          'Warranties',
  ServicePlans:        'Service plans',
  serviceRequests:     'Service requests',
  ToDoItems:           'Tasks',
  Documents:           'Documents',
  dispatchAssignments: 'Dispatch jobs',
  timeEntries:         'Time entries',
  emailMessages:       'Emails',
  smsMessages:         'Texts',
  signingRequests:     'Signing requests',
  sequenceEnrollments: 'Sequence enrollments',
  campaignRecipients:  'Campaign sends',
  Activities:          'Activity entries',
  referrals:           'Referrals',
}

export function totalRelated(counts: RelatedCounts | undefined): number {
  if (!counts) return 0
  return Object.values(counts).reduce((s, n) => s + n, 0)
}

/** Biggest first, so the dialog leads with what matters. */
export function describeRelated(counts: RelatedCounts | undefined): { label: string; count: number }[] {
  if (!counts) return []
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([col, n]) => ({ label: COLLECTION_LABELS[col] ?? col, count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
