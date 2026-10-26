// Unit tests for the self-filling company-page helpers (api/_utils/companyEnrichment.js).
// Run: node --test api/_utils/companyEnrichment.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENRICH_DEFAULTS, REDDIT_WEIGHT, RunStop, TRUST_REASON, buildImportRow, buildReportRow,
  canonicalPermalink, createPoliteFetcher, enqueueDecision, enrichmentKey, extractAccounts, finishPatch,
  importLookupList, importedIdSet, mentionTerms, normalizeClaimRows, parseThreadFeed,
  publicEnrichmentStatus, readEnrichConfig, redactPII, requeuePatch, selectThreads,
} from './companyEnrichment.js';
import { redditPermalinkKey } from '../../lib/server/companyIntelImport.js';
import { feedRowPasses } from '../../lib/reports/feedFilter.js';
import { normalizeCompanyKey } from './companyReddit.js';
import { reportSourceLink, isRedditSourced } from '../../lib/reportSource.ts';
import { classifyPlatform } from './companyIntel.js';

// ── Key + enqueue guard ─────────────────────────────────────────────────────────

test('enrichmentKey is the repo company cache key (suffix-stripped, lowercased)', () => {
  assert.equal(enrichmentKey('Acme, Inc.'), 'acme');
  assert.equal(enrichmentKey('  Coca   Cola  '), 'coca cola');
  assert.equal(enrichmentKey('Acme, Inc.'), normalizeCompanyKey('acme'));
});

test('enqueueDecision: only real names with zero first-party reports', () => {
  assert.deepEqual(enqueueDecision('Acme Inc', 0), { ok: true, key: 'acme', name: 'acme inc' });
  assert.equal(enqueueDecision('Acme Inc', 3).ok, false);
  assert.equal(enqueueDecision('Acme Inc', 3).reason, 'has_reports');
  for (const junk of ['', ' ', 'n/a', 'Unknown', 'test', '#12345', '1234', 'x', null, undefined, 42, 'a'.repeat(130)]) {
    assert.equal(enqueueDecision(junk, 0).ok, false, `should refuse ${JSON.stringify(junk)}`);
  }
});

test('publicEnrichmentStatus: only known statuses pass through', () => {
  assert.deepEqual(publicEnrichmentStatus({ status: 'queued', requested_at: 't', done_at: null }), { status: 'queued', requested_at: 't', done_at: null });
  assert.equal(publicEnrichmentStatus({ status: 'weird' }), null);
  assert.equal(publicEnrichmentStatus(null), null);
  assert.equal(publicEnrichmentStatus(undefined), null);
});

// ── Claim-result handling ───────────────────────────────────────────────────────

test('normalizeClaimRows: valid rows kept, junk names retired, keyless rows dropped', () => {
  const { valid, invalid } = normalizeClaimRows([
    { company_key: 'acme', company_name: 'Acme Inc', attempts: 2 },
    { company_key: 'na', company_name: 'n/a', attempts: 1 },
    { company_key: '', company_name: 'nope' },
    null,
    { company_key: 'globex', company_name: 'globex', attempts: '1' },
    { company_key: 'x1', company_name: 42 },
  ]);
  assert.deepEqual(valid, [{ key: 'acme', name: 'acme inc', attempts: 2 }, { key: 'globex', name: 'globex', attempts: 1 }]);
  assert.deepEqual(invalid, ['na', 'x1']);
  assert.deepEqual(normalizeClaimRows(null), { valid: [], invalid: [] });
  assert.deepEqual(normalizeClaimRows({ error: 'x' }), { valid: [], invalid: [] });
});

test('finishPatch: done vs empty, 30-day cooldown', () => {
  const now = Date.parse('2026-10-17T00:00:00Z');
  const p = finishPatch({ threadsSeen: 5, reportsAdded: 3 }, now);
  assert.equal(p.status, 'done');
  assert.equal(p.reports_added, 3);
  assert.equal(p.threads_seen, 5);
  assert.equal(p.next_eligible_at, '2026-11-16T00:00:00.000Z');
  assert.equal('llm_called_at' in p, false);
  const e = finishPatch({ threadsSeen: 0, reportsAdded: 0 }, now);
  assert.equal(e.status, 'empty');
});

