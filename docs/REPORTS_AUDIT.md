# Reports Audit — `api/reports.js`

_Audit date: 2026-06-15 · 1138 lines (largest API file) · GET + POST · mixes public
reads, authenticated writes, community moderation, and Reddit cron ingestion._

**Audit only. No reports code or behavior is changed by this document.** Prerequisite
for any future, tested migration of reports logic into `lib/reports/`.

## Shape

- `export default handler(req,res)` → CORS/OPTIONS, then branches by
  `req.method` and `body.action`. `handleCompanyScore` (line ~985) is a large
  sub-handler for company-score reads.
- Auth helpers `resolveUid` / `verifyJWT` are **duplicated** here (foundation
  `lib/auth/server.ts` is the future target).
- DB access via inline service-key `fetch` headers (no shared `db()` even within
  the file in places).

## Action classification

| Action | Method | Access | Type | Risk | Notes |
|---|---|---|---|---|---|
| _GET root_ | GET | public | read | Low | basic read/health |
| `company_score` / `research` / `resolve` / `populate` / `name` | POST | public | read | Low | `Cache-Control: public, s-maxage=600, swr=1200` |
| `leaderboard` | POST | public | read | Low | company_scores top 150 |
| `batch_scores` | POST | public | read | Low | scores for a set of companies |
| `feed` | POST | public | read | Low | recent outcome reports feed |
| `quick_submit` | POST | optional auth (`resolveUid`) | **write** | Med | submits an outcome report (a claim) |
| `submit` | POST | (verify) | **write** | Med | full report submit; resolves company/location |
| `report_issue` | POST | — | write | Low | user-reported data issue |
| `reddit_import` | GET cron / POST | **admin token or `x-vercel-cron`** | write (bulk) | **High** | Reddit ingestion; feature-flag gated; batched |
| `ingest` | POST | **admin token** | write (bulk) | **High** | bulk report ingestion |
| `moderate` | POST | admin/moderation | write | Med | moderation action on reports |

## Trust / data-quality model (per `SEEN_STRATEGY.md`)

- Submissions are **claims, not facts** — reports carry `outcome_weight`,
  `trust_reason`, `experience_level`, etc. Any migration must preserve these
  trust/confidence fields and their computation.
- Public reads are cached at the CDN (`s-maxage`); preserve cache headers exactly.

## Cron behavior (do not break)

- `vercel.json` schedules 8 daily Reddit crons:
  `/api/reports?reddit_cron=<subreddit>`. The route maps
  `req.query.reddit_cron` → `{ action: 'reddit_import', subreddit }` and authorizes
  via `x-vercel-cron` / admin token + a `feature_flags` percentage gate.

## Security invariants (MUST NOT regress)

- Write/ingest/moderation paths are gated (auth/admin/cron); public paths are
  read-only.
- `reddit_import` / `ingest` require admin token or the Vercel cron header.
- Trust-weighting stays server-side; client cannot forge `outcome_weight`/scores.

## Risks / observations (no action taken)

| # | Observation | Severity | Note |
|---|---|---|---|
| R-1 | 1138 lines, many responsibilities (reads, writes, cron, moderation, scoring) | High | top spaghetti file; split into `lib/reports/` services over many slices |
| R-2 | Duplicated `resolveUid` / `verifyJWT` / inline DB headers | Med | centralize via foundation |
| R-3 | Per-action response shapes not yet individually captured | Med | **capture exact shape per action at migration time** before touching it |
| R-4 | Public read caching (`s-maxage=600`) must be preserved byte-for-byte | High | CDN behavior |
| R-5 | No automated tests for any action | Med | add per-action tests before changing write paths |

## Safe migration plan (future)

1. Start with **public reads** (lowest risk): `leaderboard`, `batch_scores`,
   `feed`, `company_score`. For each: capture the exact response shape + cache
   header, extract logic to a `lib/reports/*` service, add a shape test, then wire
   the single action. (Same pattern as `api/demand.js`.)
2. **Then** writes (`quick_submit`, `submit`) — add validation + trust-field
   preservation tests **before** any change.
3. **Last** `reddit_import` / `ingest` / `moderate` — admin/cron gated, bulk; treat
   like admin (audit + tests first).

## STOP conditions for this area

Do **not**, without explicit human review: change trust/outcome weighting, alter
public cache headers, change moderation behavior, or change the cron/admin gates.
Capture each action's exact response shape before migrating it.
