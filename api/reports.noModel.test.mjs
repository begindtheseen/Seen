// Owner decision 2026-10-26: Seen uses no model API. api/reports.js must never reach a model host —
// the actions that existed only to call one answer an honest no-op, the company score is built from
// Seen's own reports or is the plain empty state, and the report pre-check is the location check alone.
// A model key left in the environment changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.ANTHROPIC_KEY = 'must-not-be-used';
process.env.LLM_API_KEY = 'must-not-be-used';

let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  calls.push({ host: u.hostname, path: u.pathname, method: (init.method || 'GET').toUpperCase() });
  if (u.hostname !== 'fake.supabase.co') return new Response('{"error":"no outside host in this test"}', { status: 599 });
  if (u.pathname === '/rest/v1/rpc/increment_rate_limit') return new Response('1', { status: 200, headers: { 'content-type': 'application/json' } });
  return Response.json([]);
};

const { default: handler, REMOVED_MODEL_ACTIONS } = await import('./reports.js');
async function run({ method = 'POST', query = {}, body = undefined, headers = {} }) {
  calls = [];
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end(s) { this.body = s; return this; } };
  await handler({ method, body, query, headers: { 'x-real-ip': '203.0.113.9', ...headers }, socket: { remoteAddress: '203.0.113.9' } }, res);
  return res;
}
const outside = () => calls.filter((c) => c.host !== 'fake.supabase.co');

test('the model-only actions are a no-op that touches nothing, even for an admin/cron caller', async () => {
  assert.deepEqual([...REMOVED_MODEL_ACTIONS].sort(), ['populate', 'reddit_import', 'research']);
  for (const action of REMOVED_MODEL_ACTIONS) {
    const r = await run({ body: { action, company: 'Acme', subreddit: 'jobs' }, headers: { 'x-cron-secret': 'whatever', 'x-admin-token': 'tok' } });
    assert.equal(r.statusCode, 200, action);
    assert.deepEqual(r.body, { ok: true, skipped: true, reason: 'no_model_api', action });
    assert.deepEqual(calls, [], `${action}: no request of any kind`);
  }
});

test('the old Reddit-import cron query no longer routes anywhere that writes', async () => {
  const r = await run({ method: 'GET', query: { reddit_cron: 'recruitinghell' } });
  assert.equal(r.statusCode, 400);
  assert.ok(!calls.some((c) => c.method !== 'GET' && c.path !== '/rest/v1/rpc/increment_rate_limit'));
  assert.deepEqual(outside(), []);
});

test('a company with no reports gets the honest empty state — no model, no web research', async () => {
  const r = await run({ body: { action: 'company_score', name: 'Totally Unknown Widgets' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.no_data, true);
  assert.equal(r.body.score, null);
  assert.match(r.body.message, /No applicant reports yet/);
  assert.deepEqual(outside(), [], 'only Seen\'s own database is read');
});

test('the report pre-check is the location check alone (no outside call for an empty location)', async () => {
  const r = await run({ body: { action: 'moderate', company: 'Acme', role: 'Cashier', location: '', experience: 'They ghosted me.' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.corrected_experience, null);
  assert.equal(r.body.issues.length, 1);
  assert.deepEqual(outside(), []);
});

test('no Seen server path names a model host or reads a model key', () => {
  const files = [
    'api/reports.js', 'api/resume.js', 'api/jobs.js', 'api/refresh-jobs.js', 'api/enrich-companies.js',
    'api/_utils/companyEnrichment.js', 'lib/server/companyEnrichmentWorker.js', 'lib/server/expand.js', 'lib/server/resumeStudio.js',
  ];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /api\.anthropic\.com|api\.openai\.com|api\.groq\.com|ANTHROPIC_(?:API_)?KEY|LLM_API_KEY|LLM_BASE_URL|web_search_\d+/, f);
    assert.doesNotMatch(src, /from ['"][./]*(?:lib\/server\/)?(?:llm|aiflag)\.js['"]/, f);
  }
});
