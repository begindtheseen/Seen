// The one HTML escaper for server-built HTML (emails). Escapes & < > " ' so a value is safe in text
// and inside a quoted attribute (security audit 2026-11-01).
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** An href built from data: only absolute http(s) URLs survive (escaped); anything else is ''. */
export function safeHref(url) {
  const s = String(url ?? '').trim();
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  return escapeHtml(u.toString());
}
