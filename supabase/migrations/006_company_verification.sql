-- Company verification status, aliases, and data confidence tracking.
-- Apply in Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).
-- Safe to run multiple times — all statements are IF NOT EXISTS.

-- ── Add verification_status + aliases columns to company_scores ─────────────
ALTER TABLE company_scores
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending_enrichment',
  ADD COLUMN IF NOT EXISTS aliases             jsonb DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_company_scores_verif
  ON company_scores(verification_status);

-- ── company_aliases: canonical name → known aliases ──────────────────────────
-- Used by the resolve pipeline to prevent duplicate company records.
CREATE TABLE IF NOT EXISTS company_aliases (
  id         bigserial    PRIMARY KEY,
  canonical  text         NOT NULL,
  alias      text         NOT NULL,
  source     text         DEFAULT 'manual',
  created_at timestamptz  DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_co_aliases_alias
  ON company_aliases(lower(alias));

CREATE INDEX IF NOT EXISTS idx_co_aliases_canonical
  ON company_aliases(lower(canonical));

-- ── Seed known aliases (safe to re-run) ──────────────────────────────────────
INSERT INTO company_aliases (canonical, alias, source) VALUES
  ('Amazon',          'amazon web services',  'seed'),
  ('Amazon',          'aws',                  'seed'),
  ('Amazon',          'amazon.com',           'seed'),
  ('Amazon',          'amazon fresh',         'seed'),
  ('Amazon',          'whole foods',          'seed'),
  ('Amazon',          'zappos',               'seed'),
  ('Amazon',          'twitch',               'seed'),
  ('Meta',            'facebook',             'seed'),
  ('Meta',            'instagram',            'seed'),
  ('Meta',            'whatsapp',             'seed'),
  ('Meta',            'oculus',               'seed'),
  ('Google',          'alphabet',             'seed'),
  ('Google',          'alphabet inc',         'seed'),
  ('Google',          'youtube',              'seed'),
  ('Google',          'deepmind',             'seed'),
  ('Google',          'waymo',                'seed'),
  ('Microsoft',       'azure',                'seed'),
  ('Microsoft',       'github',               'seed'),
  ('Microsoft',       'xbox',                 'seed'),
  ('Microsoft',       'activision',           'seed'),
  ('JPMorgan Chase',  'jpmorgan',             'seed'),
  ('JPMorgan Chase',  'jp morgan',            'seed'),
  ('JPMorgan Chase',  'chase bank',           'seed'),
  ('JPMorgan Chase',  'chase',                'seed'),
  ('FedEx',           'federal express',      'seed'),
  ('FedEx',           'fedex ground',         'seed'),
  ('FedEx',           'fedex office',         'seed'),
  ('Goldman Sachs',   'gs',                   'seed'),
  ('Bank of America', 'bofa',                 'seed'),
  ('Bank of America', 'boa',                  'seed')
ON CONFLICT (lower(alias)) DO NOTHING;

-- ── Mark well-known companies as verified in company_scores ──────────────────
UPDATE company_scores
SET    verification_status = 'verified'
WHERE  report_count >= 10
  AND  verification_status = 'pending_enrichment';
