// Run: node --test components/company/answers.test.mjs
// The three company-page answers on score rows and report rows shaped like production's (read-only probe
// 2026-11-17: Walmart 48 scorable resolved rows, Amazon 26, SpaceX 16, Chipotle 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanyAnswers, answersFaq, outcomeBreakdown, companyIndexDecision, listingFactsSentence } from './answers.js';

const rowsOf = (spec) => Object.entries(spec).flatMap(([key, n]) => {
  const [outcome, platform = 'Reddit r/jobs', extra = {}] = Array.isArray(key) ? key : key.split('|');
  return Array.from({ length: n }, () => ({ outcome, platform, trust_reason: null, needs_review: false, ...(typeof extra === 'object' ? extra : {}) }));
});

const WALMART_SCORE = {
  company_name: 'walmart', gradeable: true, overall_score: 91, response_rate: 0.866071, ghost_rate: 0.133929,
  avg_wait_days: null, avg_rounds: null, report_count: 48, first_party_report_count: 48, mention_count: 32,
  web_report_count: 0, data_source: 'reports', data_quality: 'high', updated_at: '2026-11-12T18:00:00.000Z',
};
// 48 rows: hired 6, ghosted 10, offer 17, interview 6, rejected 5, human 4 (21 Reddit, 27 public review pages).
const WALMART_ROWS = [
  ...rowsOf({ 'hired|Reddit r/walmart': 6, 'ghosted|Reddit r/walmart': 10, 'offer|Reddit r/walmart': 5 }),
  ...rowsOf({ 'offer|Public review · indeed.com': 12, 'interview|Public review · indeed.com': 6, 'rejected|Public review · indeed.com': 5, 'human|Public review · indeed.com': 4 }),
].map((r, i) => ({ ...r, role: i < 5 ? 'Store Associate' : i < 7 ? 'Software Engineer' : null }));

const AMAZON_SCORE = {
  company_name: 'amazon', gradeable: true, overall_score: 65, response_rate: 0.618182, ghost_rate: 0.254545,
  avg_wait_days: 30, avg_rounds: 1.9, first_party_report_count: 26, report_count: 26, mention_count: 33,
  web_report_count: 0, data_source: 'reports', data_quality: 'high', updated_at: '2026-11-10T08:00:00.000Z',
};
const AMAZON_ROWS = [
  ...Array.from({ length: 9 }, (_, i) => ({ outcome: 'ghosted', platform: 'Reddit r/amazon', ghost_stage: i < 4 ? 'Assessment' : i < 6 ? 'Post Loop' : 'General', wait_days: i < 6 ? 30 : null })),
  ...Array.from({ length: 7 }, (_, i) => ({ outcome: 'autoreject', platform: 'Reddit r/amazon', wait_days: i < 4 ? 20 : null, rounds: i < 3 ? 1 : null })),
  { outcome: 'interview', platform: 'Reddit r/amazon', rounds: 3, wait_days: 40 },
  { outcome: 'offer', platform: 'Reddit r/amazon', rounds: 4, wait_days: 35 },
  { outcome: 'offer', platform: 'Public review · blind.com', rounds: 2 },
  ...Array.from({ length: 3 }, () => ({ outcome: 'hired', platform: 'Public review · indeed.com', rounds: 2, wait_days: 25 })),
  ...Array.from({ length: 3 }, () => ({ outcome: 'human', platform: 'Reddit r/amazon', rounds: 1 })),
  { outcome: 'human', platform: 'Seen', trust_reason: 'direct_submission', rounds: 2 },
];

// Every number in a string, so a test can say "nothing the inputs do not hold".
const numbers = (s) => [...String(s).matchAll(/\d[\d,.]*/g)].map((m) => Number(m[0].replace(/,/g, '').replace(/\.$/, '')));

