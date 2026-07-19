// Tests for the live per-company Reddit search helpers.
// Run: node --test api/_utils/companyReddit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCompanyKey, isSearchableCompany, parseRedditSearchAtom, isRelevant,
  scoreRelevance, rankAndFilter, buildSearchUrl, ttlForStatus, cacheFresh,
  emptyStateDecision, needsBroadFallback, sanitizeDispute, isCareerSubreddit, hasJobContext,
  TTL_OK_MS, TTL_EMPTY_MS, MAX_ITEMS,
} from './companyReddit.js';

// A minimal but realistic Reddit search Atom feed (two thread entries + one non-thread
// link that must be skipped).
const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <author><name>/u/throwaway_dev</name></author>
    <category term="recruitinghell" label="r/recruitinghell"/>
    <title>Ghosted by Acme after 4 interview rounds</title>
    <link href="https://www.reddit.com/r/recruitinghell/comments/abc123/ghosted_by_acme/"/>
    <updated>2026-07-10T12:00:00+00:00</updated>
    <content type="html">&lt;p&gt;Applied to Acme, did four rounds, then total silence. Recruiter stopped replying.&lt;/p&gt;</content>
  </entry>
  <entry>
    <author><name>/u/someone</name></author>
    <category term="cscareerquestions" label="r/cscareerquestions"/>
    <title>Is Acme a good place to work?</title>
    <link href="https://www.reddit.com/r/cscareerquestions/comments/def456/is_acme_good/"/>
    <updated>2026-01-02T08:30:00+00:00</updated>
    <content type="html">&lt;p&gt;Thinking about an offer from Acme. Thoughts on the culture?&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>r/recruitinghell</title>
    <link href="https://www.reddit.com/r/recruitinghell/"/>
  </entry>
