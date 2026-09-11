/**
 * The colour scale behind the /heatmap tiles.
 *
 * It used to be `lerpColor(low, high, total / maxTotal)` — a straight linear
 * ramp from the largest place to zero. That reads fine on a synthetic even
 * spread and carries no information at all on a real CRM, where one home state
 * holds most of the book and everywhere else is a long tail. Modelled on a
 * typical distribution (3200 / 240 / 95 / 60 / 38 / 22 / 14 / 9 / 5 / 2 / 1)
 * the eleven states produced one orange tile and ten navy ones, every tail
 * value landing within an RGB distance of 16 of the same colour: a 2% shift in
 * share moved the ramp by a distance of 4.
 *
 * Quantiles fix that by construction. Thresholds are taken from the data, so
 * roughly a fifth of the places fall in each band whatever the skew, and the
 * bands are printed as real numbers in the legend rather than left as an
 * unlabelled gradient the reader has to guess at. Discrete bands also match
 * how the rest of the app already grades things — see HEALTH_BANDS in
 * customerHealth.ts and SCORE_BANDS in leadScore.ts.
 */

export interface HeatBin {
  bg: string
  /**
   * Set explicitly per band rather than assuming white.
   *
   * The tiles paint their background with an inline style, so none of the
   * `html.light-mode .bg-*` rescue rules in index.css can reach them, and
   * `text-white` resolves to --color-white — dark navy in light mode. The old
   * tiles were 2.80:1 on the hottest colour in dark mode and 1.55:1 on the
   * coolest in light mode: there was no theme in which the whole grid could be
   * read. Every pair below is measured; the worst is 4.70:1.
   */
  fg: string
  /** Bands 1 and 2 are close to the card they sit on, so tiles get an edge. */
  ring: string
}

/** On the #1f2937 card. Text 11.50 / 6.70 / 5.70 / 4.70 / 8.31:1. */
const DARK_BINS: HeatBin[] = [
  { bg: '#1e3a5f', fg: '#ffffff', ring: 'rgba(255,255,255,0.16)' },
  { bg: '#1d4ed8', fg: '#ffffff', ring: 'rgba(255,255,255,0.16)' },
  { bg: '#7c3aed', fg: '#ffffff', ring: 'rgba(255,255,255,0.16)' },
  { bg: '#e11d48', fg: '#ffffff', ring: 'rgba(255,255,255,0.16)' },
  { bg: '#f59e0b', fg: '#0f172a', ring: 'rgba(15,23,42,0.20)' },
]

/** On the #ffffff card. Text 12.02 / 9.90 / 6.56 / 6.63 / 8.31:1. */
const LIGHT_BINS: HeatBin[] = [
  { bg: '#cbd5e1', fg: '#0f172a', ring: 'rgba(15,23,42,0.14)' },
  { bg: '#93c5fd', fg: '#0f172a', ring: 'rgba(15,23,42,0.14)' },
  { bg: '#a78bfa', fg: '#0f172a', ring: 'rgba(15,23,42,0.14)' },
  { bg: '#fb7185', fg: '#0f172a', ring: 'rgba(15,23,42,0.14)' },
  { bg: '#f59e0b', fg: '#0f172a', ring: 'rgba(15,23,42,0.20)' },
]

/**
 * Records with no state or city at all.
 *
 * They used to be grouped under "—" and ranked alongside real places, so
 * "Top State" could legitimately read "—". A missing value isn't a quantity,
 * so it gets a neutral swatch outside the ramp and sits out the rankings.
 */
const DARK_NEUTRAL: HeatBin  = { bg: '#374151', fg: '#ffffff', ring: 'rgba(255,255,255,0.16)' }
const LIGHT_NEUTRAL: HeatBin = { bg: '#e2e8f0', fg: '#0f172a', ring: 'rgba(15,23,42,0.14)' }

const STEPS = 5

export interface HeatScale {
  bins: HeatBin[]
  neutral: HeatBin
  /** Index into `bins` for a record count. */
  binOf(count: number): number
  /** One entry per band, in ramp order, with the counts it actually covers. */
  legend: { bin: HeatBin; label: string }[]
}

/**
 * Lower bounds for bands 1..k, taken from the data.
 *
 * Deduplicated, because a dataset of mostly-ones (or of three places) would
 * otherwise produce repeated thresholds and therefore empty bands with
 * identical colours in the legend. Fewer distinct counts simply means fewer
 * bands, which is the honest outcome.
 */
function quantileThresholds(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (let i = 1; i < STEPS; i++) {
    const v = sorted[Math.floor((i / STEPS) * sorted.length)]
    if (v === undefined) continue
    if (out.length === 0 ? v > sorted[0] : v > out[out.length - 1]) out.push(v)
  }
  return out
}

export function buildHeatScale(counts: number[], light: boolean): HeatScale {
  const palette = light ? LIGHT_BINS : DARK_BINS
  const neutral = light ? LIGHT_NEUTRAL : DARK_NEUTRAL
  const usable  = counts.filter(n => Number.isFinite(n))
  const min     = usable.length > 0 ? Math.min(...usable) : 0
  const max     = usable.length > 0 ? Math.max(...usable) : 0
  const cuts    = quantileThresholds(usable)

  // n bands need n-1 cuts. Spread them across the whole ramp rather than
  // slicing one end off it, so the quietest band is always the coolest colour
  // and the busiest always the hottest however many bands the data supports.
  // A single band means every place has the same count, so no colour can mean
  // anything — take the middle rather than implying "all hot" or "all cold".
  const bands = cuts.length + 1
  const bins = bands === 1
    ? [palette[Math.floor(palette.length / 2)]]
    : Array.from({ length: bands }, (_, i) =>
        palette[Math.round((i / (bands - 1)) * (palette.length - 1))])

  const binOf = (count: number) => {
    let i = 0
    while (i < cuts.length && count >= cuts[i]) i++
    return i
  }

  const legend = bins.map((bin, i) => {
    const lo = i === 0 ? min : cuts[i - 1]
    const hi = i === cuts.length ? max : cuts[i] - 1
    return { bin, label: lo === hi ? `${lo}` : `${lo}–${hi}` }
  })

  return { bins, neutral, binOf, legend }
}
