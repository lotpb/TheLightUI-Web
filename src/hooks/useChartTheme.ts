import type { CSSProperties } from 'react'
import { useIsLightMode } from './useIsLightMode'

/**
 * Colours for a recharts chart, per theme.
 *
 * Charts can't use the app's Tailwind tokens. Recharts wants concrete colour
 * strings for SVG fills, strokes and its tooltip's inline styles, so a chart
 * page ends up with literal hexes — and /chart had 26 distinct ones, all chosen
 * against the dark card. In light mode that left the axis category names and the
 * bar value labels at 2.54:1 on white, while the ticks were already failing at
 * 3.04:1 on the dark card. One palette can't serve both: the failure just moves
 * from one theme to the other.
 *
 * Nor can index.css rescue it the way it does elsewhere. These land as SVG
 * presentation attributes and inline styles, so an override would have to target
 * recharts' own internal class names and use !important for the tooltip —
 * brittle, and invisible to anyone reading the chart code. Driving the values
 * from here keeps them where the charts are.
 *
 * Every number below is measured against the card the chart sits on —
 * bg-gray-800, which is #1f2937 in dark mode and #ffffff in light.
 */
export interface ChartTheme {
  /** Axis category names and bar value labels: the chart's primary text. */
  label: string
  /** Numeric axis ticks — one tier quieter than `label`. */
  tick: string
  grid: string
  axisLine: string
  /**
   * One flat colour per chart, not per bar.
   *
   * The index distinguishes one card from the next, never one bar from another
   * inside a chart: length is the only thing a bar encodes, so colouring each
   * bar differently advertises a dimension that doesn't exist.
   */
  accents: string[]
  tooltip: {
    contentStyle: CSSProperties
    labelStyle: CSSProperties
    itemStyle: CSSProperties
    cursor: false
  }
}

/** On #1f2937. label 9.96:1, tick 5.78:1, every accent ≥ 4.92:1. */
const DARK: ChartTheme = {
  label: '#d1d5db',
  tick: '#9ca3af',
  // 1.94:1 — the old #374151 was 1.42:1, which is no gridline at all.
  grid: '#4b5563',
  axisLine: '#6b7280',
  accents: ['#818cf8', '#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#fb7185'],
  tooltip: {
    contentStyle: {
      backgroundColor: '#111827',
      border: '1px solid #374151',
      borderRadius: 10,
      boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
    },
    labelStyle: { color: '#f3f4f6', fontWeight: 600 },
    itemStyle: { color: '#e5e7eb' },
    cursor: false,
  },
}

/**
 * On #ffffff. label 14.63:1, tick 7.58:1, every accent ≥ 3.19:1.
 *
 * The accents are the 600-level rather than the 400s the dark theme uses: on
 * white, amber-400 is 1.67:1 and lime-400 1.51:1, so the bars all but vanished.
 * Going the other way isn't possible either — indigo-600 is only 2.33:1 on the
 * dark card — which is the whole reason this is two palettes and not one.
 */
const LIGHT: ChartTheme = {
  label: '#1e293b',
  tick: '#475569',
  // 1.48:1 — the old #374151 was 10.31:1 here, a black grid ruled over white.
  grid: '#cbd5e1',
  axisLine: '#94a3b8',
  accents: ['#4f46e5', '#7c3aed', '#0891b2', '#059669', '#d97706', '#e11d48'],
  tooltip: {
    contentStyle: {
      backgroundColor: '#ffffff',
      border: '1px solid #cbd5e1',
      borderRadius: 10,
      boxShadow: '0 10px 25px rgba(15,23,42,0.15)',
    },
    labelStyle: { color: '#0f172a', fontWeight: 600 },
    itemStyle: { color: '#334155' },
    cursor: false,
  },
}

/** The palette for the current theme, kept live. */
export function useChartTheme(): ChartTheme {
  return useIsLightMode() ? LIGHT : DARK
}
