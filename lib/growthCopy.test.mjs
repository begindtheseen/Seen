// Every sentence the growth loops show or send (lib/growthCopy.js): the voice rules from the card copy
// (no em/en dashes, no " - " as punctuation, natural plurals, no filler, nothing the product's own
// slop detector flags), only numbers the page actually has, and every reward number rendered from the
// constants — no surface may hand-type "3 days" / "7 days" / "15 days" / "10 invites".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  warnFriendText, warnAfterOutcomeText, WARN_FRIEND_LABEL, INVITE_TITLE, inviteShareText, inviteLine,
  inviteProgress, inviteWaiting, inviteCapLine, reportRewardLine, earnedLine, proUntilLine,
  reportRewardMessage, referralRewardMessage,
} from './growthCopy.js';
import { detectAiSlop } from './humanizer/detectAiSlop.js';
import { detectBuzzwords } from './humanizer/detectBuzzwords.js';
import { BUILTIN_PHRASE_RULES, findPhraseMatches } from './humanizer/phraseRisk.js';
import { REPORT_REWARD_PRO_DAYS, REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS } from './server/creditRules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const COMPANIES = ['Acme', 'Chipotle Mexican Grill', "Lowe's", 'H&M', '  Target  '];
const PAGES = [
  { graded: true, letter: 'D', applicantReports: 40, ratesShown: true, ghostRate: 0.62, responseRate: 0.3 },
  { graded: true, letter: 'A', applicantReports: 48, ratesShown: true, ghostRate: 0.1, responseRate: 0.86 },
  { graded: true, letter: 'C', applicantReports: 9, ratesShown: true, ghostRate: 0.3, responseRate: 0.6 },
  { graded: true, letter: 'B', applicantReports: 3, ratesShown: false, ghostRate: 0.9, responseRate: 0.1 },
  { graded: true, letter: 'B', applicantReports: 1, ratesShown: false },
  { graded: true, letter: 'F', applicantReports: 0, ratesShown: false },
  { graded: false, letter: '—', applicantReports: 0, ratesShown: false, ghostRate: 0.7 },
  { graded: false },
];
const ANSWERS = [
  { granted: true, days: 3, pro_until: '2026-11-03T18:00:00Z', month_days: 6, month_cap: 15 },
  { granted: false, reason: 'monthly_cap', month_cap: 15, resets_on: '2026-11-01' },
  { granted: false, reason: 'too_new', tracked_days: 1 },
  { granted: false, reason: 'too_new', tracked_days: 0 },
  { granted: false, reason: 'too_new', tracked_days: 5 },
];

function everyString() {
  const out = [WARN_FRIEND_LABEL, INVITE_TITLE, inviteShareText(), inviteLine(), reportRewardLine(), proUntilLine('2026-11-03T18:00:00Z')];
  for (const co of COMPANIES) {
    for (const p of PAGES) out.push(warnFriendText({ company: co, ...p }));
    for (const outcome of ['ghosted', 'rejected']) for (const days of [null, 0, 1, 2, 23]) out.push(warnAfterOutcomeText({ company: co, outcome, days }));
  }
  for (const n of [0, 1, 2, 9, 10, 11]) out.push(inviteProgress(n), inviteWaiting(n), inviteCapLine(n), earnedLine(n));
  for (const a of ANSWERS) { const m = reportRewardMessage(a); out.push(m.title, m.sub); }
  const rm = referralRewardMessage({ rewarded: true, days: 7, pro_until: '2026-11-03T18:00:00Z' });
  out.push(rm.title, rm.sub);
  return out.filter(Boolean);
}

test('humanizer: no dashes, no " - " punctuation, no filler or slop, no double spaces, no hype', () => {
  const HYPE = /\b(amazing|incredible|revolutionary|game.?changer|unlock\w*|supercharge\w*|leverag\w*|seamless\w*|empower\w*|elevate\w*|journey|delve|exclusive|!{1,})/i;
  const all = everyString();
  assert.ok(all.length > 80, `found ${all.length}`);
  for (const s of all) {
    assert.ok(!/[—–]/.test(s), `dash in: ${s}`);
    assert.ok(!/\s-\s/.test(s), `" - " used as punctuation in: ${s}`);
    assert.ok(!HYPE.test(s), `hype word in: ${s}`);
    assert.ok(!/!/.test(s), `exclamation in: ${s}`);
    assert.deepEqual(detectAiSlop(s, BUILTIN_PHRASE_RULES), [], `slop in: ${s}`);
    assert.deepEqual(detectBuzzwords(s, BUILTIN_PHRASE_RULES), [], `buzzword in: ${s}`);
    assert.deepEqual(findPhraseMatches(s, BUILTIN_PHRASE_RULES), [], `phrase risk in: ${s}`);
    assert.ok(!/\s{2,}/.test(s), `double space in: ${s}`);
    assert.ok(!/\b1 days\b|\b1 reports\b|\b1 friends\b|\b([02-9]|\d{2,}) day\b/.test(s), `plural wrong in: ${s}`);
  }
});