</feed>`;

// ── normalization / validation ──────────────────────────────────────────────────

test('normalizeCompanyKey lowercases, trims, strips legal suffix + collapses space', () => {
  assert.equal(normalizeCompanyKey('  Acme,  Inc. '), 'acme');
  assert.equal(normalizeCompanyKey('Foo Bar LLC'), 'foo bar');
  assert.equal(normalizeCompanyKey('Globex Technologies'), 'globex');
  assert.equal(normalizeCompanyKey(''), '');
  assert.equal(normalizeCompanyKey(null), '');
});

test('isSearchableCompany rejects placeholders, junk + too-short/long', () => {
  assert.equal(isSearchableCompany('Acme'), true);
  assert.equal(isSearchableCompany('a'), false);          // too short
  assert.equal(isSearchableCompany('123'), false);        // no letters
  assert.equal(isSearchableCompany('#42'), false);        // hash id
  assert.equal(isSearchableCompany('unknown'), false);    // placeholder
  assert.equal(isSearchableCompany('N/A'), false);
  assert.equal(isSearchableCompany('x'.repeat(200)), false);
  assert.equal(isSearchableCompany(''), false);
  assert.equal(isSearchableCompany(null), false);
});

// ── Atom parsing ─────────────────────────────────────────────────────────────────

test('parseRedditSearchAtom extracts attributed thread items + skips non-threads', () => {
  const items = parseRedditSearchAtom(SAMPLE_FEED);
  assert.equal(items.length, 2); // the bare-subreddit link (no /comments/) is dropped
  const a = items[0];
  assert.equal(a.id, 'abc123');
  assert.equal(a.title, 'Ghosted by Acme after 4 interview rounds');
  assert.equal(a.subreddit, 'recruitinghell');
  assert.equal(a.permalink, 'https://www.reddit.com/r/recruitinghell/comments/abc123/ghosted_by_acme/');
  assert.equal(a.author, 'throwaway_dev');           // /u/ prefix stripped
  assert.equal(a.created, '2026-07-10T12:00:00.000Z');
  assert.match(a._body, /four rounds/);              // html stripped, entities decoded
});

test('parseRedditSearchAtom is total on junk input', () => {
  assert.deepEqual(parseRedditSearchAtom(''), []);
  assert.deepEqual(parseRedditSearchAtom(null), []);
  assert.deepEqual(parseRedditSearchAtom('<feed></feed>'), []);
});

// ── relevance ────────────────────────────────────────────────────────────────────

test('isRelevant matches company as a WORD, resisting substring collisions', () => {
  assert.equal(isRelevant({ title: 'Apple hiring freeze', _body: '' }, 'Apple'), true);
  assert.equal(isRelevant({ title: 'I love pineapple', _body: '' }, 'Apple'), false);
  assert.equal(isRelevant({ title: 'nothing here', _body: 'Apple rejected me' }, 'Apple'), true);
  // short name: whole-word only ("HP" not inside "help")
  assert.equal(isRelevant({ title: 'HP laid off my team', _body: '' }, 'HP'), true);
  assert.equal(isRelevant({ title: 'please help me', _body: '' }, 'HP'), false);
});

test('isRelevant accepts a distinctive first token for multi-word companies', () => {
  assert.equal(isRelevant({ title: 'Globex interview was brutal', _body: '' }, 'Globex Corporation'), true);
  // short first token is NOT enough on its own (collision risk)
  assert.equal(isRelevant({ title: 'the cat sat', _body: '' }, 'Ca Technologies'), false);
});

test('isRelevant gates out common-word brand collisions lacking employment context', () => {
  // The exact live-dry-run failure: "Amazon" product/shopping threads must be dropped —
  // company is named, but no career sub + no job context.
  assert.equal(isRelevant({ title: 'Amazon Pokémon Restock | Mega Evolution', _body: 'in stock now', subreddit: 'PokemonDropNotify' }, 'Amazon'), false);
  assert.equal(isRelevant({ title: 'RTX 4060 laptop for $212 on Amazon?', _body: 'great deal', subreddit: 'primedropper' }, 'Amazon'), false);
  // A real "working at Amazon" thread survives — job context present.
  assert.equal(isRelevant({ title: 'Does the Amazon fulfillment center offer healthcare benefits?', _body: '', subreddit: 'Louisville' }, 'Amazon'), true);
});

test('isRelevant keeps career-subreddit threads even without a keyword in the title', () => {
  assert.equal(isRelevant({ title: 'My experience with Acme', _body: 'it was a long process', subreddit: 'recruitinghell' }, 'Acme'), true);
  // same title outside a career sub, no job context → dropped
  assert.equal(isRelevant({ title: 'My experience with Acme', _body: 'bought a widget', subreddit: 'gadgets' }, 'Acme'), false);
});

test('isCareerSubreddit recognizes work/career subs, case- + prefix-insensitive', () => {
  assert.equal(isCareerSubreddit('recruitinghell'), true);
  assert.equal(isCareerSubreddit('r/CScareerQuestions'), true);
  assert.equal(isCareerSubreddit('PokemonDropNotify'), false);
  assert.equal(isCareerSubreddit(''), false);
});

test('hasJobContext detects employment keywords as words', () => {
  assert.equal(hasJobContext({ title: 'ghosted after the interview', _body: '' }), true);
  assert.equal(hasJobContext({ title: 'laid off after 3 years', _body: '' }), true);
  assert.equal(hasJobContext({ title: 'pokemon restock', _body: 'in stock' }), false);
  // ambiguous words are NOT enough on their own (they collide with shopping/product)
  assert.equal(hasJobContext({ title: 'gift card offer', _body: '' }), false);
  assert.equal(hasJobContext({ title: 'apply this coupon', _body: '' }), false);
});

test('isRelevant drops "offer"-only brand collisions but keeps career-sub offer posts', () => {
  // gift-card "OFFER" naming Amazon, non-career sub → dropped
  assert.equal(isRelevant({ title: '[OFFER] $100 Amazon gift card', _body: '', subreddit: 'Assistance' }, 'Amazon'), false);
  // a real "Amazon SDE offer" survives via its interview/career subreddit
  assert.equal(isRelevant({ title: 'Amazon SDE offer', _body: '', subreddit: 'leetcodedesi' }, 'Amazon'), true);
});

test('scoreRelevance floats title + job-context + recent threads to the top', () => {
  const recentTitleCtx = { title: 'Acme ghosted me', _body: 'recruiter went silent', created: new Date().toISOString() };
  const oldBodyOnly = { title: 'random thread', _body: 'someone mentioned acme once', created: '2019-01-01T00:00:00Z' };
  assert.ok(scoreRelevance(recentTitleCtx, 'Acme') > scoreRelevance(oldBodyOnly, 'Acme'));
});

test('rankAndFilter dedupes, drops irrelevant, ranks + caps, strips _body', () => {
  const items = [
    { id: '1', permalink: 'https://reddit.com/r/x/comments/1/a/', title: 'Acme ghosted me after interview', _body: 'recruiter', created: '2026-07-01T00:00:00Z', subreddit: 'x' },
    { id: '1dup', permalink: 'https://reddit.com/r/x/comments/1/a/', title: 'dup link', _body: 'acme', created: '2026-07-01T00:00:00Z', subreddit: 'x' },
    { id: '2', permalink: 'https://reddit.com/r/y/comments/2/b/', title: 'pineapple smoothie recipe', _body: 'yum', created: '2026-07-02T00:00:00Z', subreddit: 'y' },
    { id: '3', permalink: 'https://reddit.com/r/z/comments/3/c/', title: 'thoughts on Acme?', _body: 'the interview went well', created: '2026-06-01T00:00:00Z', subreddit: 'z' },
  ];
  const out = rankAndFilter(items, 'Acme');
  assert.equal(out.length, 2);                       // dup collapsed, pineapple dropped
  assert.equal(out[0].id, '1');                      // ghosted+interview+recent ranks first
  assert.ok(!('_body' in out[0]));                   // internal field never leaks
});

test('rankAndFilter respects the cap', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    id: String(i), permalink: `https://reddit.com/r/x/comments/${i}/a/`,
    title: `Acme thread ${i} interview`, _body: '', created: '2026-07-01T00:00:00Z', subreddit: 'x',
  }));
  assert.equal(rankAndFilter(many, 'Acme').length, MAX_ITEMS);
  assert.equal(rankAndFilter(many, 'Acme', 3).length, 3);
});

