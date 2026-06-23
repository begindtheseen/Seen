/**
 * Fire-and-forget error logger. Writes to api_errors table in Supabase.
 * Never throws — logging must never break the request path.
 *
 * Table DDL (run once):
 *   CREATE TABLE IF NOT EXISTS api_errors (
 *     id          bigserial PRIMARY KEY,
 *     endpoint    text NOT NULL,
 *     error_msg   text,
 *     context     jsonb,
 *     created_at  timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_api_errors_endpoint ON api_errors(endpoint);
 *   CREATE INDEX IF NOT EXISTS idx_api_errors_created  ON api_errors(created_at DESC);
 */

export function logError(endpoint, errorMsg, context = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const msg = String(errorMsg).slice(0, 500);

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    fetch(`${SUPABASE_URL}/rest/v1/api_errors`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ endpoint, error_msg: msg, context }),
    }).catch(() => {}); // intentionally swallowed
  }

  // Optional real-time alerting. Set ERRLOG_WEBHOOK_URL (Slack or Discord incoming webhook)
  // in the environment to get pushed a message on every logged error — no code change needed.
  // Payload carries both `text` (Slack) and `content` (Discord); each side ignores the other.
  const WEBHOOK = process.env.ERRLOG_WEBHOOK_URL;
  if (WEBHOOK) {
    let detail = '';
    try { detail = Object.keys(context || {}).length ? ` \`${JSON.stringify(context).slice(0, 300)}\`` : ''; } catch { /* ignore */ }
    const line = `🚨 *Seen error* — \`${endpoint}\`: ${msg}${detail}`;
    fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: line, content: line }),
    }).catch(() => {}); // intentionally swallowed
  }
}
