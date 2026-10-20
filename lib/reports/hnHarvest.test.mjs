// Run: node --test lib/reports/hnHarvest.test.mjs — the Hacker News harvester against a fake Algolia API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harvestHackerNews, hnText } from './hnHarvest.js';
import { classifyApplicantAccount } from './applicantRules.js';

test('HN HTML becomes plain text in one pass (no double unescape)', () => {
  assert.equal(hnText('I interviewed at <i>Amazon</i>.<p>They&#x27;re fine &amp;lt;3'), 'I interviewed at Amazon . They\'re fine &lt;3');
  assert.equal(hnText('a&nbsp;b &unknown; c'), 'a b &unknown; c');
});

function fakeApi(pages) {
  const calls = [];
  return { calls, fetchImpl: async (u) => {
    const q = new URL(u).searchParams; calls.push({ query: q.get('query'), page: Number(q.get('page')) });
    const hits = (pages[q.get('query')] || [])[Number(q.get('page'))] || [];
    return { ok: true, async json() { return { hits, nbPages: (pages[q.get('query')] || []).length }; } };
  } };
}
const hit = (id, text, extra = {}) => ({ objectID: String(id), comment_text: text, story_title: 'Ask HN: interview stories', story_id: 99, author: `u${id}`, created_at: '2024-02-01T00:00:00Z', ...extra });

test('first-hand accounts only, one per person per story, link to the comment, goal counts NEW reports', async () => {
  const api = fakeApi({ '"Amazon" interview': [[
    hit(1, 'The first time I interviewed at Amazon, the interviewer pretended a fire alarm was going off.'),
    hit(2, 'I\'ve interviewed hundreds of candidates at Amazon and most were fine.'), // the interviewer's side
    hit(3, 'Amazon ghosted me after the onsite, I never heard back from the recruiter.', { author: 'u1' }), // same person, same story
    hit(4, 'Amazon is a big company with many teams.'),
  ]] });
  const got = [];
  const r = await harvestHackerNews('Amazon', { fetchImpl: api.fetchImpl, goal: 0, terms: ['interview'], intervalMs: 0, onAccounts: async (a) => { got.push(...a); return a.length; } });
  assert.equal(r.stoppedBy, 'exhausted');
  assert.deepEqual(got.map((a) => a.url), ['https://news.ycombinator.com/item?id=1']);
  assert.equal(r.newReports, 1);
  for (const a of got) assert.equal(classifyApplicantAccount(a.excerpt, { names: ['Amazon'], title: a.title }).kind, 'applicant_outcome');
});

test('stops at the goal; a failed request keeps its reason; ids seen in another term are not re-read', async () => {
  const many = Array.from({ length: 100 }, (_, i) => hit(100 + i, `I interviewed at Google in round ${i} and it went well, then they ghosted me.`, { author: `a${i}`, story_id: 1000 + i }));
  const api = fakeApi({ '"Google" interview': [many, many] });
  const r = await harvestHackerNews('Google', { fetchImpl: api.fetchImpl, goal: 5, terms: ['interview', 'offer'], intervalMs: 0, onAccounts: async (a) => a.length });
  assert.equal(r.stoppedBy, 'goal');
  assert.ok(r.newReports >= 5);
  const bad = await harvestHackerNews('Google', { fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }); }, goal: 5, terms: ['interview'], intervalMs: 0 });
  assert.equal(bad.failedSearches, 1);
  assert.deepEqual(bad.searchErrors, ['network: fetch failed (ECONNRESET)']);
});