test('requeuePatch: throttles refund the attempt; failures back off then give up', () => {
  const now = 0;
  const t = requeuePatch({ kind: 'throttled', attempts: 2, reason: 'reddit_429', delayMs: 1000 }, now);
  assert.equal(t.status, 'queued');
  assert.equal(t.attempts, 1);
  assert.equal(t.next_eligible_at, new Date(1000).toISOString());
  const f = requeuePatch({ kind: 'failed', attempts: 1, reason: 'reports_insert_500' }, now);
  assert.equal(f.status, 'queued');
  assert.equal(f.last_error, 'reports_insert_500');
  assert.equal(f.next_eligible_at, new Date(3_600_000).toISOString());
  const g = requeuePatch({ kind: 'failed', attempts: 3, reason: 'reports_insert_500' }, now);
  assert.equal(g.status, 'error');
});

// ── Feed parsing + selection ────────────────────────────────────────────────────

const entry = ({ id, author = 'someone', title = '', html = '', link = '' }) => `<entry>
  <author><name>/u/${author}</name></author>
  <category term="recruitinghell" label="r/recruitinghell"/>
  <content type="html">${html}</content>
  <id>${id}</id>
  <link href="${link}"/>
  <updated>2026-09-01T00:00:00+00:00</updated>
  <title>${title}</title>
</entry>`;

test('parseThreadFeed: post + comments, bots/dead dropped, PII redacted, caps applied', () => {
  const link = 'https://www.reddit.com/r/recruitinghell/comments/abc123/acme_ghosted_me/';
  const xml = `<feed>${[
    entry({ id: 't3_abc123', author: 'op', title: 'Acme ghosted me', link, html: '&lt;p&gt;I applied to Acme and email me at bob@x.com&lt;/p&gt;' }),
    entry({ id: 't1_c1', author: 'AutoModerator', html: '&lt;p&gt;Rules reminder for this subreddit, please read&lt;/p&gt;' }),
    entry({ id: 't1_c2', author: 'other', html: '&lt;p&gt;Same here, call 555-123-4567 or ping /u/someone&lt;/p&gt;' }),
    entry({ id: 't1_c3', author: 'op', html: '&lt;p&gt;Update: still nothing after six weeks from them&lt;/p&gt;' }),
    entry({ id: 't1_c4', author: 'x', html: '[deleted]' }),
  ].join('')}</feed>`;
  const { post, comments } = parseThreadFeed(xml, { maxComments: 25, maxChars: 1000 });
  assert.equal(post.id, 'abc123');
  assert.equal(post.subreddit, 'recruitinghell');
  assert.match(post.body, /\[email\]/);
  assert.doesNotMatch(post.body, /bob@x\.com/);
  assert.equal(comments.length, 2);
  assert.match(comments[0].body, /\[phone\]/);
  assert.match(comments[0].body, /\[user\]/);
  assert.equal(comments[1].is_op, true);
  assert.equal(parseThreadFeed(xml, { maxComments: 1 }).comments.length, 1);
  assert.ok(parseThreadFeed(xml, { maxChars: 20 }).comments[0].body.length <= 20);
  assert.deepEqual(parseThreadFeed('not xml'), { post: null, comments: [] });
});

test('redactPII scrubs emails, links, phones, usernames', () => {
  const s = redactPII('mail a@b.co see https://x.com call (555) 123-4567 thanks u/jane_doe');
  assert.doesNotMatch(s, /a@b\.co|https:|555|jane_doe/);
});

const item = (id, title, { sub = 'recruitinghell', body = '' } = {}) => ({
  id, title, subreddit: sub, permalink: `https://www.reddit.com/r/${sub}/comments/${id}/x/`, author: 'a', created: '2026-09-01T00:00:00.000Z', _body: body,
});

