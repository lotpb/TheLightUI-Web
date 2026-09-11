import { describe, it, expect, beforeEach } from 'vitest'
import { geofenceStyle, formatRadius, RADIUS_CHOICES, DEFAULT_RADIUS } from './geofenceStyle'
import { googleMapsUrl } from './mapsLink'
import { useMapStore, MAX_GEOFENCES, type GeofenceState } from '../stores/mapStore'

const STATES: GeofenceState[] = ['inside', 'outside', 'unknown']

describe('geofenceStyle — the list and the map agree', () => {
    // They each had their own mapping: "outside" drew indigo on the map and
    // grey in the list, "unknown" drew grey-400 on the map and grey-600 in
    // the list — 1.56:1 against each other, so it read as one state.
    it('gives every state a style in both themes', () => {
        for (const s of STATES) {
            for (const light of [true, false]) {
                const style = geofenceStyle(s, light)
                expect(style.label).toBeTruthy()
                expect(style.dot).toBeTruthy()
                expect(style.mapColor).toMatch(/^#[0-9a-f]{6}$/i)
            }
        }
    })

    it('distinguishes outside from unknown by shape, not a second shade of grey', () => {
        const outside = geofenceStyle('outside', false)
        const unknown = geofenceStyle('unknown', false)
        expect(outside.dot).not.toBe(unknown.dot)
        expect(unknown.dot).toContain('border')          // a ring
        expect(outside.dot).toContain('bg-')             // filled
        expect(unknown.label).not.toBe(outside.label)
    })

    it('does not reuse the route/marker indigo for a geofence state', () => {
        // #6366f1 is the user marker and the route polyline.
        for (const s of STATES) {
            for (const light of [true, false]) {
                expect(geofenceStyle(s, light).mapColor.toLowerCase()).not.toBe('#6366f1')
            }
        }
    })

    it('falls back to unknown for an unrecognised state', () => {
        const bogus = 'sideways' as GeofenceState
        expect(geofenceStyle(bogus, false)).toEqual(geofenceStyle('unknown', false))
    })

    it('fades the fill as certainty drops', () => {
        expect(geofenceStyle('inside', false).fillOpacity)
            .toBeGreaterThan(geofenceStyle('outside', false).fillOpacity)
        expect(geofenceStyle('outside', false).fillOpacity)
            .toBeGreaterThan(geofenceStyle('unknown', false).fillOpacity)
    })
})

describe('formatRadius', () => {
    it('reads in metres below a kilometre', () => {
        expect(formatRadius(100)).toBe('100 m')
        expect(formatRadius(999)).toBe('999 m')
    })

    it('switches to kilometres, without a pointless decimal', () => {
        expect(formatRadius(1000)).toBe('1 km')
        expect(formatRadius(1500)).toBe('1.5 km')
    })

    it('formats every offered choice', () => {
        for (const r of RADIUS_CHOICES) expect(formatRadius(r)).toMatch(/^[\d.]+ (m|km)$/)
        expect(RADIUS_CHOICES).toContain(DEFAULT_RADIUS)
    })
})

describe('googleMapsUrl', () => {
    it('builds a Maps URLs (api=1) directions link', () => {
        const url = new URL(googleMapsUrl({ lat: 26.35, lng: -80.1 }, '123 Main St, Boca Raton FL', 'DRIVING'))
        expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/')
        expect(url.searchParams.get('api')).toBe('1')
        expect(url.searchParams.get('origin')).toBe('26.35,-80.1')
        expect(url.searchParams.get('destination')).toBe('123 Main St, Boca Raton FL')
        expect(url.searchParams.get('travelmode')).toBe('driving')
    })

    it('omits the origin when there is no location fix', () => {
        const url = new URL(googleMapsUrl(null, 'Somewhere', 'WALKING'))
        expect(url.searchParams.has('origin')).toBe(false)
        expect(url.searchParams.get('travelmode')).toBe('walking')
    })

    it('escapes an address rather than breaking the query string', () => {
        const url = new URL(googleMapsUrl(null, 'A&B Ltd, Unit #3', 'TRANSIT'))
        expect(url.searchParams.get('destination')).toBe('A&B Ltd, Unit #3')
    })
})

describe('mapStore geofence cap', () => {
    beforeEach(() => {
        useMapStore.setState({ geofences: [], geofenceStates: {} })
    })

    it('stops at the limit the panel advertises', () => {
        // The UI has always said "Max 20" and nothing enforced it.
        for (let i = 0; i < MAX_GEOFENCES + 5; i++) {
            useMapStore.getState().addGeofence(`F${i}`, 1, 1, 200)
        }
        expect(useMapStore.getState().geofences).toHaveLength(MAX_GEOFENCES)
    })

    it('accepts one again after a removal', () => {
        for (let i = 0; i < MAX_GEOFENCES; i++) useMapStore.getState().addGeofence(`F${i}`, 1, 1, 200)
        const first = useMapStore.getState().geofences[0].id
        useMapStore.getState().removeGeofence(first)
        useMapStore.getState().addGeofence('Later', 2, 2, 500)
        const names = useMapStore.getState().geofences.map(g => g.name)
        expect(names).toHaveLength(MAX_GEOFENCES)
        expect(names).toContain('Later')
    })

    it('keeps the radius it was given, not a hardcoded 200', () => {
        useMapStore.getState().addGeofence('Wide', 1, 1, 1000)
        expect(useMapStore.getState().geofences[0].radius).toBe(1000)
    })

    it('still de-duplicates names', () => {
        useMapStore.getState().addGeofence('Depot', 1, 1, 200)
        useMapStore.getState().addGeofence('Depot', 2, 2, 200)
        expect(useMapStore.getState().geofences.map(g => g.name)).toEqual(['Depot', 'Depot 2'])
    })
})
