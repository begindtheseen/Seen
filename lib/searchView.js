// Which block the /jobs results area shows. ONE decision for the whole page so a failed search can
// never render "Search failed" and "No matches for this search" at the same time (audit 2026-10-24,
// R-3): error wins over everything but a result list, and the empty state exists only for a finished
// search that genuinely found nothing. Pure — shared by lib/hooks/useJobSearch.ts's page and the test.

/**
 * @param {{ status: 'idle'|'loading'|'done'|'error', count: number }} s
 * @returns {'results'|'error'|'idle'|'loading'|'empty'}
 */
export function resultsView({ status, count }) {
  if (count > 0) return 'results'
  if (status === 'error') return 'error'
  if (status === 'idle') return 'idle'
  if (status === 'loading') return 'loading'
  return 'empty'
}
