// Run: node --test lib/reports/archiveHarvest.test.mjs
// The harvester against a fake Arctic Shift archive: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCompanySubs, searchPlan, harvestCompany, BUSY_AFTER } from './archiveHarvest.js';
import { classifyApplicantAccount } from './applicantRules.js';

test('company subreddits: the exact name and worker subs, not memes/deals/customers', () => {
  const found = [
    { display_name: 'walmart', subscribers: 322537 }, { display_name: 'WalmartCelebrities', subscribers: 281653 },
    { display_name: 'WalmartEmployees', subscribers: 40631 }, { display_name: 'walmartpeople', subscribers: 21864 },
    { display_name: 'WalmartSellers', subscribers: 6469 }, { display_name: 'WalmartAssociates', subscribers: 4051 },
    { display_name: 'WalmartCanada', subscribers: 5306 }, { display_name: 'walmartmemes', subscribers: 900 },
  ];
  assert.deepEqual(pickCompanySubs('Walmart', found).map((s) => s.name), ['walmart', 'WalmartEmployees', 'WalmartAssociates']);
  assert.deepEqual(pickCompanySubs('The Home Depot', [{ display_name: 'HomeDepot', subscribers: 104688 }, { display_name: 'HomeDepotDeals', subscribers: 894 }]).map((s) => s.name), ['HomeDepot']);
});

test('the job-subreddit plan: the company name, newest year first, quiet subreddits once', () => {
  const plan = [...searchPlan('Chipotle', { jobSubs: ['recruitinghell', 'interviews'], years: 2, nowSec: 2_000_000_000 })];
  assert.ok(plan.every((q) => q.kind === 'job_sub' && q.params.query === 'chipotle'));
  assert.ok(plan.every((q, i) => i === 0 || Number(q.params.before || 2_000_000_000) <= Number(plan[i - 1].params.before || 2_000_000_000) || !q.params.before), 'windows go back in time');
  assert.equal(plan.filter((q) => q.sub === 'interviews').length, 1, 'a quiet subreddit is searched once, all time');
  assert.equal(plan.filter((q) => q.sub === 'recruitinghell').length, 2, 'an active one, year by year');
});

function fakeArchive({ posts, trees, subs = [{ display_name: 'Chipotle', subscribers: 121448 }] }) {
  const calls = [];
  return { calls, get: async (path, params) => {
    calls.push({ path, params });
    if (path === '/api/subreddits/search') return { ok: true, items: subs };
    if (path === '/api/posts/search') return { ok: true, items: posts.filter((p) => p.subreddit === params.subreddit && (!params.title || `${p.title} ${p.selftext}`.toLowerCase().includes(String(params.title).toLowerCase()))) };
    if (path === '/api/comments/tree') return { ok: true, items: trees[params.link_id] || [] };
    return { ok: false, items: [] };
  } };
}
const post = (id, subreddit, title, selftext, author = 'op') => ({ id, subreddit, title, selftext, author, created_utc: 1_760_000_000 });
const comment = (id, body, author = 'u1') => ({ kind: 't1', data: { id, body, author } });

