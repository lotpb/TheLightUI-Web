import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface MapFavorite {
  id: string
  title: string
  address: string
  builtIn?: 'home' | 'work'
}

export interface MapGeofence {
  id: string
  name: string
  lat: number
  lng: number
  radius: number   // meters
}

// Per-geofence runtime state (not persisted — recomputed from live location)
export type GeofenceState = 'inside' | 'outside' | 'unknown'

interface MapStore {
  favorites: MapFavorite[]
  geofences: MapGeofence[]
  geofenceAlerts: boolean
  // Runtime-only geofence states (not persisted)
  geofenceStates: Record<string, GeofenceState>

  setBuiltInAddress: (type: 'home' | 'work', address: string) => void
  addCustomFavorite: (title: string, address: string) => void
  removeCustomFavorite: (id: string) => void

  addGeofence: (name: string, lat: number, lng: number, radius: number) => void
  removeGeofence: (id: string) => void
  clearGeofences: () => void
  setGeofenceAlerts: (enabled: boolean) => void
  setGeofenceState: (id: string, state: GeofenceState) => void
}

export const useMapStore = create<MapStore>()(
  persist(
    (set, get) => ({
      favorites: [
        { id: 'home', title: 'Home', address: '', builtIn: 'home' },
        { id: 'work', title: 'Work', address: '', builtIn: 'work' },
      ],
      geofences: [],
      geofenceAlerts: true,
      geofenceStates: {},

      setBuiltInAddress: (type, address) =>
        set(s => ({
          favorites: s.favorites.map(f =>
            f.builtIn === type ? { ...f, address } : f,
          ),
        })),

      addCustomFavorite: (title, address) =>
        set(s => ({
          favorites: [
            ...s.favorites,
            { id: crypto.randomUUID(), title, address },
          ],
        })),

      removeCustomFavorite: (id) =>
        set(s => ({ favorites: s.favorites.filter(f => f.id !== id) })),

      addGeofence: (name, lat, lng, radius) => {
        // Unique name — append number if collision (mirrors GeofenceManager.uniqueIdentifier)
        const existing = new Set(get().geofences.map(g => g.name))
        let finalName = name || `Geofence ${get().geofences.length + 1}`
        if (existing.has(finalName)) {
          let i = 2
          while (existing.has(`${finalName} ${i}`)) i++
          finalName = `${finalName} ${i}`
        }
        set(s => ({
          geofences: [...s.geofences, { id: crypto.randomUUID(), name: finalName, lat, lng, radius }],
        }))
      },

      removeGeofence: (id) =>
        set(s => ({
          geofences: s.geofences.filter(g => g.id !== id),
          geofenceStates: Object.fromEntries(
            Object.entries(s.geofenceStates).filter(([k]) => k !== id),
          ),
        })),

      clearGeofences: () => set({ geofences: [], geofenceStates: {} }),

      setGeofenceAlerts: (enabled) => set({ geofenceAlerts: enabled }),

      setGeofenceState: (id, state) =>
        set(s => ({ geofenceStates: { ...s.geofenceStates, [id]: state } })),
    }),
    {
      name: 'thelight.map',
      // Don't persist runtime states
      partialize: s => ({
        favorites: s.favorites,
        geofences: s.geofences,
        geofenceAlerts: s.geofenceAlerts,
      }),
    },
  ),
)

// Haversine distance in meters — mirrors CoreLocation distance math
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
