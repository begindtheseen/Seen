// Job-match email rules: one best listing (plus up to two from other employers) or none, never a repeat,
// never a D/F employer, never a row without a reason from her résumé, at most 2 a day 4 h apart, and an
// email whose every line is a fact Seen checked.
// Run: node --test lib/server/jobMatchEmails.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBestMatch, canSendNow, buildJobMatchEmail, jobKey, companyVerdict, matchReasons, shortTitle,
  MAX_PER_DAY, MORE_ITEMS, resumeSubject, whereLine,
} from './jobMatchEmails.js';
import { unsubToken, verifyUnsub } from './outcomeEmails.js';

const job = (over = {}) => ({
  id: 'j1', title: 'Cashier', company: 'walmart', location: 'Norwalk, CA', salary: '$18/hr', apply_url: 'https://x.example/1',
  _reason: "You were a Cashier at Fry's Food Stores (2019–2023).", _basis: 'title', _remote: false, _miles: 3, _matchScore: 300, ...over,
});
const graded = (overall, rr = 0.8) => ({ overall_score: overall, response_rate: rr, first_party_report_count: 6, mention_count: 0 });

test('picks the best-ranked listing that passes every gate', () => {
  const ranked = [job({ id: 'a', _matchScore: 320 }), job({ id: 'b', title: 'Cashier II', _matchScore: 310 })];
  assert.equal(pickBestMatch(ranked).job.id, 'a');
});

test('a row without a reason from her résumé or applications is never emailed', () => {
  assert.equal(pickBestMatch([job({ _reason: null })]), null);
  assert.equal(pickBestMatch([job({ _reason: '  ' })]), null);
  assert.equal(pickBestMatch([job({ _reason: null })], { alertMode: true }).job.id, 'j1', 'alerts carry the alert as the reason');
});

test('up to MORE_ITEMS more matches ride along, each from another employer', () => {
  assert.equal(MORE_ITEMS, 2);
  const ranked = [job({ id: 'a', company: 'walmart', _matchScore: 330 }), job({ id: 'b', company: 'walmart', _matchScore: 320 }), job({ id: 'c', company: 'target', _matchScore: 310 }), job({ id: 'd', company: 'ralphs', _matchScore: 300 }), job({ id: 'e', company: 'vons', _matchScore: 290 })];
  const pick = pickBestMatch(ranked);
  assert.equal(pick.job.id, 'a');
  assert.deepEqual(pick.more.map((m) => m.job.id), ['c', 'd']);
});

test('never the same job twice, by id or by the same role at the same company from another source', () => {
  const ranked = [job({ id: 'a' }), job({ id: 'b', title: 'Stock Associate', company: 'target', _phrase: 'stock associate' })];
  assert.equal(pickBestMatch(ranked, { emailedJobIds: new Set(['a']) }).job.id, 'b');
  assert.equal(pickBestMatch(ranked, { emailedKeys: new Set([jobKey(job({ id: 'zzz' }))]) }).job.id, 'b');
  assert.equal(jobKey({ title: 'Cashier ', company: 'Walmart' }), jobKey({ title: 'cashier', company: 'WALMART' }));
});

test('skips listings the person applied to or saved', () => {
  const ranked = [job({ id: 'a' }), job({ id: 'b', company: 'target' })];
  assert.equal(pickBestMatch(ranked, { appliedJobIds: new Set(['a']) }).job.id, 'b');
  assert.equal(pickBestMatch(ranked, { appliedKeys: new Set([jobKey({ title: 'Cashier', company: 'Walmart' })]) }).job.id, 'b');
  assert.equal(pickBestMatch(ranked, { savedJobIds: new Set(['a']) }).job.id, 'b');
});

test('never invites to an employer graded D or F; otherwise the rail\'s order is kept; ungraded is fine', () => {
  const ranked = [job({ id: 'd', company: 'badco', _matchScore: 400 }), job({ id: 'u', company: 'newco', _matchScore: 300 }), job({ id: 'a', company: 'goodco', _matchScore: 295 })];
  const scores = new Map([['badco', graded(65)], ['goodco', graded(93)]]); // a D (60–69) is dropped; A is 90+
  const pick = pickBestMatch(ranked, { scores });
  assert.equal(pick.job.id, 'u', 'D employer dropped; the next row of the same ranked list');
  assert.equal(pick.more[0].verdict.letter, 'A');
  // Below the grade bar (too few reports) a low score is not a public verdict and does not block.
  const thin = new Map([['badco', { overall_score: 30, first_party_report_count: 1, mention_count: 0 }]]);
  assert.equal(pickBestMatch([job({ id: 'd', company: 'badco' })], { scores: thin }).job.id, 'd');
  assert.equal(companyVerdict({ overall_score: 30, first_party_report_count: 1 }), null);
});

test('two different employers a day', () => {
  const ranked = [job({ id: 'a' }), job({ id: 'b', company: 'target' })];
  assert.equal(pickBestMatch(ranked, { companiesToday: new Set(['walmart']) }).job.id, 'b');
});

test('a listing without a Seen id has no page to link to and is skipped', () => {
  assert.equal(pickBestMatch([job({ id: null })]), null);
});

