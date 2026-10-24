// The open dataset files (CC BY 4.0), from the same snapshot as /data (lib/server/openDataRead.ts):
//   /data/employer-response-rates.csv   one row per graded company
//   /data/employer-response-rates.json  the same rows with field descriptions
// One dynamic segment instead of folders named "*.csv" / "*.json": Next's generate-mode build globs
// `.next/server/**/*.json` and a route FOLDER named "employer-response-rates.json" fails it with EISDIR.
import { getOpenDataset, OPEN_FILE_HEADERS, UNAVAILABLE_HEADERS } from '@/lib/server/openDataRead'
import { datasetCsv, datasetJson, LICENSE_URL, CSV_PATH, JSON_PATH } from '@/lib/openDataset'

export const dynamic = 'force-dynamic'

const FILES: Record<string, 'csv' | 'json'> = {
  [CSV_PATH.split('/').pop()!]: 'csv',
  [JSON_PATH.split('/').pop()!]: 'json',
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const kind = FILES[file]
  if (!kind) return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  const d = await getOpenDataset()
  if (!d) return new Response('The dataset could not be read just now. Try again in a few minutes.\n', { status: 503, headers: UNAVAILABLE_HEADERS })
  const link = `<${LICENSE_URL}>; rel="license", <https://seenjobs.io/data>; rel="describedby"`
  if (kind === 'csv') {
    return new Response(datasetCsv(d), {
      headers: {
        ...OPEN_FILE_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8; header=present',
        'Content-Disposition': `inline; filename="seen-employer-response-rates-${d.asOfDate}.csv"`,
        Link: link,
      },
    })
  }
  return new Response(`${JSON.stringify(datasetJson(d), null, 2)}\n`, {
    headers: { ...OPEN_FILE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', Link: link },
  })
}
