// Seen — k6 load test for the hot, user-facing endpoints.
//
// Simulates a ramp toward ~100 concurrent users hitting the endpoints that do the
// most work per request, so you find the bottleneck before your users do.
//
// Run (install k6 first: https://k6.io/docs/get-started/installation/):
//   k6 run load-test/hot-paths.js                          # against production
//   BASE_URL=http://localhost:3000 k6 run load-test/hot-paths.js   # against a local build
//   PEAK_VUS=200 k6 run load-test/hot-paths.js             # push harder
//
// What it exercises (from the scalability audit — the real hot paths):
//   • POST /api/jobs           — job search (heaviest: external Adzuna + DB aggregation, no shared cache)
//   • POST /api/reports        — company_score (DB-cached 365d) and leaderboard (CDN 300s)
//   • GET  /api/reports?type=… — company benchmark (CDN 300s)
//   • GET  /api/demand         — hiring demand (CDN 6h)
//
// NOTE: these endpoints are rate-limited PER IP (job-search 10/hr, fetch-location-jobs
// 30/hr). From a single load-generator IP you WILL see 429s once the hourly budget is
// spent — that is the rate limiter working, not a failure. `http_429_expected` tracks
// them separately so they don't pollute the error rate. To measure raw capacity of the
// cached read paths, lean on the demand/leaderboard/benchmark scenarios.

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Rate } from 'k6/metrics'

const BASE_URL = (__ENV.BASE_URL || 'https://seenjobs.io').replace(/\/$/, '')
const PEAK_VUS = parseInt(__ENV.PEAK_VUS || '100', 10)

const rateLimited = new Counter('http_429_expected')
const appErrors = new Rate('app_errors') // non-2xx, non-429

const COMPANIES = ['Amazon', 'Google', 'Meta', 'Coca-Cola', 'Deloitte', 'Robert Half', 'Aerotek', 'Insight Global']
const QUERIES = ['software engineer', 'nurse', 'warehouse', 'data analyst', 'sales', 'customer support']
const CITIES = ['New York, NY', 'Austin, TX', 'Remote', 'Chicago, IL', 'Atlanta, GA']
const pick = (a) => a[Math.floor(Math.random() * a.length)]

export const options = {
  scenarios: {
    // Cached read paths — measure raw serving capacity under concurrency.
    reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.ceil(PEAK_VUS * 0.7) },
        { duration: '1m', target: Math.ceil(PEAK_VUS * 0.7) },
        { duration: '20s', target: 0 },
      ],
      exec: 'readPaths',
    },
    // Job search — the heaviest path; lighter VU count because it's rate-limited + expensive.
    search: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.ceil(PEAK_VUS * 0.3) },
        { duration: '1m', target: Math.ceil(PEAK_VUS * 0.3) },
        { duration: '20s', target: 0 },
      ],
      exec: 'jobSearch',
    },
  },
  thresholds: {
    // Cached reads should stay fast; job search is allowed to be slower.
    'http_req_duration{scenario:reads}': ['p(95)<800'],
    'app_errors': ['rate<0.02'], // <2% genuine errors (429s excluded)
  },
}

function classify(res) {
  if (res.status === 429) { rateLimited.add(1); appErrors.add(false); return }
  const ok = res.status >= 200 && res.status < 300
  appErrors.add(!ok)
  return ok
}

export function readPaths() {
  // 1. Hiring demand (CDN-cached 6h)
  classify(http.get(`${BASE_URL}/api/demand`, { tags: { name: 'demand' } }))

  // 2. Company benchmark (CDN-cached 300s)
  classify(http.get(`${BASE_URL}/api/reports?type=company&name=${encodeURIComponent(pick(COMPANIES))}`, { tags: { name: 'benchmark' } }))

  // 3. Leaderboard (CDN-cached 300s)
  classify(http.post(`${BASE_URL}/api/reports`, JSON.stringify({ action: 'leaderboard' }), {
    headers: { 'Content-Type': 'application/json' }, tags: { name: 'leaderboard' },
  }))

  // 4. Company score (DB-cached 365d + CDN 600s)
  classify(http.post(`${BASE_URL}/api/reports`, JSON.stringify({ action: 'company_score', name: pick(COMPANIES) }), {
    headers: { 'Content-Type': 'application/json' }, tags: { name: 'company_score' },
  }))

  sleep(Math.random() * 2 + 1)
}

export function jobSearch() {
  const res = http.post(`${BASE_URL}/api/jobs`, JSON.stringify({ query: pick(QUERIES), location: pick(CITIES), radius: 25 }), {
    headers: { 'Content-Type': 'application/json' }, tags: { name: 'job_search' },
  })
  check(res, { 'job search: 2xx or 429': (r) => (r.status >= 200 && r.status < 300) || r.status === 429 })
  classify(res)
  sleep(Math.random() * 3 + 2)
}
