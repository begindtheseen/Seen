// Who may run a cron endpoint.
//
// Vercel authenticates its cron invocations with `Authorization: Bearer <CRON_SECRET>` (docs: "Securing
// cron jobs"). It does NOT send an `x-vercel-cron` header, and any client can send one, so that header
// proves nothing. Until 2026-10-24 seven crons trusted only it: Vercel's real calls were refused every
// run (the Day 7/14/30 outcome emails never sent once; the monthly demand refresh stopped in August),
// and anyone could trigger them, including the paid web-research actions behind isAdminOrCron.
//
// Fail closed: with no CRON_SECRET set, nothing is a cron.

/** True only for Vercel's own cron call: the exact `Authorization: Bearer <CRON_SECRET>` header. */
export function isVercelCron(req, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  const h = (req && req.headers) || {};
  const auth = typeof h.get === 'function' ? h.get('authorization') : (h.authorization ?? h.Authorization);
  return auth === `Bearer ${secret}`;
}

/** A manual run by someone holding the secret: the Bearer header, `x-cron-secret`, or `?secret=`. */
export function hasCronSecret(req, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  if (isVercelCron(req, secret)) return true;
  const h = (req && req.headers) || {};
  if (h['x-cron-secret'] === secret) return true;
  let q = req && req.query && req.query.secret;
  if (q == null && req && typeof req.url === 'string') {
    try { q = new URL(req.url, 'https://x').searchParams.get('secret'); } catch { q = null; }
  }
  return q === secret;
}

/** A live admin session (`x-admin-token` checked against admin_sessions). */
export async function hasAdminSession(req, { url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY, fetchImpl = fetch } = {}) {
  const token = String(((req && req.headers) || {})['x-admin-token'] || '').trim();
  if (!token || !url || !key) return false;
  try {
    const r = await fetchImpl(`${url}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(token)}&select=expires_at&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return false;
    const row = (await r.json())?.[0];
    return !!row && new Date(row.expires_at) > new Date();
  } catch {
    return false;
  }
}