test('plurals: "1 day" / "2 days", "1 applicant report"', () => {
  assert.match(warnAfterOutcomeText({ company: 'Acme', outcome: 'ghosted', days: 1 }), /after 1 day\./);
  assert.match(warnAfterOutcomeText({ company: 'Acme', outcome: 'rejected', days: 2 }), /after 2 days\./);
  assert.ok(!/after/.test(warnAfterOutcomeText({ company: 'Acme', outcome: 'ghosted', days: 0 })), 'no "after 0 days"');
  assert.match(warnFriendText({ company: 'Acme', graded: true, letter: 'B', applicantReports: 1 }), /based on 1 applicant report\./);
  assert.match(reportRewardMessage({ granted: false, reason: 'too_new', tracked_days: 1 }).sub, /for 1 day\.$/);
  assert.equal(inviteWaiting(1), '1 friend joined and has not tracked an application yet.');
});

test('warn-a-friend text states only what the page shows', () => {
  // Rates are hidden on the page under its MIN_REPORTS_FOR_RATES gate → no percentage in the text.
  const hidden = warnFriendText({ company: 'Acme', graded: true, letter: 'B', applicantReports: 3, ratesShown: false, ghostRate: 0.9 });
  assert.ok(!/%/.test(hidden), hidden);
  // Not graded → no letter, no number, a true generic line.
  const none = warnFriendText({ company: 'Acme', graded: false, letter: 'A', applicantReports: 0, ratesShown: true, ghostRate: 0.8 });
  assert.ok(!/\d|\ban? [A-F]\b/.test(none.replace('Acme', '')), none);
  assert.match(none, /^Applying to Acme\? /);
  // High ghosting: the example tone.
  assert.equal(warnFriendText({ company: 'Acme', graded: true, letter: 'D', applicantReports: 40, ratesShown: true, ghostRate: 0.62 }),
    'Applying to Acme? Check this first. Seen gives them a D, and 62% of applicant reports say they got ghosted.');
  assert.match(warnFriendText({ company: 'Acme', graded: true, letter: 'A', ratesShown: true, ghostRate: 0.1, responseRate: 0.9 }), /gives them an A, and 90% of applicant reports say they heard back\./);
  assert.match(warnFriendText({ company: 'Acme', graded: true, letter: 'F', applicantReports: 0 }), /an F\b|Have a look/);
});

test('reward lines render the constants', () => {
  assert.equal(inviteLine(), `When a friend joins with your link and tracks their first application, you both get ${REFERRAL_REWARD_PRO_DAYS} days of Seen Pro.`);
  assert.equal(inviteProgress(2), `2 of ${REFERRAL_MAX_REWARDED} invites rewarded`);
  assert.equal(inviteProgress(14), `${REFERRAL_MAX_REWARDED} of ${REFERRAL_MAX_REWARDED} invites rewarded`);
  assert.equal(reportRewardLine(), `Each outcome you report from an application you tracked for at least ${REPORT_REWARD_MIN_TRACKED_DAYS} days earns ${REPORT_REWARD_PRO_DAYS} days of Seen Pro, up to ${REPORT_REWARD_MONTHLY_CAP_DAYS} days a month.`);
  assert.equal(reportRewardMessage({ granted: true, days: 3 }).title, '+3 days of Seen Pro');
  assert.match(reportRewardMessage(ANSWERS[1]).sub, /Rewards start again on November 1\.$/);
  assert.equal(reportRewardMessage({ granted: false, reason: 'not_ready' }), null);
  assert.equal(reportRewardMessage({ granted: false, reason: 'already_rewarded' }), null);
  assert.equal(proUntilLine('2026-11-04T06:30:00Z'), 'Pro until Nov 3.', 'California date, not UTC');
});

test('no surface hand-types a reward number; they all render from creditRules', () => {
  const FILES = ['components/growth/InviteCard.tsx', 'components/growth/WarnFriendShare.tsx', 'lib/rewardNotice.ts', 'app/faq/page.tsx', 'app/pricing/page.tsx', 'app/terms/page.tsx'];
  for (const f of FILES) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const hit = code.match(/\b(3|7|10|15|30) (days?|invites?|friends) (of Seen Pro|of Pro|rewarded|a month)\b|\b(a|one) week of (Seen )?Pro\b/gi);
    assert.equal(hit, null, `${f} hand-types a reward number: ${hit}`);
  }
  // The copy module itself only interpolates.
  const lib = read('lib/growthCopy.js').replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.equal(lib.match(/\b(3|7|10|15|30) (days|invites)\b/g), null);
});
