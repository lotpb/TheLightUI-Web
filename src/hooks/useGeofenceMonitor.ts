import { useEffect, useRef } from 'react'
import { useMapStore, haversineMeters, type GeofenceState } from '../stores/mapStore'
import type { GeoPosition } from './useGeolocation'

// Mirrors GeofenceManager.handle() — suppresses initial state delivery,
// only fires notifications on actual state transitions.
export function useGeofenceMonitor(position: GeoPosition | null) {
  const { geofences, geofenceAlerts, geofenceStates, setGeofenceState } = useMapStore()
  const prevStates = useRef<Record<string, GeofenceState>>({})

  useEffect(() => {
    if (!position) return

    for (const fence of geofences) {
      const dist = haversineMeters(position.lat, position.lng, fence.lat, fence.lng)
      const current: GeofenceState = dist <= fence.radius ? 'inside' : 'outside'
      const previous = prevStates.current[fence.id] ?? geofenceStates[fence.id] ?? 'unknown'

      if (current !== previous) {
        setGeofenceState(fence.id, current)
        prevStates.current[fence.id] = current

        // Skip the very first evaluation (unknown → something) to avoid
        // false-positive alerts at startup, same as iOS's startDate guard.
        if (previous !== 'unknown' && geofenceAlerts) {
          fireNotification(fence.name, current)
        }
      }
    }
  }, [position, geofences, geofenceAlerts, geofenceStates, setGeofenceState])
}

async function fireNotification(name: string, state: GeofenceState) {
  const title = 'Geofence'
  const body = state === 'inside' ? `Entered ${name}` : `Left ${name}`

  if (!('Notification' in window)) return

  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }

  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.svg' })
  }
}
