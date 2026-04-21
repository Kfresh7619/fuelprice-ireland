import { runScraper } from '../scraper/oilprice'

export default async function handler(req, res) {
  // Vercel Cron authenticates with Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const results = await runScraper()

  if (results.error) {
    console.error('Scraper cron error:', results.error)
    return res.status(500).json(results)
  }

  console.log('Scraper cron success:', JSON.stringify(results))
  return res.status(200).json(results)
}