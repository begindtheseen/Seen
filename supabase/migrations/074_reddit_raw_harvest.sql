-- Migration 074: raw Reddit harvest store + fetch telemetry.
--
-- WHY: measured 2026-08-15 against production — the Reddit pipeline had touched 33 of 37,791
-- companies (0.09%) in two months, its last successful extraction was 2026-06-14, and every
-- one of the 630 posts fetched since then was written to reddit_imports as
-- skip_reason='no_experiences_extracted'. That label was unfalsifiable: api/reports.js
-- extractReports did `if (!r.ok) return []`, so an Anthropic outage and a genuinely empty
-- thread produced the identical row. There was no way to tell a broken pipeline from a quiet
-- one, which is why it stayed broken for two months.
--
-- Two tables fix that, and they separate COLLECTION from INTERPRETATION:
--   reddit_raw       — what Reddit actually returned, kept verbatim. Re-running aggregation
--                      (a better matcher, a different classifier) no longer means re-fetching,
--                      which is the whole reason the corpus could never be rebuilt before.
--   reddit_fetch_log — one row per HTTP call with its real status. A zero-yield run is now
--                      self-describing: blocked (403), throttled (429), or genuinely empty.
--
-- Both are server-only: RLS ON with NO policy, matching suppressed_listings (047) and
-- employer_purchases (048). Only the service key reaches them. Idempotent.

-- ── Raw harvested posts/comments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reddit_raw (
  post_id       text        PRIMARY KEY,             -- Reddit fullname, e.g. t3_abc123
  kind          text        NOT NULL DEFAULT 'post', -- post | comment
  subreddit     text        NOT NULL,
  title         text,
  body          text,
  author        text,
  created_utc   bigint,                              -- Reddit's own timestamp, for recency weighting
  score         integer,
  num_comments  integer,
  permalink     text,
  raw           jsonb,                               -- verbatim normalized payload
  harvested_at  timestamptz NOT NULL DEFAULT now(),
  -- Aggregation bookkeeping. NULL processed_at = harvested but not yet interpreted, so a
  -- classifier change can requeue rows by nulling this instead of re-hitting Reddit.
  processed_at  timestamptz,
  match_count   integer     NOT NULL DEFAULT 0       -- companies detected in this post
);
CREATE INDEX IF NOT EXISTS idx_reddit_raw_unprocessed ON reddit_raw(harvested_at DESC) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reddit_raw_sub_created ON reddit_raw(subreddit, created_utc DESC);

ALTER TABLE reddit_raw ENABLE ROW LEVEL SECURITY;

-- ── Fetch telemetry: makes a zero explain itself ────────────────────────────────────
CREATE TABLE IF NOT EXISTS reddit_fetch_log (
  id          bigserial   PRIMARY KEY,
  endpoint    text        NOT NULL,   -- new | top | search | comments
  subreddit   text,
  http_status integer,                -- NULL = never got a response (timeout/network)
  host        text,                   -- which host answered (www vs old)
  items       integer     NOT NULL DEFAULT 0,
  ok          boolean     NOT NULL DEFAULT false,
  error       text,                   -- 'blocked' | 'rate limited' | 'timeout' | HTTP n | parse
  ms          integer,
  attempts    integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reddit_fetch_log_created ON reddit_fetch_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_fetch_log_failing ON reddit_fetch_log(created_at DESC) WHERE NOT ok;

ALTER TABLE reddit_fetch_log ENABLE ROW LEVEL SECURITY;

-- ── Company matches found in harvested text ─────────────────────────────────────────
-- Kept separate from `reports` on purpose: a detected mention is a CLAIM with a confidence,
-- not a hiring outcome. Only rows that survive classification become weighted reports.
CREATE TABLE IF NOT EXISTS reddit_company_match (
  id           bigserial   PRIMARY KEY,
  post_id      text        NOT NULL REFERENCES reddit_raw(post_id) ON DELETE CASCADE,
  company_name text        NOT NULL,
  company_id   uuid,
  confidence   numeric(4,2) NOT NULL,
  evidence     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, company_name)
);
CREATE INDEX IF NOT EXISTS idx_reddit_match_company ON reddit_company_match(company_name);
CREATE INDEX IF NOT EXISTS idx_reddit_match_conf    ON reddit_company_match(confidence DESC);

ALTER TABLE reddit_company_match ENABLE ROW LEVEL SECURITY;

-- Verification:
--   SELECT count(*) FROM reddit_raw;
--   SELECT endpoint, http_status, count(*) FROM reddit_fetch_log GROUP BY 1,2 ORDER BY 3 DESC;
--   SELECT company_name, count(*) FROM reddit_company_match GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
