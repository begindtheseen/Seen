-- Migration 062: Gmail auto-capture (data-acquisition engine, stage 2).
--
-- gmail_connections: one row per user who connected Gmail. The refresh token is stored ENCRYPTED
--   (AES-256-GCM, app-layer — see lib/server/gmailAuth.js) on top of Supabase at-rest encryption.
-- gmail_captures: classified hiring emails as SUGGESTIONS for the user's own tracker. They never
--   touch a company's aggregate score until the user CONFIRMS one (which then flows through the
--   normal add_application → report path). Deduped per user by Gmail message-id.
--
-- Both are server-only (RLS enabled, no policy = deny-all): all access is via api/gmail.js with the
-- service key, scoped by the authenticated uid. Idempotent.

CREATE TABLE IF NOT EXISTS gmail_connections (
  user_id            uuid        PRIMARY KEY,
  email              text,
  refresh_token_enc  text        NOT NULL,   -- AES-256-GCM, never plaintext
  scope              text,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  last_sync_at       timestamptz,
  last_error         text
);
ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS gmail_captures (
  id            bigserial   PRIMARY KEY,
  user_id       uuid        NOT NULL,
  message_id    text        NOT NULL,
  signature     text,
  company       text,
  event         text,
  outcome       text,
  confidence    text,
  sender_domain text,
  received_at   timestamptz,
  status        text        NOT NULL DEFAULT 'suggested',  -- suggested | confirmed | dismissed
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);
ALTER TABLE gmail_captures ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'gmail_captures' AND indexname = 'idx_gmail_captures_user_status') THEN
    CREATE INDEX idx_gmail_captures_user_status ON gmail_captures (user_id, status, received_at DESC);
  END IF;
END $$;
