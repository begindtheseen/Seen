// Run: node --test lib/reports/feedFilter.test.mjs
// Every row below is a real /feed row from the 2026-10-23 audit (text trimmed to the stored excerpt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedRowPasses, feedRowVerdict, collapseByCompany, redditSubredditOf, isPublicDiscussionRow } from './feedFilter.js';

const reddit = (company, sub, text, outcome = 'offer') => ({ id: `${company}-${text.length}`, company_name: company, platform: `Reddit r/${sub}`, report_text: `${text} [Source: https://www.reddit.com/r/${sub}/comments/abc/]`, outcome });

test('public-discussion rows that are not applicant accounts are kept off the feed', () => {
  assert.equal(feedRowPasses(reddit('twilio', 'twilio', 'Twilio sold me an upgraded plan promising Morocco outbound calls, numbers are blocked and support ghosted me.', 'ghosted')), false);
  assert.equal(feedRowPasses(reddit('albertsons', 'Albertsons', "She's the one who hired me and now is trying to get rid of me..")), false);
  assert.equal(feedRowVerdict(reddit('albertsons', 'Albertsons', "She's the one who hired me and now is trying to get rid of me..")).kind, 'employee_review');
});

test('first-hand applicant accounts stay, including ones that rely on the company subreddit', () => {
  assert.equal(feedRowPasses(reddit('albertsons', 'Albertsons', 'I just got a job offer today from Albertsons as a barista at Starbucks (NorCal).')), true);
  assert.equal(feedRowPasses(reddit('albertsons', 'Albertsons', 'I have an interview in the Dallas/Garland (it\'s kinda in between), Texas, USA area in bakery.', 'interview')), true);
  assert.equal(feedRowPasses(reddit('walgreens', 'jobs', 'Just got Hired as Walgreens Pharmacy Technician.')), true);
  assert.equal(feedRowPasses(reddit('pwc', 'PwC', 'Last week I got an offer for an entry level associate position.')), true);
});

test('a rule-verified import keeps its thread context; an LLM-era import must name the company itself', () => {
  // Wells Fargo (prod, trust_reason reddit_rule_match, thread titled after the company): the excerpt alone
  // does not name the company — the ingest verified that from the title, so the feed does not re-ask.
  const wf = (trust_reason) => ({ id: 'wf', company_name: 'wells fargo', platform: 'Reddit r/recruitinghell', trust_reason, outcome: 'rejected', report_text: 'They rejected me 😐... recruiter said hiring manager really like you as a candidate ...wtf [Source: https://www.reddit.com/r/recruitinghell/comments/x/]' });
  assert.equal(feedRowPasses(wf('reddit_rule_match')), true);
  assert.equal(feedRowVerdict(wf('reddit_community_report')).reason, 'company_not_named');
  assert.equal(feedRowPasses(wf('reddit_community_report')), false);
  // The context never rescues a customer or employee story.
  assert.equal(feedRowPasses({ ...reddit('twilio', 'twilio', 'Twilio sold me an upgraded plan promising Morocco outbound calls, numbers are blocked and support ghosted me.', 'ghosted'), trust_reason: 'reddit_rule_match' }), false);
});

test('first-party Seen reports are shown as stored (no re-check)', () => {
  assert.equal(feedRowPasses({ id: '1', company_name: 'acme', platform: 'LinkedIn', report_text: 'ghosted', outcome: 'ghosted' }), true);
  assert.equal(feedRowPasses({ id: '2', company_name: 'acme', platform: 'Seen', report_text: '', outcome: 'rejected' }), true);
  assert.equal(feedRowPasses({ id: '3', company_name: '', platform: 'Seen', outcome: 'rejected' }), false);
  assert.equal(isPublicDiscussionRow({ platform: 'Public review · glassdoor.com' }), true);
  assert.equal(isPublicDiscussionRow({ platform: 'Glassdoor' }), false);
  assert.equal(redditSubredditOf('Reddit r/Albertsons'), 'Albertsons');
  assert.equal(redditSubredditOf('Seen'), null);
});

test('collapseByCompany keeps one card per company and counts the rest', () => {
  const rows = ['albertsons', 'albertsons', 'walgreens', 'albertsons', 'twilio'].map((c, i) => ({ id: String(i), company_name: c }));
  const out = collapseByCompany(rows);
  assert.deepEqual(out.map((r) => [r.company_name, r.more_from_company]), [['albertsons', 2], ['walgreens', 0], ['twilio', 0]]);
});
