// Tests for the live per-company Reddit search helpers.
// Run: node --test api/_utils/companyReddit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCompanyKey, isSearchableCompany, parseRedditSearchAtom, isRelevant,
  scoreRelevance, rankAndFilter, buildSearchUrl, ttlForStatus, cacheFresh,
  emptyStateDecision, needsBroadFallback, sanitizeDispute, isCareerSubreddit, hasJobContext,
  employerUsage, showableItems, refilterCached, MIN_SHOW_THREADS, ITEM_RULES_VERSION,
  TTL_OK_MS, TTL_EMPTY_MS, MAX_ITEMS, namedAsEmployer, isNewsThread, firstHandApplicantThread,
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
  assert.equal(namedAsEmployer({ title: 'Apple hiring freeze', _body: '' }, 'Apple'), true);
  assert.equal(namedAsEmployer({ title: 'I love pineapple', _body: '' }, 'Apple'), false);
  assert.equal(namedAsEmployer({ title: 'nothing here', _body: 'Apple rejected me' }, 'Apple'), true);
  // short name: whole-word only ("HP" not inside "help")
  assert.equal(namedAsEmployer({ title: 'HP laid off my team', _body: '' }, 'HP'), true);
  assert.equal(namedAsEmployer({ title: 'please help me', _body: '' }, 'HP'), false);
});

test('isRelevant accepts a distinctive first token for multi-word companies', () => {
  assert.equal(namedAsEmployer({ title: 'Globex interview was brutal', _body: '' }, 'Globex Corporation'), true);
  // short first token is NOT enough on its own (collision risk)
  assert.equal(namedAsEmployer({ title: 'the cat sat', _body: '' }, 'Ca Technologies'), false);
});

test('isRelevant gates out common-word brand collisions lacking employment context', () => {
  // The exact live-dry-run failure: "Amazon" product/shopping threads must be dropped —
  // company is named, but no career sub + no job context.
  assert.equal(namedAsEmployer({ title: 'Amazon Pokémon Restock | Mega Evolution', _body: 'in stock now', subreddit: 'PokemonDropNotify' }, 'Amazon'), false);
  assert.equal(namedAsEmployer({ title: 'RTX 4060 laptop for $212 on Amazon?', _body: 'great deal', subreddit: 'primedropper' }, 'Amazon'), false);
  // A real "working at Amazon" thread survives — job context present.
  assert.equal(namedAsEmployer({ title: 'Does the Amazon fulfillment center offer healthcare benefits?', _body: '', subreddit: 'Louisville' }, 'Amazon'), true);
});

test('isRelevant keeps career-subreddit threads even without a keyword in the title', () => {
  assert.equal(namedAsEmployer({ title: 'My experience with Acme', _body: 'it was a long process', subreddit: 'recruitinghell' }, 'Acme'), true);
  // same title outside a career sub, no job context → dropped
  assert.equal(namedAsEmployer({ title: 'My experience with Acme', _body: 'bought a widget', subreddit: 'gadgets' }, 'Acme'), false);
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
  assert.equal(namedAsEmployer({ title: '[OFFER] $100 Amazon gift card', _body: '', subreddit: 'Assistance' }, 'Amazon'), false);
  // a real "Amazon SDE offer" survives via its interview/career subreddit
  assert.equal(namedAsEmployer({ title: 'Amazon SDE offer', _body: '', subreddit: 'leetcodedesi' }, 'Amazon'), true);
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
    { id: '3', permalink: 'https://reddit.com/r/z/comments/3/c/', title: 'thoughts on Acme?', _body: 'I applied to Acme in May; they ghosted me after the interview.', created: '2026-06-01T00:00:00Z', subreddit: 'z' },
    { id: '4', permalink: 'https://reddit.com/r/z/comments/4/d/', title: 'thoughts on Acme?', _body: 'the interview went well for my friend', created: '2026-06-01T00:00:00Z', subreddit: 'z' },
  ];
  const out = rankAndFilter(items, 'Acme');
  assert.equal(out.length, 2);                       // dup collapsed, pineapple dropped, second-hand "my friend" dropped
  assert.equal(out[0].id, '1');                      // ghosted+interview+recent ranks first
  assert.ok(!('_body' in out[0]));                   // internal field never leaks
});

