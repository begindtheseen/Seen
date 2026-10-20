// Run: node --test lib/reports/webHarvest.test.mjs — the Google harvester against a fake browser.
// (The in-page scripts themselves run against real Chrome in the end-to-end check.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harvestGoogle, skipUrl, googleQueries, GOOGLE_RESULTS_JS } from './webHarvest.js';
import { classifyApplicantAccount } from './applicantRules.js';

test('skipped hosts: Reddit (read elsewhere), review sites pending the owner, video, job boards, Google; open forums are read', () => {
  for (const u of ['https://www.reddit.com/r/jobs/1', 'https://www.glassdoor.com/Interview/x.htm', 'https://clear.glassdoor.nl/x', 'https://static.glassdoor.com.br/x', 'https://ca.indeed.com/cmp/x/interviews',
    'https://www.linkedin.com/posts/x', 'https://m.facebook.com/groups/x', 'https://x.com/a/status/1', 'https://www.youtube.com/watch?v=1', 'https://www.ziprecruiter.com/c/x', 'https://www.google.com/search?q=x', 'https://example.com/a.pdf'])
    assert.ok(skipUrl(u), u);
  for (const u of ['https://www.quora.com/How-was-your-Chipotle-interview', 'https://community.example.org/t/chipotle-interview/123', 'https://news.ycombinator.com/item?id=1', 'https://www.teamblind.com/post/x'])
    assert.equal(skipUrl(u), null, u);
  assert.ok(googleQueries('Chipotle').every((q) => q.startsWith('"Chipotle" ') && q.includes('-site:reddit.com') && q.includes('-site:glassdoor.com')));
});

// A fake Chrome: google.com/search answers with results; every other URL with its page blocks.
const isSearch = (u) => { const x = new URL(u); return x.hostname === 'www.google.com' && x.pathname === '/search'; };
const hostOf = (u) => new URL(u).hostname;
function fakeBrowser({ results = {}, pages = {}, blockedAfter = Infinity }) {
  const opened = []; let current = null; let searches = 0;
  return { opened, browser: {
    open: async (u) => { opened.push(u); current = u; if (isSearch(u)) searches++; },
    eval: async (js) => {
      if (isSearch(current)) {
        if (searches > blockedAfter) return JSON.stringify({ blocked: true });
        assert.equal(js, GOOGLE_RESULTS_JS);
        return JSON.stringify({ blocked: false, results: results[new URL(current).searchParams.get('q')] || [], next: false });
      }
      const p = pages[current];
      return JSON.stringify(p ? { url: current, ...p } : { url: current, title: '', blocks: [] });
    },
  } };
}
const q = (n) => googleQueries('Chipotle')[n];
const noWait = { sleep: async () => {}, jitter: () => 0, searchGapMs: 0, settleMs: 0, pageGapMs: 0 };

test('reads result pages, keeps only first-hand accounts, never opens a skipped host, goal counts NEW reports', async () => {
  const fb = fakeBrowser({
    results: { [q(0)]: [{ url: 'https://forum.example.org/t/1', title: 'Chipotle interview' }, { url: 'https://www.glassdoor.com/Interview/x.htm' }, { url: 'https://www.reddit.com/r/jobs/2' }] },
    pages: { 'https://forum.example.org/t/1': { title: 'Ghosted by Chipotle after interview — Forum', blocks: [
      'I applied to Chipotle in March and they ghosted me after the second interview, no email at all.',
      'Chipotle is hiring everywhere right now, just walk in.',
      'I had an interview at taco bell but they never called back either.',
      'I got a rejection email from Chipotle two days after my interview.',
    ] } },
  });
  const got = [];
  const r = await harvestGoogle('Chipotle', { browser: fb.browser, goal: 0, ...noWait, queries: [q(0)], onAccounts: async (a) => { got.push(...a); return a.length; } });
  assert.equal(r.stoppedBy, 'exhausted');
  assert.deepEqual(got.map((a) => a.outcome), ['ghosted', 'rejected']);
  assert.ok(got.every((a) => a.url === 'https://forum.example.org/t/1' && a.host === 'forum.example.org'));
  assert.equal(fb.opened.filter((u) => ['www.glassdoor.com', 'www.reddit.com'].includes(hostOf(u))).length, 0, 'skipped hosts are never opened');
  assert.equal(r.skipped, 2);
  for (const a of got) assert.equal(classifyApplicantAccount(a.excerpt, { names: ['Chipotle'], title: a.title }).kind, 'applicant_outcome');
});

test('a CAPTCHA stops Google for the rest of the run (shared state), never retried', async () => {
  const fb = fakeBrowser({ results: { [q(0)]: [] }, blockedAfter: 1 });
  const state = { blocked: false, lastSearchAt: 0 };
  const a = await harvestGoogle('Chipotle', { browser: fb.browser, ...noWait, state, queries: [q(0), q(1), q(2)] });
  assert.equal(a.stoppedBy, 'google_blocked');
  assert.equal(state.blocked, true);
  assert.match(a.searchErrors[0], /never solved/);
  const before = fb.opened.length;
  const b = await harvestGoogle('Sheetz', { browser: fb.browser, ...noWait, state });
  assert.equal(b.stoppedBy, 'google_blocked');
  assert.equal(fb.opened.length, before, 'the next company does not touch Google');
});

test('searches keep a human pace across companies; the goal and the time budget stop a company', async () => {
  const waits = []; let t = 1_000_000;
  const fb = fakeBrowser({ results: { [q(0)]: [{ url: 'https://a.example/1' }], [q(1)]: [{ url: 'https://a.example/2' }] },
    pages: { 'https://a.example/1': { title: 'Chipotle', blocks: ['I applied to Chipotle and they ghosted me after the interview, nothing since.'] },
      'https://a.example/2': { title: 'Chipotle', blocks: ['I got a rejection email from Chipotle after my interview last week.'] } } });
  const r = await harvestGoogle('Chipotle', { browser: fb.browser, goal: 1, queries: [q(0), q(1)], searchGapMs: 25_000, jitter: () => 0, settleMs: 0, pageGapMs: 0,
    now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, state: { blocked: false, lastSearchAt: t - 5_000 }, onAccounts: async (a) => a.length });
  assert.equal(r.stoppedBy, 'goal');
  assert.equal(waits[0], 20_000, 'waited out the rest of the 25 s gap from the previous search');
  assert.equal(fb.opened.filter(isSearch).length, 1, 'the goal was met before the second search');
  const timed = await harvestGoogle('Chipotle', { browser: fb.browser, goal: 0, queries: [q(0)], searchGapMs: 25_000, jitter: () => 0, now: () => t, sleep: async () => {}, deadlineAt: t + 1_000, state: { blocked: false, lastSearchAt: t } });
  assert.equal(timed.stoppedBy, 'time', 'it does not start a search it would have to wait past the deadline for');
});
