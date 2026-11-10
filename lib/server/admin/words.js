// Words the admin server writes into sentences and rows (round 7: the judge read raw enums — "a autoreject report",
// "fully_on", "*/15 * * * * (UTC)" — and wrong plurals). One table per thing, used everywhere a sentence is built.

import { formatPacific } from '../../time/pacific.js';

// The public site's outcome words (lib/reportCardOutcome.ts OUTCOMES), so admin and site say the same thing.
export const OUTCOME_LABEL = {
  ghosted: 'Ghosted', autoreject: 'Auto-rejected', rejected: 'Rejected', human: 'Got a response',
  interview: 'Interview', interviewing: 'Interviewing', offer: 'Offer', hired: 'Hired', waiting: 'Waiting',
};
export const outcomeLabel = (o) => OUTCOME_LABEL[String(o || '').toLowerCase()] || (o ? String(o).replace(/_/g, ' ') : 'Unknown');
/** "an Auto-rejected report" / "a Ghosted report" — the article that fits the label. */
export const withArticle = (word) => `${/^[aeiou]/i.test(String(word)) ? 'an' : 'a'} ${word}`;

export const FLAG_STATUS_WORDS = {
  off: 'Off', admin_only: 'On for admins only', beta_users: 'On for beta users', percentage_rollout: 'On for a share of users', fully_on: 'On for everyone',
};
export const flagStatusWords = (status, percentage) => (status === 'percentage_rollout' && Number.isFinite(Number(percentage))
  ? `On for ${Number(percentage)}% of users`
  : FLAG_STATUS_WORDS[status] || String(status || '').replace(/_/g, ' '));

// Where a report came from, in words. trust_reason says HOW it arrived; platform says WHERE the person applied.
const TRUST_WORDS = {
  external_import: 'Imported', external_employee_review: 'Employee review (imported)', web_search_public_review: 'Paraphrase of a public review page',
  reddit_rule_match: 'From Reddit (passed the first-hand rules)', web_rule_match: 'From a public web page (passed the first-hand rules)',
  auto_enrich_reddit: 'From Reddit (automatic import)', anonymous_unverified: 'Anonymous, not verified', duplicate_user_company: 'Second report from the same account for this company',
  velocity_capped: 'Held: many reports in a short time', admin_rejected: 'Rejected by an admin', duplicate_import: 'Duplicate copy',
};
export function sourceLabel(r) {
  const platform = String(r?.platform || '').trim();
  const how = TRUST_WORDS[String(r?.trust_reason || '')] || (r?.trust_reason ? String(r.trust_reason).replace(/_/g, ' ') : 'Sent to Seen');
  return platform ? `${how} · ${platform}` : how;
}

/** A Date as the admin shows dates everywhere: "Nov 30, 2026" (California). */
export const dateWords = (d) => formatPacific(new Date(d), { dateStyle: 'medium' });

// ── cron schedules in words, in California time ─────────────────────────────────────────────────
// A raw expression is never shown. The day is converted with the hour: "0 4 1 * *" UTC is the last day of the
// month at 8 PM in California, not "day 1". Built from real next-run instants, so DST is right for the next run.
export function scheduleWords(schedules, nextRuns) {
  const exprs = schedules.map((s) => String(s).trim().split(/\s+/));
  const time = (d) => formatPacific(d, { hour: 'numeric', minute: '2-digit' });
  const [m0, h0, dom0, , dow0] = exprs[0];
  if (exprs.length === 1 && /^\*\/\d+$/.test(m0) && h0 === '*') return `Every ${m0.slice(2)} minutes`;
  if (exprs.length === 1 && /^\d+$/.test(m0) && h0 === '*') return `Every hour at :${m0.padStart(2, '0')}`;
  // Several minutes-past-the-hour runs every hour is still "every hour"; anything with a minute step, likewise.
  if (exprs.length === 1 && h0 === '*') return 'Every hour';
  const runs = (nextRuns || []).filter(Boolean).sort((a, b) => a - b);
  if (!runs.length) return 'On a schedule';
  const daily = exprs.every((e) => e[2] === '*' && e[4] === '*');
  if (daily) {
    // In clock order through the California day, each time once.
    const clock = (d) => Number(formatPacific(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(/\D/g, '').slice(0, 4));
    const times = [...new Map([...runs].sort((x, y) => clock(x) - clock(y)).map((d) => [time(d), true])).keys()];
    return times.length === 1 ? `Daily at ${times[0]}` : `${times.length} times a day (${times.join(', ')})`;
  }
  if (dom0 === '*' && dow0 !== '*') {
    const day = formatPacific(runs[0], { weekday: 'long' });
    return `${day}s at ${time(runs[0])}`;
  }
  if (dom0 !== '*') {
    // Day of month: say the California day the run lands on.
    const pacDay = Number(formatPacific(runs[0], { day: 'numeric' }));
    const utcDay = runs[0].getUTCDate();
    if (pacDay !== utcDay && utcDay === 1) return `Last day of each month at ${time(runs[0])}`;
    return `Day ${pacDay} of each month at ${time(runs[0])}`;
  }
  return `On a schedule (next ${formatPacific(runs[0])})`;
}

// ── undo sentences ─────────────────────────────────────────────────────────────────────────────────
// Every undo answer says what is true NOW, never "Undid it: …" — the interface already prefixes "Undone" (round 10:
// the dock printed "Undone Undid it: 140 reports are back…"). This is the one place an undo sentence is written.
const n = (v) => Number(v || 0).toLocaleString('en-US');
const reports = (k) => `${n(k)} ${k === 1 ? 'report' : 'reports'}`;
const isAre = (k) => (k === 1 ? 'is' : 'are');
/**
 * kind → sentence. `d` carries the facts: count, changed_since, company, outcome, flag, status, balance, reports.
 * Kinds: held_batch_approve | held_batch_reject | report_copies | report | outcome | merge | listing | listing_reports
 * | pro_window | flag_default | flag | status | balance | edit | progress.
 */
export function undoSentence(kind, d = {}) {
  const since = d.changed_since ? ` · ${n(d.changed_since)} changed since and left alone` : '';
  switch (kind) {
    case 'held_batch_approve': return `${reports(d.count)} ${isAre(d.count)} back in the review queue${since}.`;
    case 'held_batch_reject': return `${reports(d.count)} ${isAre(d.count)} back in the review queue, no longer rejected${since}.`;
    case 'report_copies': return `${reports(d.count)} ${isAre(d.count)} no longer marked as copies${since}.`;
    case 'report': return 'The report is back as it was.';
    case 'outcome': return `The outcome is ${outcomeLabel(d.outcome)} again.`;
    case 'merge': return `${d.company} is separate again · ${reports(d.reports)} moved back.`;
    case 'listing': return 'The listing is back on the site and its reports are restored.';
    case 'listing_reports': return `${reports(d.count)} restored on the listing.`;
    case 'pro_window': return 'The Pro window is back as it was.';
    case 'flag_default': return `The flag ${d.flag} has no setting again (its code default applies).`;
    case 'flag': return `The flag ${d.flag} is ${flagStatusWords(d.status, d.percentage)} again.`;
    case 'status': return `Back to ${String(d.status || '').replace(/_/g, ' ')}.`;
    case 'balance': return `The balance is back to ${n(d.balance)}.`;
    case 'edit': return 'The listing is back as it was before the edit.';
    case 'progress': return `Restoring ${n(d.done)} of ${n(d.total)} — keep going.`;
    default: return 'It is back as it was.';
  }
}
