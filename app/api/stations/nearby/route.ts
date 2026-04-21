import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');
  const radius = parseFloat(searchParams.get('radius') ?? '10000');
  const fuel = searchParams.get('fuel');
  const county = searchParams.get('county');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: 'lat and lng are required' },
      { status: 400 }
    );
  }

  const { data: stations, error: stationsError } = await supabaseAdmin.rpc(
    'get_nearby_stations',
    { user_lat: lat, user_lng: lng, radius_metres: radius }
  );

  if (stationsError) {
    console.error(stationsError);
    return NextResponse.json({ error: 'Failed to fetch stations' }, { status: 500 });
  }

  if (!stations.length) {
    return NextResponse.json({ stations: [] });
  }

  // Apply county filter if provided
  const filteredStations = county
    ? stations.filter((s: any) => s.county?.toLowerCase() === county.toLowerCase())
    : stations;

  const stationIds = filteredStations.map((s: any) => s.id);

  let pricesQuery = supabaseAdmin
    .from('prices')
    .select('station_id, fuel_type, price, source, reported_at')
    .in('station_id', stationIds)
    .order('reported_at', { ascending: false });

  if (fuel) {
    pricesQuery = pricesQuery.eq('fuel_type', fuel);
  }

  const { data: prices, error: pricesError } = await pricesQuery;

  if (pricesError) {
    console.error(pricesError);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }

  const latestPrices = new Map<string, any>();
  for (const row of prices) {
    const key = `${row.station_id}:${row.fuel_type}`;
    if (!latestPrices.has(key)) {
      latestPrices.set(key, row);
    }
  }

  const result = filteredStations.map((station: any) => ({
    ...station,
    prices: prices
      .filter((p: any) => p.station_id === station.id)
      .filter((p: any) => {
        const key = `${p.station_id}:${p.fuel_type}`;
        return latestPrices.get(key) === p;
      })
      .map((p: any) => ({
        fuel_type: p.fuel_type,
        price: p.price,
        source: p.source,
        reported_at: p.reported_at,
      })),
  }));

  return NextResponse.json({ stations: result });
}