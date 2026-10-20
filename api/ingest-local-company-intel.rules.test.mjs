// Reddit accounts with thread context are re-checked server-side (lib/reports/applicantRules.js):
// passing → published Reddit-tier report; failing → commentary only; no context → held as before.
// Run: node --test api/ingest-local-company-intel.rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './ingest-local-company-intel.js';

process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET = 'intel-secret';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'svc';

function stub() {
  const reports = []; const reviews = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url); const m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const ok = (v, status = 200) => ({ ok: true, status, async json() { return v; }, async text() { return JSON.stringify(v); } });
    if (u.includes('/company_intel_imports') && m === 'POST') return ok([body], 201);
    if (u.includes('/rest/v1/reports') && m === 'POST') { reports.push(body); return ok([], 201); }
    if (u.includes('/company_scores?on_conflict=company_name') && m === 'POST') { reviews.push(...(body.web_reviews || [])); return ok([], 201); }
    return ok([]); // company lookups, score recompute reads/writes
  };
  return { reports, reviews };
}
const call = (body) => new Promise((resolve) => {
  const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  handler({ method: 'POST', headers: { authorization: 'Bearer intel-secret' }, body }, res);
});
const reddit = (over) => ({ company: 'Home Depot', source: 'Reddit r/HomeDepot', source_url: 'https://www.reddit.com/r/HomeDepot/comments/abc/x/', kind: 'applicant_outcome', ...over });

test('a context-carrying account that passes the rules is published as a Reddit-tier report', async () => {
  const db = stub();
  const r = await call({ items: [reddit({ excerpt: 'Just got hired as a part time cashier, orientation is Monday.', outcome: 'offer', context: { title: 'Just got hired!', is_op: true, company_sub: true }, posted: '2025-03-02T10:00:00Z' })] });
  assert.equal(r.body.published_reports, 1, JSON.stringify(r.body));
  const row = db.reports[0];
  assert.equal(row.platform, 'Reddit r/HomeDepot');
  assert.equal(row.source, 'reddit');
  assert.equal(row.needs_review, false);
  assert.equal(row.trust_reason, 'reddit_rule_match');
  assert.equal(row.outcome_weight, 0.3);
  assert.equal(row.outcome, 'offer');
  assert.match(row.report_text, /\[Source: https:\/\/www\.reddit\.com\/r\/HomeDepot\/comments\/abc\/x\/\]$/);
});

test('an account that fails Seen’s rules is kept as commentary, never as a report', async () => {
  const db = stub();
  const r = await call({ items: [reddit({ excerpt: 'We let the person who got the job know last so the others hear it from us.', outcome: 'offer', context: { title: 'Interview tips?', is_op: false, company_sub: true } })] });
  assert.equal(r.body.downgraded, 1);
  assert.equal(db.reports.length, 0);
  assert.equal(r.body.commentary, 1);
  assert.equal(db.reviews.at(-1).kind, 'public_commentary');
});

test('the outcome comes from Seen’s own reading; assessment maps to a value the reports table accepts', async () => {
  const db = stub();
  await call({ items: [reddit({ excerpt: 'Home Depot interviewed me, then ghosted me after the second round.', outcome: 'offer', context: { title: 'Ugh', is_op: true, company_sub: false } })] });
  assert.equal(db.reports[0].outcome, 'ghosted', 'a collector cannot pick a friendlier outcome than the text says');
  const db2 = stub();
  await call({ items: [reddit({ excerpt: 'They sent me an assessment after I applied to Home Depot online.', outcome: 'assessment' })] });
  assert.equal(db2.reports[0].outcome, 'interviewing');
  assert.equal(db2.reports[0].needs_review, true, 'no context → held for review, as before');
});
