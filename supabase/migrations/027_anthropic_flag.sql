-- Migration 027: admin-toggleable Anthropic master switch.
--
-- The product is built to run fully WITHOUT Anthropic: company grades are computed by aggregating
-- real reports (api/reports.js company-score path), job search serves the DB corpus, and the
-- credit-gated AI tools fall back to an OpenAI-compatible provider. This flag (default OFF) lets an
-- admin re-enable Anthropic web-research enrichment + Claude-backed tools from the feature-flags
-- panel if it's ever needed again. Read by lib/server/aiflag.js (cached 60s).
--
-- Treated as ENABLED only when status is 'fully_on' / 'on' / 'admin_only'; anything else (incl. a
-- missing row) means disabled.

INSERT INTO public.feature_flags (flag_name, status, description, updated_by)
VALUES (
  'anthropic_enabled',
  'off',
  'Master switch for Anthropic/Claude usage (company web-research enrichment + AI tools). OFF = product runs fully on aggregated report data + fallback provider. Flip to fully_on only if needed.',
  'launch-hardening'
)
ON CONFLICT (flag_name) DO UPDATE SET description = EXCLUDED.description;