test('thick data (Walmart-like): counts, rate and confidence, one denominator', () => {
  const b = buildCompanyAnswers({ name: 'Walmart', score: WALMART_SCORE, rows: WALMART_ROWS, listing: null });
  assert.equal(b.accounts, 48);
  assert.equal(b.breakdown.total, 48);
  assert.equal(b.breakdown.heardBack, 38);
  assert.equal(b.breakdown.ghosted, 10);
  const [r, w, who] = b.answers;
  assert.equal(r.question, 'Does Walmart respond to applicants?');
  assert.equal(r.sentence, 'Mostly yes: 38 of 48 applicant accounts on Seen say Walmart got back to them, and 10 say they never heard back.');
  assert.match(r.detail, /Seen's response rate for Walmart is 87%\. It weighs each account by its source and also counts 32 online mentions at half weight\./);
  // capDisplayConfidence: no Seen-user reports among the 48 → never "High".
  assert.match(r.detail, /Moderate confidence, updated Nov 12, 2026\./);
  assert.ok(!/High confidence/.test(r.detail));
  // No wait in any row and no stored average: not known, never invented.
  assert.equal(w.known, false);
  assert.match(w.sentence, /^Not known yet: none of the 48 applicant accounts for Walmart say how long the reply took\.$/);
  // Who hears back: the parts add up to the same 48.
  assert.equal(who.sentence, 'Of 48 applicant accounts on Seen, 23 got an offer, 10 interviewed or heard from a person, 5 were rejected and 10 never heard back.');
  assert.equal(23 + 10 + 5 + 10, 48);
  assert.match(who.detail, /By source: all 48 come from public posts\./);
  assert.match(who.detail, /32 online mentions are also on file; they are not applicant accounts\./);
  assert.match(who.detail, /By role: Store Associate, 5 of 5 heard back\./);
});

test('every "N applicant accounts" on the page is the header count (first_party_report_count)', () => {
  for (const [score, rows] of [[WALMART_SCORE, WALMART_ROWS], [AMAZON_SCORE, AMAZON_ROWS]]) {
    const b = buildCompanyAnswers({ name: 'X', score, rows });
    const all = b.answers.map((a) => `${a.sentence} ${a.detail}`).join(' ');
    for (const m of all.matchAll(/(\d+) applicant accounts?/g)) assert.equal(Number(m[1]), score.first_party_report_count, all);
    for (const m of all.matchAll(/of (\d+) applicant accounts?/g)) assert.equal(Number(m[1]), score.first_party_report_count);
  }
});

test('Amazon-like: automated rejections are their own count, the wait and rounds name their basis, stage is named', () => {
  const b = buildCompanyAnswers({ name: 'Amazon', score: AMAZON_SCORE, rows: AMAZON_ROWS });
  const [r, w, who] = b.answers;
  // Raw share 10/26 is "few"; the stored, mention-weighted 62% is "mixed" → no verdict word at all.
  assert.equal(r.sentence, '10 of 26 applicant accounts on Seen say Amazon got back to them, 7 got only an automated rejection and 9 say they never heard back.');
  assert.match(r.detail, /62%.*automated rejections count as neither/);
  assert.match(r.detail, /Moderate confidence/); // 1 Seen-user report < 5
  assert.equal(w.known, true);
  assert.match(w.sentence, /waited about 30 days on average to hear back/);
  assert.match(w.detail, /From 15 of 26 applicant accounts that named a wait, weighed by source\./);
  assert.match(w.sentence, /about 1\.9 rounds/);
  assert.match(w.sentence, /lost contact at the assessment stage/);
  assert.match(w.detail, /4 of the 6 ghosted accounts that named a stage say so \(9 ghosted accounts in all\)/);
  assert.match(who.sentence, /^Of 26 applicant accounts on Seen, 5 got an offer, 5 interviewed or heard from a person, 7 got only an automated rejection and 9 never heard back\.$/);
  // The sentence is the rows: offer 2 + hired 3, interview 1 + human 4, every part adds up to 26.
  const bd = outcomeBreakdown(AMAZON_ROWS);
  assert.equal(bd.offer + bd.interview + bd.rejected + bd.autoRejected + bd.ghosted + bd.otherResponse + bd.otherOutcome, 26);
  assert.match(who.detail, /25 from public posts and 1 submitted to Seen by applicants/);
  assert.match(who.detail, /Not enough reports by role yet\./);
});

test('thin (graded on mentions, 2 accounts): counts stated, no percentage, says why', () => {
  const score = { gradeable: true, overall_score: 74, response_rate: 0.8, ghost_rate: 0.2, avg_wait_days: 3, first_party_report_count: 2, mention_count: 6, data_source: 'reports', data_quality: 'low', updated_at: '2026-11-01T00:00:00Z' };
  const rows = [{ outcome: 'hired', platform: 'Seen intel survey', wait_days: 3 }, { outcome: 'offer', platform: 'Public review · indeed.com' }];
  const b = buildCompanyAnswers({ name: 'Chipotle', score, rows });
  const [r, w] = b.answers;
  assert.equal(r.sentence, 'Too few accounts to say yet: 2 of 2 applicant accounts on Seen say Chipotle got back to them, and 0 say they never heard back.');
  assert.ok(!/%/.test(`${r.sentence} ${r.detail}`), 'no percentage below 5 accounts');
  assert.match(r.detail, /A response rate needs 5 applicant accounts \(2 so far\)\./);
  assert.equal(b.ratesShown, false);
  // A stored 3-day average from ONE account that named a wait: stated, with its basis.
  assert.match(w.sentence, /about 3 days on average/);
  assert.match(w.detail, /From 1 of 2 applicant accounts that named a wait/);
});

test('one account: singular wording, never "1 applicant accounts"', () => {
  const b = buildCompanyAnswers({ name: 'Acme', score: { gradeable: false, overall_score: null, first_party_report_count: 1, data_source: 'reports' }, rows: [{ outcome: 'ghosted', platform: 'Reddit r/jobs' }] });
  const text = b.answers.map((a) => `${a.sentence} ${a.detail}`).join(' ');
  assert.ok(!/\b1 applicant accounts\b/.test(text), text);
  assert.equal(b.answers[0].sentence, 'Too few accounts to say yet: the one applicant account on Seen says Acme never got back to them.');
  assert.match(b.answers[0].detail, /needs 5 applicant accounts and a grade \(1 so far\)/);
  assert.equal(b.confidence, null, 'no confidence label without a grade');
});

test('zero: honest empty answers, listing facts labelled as job posts, no FAQ', () => {
  const listing = { rated: true, listings: 25, facts: { open: 25, payPct: 100, directPct: 0, longOpenPct: 12, datedPosts: 25 } };
  const b = buildCompanyAnswers({ name: 'Sheetz', score: null, rows: [], listing });
  assert.equal(b.accounts, 0);
  assert.ok(b.answers.every((a) => a.known === false));
  assert.equal(b.answers[0].sentence, 'Seen does not know yet: there are no applicant accounts for Sheetz on Seen.');
  assert.equal(b.answers[0].detail, "What Seen does know comes from Sheetz's own job posts, not applicant accounts: 25 open postings on Seen; 100% state pay, 0% let you apply with the employer and 12% have been open 30 days or more.");
  assert.match(b.answers[2].detail, /Not enough reports by role yet/);
  assert.deepEqual(answersFaq(b), []);
  assert.equal(b.hasData, true);
  const none = buildCompanyAnswers({ name: 'Nobody Co', score: null, rows: [], listing: null });
  assert.equal(none.hasData, false);
});

test('web-only: a web-research claim is never an applicant account and never a rate', () => {
  const score = { gradeable: false, overall_score: null, report_count: 3085, first_party_report_count: 0, web_report_count: 3085, data_source: 'web_search', response_rate: null };
  const b = buildCompanyAnswers({ name: 'Robert Half', score, rows: [] });
  const text = b.answers.map((a) => `${a.sentence} ${a.detail}`).join(' ');
  assert.ok(!/3,?085/.test(text), 'the claimed count never appears');
  assert.ok(!/%/.test(text));
  assert.match(text, /web research estimate/);
  assert.equal(b.accounts, 0);
  // A legacy row with no split columns and a web data_source also counts 0.
  const legacy = buildCompanyAnswers({ name: 'Old Co', score: { overall_score: 70, report_count: 900, data_source: 'web_research' }, rows: null });
  assert.equal(legacy.accounts, 0);
});

test('held reports: anti-gaming holds never count; held external imports follow the grade rule', () => {
  const rows = [
    ...rowsOf({ 'ghosted|Seen': 3, 'offer|Seen': 2 }),
    { outcome: 'offer', platform: 'Seen', trust_reason: 'anonymous_unverified', needs_review: true },     // held: not counted
    { outcome: 'rejected', platform: 'Glassdoor', trust_reason: 'admin_rejected', needs_review: true },   // rejected: not counted
    { outcome: 'hired', platform: 'Glassdoor', trust_reason: 'duplicate_import', needs_review: true },    // duplicate: not counted
    { outcome: 'human', platform: 'Indeed', trust_reason: 'external_employee_review' },                   // employee review: not counted
    { outcome: 'interview', platform: 'Glassdoor', trust_reason: 'external_import', needs_review: true }, // counted, like the grade
    { outcome: 'waiting', platform: 'Seen' },                                                             // no outcome yet
  ];
  const bd = outcomeBreakdown(rows);
  assert.equal(bd.total, 6);
  const b = buildCompanyAnswers({ name: 'Northwind', score: { gradeable: true, overall_score: 60, response_rate: 0.5, ghost_rate: 0.5, first_party_report_count: 6, data_source: 'reports', data_quality: 'moderate' }, rows });
  assert.equal(b.breakdown.total, 6);
  assert.match(b.answers[2].sentence, /^Of 6 applicant accounts on Seen, 2 got an offer, 1 interviewed or heard from a person and 3 never heard back\.$/);
  assert.match(b.answers[2].detail, /1 from public posts and 5 submitted to Seen/);
});

test('stale stored score: rows disagree with the header count → no breakdown, one sentence says why', () => {
  const b = buildCompanyAnswers({ name: 'Walmart', score: WALMART_SCORE, rows: WALMART_ROWS.slice(0, 45) });
  assert.equal(b.breakdown, null);
  assert.equal(b.answers[0].sentence, "Mostly yes: Seen's response rate for Walmart is 87%, from 48 applicant accounts.");
  assert.match(b.answers[0].detail, /The grade was built from 48 applicant accounts; 45 are on file now/);
  assert.equal(b.answers[2].known, false);
  assert.match(b.answers[2].sentence, /Seen is recounting/);
  // Rows unreadable: rate from the score only, nothing about the breakdown invented.
  const unread = buildCompanyAnswers({ name: 'Walmart', score: WALMART_SCORE, rows: null });
  assert.equal(unread.breakdown, null);
  assert.ok(!/\b38\b|\b10 say\b/.test(unread.answers.map((a) => a.sentence).join(' ')));
  assert.equal(unread.answers[1].known, false, 'no rows → no wait (the stored average is not trusted alone)');
});

test('never states a number the inputs do not hold', () => {
  const b = buildCompanyAnswers({ name: 'Amazon', score: AMAZON_SCORE, rows: AMAZON_ROWS });
  const bd = outcomeBreakdown(AMAZON_ROWS);
  const allowed = new Set([
    26, 10, 7, 9, 62, 33, 30, 15, 1.9, 4, 6, 3, 25, 1, 5, 2026, 2, // counts, rates, wait, rounds, stage counts, date parts
    bd.offer, bd.interview, bd.autoRejected, bd.ghosted, bd.waits.length, bd.rounds.length, bd.ghostedWithStage,
  ]);
  for (const a of b.answers) for (const n of numbers(`${a.sentence} ${a.detail}`)) assert.ok(allowed.has(n), `${n} in: ${a.sentence} ${a.detail}`);
});

test('FAQ = the visible answers word for word, only answered questions', () => {
  const b = buildCompanyAnswers({ name: 'Walmart', score: WALMART_SCORE, rows: WALMART_ROWS });
  const faq = answersFaq(b);
  assert.deepEqual(faq.map((f) => f.question), ['Does Walmart respond to applicants?', 'Who hears back from Walmart?']);
  for (const f of faq) {
    const a = b.answers.find((x) => x.question === f.question);
    assert.equal(f.answer, `${a.sentence} ${a.detail}`);
  }
});

test('copy has no dashes', () => {
  for (const [score, rows] of [[WALMART_SCORE, WALMART_ROWS], [AMAZON_SCORE, AMAZON_ROWS], [null, []]]) {
    const b = buildCompanyAnswers({ name: 'Acme', score, rows, listing: { rated: false, listings: 2, facts: { open: 2 } } });
    for (const a of b.answers) assert.ok(!/[—–]| - /.test(`${a.question} ${a.sentence} ${a.detail}`), `${a.sentence} ${a.detail}`);
  }
});

test('listing facts: an unrated handful states only the count', () => {
  assert.equal(listingFactsSentence('Acme', { rated: false, listings: 2, facts: { open: 2 } }), "What Seen does know comes from Acme's own job posts, not applicant accounts: 2 open postings on Seen.");
  assert.equal(listingFactsSentence('Acme', null), '');
  assert.equal(listingFactsSentence('Acme', { rated: false, listings: 0, reason: 'no open job posts on Seen' }), '');
});

test('indexing: graded; or ≥1 applicant account with ≥10 rated open postings; never listings alone', () => {
  const rated = (n) => ({ rated: true, listings: n, facts: { open: n } });
  assert.equal(companyIndexDecision({ gradeable: true, readOk: true }).index, true);
  assert.equal(companyIndexDecision({ gradeable: false, readOk: false }).index, true, 'a failed read decides nothing');
  assert.equal(companyIndexDecision({ gradeable: false, readOk: true, accounts: 2, listing: rated(25) }).index, true);
  assert.equal(companyIndexDecision({ gradeable: false, readOk: true, accounts: 2, listing: rated(9) }).index, false);
  assert.equal(companyIndexDecision({ gradeable: false, readOk: true, accounts: 0, listing: rated(900) }).index, false, 'a listings-only page is thin');
  assert.equal(companyIndexDecision({ gradeable: false, readOk: true, accounts: 3, listing: null }).index, false);
});
