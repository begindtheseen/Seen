// /llms.txt (https://llmstxt.org): what Seen is, what to cite, and the 25 most reported companies' facts.
// Built from the open dataset snapshot so its numbers match the company pages, /data and /lists.
// Replaces the old static public/llms.txt.
import { getOpenDataset, OPEN_FILE_HEADERS, UNAVAILABLE_HEADERS } from '@/lib/server/openDataRead'
import { llmsTxt } from '@/lib/llmsText'

export const dynamic = 'force-dynamic'

export async function GET() {
  const d = await getOpenDataset()
  if (!d) return new Response('# Seen\n\n> Seen (seenjobs.io) publishes how employers treat job applicants. The company list could not be read just now; see https://seenjobs.io/companies\n', { status: 503, headers: UNAVAILABLE_HEADERS })
  return new Response(llmsTxt(d), { headers: { ...OPEN_FILE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
}
