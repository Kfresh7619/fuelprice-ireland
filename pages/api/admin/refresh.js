import { supabaseAdmin } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const token = req.headers['x-admin-token']
  if (token !== process.env.ADMIN_REFRESH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const { error } = await supabaseAdmin.rpc('refresh_cheapest_view')
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ refreshed: true, at: new Date().toISOString() })
}