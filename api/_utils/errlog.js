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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;

  fetch(`${SUPABASE_URL}/rest/v1/api_errors`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      endpoint,
      error_msg: String(errorMsg).slice(0, 500),
      context,
    }),
  }).catch(() => {}); // intentionally swallowed
}
