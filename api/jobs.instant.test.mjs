// Search must answer from our own corpus immediately and never wait on the live top-up
// (owner directive 2026-10-17: "should be instant ... no matter what").
// The live feed is mocked to take 3s; the handler must respond well before that, flag
// topup:'pending', and a db_only refresh must never start a pull.
// Also (live audit 2026-10-23): a query ranks by relevance before transparency score, in-radius
// rows precede the far-away fill-ins, and the response reports `in_radius`.
// Run: node --test api/jobs.instant.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.ADZUNA_APP_ID = 'id';
process.env.ADZUNA_APP_KEY = 'key';

const NOW = new Date(Date.now() + 86_400_000).toISOString();
const row = (i) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, title: `Cashier ${i}`, company: `Store ${i}`, location: 'Austin, TX', lat: 30.27, lng: -97.74, apply_url: `https://example.com/${i}`, description: 'cashier job', search_query: 'cashier', expires_at: NOW, created_at: new Date().toISOString(), score: 60 });
// The "customer service · Austin" corpus: one plain CSR in Austin (low transparency score), a
// Director and a "ServiceNow" architect in Austin with HIGH scores, a coordinate-less ATS row
// whose text says Austin, and a CSR in Portland (far away).
const CS = [
  { id: '10000000-0000-0000-0000-000000000001', title: 'Customer Service Representative', company: 'PLS', location: '5828 W. Thomas Rd., Austin, TX', lat: 30.28, lng: -97.75, apply_url: 'https://example.com/csr', description: 'front line customer service', search_query: 'customer service', expires_at: NOW, created_at: new Date().toISOString(), score: 48 },
  { id: '10000000-0000-0000-0000-000000000002', title: 'Managed Services - Data, Analytics & AI - Director', company: 'PwC', location: 'Austin, Travis County', lat: 30.26, lng: -97.73, apply_url: 'https://example.com/dir', description: 'lead client work', search_query: 'customer service', expires_at: NOW, created_at: new Date().toISOString(), score: 92, salary: '$128k' },
  { id: '10000000-0000-0000-0000-000000000003', title: 'Cyber ServiceNow Architect', company: 'Deloitte', location: 'Austin, Travis County', lat: 30.26, lng: -97.73, apply_url: 'https://example.com/snow', description: 'ServiceNow platform', search_query: 'servicenow', expires_at: NOW, created_at: new Date().toISOString(), score: 95 },
  { id: '10000000-0000-0000-0000-000000000004', title: 'Customer Care Specialist', company: 'lucidmotors', location: 'Austin, TX', lat: null, lng: null, apply_url: 'https://example.com/care', description: 'customer service for owners', search_query: null, expires_at: NOW, created_at: new Date().toISOString(), score: 70 },
  { id: '10000000-0000-0000-0000-000000000005', title: 'Customer Service Representative', company: 'Far Co', location: 'Portland, OR', lat: 45.52, lng: -122.68, apply_url: 'https://example.com/far', description: 'customer service', search_query: 'customer service', expires_at: NOW, created_at: new Date().toISOString(), score: 99 },
  // Stored before the market filter: a Lever row abroad (live 2026-10-23: "Cashier- La Roca del Valles, Barcelona" in a Phoenix search).
  { id: '10000000-0000-0000-0000-000000000006', title: 'Customer Service Agent', company: 'karllagerfeld', location: 'La Roca del Valles, Barcelona', lat: null, lng: null, apply_url: 'https://jobs.eu.lever.co/karllagerfeld/x', description: 'customer service in our outlet', search_query: 'customer service', expires_at: NOW, created_at: new Date().toISOString(), score: 70, source: 'Lever' },
  // Adzuna's 500-char teaser of the PLS posting the corpus already holds in full from the board.
  { id: '10000000-0000-0000-0000-000000000007', title: 'Customer Service Representative', company: 'PLS', location: 'Phoenix, AZ', lat: 33.45, lng: -112.07, apply_url: 'https://www.adzuna.com/details/1', description: 'PLS is a leader in financial services. Customer Service Representative RESPONSIBILITIES: Greet customers and process transactions with care, speed and a smile, every day of the wee…', search_query: 'customer service', expires_at: NOW, created_at: new Date().toISOString(), score: 55, source: 'Adzuna' },
];
let liveCalls = 0, liveDone = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (/adzuna|greenhouse|lever|ashby/i.test(u)) {
    liveCalls++;
    await new Promise((r) => setTimeout(r, 3000));
    liveDone++;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/rest/v1/jobs')) {
    const rows = /customer/i.test(decodeURIComponent(u)) ? CS : [row(1), row(2), row(3)];
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('geocode_cache')) return new Response(JSON.stringify([{ lat: 30.27, lng: -97.74 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  // rate limits, flags, pull log, expansion cache, perks, suppressed …: empty / allowed
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { default: handler } = await import('./jobs.js');

function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}

test('a thin search answers from the corpus without waiting on the live pull', async () => {
  const t0 = Date.now();
  const res = await call({ query: 'cashier', location: 'Austin, TX', radius: '25' });
  const ms = Date.now() - t0;
  assert.equal(res.code, 200);
  assert.ok(ms < 1500, `responded in ${ms}ms (live feed takes 3000ms)`);
  assert.ok(res.body.jobs.length > 0, 'served corpus results');
  assert.equal(res.body.topup, 'pending');
  assert.equal(liveDone, 0, 'live pull had not finished when the response was sent');
  assert.equal(res.body.in_radius, res.body.jobs.length, 'every Austin cashier is in radius');
  assert.ok(res.body.jobs.every((j) => j.in_radius === true));
});

test('the db_only refresh never starts a live pull', async () => {
  const before = liveCalls;
  const res = await call({ query: 'barista', location: 'Austin, TX', radius: '25', db_only: true });
  assert.equal(res.code, 200);
  assert.equal(res.body.topup, null);
  assert.equal(res.body._src, 'db-refresh');
  assert.equal(liveCalls, before);
});

test('"customer service": the plain CSR outranks the Director; ServiceNow is not a match; in-radius rows first; in_radius reported', async () => {
  const res = await call({ query: 'customer service', location: 'Austin, TX', radius: '25', db_only: true });
  assert.equal(res.code, 200);
  const titles = res.body.jobs.map((j) => `${j.title} @ ${j.company}`);
  assert.equal(titles[0], 'Customer Service Representative @ PLS', titles.join(' | '));
  assert.ok(!titles.some((t) => /ServiceNow/.test(t)), 'the "service" token must not match inside "ServiceNow"');
  const dirIdx = titles.findIndex((t) => /Director/.test(t));
  const careIdx = titles.findIndex((t) => /Customer Care/.test(t));
  assert.ok(dirIdx > 0 && careIdx > 0 && careIdx < dirIdx, `Customer Care (coordinate-less, says Austin) ranks above the Director: ${titles.join(' | ')}`);
  // The Portland CSR has the highest transparency score and a perfect title match, but it is a
  // fill-in from far away: it is served LAST and flagged, and the count excludes it.
  assert.equal(titles[titles.length - 1], 'Customer Service Representative @ Far Co');
  assert.ok(!titles.some((t) => /karllagerfeld/.test(t)), `a row naming a non-US place never reaches a US search: ${titles.join(' | ')}`);
  assert.equal(titles.filter((t) => t === 'Customer Service Representative @ PLS').length, 1, 'the Adzuna teaser hides behind the full-text row');
  assert.ok(!res.body.jobs.some((j) => j.source === 'Adzuna'), 'the teaser copy is the one dropped');
  assert.equal(res.body.jobs[res.body.jobs.length - 1].in_radius, false);
  assert.equal(res.body.in_radius, 3, 'CSR + Customer Care (text says Austin, no coords) + Director');
  assert.ok(res.body.jobs.slice(0, 3).every((j) => j.in_radius === true));
  assert.ok(res.body.jobs.every((j) => typeof j.relevance === 'number' && j.relevance > 0), 'every row carries its relevance');
  assert.equal(res.body.fallback, 'outside_radius');
});

test('the pool reads scope by bounding box OR the city named in the row text', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { seen.push(decodeURIComponent(String(url))); return orig(url, opts); };
  try {
    await call({ query: 'customer service', location: 'Austin, TX', radius: '25', db_only: true });
  } finally { globalThis.fetch = orig; }
  const scoped = seen.filter((u) => u.includes('/rest/v1/jobs') && u.includes('lat.gte.'));
  assert.ok(scoped.length > 0, 'at least one bbox-scoped pool read');
  assert.ok(scoped.every((u) => /or=\(and\(lat\.gte\.[-\d.]+,lat\.lte\.[-\d.]+,lng\.gte\.[-\d.]+,lng\.lte\.[-\d.]+\),location\.ilike\.\*austin\*\)/.test(u)), scoped[0]);
});
