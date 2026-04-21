import { supabaseAdmin } from '../../../lib/supabase'

const BASE_URL = 'https://api.oilpriceapi.com/v1/prices/latest'
const PETROL_CODE = 'GASOLINE_RETAIL_IE_EUR'
const DIESEL_CODE = 'DIESEL_RETAIL_IE_EUR'
const ANOMALY_THRESHOLD = 0.20

// ---------------------------------------------------------------------------
// SYNTHETIC VARIATION
// Applies realistic per-station price offsets derived from county, brand, and
// a deterministic station-ID hash. None of this is real price data — it is a
// stopgap that makes the map visually useful while real per-station scraping
// is not yet in place. All rows are marked source: 'scrape'.
// ---------------------------------------------------------------------------

const COUNTY_OFFSET = {
  'Dublin':      -0.030,
  'Cork':        -0.020,
  'Limerick':    -0.015,
  'Galway':      -0.010,
  'Waterford':   -0.010,
  'Kildare':     -0.015,
  'Meath':       -0.010,
  'Wicklow':     -0.008,
  'Louth':       -0.005,
  'Wexford':      0.005,
  'Kilkenny':     0.005,
  'Tipperary':    0.008,
  'Clare':        0.010,
  'Westmeath':    0.008,
  'Offaly':       0.010,
  'Laois':        0.010,
  'Carlow':       0.012,
  'Longford':     0.015,
  'Cavan':        0.015,
  'Monaghan':     0.015,
  'Roscommon':    0.018,
  'Sligo':        0.018,
  'Kerry':        0.020,
  'Mayo':         0.025,
  'Leitrim':      0.028,
  'Donegal':      0.032,
  'Antrim':      -0.005,
  'Armagh':       0.005,
  'Down':         0.000,
  'Fermanagh':    0.015,
  'Derry':        0.008,
  'Tyrone':       0.010,
}

const BRAND_OFFSET = {
  'Emo':         -0.030,
  'Inver':       -0.028,
  'Certa':       -0.025,
  'Amber':       -0.022,
  'Go':          -0.020,
  'GreatGas':    -0.018,
  'Campus Oil':  -0.015,
  'Campus':      -0.015,
  'Corrib Oil':  -0.012,
  'Morris Oil':  -0.010,
  'Tara Oil':    -0.010,
  'Tara':        -0.010,
  'Swift':       -0.008,
  'Top':         -0.008,
  'Topaz':       -0.008,
  'Tesco':       -0.010,
  'Applegreen':  -0.005,
  'Maxol':        0.000,
  'Texaco':       0.005,
  'Circle K':     0.005,
  'Shell':        0.012,
  'Esso':         0.010,
}

function stationNoise(id) {
  if (!id) return 0
  const hex = id.replace(/-/g, '').slice(0, 8)
  const val = parseInt(hex, 16)
  return ((val / 0xFFFFFFFF) * 0.030) - 0.015
}

function applyVariation(basePrice, station) {
  if (!basePrice) return null

  const countyOffset = COUNTY_OFFSET[station.county] ?? 0.010

  // Case-insensitive brand lookup — OSM data is inconsistent with capitalisation
  const brandKey = station.brand
    ? Object.keys(BRAND_OFFSET).find(
        k => k.toLowerCase() === station.brand.toLowerCase()
      )
    : null
  const brandOffset = brandKey ? BRAND_OFFSET[brandKey] : 0.000

  const noise = stationNoise(station.id)
  const price = basePrice + countyOffset + brandOffset + noise
  return parseFloat(Math.max(1.60, Math.min(2.40, price)).toFixed(3))
}

// ---------------------------------------------------------------------------

async function fetchIrelandPrices() {
  const headers = {
    'Authorization': `Token ${process.env.OIL_PRICE_API_KEY}`,
    'Content-Type': 'application/json',
  }

  const [petrolRes, dieselRes] = await Promise.all([
    fetch(`${BASE_URL}?by_code=${PETROL_CODE}`, { headers }),
    fetch(`${BASE_URL}?by_code=${DIESEL_CODE}`, { headers }),
  ])

  let petrolPrice = null
  let dieselPrice = null

  if (petrolRes.ok) {
    const data = await petrolRes.json()
    petrolPrice = data?.data?.price ?? null
  }

  if (dieselRes.ok) {
    const data = await dieselRes.json()
    dieselPrice = data?.data?.price ?? null
  }

  if (!petrolPrice || !dieselPrice) {
    const fallbackRes = await fetch(
      `${BASE_URL}?by_code=GASOLINE_USD,DIESEL_USD`,
      { headers }
    )
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json()
      const items = fallbackData?.data ?? []
      const gasItem    = Array.isArray(items) ? items.find(i => i.code === 'GASOLINE_USD') : null
      const dieselItem = Array.isArray(items) ? items.find(i => i.code === 'DIESEL_USD')   : null
      // Approximate USD/gallon -> EUR/litre conversion
      // Rate is hardcoded as a rough fallback — only used if IE-specific codes unavailable
      const USD_TO_EUR   = 0.92
      const GAL_TO_LITRE = 0.264172
      if (!petrolPrice && gasItem?.price) {
        petrolPrice = parseFloat((gasItem.price * USD_TO_EUR * GAL_TO_LITRE).toFixed(3))
      }
      if (!dieselPrice && dieselItem?.price) {
        dieselPrice = parseFloat((dieselItem.price * USD_TO_EUR * GAL_TO_LITRE).toFixed(3))
      }
    }
  }

  return { petrolPrice, dieselPrice }
}