test('harvest: reads opening posts and comments, keeps only first-hand accounts, stops at the goal', async () => {
  const posts = [
    post('a1', 'Chipotle', 'Just got hired!', 'Just got hired as a kitchen crew member, orientation is Friday.'),
    post('a2', 'Chipotle', 'Interview went badly', 'I had an interview on Monday and they told me they would call. Never heard back.'),
    post('a3', 'recruitinghell', 'Chipotle ghosted me', 'I applied to Chipotle twice and they ghosted me both times after the interview.'),
    post('a4', 'recruitinghell', 'Job market is brutal', 'Taco Bell rejected me, Wendy rejected me.'), // never names Chipotle → not read
    post('a5', 'Chipotle', 'Hiring?', 'Is my local store hiring?'), // a question, no event
  ];
  const trees = {
    t3_a1: [comment('c1', 'Congrats! I got hired at Chipotle last month and the training was fine.'), comment('c2', 'We let the person who got the job know last.')],
    t3_a2: [comment('c3', 'Same here, I interviewed with Chipotle and they ghosted me too.'), comment('c4', 'I had an interview on Monday and they told me they would call. Never heard back.', 'op')],
  };
  const fetcher = fakeArchive({ posts, trees });
  const got = [];
  const r = await harvestCompany('Chipotle', { fetcher, goal: 0, years: 1, jobSubs: ['recruitinghell'], onAccounts: async (a) => { got.push(...a); } });
  assert.equal(r.stoppedBy, 'exhausted');
  assert.deepEqual(r.companySubs, ['Chipotle']);
  const by = got.map((a) => `${a.thread}:${a.outcome}`).sort();
  // a1: the OP and commenter c1 both got hired; a2: the OP had an interview ("Never heard back." names no
  // applicant event on its own), commenter c3 was ghosted; a3: the OP was ghosted.
  assert.deepEqual(by, ['a1:offer', 'a1:offer', 'a2:ghosted', 'a2:interview', 'a3:ghosted'], `got ${by.join(', ')}`);
  assert.ok(!got.some((a) => /person who got the job/.test(a.excerpt)), 'a manager’s view is not an applicant account');
  assert.ok(!fetcher.calls.some((c) => c.path === '/api/comments/tree' && c.params.link_id === 't3_a4'), 'a job-subreddit thread that never names the company is not read');
  for (const a of got) assert.equal(classifyApplicantAccount(a.excerpt, { names: ['Chipotle'], title: a.title, isOp: a.isOp, inCompanySub: a.inCompanySub }).kind, 'applicant_outcome', `stored text must pass Seen’s re-check: ${a.excerpt}`);

  const few = [];
  const g = await harvestCompany('Chipotle', { fetcher: fakeArchive({ posts, trees }), goal: 2, years: 1, jobSubs: ['recruitinghell'], onAccounts: async (a) => { few.push(...a); } });
  assert.equal(g.stoppedBy, 'goal');
  assert.ok(few.length >= 2);
});

test('a cross-post (same words, another thread) counts once; a thread already read is skipped', async () => {
  const text = 'I applied to Chipotle in May and they ghosted me after the second interview.';
  const posts = [post('b1', 'recruitinghell', 'Chipotle', text), post('b2', 'Chipotle', 'Applied', text)];
  const got = [];
  await harvestCompany('Chipotle', { fetcher: fakeArchive({ posts, trees: {} }), goal: 0, years: 1, jobSubs: ['recruitinghell'], seenThreads: new Set(), onAccounts: async (a) => { got.push(...a); } });
  assert.equal(got.length, 1);
  const again = [];
  await harvestCompany('Chipotle', { fetcher: fakeArchive({ posts, trees: {} }), goal: 0, years: 1, jobSubs: ['recruitinghell'], seenThreads: new Set(['b1', 'b2']), onAccounts: async (a) => { again.push(...a); } });
  assert.equal(again.length, 0);
});

test('the goal counts reports Seen newly accepts: a re-run walks past accounts Seen already holds', async () => {
  const posts = [1, 2, 3, 4, 5].map((i) => post(`d${i}`, 'recruitinghell', `Chipotle ${i}`, `I applied to Chipotle in store ${i} and they ghosted me after the interview, no call at all.`));
  const held = new Set(['d1', 'd2', 'd3']); // already in Seen from an earlier run
  const sent = [];
  const r = await harvestCompany('Chipotle', { fetcher: fakeArchive({ posts, trees: {}, subs: [] }), goal: 2, years: 1, jobSubs: ['recruitinghell'],
    onAccounts: async (a) => { sent.push(...a.map((x) => x.thread)); return a.filter((x) => !held.has(x.thread)).length; } });
  assert.equal(r.stoppedBy, 'goal');
  assert.equal(r.newReports, 2);
  assert.equal(r.found, 5, 'it kept reading until two NEW reports were accepted');
  const dry = await harvestCompany('Chipotle', { fetcher: fakeArchive({ posts, trees: {}, subs: [] }), goal: 2, years: 1, jobSubs: ['recruitinghell'], onAccounts: async () => {} });
  assert.equal(dry.found, 2, 'without an answer (dry run) the goal counts accounts found');
  assert.equal(dry.newReports, null);
});