// ── query building ───────────────────────────────────────────────────────────────

test('buildSearchUrl biases with job-context by default, broadens on fallback', () => {
  const biased = buildSearchUrl('Acme');
  // URLSearchParams encodes spaces as '+' — normalize before matching the query text.
  const biasedQ = decodeURIComponent(biased.replace(/\+/g, ' '));
  assert.match(biased, /search\/\.rss\?/);
  assert.match(biasedQ, /"Acme" \(hiring OR/);
  assert.match(biased, /sort=relevance/);
  assert.match(biased, /t=year/);                 // biased pass is bounded to the past year
  const broad = buildSearchUrl('Acme', { broad: true });
  assert.match(decodeURIComponent(broad.replace(/\+/g, ' ')), /q="Acme"&/);
  assert.match(broad, /sort=relevance/);
  assert.doesNotMatch(broad, /t=year/);           // broad fallback spans all time (max fill)
});

test('buildSearchUrl strips quotes/backslashes from the name (no query breakout)', () => {
  const url = buildSearchUrl('Ac"me\\');
  assert.doesNotMatch(decodeURIComponent(url), /Ac"me\\/);
});

// ── cache TTL + empty-state ────────────────────────────────────────────────────────

test('ttlForStatus: ok gets the long TTL, empty the short one', () => {
  assert.equal(ttlForStatus('ok'), TTL_OK_MS);
  assert.equal(ttlForStatus('empty'), TTL_EMPTY_MS);
  assert.ok(TTL_EMPTY_MS < TTL_OK_MS);
});

test('cacheFresh honors expires_at, then fetched_at + TTL, else stale', () => {
  const now = Date.now();
  assert.equal(cacheFresh({ expires_at: new Date(now + 1000).toISOString() }, now), true);
  assert.equal(cacheFresh({ expires_at: new Date(now - 1000).toISOString() }, now), false);
  assert.equal(cacheFresh({ status: 'ok', fetched_at: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(cacheFresh({ status: 'ok', fetched_at: new Date(now - TTL_OK_MS - 1000).toISOString() }, now), false);
  assert.equal(cacheFresh({ status: 'empty', fetched_at: new Date(now - TTL_EMPTY_MS - 1000).toISOString() }, now), false);
  assert.equal(cacheFresh(null, now), false);
  assert.equal(cacheFresh({}, now), false);
});

test('emptyStateDecision: items → ok, none → empty', () => {
  assert.equal(emptyStateDecision([{ id: '1' }]), 'ok');
  assert.equal(emptyStateDecision([]), 'empty');
  assert.equal(emptyStateDecision(null), 'empty');
});

test('needsBroadFallback trips only below the minimum', () => {
  assert.equal(needsBroadFallback(0), true);
  assert.equal(needsBroadFallback(2), true);
  assert.equal(needsBroadFallback(3), false);
  assert.equal(needsBroadFallback(10), false);
});

// ── dispute shaping ──────────────────────────────────────────────────────────────

test('sanitizeDispute accepts a good-faith correction + derives the key', () => {
  const r = sanitizeDispute({
    company: 'Acme, Inc.', reason: 'not_us',
    detail: 'These threads are about a different Acme in another industry.',
    permalink: 'https://www.reddit.com/r/jobs/comments/abc/def/', contact: 'me@example.com',
  });
  assert.equal(r.valid, true);
  assert.equal(r.row.company_key, 'acme');
  assert.equal(r.row.reason, 'not_us');
  assert.equal(r.row.status, 'open');
  assert.equal(r.row.contact, 'me@example.com');
  assert.match(r.row.permalink, /reddit\.com/);
});

test('sanitizeDispute rejects bad reason, junk company + too-short detail', () => {
  assert.equal(sanitizeDispute({ company: 'Acme', reason: 'spam', detail: 'long enough detail here' }).valid, false);
  assert.equal(sanitizeDispute({ company: 'unknown', reason: 'other', detail: 'long enough detail here' }).valid, false);
  assert.equal(sanitizeDispute({ company: 'Acme', reason: 'other', detail: 'short' }).valid, false);
});

test('sanitizeDispute drops a non-reddit permalink + a malformed email, keeps the row', () => {
  const r = sanitizeDispute({
    company: 'Acme', reason: 'outdated',
    detail: 'This information is from years ago and no longer accurate.',
    permalink: 'https://evil.example.com/x', contact: 'not-an-email',
  });
  assert.equal(r.valid, true);
  assert.equal(r.row.permalink, null);
  assert.equal(r.row.contact, null);
});
