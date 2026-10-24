// ── Seen card copy — every sentence a share surface prints or posts ─────────────────────
// The outcome card, the company card, the share text under them, the OG unfurl and the
// company page <title> all read their words from here, so the voice is one voice and the
// rules are enforced once (lib/cardCopy.test.mjs):
//   · no em/en dashes anywhere (owner 2026-10-24: "that's straight ai nonsense") — periods,
//     commas and colons instead;
//   · natural counts: "the same day", "1 day", "2 days";
//   · nothing invented: a missing day count or grade is simply left out;
//   · a ghosted outcome under 7 days is "hasn't written back yet", never "ghosted";
//   · plain first-person words that pass the product's own AI-slop detector.
// Pure: no DOM, no I/O. Dates are California time (lib/time/pacific.js).

import { formatPacific } from './time/pacific.js';

/** The ONE company slug scheme (decoded by /company/[slug] as decodeURIComponent + hyphens → spaces). */
export function companySlug(name) {
  return encodeURIComponent(String(name ?? '').toLowerCase().trim().replace(/\s+/g, '-'));
}

/** 'seenjobs.io/company/walmart' — the bare display URL printed on cards and ending share posts. */
export function companyUrl(name) {
  const slug = companySlug(name);
  return slug ? `seenjobs.io/company/${slug}` : 'seenjobs.io';
}

/** The https form of companyUrl, for intents and unfurls. */
export function companyHref(name) {
  return `https://${companyUrl(name)}`;
}

/** Day count from a reading of outcome vs applied timestamps (ms). Never negative; null when unknown. */
export function daysBetween(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.max(0, Math.round((toMs - fromMs) / 86400000));
}

