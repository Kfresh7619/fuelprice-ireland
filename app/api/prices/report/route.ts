import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

const VALID_FUEL_TYPES = ['petrol', 'diesel', 'premium_petrol', 'premium_diesel'];

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { station_id, fuel_type, price } = body;

  // Validate inputs
  if (!station_id || typeof station_id !== 'string') {
    return NextResponse.json({ error: 'station_id is required' }, { status: 400 });
  }

  if (!fuel_type || !VALID_FUEL_TYPES.includes(fuel_type)) {
    return NextResponse.json(
      { error: `fuel_type must be one of: ${VALID_FUEL_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0.5 || parsedPrice > 5.0) {
    return NextResponse.json(
      { error: 'price must be a number between 0.5 and 5.0' },
      { status: 400 }
    );
  }

  // Confirm station exists
  const { data: station, error: stationError } = await supabaseAdmin
    .from('stations')
    .select('id')
    .eq('id', station_id)
    .single();

  if (stationError || !station) {
    return NextResponse.json({ error: 'Station not found' }, { status: 404 });
  }

  // Rate limiting — max 3 reports per station per hour from the same IP
  // Fix: filter by source_ip so different users don't block each other
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await supabaseAdmin
    .from('prices')
    .select('*', { count: 'exact', head: true })
    .eq('station_id', station_id)
    .eq('source', 'crowdsource')
    .eq('source_url', ip)   // source_url used to store submitter IP (no PII column needed)
    .gte('reported_at', oneHourAgo);

  if (count && count >= 3) {
    return NextResponse.json(
      { error: 'Too many reports for this station. Try again later.' },
      { status: 429 }
    );
  }

  // Insert the report — source_url stores the submitter IP for rate limiting
  const { data, error: insertError } = await supabaseAdmin
    .from('prices')
    .insert({
      station_id,
      fuel_type,
      price:        parsedPrice,
      source:       'crowdsource',
      source_url:    ip,
      reported_at:   new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    console.error(insertError);
    return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
  }

  // Refresh the materialised view so cheapest banner updates immediately
  // Cast to Promise to avoid TypeScript complaining about PostgrestFilterBuilder
  void (supabaseAdmin.rpc('refresh_cheapest_view') as unknown as Promise<any>).catch(() => {
    // Non-fatal — view will catch up on next scrape
  });

  return NextResponse.json({ success: true, report: data }, { status: 201 });
}