test('at most 2 a California day, at least 4 hours apart', () => {
  assert.equal(MAX_PER_DAY, 2);
  const now = Date.parse('2026-10-24T22:05:00Z');
  assert.equal(canSendNow({ sentToday: 0 }, now), true);
  assert.equal(canSendNow({ sentToday: 1, lastSentAt: '2026-10-24T16:05:00Z' }, now), true);
  assert.equal(canSendNow({ sentToday: 1, lastSentAt: '2026-10-24T20:30:00Z' }, now), false);
  assert.equal(canSendNow({ sentToday: 2, lastSentAt: '2026-10-24T10:00:00Z' }, now), false);
});

test('the email: Seen link, reasons that are facts, escaped text, one-click unsubscribe line', () => {
  const j = job({ title: 'Cashier <b>now</b>', company: 'walmart' });
  const verdict = companyVerdict(graded(93, 0.87));
  const mail = buildJobMatchEmail({ job: j, verdict, city: 'Norwalk, California', applyUrl: 'https://seenjobs.io/jobs/j1?utm_source=email', unsubUrl: 'https://seenjobs.io/api/unsubscribe?list=job_matches&uid=u&token=t', companyPageUrl: 'https://seenjobs.io/company/walmart' });
  assert.equal(mail.subject, 'Cashier <b>now</b> at Walmart, Norwalk');
  assert.match(mail.html, /href="https:\/\/seenjobs\.io\/jobs\/j1\?utm_source=email"/);
  assert.ok(!mail.html.includes('<b>now</b>'), 'listing text is escaped');
  assert.match(mail.html, /Cashier &lt;b&gt;now&lt;\/b&gt;/);
  assert.match(mail.html, /You were a Cashier at Fry&#39;s Food Stores \(2019–2023\)\./);
  assert.match(mail.html, /Picked from your résumé/);
  assert.match(mail.html, /3 miles from Norwalk/);
  assert.match(mail.html, /A on Seen · 87% of applicants hear back/);
  assert.match(mail.html, /Stop job match emails/);
  assert.match(mail.text, /View and apply on Seen: https:\/\/seenjobs\.io\/jobs\/j1/);
  assert.match(mail.html, /Walmart/, 'stored lowercase names are shown properly');
});

test('reasons: a remote listing says Remote once (its location line); no verdict line without a public grade', () => {
  assert.deepEqual(matchReasons(job({ _remote: true, _miles: null, _reason: null }), { city: 'Phoenix, AZ' }), []);
  const mail = buildJobMatchEmail({ job: job({ _remote: true, _miles: null }), applyUrl: 'https://seenjobs.io/jobs/j1', unsubUrl: 'https://u.example' });
  assert.equal((mail.html.match(/Remote/g) || []).length, 1);
});

test('unsubscribe tokens are per list: a job-match link cannot stop the check-ins', () => {
  const t = unsubToken('u1', 's', 'job_matches');
  assert.equal(verifyUnsub('u1', t, 's', 'job_matches'), true);
  assert.equal(verifyUnsub('u1', t, 's', 'outcome'), false);
  assert.equal(verifyUnsub('u1', unsubToken('u1', 's'), 's'), true, 'outcome links already sent keep working');
  assert.equal(verifyUnsub('u1', t, 's', 'everything'), false);
});

test('the "also a fit" items: title, employer, place and their own reason, escaped; subject names role, employer, city', () => {
  const more = [{ job: job({ id: 'm1', title: 'Cashier & Stocker', company: 'aldi', location: 'Downey, CA', _miles: 4, _reason: 'Close to your Cashier job at Fry\'s Food Stores (2019–2023).' }), url: 'https://seenjobs.io/jobs/m1?x=1' }];
  const mail = buildJobMatchEmail({ job: job(), city: 'Norwalk, CA', applyUrl: 'https://seenjobs.io/jobs/j1', unsubUrl: 'https://u.example', more });
  assert.match(mail.html, /Also a fit/);
  assert.match(mail.html, /Cashier &amp; Stocker/);
  assert.match(mail.text, /- Cashier & Stocker · Aldi · Downey · 4 miles from Norwalk\n  Close to your Cashier job/);
  assert.equal(resumeSubject(job({ _remote: true })), 'Cashier at Walmart, remote');
  assert.equal(whereLine(job({ _miles: 0, location: 'Norwalk, CA' }), 'Norwalk, CA'), 'Norwalk');
  const applied = buildJobMatchEmail({ job: job({ _basis: 'applied', _reason: 'Similar to the Barista job at Dutch Bros you applied to on Nov 2.' }), applyUrl: 'a', unsubUrl: 'u' });
  assert.match(applied.text, /^Picked from the jobs you applied to/);
});

test('subject titles drop long tails and never cut a word', () => {
  assert.equal(shortTitle('Seasonal Sales Associate (Part-Time) - Biltmore Fashion Park'), 'Seasonal Sales Associate');
  assert.equal(shortTitle('Quality Inspector (Mechanical, Pipe, HVAC, Plumbing New Construction- Traveling)'), 'Quality Inspector');
  assert.equal(shortTitle('Cashier'), 'Cashier');
  const long = shortTitle('Senior Principal Associate Director of Strategic Partnerships Operations Excellence');
  assert.ok(long.length <= 49 && long.endsWith('…') && !/\s…$/.test(long), long);
});
