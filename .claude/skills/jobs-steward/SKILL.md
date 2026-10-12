---
name: jobs-steward
description: Weekly review and management of Seen's job listings — verify the ingestion crons actually ran, probe live search freshness/coverage, act on stale backlog or dead sources, and record the verdict in the brain. Use for the weekly jobs review routine, or when asked "are the job listings healthy / up to date", "manage the listings", or "why are listings stale".
---

# Jobs steward — weekly listings review

Ingestion is ALREADY automated by Vercel crons (`vercel.json`): `refresh-jobs` 6×/day (also runs the
stale sweep — `lib/server/staleSweep.js` → `public.sweep_stale_jobs`), `discover-sources` 2×/day,
`refresh-stale-jobs` 03:30, `prune-jobs` 03:45. **This skill does not re-ingest.** Its job is to
catch the crons silently failing (the 2026-09-29 95k stale-row backlog went unnoticed for weeks) and
to manage what they can't. Work on `next-migration` (the default branch `main` is the old app).

Production: Vercel team `team_HmLFhsdXJNO1jpP9OpWUN3ss`, project `prj_P2SoPxsy9RpdoJfVUqqg6RslWXV5`.

## 0. Orient
Use the `brain` skill: `node scripts/brain.mjs search --subject "Jobs steward"` to read last week's
verdict, so you compare against a baseline instead of judging numbers in isolation.

## 1. Did the crons run? (Vercel MCP `get_runtime_logs`, environment `production`, since `7d`)
If the Vercel MCP tools aren't available (load via ToolSearch `+Vercel runtime logs` first), skip this
step, say so in the report and the brain verdict, and rely on step 2 — never mark crons "verified".
- `group_by: requestPath`, `level: [error, fatal, warning]` → any row for `/api/refresh-jobs`,
  `/api/discover-sources`, `/api/refresh-stale-jobs`, `/api/prune-jobs` is a finding; pull those lines.
- `query: "discover-sources:"`, limit 20 → each line has `reason=` and `registered=/new=`.
  `reason=ok` is healthy; a single `cc_index_error`/`http_503` is Common Crawl flakiness (seen
  2026-10-08), but **two or more consecutive** non-ok runs is a finding.
- `query: "prune-jobs:"` → expect ~7 lines (one per day). Fewer = the cron isn't firing.
- `refresh-jobs` only logs when it has something to say, so absence of lines is NOT proof it
  didn't run — freshness in step 2 is the authoritative check for it.
- Confirm prod runs current code: `list_deployments` (target `production`, limit 1) — its
  `githubCommitSha` should match `origin/next-migration` HEAD. If not, see CLAUDE.md "Vercel deploy".

## 2. Are listings fresh and reachable? (no credentials needed)
```bash
node scripts/jobs-health.mjs          # human summary; --json for raw; exit 1 = a hard check failed
```
Six fixed searches across industries/regions. Read each `!` line:
- `only N results` → a source died or the query path broke. Check `sources:`; if a source that was
  present last week is gone everywhere, that source's fetcher is the suspect (`lib/server/jobSources.js`).
- `% older than 14d` → ingestion stalled; cross-check step 1.
- `id:null (broken permalinks)` → results returned without stitched DB ids (see CLAUDE.md
  2026-07-02 B: `aggregateForQuery` / `nearestListings`). A recurring class bug — hunt the path, don't patch one query.
- `degraded response` / timeouts → API health issue; check runtime errors for `/api/jobs`.
Also note source concentration: if local queries are ~100% one provider, that's a single point of failure worth reporting.

## 3. Manage (only what's safe and authorised)
- **Needs `CRON_SECRET` in the environment** (check with `[ -n "$CRON_SECRET" ]`; never print it).
  If present and step 1/2 shows a stall, re-trigger the cron path with the secret as a Bearer header:
  `curl -sS -H "authorization: Bearer $CRON_SECRET" https://seenjobs.io/api/refresh-jobs` (also
  `/api/prune-jobs?dry=1` for a preview). If absent, do NOT look for other credentials — report
  what you would have run.
- Admin-only actions (Clear stale, dedupe, reported-listing triage in `/admin`) need an admin
  session — never available to this skill. List them for the owner instead.
- Code bugs found here (e.g. id:null) → open ONE draft PR on a `claude/` branch off `next-migration`
  with the fix + test, following CLAUDE.md's mandatory thought process. Never push to `main` or
  directly to `next-migration`. If the fix isn't small and certain, report it instead.

## 4. Record + report
```bash
node scripts/brain.mjs fact --subject "Jobs steward" --predicate weekly_verdict \
  --object "<HEALTHY|DEGRADED|BROKEN> — crons: …; freshness: x/6 healthy, median age …; sources: …; findings: …" \
  --confidence high --source "scripts/jobs-health.mjs + Vercel runtime logs <date>"
node scripts/brain.mjs contradictions
```
Anything needing the owner (admin action, missing secret, a PR to review) is a separate `fact` with
predicate `needs_owner_action` — not just a timeline line. Finish with a short report to the user:
verdict, what changed vs last week, what you did, what needs them.
