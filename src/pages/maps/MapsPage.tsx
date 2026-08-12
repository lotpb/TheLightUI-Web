import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GoogleMap, useJsApiLoader, DirectionsRenderer, Circle, Marker,
} from '@react-google-maps/api'
import { useSearchParams } from 'react-router-dom'
import { useGeolocation } from '../../hooks/useGeolocation'
import { useGeofenceMonitor } from '../../hooks/useGeofenceMonitor'
import { useMapStore, type MapFavorite, type MapGeofence } from '../../stores/mapStore'
import ConfirmModal from '../../components/ConfirmModal'
import { usePageTitle } from '../../hooks/usePageTitle'

const LIBRARIES: ('places' | 'geometry')[] = ['places', 'geometry']
const MAP_ID = 'thelight-map'

type PanelTab = 'directions' | 'favorites' | 'geofences'

// ─── Formatting helpers (mirrors MapFormatting.swift) ────────────────────────

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MapsPage() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey ?? '',
    libraries: LIBRARIES,
  })

  const { position, error: geoError } = useGeolocation()
  useGeofenceMonitor(position)

  const [searchParams] = useSearchParams()
  const initialAddress = searchParams.get('address') ?? ''

  usePageTitle('Maps')
  const [mapRef, setMapRef] = useState<google.maps.Map | null>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>('directions')
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null)
  const [routeAddress, setRouteAddress] = useState(initialAddress)
  const [routeInput, setRouteInput] = useState(initialAddress)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeSummary, setRouteSummary] = useState<{ distance: string; duration: string } | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const { favorites, geofences, geofenceAlerts, geofenceStates,
    setBuiltInAddress, addCustomFavorite, removeCustomFavorite,
    addGeofence, removeGeofence, clearGeofences, setGeofenceAlerts } = useMapStore()

  const mapCenter = useMemo(
    () => position ? { lat: position.lat, lng: position.lng } : { lat: 26.35, lng: -80.1 },
    [position?.lat, position?.lng],  // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Auto-route when opened from a customer record
  useEffect(() => {
    if (initialAddress && isLoaded && position) {
      calculateRoute(initialAddress)
    }
  }, [initialAddress, isLoaded, position])  // eslint-disable-line react-hooks/exhaustive-deps

  // Keep map centered on user while no route is active
  useEffect(() => {
    if (mapRef && position && !directions) {
      mapRef.panTo({ lat: position.lat, lng: position.lng })
    }
  }, [mapRef, position, directions])

  const calculateRoute = useCallback(async (address: string) => {
    if (!position) { setRouteError('Waiting for your location…'); return }
    if (!address.trim()) { setRouteError('Enter a destination address'); return }
    if (!window.google) return

    setRouteLoading(true)
    setRouteError(null)
    setDirections(null)
    setRouteSummary(null)

    const svc = new window.google.maps.DirectionsService()
    svc.route(
      {
        origin: { lat: position.lat, lng: position.lng },
        destination: address,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        setRouteLoading(false)
        if (status === 'OK' && result) {
          setDirections(result)
          setRouteAddress(address)
          const leg = result.routes[0]?.legs[0]
          if (leg) {
            setRouteSummary({
              distance: leg.distance?.text ?? '',
              duration: leg.duration?.text ?? '',
            })
          }
          setActiveTab('directions')
        } else if (status === 'NOT_FOUND' || status === 'ZERO_RESULTS') {
          setRouteError('Address not found. Check and try again.')
        } else {
          setRouteError(`Directions error: ${status}`)
        }
      },
    )
  }, [position])

  // Fit map to route bounds whenever directions or the map reference becomes available
  useEffect(() => {
    if (mapRef && directions?.routes[0]?.bounds) {
      mapRef.fitBounds(directions.routes[0].bounds)
    }
  }, [directions, mapRef])

  function clearRoute() {
    setDirections(null)
    setRouteSummary(null)
    setRouteAddress('')
    setRouteInput('')
    setRouteError(null)
    if (mapRef && position) {
      mapRef.panTo({ lat: position.lat, lng: position.lng })
      mapRef.setZoom(15)
    }
  }

  if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_GOOGLE_MAPS_API_KEY') {
    return <ApiKeyMissing />
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400">Failed to load Google Maps: {loadError.message}</p>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      {/* ── Side Panel ── */}
      <div className="w-full md:w-80 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800 z-10
                      md:h-full h-[45vh] overflow-hidden">
        {/* Address search */}
        <div className="p-3 border-b border-gray-800 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              className="input-field flex-1 text-sm"
              placeholder="Enter destination address…"
              value={routeInput}
              onChange={e => setRouteInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && calculateRoute(routeInput)}
            />
            <button
              onClick={() => calculateRoute(routeInput)}
              disabled={routeLoading}
              className="btn-primary text-sm px-3 shrink-0"
            >
              {routeLoading ? '…' : '→'}
            </button>
          </div>
          {routeError && <p className="text-red-400 text-xs px-1">{routeError}</p>}
          {geoError && <p className="text-yellow-400 text-xs px-1">{geoError}</p>}
          {routeSummary && (
            <div className="flex items-center gap-3 px-1">
              <span className="text-sm font-semibold text-indigo-400">{routeSummary.duration}</span>
              <span className="text-xs text-gray-400">{routeSummary.distance}</span>
              <button onClick={clearRoute} className="ml-auto text-xs text-gray-500 hover:text-red-400">
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 text-xs font-medium">
          {(['directions', 'favorites', 'geofences'] as PanelTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 capitalize transition-colors ${
                activeTab === tab
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'directions' && (
            <DirectionsTab result={directions} routeAddress={routeAddress} />
          )}
          {activeTab === 'favorites' && (
            <FavoritesTab
              favorites={favorites}
              onRoute={addr => { setRouteInput(addr); calculateRoute(addr) }}
              onSetBuiltIn={setBuiltInAddress}
              onAddCustom={addCustomFavorite}
              onRemoveCustom={removeCustomFavorite}
            />
          )}
          {activeTab === 'geofences' && (
            <GeofencesTab
              geofences={geofences}
              geofenceStates={geofenceStates}
              alertsEnabled={geofenceAlerts}
              onToggleAlerts={setGeofenceAlerts}
              onRemove={removeGeofence}
              onClear={() => setConfirmClearOpen(true)}
              onFocusFence={fence => mapRef?.panTo({ lat: fence.lat, lng: fence.lng })}
            />
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 relative">
        <GoogleMap
          mapContainerClassName="w-full h-full"
          center={mapCenter}
          zoom={15}
          onLoad={setMapRef}
          options={{
            mapId: MAP_ID,
            disableDefaultUI: false,
            zoomControl: true,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            styles: darkMapStyles,
          }}
          onClick={e => {
            if (activeTab === 'geofences' && e.latLng) {
              const name = prompt('Geofence name (leave blank for default):') ?? ''
              addGeofence(name, e.latLng.lat(), e.latLng.lng(), 200)
            }
          }}
        >
          {/* User location marker */}
          {position && (
            <Marker
              position={{ lat: position.lat, lng: position.lng }}
              icon={{
                path: window.google?.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: '#6366f1',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              }}
              title="Your location"
            />
          )}

          {/* Route */}
          {directions && (
            <DirectionsRenderer
              directions={directions}
              options={{
                suppressMarkers: false,
                polylineOptions: { strokeColor: '#6366f1', strokeWeight: 5 },
              }}
            />
          )}

          {/* Geofence circles */}
          {geofences.map(fence => (
            <GeofenceCircle
              key={fence.id}
              fence={fence}
              state={geofenceStates[fence.id] ?? 'unknown'}
            />
          ))}
        </GoogleMap>

        {/* Location error overlay */}
        {geoError && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-yellow-900/80 border border-yellow-700/50
                          rounded-lg px-3 py-2 text-yellow-300 text-xs max-w-xs text-center backdrop-blur-sm">
            {geoError}
          </div>
        )}

        {/* Geofences hint */}
        {activeTab === 'geofences' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/80 border border-gray-700/50
                          rounded-full px-4 py-2 text-gray-300 text-xs backdrop-blur-sm pointer-events-none">
            Tap the map to place a geofence
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmClearOpen}
        message="Clear all geofences? This cannot be undone."
        confirmLabel="Clear All"
        onConfirm={() => { setConfirmClearOpen(false); clearGeofences() }}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  )
}

// ─── Geofence Circle ─────────────────────────────────────────────────────────

function GeofenceCircle({ fence, state }: { fence: MapGeofence; state: string }) {
  const color = state === 'inside' ? '#10b981' : state === 'outside' ? '#6366f1' : '#9ca3af'
  return (
    <Circle
      center={{ lat: fence.lat, lng: fence.lng }}
      radius={fence.radius}
      options={{
        fillColor: color,
        fillOpacity: 0.15,
        strokeColor: color,
        strokeOpacity: 0.8,
        strokeWeight: 2,
      }}
    />
  )
}

// ─── Directions Tab ───────────────────────────────────────────────────────────

function DirectionsTab({
  result, routeAddress,
}: {
  result: google.maps.DirectionsResult | null
  routeAddress: string
}) {
  if (!result) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        <p className="text-2xl mb-2">🗺</p>
        Enter an address above and tap → to get directions
      </div>
    )
  }

  const legs = result.routes[0]?.legs ?? []
  const steps = legs[0]?.steps ?? []

  return (
    <div className="py-2">
      {routeAddress && (
        <p className="px-4 py-2 text-xs text-gray-400 border-b border-gray-800 truncate">
          → {routeAddress}
        </p>
      )}
      {steps.map((step, i) => (
        <div key={i} className="flex gap-3 px-4 py-3 border-b border-gray-800/50">
          <span className="text-xs text-indigo-400 font-bold shrink-0 w-5 pt-0.5">{i + 1}</span>
          <div className="min-w-0">
            {/* Strip HTML tags from step instructions */}
            <p className="text-sm text-gray-200 leading-snug"
              dangerouslySetInnerHTML={{ __html: step.instructions }} />
            {step.distance && (
              <p className="text-xs text-gray-500 mt-1">{step.distance.text}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Favorites Tab ────────────────────────────────────────────────────────────

function FavoritesTab({
  favorites, onRoute, onSetBuiltIn, onAddCustom, onRemoveCustom,
}: {
  favorites: MapFavorite[]
  onRoute: (address: string) => void
  onSetBuiltIn: (type: 'home' | 'work', address: string) => void
  onAddCustom: (title: string, address: string) => void
  onRemoveCustom: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAddress, setEditAddress] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newAddress, setNewAddress] = useState('')

  function saveBuiltIn(fav: MapFavorite) {
    onSetBuiltIn(fav.builtIn!, editAddress)
    setEditingId(null)
  }

  const builtIn = favorites.filter(f => f.builtIn)
  const custom = favorites.filter(f => !f.builtIn)

  return (
    <div className="py-2">
      {/* Built-in: Home + Work */}
      {builtIn.map(fav => (
        <div key={fav.id}>
          {editingId === fav.id ? (
            <div className="px-4 py-3 space-y-2 border-b border-gray-800/50">
              <p className="text-xs font-semibold text-gray-300">{fav.title} Address</p>
              <input
                className="input-field text-sm"
                placeholder="Street, City, State ZIP"
                value={editAddress}
                onChange={e => setEditAddress(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => saveBuiltIn(fav)} className="btn-primary text-xs px-3 py-1.5 flex-1">Save</button>
                <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-3 py-1.5 flex-1">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50">
              <span className="text-xl shrink-0">{fav.builtIn === 'home' ? '🏠' : '🏢'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-200">{fav.title}</p>
                <p className="text-xs text-gray-500 truncate">{fav.address || 'Tap to set address'}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {fav.address && (
                  <button
                    onClick={() => onRoute(fav.address)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1"
                  >
                    Route
                  </button>
                )}
                <button
                  onClick={() => { setEditingId(fav.id); setEditAddress(fav.address) }}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
                >
                  Edit
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Custom favorites */}
      {custom.map(fav => (
        <div key={fav.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50">
          <span className="text-xl shrink-0">⭐</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-200 truncate">{fav.title}</p>
            <p className="text-xs text-gray-500 truncate">{fav.address}</p>
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={() => onRoute(fav.address)} className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1">Route</button>
            <button onClick={() => onRemoveCustom(fav.id)} className="text-xs text-red-500 hover:text-red-400 px-2 py-1">✕</button>
          </div>
        </div>
      ))}

      {/* Add custom */}
      {addingCustom ? (
        <div className="px-4 py-3 space-y-2">
          <input className="input-field text-sm" placeholder="Name (e.g. Gym)" value={newTitle}
            onChange={e => setNewTitle(e.target.value)} autoFocus />
          <input className="input-field text-sm" placeholder="Address" value={newAddress}
            onChange={e => setNewAddress(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newAddress) {
                onAddCustom(newTitle || 'Place', newAddress)
                setAddingCustom(false); setNewTitle(''); setNewAddress('')
              }
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (newAddress) { onAddCustom(newTitle || 'Place', newAddress) }
                setAddingCustom(false); setNewTitle(''); setNewAddress('')
              }}
              disabled={!newAddress}
              className="btn-primary text-xs px-3 py-1.5 flex-1"
            >
              Add
            </button>
            <button onClick={() => setAddingCustom(false)} className="btn-secondary text-xs px-3 py-1.5 flex-1">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingCustom(true)}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-indigo-400 hover:bg-gray-800/50 transition-colors"
        >
          <span className="text-xl">＋</span> Add Favorite
        </button>
      )}
    </div>
  )
}

// ─── Geofences Tab ────────────────────────────────────────────────────────────

function GeofencesTab({
  geofences, geofenceStates, alertsEnabled,
  onToggleAlerts, onRemove, onClear, onFocusFence,
}: {
  geofences: MapGeofence[]
  geofenceStates: Record<string, string>
  alertsEnabled: boolean
  onToggleAlerts: (v: boolean) => void
  onRemove: (id: string) => void
  onClear: () => void
  onFocusFence: (f: MapGeofence) => void
}) {
  return (
    <div className="py-2">
      {/* Alerts toggle */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm text-gray-300">Geofence Alerts</span>
        <button
          onClick={() => onToggleAlerts(!alertsEnabled)}
          className={`relative w-10 h-6 rounded-full transition-colors ${alertsEnabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${alertsEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Hint */}
      <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-800">
        Tap the map to place a geofence (200 m radius). Max 20.
      </p>

      {/* List */}
      {geofences.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500">No geofences yet</p>
      ) : (
        geofences.map(fence => {
          const state = geofenceStates[fence.id] ?? 'unknown'
          const dot = state === 'inside' ? 'bg-green-400' : state === 'outside' ? 'bg-gray-500' : 'bg-gray-600'
          return (
            <div key={fence.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
              <button onClick={() => onFocusFence(fence)} className="min-w-0 flex-1 text-left">
                <p className="text-sm font-medium text-gray-200 truncate">{fence.name}</p>
                <p className="text-xs text-gray-500">{fence.radius} m · {state}</p>
              </button>
              <button onClick={() => onRemove(fence.id)} className="text-xs text-red-500 hover:text-red-400 px-2">✕</button>
            </div>
          )
        })
      )}

      {geofences.length > 0 && (
        <button
          onClick={onClear}
          className="w-full px-4 py-3 text-sm text-red-500 hover:bg-red-900/20 transition-colors"
        >
          Clear All Geofences
        </button>
      )}
    </div>
  )
}

// ─── API key missing ──────────────────────────────────────────────────────────

function ApiKeyMissing() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <p className="text-4xl mb-4">🗺</p>
      <h2 className="text-xl font-bold text-white mb-2">Google Maps API Key Required</h2>
      <p className="text-gray-400 text-sm max-w-sm leading-relaxed">
        Add <code className="text-indigo-400">VITE_GOOGLE_MAPS_API_KEY</code> to your{' '}
        <code className="text-indigo-400">.env.local</code> file.
        Enable the <strong>Maps JavaScript API</strong>, <strong>Directions API</strong>,
        and <strong>Geocoding API</strong> in Google Cloud Console.
      </p>
    </div>
  )
}

// ─── Dark map styles ──────────────────────────────────────────────────────────

const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#64779e' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#334e87' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
  { featureType: 'poi', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#023e58' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#3C7680' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#255763' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0d5ce' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#023747' }] },
  { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
  { featureType: 'transit', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
  { featureType: 'transit.line', elementType: 'geometry.fill', stylers: [{ color: '#283d6a' }] },
  { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#3a4762' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d70' }] },
]
