// Run: node --test lib/reports/archiveHarvest.test.mjs
// The harvester against a fake Arctic Shift archive: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCompanySubs, searchPlan, harvestCompany } from './archiveHarvest.js';
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

test('the plan alternates job-subreddit and company-subreddit searches, newest year first', () => {
  const plan = [...searchPlan('Chipotle', { companySubs: [{ name: 'Chipotle' }], jobSubs: ['recruitinghell', 'interviews'], years: 2, nowSec: 2_000_000_000 })];
  assert.deepEqual(plan.slice(0, 4).map((q) => q.kind), ['job_sub', 'company_sub', 'job_sub', 'company_sub']);
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
