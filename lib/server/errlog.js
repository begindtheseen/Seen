/**
 * Fire-and-forget error logger. Writes to the api_errors table in Supabase.
 * Never throws — logging must never break the request path.
 *
 * Returns a short `ref` (8 hex chars) that is ALSO stored on the row, so an endpoint can put
 * the ref in its error response ("something went wrong — ref a1b2c3d4") and a human-reported
 * failure maps straight to the logged row (with stack + context) — "always know what caused it."
 *
 * Accepts either an Error (preferred — its stack is captured) or a string message.
 *
 * Table DDL (run once):
 *   CREATE TABLE IF NOT EXISTS api_errors (
 *     id          bigserial PRIMARY KEY,
 *     endpoint    text NOT NULL,
 *     error_msg   text,
 *     context     jsonb,          -- { ref, stack, ...caller context }
 *     created_at  timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_api_errors_endpoint ON api_errors(endpoint);
 *   CREATE INDEX IF NOT EXISTS idx_api_errors_created  ON api_errors(created_at DESC);
 *   -- optional, for ref lookups:
 *   CREATE INDEX IF NOT EXISTS idx_api_errors_ref ON api_errors((context->>'ref'));
 */

import { randomBytes } from 'crypto';

export function logError(endpoint, errorOrMsg, context = {}) {
  // Short, unguessable correlation id. randomBytes never fails in the Node runtime.
  let ref;
  try { ref = randomBytes(4).toString('hex'); } catch { ref = String(Date.now()).slice(-8); }

  const isErr = errorOrMsg instanceof Error;
  const msg = String(isErr ? errorOrMsg.message : errorOrMsg).slice(0, 500);
  const stack = isErr && errorOrMsg.stack ? String(errorOrMsg.stack).slice(0, 4000) : undefined;
  const fullContext = { ref, ...(stack ? { stack } : {}), ...context };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    fetch(`${SUPABASE_URL}/rest/v1/api_errors`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ endpoint, error_msg: msg, context: fullContext }),
    }).catch(() => {}); // intentionally swallowed
  }

  // Always leave a server-side breadcrumb keyed by the same ref, so even if the DB write is
  // unavailable the ref in the user's error response can be grep'd out of the platform logs.
  try { console.error(`[err:${endpoint}] ref=${ref} ${msg}${stack ? `\n${stack}` : ''}`); } catch { /* ignore */ }

  // Optional real-time alerting. Set ERRLOG_WEBHOOK_URL (Slack or Discord incoming webhook)
  // in the environment to get pushed a message on every logged error — no code change needed.
  // Payload carries both `text` (Slack) and `content` (Discord); each side ignores the other.
  const WEBHOOK = process.env.ERRLOG_WEBHOOK_URL;
  if (WEBHOOK) {
    let detail = '';
    try { detail = Object.keys(context || {}).length ? ` \`${JSON.stringify(context).slice(0, 300)}\`` : ''; } catch { /* ignore */ }
    const line = `🚨 *Seen error* — \`${endpoint}\` ref \`${ref}\`: ${msg}${detail}`;
    fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: line, content: line }),
    }).catch(() => {}); // intentionally swallowed
  }

  return ref;
}
