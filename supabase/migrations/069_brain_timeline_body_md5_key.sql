-- 069 — brain_timeline: replace the uncappable UNIQUE(date, heading, body) with a UNIQUE md5 key.
--
-- WHY: the old constraint `brain_timeline_date_heading_body_key` was a UNIQUE btree over the raw
-- `body` text. A Postgres btree entry is capped at ~2704 bytes (1/3 of an 8KB page), so ANY timeline
-- body larger than that made the index insert fail outright:
--     index row size 3208 exceeds btree version 4 maximum 2704 for index "..."
--
-- That turned append_timeline into a PARTIAL WRITE. The gateway (api/brain.js → brainStore.appendTimeline)
-- wrote the note to brain_notes FIRST and mirrored the row into brain_timeline SECOND, so an oversized
-- body left the note durably persisted while the op returned ok:false — and a naive retry appended the
-- note a second time. Hit live 3× by a cloud session on 2026-08-13 at 09:53–09:55Z.
--
-- FIX: index md5(body) instead of body. The digest is fixed-width (32 chars), so a body of ANY size is
-- indexable while exact-duplicate episodes are still rejected — which is all the dedupe ever needed
-- (the mirror is append-only and `resolution=ignore-duplicates`). `body_md5` is a STORED GENERATED
-- column so no writer can ever set it or let it drift from `body`; PostgREST rejects it in an insert
-- payload, so the on_conflict target names it but the row payload must not.
--
-- The application-side half of this fix (mirror-first ordering + the date,heading,body_md5 on_conflict
-- target) lands in the same commit as this file — see lib/server/brainStore.js.
--
-- APPLIED TO PROD 2026-08-13, BEFORE this file was committed, and verified live there (a 5,000-byte
-- body inserts; its exact duplicate is rejected). This file exists so the repo matches prod — it is
-- idempotent and re-running it is a no-op.
--
-- PRECONDITION: public.brain_timeline must already exist. The brain_* tables (brain_notes, brain_facts,
-- brain_timeline, brain_access) were created out-of-band and are NOT tracked in this directory, so this
-- is the first brain_* migration file. On a database without the brain_* tables the ALTERs below error
-- instead of silently skipping; that is deliberate, not a bug to "fix" with a DO block.

alter table public.brain_timeline
  add column if not exists body_md5 text generated always as (md5(body)) stored;
alter table public.brain_timeline
  drop constraint if exists brain_timeline_date_heading_body_key;
drop index if exists public.brain_timeline_date_heading_body_key;
create unique index if not exists brain_timeline_date_heading_md5_key
  on public.brain_timeline (date, heading, body_md5);