test('a failed search keeps its reason, so a run where every search fails says why', async () => {
  const fetcher = { get: async () => ({ ok: false, error: 'network: fetch failed (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)' }) };
  const r = await harvestCompany('Chipotle', { fetcher, goal: 0, years: 1, jobSubs: ['recruitinghell'] });
  assert.ok(r.searches > 0);
  assert.equal(r.failedSearches, r.searches);
  assert.deepEqual(r.searchErrors, ['network: fetch failed (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)']);
});

// A fake archive that pages a subreddit by `before` like the real one and can refuse full-text search.
function pagedArchive({ posts, subs = [], refuseText = false, refuseSubs = false }) {
  const calls = [];
  return { calls, get: async (path, params, opts) => {
    calls.push({ path, params, opts });
    if (path === '/api/subreddits/search') return refuseSubs ? { ok: false, status: 422, error: 'Timeout. Maybe slow down a bit' } : { ok: true, items: subs };
    if (path === '/api/comments/tree') return { ok: true, items: [] };
    if (params.query || params.title) {
      if (refuseText) return { ok: false, status: 422, error: 'Timeout. Maybe slow down a bit' };
      return { ok: true, items: posts.filter((p) => p.subreddit.toLowerCase() === params.subreddit.toLowerCase() && `${p.title} ${p.selftext}`.toLowerCase().includes(String(params.query || params.title).toLowerCase())) };
    }
    const page = posts.filter((p) => p.subreddit.toLowerCase() === params.subreddit.toLowerCase() && p.created_utc < Number(params.before) && p.created_utc > Number(params.after))
      .sort((a, b) => b.created_utc - a.created_utc).slice(0, Number(params.limit));
    return { ok: true, items: page };
  } };
}
const at = (id, subreddit, utc, title, selftext) => ({ id, subreddit, title, selftext, author: 'op', created_utc: utc });
const NOW = 1_760_000_000;

test('a company subreddit is LISTED page by page (no text filter) and matched for applicant words here', async () => {
  // 230 posts: one page of 100 is not the end; the applicant story is in a BODY, not a title.
  const posts = Array.from({ length: 230 }, (_, i) => at(`p${i}`, 'Chipotle', NOW - 1000 - i * 3600, `Burrito bowl ${i}`, 'Lunch rush was wild today.'));
  posts[180] = at('p180', 'Chipotle', NOW - 1000 - 180 * 3600, 'Week one', 'I just got hired as a kitchen crew member and orientation is Friday.');
  const fetcher = pagedArchive({ posts, subs: [{ display_name: 'Chipotle', subscribers: 121448 }] });
  const got = [];
  const r = await harvestCompany('Chipotle', { fetcher, goal: 0, years: 1, jobSubs: ['recruitinghell'], nowSec: NOW, onAccounts: async (a) => { got.push(...a); } });
  const pages = fetcher.calls.filter((c) => c.path === '/api/posts/search' && c.params.subreddit === 'Chipotle');
  assert.equal(pages.length, 3, '100 + 100 + 30');
  assert.ok(pages.every((c) => !c.params.title && !c.params.query), 'no full-text filter on a company subreddit');
  assert.ok(Number(pages[1].params.before) < Number(pages[0].params.before) && Number(pages[2].params.before) < Number(pages[1].params.before), 'walks back in time');
  assert.deepEqual(got.map((a) => `${a.thread}:${a.outcome}`), ['p180:offer']);
  assert.equal(r.stoppedBy, 'exhausted');
  // Job-subreddit searches and company-subreddit pages alternate.
  const kinds = fetcher.calls.filter((c) => c.path === '/api/posts/search').map((c) => (c.params.subreddit === 'Chipotle' ? 'company' : 'job'));
  assert.deepEqual(kinds.slice(0, 2), ['job', 'company']);
  assert.ok(fetcher.calls.every((c) => c.opts && 'deadlineAt' in c.opts), 'every archive call carries the deadline');
});

