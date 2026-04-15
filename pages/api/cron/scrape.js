import { runScraper } from '../scraper/oilprice'

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const results = await runScraper()

  if (results.error) {
    console.error('Scraper error:', results.error)
    return res.status(500).json(results)
  }

  console.log('Scraper success:', results)
  return res.status(200).json(results)
}