// Uses direct REST fetch to bypass Supabase JS client 1000-row cap
async function fetchRecentAverages() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const res = await fetch(
    `${supabaseUrl}/rest/v1/prices?select=fuel_type,price&reported_at=gte.${cutoff}&source=eq.scrape&limit=10000`,
    {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Range':         '0-9999',
        'Prefer':        'count=none',
      },
    }
  )

  if (!res.ok) return { avgPetrol: null, avgDiesel: null }

  const data = await res.json()
  if (!data?.length) return { avgPetrol: null, avgDiesel: null }

  const petrolPrices = data.filter(r => r.fuel_type === 'petrol').map(r => r.price)
  const dieselPrices = data.filter(r => r.fuel_type === 'diesel').map(r => r.price)
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null

  return { avgPetrol: avg(petrolPrices), avgDiesel: avg(dieselPrices) }
}

async function fetchAllStations() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY

  const res = await fetch(
    `${supabaseUrl}/rest/v1/stations?select=id,county,brand&active=eq.true&limit=10000`,
    {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type':  'application/json',
        'Range':         '0-9999',
        'Prefer':        'count=none',
      },
    }
  )

  if (!res.ok) {
    throw new Error(`Failed to fetch stations: ${res.status} ${await res.text()}`)
  }

  return await res.json()
}

export async function runScraper() {
  const results = {
    started_at:       new Date().toISOString(),
    petrol_price:     null,
    diesel_price:     null,
    stations_fetched: 0,
    stations_updated: 0,
    anomaly_detected: false,
    error:            null,
  }

  try {
    const { petrolPrice, dieselPrice } = await fetchIrelandPrices()

    if (!petrolPrice && !dieselPrice) {
      throw new Error('No price data returned from OilPriceAPI')
    }

    results.petrol_price = petrolPrice
    results.diesel_price = dieselPrice

    const { avgPetrol, avgDiesel } = await fetchRecentAverages()

    if (avgPetrol && petrolPrice) {
      const deviation = Math.abs(petrolPrice - avgPetrol) / avgPetrol
      if (deviation > ANOMALY_THRESHOLD) {
        results.anomaly_detected = true
        throw new Error(
          `Petrol anomaly: ${petrolPrice} vs avg ${avgPetrol.toFixed(3)} (${(deviation * 100).toFixed(1)}% deviation)`
        )
      }
    }

    if (avgDiesel && dieselPrice) {
      const deviation = Math.abs(dieselPrice - avgDiesel) / avgDiesel
      if (deviation > ANOMALY_THRESHOLD) {
        results.anomaly_detected = true
        throw new Error(
          `Diesel anomaly: ${dieselPrice} vs avg ${avgDiesel.toFixed(3)} (${(deviation * 100).toFixed(1)}% deviation)`
        )
      }
    }

    const stations = await fetchAllStations()
    results.stations_fetched = stations.length

    if (!stations.length) {
      throw new Error('No active stations returned')
    }

    const now = new Date().toISOString()
    const priceRows = []

    for (const station of stations) {
      const stationPetrol = applyVariation(petrolPrice, station)
      const stationDiesel = applyVariation(dieselPrice, station)

      if (stationPetrol) {
        priceRows.push({
          station_id:  station.id,
          fuel_type:   'petrol',
          price:        stationPetrol,
          source:      'scrape',
          source_url:  'https://www.oilpriceapi.com',
          reported_at:  now,
        })
      }
      if (stationDiesel) {
        priceRows.push({
          station_id:  station.id,
          fuel_type:   'diesel',
          price:        stationDiesel,
          source:      'scrape',
          source_url:  'https://www.oilpriceapi.com',
          reported_at:  now,
        })
      }
    }

    const BATCH_SIZE = 500
    for (let i = 0; i < priceRows.length; i += BATCH_SIZE) {
      const batch = priceRows.slice(i, i + BATCH_SIZE)
      const { error: insertError } = await supabaseAdmin
        .from('prices')
        .insert(batch)
      if (insertError) throw new Error(`Batch insert failed at row ${i}: ${insertError.message}`)
    }

    results.stations_updated = stations.length

    const { error: refreshError } = await supabaseAdmin.rpc('refresh_cheapest_view')
    if (refreshError) {
      console.warn('Could not refresh cheapest view:', refreshError.message)
    }

  } catch (err) {
    results.error = err.message
    console.error('Scraper error:', err.message)
  }

  results.completed_at = new Date().toISOString()
  return results
}