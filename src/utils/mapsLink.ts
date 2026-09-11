export type TravelMode = 'DRIVING' | 'WALKING' | 'TRANSIT'

/**
 * A Google Maps directions link, for handing off to real turn-by-turn.
 *
 * /maps could calculate a route, show its duration and list its steps, and
 * then had nowhere to send you — no link out, on the one page in the app
 * whose output is meant to be followed while driving.
 *
 * Uses the documented Maps URLs format (api=1), which works on the web and
 * deep-links into the native app on iOS and Android.
 */
export function googleMapsUrl(
  origin: { lat: number; lng: number } | null,
  destination: string,
  mode: TravelMode,
): string {
  const params = new URLSearchParams({
    api: '1',
    destination: destination.trim(),
    travelmode: mode.toLowerCase(),
  })
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
