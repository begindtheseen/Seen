// /llms-full.txt: the llms.txt header plus one fact line for EVERY graded company (lib/llmsText.ts).
import { getOpenDataset, OPEN_FILE_HEADERS, UNAVAILABLE_HEADERS } from '@/lib/server/openDataRead'
import { llmsFullTxt } from '@/lib/llmsText'

export const dynamic = 'force-dynamic'

export async function GET() {
  const d = await getOpenDataset()
  if (!d) return new Response('# Seen\n\n> Seen (seenjobs.io) publishes how employers treat job applicants. The company list could not be read just now; see https://seenjobs.io/companies\n', { status: 503, headers: UNAVAILABLE_HEADERS })
  return new Response(llmsFullTxt(d), { headers: { ...OPEN_FILE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
}
