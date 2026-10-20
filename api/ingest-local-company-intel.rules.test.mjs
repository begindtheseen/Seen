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
  assert.match(row.report_text, /\[Source: https:\/\/www\.reddit\.com\/r\/HomeDepot\/comments\/abc\/\]$/);
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

test('any public page with context is re-checked: a forum account publishes as a public review; a web page cannot claim a company subreddit', async () => {
  const db = stub();
  const r = await call({ items: [{ company: 'Amazon', source: 'Web · forum.example.org', source_url: 'https://forum.example.org/t/123', kind: 'applicant_outcome', outcome: 'interview',
    excerpt: 'The first time I interviewed at Amazon, the interviewer either pretended a fire alarm was going off, or it actually was.', context: { title: 'Ask HN: interview horror stories', is_op: false, company_sub: false } }] });
  assert.equal(r.body.published_reports, 1, JSON.stringify(r.body));
  const row = db.reports[0];
  assert.equal(row.platform, 'Public review · forum.example.org');
  assert.equal(row.source, 'web_public');
  assert.equal(row.trust_reason, 'web_rule_match');
  assert.equal(row.outcome_weight, 0.3);
  assert.equal(row.needs_review, false);
  const db2 = stub();
  const r2 = await call({ items: [{ company: 'Home Depot', source: 'Web · example.com', source_url: 'https://example.com/forum/1', kind: 'applicant_outcome', outcome: 'offer',
    excerpt: 'Just got hired, orientation is Monday and I am so excited!', context: { title: 'Finally', is_op: true, company_sub: true } }] });
  assert.equal(r2.body.downgraded, 1, 'company_sub is a Reddit-only context — elsewhere the company must be named');
  assert.equal(db2.reports.length, 0);
});

test('owner-excluded sources are refused whatever sent them: Hacker News, Glassdoor, Indeed', async () => {
  const db = stub();
  const items = ['https://news.ycombinator.com/item?id=1', 'https://www.glassdoor.com/Interview/x.htm', 'https://ca.indeed.com/cmp/x/interviews'].map((source_url) => ({
    company: 'Amazon', source: 'Web', source_url, kind: 'applicant_outcome', outcome: 'interview',
    excerpt: 'The first time I interviewed at Amazon, the interviewer pretended a fire alarm was going off.', context: { title: 'x', is_op: false, company_sub: false } }));
  const r = await call({ items });
  assert.equal(r.body.rejected, 3);
  assert.equal(db.reports.length, 0);
  assert.equal(db.reviews.length, 0, 'not kept as commentary either');
  assert.ok(r.body.errors.some((e) => /excluded source: news\.ycombinator\.com \(owner decision\)/.test(e)));
});

test('one report per Reddit post: a report already citing the same post (any link form) makes it a duplicate', async () => {
  const reports = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url); const m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const ok = (v, status = 200) => ({ ok: true, status, async json() { return v; }, async text() { return JSON.stringify(v); } });
    // An earlier collector stored the same post with its title slug in the link.
    if (u.includes('/rest/v1/reports?') && m === 'GET' && decodeURIComponent(u).includes('report_text=ilike.*/comments/1x426rz*'))
      return ok([{ report_text: 'I have an interview for Quantinuum next week. [Source: https://www.reddit.com/r/Quantinuum/comments/1x426rz/interview_prep/]' }]);
    if (u.includes('/company_intel_imports') && m === 'POST') return ok([body], 201);
    if (u.includes('/rest/v1/reports') && m === 'POST') { reports.push(body); return ok([], 201); }
    return ok([]);
  };
  const item = { company: 'Quantinuum', source: 'Reddit r/Quantinuum', source_url: 'https://www.reddit.com/r/Quantinuum/comments/1x426rz/', kind: 'applicant_outcome', outcome: 'interview',
    excerpt: 'I have an interview for Quantinuum next week, and I am wondering what to expect.', context: { title: 'Interview prep', is_op: true, company_sub: true } };
  const r = await call({ items: [item] });
  assert.equal(r.body.duplicates, 1, JSON.stringify(r.body));
  assert.equal(reports.length, 0);
  // A comment on the same post is a different account and still goes in.
  const c = await call({ items: [{ ...item, source_url: 'https://www.reddit.com/r/Quantinuum/comments/1x426rz/p8abc12/', context: { ...item.context, is_op: false } }] });
  assert.equal(c.body.published_reports, 1, JSON.stringify(c.body));
});

test('the OpenCLI collector\'s "Reddit r/r/Sub" source is stored as platform "Reddit r/Sub"', async () => {
  const db = stub();
  const r = await call({ items: [reddit({ source: 'Reddit r/r/HomeDepot', excerpt: 'Just got hired as a part time cashier, orientation is Monday.', outcome: 'offer', context: { title: 'Just got hired!', is_op: true, company_sub: true } })] });
  assert.equal(r.body.published_reports, 1, JSON.stringify(r.body));
  assert.equal(db.reports[0].platform, 'Reddit r/HomeDepot');
});
