// End-to-end test for the Reddit harvest handler.
//
// This container's egress policy blocks reddit.com (403 on CONNECT), so the ONE thing this
// cannot prove is whether Reddit answers Vercel's IPs — that is measured by reddit_fetch_log
// on the first real cron run. Everything else is proven here against Reddit's actual response
// envelope: listing → normalize → company detection → tally → the summary's reason field.
//
// The reason field matters most. Two months of this pipeline were lost to a zero that could
// not explain itself, so each distinct zero (blocked / throttled / nothing returned / nothing
// matched) is asserted separately. A zero that lies is worse than a crash.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key';

const { default: handler } = await import('./reddit-harvest.js');

// Reddit's real envelope, trimmed to consumed fields.
const post = (id, title, selftext, extra = {}) => ({
  kind: 't3',
  data: {
    id, name: `t3_${id}`, subreddit: 'recruitinghell', title, selftext,
    author: 'u1', created_utc: 1786700000, score: 10, num_comments: 3,
    permalink: `/r/recruitinghell/comments/${id}/x/`, ...extra,
  },
});
const listing = children => ({ kind: 'Listing', data: { after: null, children } });

const CATALOGUE = [
  { id: 'c1', name: 'Deloitte' },
  { id: 'c2', name: 'American Express' },
  { id: 'c3', name: 'Target' },
];

/** Install a fetch stub that routes by URL. redditStatus drives the Reddit half. */
function stubFetch({ redditBody = null, redditStatus = 200, catalogue = CATALOGUE } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET' });

    if (u.includes('reddit.com')) {
      if (redditStatus !== 200) {
        return { ok: false, status: redditStatus, text: async () => 'blocked', json: async () => ({}) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(redditBody) };
    }
    if (u.includes('/rest/v1/companies')) {
      // Single short page ends pagination.
      return { ok: true, status: 200, json: async () => catalogue };
    }
    // Any Supabase write (only reached when dry=0).
    return { ok: true, status: 201, json: async () => ([]), text: async () => '' };
  };
  return calls;
}

function fakeReq(qs) {
  return { url: `/api/reddit-harvest?${qs}`, headers: { 'x-vercel-cron': '1' } };
}
function fakeRes() {
  const out = {};
  return {
    setHeader() {},
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return out; },
    get result() { return out; },
  };
}

const run = async (qs) => {
  const res = fakeRes();
  await handler(fakeReq(qs), res);
  return res.result;
};

const origFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = origFetch; });

test('harvests a listing and detects the companies named in it', async () => {
  stubFetch({
    redditBody: listing([
      post('a1', 'Ghosted by Deloitte after final round', 'applied in May, recruiter never heard back'),
      post('a2', 'American Express interview process', 'phone screen then onsite, got the offer'),
      post('a3', 'Cat pictures', 'nothing to do with work at all'),
    ]),
  });
  const { code, body } = await run('subs=recruitinghell&dry=1');

  assert.equal(code, 200);
  assert.equal(body.ok, true);
  assert.equal(body.posts_usable, 3);
  assert.equal(body.companies_detected, 2, 'Deloitte + American Express, not the cat post');
  const names = body.top_companies.map(([n]) => n);
  assert.ok(names.includes('Deloitte'));
  assert.ok(names.includes('American Express'));
  assert.equal(body.reason, null, 'a productive run reports no failure reason');
});

test('drops removed/deleted tombstones before they reach the classifier', async () => {
  stubFetch({
    redditBody: listing([
      post('b1', 'Deloitte ghosted me', '[removed]', { removed_by_category: 'moderator' }),
      post('b2', 'Deloitte ghosted me too', 'applied, no response after the interview'),
    ]),
  });
  const { body } = await run('subs=recruitinghell&dry=1');
  assert.equal(body.posts_usable, 1, '[removed] bodies must not be fed to extraction');
});

test('a 403 zero says all_hosts_blocked and names the subs', async () => {
  stubFetch({ redditStatus: 403 });
  const { body } = await run('subs=recruitinghell,jobs&dry=1');

  assert.equal(body.posts_usable, 0);
  assert.equal(body.reason, 'all_hosts_blocked');
  assert.deepEqual(body.blocked_subs.sort(), ['jobs', 'recruitinghell']);
  assert.equal(body.subs_ok, 0);
  // This is the distinction the old pipeline could not make.
  assert.notEqual(body.reason, 'no_posts_returned');
});

test('a 429 zero says rate_limited, not blocked and not empty', async () => {
  stubFetch({ redditStatus: 429 });
  const { body } = await run('subs=recruitinghell&dry=1');
  assert.equal(body.reason, 'rate_limited');
  assert.deepEqual(body.throttled_subs, ['recruitinghell']);
  assert.deepEqual(body.blocked_subs, []);
});

test('an genuinely empty subreddit says no_posts_returned', async () => {
  stubFetch({ redditBody: listing([]) });
  const { body } = await run('subs=recruitinghell&dry=1');
  assert.equal(body.subs_ok, 1, 'the fetch succeeded — this is a real empty, not a failure');
  assert.equal(body.reason, 'no_posts_returned');
});

test('posts that name no tracked company say so explicitly', async () => {
  stubFetch({
    redditBody: listing([
      post('d1', 'Ghosted by SomeCompanyNotInOurCatalogue', 'applied and never heard back from the recruiter'),
    ]),
  });
  const { body } = await run('subs=recruitinghell&dry=1');
  assert.equal(body.posts_usable, 1);
  assert.equal(body.companies_detected, 0);
  assert.equal(body.reason, 'posts_harvested_but_no_tracked_company_named',
    'harvest worked, matching found nothing — a different problem from a failed fetch');
});

test('ambiguous single-word company is not matched from lowercase prose', async () => {
  stubFetch({
    redditBody: listing([
      post('e1', 'Missed my target again', 'the recruiter said my application was still under review'),
    ]),
  });
  const { body } = await run('subs=recruitinghell&dry=1');
  assert.equal(body.companies_detected, 0, '"target" as a noun must not become a Target report');
});

test('dry run performs no writes at all', async () => {
  const calls = stubFetch({ redditBody: listing([post('f1', 'Deloitte ghosted me', 'applied, no response')]) });
  const { body } = await run('subs=recruitinghell&dry=1');
  assert.equal(body.dry_run, true);
  assert.equal(body.raw_stored, 0);
  assert.equal(body.matches_written, 0);
  const writes = calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/'));
  assert.equal(writes.length, 0, 'dry=1 must not touch reddit_raw, reddit_company_match or the fetch log');
});

test('a non-dry run persists raw posts and matches', async () => {
  const calls = stubFetch({ redditBody: listing([post('g1', 'Deloitte ghosted me', 'applied, no response')]) });
  const { body } = await run('subs=recruitinghell');
  assert.equal(body.raw_stored, 1);
  assert.equal(body.matches_written, 1);
  assert.ok(calls.some(c => c.url.includes('reddit_raw')), 'raw corpus is written before interpretation');
  assert.ok(calls.some(c => c.url.includes('reddit_company_match')));
  assert.ok(calls.some(c => c.url.includes('reddit_fetch_log')), 'every fetch is logged with its status');
});

test('unauthorized callers are refused', async () => {
  stubFetch({ redditBody: listing([]) });
  const res = fakeRes();
  await handler({ url: '/api/reddit-harvest?dry=1', headers: {} }, res);
  assert.equal(res.result.code, 401);
});
