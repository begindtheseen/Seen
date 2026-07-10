# Load testing

A [k6](https://k6.io) harness that ramps toward ~100 concurrent users against Seen's
hottest endpoints, so you find the bottleneck before your users do.

## Install k6

k6 is a single binary (not an npm package):

```bash
# macOS
brew install k6
# or see https://k6.io/docs/get-started/installation/
```

## Run

```bash
# Against production
npm run loadtest

# Against a local production build (npm run build && npm start)
BASE_URL=http://localhost:3000 npm run loadtest

# Push harder / softer (default peak is 100)
PEAK_VUS=200 npm run loadtest
```

## What it hits

| Scenario | Endpoint | Why |
|---|---|---|
| `reads` | `GET /api/demand`, `GET /api/reports?type=company`, `POST /api/reports` (leaderboard + company_score) | The cached read paths — measures raw serving capacity under concurrency. |
| `search` | `POST /api/jobs` | The heaviest path (external Adzuna + DB aggregation, **no shared cache**) — lighter VU count because it's rate-limited and expensive. |

## Reading the results

- **`http_429_expected`** — job search and location fetch are rate-limited **per IP**
  (10/hr and 30/hr). From one load-generator IP you'll spend that budget in seconds and
  then see 429s. That's the rate limiter working, so these are counted separately and do
  **not** count as errors.
- **`app_errors`** — genuine non-2xx/non-429 responses. Threshold: <2%.
- **`http_req_duration{scenario:reads}`** — cached reads should hold p95 < 800ms even at
  peak. If they don't, that's your bottleneck (the audit flagged `/api/jobs` as the one
  hot endpoint with no shared/CDN cache).

## Known bottleneck to watch

`POST /api/jobs` recomputes on every distinct search (external API + aggregation) with only
per-lambda in-flight coalescing — no CDN/shared cache (it's a POST). Under many *distinct*
concurrent searches this is the first thing that will slow down. A short-TTL shared cache
(or a GET variant the CDN can cache) is the highest-leverage scaling fix; see the audit notes.
