import type { CustomerItem } from './customer'
import { getStage } from './pipeline'

export type StageKind = 'open' | 'won' | 'lost'

export interface PipelineStageConfig {
  id: string
  label: string
  colorKey: StageColorKey
  kind: StageKind
  // When true, dropping a card into this stage prompts for a date (stored on
  // the customer's `start` field) — used for e.g. an "Appointment" stage.
  requiresDate: boolean
}

// Tailwind's compiler only picks up classes it can see as literal strings in
// source, so colors are looked up by key here rather than built from a
// template string — see STAGE_COLOR_CLASSES below.
export const STAGE_COLOR_PALETTE = [
  'indigo', 'blue', 'teal', 'emerald', 'green', 'amber',
  'orange', 'rose', 'red', 'pink', 'purple', 'violet', 'gray', 'slate',
] as const
export type StageColorKey = typeof STAGE_COLOR_PALETTE[number]

// `badge` was removed: it paired text-white with bg-<hue>-600, which failed AA
// in dark mode for amber/green/orange/teal/emerald (3.19-3.77:1) and rendered
// dark navy in light mode for blue/emerald/pink/purple/rose, none of which have
// a white-text override in index.css. Stage identity is carried by `bar` and
// `text`, which pass on every palette entry. Don't add it back — a count badge
// doesn't need to re-encode the stage hue.
export const STAGE_COLOR_CLASSES: Record<StageColorKey, { text: string; bar: string }> = {
  indigo:  { text: 'text-indigo-400',  bar: 'bg-indigo-500' },
  blue:    { text: 'text-blue-400',    bar: 'bg-blue-500' },
  teal:    { text: 'text-teal-400',    bar: 'bg-teal-500' },
  emerald: { text: 'text-emerald-400', bar: 'bg-emerald-500' },
  green:   { text: 'text-green-400',   bar: 'bg-green-500' },
  amber:   { text: 'text-amber-400',   bar: 'bg-amber-500' },
  orange:  { text: 'text-orange-400',  bar: 'bg-orange-500' },
  rose:    { text: 'text-rose-400',    bar: 'bg-rose-500' },
  red:     { text: 'text-red-400',     bar: 'bg-red-500' },
  pink:    { text: 'text-pink-400',    bar: 'bg-pink-500' },
  purple:  { text: 'text-purple-400',  bar: 'bg-purple-500' },
  violet:  { text: 'text-violet-400',  bar: 'bg-violet-500' },
  gray:    { text: 'text-gray-400',    bar: 'bg-gray-600' },
  slate:   { text: 'text-slate-400',   bar: 'bg-slate-500' },
}

// Matches the ids the old fixed 5-stage board used, so companies that never
// customize their pipeline see exactly the same board as before, and
// existing leads (which have no `pipelineStage` field yet) resolve to the
// right column via the legacy derivation in effectiveStageId() below.
export const DEFAULT_STAGES: PipelineStageConfig[] = [
  { id: 'new',         label: 'New Lead',    colorKey: 'indigo', kind: 'open', requiresDate: false },
  { id: 'contacted',   label: 'Contacted',   colorKey: 'blue',   kind: 'open', requiresDate: false },
  { id: 'appointment', label: 'Appointment', colorKey: 'orange', kind: 'open', requiresDate: true },
  { id: 'won',         label: 'Customer',    colorKey: 'green',  kind: 'won',  requiresDate: false },
  { id: 'lost',        label: 'Inactive',    colorKey: 'gray',   kind: 'lost', requiresDate: false },
]

export function slugifyStageId(label: string, existing: Set<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stage'
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// A customer only carries an explicit `pipelineStage` once it's been dragged
// on the board since this feature shipped. Until then, fall back to the
// legacy field-derived stage (category/active/callback/startDate) so nothing
// appears to vanish from the board after an upgrade. If neither resolves to
// a stage that still exists in the current config (e.g. it was renamed or
// deleted), bucket into the first configured stage.
export function effectiveStageId(c: CustomerItem, stages: PipelineStageConfig[]): string {
  const ids = new Set(stages.map(s => s.id))
  if (c.pipelineStage && ids.has(c.pipelineStage)) return c.pipelineStage
  const legacy = getStage(c)
  if (legacy && ids.has(legacy)) return legacy
  return stages[0]?.id ?? 'new'
}