/** "1 day" / "2 days" / "0 days". */
export function dayCount(n) {
  const d = Math.max(0, Math.round(Number(n) || 0));
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** "the same day" / "in a day" / "in 9 days" — the clause after "said no". */
export function inDays(n) {
  const d = Math.max(0, Math.round(Number(n) || 0));
  if (d === 0) return 'the same day';
  if (d === 1) return 'in a day';
  return `in ${d} days`;
}

/** Normalises what the tracker / API call an outcome into the five stories a card can tell. */
export function outcomeKind(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (o === 'hired' || o === 'offer' || o === 'human') return 'hired';
  if (o === 'ghosted') return 'ghosted';
  if (o === 'rejected' || o === 'autoreject') return 'rejected';
  if (o === 'interview' || o === 'interviewing' || o === 'assessment') return 'interview';
  return 'waiting';
}

/** Below this many days a ghosted outcome is only "no reply yet" (owner: never claim ghosting that fast). */
export const GHOST_MIN_DAYS = 7;

function hasDays(days) {
  return days != null && Number.isFinite(Number(days));
}

/**
 * The poster headline: a sentence in sentence case with the company name set apart (the kit
 * colours it). Returns `{ parts: [{ text, accent }], text }`.
 */
export function outcomeHeadline({ outcome, company, days, reachedInterview }) {
  const name = String(company || 'They').trim() || 'They';
  const kind = outcomeKind(outcome);
  const d = hasDays(days) ? Math.max(0, Math.round(Number(days))) : null;
  let rest;
  if (kind === 'ghosted') {
    if (reachedInterview) rest = ' interviewed me, then went silent.';
    else if (d != null && d < GHOST_MIN_DAYS) rest = " hasn't written back yet.";
    else rest = ' never wrote back.';
  } else if (kind === 'rejected') rest = d != null ? ` said no ${inDays(d)}.` : ' said no.';
  else if (kind === 'hired') {
    // The person's number first; the company goes in the sub-line (a cold reader called "C said
    // yes" a mad-lib slot). No accent part: parts is one white run.
    const text = d != null ? `Offer ${inDays(d)}.` : 'Got the offer.';
    return { parts: [{ text, accent: false }], text };
  }
  else if (kind === 'interview') rest = d != null ? ` called back ${inDays(d)}.` : ' called back.';
  else rest = " hasn't replied yet.";
  const parts = [{ text: name, accent: true }, { text: rest, accent: false }];
  return { parts, text: name + rest };
}

/** The label under the big number: "days without a reply" / "days to a decision" / "days to an interview". */
export function daysLabel({ outcome, days }) {
  const kind = outcomeKind(outcome);
  const one = hasDays(days) && Math.round(Number(days)) === 1;
  const unit = one ? 'day' : 'days';
  if (kind === 'ghosted') return `${unit} without a reply`;
  if (kind === 'interview') return `${unit} to an interview`;
  if (kind === 'waiting') return `${unit} waiting`;
  return `${unit} to a decision`;
}

/**
 * "Cosmetics Cashier · Indeed" (with a company first when the headline does not carry it:
 * "Sprouts · Produce Clerk · Indeed"). A missing part is dropped, never a blank; the platform is
 * dropped when it is Seen itself (the brand is already on the card twice).
 */
export function subLine(role, platform, company) {
  const r = String(role || '').trim();
  const p0 = String(platform || '').trim();
  const p = /^seen(\.io|jobs(\.io)?)?$/i.test(p0) ? '' : p0;
  const co = String(company || '').trim();
  return [co, r, p].filter(Boolean).join(' · ');
}

/** "OCT 2026 · PHOENIX, AZ" (city omitted when unknown). Month on the California calendar. */
export function metaLine(dateMs, city) {
  const when = Number.isFinite(dateMs) ? formatPacific(new Date(dateMs), { month: 'short', year: 'numeric' }) : '';
  const where = String(city || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return [when, where].filter(Boolean).join(' · ').toUpperCase();
}

/**
 * The one-line context under the hero, only when the company HAS a Seen grade. It must EXPLAIN
 * the story, never argue with it (two cold readers read "never wrote back" over "13% get ghosted"
 * as "the grade is garbage or this person is unlucky"). When the outcome disagrees with the
 * grade, the line owns it; when the data neither supports nor explains, it is omitted (null).
 * Returns `{ letter, text, based }` — `based` is "based on N reports" when N ≥ 5, else ''.
 * `name` is a first name the user chose to show; the default (none) says "Not the only one."
 */
export function contextStrip(company, grade, story = {}) {
  if (!grade || !grade.grade) return null;
  const co = String(company || '').trim() || 'They';
  const ghost = grade.ghostRate != null ? Math.round(Number(grade.ghostRate) * 100) : null;
  const resp = grade.responseRate != null ? Math.round(Number(grade.responseRate) * 100) : null;
  const wait = grade.avgWaitDays != null ? Math.round(Number(grade.avgWaitDays)) : 0;
  const n = Math.max(0, Math.round(Number(grade.reports) || 0));
  const kind = outcomeKind(story.outcome);
  const days = story.days != null && Number.isFinite(Number(story.days)) ? Math.round(Number(story.days)) : null;
  const name = String(story.name || '').trim();
  const highReply = resp != null && resp >= 60;
  const lowReply = ghost != null && ghost >= 30;
  // A long company name would push the line past the card (never "…"): "They" instead.
  const they = co.length > 14;
  const replies = they ? `They reply to ${resp}% of applicants.` : `${co} replies to ${resp}% of applicants.`;
  const ghosts = they ? `They ghost ${ghost}% of applicants.` : `${co} ghosts ${ghost}% of applicants.`;
  let text = null;
  if (kind === 'ghosted' || kind === 'waiting') {
    if (lowReply) text = `${ghosts} ${name ? `${name} is not alone.` : 'Not the only one.'}`;
    else if (highReply) text = `${replies} Not this time.`;
  } else if (kind === 'rejected') {
    if (lowReply) text = `${ghosts} At least this was an answer.`;
    else if (highReply) text = replies;
  } else {
    // hired / interview: a fast yes at a slow company is the story; otherwise the reply rate.
    const slow = wait >= 21 && (days == null || days < wait);
    if (slow) text = `Most applicants wait ${Math.floor(wait / 7)}+ weeks here.`;
    else if (highReply) text = replies;
    else if (lowReply) text = ghosts;
  }
  if (!text) return null;
  return { letter: String(grade.grade), text, based: n >= 5 ? `based on ${n.toLocaleString('en-US')} reports` : '' };
}

// ── Timeline ─────────────────────────────────────────────────────────────────────────────

const EVENT_LABEL = {
  application_submitted: 'Applied',
  response_received: 'Reply',
  assessment_received: 'Assessment',
  interview_received: 'Interview',
  interview_completed: 'Interviewed',
  offer_received: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrew',
};
const MIDDLE_PRIORITY = ['interview_completed', 'interview_received', 'assessment_received', 'response_received'];

const shortDate = (ms) => formatPacific(new Date(ms), { month: 'short', day: 'numeric' });

/**
 * The tracked events as day offsets from applying, for the hero grid: [{ day, kind }] with kind
 * 'reply' (response/assessment) or 'interview'. Decision days are drawn by the grid itself.
 */
export function eventDays(events, appliedMs) {
  if (!Array.isArray(events) || !Number.isFinite(appliedMs)) return [];
  const out = [];
  for (const e of events) {
    if (!e || !Number.isFinite(e.date)) continue;
    const kind = e.type === 'interview_received' || e.type === 'interview_completed' ? 'interview'
      : e.type === 'response_received' || e.type === 'assessment_received' ? 'reply' : null;
    if (!kind) continue;
    const day = Math.max(0, Math.round((e.date - appliedMs) / 86400000));
    if (!out.some(o => o.day === day)) out.push({ day, kind });
  }
  return out.sort((a, b) => a.day - b.day);
}

/**
 * ONE line of what actually happened, from the tracker's events: "Applied Oct 3 · Interview
 * Oct 7 · Offer Oct 15" (≤ 3 stops, never "…"). Ghosted: "Applied Oct 1 · no reply since".
 * Waiting: "Applied Oct 1 · waiting". '' when nothing is known. Dates are California days.
 */
export function timelineLine(events, { outcome, appliedMs } = {}) {
  const evs = (Array.isArray(events) ? events : []).filter(e => e && Number.isFinite(e.date) && EVENT_LABEL[e.type]);
  const applied = evs.find(e => e.type === 'application_submitted')?.date ?? (Number.isFinite(appliedMs) ? appliedMs : null);
  if (applied == null) return '';
  const kind = outcomeKind(outcome);
  const stops = [`Applied ${shortDate(applied)}`];
  const decision = evs.filter(e => e.type === 'offer_received' || e.type === 'rejected' || e.type === 'withdrawn').sort((a, b) => b.date - a.date)[0];
  const middles = evs.filter(e => MIDDLE_PRIORITY.includes(e.type) && e.date >= applied && (!decision || e.date <= decision.date));
  // Room for two more stops: the decision (when there is one) and the most telling middle step.
  const room = 3 - stops.length - (decision ? 1 : 0) - (kind === 'ghosted' || kind === 'waiting' ? 1 : 0);
  const chosen = middles
    .sort((a, b) => MIDDLE_PRIORITY.indexOf(a.type) - MIDDLE_PRIORITY.indexOf(b.type) || b.date - a.date)
    .slice(0, Math.max(0, room))
    .sort((a, b) => a.date - b.date);
  for (const e of chosen) stops.push(`${EVENT_LABEL[e.type]} ${shortDate(e.date)}`);
  if (decision) stops.push(`${EVENT_LABEL[decision.type]} ${shortDate(decision.date)}`);
  else if (kind === 'ghosted') stops.push(chosen.length ? 'silent since' : 'no reply since');
  else if (kind === 'waiting') stops.push('waiting');
  return stops.join(' · ');
}

// Deterministic pick so one application always posts the same sentence while companies vary.
function pick(list, seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/**
 * The post text under a shared outcome card. First sentence: the person's fact. Second: a plain
 * observation from the data (the company's real rate when it has a grade). The product appears
 * ONCE, as the bare URL at the end (or "on seenjobs.io" when comparing to other tracked
 * companies). No tagline about Seen, no dashes, under 240 characters (pinned by test).
 * `grade` = the company's { ghostRate, responseRate, grade } when it has one; `others` = letter
 * grades of the person's other tracked companies, when known.
 * @param {{ outcome: string, company: string, days?: number|null, reachedInterview?: boolean,
 *   grade?: { grade?: string, ghostRate?: number|null, responseRate?: number|null } | null,
 *   others?: string[] | null }} input
 */
export function outcomeShareText({ outcome, company, days, reachedInterview, grade = null, others = [] }) {
  const name = String(company || 'They').trim() || 'They';
  const url = companyUrl(company);
  const kind = outcomeKind(outcome);
  const d = hasDays(days) ? Math.max(0, Math.round(Number(days))) : null;
  const count = d != null ? dayCount(d) : null;
  const ghost = grade && grade.ghostRate != null ? Math.round(Number(grade.ghostRate) * 100) : null;
  const resp = grade && grade.responseRate != null ? Math.round(Number(grade.responseRate) * 100) : null;
  const letter = grade && grade.grade ? String(grade.grade) : '';
  const otherLetters = Array.isArray(others) ? others.map(o => String(o || '').trim().toUpperCase()).filter(o => /^[A-F]$/.test(o)) : [];
  const worstOther = otherLetters.length ? otherLetters.slice().sort()[otherLetters.length - 1] : '';
  const bestOther = otherLetters.length ? otherLetters.slice().sort()[0] : '';
  let options;
  if (kind === 'ghosted' && reachedInterview) {
    options = ghost != null ? [
      `Interviewed at ${name}, then nothing${count ? ` for ${count}` : ''}. ${ghost}% of people get ghosted there, so I guess that tracks: ${url}`,
      `${name} interviewed me and went quiet${count ? `, ${count} now` : ''}. Apparently ${ghost}% of applicants never hear back: ${url}`,
    ] : [
      `Interviewed at ${name}, then nothing${count ? ` for ${count}` : ''}. Logged the whole thing here: ${url}`,
      `${name} interviewed me and went quiet${count ? `, ${count} now` : ''}. Wrote it all down: ${url}`,
    ];
  } else if (kind === 'ghosted' && d != null && d < GHOST_MIN_DAYS) {
    options = ghost != null ? [
      `Applied to ${name} ${count} ago, nothing yet. ${ghost}% of people say they got ghosted there: ${url}`,
    ] : [
      `Applied to ${name} ${count} ago, nothing yet. Nobody has rated them, so I'm tracking it: ${url}`,
    ];
  } else if (kind === 'ghosted') {
    options = ghost != null ? [
      `Applied to ${name}${count ? ` ${count} ago` : ''}, nothing. Apparently ${ghost}% of people get ghosted there: ${url}`,
      `${count ? `${count} and n` : 'N'}ot a word from ${name}. ${ghost}% of applicants never hear back from them: ${url}`,
    ] : [
      `Applied to ${name}${count ? ` ${count} ago` : ''}, nothing. Tracked it so I'd stop guessing: ${url}`,
      `${count ? `${count} and n` : 'N'}ot a word from ${name}. Wrote it down here: ${url}`,
    ];
  } else if (kind === 'rejected') {
    options = resp != null ? [
      `${name} said no${d != null ? ` ${inDays(d)}` : ''}. At least they said something, ${resp}% of people hear back there: ${url}`,
      `A no from ${name}${count ? ` after ${count}` : ''}. I'd rather know. ${resp}% of applicants get an answer there: ${url}`,
    ] : [
      `${name} said no${d != null ? ` ${inDays(d)}` : ''}. At least they said something: ${url}`,
      `A no from ${name}${count ? ` after ${count}` : ''}. I'd rather know. Logged it: ${url}`,
    ];
  } else if (kind === 'hired') {
    const fact = d != null ? `${count}, offer, ${name}.` : `Offer from ${name}.`;
    options = worstOther ? [
      `${fact} The other ${otherLetters.length === 1 ? 'place' : `${otherLetters.length} places`} I applied ${otherLetters.length === 1 ? 'was' : 'were'} ${bestOther === worstOther ? `a ${worstOther}` : `a ${worstOther} or worse`} on seenjobs.io`,
    ] : letter ? [
      `${fact} ${name} was ${/^[AEF]$/.test(letter) ? 'an' : 'a'} ${letter}: ${url}`,
      `Got the offer from ${name}${count ? `, ${count} after applying` : ''}. They were ${/^[AEF]$/.test(letter) ? 'an' : 'a'} ${letter}: ${url}`,
    ] : [
      `${fact} Tracked every step: ${url}`,
      `Got the offer from ${name}${count ? `, ${count} after applying` : ''}. Tracked every step: ${url}`,
    ];
  } else if (kind === 'interview') {
    options = resp != null ? [
      `${name} called back${d != null ? ` ${inDays(d)}` : ''}. ${resp}% of people hear back there: ${url}`,
    ] : [
      `${name} called back${d != null ? ` ${inDays(d)}` : ''}. Logging every application now: ${url}`,
    ];
  } else {
    options = resp != null ? [
      `Applied to ${name}${count ? ` ${count} ago` : ''}, still waiting. ${resp}% of people hear back there, so maybe: ${url}`,
    ] : [
      `Applied to ${name}${count ? ` ${count} ago` : ''}, still waiting: ${url}`,
    ];
  }
  const chosen = pick(options, name);
  if (chosen.length <= 240) return chosen;
  return options.slice().sort((a, b) => a.length - b.length)[0];
}

// ── Company card ─────────────────────────────────────────────────────────────────────────

/** The one-sentence verdict the company page shows, dash-free. Rates are 0–1. */
export function companyVerdict({ ghostRate, responseRate }) {
  const ghost = Number(ghostRate) || 0;
  const resp = Number(responseRate) || 0;
  const ghostPct = Math.round(ghost * 100);
  const respPct = Math.round(resp * 100);
  if (ghost >= 0.5) return `Most applicants never hear back. ${Math.round(ghost * 10)} in 10 are ghosted.`;
  if (resp >= 0.75) return `Most applicants hear back. ${respPct}% get a response.`;
  return `Mixed: about ${respPct}% of applicants hear back, ${ghostPct}% are ghosted.`;
}

/**
 * "13% · ghost rate", "87% · hear back", "9-day · typical wait". A wait of 0 / unknown is left
 * out (never printed as a dash).
 */
export function companyStatPairs({ ghostRate, responseRate, avgWaitDays }) {
  const pairs = [
    { value: `${Math.round((Number(ghostRate) || 0) * 100)}%`, label: 'ghost rate' },
    { value: `${Math.round((Number(responseRate) || 0) * 100)}%`, label: 'hear back' },
  ];
  const wait = Math.round(Number(avgWaitDays) || 0);
  if (wait > 0) pairs.push({ value: `${wait}-day`, label: 'typical wait' });
  return pairs;
}

/** "Based on 48 applicant reports · updated Oct 19, 2026". `updated` is the already formatted date. */
export function confidenceLine(reportCount, updated) {
  const n = Math.max(0, Math.round(Number(reportCount) || 0));
  const when = updated ? ` · updated ${String(updated).replace(/^(last )?updated\s+/i, '')}` : '';
  if (n === 0) return `Baseline estimate. Share your experience to sharpen it.${when}`;
  return `Based on ${n.toLocaleString('en-US')} applicant ${n === 1 ? 'report' : 'reports'}${when}`;
}

/** The post text under a shared company card. */
export function companyShareText({ company, grade, score, ghostRate, responseRate, risk }) {
  const name = String(company || 'This company').trim() || 'This company';
  const url = companyUrl(company);
  const ghost = Math.round((Number(ghostRate) || 0) * 100);
  const resp = Math.round((Number(responseRate) || 0) * 100);
  const s = Math.round(Number(score) || 0);
  const g = grade ? String(grade) : '';
  const r = risk || (s >= 70 ? 'safe' : s >= 40 ? 'warn' : 'danger');
  let text;
  if (r === 'danger') text = `${name} ghosts ${ghost}% of applicants. Grade ${g}, ${s}/100. Look before you apply: ${url}`;
  else if (r === 'warn') text = `${name} is a ${g}, ${s}/100. ${ghost}% of applicants get ghosted. Check before you apply: ${url}`;
  else text = `${name} actually replies. ${resp}% of applicants hear back, grade ${g}. Check before you apply: ${url}`;
  return text;
}

// ── Unfurl + page metadata ────────────────────────────────────────────────────────────────

/**
 * The two lines of the OG image for a company nobody has graded yet. The second line claims
 * only what the score row proves: with real reports it counts them ("2 applicant reports so
 * far, not enough for a grade."); with none it just says "Be the first." — never that someone
 * tracked an application here (nothing in the route knows that).
 */
export function ogNoDataLines(company, reports = 0) {
  const name = String(company || 'this company').trim() || 'this company';
  const n = Math.max(0, Math.round(Number(reports) || 0));
  return [
    `Nobody has graded how ${name} treats applicants yet.`,
    n >= 1 ? `${n} applicant ${n === 1 ? 'report' : 'reports'} so far, not enough for a grade.` : 'Be the first.',
  ];
}

// ── Company page <title> and <meta description> ───────────────────────────────────────────
// Built around what people actually type (Google Ads keyword data, Oct 2026): "<employer>
// application status" (Walmart 8,100 a month) and "<employer> hiring process", not "does <x>
// ghost applicants" (too small to report). The numbers come from ONE set of facts
// (lib/companyMeta.ts companyMetaFacts), the same the page, FAQ and OG card show.

/** Longest bare <title> we aim for; the root layout appends " | Seen". */
export const TITLE_MAX = 60;

const reportsWord = (n, long) => `${n.toLocaleString('en-US')} ${long ? 'applicant ' : ''}${n === 1 ? 'report' : 'reports'}`;

/**
 * <title> for /company/[slug]. Graded: "Walmart application status: who hears back (48 reports)",
 * the longest form that fits TITLE_MAX, falling back to "<name> application status" for long
 * names. Not graded: "<name> application status on Seen" (those pages are kept out of the index).
 */
export function pageTitle({ company, reports, graded }) {
  const name = String(company || 'This company').trim() || 'This company';
  if (!graded) return `${name} application status on Seen`;
  const n = Math.max(0, Math.round(Number(reports) || 0));
  const forms = n > 0
    ? [
        `${name} application status: who hears back (${reportsWord(n, true)})`,
        `${name} application status: who hears back (${reportsWord(n, false)})`,
        `${name} application status (${reportsWord(n, true)})`,
        `${name} application status (${reportsWord(n, false)})`,
      ]
    : [`${name} application status: who hears back`];
  return forms.find((t) => t.length <= TITLE_MAX) || `${name} application status`;
}

/**
 * Meta description for /company/[slug]: the answer first, then where it comes from.
 * @param {{ company: string, graded: boolean, ratesShown: boolean, responsePct?: number|null,
 *   ghostPct?: number|null, grade?: string|null, score?: number|null, basis: string,
 *   reports: number, waitDays?: number|null, updated?: string, minReports: number }} f
 *   `basis` is "48 applicant reports and 32 online mentions"; `updated` is "Oct 2026" or ''.
 */
export function pageDescription(f) {
  const name = String(f.company || 'This company').trim() || 'This company';
  const when = f.updated ? `, updated ${f.updated}` : '';
  const claims = 'Applicants\' own accounts, not verified facts.';
  const wait = Math.round(Number(f.waitDays) || 0);
  if (f.graded && f.ratesShown && f.responsePct != null && f.ghostPct != null) {
    return `${f.responsePct}% of applicants hear back from ${name}; ${f.ghostPct}% never do. From ${f.basis}${when}.`
      + (wait > 0 ? ` Average wait to hear back: ${dayCount(wait)}.` : '')
      + ` Seen Grade ${f.grade} (${f.score}/100). ${claims}`;
  }
  if (f.graded) {
    return `${name} has a Seen Grade of ${f.grade} (${f.score}/100) from ${f.basis}${when}. Too few applicant reports for a response rate yet (${f.minReports} needed). ${claims}`;
  }
  const n = Math.max(0, Math.round(Number(f.reports) || 0));
  return `${name} is not graded on Seen yet (${reportsWord(n, true)} so far; a grade needs ${f.minReports} pieces of evidence). See what applicants report about its hiring process: response time, interview rounds and ghosting.`;
}
