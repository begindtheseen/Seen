# Seen — Company Scoring (how we get a score)

> Canonical scoring logic: `api/_utils/companyScore.js` (pure, unit-tested).
> Live wiring: `api/reports.js` (`handleCompanyScore`, `_rowToScore`, `update_tenure`).
> Read with `SEEN_STRATEGY.md` (Anti-Gaming) and `OPPORTUNITY_ENGINE.md` (data acquisition).

## 1. The inputs

A company score is derived from these per-company aggregates:

| Input | Meaning | Source |
|-------|---------|--------|
| `response_rate` (0–1) | share of applicants who got any human response | `reports` aggregation / web research |
| `ghost_rate` (0–1) | share ghosted | `reports` / web research |
| `avg_wait_days` | days to first contact | `reports` / web research |
| `avg_rounds` | interview rounds | `reports` / web research |
| `unpaid_rate` (0–1) | share with unpaid work/assessments | `reports` |
| `report_count` | sample size | `reports` |
| **`avg_tenure_months`** | **avg employee tenure** | **résumés (`resume_employment`) — NEW** |
| **`tenure_sample_count`** | **# résumé samples** | **résumés — NEW** |

## 2. Where the data comes from (every source → `reports`, weighted by trust)

All outcome data lands in one `reports` table, each row carrying an `outcome_weight`
(trust). Aggregation weights by it, so low-trust sources can't dominate.

| Source | Entry point | `outcome_weight` |
|--------|-------------|------------------|
| Direct user submission | `/api/reports` `submit` / `quick_submit` | **1.0** |
| Survey / Opportunity-Engine answers | `/api/user-sync` `submit_answer` → `reports` (`platform: seen_intel`) | ~1.0 |
| Glassdoor / Blind / Indeed / LinkedIn (n8n ingest) | `/api/reports` `ingest` | 0.4–0.7 |
| Reddit pipeline | `/api/reports` `reddit_import` | **0.3** |
| Web research (Claude + web search) | `handleCompanyScore` (admin/cron `populate`) | precomputed score |
| **Résumé tenure** | `resume_employment` → `update_tenure` job | separate gated signal |

## 3. The formulas (canonical, in `companyScore.js`)

```
overall_base = clamp0..100( 50
  + response_rate * 40
  − ghost_rate    * 30
  − min(wait/60, 1) * 15
  + log(report_count + 1) * 5 )

waste = clamp0..100( ghost_rate * 60 + unpaid_rate * 25 + (avg_rounds > 4 ? 15 : 0) )

risk  = overall ≥ 70 → safe ; ≥ 40 → warn ; else danger
```

(`_calcScore`/`_calcWaste` in `reports.js` now delegate here, so there is one source of truth.)

## 4. Tenure signal (NEW — bounded + gated)

Long average tenure = people stay = healthier company → small bonus. Very short
average tenure = churn red flag → small penalty. **Bounded to ±8 points** and scaled
by sample size, and it **only applies with ≥ `MIN_TENURE_SAMPLE` (4) résumé samples**,
reaching full strength at 10. So thin data never moves the score.

```
years = avg_tenure_months / 12
≥4y → +8 · ≥3y → +5 · ≥2y → +2 · 1.5–2y → 0 · 1–1.5y → −4 · <1y → −8
adjustment = round(base_adj × min(1, sample / 10))
overall = clamp0..100(overall_base + adjustment)
```

How tenure is computed: `update_tenure` (cron/admin) pages `resume_employment`,
parses each `start_date`/`end_date` to a month index (`parseMonthIndex`, handles
"2020", "Jan 2020", "03/2019", "Present"), averages months per normalized company
(`aggregateTenure`), and PATCHes existing `company_scores` rows. It never creates
rows and no-ops if the columns are absent.

## 5. Confidence & sufficiency gating (NEW)

Every score now carries a **confidence (0–1)** and label, so thin/stale data is shown
as a weak signal rather than a falsely precise number:

```
confidence = min(1, report_count/10) * 0.7      // reports carry most weight
           + min(1, tenure_sample/10) * 0.3      // tenure adds up to 0.3
           − staleness penalty (up to 0.2 when data > 180 days old)

label = ≥0.66 high · ≥0.33 medium · else low
sufficient = confidence ≥ 0.33   // below this: present as "early signal / needs data"
```

Existing display thresholds still apply: computed rates require ≥ 5 reports;
`verification_status` flips to `verified` at ≥ 10 reports.

## 6. Storage & when scores recompute

- Scores are **precomputed and cached** in `company_scores` (365-day TTL on web-research rows).
- Recompute paths: on-demand `company_score` (cache → web research on miss/expiry),
  admin/cron `populate` (batch web research), and the new cron/admin **`update_tenure`**.
- `_rowToScore` applies the tenure adjustment + confidence at read time, so a tenure
  refresh is reflected immediately without recomputing the base.

## 7. What changed / improvements made

- **Single source of truth** for the formulas (`companyScore.js`), unit-tested (12 tests).
- **Résumé tenure** added as a real, bounded, sample-gated scoring signal.
- **Confidence + sufficiency** attached to every score (was: none — 1 report looked like 100).
- All sources continue to fuse through `reports` by trust weight; tenure layers on top.

## 8. Operating it

1. Run migration `019_company_score_tenure.sql`.
2. Schedule `POST /api/reports {action:"update_tenure"}` (cron header or admin token),
   e.g. daily, to refresh tenure. Safe to run anytime; additive + idempotent.

## 9. Multi-source fusion (NEW — `api/_utils/companyIntel.js`)

Previously the web-research path computed the score purely from Claude's estimate and
**ignored the real outcome data we already hold** (direct user reports, Reddit imports,
ingest). `fuseCompanyIntel()` fixes that: the web estimate becomes a **prior**, and our
real reported outcomes are **evidence**, weighted by source trust (§2). We shrink the
prior toward the evidence as the trust-weighted sample grows:

```
weightEmpirical = effN / (effN + PRIOR_STRENGTH)        // PRIOR_STRENGTH = 8
fused_rate      = weightEmpirical · empirical + (1 − weightEmpirical) · prior
effN            = Σ over sources of  trust(source) · resolved_reports
```

So 2 reports barely move a researched prior, but 200 real reports dominate it. Trust:
`direct`/`seen_intel` 1.0 · `ingest` 0.55 · `reddit` 0.3 (matches §2). Outcomes are
bucketed into ghost vs human-response (`waiting` is non-terminal; `autoreject` is
resolved-but-neither). `report_count` becomes real resolved reports + the web's claimed
count, feeding the (capped) volume term + confidence.

**Wiring:** `_fuseWithReports()` in `reports.js` pulls a company's `reports` rows,
classifies each by `platform` (`classifyPlatform`), and fuses at **write time** — in the
single-company `company_score` path (so any NEW company auto-fuses its reports the moment
it's scored) and in the batch `populate` path. Reads stay cheap (the fused values are
stored). With no reports, the fused result equals the web estimate exactly (no regression).
Pure + unit-tested (10 tests).

## 10. Next (fast follows)

- Per-source sub-scores ("what Reddit says" vs "what users report").
- Global company dedup via `company_aliases` so tenure/report data joins one canonical company.
- Surface `confidence` + `fused_sources` in the UI (scoreboard + company page) as a data-strength badge.
- Backfill: re-run `populate`/`company_score` so existing rows pick up fusion (after the
  scoring-cap fix in PR #48 is live, so refreshes don't recompute with the uncapped formula).
