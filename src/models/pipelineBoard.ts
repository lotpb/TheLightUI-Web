import type { CustomerItem } from './customer'
import { effectiveStageId, type PipelineStageConfig } from './pipelineStage'

/**
 * Bucketing, staleness and per-stage money for /pipeline.
 *
 * All of it was inline in the page, which is why the Won column could show
 * "0 records" and "$45,000 total" at the same time: the count came from the
 * filtered buckets and the money from the unfiltered ones, and nothing tied
 * the two together.
 */

export const DAY_MS = 86_400_000
export const DEFAULT_STALE_DAYS = 7

/**
 * Guards against a stored setting that would make every card stale or none.
 *
 * `null` and `''` are checked before Number(), which turns both into 0 — an
 * absent setting has to fall back to the default, not clamp to one day.
 */
export function clampStaleDays(v: unknown): number {
  if (v === null || v === undefined || v === '') return DEFAULT_STALE_DAYS
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return DEFAULT_STALE_DAYS
  return Math.min(Math.max(n, 1), 365)
}

export function daysSince(d: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - d.getTime()) / DAY_MS)
}

/**
 * Open stages with no update in a while are going cold.
 *
 * Only 'open' stages can be stale — a won or lost record isn't waiting on
 * anyone. That's also why the going-cold filter empties the Won and Lost
 * columns entirely, which used to leave the Won money total stranded.
 */
export function isStale(
  c: CustomerItem,
  stage: PipelineStageConfig | undefined,
  staleDays: number = DEFAULT_STALE_DAYS,
  now: Date = new Date(),
): boolean {
  if (!stage || stage.kind !== 'open') return false
  return now.getTime() - c.lastUpdateDate.getTime() > staleDays * DAY_MS
}

/**
 * The card's stage was deleted or renamed out of the config.
 *
 * effectiveStageId falls back to the first stage so nothing vanishes, but the
 * card then sits in "New Lead" looking like new business while its stored
 * pipelineStage still names a stage that no longer exists. Rename a stage and
 * an arbitrary set of records quietly appears at the top of the funnel.
 */
export function orphanedStageId(
  c: CustomerItem,
  stages: PipelineStageConfig[],
): string | null {
  const raw = (c.pipelineStage ?? '').trim()
  if (!raw) return null
  return stages.some(s => s.id === raw) ? null : raw
}

/** Buckets keyed by stage id, each sorted the way that stage reads best. */
export function bucketByStage(
  customers: CustomerItem[],
  stages: PipelineStageConfig[],
): Record<string, CustomerItem[]> {
  const buckets: Record<string, CustomerItem[]> = {}
  for (const s of stages) buckets[s.id] = []
  for (const c of customers) {
    const id = effectiveStageId(c, stages)
    ;(buckets[id] ??= []).push(c)
  }
  for (const s of stages) {
    if (s.requiresDate) {
      // Soonest appointment first — the column exists to be worked in order.
      buckets[s.id].sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0))
    } else {
      buckets[s.id].sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
    }
  }
  return buckets
}

export interface StageTotal {
  count: number
  value: number
}

/**
 * Count and money per stage, from whatever buckets are on screen.
 *
 * The board showed a total for the Won column only, so the figure a pipeline
 * exists to answer — how much is sitting in Contacted, how much in
 * Appointment — wasn't anywhere. Derived from the rendered buckets, so the
 * money and the count can never disagree.
 */
export function stageTotals(
  buckets: Record<string, CustomerItem[]>,
  stages: PipelineStageConfig[],
): Record<string, StageTotal> {
  const out: Record<string, StageTotal> = {}
  for (const s of stages) {
    const items = buckets[s.id] ?? []
    out[s.id] = {
      count: items.length,
      value: items.reduce((sum, c) => sum + c.amount, 0),
    }
  }
  return out
}

/** How many open-stage cards are going cold, across the whole board. */
export function staleCount(
  buckets: Record<string, CustomerItem[]>,
  stages: PipelineStageConfig[],
  staleDays: number = DEFAULT_STALE_DAYS,
  now: Date = new Date(),
): number {
  let n = 0
  for (const s of stages) {
    if (s.kind !== 'open') continue
    n += (buckets[s.id] ?? []).filter(c => isStale(c, s, staleDays, now)).length
  }
  return n
}

/** Narrows every bucket to the cards going cold. */
export function filterStale(
  buckets: Record<string, CustomerItem[]>,
  stages: PipelineStageConfig[],
  staleDays: number = DEFAULT_STALE_DAYS,
  now: Date = new Date(),
): Record<string, CustomerItem[]> {
  const out: Record<string, CustomerItem[]> = {}
  for (const s of stages) {
    out[s.id] = (buckets[s.id] ?? []).filter(c => isStale(c, s, staleDays, now))
  }
  return out
}
