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
  else if (kind === 'hired') rest = d != null ? ` said yes ${inDays(d)}.` : ' said yes.';
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

/** "Cosmetics Cashier · applied via Indeed" — a missing part is dropped, never a blank. */
export function subLine(role, platform) {
  const r = String(role || '').trim();
  const p = String(platform || '').trim();
  if (r && p) return `${r} · applied via ${p}`;
  if (r) return r;
  if (p) return `applied via ${p}`;
  return '';
}

/** "OCT 2026 · PHOENIX, AZ" (city omitted when unknown). Month on the California calendar. */
export function metaLine(dateMs, city) {
  const when = Number.isFinite(dateMs) ? formatPacific(new Date(dateMs), { month: 'short', year: 'numeric' }) : '';
  const where = String(city || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return [when, where].filter(Boolean).join(' · ').toUpperCase();
}

/**
 * The one-line context strip under the hero, only when the company HAS a Seen grade.
 * Returns `{ before, letter, after }` so the kit can set the letter in a tag.
 */
export function contextStrip(company, grade) {
  if (!grade || !grade.grade) return null;
  const ghost = grade.ghostRate != null ? Math.round(Number(grade.ghostRate) * 100) : null;
  const resp = grade.responseRate != null ? Math.round(Number(grade.responseRate) * 100) : null;
  const after = ghost != null ? ` · ${ghost}% of applicants get ghosted`
    : resp != null ? ` · ${resp}% of applicants hear back` : '';
  return { before: `${String(company || '').trim()} · Seen grade `, letter: String(grade.grade), after };
}

// Deterministic pick so one application always posts the same sentence while companies vary.
function pick(list, seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/**
 * The post text under a shared outcome card. First person, specific, a reason to tap, the
 * URL last and bare. Under 240 characters (pinned by test).
 */
export function outcomeShareText({ outcome, company, days, reachedInterview }) {
  const name = String(company || 'They').trim() || 'They';
  const url = companyUrl(company);
  const kind = outcomeKind(outcome);
  const d = hasDays(days) ? Math.max(0, Math.round(Number(days))) : null;
  const count = d != null ? dayCount(d) : null;
  let options;
  if (kind === 'ghosted' && reachedInterview) {
    options = [
      `${name} interviewed me, then went silent.${count ? ` ${count} now.` : ''} Seen tracks who follows through and who ghosts: ${url}`,
      `Had the interview at ${name}. Then nothing${count ? `, ${count} and counting` : ''}. I log every application on Seen so this stops being a mystery: ${url}`,
    ];
  } else if (kind === 'ghosted' && d != null && d < GHOST_MIN_DAYS) {
    options = [
      `${name} hasn't written back yet. ${count} so far. I'm tracking it on Seen, which shows who replies and who ghosts: ${url}`,
      `Applied to ${name} ${count} ago, nothing yet. Seen keeps score on who actually writes back: ${url}`,
    ];
  } else if (kind === 'ghosted') {
    options = [
      `${name} never wrote back.${count ? ` ${count} and counting.` : ''} I'm tracking every application on Seen so I know who actually replies: ${url}`,
      `${count ? `${count}, not a word` : 'Not a word'} from ${name}. I track every application on Seen now, so I know who replies and who disappears: ${url}`,
      `Applied to ${name}.${count ? ` ${count} of silence.` : ' Silence.'} Seen keeps score on who actually writes back: ${url}`,
    ];
  } else if (kind === 'rejected') {
    options = [
      `${name} said no${d != null ? ` ${inDays(d)}` : ''}. At least they said something. Seen shows which companies reply and which ghost: ${url}`,
      `A no from ${name}${count ? ` after ${count}` : ''}. Fine, I'd rather know. Seen keeps score on who replies and who ghosts: ${url}`,
      `${name} passed on me${d != null ? ` ${inDays(d)}` : ''}. Quick, at least. I track all of it on Seen so the next person knows what to expect: ${url}`,
    ];
  } else if (kind === 'hired') {
    options = [
      `${name} said yes${d != null ? ` ${inDays(d)}` : ''}. I tracked the whole thing on Seen. Check any company's ghost rate before you apply: ${url}`,
      `Got the offer from ${name}${count ? `, ${count} after applying` : ''}. Tracked every step on Seen. See how any company treats applicants: ${url}`,
      `${name} hired me${d != null ? ` ${inDays(d)}` : ''}. Seen tracked it start to finish. Look up who replies and who ghosts before your next application: ${url}`,
    ];
  } else if (kind === 'interview') {
    options = [
      `${name} called back${d != null ? ` ${inDays(d)}` : ''}. Seen is keeping score on who replies: ${url}`,
      `Interview at ${name}${count ? `, ${count} after applying` : ''}. I track every application on Seen, so I know who actually responds: ${url}`,
    ];
  } else {
    options = [
      `Applied to ${name}${count ? ` ${count} ago` : ''}, still waiting. Seen shows who replies and who ghosts: ${url}`,
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
  if (r === 'danger') text = `${name} ghosts ${ghost}% of applicants. Seen grade ${g}, ${s}/100. Look before you apply: ${url}`;
  else if (r === 'warn') text = `${name} scores ${s}/100 on Seen, grade ${g}. ${ghost}% of applicants get ghosted. Check before you apply: ${url}`;
  else text = `${name} actually replies. ${resp}% of applicants hear back, Seen grade ${g}. Check any company before you apply: ${url}`;
  return text;
}

// ── Unfurl + page metadata ────────────────────────────────────────────────────────────────

/** The two lines of the OG image for a company nobody has graded yet. */
export function ogNoDataLines(company) {
  const name = String(company || 'this company').trim() || 'this company';
  return [
    `Nobody has rated how ${name} treats applicants yet.`,
    'Someone just tracked an application here. Be the first to grade them.',
  ];
}

/** <title> for /company/[slug]: graded "Walmart: Seen grade A, 13% ghost rate", else "Walmart on Seen: who replies, who ghosts". */
export function pageTitle({ company, grade, ghostRate }) {
  const name = String(company || 'This company').trim() || 'This company';
  if (grade && ghostRate != null) return `${name}: Seen grade ${grade}, ${Math.round(Number(ghostRate) * 100)}% ghost rate`;
  return `${name} on Seen: who replies, who ghosts`;
}

/** Meta description for /company/[slug], specific when graded, honest when not. */
export function pageDescription({ company, grade, ghostRate, responseRate, reports }) {
  const name = String(company || 'This company').trim() || 'This company';
  if (grade && ghostRate != null) {
    const ghost = Math.round(Number(ghostRate) * 100);
    const resp = responseRate != null ? Math.round(Number(responseRate) * 100) : null;
    const n = Math.max(0, Math.round(Number(reports) || 0));
    const from = n > 0 ? `, from ${n.toLocaleString('en-US')} applicant ${n === 1 ? 'report' : 'reports'} on Seen` : ' on Seen';
    const replies = resp != null ? `replies to ${resp}% of applicants and ghosts ${ghost}%` : `ghosts ${ghost}% of applicants`;
    return `${name} ${replies}${from}. See the grade, the typical wait and real outcomes before you apply.`;
  }
  return `Nobody has graded how ${name} treats applicants yet. Seen tracks who replies and who ghosts, from real applications. Be the first to report what happened with yours.`;
}
