import { useIsLightMode } from '../hooks/useIsLightMode'

/**
 * A small donut, drawn by hand rather than with recharts.
 *
 * RemindersPanel is a static import in Layout, so it lives in the app-shell
 * chunk that every route loads. Pulling recharts in for a 320px-wide chart
 * would add ~115kB gzipped to the first paint of every page in the app. A
 * donut is four stroked arcs; this is about forty lines and costs nothing.
 *
 * Every colour below is measured against the panel it sits on — bg-gray-900,
 * which is #111827 in dark mode and #e8eef5 in light — at or above the 3:1
 * that WCAG 1.4.11 asks of a non-text graphic, with no two slices closer
 * than an RGB distance of 60 so they can be told apart and matched to the
 * legend. One palette can't do both themes: the hues that read on the dark
 * panel land between 1.43:1 and 2.55:1 on the light one.
 *
 * Dark mode is deliberately neon — it was picked as the loudest of four
 * directions offered, over a brand-indigo family, a warm ramp, and simply
 * reusing useChartTheme's accents. Nothing subtle is intended here.
 *
 * Light mode does not follow it there and can't: neon on a near-white panel
 * is both illegible and unpleasant, and the shades below are already the
 * brightest of each hue that clears 3:1 — yellow-600 measures 2.52:1 on that
 * panel, so there is no headroom left. The two themes diverge in character
 * on purpose.
 */

export interface DonutSlice {
  key: string
  label: string
  value: number
  /** Index into the palette for this chart. */
  tone: number
}

type Palette = { slices: string[]; empty: string }

const URGENCY_DARK: Palette  = { slices: ['#ff2d55', '#ffe500', '#00e5ff', '#aab8d0'], empty: '#374151' }
const URGENCY_LIGHT: Palette = { slices: ['#f43f5e', '#b45309', '#0284c7', '#64748b'], empty: '#cbd5e1' }

const TYPE_DARK: Palette  = { slices: ['#ffe500', '#c77dff', '#00ff9d', '#ff8a00'], empty: '#374151' }
const TYPE_LIGHT: Palette = { slices: ['#b45309', '#8b5cf6', '#0d9488', '#f43f5e'], empty: '#cbd5e1' }

/** Five named slices plus a neutral for "Other" — see MAX_SLICES in the panel. */
const CATEGORY_DARK: Palette  = { slices: ['#7c5cff', '#00ff9d', '#ffe500', '#ff2d55', '#00e5ff', '#aab8d0'], empty: '#374151' }
const CATEGORY_LIGHT: Palette = { slices: ['#6366f1', '#059669', '#b45309', '#f43f5e', '#0284c7', '#64748b'], empty: '#cbd5e1' }

export type DonutPalette = 'urgency' | 'type' | 'category'

const PALETTES: Record<DonutPalette, [Palette, Palette]> = {
  urgency:  [URGENCY_DARK, URGENCY_LIGHT],
  type:     [TYPE_DARK, TYPE_LIGHT],
  category: [CATEGORY_DARK, CATEGORY_LIGHT],
}

export function useDonutPalette(name: DonutPalette): Palette {
  const light = useIsLightMode()
  const [dark, lightPal] = PALETTES[name]
  return light ? lightPal : dark
}

export interface DonutArc extends DonutSlice {
  /** Arc length in user units, for strokeDasharray. */
  len: number
  /** Distance from the start of the ring, for a negative strokeDashoffset. */
  offset: number
}

/**
 * Lay the slices out around the ring.
 *
 * Exported so the geometry can be tested: an offset that is subtly wrong
 * still renders a plausible-looking donut, which is the worst kind of bug in
 * a chart. Zero-value slices are dropped rather than emitting a zero-length
 * arc with a rounded cap, and an empty set returns nothing so the caller
 * shows its track.
 */
export function donutArcs(slices: DonutSlice[], circumference: number): DonutArc[] {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  if (total <= 0) return []
  let offset = 0
  const out: DonutArc[] = []
  for (const s of slices) {
    if (s.value <= 0) continue
    const len = (s.value / total) * circumference
    out.push({ ...s, len, offset })
    offset += len
  }
  return out
}

export default function DonutChart({
  slices, palette, size = 108, thickness = 14, centerValue, centerLabel,
}: {
  slices: DonutSlice[]
  palette: DonutPalette
  size?: number
  thickness?: number
  centerValue: string
  centerLabel: string
}) {
  const pal = useDonutPalette(palette)
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const cx = size / 2

  const arcs = donutArcs(slices, c)

  const summary = total === 0
    ? `${centerLabel}: none`
    : `${centerLabel}: ${slices.filter(s => s.value > 0).map(s => `${s.value} ${s.label}`).join(', ')}`

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={summary}
      className="shrink-0"
    >
      {/* The track, which is also the whole chart when there's nothing to show. */}
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={pal.empty} strokeWidth={thickness} />
      {arcs.map(a => (
        <circle
          key={a.key}
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={pal.slices[a.tone % pal.slices.length]}
          strokeWidth={thickness}
          strokeDasharray={`${a.len} ${c - a.len}`}
          strokeDashoffset={-a.offset}
          /* Start at twelve o'clock rather than three. */
          transform={`rotate(-90 ${cx} ${cx})`}
          strokeLinecap="butt"
        />
      ))}
      {/* The total belongs in the hole: a donut shows proportion, and the one
          number people actually want off this panel is "how many". */}
      <text
        x={cx} y={cx - 2}
        textAnchor="middle" dominantBaseline="middle"
        className="fill-gray-100 font-bold"
        style={{ fontSize: size * 0.26 }}
      >
        {centerValue}
      </text>
      <text
        x={cx} y={cx + size * 0.16}
        textAnchor="middle" dominantBaseline="middle"
        className="fill-gray-400"
        style={{ fontSize: size * 0.11 }}
      >
        {centerLabel}
      </text>
    </svg>
  )
}

/** Swatch + label + count, in the same order and colours as the arcs. */
export function DonutLegend({ slices, palette }: { slices: DonutSlice[]; palette: DonutPalette }) {
  const pal = useDonutPalette(palette)
  const total = slices.reduce((s, x) => s + x.value, 0)
  return (
    <ul className="flex-1 min-w-0 space-y-1">
      {slices.filter(s => s.value > 0).map(s => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className="w-2 h-2 rounded-sm shrink-0"
            style={{ backgroundColor: pal.slices[s.tone % pal.slices.length] }}
          />
          <span className="text-gray-300 truncate">{s.label}</span>
          <span className="ml-auto shrink-0 tabular-nums text-gray-100 font-semibold">{s.value}</span>
          <span className="shrink-0 tabular-nums text-gray-400 w-8 text-right">
            {total > 0 ? `${Math.round((s.value / total) * 100)}%` : '—'}
          </span>
        </li>
      ))}
    </ul>
  )
}
