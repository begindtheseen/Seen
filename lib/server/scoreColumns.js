// Optional company_scores columns, detected at runtime so code can ship BEFORE its additive
// migration (CLAUDE.md: deploy code before schema, or make both orders safe).
//
// mention_count (migration 20261018120000_company_score_mentions.sql): "what people are saying"
// mentions behind a score. Until the column exists every read and write leaves it out, and the
// site behaves exactly as before. Cached per instance; a failed probe is retried after 60s.

let _probe = { at: 0, has: null };

/** True once company_scores.mention_count exists. Never throws. Defaults to the server's env creds. */
export async function hasMentionCount(url, headers, fetchImpl = fetch) {
  const now = Date.now();
  if (_probe.has === true) return true;
  if (_probe.has === false && now - _probe.at < 60_000) return false;
  const base = url || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const hdrs = headers || (key ? { apikey: key, Authorization: `Bearer ${key}` } : null);
  if (!base || !hdrs) { _probe = { at: now, has: false }; return false; }
  try {
    const r = await fetchImpl(`${base}/rest/v1/company_scores?select=mention_count&limit=1`, { headers: hdrs });
    _probe = { at: now, has: r.ok };
  } catch { _probe = { at: now, has: false }; }
  return _probe.has;
}

/** ",mention_count" when the column exists, else "" — append to an explicit company_scores select. */
export async function mentionSel(url, headers, fetchImpl = fetch) {
  return (await hasMentionCount(url, headers, fetchImpl)) ? ',mention_count' : '';
}

/** Test seam. */
export function _resetScoreColumnProbe() { _probe = { at: 0, has: null }; }