test('selectThreads: production relevance gate + FULL-phrase mention + reddit_imports skip + cap', () => {
  const items = [
    item('aaa111', 'Robert Half recruiter ghosted me after interview'),
    item('bbb222', 'Robert from accounting interview tips', { sub: 'jobs' }),         // first-token only → dropped
    item('ccc333', 'Robert Half offer rescinded', { sub: 'cscareerquestions' }),
    item('ddd444', 'robert half restaurant review', { sub: 'food' }),                 // no job context → dropped
    item('eee555', 'Interview at Robert Half — ghosted'),
    item('bad/id', 'Robert Half hiring'),                                             // unsafe id → dropped
  ];
  const out = selectThreads(items, 'robert half', { cap: 10 });
  assert.deepEqual(out.map((t) => t.id).sort(), ['aaa111', 'ccc333', 'eee555']);
  assert.deepEqual(selectThreads(items, 'robert half', { cap: 10, importedIds: new Set(['ccc333']) }).map((t) => t.id).sort(), ['aaa111', 'eee555']);
  assert.equal(selectThreads(items, 'robert half', { cap: 2 }).length, 2);
  assert.deepEqual(mentionTerms('Acme, Inc.'), ['acme, inc.', 'acme']);
});

test('reddit_imports dedupe helpers accept fullnames and bare ids, drop unsafe ids', () => {
  assert.deepEqual(importLookupList(['abc', 'abc', 'x/y']), ['t3_abc', 'abc']);
  assert.deepEqual([...importedIdSet([{ reddit_post_id: 't3_abc' }, { reddit_post_id: 'def' }, {}])], ['abc', 'def']);
});

// ── Prompt ──────────────────────────────────────────────────────────────────────

// ── Extraction: the strict first-hand rules (no model) ───────────────────────────

test('extractAccounts: first-hand accounts only, judged with the thread context; one per voice; repeats once', () => {
  const { kept, dropped } = extractAccounts('acme corp', [
    { id: 'abc111', subreddit: 'recruitinghell', title: 'Acme Corp ghosted me', body: 'I applied to Acme Corp for a data role and never heard back after the final interview.', comments: [
      { id: 'c0', is_op: false, body: 'Has anyone here interviewed at Acme Corp recently? Curious about their process.' }, // a question
      { id: 'c1', is_op: false, body: 'Acme Corp rejected me after the phone screen last month, for a warehouse role.' },
      { id: 'c2', is_op: true, body: 'Update: Acme Corp finally sent me a rejection email after the interview.' },         // the OP again
      { id: 'c3', is_op: false, body: 'My friend said Acme Corp ghosted her, which sounds about right for them.' },         // hearsay
      { id: 'c4', is_op: false, body: 'If Acme Corp offers you the job, you should negotiate the starting pay.' },          // advice
    ] },
    { id: 'def222', subreddit: 'jobs', title: 'Warehouse jobs around Phoenix', body: 'Target ghosted me after two interviews this summer.', comments: [
      { id: 'd1', is_op: false, body: 'Acme Corp rejected me after the phone screen last month, for a warehouse role.' },   // same words: one account
    ] },
  ]);
  // The OP once (most final outcome: the later rejection), c1 once.
  assert.deepEqual(kept.map((a) => [a.thread_id, a.comment_id, a.outcome]), [['abc111', 'c2', 'rejected'], ['abc111', 'c1', 'rejected']]);
  assert.match(kept[1].excerpt, /^Acme Corp rejected me/);
  assert.equal(dropped.duplicate, 1);
  assert.ok(dropped.not_an_applicant_account >= 4);
});

test('extractAccounts: the company\'s own subreddit is context; an assessment is stored as interviewing', () => {
  const { kept } = extractAccounts('acme corp', [
    { id: 'aaa111', subreddit: 'Acme', title: 'Interview tomorrow', body: 'They sent me a take-home assessment after the recruiter call, due Friday.', comments: [] },
  ]);
  assert.deepEqual(kept.map((a) => a.outcome), ['interviewing']);
  assert.deepEqual(extractAccounts('acme corp', []), { kept: [], dropped: {} });
  assert.deepEqual(extractAccounts('acme corp', null), { kept: [], dropped: {} });
});

