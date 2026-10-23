// Feed / ghost-surge contract tests for api/reports.js against a fake PostgREST (no network).
// Run: node --test api/reports.feed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.ANTHROPIC_KEY;

// Real /feed rows from the 2026-10-23 audit (text trimmed to the stored excerpt), newest first.
const RAW = [
  { id: 'r1', company_name: 'albertsons', platform: 'Reddit r/Albertsons', outcome: 'offer', report_text: 'I just got a job offer today from Albertsons as a barista at Starbucks (NorCal). [Source: https://www.reddit.com/r/Albertsons/comments/1wyxh7g/]', created_at: '2026-10-23T10:00:00Z' },
  { id: 'r2', company_name: 'albertsons', platform: 'Reddit r/Albertsons', outcome: 'offer', report_text: "She's the one who hired me and now is trying to get rid of me.. [Source: https://www.reddit.com/r/Albertsons/comments/1tirvz8/]", created_at: '2026-10-23T09:00:00Z' },
  { id: 'r3', company_name: 'twilio', platform: 'Reddit r/twilio', outcome: 'ghosted', report_text: 'Twilio sold me an upgraded plan promising Morocco outbound calls, numbers are blocked and support ghosted me. [Source: https://www.reddit.com/r/twilio/comments/1abikst/]', created_at: '2026-10-23T08:00:00Z' },
  { id: 'r4', company_name: 'albertsons', platform: 'Reddit r/Albertsons', outcome: 'interview', report_text: 'I have an interview in the Dallas/Garland (it\'s kinda in between), Texas, USA area in bakery. [Source: https://www.reddit.com/r/Albertsons/comments/1thmgkb/]', created_at: '2026-10-23T07:00:00Z' },
  { id: 'r5', company_name: 'walgreens', platform: 'Reddit r/jobs', outcome: 'offer', report_text: 'Just got Hired as Walgreens Pharmacy Technician. [Source: https://www.reddit.com/r/jobs/comments/1p0wwq8/]', created_at: '2026-10-23T06:00:00Z' },
  { id: 'r6', company_name: 'acme', platform: 'LinkedIn', outcome: 'ghosted', report_text: 'Three rounds then silence.', created_at: '2026-10-23T05:00:00Z' },
];

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  calls.push({ url: u, method: init.method || 'GET' });
  assert.equal(u.hostname, 'fake.supabase.co');
  assert.equal(init.method || 'GET', 'GET', 'the feed and surge actions never write');
  const limit = Number(u.searchParams.get('limit') || 20);
  const offset = Number(u.searchParams.get('offset') || 0);
  if (u.pathname === '/rest/v1/reports') {
    const rows = RAW.slice(offset, offset + limit);
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json', 'content-range': `${offset}-${offset + rows.length - 1}/${RAW.length}` } });
  }
  if (u.pathname === '/rest/v1/company_scores') {
    return new Response(JSON.stringify([
      { company_name: 'walmart', overall_score: 91, ghost_rate: 0.1339, report_count: 48, first_party_report_count: 48, data_source: 'reports' },
      { company_name: 'robert half', overall_score: 58, ghost_rate: 0.42, report_count: 56, first_party_report_count: 56, data_source: 'reports' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
};

const handler = (await import('./reports.js')).default;
const run = async (body) => {
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  await handler({ method: 'POST', body, headers: {}, query: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
  return res;
};

test('feed: public-discussion rows that fail the applicant rules are left out; paging continues from next_offset', async () => {
  const res = await run({ action: 'feed', limit: 3 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.reports.map((r) => r.id), ['r1', 'r4', 'r5']);   // r2 (employee), r3 (customer) dropped
  assert.equal(res.body.next_offset, 5);                                      // five rows read to fill three
  assert.equal(res.body.has_more, true);
  assert.equal(res.body.total, RAW.length);
  const read = calls.find((c) => c.url.pathname === '/rest/v1/reports');
  assert.equal(read.url.searchParams.get('limit'), '12');                     // 4× the page
  const next = await run({ action: 'feed', limit: 3, offset: res.body.next_offset });
  assert.deepEqual(next.body.reports.map((r) => r.id), ['r6']);               // first-party rows pass as stored
  assert.equal(next.body.has_more, false);
});

test('ghost_surges: a surge carries the company grade so the dashboard can word or drop it', async () => {
  calls.length = 0;
  // Fake reports read: 3 ghosted walmart rows + 3 robert half rows this week.
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/reports') {
      return new Response(JSON.stringify([...Array(3).fill({ company_name: 'walmart' }), ...Array(3).fill({ company_name: 'robert half' })]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return prev(url, init);
  };
  try {
    const res = await run({ action: 'ghost_surges', names: ['Walmart', 'Robert Half', 'Nobody Inc'] });
    assert.equal(res.statusCode, 200);
    const byName = Object.fromEntries(res.body.surges.map((s) => [s.name, s]));
    assert.equal(byName.walmart.ghosted_7d, 3);
    assert.equal(byName.walmart.gradeable, true);
    assert.equal(byName.walmart.overall_score, 91);
    assert.ok(Math.abs(byName.walmart.ghost_rate - 0.1339) < 1e-6);
    assert.equal(byName['robert half'].overall_score, 58);
    assert.equal('nobody inc' in byName, false);
  } finally { globalThis.fetch = prev; }
});
