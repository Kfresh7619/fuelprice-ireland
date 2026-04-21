import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Head from 'next/head'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { IRISH_COUNTIES } from '../lib/counties'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

function timeAgo(dateStr) {
  if (!dateStr) return 'unknown'
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function freshnessState(dateStr) {
  if (!dateStr) return 'stale'
  const hours = (Date.now() - new Date(dateStr)) / 3600000
  if (hours < 6) return 'fresh'
  if (hours < 48) return 'aging'
  return 'stale'
}

function getPriceColor(price) {
  if (!price) return '#475569'
  if (price < 1.87) return '#22c55e'
  if (price < 1.91) return '#84cc16'
  if (price < 1.95) return '#fbbf24'
  if (price < 1.99) return '#f59e0b'
  return '#ef4444'
}

// Price bar — visual indicator of where a price sits within the Irish spread
// Range: €1.84 (cheapest discounters) → €1.99 (expensive rural)
// Returns a filled bar proportional to the price position in this range
function PriceBar({ price }) {
  if (!price) return null
  const MIN = 1.84
  const MAX = 1.99
  const pct = Math.min(100, Math.max(0, ((price - MIN) / (MAX - MIN)) * 100))
  const color = getPriceColor(price)
  return (
    <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: '#0f172a', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.3s ease' }} />
    </div>
  )
}


function getPrice(station, fuelType) {
  return station.prices?.find(p => p.fuel_type === fuelType) ?? null
}

function getPriceValue(station, fuelType) {
  return getPrice(station, fuelType)?.price ?? null
}

function getReportedAt(station, fuelType) {
  return getPrice(station, fuelType)?.reported_at ?? null
}

function normaliseStation(s) {
  return {
    ...s,
    petrolPrice: getPriceValue(s, 'petrol'),
    dieselPrice: getPriceValue(s, 'diesel'),
    reportedAt: getReportedAt(s, 'petrol') ?? getReportedAt(s, 'diesel'),
    source: getPrice(s, 'petrol')?.source ?? getPrice(s, 'diesel')?.source ?? null,
  }
}

function distKm(pos, s) {
  const R = 6371
  const dLat = (s.lat - pos.lat) * Math.PI / 180
  const dLng = (s.lng - pos.lng) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(pos.lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const BRAND_COLORS = {
  'circle k':    '#E31837',
  'applegreen':  '#00843D',
  'texaco':      '#E4002B',
  'maxol':       '#E4002B',
  'inver':       '#0071BC',
  'emo':         '#003DA5',
  'certa':       '#00529B',
  'esso':        '#0033A0',
  'amber':       '#F59E0B',
  'topaz':       '#E8A020',
  'top':         '#F68B1F',
  'campus':      '#6B7280',
  'go':          '#10B981',
  'greatgas':    '#16A34A',
  'morris':      '#78350F',
  'corrib':      '#1D4ED8',
  'tara':        '#7C3AED',
  'swift':       '#0EA5E9',
  'independent': '#475569',
  'estuary':     '#0369A1',
  'tesco':       '#EF4444',
  'smart pump':  '#64748B',
  'sweeney':     '#92400E',
  'shell':       '#F7C600',
  'drive':       '#8B5CF6',
  'gulf':        '#FF6B00',
  "o'reilly":    '#B45309',
}

function getBrandColor(brand) {
  if (!brand) return '#334155'
  const lower = brand.toLowerCase()
  for (const [key, color] of Object.entries(BRAND_COLORS)) {
    if (lower.includes(key)) return color
  }
  return '#334155'
}

function FreshnessDot({ dateStr }) {
  const state = freshnessState(dateStr)
  const config = {
    fresh: { color: '#22c55e', label: timeAgo(dateStr) },
    aging: { color: '#f59e0b', label: timeAgo(dateStr) },
    stale: { color: '#ef4444', label: 'outdated' },
  }
  const { color, label } = config[state]
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 4px ${color}` }} />
      {label}
    </span>
  )
}

function SearchBar({ search, onSearchChange, onSearchEnter, onClear, onLocate, locating }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#475569', pointerEvents: 'none' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearchEnter(search)}
          placeholder="Search station, town, county..."
          style={{ width: '100%', padding: '8px 28px 8px 28px', border: '1px solid #334155', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#1e293b', color: '#e2e8f0', fontFamily: 'inherit' }}
        />
        {search && (
          <button onClick={onClear} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
        )}
      </div>
      <button onClick={onLocate} disabled={locating}
        style={{ padding: '8px 12px', background: locating ? '#1e40af' : '#2563eb', color: 'white', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: locating ? 'wait' : 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {locating ? '...' : '⊕ Near me'}
      </button>
    </div>
  )
}

function CountySelect({ value, onChange, countyCounts }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '8px 10px', border: '1px solid #334155', borderRadius: 6, fontSize: 12, background: '#1e293b', color: value ? '#e2e8f0' : '#64748b', outline: 'none', fontFamily: 'inherit' }}
    >
      <option value="">All counties</option>
      <optgroup label="Republic of Ireland">
        {IRISH_COUNTIES.slice(0, 26).map(c => (
          <option key={c} value={c}>{c}{countyCounts[c] ? ` (${countyCounts[c]})` : ''}</option>
        ))}
      </optgroup>
      <optgroup label="Northern Ireland">
        {IRISH_COUNTIES.slice(26).map(c => (
          <option key={c} value={c}>{c}{countyCounts[c] ? ` (${countyCounts[c]})` : ''}</option>
        ))}
      </optgroup>
    </select>
  )
}

function StationCard({ s, isSelected, isCheapestPetrol, isCheapestDiesel, fuelFilter, userPos, onClick }) {
  const freshness = freshnessState(s.reportedAt)
  const hasAnyPrice = s.petrolPrice != null || s.dieselPrice != null
  const brandColor = getBrandColor(s.brand)
  const petrolColor = getPriceColor(s.petrolPrice)
  const dieselColor = getPriceColor(s.dieselPrice)
  const isStale = freshness === 'stale'
  const isAging = freshness === 'aging'

  const distStr = userPos
    ? s.distance_metres != null
      ? s.distance_metres < 1000
        ? `${Math.round(s.distance_metres)}m`
        : `${(s.distance_metres / 1000).toFixed(1)}km`
      : `${distKm(userPos, s).toFixed(1)}km`
    : null

  return (
    <div
      onClick={onClick}
      style={{
        marginBottom: 4,
        borderRadius: 8,
        border: `1px solid ${isSelected ? '#3b82f6' : '#1e293b'}`,
        background: isSelected ? 'rgba(59,130,246,0.07)' : '#0f172a',
        cursor: 'pointer',
        overflow: 'hidden',
        opacity: isStale && hasAnyPrice ? 0.7 : 1,
        transition: 'border-color 0.15s, background 0.15s, opacity 0.15s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#0f172a' }}
    >
      {isStale && hasAnyPrice && (
        <div style={{ background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.15)', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: '#fca5a5', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            ⚠ Price may be outdated · {timeAgo(s.reportedAt)}
          </span>
        </div>
      )}
      {isAging && hasAnyPrice && (
        <div style={{ background: 'rgba(161,98,7,0.08)', borderBottom: '1px solid rgba(161,98,7,0.15)', padding: '4px 12px' }}>
          <span style={{ fontSize: 9, color: '#a16207', letterSpacing: '0.04em' }}>Updated {timeAgo(s.reportedAt)}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'stretch', padding: '12px 12px 12px 10px', gap: 10 }}>
        <div style={{ width: 3, borderRadius: 2, background: brandColor, flexShrink: 0, alignSelf: 'stretch', minHeight: 40, opacity: isSelected ? 1 : 0.85 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: isSelected ? '#93c5fd' : '#f1f5f9', lineHeight: 1.2, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.name}
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {s.county}
                {s.brand && s.brand.toLowerCase() !== s.name.toLowerCase() && (
                  <span style={{ color: '#475569', fontWeight: 400 }}> · {s.brand}</span>
                )}
              </div>
            </div>
            <div style={{ flexShrink: 0, marginLeft: 8, textAlign: 'right' }}>
              {distStr && <div style={{ fontSize: 11, color: '#475569', fontFamily: '"DM Mono", monospace', lineHeight: 1.2 }}>{distStr}</div>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: freshness === 'fresh' ? '#22c55e' : freshness === 'aging' ? '#f59e0b' : '#ef4444', boxShadow: freshness === 'fresh' ? '0 0 4px #22c55e' : 'none' }} />
                {freshness === 'fresh' && <span style={{ fontSize: 9, color: '#22c55e' }}>{timeAgo(s.reportedAt)}</span>}
              </div>
            </div>
          </div>
          {hasAnyPrice ? (
            <div style={{ display: 'flex', gap: 6 }}>
              {fuelFilter !== 'diesel' && (
                <div style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: '#080f1e', border: `1px solid ${isCheapestPetrol ? '#16a34a55' : '#1a2744'}`, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, fontWeight: 600 }}>Petrol</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: '"DM Mono", "Courier New", monospace', color: s.petrolPrice ? petrolColor : '#334155', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {s.petrolPrice ? `€${Number(s.petrolPrice).toFixed(3)}` : '—'}
                  </div>
                  {s.petrolPrice && <PriceBar price={s.petrolPrice} />}
                  {isCheapestPetrol && <div style={{ fontSize: 9, color: '#16a34a', marginTop: 3, letterSpacing: '0.06em', fontWeight: 700 }}>CHEAPEST</div>}
                </div>
              )}
              {fuelFilter !== 'petrol' && (
                <div style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: '#080f1e', border: `1px solid ${isCheapestDiesel ? '#d9770655' : '#1a2744'}`, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, fontWeight: 600 }}>Diesel</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: '"DM Mono", "Courier New", monospace', color: s.dieselPrice ? dieselColor : '#334155', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {s.dieselPrice ? `€${Number(s.dieselPrice).toFixed(3)}` : '—'}
                  </div>
                  {s.dieselPrice && <PriceBar price={s.dieselPrice} />}
                  {isCheapestDiesel && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 3, letterSpacing: '0.06em', fontWeight: 700 }}>CHEAPEST</div>}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '7px 10px', borderRadius: 6, background: '#080f1e', border: '1px solid #1a2744', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#475569' }}>No price data</span>
              <span style={{ fontSize: 9, color: '#64748b', border: '1px solid #334155', borderRadius: 3, padding: '2px 6px', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>Be first to report</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function updateMapSource(map, stations, selectedId) {
  const source = map.getSource('stations')
  if (!source) return false
  source.setData({
    type: 'FeatureCollection',
    features: stations.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        petrolPrice: s.petrolPrice ?? null,
        dieselPrice: s.dieselPrice ?? null,
        color: s.petrolPrice ? getPriceColor(s.petrolPrice) : s.dieselPrice ? getPriceColor(s.dieselPrice) : '#1e293b',
        min_price: (s.petrolPrice != null || s.dieselPrice != null)
          ? Math.min(s.petrolPrice ?? 99, s.dieselPrice ?? 99)
          : 99,
        hasPrice: (s.petrolPrice != null || s.dieselPrice != null) ? 1 : 0,
        isSelected: s.id === selectedId ? 1 : 0,
        stale: freshnessState(s.reportedAt) === 'stale' ? 0.4 : 1,
      }
    }))
  })
  return true
}

export default function Home() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const stationListRef = useRef(null)
  const stationCardRefs = useRef({})
  const [stations, setStations] = useState([])
  const [allStations, setAllStations] = useState([])
  const [cheapest, setCheapest] = useState({ petrol: null, diesel: null })
  const [selected, setSelected] = useState(null)
  const [fuelFilter, setFuelFilter] = useState('all')
  const [countyFilter, setCountyFilter] = useState('')
  const [sortBy, setSortBy] = useState('price')
  const [search, setSearch] = useState('')
  const [userPos, setUserPos] = useState(null)
  // Mobile sheet: 'collapsed' | 'peek' | 'open'
  const [sheetState, setSheetState] = useState('peek')
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchGeoResult, setSearchGeoResult] = useState(null)
  const [reportModal, setReportModal] = useState(null)
  const [reportForm, setReportForm] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [geofencePrompt, setGeofencePrompt] = useState(null)
  const [locationPrompt, setLocationPrompt] = useState(true)
  const [loading, setLoading] = useState(true)
  const [mapReady, setMapReady] = useState(false)
  const layersInitialised = useRef(false)
  const allStationsRef = useRef([])
  const stationsRef = useRef([])
  const selectedRef = useRef(null)
  const mapReadyRef = useRef(false)

  useEffect(() => { allStationsRef.current = allStations }, [allStations])
  useEffect(() => { stationsRef.current = stations }, [stations])
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { mapReadyRef.current = mapReady }, [mapReady])

  useEffect(() => {
    if (!selected) return
    const card = stationCardRefs.current[selected.id]
    if (card && stationListRef.current) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selected])

  useEffect(() => {
    if (map.current && mapReady && stations.length) {
      updateMapSource(map.current, stations, selected?.id)
    }
  }, [selected, mapReady])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const countyCounts = useMemo(() => {
    const counts = {}
    for (const s of allStations) {
      if (s.county) counts[s.county] = (counts[s.county] ?? 0) + 1
    }
    return counts
  }, [allStations])

  useEffect(() => {
    setLoading(true)
    fetch('/api/stations/all')
      .then(r => r.json())
      .then(data => {
        if (data.stations) {
          const normalised = data.stations.map(normaliseStation)
          setAllStations(normalised)
          setStations(normalised)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    setSelected(null)
    if (!countyFilter) {
      setStations(allStations)
      if (map.current && mapReady) updateMapSource(map.current, allStations, null)
      map.current?.flyTo({ center: [-8.0, 53.4], zoom: 6.5 })
      return
    }
    const filtered = allStations.filter(s => s.county?.toLowerCase() === countyFilter.toLowerCase())
    setStations(filtered)
    if (map.current && mapReady) updateMapSource(map.current, filtered, null)
    if (filtered.length > 0 && map.current) {
      const avgLat = filtered.reduce((sum, s) => sum + s.lat, 0) / filtered.length
      const avgLng = filtered.reduce((sum, s) => sum + s.lng, 0) / filtered.length
      map.current.flyTo({ center: [avgLng, avgLat], zoom: 9 })
    }
  }, [countyFilter, allStations, mapReady])

  useEffect(() => {
    fetch('/api/prices/latest')
      .then(r => r.json())
      .then(data => {
        if (!data.counties) return
        let cheapestPetrol = null
        let cheapestDiesel = null
        for (const county of data.counties) {
          const p = county.fuels?.petrol
          const d = county.fuels?.diesel
          if (p && (!cheapestPetrol || p.price < cheapestPetrol.price)) cheapestPetrol = { ...p, county: county.county }
          if (d && (!cheapestDiesel || d.price < cheapestDiesel.price)) cheapestDiesel = { ...d, county: county.county }
        }
        setCheapest({ petrol: cheapestPetrol, diesel: cheapestDiesel })
      })
  }, [])

  const localCheapest = useMemo(() => {
    if (!userPos || stations.length === allStations.length) return null
    let petrol = null
    let diesel = null
    for (const s of stations) {
      if (s.petrolPrice && (!petrol || s.petrolPrice < petrol.price)) {
        petrol = { price: s.petrolPrice, station_id: s.id, station_name: s.name }
      }
      if (s.dieselPrice && (!diesel || s.dieselPrice < diesel.price)) {
        diesel = { price: s.dieselPrice, station_id: s.id, station_name: s.name }
      }
    }
    return { petrol, diesel }
  }, [userPos, stations, allStations])

  const displayCheapest = localCheapest ?? cheapest

  useEffect(() => {
    if (!userPos || !allStations.length) return
    const nearby = allStations.filter(s => distKm(userPos, s) < 0.3)
    if (nearby.length > 0 && !geofencePrompt) setGeofencePrompt(nearby[0])
  }, [userPos, allStations])

  useEffect(() => {
    if (map.current || !mapContainer.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-8.0, 53.4],
      zoom: 6.5,
    })
    const navControl = new mapboxgl.NavigationControl({ showCompass: true })
    map.current.addControl(navControl, 'top-right')
    map.current.on('load', () => setMapReady(true))
    map.current.on('dragstart', () => setSelected(null))
  }, [])

  useEffect(() => {
    if (!mapReady || !map.current || !stations.length || layersInitialised.current) return

    const geojson = {
      type: 'FeatureCollection',
      features: stations.map(s => {
        const cheapestPrice = s.petrolPrice != null && s.dieselPrice != null
          ? Math.min(s.petrolPrice, s.dieselPrice)
          : s.petrolPrice ?? s.dieselPrice ?? null
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          properties: {
            id: s.id,
            name: s.name,
            petrolPrice: s.petrolPrice ?? null,
            dieselPrice: s.dieselPrice ?? null,
            color: cheapestPrice ? getPriceColor(cheapestPrice) : '#1e293b',
            min_price: cheapestPrice ?? 99,
            hasPrice: cheapestPrice != null ? 1 : 0,
            isSelected: 0,
            stale: freshnessState(s.reportedAt) === 'stale' ? 0.4 : 1,
          }
        }
      })
    }

    map.current.addSource('stations', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 80,
      clusterProperties: {
        min_price: ['min', ['get', 'min_price']],
        has_any_price: ['max', ['get', 'hasPrice']],
      },
    })

    map.current.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'stations',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'case',
          ['==', ['get', 'has_any_price'], 0], '#0f172a',
          ['<', ['get', 'min_price'], 1.87], '#15803d',
          ['<', ['get', 'min_price'], 1.91], '#4d7c0f',
          ['<', ['get', 'min_price'], 1.95], '#b45309',
          ['<', ['get', 'min_price'], 1.99], '#c2410c',
          '#991b1b'
        ],
        'circle-radius': ['step', ['get', 'point_count'], 20, 5, 26, 20, 32, 60, 38],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'has_any_price'], 0], '#1e293b',
          ['<', ['get', 'min_price'], 1.87], '#22c55e',
          ['<', ['get', 'min_price'], 1.91], '#84cc16',
          ['<', ['get', 'min_price'], 1.95], '#fbbf24',
          ['<', ['get', 'min_price'], 1.99], '#f97316',
          '#ef4444'
        ],
        'circle-opacity': ['case', ['==', ['get', 'has_any_price'], 0], 0.25, 0.92],
      }
    })

    map.current.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'stations',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': [
          'case',
          ['==', ['get', 'has_any_price'], 0],
          ['concat', ['get', 'point_count_abbreviated']],
          ['concat', '€', ['slice', ['to-string', ['get', 'min_price']], 0, 5], '\n', ['get', 'point_count_abbreviated']]
        ],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-line-height': 1.3,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.3)',
        'text-halo-width': 0.5,
      }
    })

    map.current.addLayer({
      id: 'selected-halo',
      type: 'circle',
      source: 'stations',
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'isSelected'], 1]],
      paint: { 'circle-color': '#60a5fa', 'circle-radius': 18, 'circle-opacity': 0.25, 'circle-stroke-width': 0 }
    })

    map.current.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'stations',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['==', ['get', 'isSelected'], 1], '#60a5fa', ['get', 'color']],
        'circle-radius': ['case', ['==', ['get', 'isSelected'], 1], 10, ['==', ['get', 'hasPrice'], 1], 8, 5],
        'circle-stroke-width': ['case', ['==', ['get', 'isSelected'], 1], 2, 1],
        'circle-stroke-color': ['case', ['==', ['get', 'isSelected'], 1], 'white', 'rgba(255,255,255,0.15)'],
        'circle-opacity': ['case', ['==', ['get', 'isSelected'], 1], 1, ['==', ['get', 'hasPrice'], 1], ['get', 'stale'], 0.18],
      }
    })

    map.current.on('click', 'clusters', (e) => {
      const features = map.current.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      const clusterId = features[0].properties.cluster_id
      map.current.getSource('stations').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return
        map.current.easeTo({ center: features[0].geometry.coordinates, zoom })
      })
    })

    map.current.on('click', 'unclustered-point', (e) => {
      const props = e.features[0].properties
      const station = allStationsRef.current.find(s => s.id === props.id)
      if (station) {
        setSelected(station)
        setSheetState('peek')
        map.current.flyTo({ center: [station.lng, station.lat], zoom: Math.max(map.current.getZoom(), 13) })
      }
    })

    map.current.on('click', (e) => {
      const features = map.current.queryRenderedFeatures(e.point, { layers: ['unclustered-point', 'clusters'] })
      if (features.length === 0) setSelected(null)
    })

    map.current.on('mouseenter', 'clusters', () => { map.current.getCanvas().style.cursor = 'pointer' })
    map.current.on('mouseleave', 'clusters', () => { map.current.getCanvas().style.cursor = '' })
    map.current.on('mouseenter', 'unclustered-point', () => { map.current.getCanvas().style.cursor = 'pointer' })
    map.current.on('mouseleave', 'unclustered-point', () => { map.current.getCanvas().style.cursor = '' })

    layersInitialised.current = true
  }, [mapReady, stations])

  const flyToStation = useCallback((stationId) => {
    const station = allStations.find(s => s.id === stationId)
    if (!station || !map.current) return
    map.current.flyTo({ center: [station.lng, station.lat], zoom: 14 })
    setSelected(station)
  }, [allStations])

  const getFiltered = useCallback(() => {
    let list = [...stations]
    if (search && !searchGeoResult) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name?.toLowerCase().includes(q) ||
        s.county?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.brand?.toLowerCase().includes(q)
      )
    }
    if (sortBy === 'price') {
      list.sort((a, b) => {
        const ap = fuelFilter === 'diesel' ? (a.dieselPrice ?? 99) : (a.petrolPrice ?? 99)
        const bp = fuelFilter === 'diesel' ? (b.dieselPrice ?? 99) : (b.petrolPrice ?? 99)
        return ap - bp
      })
    } else if (sortBy === 'distance' && userPos) {
      list.sort((a, b) => distKm(userPos, a) - distKm(userPos, b))
    } else if (sortBy === 'updated') {
      list.sort((a, b) => new Date(b.reportedAt ?? 0) - new Date(a.reportedAt ?? 0))
    }
    return list
  }, [stations, search, searchGeoResult, fuelFilter, sortBy, userPos])

  const geocodeSearch = useCallback(async (query) => {
    if (!query || query.length < 2) return
    setSearching(true)
    setSearchGeoResult(null)
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=ie&types=place,locality,neighborhood,address,poi&access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&limit=1`
      const res = await fetch(url)
      const data = await res.json()
      const feature = data.features?.[0]
      if (feature) {
        const [lng, lat] = feature.center
        setSearchGeoResult({ lat, lng, name: feature.place_name })
        map.current?.flyTo({ center: [lng, lat], zoom: 11 })
        const stationsRes = await fetch(`/api/stations/nearby?lat=${lat}&lng=${lng}&radius=30000`)
        const stationsData = await stationsRes.json()
        if (stationsData.stations?.length > 0) {
          const normalised = stationsData.stations.map(normaliseStation)
          setStations(normalised)
          if (map.current && mapReady) updateMapSource(map.current, normalised, selected?.id)
          setSortBy('distance')
          setUserPos({ lat, lng })
        }
      }
    } catch (e) { console.error('Geocode error:', e) }
    setSearching(false)
  }, [mapReady, selected])

  const searchDebounceRef = useRef(null)
  const handleSearchChange = useCallback((value) => {
    setSearch(value)
    setSearchGeoResult(null)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (value.length >= 2) searchDebounceRef.current = setTimeout(() => geocodeSearch(value), 600)
  }, [geocodeSearch])

  const clearSearch = useCallback(() => {
    setSearch('')
    setSearchGeoResult(null)
    setUserPos(null)
    setCountyFilter('')
    setSelected(null)
    setStations(allStations)
    if (map.current && mapReady) updateMapSource(map.current, allStations, null)
    map.current?.flyTo({ center: [-8.0, 53.4], zoom: 6.5 })
  }, [allStations, mapReady])

  const locateMe = useCallback(() => {
    setLocateError(null)
    setLocationPrompt(false)
    if (!navigator.geolocation) { setLocateError('Geolocation not supported.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        setUserPos({ lat, lng })
        setSortBy('distance')
        setLocating(false)
        map.current?.flyTo({ center: [lng, lat], zoom: 12 })
        fetch(`/api/stations/nearby?lat=${lat}&lng=${lng}&radius=25000`)
          .then(r => r.json())
          .then(data => {
            if (data.stations?.length > 0) {
              const normalised = data.stations.map(normaliseStation)
              setStations(normalised)
              if (map.current && mapReady) updateMapSource(map.current, normalised, selected?.id)
              setSheetState('open')
            }
          })
      },
      (err) => {
        setLocating(false)
        switch (err.code) {
          case 1: setLocateError('Location access denied.'); break
          case 2: setLocateError('Could not determine location.'); break
          case 3: setLocateError('Location request timed out.'); break
          default: setLocateError('Location unavailable.')
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [mapReady, selected])

  const submitReport = async () => {
    if (!reportModal) return
    setSubmitting(true)
    const submissions = []
    if (reportForm.petrol_price) submissions.push(fetch('/api/prices/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: reportModal.id, fuel_type: 'petrol', price: parseFloat(reportForm.petrol_price) })
    }))
    if (reportForm.diesel_price) submissions.push(fetch('/api/prices/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: reportModal.id, fuel_type: 'diesel', price: parseFloat(reportForm.diesel_price) })
    }))
    if (submissions.length === 0) {
      setSubmitting(false)
      setSubmitResult({ error: 'Enter at least one price' })
      return
    }

    const results = await Promise.all(submissions)
    setSubmitting(false)

    if (!results.every(r => r.ok)) {
      setSubmitResult({ error: 'Something went wrong. Try again.' })
      return
    }

    try {
      const res = await fetch(`/api/stations/nearby?lat=${reportModal.lat}&lng=${reportModal.lng}&radius=100`)
      const data = await res.json()
      const updated = data.stations?.find(s => s.id === reportModal.id)
      if (updated) {
        const normalised = normaliseStation(updated)
        const updateList = (list) => list.map(s => s.id === normalised.id ? normalised : s)
        setStations(prev => {
          const next = updateList(prev)
          if (map.current && mapReadyRef.current) {
            updateMapSource(map.current, next, selectedRef.current?.id)
          }
          return next
        })
        setAllStations(prev => updateList(prev))
        if (selectedRef.current?.id === normalised.id) setSelected(normalised)
      }
    } catch (e) { console.error('Failed to refresh station:', e) }

    setSubmitResult({ success: true })
    setTimeout(() => { setReportModal(null); setSubmitResult(null) }, 2500)
  }

  const filtered = getFiltered()

  const headerStationCount = countyFilter
    ? `${filtered.length} stations in ${countyFilter}`
    : loading ? '...' : `${allStations.length} stations`

  // Mobile sheet heights
  const SHEET_PEEK_HEIGHT = 80     // just the handle + cheapest prices
  const SHEET_OPEN_HEIGHT = '62vh' // station list visible

  return (
    <>
      <Head>
        <title>{selected ? `${selected.name} · FuelPrice Ireland` : 'FuelPrice Ireland'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; font-family: 'DM Sans', system-ui, sans-serif; background: #0f172a; }
          select option { background: #1e293b; color: #e2e8f0; }
          select optgroup { background: #1e293b; color: #64748b; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
          @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
          @keyframes fabPulse { 0%,100%{box-shadow:0 4px 20px rgba(37,99,235,0.6),0 0 0 3px rgba(37,99,235,0.15)} 50%{box-shadow:0 4px 20px rgba(37,99,235,0.6),0 0 0 8px rgba(37,99,235,0.05)} }
          @media (max-width: 768px) {
            .desktop-only { display: none !important; }
            .mobile-sheet { display: flex !important; }
            .mapboxgl-ctrl-top-right { top: 8px !important; right: 8px !important; }
            .mapboxgl-ctrl-group { background: rgba(15,23,42,0.9) !important; border: 1px solid #1e293b !important; border-radius: 10px !important; backdrop-filter: blur(8px); }
            .mapboxgl-ctrl-group button { background: transparent !important; color: #94a3b8 !important; }
            .mapboxgl-ctrl-group button:hover { background: rgba(255,255,255,0.05) !important; }
            .mapboxgl-ctrl-group button .mapboxgl-ctrl-icon { filter: invert(1) opacity(0.6); }
          }
          @media (min-width: 769px) {
            .mobile-sheet { display: none !important; }
          }
        `}</style>
      </Head>

      <div style={{ display: 'flex', height: '100dvh', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, position: 'relative', background: '#0f172a' }}>

        {/* ── DESKTOP SIDEBAR ── */}
        <div className="desktop-only" style={{ width: 320, display: 'flex', flexDirection: 'column', background: '#0f172a', borderRight: '1px solid #1e293b', overflow: 'hidden' }}>
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 12px rgba(37,99,235,0.4)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0', letterSpacing: '-0.01em' }}>FuelPrice Ireland</div>
                <div style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>{headerStationCount}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[
                { label: 'Petrol', data: displayCheapest.petrol, color: '#22c55e' },
                { label: 'Diesel', data: displayCheapest.diesel, color: '#f59e0b' },
              ].map(({ label, data, color }) => (
                <div key={label}
                  onClick={() => data?.station_id && flyToStation(data.station_id)}
                  style={{ padding: '10px 12px', background: '#1e293b', borderRadius: 8, border: '1px solid #334155', cursor: data?.station_id ? 'pointer' : 'default', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => { if (data?.station_id) e.currentTarget.style.borderColor = color }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#334155' }}
                >
                  <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Cheapest {label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: '"DM Mono", "Courier New", monospace', color, lineHeight: 1, marginBottom: 4 }}>
                    {data ? `€${Number(data.price).toFixed(3)}` : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: data?.station_id ? '#60a5fa' : '#475569', textDecoration: data?.station_id ? 'underline' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {data?.station_name ?? '—'}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, padding: '5px 8px', background: '#0f172a', borderRadius: 6, border: '1px solid #1e293b' }}>
              <span style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em' }}>€/L</span>
              {[
                { color: '#22c55e', label: '<1.87' },
                { color: '#84cc16', label: '<1.91' },
                { color: '#fbbf24', label: '<1.95' },
                { color: '#f59e0b', label: '<1.99' },
                { color: '#ef4444', label: '1.99+' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: '#475569', fontFamily: '"DM Mono", monospace' }}>{label}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 10, background: '#1e293b', borderRadius: 7, padding: 3 }}>
              {['all', 'petrol', 'diesel'].map(f => (
                <button key={f} onClick={() => setFuelFilter(f)}
                  style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', fontSize: 11, fontWeight: 500, cursor: 'pointer', background: fuelFilter === f ? '#334155' : 'transparent', color: fuelFilter === f ? '#e2e8f0' : '#475569', transition: 'all 0.15s', letterSpacing: '0.03em' }}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 8 }}>
              <CountySelect value={countyFilter} onChange={setCountyFilter} countyCounts={countyCounts} />
            </div>

            <SearchBar search={search} onSearchChange={handleSearchChange} onSearchEnter={geocodeSearch} onClear={clearSearch} onLocate={locateMe} locating={locating} />
            {locateError && (
              <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, fontSize: 11, color: '#fca5a5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{locateError}</span>
                <button onClick={() => setLocateError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8 }}>×</button>
              </div>
            )}
            {searching && <div style={{ marginTop: 6, fontSize: 10, color: '#475569', textAlign: 'center', letterSpacing: '0.05em' }}>SEARCHING...</div>}
            {searchGeoResult && (
              <div style={{ marginTop: 6, padding: '5px 10px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, fontSize: 11, color: '#22c55e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Near {search}</span>
                <button onClick={clearSearch} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 14 }}>×</button>
              </div>
            )}
            {locationPrompt && !userPos && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 6, fontSize: 11, color: '#60a5fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Enable location for nearby stations</span>
                <button onClick={locateMe} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600, letterSpacing: '0.05em' }}>ON</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderBottom: '1px solid #1e293b' }}>
            <span style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Sort</span>
            <div style={{ width: 1, height: 10, background: '#1e293b' }} />
            {['price', 'distance', 'updated'].map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                style={{ padding: '2px 8px', borderRadius: 4, border: 'none', fontSize: 10, cursor: 'pointer', background: sortBy === s ? '#2563eb' : 'transparent', color: sortBy === s ? 'white' : '#475569', fontWeight: sortBy === s ? 600 : 400, letterSpacing: '0.04em', transition: 'all 0.15s' }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: '#64748b', fontFamily: '"DM Mono", monospace', fontWeight: 500 }}>{filtered.length}</span>
          </div>

          <div ref={stationListRef} style={{ overflowY: 'auto', flex: 1, padding: '8px 10px' }}>
            {loading && (
              <div style={{ padding: '16px 0' }}>
                {[70, 55, 80, 60, 75, 65].map((width, i) => (
                  <div key={i} style={{ padding: '12px', marginBottom: 4, borderRadius: 8, border: '1px solid #1e293b', background: '#0f172a' }}>
                    <div style={{ height: 12, background: '#1e293b', borderRadius: 4, marginBottom: 8, width: `${width}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ height: 28, background: '#1e293b', borderRadius: 6, flex: 1, animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <div style={{ height: 28, background: '#1e293b', borderRadius: 6, flex: 1, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>⛽</div>
                <div style={{ fontSize: 13, color: '#475569', marginBottom: 4, fontWeight: 500 }}>
                  {countyFilter ? `No stations in ${countyFilter}` : 'No stations found'}
                </div>
                <div style={{ fontSize: 11, color: '#334155' }}>Try adjusting your filters</div>
              </div>
            )}
            {!loading && filtered.map(s => (
              <div key={s.id} ref={el => { stationCardRefs.current[s.id] = el }}>
                <StationCard
                  s={s}
                  isSelected={selected?.id === s.id}
                  isCheapestPetrol={displayCheapest.petrol?.station_id === s.id}
                  isCheapestDiesel={displayCheapest.diesel?.station_id === s.id}
                  fuelFilter={fuelFilter}
                  userPos={userPos}
                  onClick={() => {
                    setSelected(s)
                    map.current?.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.current?.getZoom() ?? 12, 13) })
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── MAP (full screen on mobile) ── */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

          {/* Desktop cheapest overlay */}
          <div className="desktop-only" style={{ display: 'flex', position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 20px', gap: 24, zIndex: 500, whiteSpace: 'nowrap', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
            {[
              { label: 'Petrol', data: displayCheapest.petrol, color: '#22c55e' },
              { label: 'Diesel', data: displayCheapest.diesel, color: '#f59e0b' },
            ].map(({ label, data, color }, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                {i === 1 && <div style={{ width: 1, background: '#1e293b', alignSelf: 'stretch', marginRight: 24 }} />}
                <div onClick={() => data?.station_id && flyToStation(data.station_id)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: data?.station_id ? 'pointer' : 'default' }}>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#475569', letterSpacing: '0.1em', marginBottom: 2 }}>Cheapest {label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: '"DM Mono", monospace', color, lineHeight: 1, marginBottom: 2 }}>
                    {data ? `€${Number(data.price).toFixed(3)}` : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: data?.station_id ? '#60a5fa' : '#475569', textDecoration: data?.station_id ? 'underline' : 'none' }}>
                    {data?.station_name ?? '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Geofence prompt */}
          {geofencePrompt && (
            <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)', border: '1px solid #334155', borderRadius: 10, padding: '14px 18px', zIndex: 600, minWidth: 280, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>Near {geofencePrompt.name}</div>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 12 }}>Are today's prices still correct?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setGeofencePrompt(null)} style={{ flex: 1, padding: '8px 0', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Yes, correct</button>
                <button onClick={() => { setReportModal(geofencePrompt); setGeofencePrompt(null) }} style={{ flex: 1, padding: '8px 0', background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Update price</button>
                <button onClick={() => setGeofencePrompt(null)} style={{ padding: '8px 10px', background: 'transparent', color: '#475569', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            </div>
          )}

          {/* Desktop station detail panel */}
          {selected && (
            <div className="desktop-only" style={{ position: 'absolute', bottom: 0, right: 0, width: 300, background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(12px)', borderTop: '1px solid #1e293b', borderLeft: '1px solid #1e293b', borderRadius: '10px 0 0 0', padding: 16, zIndex: 10, animation: 'slideUp 0.2s ease-out' }}>
              <button onClick={() => setSelected(null)} style={{ position: 'absolute', top: 12, right: 12, background: '#1e293b', border: 'none', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', fontSize: 14, color: '#475569' }}>×</button>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '10px 0 0 0', background: getBrandColor(selected.brand) }} />
              <div style={{ paddingRight: 28, marginBottom: 10, marginTop: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#f1f5f9', letterSpacing: '-0.01em', marginBottom: 2 }}>{selected.name}</div>
                <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>{selected.brand} · {selected.county}</div>
              </div>
              <div style={{ marginBottom: 12 }}><FreshnessDot dateStr={selected.reportedAt} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                {[{ label: 'Petrol', price: selected.petrolPrice }, { label: 'Diesel', price: selected.dieselPrice }].map(({ label, price }) => (
                  <div key={label} style={{ padding: '12px 10px', borderRadius: 8, border: `1px solid ${price ? getPriceColor(price) + '40' : '#1e293b'}`, background: '#0f172a', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.08em', marginBottom: 6, fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: '"DM Mono", monospace', color: getPriceColor(price), lineHeight: 1, letterSpacing: '-0.02em' }}>
                      {price ? `€${Number(price).toFixed(3)}` : '—'}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, borderTop: '1px solid #1e293b', paddingTop: 10, marginBottom: 12 }}>
                {[
                  { label: 'Address', value: selected.address ?? '—' },
                  { label: 'County', value: selected.county },
                  ...(userPos ? [{ label: 'Distance', value: `${distKm(userPos, selected).toFixed(1)} km` }] : []),
                  { label: 'Source', value: selected.source ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: '#475569' }}>
                    <span>{label}</span>
                    <span style={{ color: '#94a3b8', textAlign: 'right', maxWidth: 180 }}>{value}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`, '_blank')}
                  style={{ padding: 10, background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.03em' }}>
                  Navigate →
                </button>
                <button onClick={() => { setReportModal(selected); setReportForm({}) }}
                  style={{ padding: 10, background: 'transparent', color: '#60a5fa', border: '1px solid #334155', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
                  Update price
                </button>
              </div>
            </div>
          )}

          {/* ── MOBILE: Floating Near Me button ── */}
          <button
            className="mobile-sheet"
            onClick={locateMe}
            disabled={locating}
            style={{
              display: 'none',
              position: 'absolute',
              bottom: sheetState === 'open' ? `calc(${SHEET_OPEN_HEIGHT} + 16px)` : `${SHEET_PEEK_HEIGHT + 16}px`,
              right: 16,
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: locating ? '#1e40af' : '#2563eb',
              color: 'white',
              border: 'none',
              cursor: locating ? 'wait' : 'pointer',
              boxShadow: '0 4px 20px rgba(37,99,235,0.6), 0 0 0 3px rgba(37,99,235,0.15)',
              animation: 'fabPulse 2.5s ease-in-out infinite',
              fontSize: 22,
              zIndex: 700,
              transition: 'bottom 0.3s ease',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Near me"
          >
            {locating ? '…' : '⊕'}
          </button>
        </div>

        {/* ── MOBILE BOTTOM SHEET ── */}
        <div
          className="mobile-sheet"
          style={{
            display: 'none',
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: sheetState === 'open' ? SHEET_OPEN_HEIGHT : `${SHEET_PEEK_HEIGHT}px`,
            background: 'rgba(10,15,28,0.98)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(99,102,241,0.15)',
            borderRadius: '20px 20px 0 0',
            flexDirection: 'column',
            zIndex: 600,
            transition: 'height 0.3s cubic-bezier(0.4,0,0.2,1)',
            overflow: 'hidden',
          }}
        >
          {/* Drag handle + cheapest prices row — always visible */}
          <div
            onClick={() => setSheetState(s => s === 'open' ? 'peek' : 'open')}
            style={{ padding: '8px 16px 6px', cursor: 'pointer', flexShrink: 0 }}
          >
            {/* Handle pill */}
            <div style={{ width: 40, height: 4, background: '#475569', borderRadius: 2, margin: '0 auto 10px' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Cheapest prices */}
              <div style={{ display: 'flex', gap: 20 }}>
                {[
                  { label: 'Petrol', data: displayCheapest.petrol, color: '#22c55e' },
                  { label: 'Diesel', data: displayCheapest.diesel, color: '#f59e0b' },
                ].map(({ label, data, color }) => (
                  <div key={label} onClick={e => { e.stopPropagation(); data?.station_id && flyToStation(data.station_id) }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, fontFamily: '"DM Mono", monospace', color, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                      {data ? `€${Number(data.price).toFixed(3)}` : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
                      {data?.station_name ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
              {/* Toggle arrow */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ fontSize: 16, color: '#475569', transform: sheetState === 'open' ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>↑</div>
                <div style={{ fontSize: 9, color: '#334155', letterSpacing: '0.06em', textTransform: 'uppercase', transition: 'opacity 0.2s' }}>{sheetState === 'open' ? 'Close' : 'Stations'}</div>
              </div>
            </div>
          </div>

          {/* Selected station card — shows in peek state when a station is tapped */}
          {selected && sheetState === 'peek' && (
            <div style={{ padding: '0 12px 10px', flexShrink: 0, animation: 'fadeIn 0.15s ease' }}>
              <div style={{ height: 1, background: '#1e293b', marginBottom: 10 }} />
              <div style={{ height: 2, borderRadius: 1, background: getBrandColor(selected.brand), marginBottom: 8 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{selected.name}</div>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{selected.county}</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: '#1e293b', border: 'none', borderRadius: 4, width: 24, height: 24, cursor: 'pointer', fontSize: 14, color: '#475569', flexShrink: 0, marginLeft: 8 }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 44px', gap: 8 }}>
                <div style={{ padding: '8px', borderRadius: 7, border: '1px solid #1e293b', background: '#0f172a', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3, fontWeight: 500 }}>Petrol</div>
                  <div style={{ fontSize: 17, fontWeight: 700, fontFamily: '"DM Mono", monospace', color: getPriceColor(selected.petrolPrice) }}>
                    {selected.petrolPrice ? `€${Number(selected.petrolPrice).toFixed(3)}` : '—'}
                  </div>
                </div>
                <div style={{ padding: '8px', borderRadius: 7, border: '1px solid #1e293b', background: '#0f172a', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3, fontWeight: 500 }}>Diesel</div>
                  <div style={{ fontSize: 17, fontWeight: 700, fontFamily: '"DM Mono", monospace', color: getPriceColor(selected.dieselPrice) }}>
                    {selected.dieselPrice ? `€${Number(selected.dieselPrice).toFixed(3)}` : '—'}
                  </div>
                </div>
                <button
                  onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`, '_blank')}
                  style={{ padding: '8px 4px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 7, fontSize: 20, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44 }}
                  title="Navigate"
                >
                  →
                </button>
              </div>
            </div>
          )}

          {/* Station list — visible when sheet is open */}
          {sheetState === 'open' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Filters */}
              <div style={{ padding: '10px 12px 6px', borderTop: '1px solid rgba(99,102,241,0.1)', flexShrink: 0 }}>
                <SearchBar search={search} onSearchChange={handleSearchChange} onSearchEnter={geocodeSearch} onClear={clearSearch} onLocate={locateMe} locating={locating} />
                {locateError && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, fontSize: 11, color: '#fca5a5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{locateError}</span>
                    <button onClick={() => setLocateError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8 }}>×</button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 4, background: '#1e293b', borderRadius: 6, padding: 3, flex: 1 }}>
                    {['all', 'petrol', 'diesel'].map(f => (
                      <button key={f} onClick={() => setFuelFilter(f)}
                        style={{ flex: 1, padding: '5px 0', borderRadius: 4, border: 'none', fontSize: 11, cursor: 'pointer', background: fuelFilter === f ? '#334155' : 'transparent', color: fuelFilter === f ? '#e2e8f0' : '#475569' }}>
                        {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div style={{ flex: 1 }}>
                    <CountySelect value={countyFilter} onChange={setCountyFilter} countyCounts={countyCounts} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>Sort</span>
                  {['price', 'distance', 'updated'].map(s => (
                    <button key={s} onClick={() => setSortBy(s)}
                      style={{ padding: '3px 10px', borderRadius: 4, border: 'none', fontSize: 10, cursor: 'pointer', background: sortBy === s ? '#2563eb' : '#1e293b', color: sortBy === s ? 'white' : '#475569', fontWeight: sortBy === s ? 600 : 400 }}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: '#64748b', fontFamily: '"DM Mono", monospace', fontWeight: 500 }}>{filtered.length}</span>
                </div>
              </div>

              {/* Scrollable list */}
              <div ref={stationListRef} style={{ overflowY: 'auto', flex: 1, padding: '4px 10px 20px' }}>
                {loading && (
                  <div style={{ padding: '12px 0' }}>
                    {[70, 55, 80].map((width, i) => (
                      <div key={i} style={{ padding: '12px', marginBottom: 4, borderRadius: 8, border: '1px solid #1e293b' }}>
                        <div style={{ height: 12, background: '#1e293b', borderRadius: 4, marginBottom: 8, width: `${width}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ height: 28, background: '#1e293b', borderRadius: 6, flex: 1 }} />
                          <div style={{ height: 28, background: '#1e293b', borderRadius: 6, flex: 1 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!loading && filtered.length === 0 && (
                  <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⛽</div>
                    <div style={{ fontSize: 13, color: '#475569', marginBottom: 4, fontWeight: 500 }}>
                      {countyFilter ? `No stations in ${countyFilter}` : 'No stations found'}
                    </div>
                    <div style={{ fontSize: 11, color: '#334155' }}>Try adjusting your filters</div>
                  </div>
                )}
                {!loading && filtered.map(s => (
                  <div key={s.id} ref={el => { stationCardRefs.current[s.id] = el }}>
                    <StationCard
                      s={s}
                      isSelected={selected?.id === s.id}
                      isCheapestPetrol={displayCheapest.petrol?.station_id === s.id}
                      isCheapestDiesel={displayCheapest.diesel?.station_id === s.id}
                      fuelFilter={fuelFilter}
                      userPos={userPos}
                      onClick={() => {
                        setSelected(s)
                        setSheetState('peek')
                        map.current?.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.current?.getZoom() ?? 12, 13) })
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report modal */}
      {reportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 env(safe-area-inset-bottom)' }}>
          <div style={{ background: '#0f172a', borderRadius: '12px 12px 0 0', border: '1px solid #1e293b', width: '100%', maxWidth: 480, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ width: 36, height: 4, background: '#334155', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0', marginBottom: 4 }}>Update prices</div>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 14 }}>{reportModal.name} · {reportModal.county}</div>
            {submitResult ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                {submitResult.error
                  ? <div style={{ color: '#ef4444', fontSize: 13 }}>{submitResult.error}</div>
                  : <div style={{ fontSize: 14, fontWeight: 500, color: '#22c55e' }}>Submitted — thanks!</div>
                }
              </div>
            ) : (
              <>
                {[
                  { label: 'Petrol price (€/L)', key: 'petrol_price', placeholder: reportModal.petrolPrice ? `Current: €${Number(reportModal.petrolPrice).toFixed(3)}` : 'e.g. 1.899' },
                  { label: 'Diesel price (€/L)', key: 'diesel_price', placeholder: reportModal.dieselPrice ? `Current: €${Number(reportModal.dieselPrice).toFixed(3)}` : 'e.g. 1.689' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 4 }}>{label}</label>
                    <input type="number" step="0.001" placeholder={placeholder}
                      onChange={e => setReportForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #334155', borderRadius: 8, fontSize: 16, marginBottom: 12, boxSizing: 'border-box', background: '#1e293b', color: '#e2e8f0', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                  <button onClick={() => { setReportModal(null); setSubmitResult(null) }}
                    style={{ padding: 12, background: 'transparent', border: '1px solid #1e293b', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: '#475569' }}>
                    Cancel
                  </button>
                  <button onClick={submitReport} disabled={submitting}
                    style={{ padding: 12, background: '#22c55e', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#0f172a', letterSpacing: '0.03em' }}>
                    {submitting ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}