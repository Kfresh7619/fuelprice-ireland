import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

const VALID_FUEL_TYPES = ['petrol', 'diesel', 'premium_petrol', 'premium_diesel'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const county = searchParams.get('county');
  const fuel = searchParams.get('fuel');

  // Validate fuel type if provided
  if (fuel && !VALID_FUEL_TYPES.includes(fuel)) {
    return NextResponse.json(
      { error: `fuel must be one of: ${VALID_FUEL_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  // Query the materialised view
  let query = supabaseAdmin
    .from('cheapest_by_county')
    .select('county, fuel_type, price, station_id, station_name, reported_at')
    .order('county', { ascending: true })
    .order('fuel_type', { ascending: true });

  if (county) {
    query = query.ilike('county', county);
  }

  if (fuel) {
    query = query.eq('fuel_type', fuel);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }

  // Group by county for a cleaner response shape
  const grouped: Record<string, any> = {};
  for (const row of data) {
    if (!grouped[row.county]) {
      grouped[row.county] = { county: row.county, fuels: {} };
    }
    grouped[row.county].fuels[row.fuel_type] = {
      price: row.price,
      station_id: row.station_id,
      station_name: row.station_name,
      reported_at: row.reported_at,
    };
  }

  const result = Object.values(grouped);

  return NextResponse.json({ count: result.length, counties: result });
}