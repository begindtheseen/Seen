// Every sentence the growth loops show or send: the warn-a-friend share text, the invite card, and
// the line after a reported outcome. One voice, the card-copy rules (lib/cardCopy.js):
//   · no em/en dashes and no " - " as punctuation; periods and commas instead;
//   · natural counts ("1 day", "2 days");
//   · nothing invented: a number is said only when the page has it;
//   · plain words a person would text a friend, checked by the product's own slop detector
//     (lib/growthCopy.test.mjs).
// Every reward number renders from lib/server/creditRules.js. Pure: no DOM, no I/O.

import {
  REPORT_REWARD_PRO_DAYS, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS,
  REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, dayWord, proDaysLabel,
} from './server/creditRules.js';
import { formatPacific } from './time/pacific.js';

const name = (company) => String(company || '').trim().replace(/\s+/g, ' ') || 'this company';
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) : null);
const reportWord = (n) => `${n} applicant ${n === 1 ? 'account' : 'accounts'}`;
/** "an A" / "a B" — the article a letter grade takes when spoken. */
const gradePhrase = (letter) => {
  const l = String(letter || '').trim().toUpperCase();
  if (!/^[A-F][+-]?$/.test(l)) return '';
  return `${/^[AEF]/.test(l) ? 'an' : 'a'} ${l}`;
};

/**
 * The text a person sends a friend from a company page.
 * @param {{ company: string, graded?: boolean, letter?: string, applicantReports?: number,
 *   ratesShown?: boolean, ghostRate?: number|null, responseRate?: number|null }} s
 *   Exactly what the page shows: ghost/response rates only count when `ratesShown` (the page's own
 *   MIN_REPORTS_FOR_RATES gate), the letter only when `graded`.
 */
export function warnFriendText(s) {
  const co = name(s.company);
  const grade = s.graded ? gradePhrase(s.letter) : '';
  const ghost = s.ratesShown ? pct(s.ghostRate) : null;
  const resp = s.ratesShown ? pct(s.responseRate) : null;
  const n = Math.max(0, Math.round(Number(s.applicantReports) || 0));
  if (grade && ghost != null && ghost >= 50) {
    return `Applying to ${co}? Check this first. Seen gives them ${grade}, and ${ghost}% of applicant accounts say they got ghosted.`;
  }
  if (grade && resp != null && resp >= 75) {
    return `Applying to ${co}? Worth a look first. Seen gives them ${grade}, and ${resp}% of applicant accounts say they heard back.`;
  }
  if (grade && ghost != null) {
    return `Applying to ${co}? Check this first. Seen gives them ${grade}. ${ghost}% of applicant accounts say they got ghosted.`;
  }
  if (grade && n > 0) {
    return `Applying to ${co}? Check this first. Seen gives them ${grade}, based on ${reportWord(n)}.`;
  }
  return `Applying to ${co}? Have a look on Seen first. It shows what happens to people who apply, like who ghosts and who calls back.`;
}

/**
 * The text after someone reported their own ghosting or rejection from the tracker.
 * @param {{ company: string, outcome: 'ghosted'|'rejected'|string, days?: number|null }} s
 */
export function warnAfterOutcomeText(s) {
  const co = name(s.company);
  const d = s.days != null && Number.isFinite(Number(s.days)) && Number(s.days) > 0 ? dayWord(s.days) : '';
  if (s.outcome === 'ghosted') {
    return d
      ? `Heads up if you're applying to ${co}. I never heard back after ${d}. Here is what other applicants say.`
      : `Heads up if you're applying to ${co}. I never heard back. Here is what other applicants say.`;
  }
  return d
    ? `Heads up if you're applying to ${co}. They turned me down after ${d}. Here is what other applicants say.`
    : `Heads up if you're applying to ${co}. They turned me down. Here is what other applicants say.`;
}

/** The share button's label on a company page and after a report. */
export const WARN_FRIEND_LABEL = 'Send this to someone applying here';

// ── Invite card ────────────────────────────────────────────────────────────────────────────────

export const INVITE_TITLE = 'Invite friends';

/** "When a friend joins with your link and tracks their first application, you both get 7 days of Seen Pro." */
export function inviteLine() {
  return `When a friend joins with your link and tracks their first application, you both get ${proDaysLabel(REFERRAL_REWARD_PRO_DAYS)}.`;
}

