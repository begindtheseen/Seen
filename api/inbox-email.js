// Inbox Autopilot — the receiving end (2026-10-21).
//
//   POST  (Resend webhook, event `email.received`) → read that one email by id and update the tracker.
//   GET   (Vercel cron, hourly)                    → catch up on any email no webhook delivered.
//   GET   ?check=1                                 → { ready, resend_read } — is the feature wired? No data.
//
// The webhook is a poke, not a source of truth: Seen fetches the email from Resend with its own key, so
// the request body is never trusted (see lib/server/inbox/store.js). No secret to configure.
// Vercel crons fire GET with `x-vercel-cron: 1` (api/demand.js); a manual run uses ?secret=<CRON_SECRET>.

import { dbClient, resendClient, tablesReady, processEmail, catchUp, isProviderId } from '../lib/server/inbox/store.js';
import { rateLimit as defaultRateLimit } from '../lib/server/ratelimit.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_KEY || process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const CHECK_TTL_MS = 5 * 60 * 1000;
let lastCheck = null; // { at, body } — the public check answers from cache so it can't be used to hammer Resend

export default async function handler(req, res, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const rateLimit = deps.rateLimit || defaultRateLimit;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ ok: false, error: 'db_not_configured' });
  if (!RESEND_KEY) return res.status(200).json({ ok: false, error: 'no_resend_key' });
  const q = dbClient(SUPABASE_URL, SERVICE_KEY, fetchImpl);
  const resend = resendClient(RESEND_KEY, fetchImpl);

  if (req.method === 'POST') {
    // Every webhook makes Seen read one email from Resend; a flood of fake ids must not become a flood of reads.
    if (!(await rateLimit(req, 'inbox-webhook')).allowed) return res.status(429).json({ ok: false, error: 'rate_limited' });
    const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
    if (body.type !== 'email.received') return res.status(200).json({ ok: true, ignored: body.type || 'no type' });
    const id = body.data && body.data.email_id;
    if (!isProviderId(id)) return res.status(400).json({ ok: false, error: 'bad email_id' });
    if (!(await tablesReady(q))) return res.status(200).json({ ok: false, error: 'not_set_up' });
    const r = await processEmail({ q, resend, id });
    if (r.state === 'resend_forbidden') console.error('[inbox-email] the Resend key cannot read received email — it needs Full access');
    if (r.state === 'failed') console.error('[inbox-email] failed: %s', logSafe(r.error));
    // 500 on a transient read failure makes Resend retry the webhook; everything else is final.
    return res.status(r.state === 'retry' ? 500 : 200).json({ ok: r.state !== 'failed', state: r.state });
  }

  if (req.method === 'GET') {
    if (req.query && req.query.check) {
      if (lastCheck && Date.now() - lastCheck.at < CHECK_TTL_MS) return res.status(200).json({ ...lastCheck.body, cached: true });
      if (!(await rateLimit(req, 'inbox-check')).allowed) return res.status(429).json({ ok: false, error: 'rate_limited' });
      const ready = await tablesReady(q);
      const probe = await resend.list(1);
      const body = { ok: ready && probe.ok, ready, resend_read: probe.ok ? 'ok' : probe.status === 401 || probe.status === 403 ? 'forbidden' : 'error' };
      lastCheck = { at: Date.now(), body };
      return res.status(200).json(body);
    }
    const isCron = req.headers['x-vercel-cron'] === '1';
    const hasSecret = CRON_SECRET && (req.headers['x-cron-secret'] === CRON_SECRET || (req.query && req.query.secret === CRON_SECRET));
    if (!isCron && !hasSecret) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!(await tablesReady(q))) return res.status(200).json({ ok: false, error: 'not_set_up' });
    const r = await catchUp({ q, resend });
    if (!r.ok) console.error('[inbox-email] catch-up: %s', logSafe(r.error));
    return res.status(200).json(r);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'method not allowed' });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// Text from Resend or the DB in a log line: one line, printable, short (CodeQL log-injection form).
function logSafe(v) { return String(v == null ? '' : v).replace(/\n|\r/g, ' ').replace(/[^\x20-\x7e]/g, '').slice(0, 160); }
