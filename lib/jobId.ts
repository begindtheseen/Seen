// Deterministic, content-derived listing id.
//
// The old search flow assigned `'srch_' + Math.random()` to any listing without a
// DB id, so the SAME listing got a DIFFERENT id on every page load. Saving stored
// that throwaway id, and reopening could never resolve it — the root cause of
// "saved listings weren't clickable / couldn't return to them."
//
// A stable hash of the listing's identifying fields means the same listing always
// produces the same id, so saves dedupe correctly and a saved id stays meaningful.

export function stableJobId(parts: {
  company?: string | null
  title?: string | null
  location?: string | null
  apply_url?: string | null
}): string {
  const basis = [parts.company, parts.title, parts.location, parts.apply_url]
    .map((x) => (x ?? '').toString().toLowerCase().trim())
    .join('|')
  let h = 0
  for (let i = 0; i < basis.length; i++) h = (Math.imul(h, 31) + basis.charCodeAt(i)) | 0
  return 'j_' + (h >>> 0).toString(36)
}
