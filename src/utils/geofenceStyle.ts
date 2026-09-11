import type { GeofenceState } from '../stores/mapStore'

/**
 * One definition of what a geofence state looks like, for the list and the map.
 *
 * They each had their own. A fence you were outside of drew indigo on the map
 * — the same colour as your own position marker and the route line — and grey
 * in the list; "unknown" drew grey-400 on the map and grey-600 in the list.
 * The two greys in the list measured 1.56:1 against each other, so "outside"
 * and "unknown" were indistinguishable, and grey-600 was 2.35:1 against the
 * panel it sat on.
 *
 * The states are now separated by shape as well as colour — `unknown` is a
 * ring rather than a filled dot — because a location fix we haven't got yet
 * isn't a quieter version of "outside", it's a different kind of answer.
 */
export interface GeofenceStyle {
  label: string
  /** Tailwind classes for the list dot. */
  dot: string
  /** Map circle fill/stroke. Literal, because SVG can't take a token. */
  mapColor: string
  fillOpacity: number
}

const DARK: Record<GeofenceState, GeofenceStyle> = {
  // 10.18:1 on the bg-gray-900 panel.
  inside:  { label: 'Inside',  dot: 'bg-green-400',                    mapColor: '#34d399', fillOpacity: 0.18 },
  // 6.99:1, and clearly a different hue from green rather than a third grey.
  outside: { label: 'Outside', dot: 'bg-gray-400',                     mapColor: '#9ca3af', fillOpacity: 0.10 },
  unknown: { label: 'No fix yet', dot: 'border-2 border-gray-400 bg-transparent', mapColor: '#9ca3af', fillOpacity: 0.04 },
}

const LIGHT: Record<GeofenceState, GeofenceStyle> = {
  inside:  { label: 'Inside',  dot: 'bg-green-400',                    mapColor: '#059669', fillOpacity: 0.18 },
  outside: { label: 'Outside', dot: 'bg-gray-400',                     mapColor: '#64748b', fillOpacity: 0.10 },
  unknown: { label: 'No fix yet', dot: 'border-2 border-gray-400 bg-transparent', mapColor: '#64748b', fillOpacity: 0.04 },
}

export function geofenceStyle(state: GeofenceState, light: boolean): GeofenceStyle {
  return (light ? LIGHT : DARK)[state] ?? (light ? LIGHT : DARK).unknown
}

/** Metres, rendered the way a driver reads them. */
export function formatRadius(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`
}

export const RADIUS_CHOICES = [100, 200, 500, 1000] as const
export const DEFAULT_RADIUS = 200
