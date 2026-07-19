-- Migration 054: live per-company Reddit search — cache + dispute/correction path.
--
-- WHY: a company page's Reddit section used to populate ONLY for companies the slow
-- batch cron (api/reports.js ?reddit_cron=…) happened to reach, so most companies showed
-- an empty section. This adds a LIVE, CACHED per-company Reddit search (api/company-reddit.js)
-- so any company's section fills on demand, plus a good-faith dispute path.
--
-- DEFAMATION-SAFE: company_reddit_cache stores only LINKS to public Reddit threads (title,
-- subreddit, permalink, date) framed in the UI as public third-party discussion
-- (PUBLIC_DISCUSSION_LABEL) — never Seen's own assertion, and it NEVER feeds a company's
-- score (the scored, Anthropic-classified Reddit-ingest path stays in api/reports.js and is
-- untouched). This table is display-only.
--
-- Both tables are server-only: RLS ON with NO policy, exactly like suppressed_listings (047)
-- and employer_purchases (048). The company page reads/writes them through api/company-reddit.js
-- with the Supabase service key, which bypasses RLS; no anon/authenticated role can read or
-- write them directly. Idempotent.

-- ── Per-company cached live-search results ─────────────────────────────────────────
-- One row per normalized company (company_key = lowercased, legal-suffix-stripped name).
-- `items` is the ranked, attributed thread list the endpoint serves; `status` distinguishes
-- a populated result ('ok') from an honestly-empty one ('empty') so the endpoint can cache
-- empties briefly (short TTL) without re-hammering Reddit. `expires_at` drives freshness.
CREATE TABLE IF NOT EXISTS company_reddit_cache (
  company_key   text        PRIMARY KEY,               -- normalized cache key
  company_name  text        NOT NULL,                  -- display name as searched
  items         jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [{ id,title,subreddit,permalink,author,created }]
  item_count    integer     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'ok',     -- ok | empty | error
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now()     -- fetched_at + TTL (set by the endpoint)
);

-- Sweep/refresh helper: find the stalest rows first when a background warm pass runs.
CREATE INDEX IF NOT EXISTS idx_company_reddit_cache_expires ON company_reddit_cache (expires_at);

ALTER TABLE company_reddit_cache ENABLE ROW LEVEL SECURITY;

-- ── Dispute / correction submissions ───────────────────────────────────────────────
-- A company (or anyone acting in good faith) can flag that the surfaced discussion is a
-- name collision, outdated, misleading, or resolved. No auth required (the point is a low-
-- friction correction process that reduces liability); the endpoint rate-limits and hard-
-- caps every field. Rows land here 'open' for the owner to review in admin.
CREATE TABLE IF NOT EXISTS company_reddit_disputes (
  id            bigserial   PRIMARY KEY,
  company_name  text        NOT NULL,
  company_key   text,                                  -- normalized, for grouping with the cache
  reason        text        NOT NULL,                  -- not_us | outdated | misleading | resolved | other
  detail        text        NOT NULL,
  permalink     text,                                  -- the specific thread disputed, if any
  contact       text,                                  -- optional follow-up email
  status        text        NOT NULL DEFAULT 'open',   -- open | reviewed | actioned | dismissed
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Review queue: open disputes newest-first, and lookups by company.
CREATE INDEX IF NOT EXISTS idx_company_reddit_disputes_status ON company_reddit_disputes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_reddit_disputes_company ON company_reddit_disputes (company_key);

ALTER TABLE company_reddit_disputes ENABLE ROW LEVEL SECURITY;
