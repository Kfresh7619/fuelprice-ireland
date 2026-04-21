import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function restFetch(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Range':         '0-9999',
      'Prefer':        'count=none',
    },
  })
  if (!res.ok) {
    throw new Error(`REST fetch failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function GET() {
  try {
    // Fetch all active stations
    const stations = await restFetch(
      'stations?select=id,name,brand,town,county,lat,lng,address&active=eq.true&limit=10000'
    )

    if (!stations.length) {
      return NextResponse.json({ stations: [] })
    }

    // Fetch only recent prices (last 48h) to keep payload small as table grows.
    // 48h window ensures we always have scraper data even if a run fails.
    // Order desc so the Map below keeps the most recent row per station+fuel.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const prices = await restFetch(
      `prices?select=station_id,fuel_type,price,source,reported_at` +
      `&reported_at=gte.${cutoff}` +
      `&order=reported_at.desc` +
      `&limit=10000`
    )

    // Deduplicate to latest price per station+fuel_type
    const latestPrices = new Map<string, any>()
    for (const row of prices) {
      const key = `${row.station_id}:${row.fuel_type}`
      if (!latestPrices.has(key)) {
        latestPrices.set(key, row)
      }
    }

    // Group by station
    const pricesByStation = new Map<string, any[]>()
    for (const [, row] of latestPrices) {
      const existing = pricesByStation.get(row.station_id) ?? []
      existing.push({
        fuel_type:   row.fuel_type,
        price:       row.price,
        source:      row.source,
        reported_at: row.reported_at,
      })
      pricesByStation.set(row.station_id, existing)
    }

    const result = stations.map((station: any) => ({
      ...station,
      prices: pricesByStation.get(station.id) ?? [],
    }))

    const response = NextResponse.json({ stations: result })
    // Cache at CDN edge for 60s — reduces cold load time significantly
    // while keeping data fresh enough for a fuel price app
    response.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return response

  } catch (err: any) {
    console.error('stations/all error:', err.message)
    return NextResponse.json({ error: 'Failed to fetch stations' }, { status: 500 })
  }
}