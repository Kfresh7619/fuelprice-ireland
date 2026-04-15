import { createClient } from '@supabase/supabase-js'

// Server-side client — uses service key, full access
// Only import this in API routes, never in page components
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Client-side client — uses anon key, respects RLS
// Safe to use in page components and hooks
export const supabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)