// ── Row shapes ──────────────────────────────────────────────────────────────────

const acct = (over = {}) => ({ thread_id: 'abc123', comment_id: null, outcome: 'ghosted', excerpt: 'I applied to Acme Inc for a data role and never heard back after the final interview.', ...over });

test('buildReportRow: Reddit-tier shape, the person\'s own words + an attribution link the UI can render', () => {
  const row = buildReportRow(acct(), { companyName: 'Acme Inc', subreddit: 'recruitinghell', threadId: 'abc123', companyId: 'cid' });
  assert.deepEqual(Object.keys(row).sort(), ['company_id', 'company_name', 'experience_level', 'location_id', 'needs_review', 'outcome', 'outcome_weight', 'platform', 'report_text', 'role', 'rounds', 'source', 'trust_reason', 'unpaid_work'].sort());
  assert.equal(row.company_name, 'acme inc');
  assert.equal(row.platform, 'Reddit r/recruitinghell');
  assert.equal(row.source, 'reddit');
  assert.equal(row.outcome_weight, REDDIT_WEIGHT);
  assert.equal(row.outcome_weight, 0.3);
  assert.equal(row.trust_reason, TRUST_REASON);
  assert.equal(row.trust_reason, 'reddit_rule_match');
  assert.equal(row.needs_review, false);
  assert.equal(row.role, '');
  assert.equal(row.location_id, null);
  assert.equal('city' in row, false, 'reports has no city column');
  // Fusion classifies it as reddit (0.3 trust), the UI labels it public discussion and links the thread.
  assert.equal(classifyPlatform(row.platform), 'reddit');
  assert.equal(isRedditSourced(row.platform), true);
  const link = reportSourceLink(row.platform, row.report_text);
  assert.equal(link.url, 'https://www.reddit.com/r/recruitinghell/comments/abc123/');
  assert.equal(link.body, acct().excerpt);
  // The public feed shows it: the stored words pass the same strict rules (context verified).
  assert.equal(feedRowPasses({ ...row, company_name: 'acme inc' }), true);
  // A comment's report links the comment; the permalink key is the comment's, whatever its id length.
  const c = buildReportRow(acct({ comment_id: 'c1' }), { companyName: 'Acme Inc', subreddit: 'recruitinghell', threadId: 'abc123' });
  assert.equal(reportSourceLink(c.platform, c.report_text).url, 'https://www.reddit.com/r/recruitinghell/comments/abc123/_/c1/');
  assert.equal(redditPermalinkKey('https://www.reddit.com/r/recruitinghell/comments/abc123/_/c1/').key, 'abc123/c1');
  // Contact details in the words are scrubbed before they are stored.
  assert.doesNotMatch(buildReportRow(acct({ excerpt: 'I applied to Acme Inc, emailed jo@acme.com and never heard back after the final interview.' }), { companyName: 'Acme Inc', subreddit: 'jobs', threadId: 'abc123' }).report_text, /jo@acme\.com/);
  // An unsafe subreddit/thread id never produces a link.
  assert.equal(canonicalPermalink('bad sub', 'abc'), null);
  assert.equal(canonicalPermalink('jobs', 'a/b'), null);
  assert.equal(canonicalPermalink('jobs', 'abc', 'x/y'), 'https://www.reddit.com/r/jobs/comments/abc/');
  assert.equal(buildReportRow(acct(), { companyName: 'x co', subreddit: 'bad sub', threadId: 'abc' }).report_text, acct().excerpt);
});

test('buildImportRow: fullname id, skipped when nothing kept', () => {
  assert.deepEqual(buildImportRow({ threadId: 'abc', companyName: 'Acme', subreddit: 'jobs', reportId: 'r1', kept: 2 }),
    { reddit_post_id: 't3_abc', company_name: 'acme', subreddit: 'jobs', report_id: 'r1', skipped: false, skip_reason: null });
  assert.equal(buildImportRow({ threadId: 'abc', companyName: 'Acme', subreddit: 'jobs', kept: 0 }).skip_reason, 'no_applicant_accounts');
});

