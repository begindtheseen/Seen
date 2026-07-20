-- 062_company_signals.sql
-- Authoritative public-record signals about a company (the reliable-at-scale reputation spine
-- when first-party Seen reports are thin). Each row is an ATTRIBUTED, fair-report-privileged
-- fact drawn from an official record — SEC 8-K filings, state WARN layoff notices, DOL H-1B/LCA
-- disclosures — with a link back to the source. It is NEVER our own conclusion about the
-- employer; the UI renders it as "Per <official source>, <date>: <fact> → [link]".
--
-- Legal guardrails encoded here:
--  • external_ref UNIQUE — one row per official record, so re-ingest never duplicates a claim.
--  • match_confidence — only 'high' rows are ever surfaced; a low/ambiguous entity match is
--    stored suppressed (or dropped upstream) so we never attach a filing to the wrong company.
--  • source_url + source_label are NOT NULL — nothing is displayable without its attribution.
--  • disputable — status lets an employer/admin retract a mis-attached or contested signal
--    (the right-of-reply liability shield), preserving history rather than hard-deleting.
-- Service-key only (RLS on, no policies) — same posture as our other ingest tables.

create table if not exists public.company_signals (
  id              uuid primary key default gen_random_uuid(),
  -- Entity: the official record's company name, plus our canonical key when resolved.
  company         text not null,
  company_key     text,
  -- Provenance.
  source          text not null,           -- 'sec_8k' | 'warn' | 'h1b'
  event_type      text not null,           -- 'layoff' | 'restructuring' | 'hiring_freeze' | 'hiring' | 'other'
  -- The fact itself — phrased as observation of the record, never as our verdict.
  title           text not null,
  detail          text,
  event_date      date,
  location        text,
  -- Attribution (never displayable without these).
  source_url      text not null,
  source_label    text not null,           -- e.g. 'SEC 8-K filing', 'CA EDD WARN notice'
  -- Dedupe + integrity.
  external_ref    text not null,           -- e.g. SEC accession no; state WARN id
  match_confidence text not null default 'high'
    check (match_confidence in ('high', 'medium', 'low')),
  -- Right-of-reply: 'active' shows; 'retracted' hides but preserves the row + reason.
  status          text not null default 'active'
    check (status in ('active', 'retracted')),
  retracted_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint company_signals_external_ref_key unique (external_ref)
);

-- Surfacing query is by company (case-insensitive) + only active/high rows, newest first.
create index if not exists idx_company_signals_company
  on public.company_signals (lower(company));
create index if not exists idx_company_signals_key
  on public.company_signals (company_key) where company_key is not null;
create index if not exists idx_company_signals_live
  on public.company_signals (event_date desc)
  where status = 'active' and match_confidence = 'high';

alter table public.company_signals enable row level security;
-- No policies: service-key (server) access only, like our other ingest tables.

comment on table public.company_signals is
  'Attributed public-record company signals (SEC/WARN/H-1B). Facts with a source link, never our own conclusion. Only status=active + match_confidence=high are surfaced; disputable via status=retracted.';
