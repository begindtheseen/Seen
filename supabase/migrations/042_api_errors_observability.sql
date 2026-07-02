-- 042 — API error observability (the "better debugger" surface).
--
-- lib/server/errlog.js writes every handler error here with a short correlation `ref` and the
-- full stack in `context` jsonb. Endpoints return that ref to the client, so a user-reported
-- failure ("error ref a1b2c3d4") maps straight to the row with the stack that caused it.
--
-- Idempotent — prod already has the table (and these indexes were hand-applied 2026-07-02);
-- this codifies it for fresh / restored environments. Module-LOAD crashes (a serverless .js
-- importing a .ts) never reach this table — those are caught pre-deploy by api/importGraph.test.mjs.

CREATE TABLE IF NOT EXISTS api_errors (
  id          bigserial PRIMARY KEY,
  endpoint    text NOT NULL,
  error_msg   text,
  context     jsonb,            -- { ref, stack, ...caller context (action, method, tool) }
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_errors_endpoint ON api_errors (endpoint);
CREATE INDEX IF NOT EXISTS idx_api_errors_created  ON api_errors (created_at DESC);
-- Fast lookup by the ref surfaced to the user.
CREATE INDEX IF NOT EXISTS idx_api_errors_ref      ON api_errors ((context->>'ref'));