test('in a listed company subreddit, software "application"/"we offer" in a body is not an applicant thread; no comments, no tree request', async () => {
  const posts = [
    at('g1', 'gitlab', NOW - 100, 'CI pipeline question', 'Our application fails to deploy; does GitLab offer a fix?'),
    { ...at('g2', 'gitlab', NOW - 200, 'Finally', 'I interviewed at GitLab twice and got hired last week, onboarding starts Monday.'), num_comments: 0 },
  ];
  const fetcher = pagedArchive({ posts, subs: [{ display_name: 'gitlab', subscribers: 50000 }] });
  const got = [];
  const r = await harvestCompany('GitLab', { fetcher, goal: 0, years: 1, jobSubs: [], nowSec: NOW, onAccounts: async (a) => { got.push(...a); } });
  assert.equal(r.threadsRead, 1, 'only the applicant thread is read');
  assert.deepEqual(got.map((a) => a.thread), ['g2']);
  assert.equal(fetcher.calls.filter((c) => c.path === '/api/comments/tree').length, 0, 'num_comments 0 → no tree request');
});

test('a customer post in a subreddit named after the company is not an applicant thread ("Affirm rejected me" = a loan)', async () => {
  const posts = [
    at('f1', 'Affirm', NOW - 100, 'Declined at checkout', 'Realized I bought the wrong item so I tried doing it with the other item I was supposed to get, but Affirm rejected me.'),
    at('f2', 'Affirm', NOW - 200, 'Rejected after the onsite', 'I applied for a backend engineer position at Affirm, did the onsite interview, and they rejected me two days later.'),
  ];
  const fetcher = pagedArchive({ posts, subs: [{ display_name: 'Affirm', subscribers: 30000 }] });
  const got = [];
  await harvestCompany('Affirm', { fetcher, goal: 0, years: 1, jobSubs: [], nowSec: NOW, onAccounts: async (a) => { got.push(...a); } });
  assert.deepEqual(got.map((a) => `${a.thread}:${a.outcome}`), ['f2:rejected']);
  assert.ok(!fetcher.calls.some((c) => c.path === '/api/comments/tree' && c.params.link_id === 't3_f1'), 'the loan thread is not even read');
});

test('a busy archive: refused full-text searches stop after BUSY_AFTER in a row, the listing still runs, and it says so', async () => {
  const posts = [at('h1', 'Chipotle', NOW - 5000, 'Got the job', 'I applied last week, had an interview Monday and got hired on the spot.')];
  const fetcher = pagedArchive({ posts, subs: [{ display_name: 'Chipotle', subscribers: 121448 }], refuseText: true });
  const got = [];
  const r = await harvestCompany('Chipotle', { fetcher, goal: 0, years: 3, nowSec: NOW, onAccounts: async (a) => { got.push(...a); } });
  assert.equal(r.stoppedBy, 'archive_busy');
  assert.equal(r.archiveBusy, true);
  assert.equal(got.length, 1, 'the company subreddit was still read');
  const fullText = fetcher.calls.filter((c) => c.params?.query || c.params?.title);
  assert.equal(fullText.length, BUSY_AFTER * 2, 'each refused search tried query then title; then the rest were skipped');
  assert.equal(r.failedSearches, BUSY_AFTER);
  assert.deepEqual(r.searchErrors, ['Timeout. Maybe slow down a bit']);
});

test('a refused subreddit search is a failure, not "no subreddit": the exact-name subreddit is still listed', async () => {
  const posts = [at('n1', 'natera', NOW - 5000, 'Interview update', 'I had my final interview at Natera and they sent me an offer today.')];
  const fetcher = pagedArchive({ posts, refuseSubs: true });
  const got = [];
  const r = await harvestCompany('Natera', { fetcher, goal: 0, years: 1, jobSubs: [], nowSec: NOW, onAccounts: async (a) => { got.push(...a); } });
  assert.deepEqual(r.companySubs, ['natera']);
  assert.equal(r.failedSearches, 1);
  assert.deepEqual(r.searchErrors, ['Timeout. Maybe slow down a bit']);
  assert.equal(got.length, 1);
});

test('the fetcher\'s "deadline" answer stops the company on time and is not counted as a refused search', async () => {
  const fetcher = { get: async (path) => (path === '/api/subreddits/search' ? { ok: true, items: [] } : { ok: false, status: 0, error: 'deadline' }) };
  const r = await harvestCompany('Chipotle', { fetcher, goal: 10, years: 1, jobSubs: ['recruitinghell'] });
  assert.equal(r.stoppedBy, 'time');
  assert.equal(r.failedSearches, 0);
  assert.equal(r.searches, 1, 'only the subreddit search ran');
});