test('rankAndFilter respects the cap', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    id: String(i), permalink: `https://reddit.com/r/x/comments/${i}/a/`,
    title: `Acme ghosted me after the interview, round ${i}`, _body: '', created: '2026-07-01T00:00:00Z', subreddit: 'x',
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
  // Anchored to the host, not a bare substring — CodeQL's missing-regexp-anchor rule (and a
  // stricter assertion): reddit.com must be the actual host, not "evil.com/reddit.com".
  assert.match(r.row.permalink, /^https:\/\/(www\.|old\.)?reddit\.com\//);
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

// ── Hiring-context relevance (audit 2026-10-23: /company/target showed hockey, TikTok and war news) ──
// Every NO title below is the real cached thread that was on the page.
test('a common-word brand used as an ordinary word is never a hiring thread', () => {
  assert.equal(namedAsEmployer({ title: 'Jets rejected trade offer from team Connor Hellebuyck wanted to play for — Read more: Connor Hellebuyck was the first target', subreddit: 'hockeynews' }, 'Target'), false);
  assert.equal(namedAsEmployer({ title: 'In London, an east Asian couple participating in a harmless street interview suddenly became the target of a public humiliation', subreddit: 'TikTokCringe' }, 'Target'), false);
  assert.equal(namedAsEmployer({ title: 'Zelenskyy is right — Russia uses satellites to help Iran target US forces', _body: 'strikes landed 1 hr later, the recruiter of militias said', subreddit: 'UkrainianConflict' }, 'Target'), false);
  // r/jobsearchhacks is a career sub, and "target salary" still is not the employer.
  assert.equal(namedAsEmployer({ title: 'Stop giving recruiters your target salary on phone screens. Use this exact phrase instead.', subreddit: 'jobsearchhacks' }, 'Target'), false);
  assert.equal(namedAsEmployer({ title: 'Mind the gap — London tube etiquette', subreddit: 'london' }, 'Gap'), false);
  assert.equal(namedAsEmployer({ title: 'Best apple pie recipe? I applied the glaze twice', subreddit: 'Baking' }, 'Apple'), false);
});

test('the same brands count when used as the employer in a hiring sentence', () => {
  assert.equal(namedAsEmployer({ title: 'Applied to Target, interviewed, then ghosted', subreddit: 'recruitinghell' }, 'Target'), true);
  assert.equal(namedAsEmployer({ title: 'target ghosted me after my interview', subreddit: 'jobs' }, 'Target'), true);
  assert.equal(namedAsEmployer({ title: "Target's hiring process for seasonal — how long after the interview?", subreddit: 'AskReddit' }, 'Target'), true);
  assert.equal(namedAsEmployer({ title: 'Got an offer from Gap as a sales associate', subreddit: 'jobs' }, 'Gap'), true);
  // The company's own subreddit is the context even when the name is not repeated.
  assert.equal(namedAsEmployer({ title: 'Interview tomorrow at the DC, any tips?', subreddit: 'Target' }, 'Target'), true);
  assert.equal(namedAsEmployer({ title: 'Is the new store policy annoying anyone else?', subreddit: 'Target' }, 'Target'), false);
});

test('a hiring word in a different sentence from the name does not make a thread about hiring', () => {
  assert.equal(namedAsEmployer({ title: 'Walmart restock: PS5 back in stock', _body: 'in stock now at my local store', subreddit: 'PS5' }, 'Walmart'), false);
  // …but a thread titled after the company whose post is about hiring is about hiring there.
  assert.equal(namedAsEmployer({ title: 'thoughts on Walmart?', _body: 'the interview went well but no word since', subreddit: 'z' }, 'Walmart'), true);
  assert.equal(namedAsEmployer({ title: 'Ghosted by Walmart after 4 interview rounds', subreddit: 'recruitinghell' }, 'Walmart'), true);
  // "1 hr" is not human resources.
  assert.equal(namedAsEmployer({ title: 'Walmart checkout took 1 hr today', subreddit: 'mildlyinfuriating' }, 'Walmart'), false);
});

test('employerUsage: preposition before, employer noun after, or a mid-sentence proper noun', () => {
  assert.equal(employerUsage('I applied at target last week', 'Target'), true);
  assert.equal(employerUsage("Target's recruiter never called", 'Target'), true);
  assert.equal(employerUsage('After the screen, Target went silent', 'Target'), true);
  assert.equal(employerUsage('became the target of a public humiliation', 'Target'), false);
  assert.equal(employerUsage('Jets Rejected Trade Offer From The Team Target Wanted', 'Target'), false); // headline case
  assert.equal(employerUsage('your target salary', 'Target'), false);
});

test('showableItems hides a lone thread; refilterCached re-judges items stored under the old rule', () => {
  const one = [{ id: '1', title: 'Target ghosted me after the interview', subreddit: 'jobs', permalink: 'https://www.reddit.com/r/jobs/comments/1/a/' }];
  assert.deepEqual(showableItems(one), []);
  assert.equal(showableItems([...one, { ...one[0], id: '2' }]).length, 2);
  assert.equal(MIN_SHOW_THREADS, 2);
  const cached = [
    { id: 'a', title: 'Jets rejected trade offer — Connor Hellebuyck was the first target', subreddit: 'hockeynews' },
    { id: 'b', title: 'Target ghosted me after my interview', subreddit: 'jobs' },
    { id: 'c', title: 'anything at all', subreddit: 'x', v: ITEM_RULES_VERSION },
  ];
  assert.deepEqual(refilterCached(cached, 'Target').map((i) => i.id), ['b', 'c']);
  // rankAndFilter stamps the rule version so the next read trusts the row.
  const ranked = rankAndFilter([{ id: '1', permalink: 'https://www.reddit.com/r/jobs/comments/1/a/', title: 'Target ghosted me after my interview', subreddit: 'jobs', _body: '' }], 'Target');
  assert.equal(ranked[0].v, ITEM_RULES_VERSION);
});

// ── First-hand gate (owner 2026-10-24: a thread shows only when the poster gives a first-hand applicant
// account under the strict rules; news about the company never shows). Every NO below was on seenjobs.io.
test('threads that are news about the company, or not the poster’s own applicant account, are never shown', () => {
  // /company/walmart (2026-10-24): 2 of 5 "Reddit discussion" threads were not applicant experiences.
  assert.equal(isRelevant({ title: 'HEB hires exec that was fired from Walmart for taking H1B kickbacks', _body: '', subreddit: 'walmart' }, 'Walmart'), false);
  assert.equal(isNewsThread({ title: 'HEB hires exec that was fired from Walmart for taking H1B kickbacks' }), true);
  assert.equal(isRelevant({ title: 'If I hired on at Walmart and spent my entire shift hiding in the bathroom, how long until I got fired?', _body: 'asking for a friend', subreddit: 'walmart' }, 'Walmart'), false);
  // /company/amazon: 3 of 6 threads were recruiter layoffs and RTO news.
  assert.equal(isRelevant({ title: 'Amazon lays off hundreds of recruiters as hiring slows', _body: 'The company confirmed the layoffs on Tuesday.', subreddit: 'recruitinghell' }, 'Amazon'), false);
  assert.equal(isRelevant({ title: 'Amazon RTO: 5 days in office starting January', _body: 'Andy Jassy announced the return to office mandate.', subreddit: 'cscareerquestions' }, 'Amazon'), false);
  assert.equal(isRelevant({ title: 'Amazon recruiter layoffs — what it means for interviews', _body: '', subreddit: 'leetcode' }, 'Amazon'), false);
  // Questions and advice are discussion, not an account; a reply about someone else is not the poster's.
  assert.equal(isRelevant({ title: 'Walmart interview tomorrow at the DC, any tips?', _body: '', subreddit: 'walmart' }, 'Walmart'), false);
  assert.equal(isRelevant({ title: 'Does Walmart hire felons?', _body: 'Based off your post history, you’re a rehire. If you were hired previously with that record, I don’t see it being an issue this time.', subreddit: 'walmart' }, 'Walmart'), false);
  // A link or bot notice in the opening post disqualifies it.
  assert.equal(firstHandApplicantThread({ title: 'Walmart hired me', _body: 'Walmart hired me last week, full write-up at https://example.com/blog', subreddit: 'jobs' }, 'Walmart'), false);
});

test('first-hand applicant accounts show: the opening post judged with its title, or a first-person title', () => {
  assert.equal(isRelevant({ title: 'Ghosted by Walmart after 4 interview rounds', _body: '', subreddit: 'recruitinghell' }, 'Walmart'), true);
  assert.equal(isRelevant({ title: 'thoughts on Walmart?', _body: 'I applied to Walmart last week and they ghosted me after the interview.', subreddit: 'z' }, 'Walmart'), true);
  assert.equal(isRelevant({ title: 'Got an offer from Gap as a sales associate', _body: '', subreddit: 'jobs' }, 'Gap'), true);
  assert.equal(isRelevant({ title: 'target ghosted me after my interview', _body: '', subreddit: 'jobs' }, 'Target'), true);
  // In the company's own subreddit the company is the context even when the post does not repeat it.
  assert.equal(isRelevant({ title: 'Finally heard back', _body: 'I applied for the overnight stocker position and just got hired, orientation Monday!', subreddit: 'walmart' }, 'Walmart'), true);
  assert.equal(firstHandApplicantThread({ title: 'Walmart interview tomorrow at the DC, any tips?', _body: '', subreddit: 'walmart' }, 'Walmart'), false);
  // Cached rows (title + subreddit only) written under rule 2 are re-judged under rule 3.
  assert.equal(ITEM_RULES_VERSION, 3);
  const cached = [
    { id: 'a', title: 'HEB hires exec that was fired from Walmart for taking H1B kickbacks', subreddit: 'walmart', v: 2 },
    { id: 'b', title: 'Ghosted by Walmart after 4 interview rounds', subreddit: 'recruitinghell', v: 2 },
  ];
  assert.deepEqual(refilterCached(cached, 'Walmart').map((i) => i.id), ['b']);
});