/** The message that goes with a shared invite link. */
export function inviteShareText() {
  return `I use Seen to see which companies ghost applicants before I apply. Join with my link and track your first application, and we both get ${proDaysLabel(REFERRAL_REWARD_PRO_DAYS)}.`;
}

/** "2 of 10 invites rewarded". */
export function inviteProgress(rewarded) {
  const n = Math.max(0, Math.round(Number(rewarded) || 0));
  return `${Math.min(n, REFERRAL_MAX_REWARDED)} of ${REFERRAL_MAX_REWARDED} invites rewarded`;
}

/** "1 friend joined and hasn't tracked an application yet." / '' */
export function inviteWaiting(waiting) {
  const n = Math.max(0, Math.round(Number(waiting) || 0));
  if (!n) return '';
  return n === 1
    ? '1 friend joined and has not tracked an application yet.'
    : `${n} friends joined and have not tracked an application yet.`;
}

/** Past the cap the friend still gets their week; say so plainly. */
export function inviteCapLine(rewarded) {
  return Number(rewarded) >= REFERRAL_MAX_REWARDED
    ? `You have reached ${REFERRAL_MAX_REWARDED} rewarded invites. Friends who join still get their ${dayWord(REFERRAL_REWARD_PRO_DAYS)}.`
    : '';
}

/** "Each outcome you report from a tracked application earns 3 days of Seen Pro, up to 15 days a month." */
export function reportRewardLine() {
  return `Each outcome you report from an application you tracked for at least ${dayWord(REPORT_REWARD_MIN_TRACKED_DAYS)} earns ${proDaysLabel(REPORT_REWARD_PRO_DAYS)}, up to ${dayWord(REPORT_REWARD_MONTHLY_CAP_DAYS)} a month.`;
}

/** "You have earned 10 days of Seen Pro so far." / '' */
export function earnedLine(days) {
  const n = Math.max(0, Math.round(Number(days) || 0));
  return n ? `You have earned ${proDaysLabel(n)} so far.` : '';
}

/** "Pro until Nov 3." in California time / '' */
export function proUntilLine(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return `Pro until ${formatPacific(new Date(t), { month: 'short', day: 'numeric' })}.`;
}

// ── After a report ─────────────────────────────────────────────────────────────────────────────

/**
 * What the person sees after an outcome report, from the server's reward answer. null = say nothing
 * (not ready yet, a failure, an application that already earned).
 * @param {{ granted?: boolean, reason?: string, days?: number, pro_until?: string,
 *   month_days?: number, month_cap?: number, tracked_days?: number, resets_on?: string } | null | undefined} r
 * @returns {{ title: string, sub: string, kind: 'granted'|'capped'|'too_new' } | null}
 */
export function reportRewardMessage(r) {
  if (!r) return null;
  if (r.granted) {
    const until = proUntilLine(r.pro_until);
    return { kind: 'granted', title: `+${proDaysLabel(r.days || REPORT_REWARD_PRO_DAYS)}`, sub: `Thanks for reporting what happened.${until ? ` ${until}` : ''}` };
  }
  if (r.reason === 'monthly_cap') {
    const t = Date.parse(`${r.resets_on || ''}T12:00:00Z`);
    const when = Number.isFinite(t) ? formatPacific(new Date(t), { month: 'long', day: 'numeric' }) : 'the 1st of next month';
    return { kind: 'capped', title: 'Report saved', sub: `You have earned this month's ${dayWord(r.month_cap || REPORT_REWARD_MONTHLY_CAP_DAYS)} of Seen Pro from reports. Rewards start again on ${when}.` };
  }
  if (r.reason === 'too_new') {
    return { kind: 'too_new', title: 'Report saved', sub: `Reports earn Seen Pro once an application has been on your tracker for ${dayWord(REPORT_REWARD_MIN_TRACKED_DAYS)}. This one has been on it for ${dayWord(r.tracked_days || 0)}.` };
  }
  return null;
}

/** After the invitee's first tracked application. */
export function referralRewardMessage(r) {
  if (!r || !r.rewarded) return null;
  const until = proUntilLine(r.pro_until);
  return { title: `+${proDaysLabel(r.days || REFERRAL_REWARD_PRO_DAYS)}`, sub: `Your invite reward for tracking your first application.${until ? ` ${until}` : ''}` };
}