// ── Politeness ──────────────────────────────────────────────────────────────────

function fakeClock() {
  let t = 1_000_000;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps, advance: (ms) => { t += ms; } };
}
const resp = (status, text = '<feed/>') => ({ status, ok: status >= 200 && status < 300, text: async () => text, headers: { get: () => null } });

test('createPoliteFetcher: sequential ≥1s spacing between every request', async () => {
  const clock = fakeClock();
  const starts = [];
  const f = createPoliteFetcher({ fetchImpl: async () => { starts.push(clock.now()); return resp(200); }, sleep: clock.sleep, now: clock.now, intervalMs: 1100 });
  for (let i = 0; i < 4; i++) await f.get((h) => `${h}/x`);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 1100, `gap ${starts[i] - starts[i - 1]}`);
  assert.equal(f.stats.requests, 4);
});

test('createPoliteFetcher: first 429 backs off, second 429 stops the run', async () => {
  const clock = fakeClock();
  const statuses = [429, 200, 429, 200];
  const starts = [];
  const f = createPoliteFetcher({ fetchImpl: async () => { starts.push(clock.now()); return resp(statuses.shift()); }, sleep: clock.sleep, now: clock.now, intervalMs: 1100, backoff429Ms: 10_000 });
  assert.equal((await f.get((h) => `${h}/a`)).status, 429);           // no same-request retry, no host switch
  assert.equal((await f.get((h) => `${h}/b`)).ok, true);
  assert.ok(starts[1] - starts[0] >= 10_000, 'backed off after the first 429');
  await assert.rejects(f.get((h) => `${h}/c`), (e) => e instanceof RunStop && e.reason === 'reddit_429');
  assert.equal(f.stats.r429, 2);
  assert.equal(f.stats.requests, 3);
});

test('createPoliteFetcher: 403/5xx/network fall back to old.reddit; 404 does not; deadline aborts', async () => {
  const clock = fakeClock();
  const urls = [];
  const plan = [resp(403), resp(200, 'ok'), resp(404)];
  const f = createPoliteFetcher({ fetchImpl: async (u) => { urls.push(u); return plan.shift(); }, sleep: clock.sleep, now: clock.now });
  assert.equal((await f.get((h) => `${h}/x`)).text, 'ok');
  assert.deepEqual(urls, ['https://www.reddit.com/x', 'https://old.reddit.com/x']);
  assert.equal((await f.get((h) => `${h}/gone`)).status, 404);
  assert.equal(urls.length, 3);
  const g = createPoliteFetcher({ fetchImpl: async () => { throw new Error('net'); }, sleep: clock.sleep, now: clock.now });
  assert.equal((await g.get((h) => `${h}/x`)).ok, false);
  assert.equal(g.stats.requests, 2);
  const d = createPoliteFetcher({ fetchImpl: async () => resp(200), sleep: clock.sleep, now: clock.now, deadline: () => true });
  await assert.rejects(d.get((h) => h), (e) => e.reason === 'deadline');
});

test('readEnrichConfig: env overrides are bounded', () => {
  assert.equal(readEnrichConfig({}).batch, ENRICH_DEFAULTS.batch);
  const c = readEnrichConfig({ ENRICH_BATCH: '99' });
  assert.equal(c.batch, 10);
  assert.equal(readEnrichConfig({ ENRICH_BATCH: '-1' }).batch, ENRICH_DEFAULTS.batch);
  assert.equal(readEnrichConfig({ ENRICH_SOURCE: 'ARCTIC' }).source, 'arctic');
  assert.equal(readEnrichConfig({ ENRICH_SOURCE: 'elsewhere' }).source, 'auto');
  assert.ok(ENRICH_DEFAULTS.runBudgetMs < 300_000);
});
