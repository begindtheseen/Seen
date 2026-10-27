// Interview Prep (owner decision 2026-10-25, after a four-persona willingness-to-pay test: 0 of 4
// would pay for "unlimited AI"; all 4 named the moment an application reaches an interview).
//
// Two halves, kept apart on purpose:
//   - FREE, from Seen's own data: what applicants report about interviews at this company (how many
//     accounts, what happened after the interview, rounds, wait), a follow-up schedule and the pay
//     range from the company's own listings. Shown to everyone the moment a card reaches Interview.
//   - PAID (Interview Prep, or any Pro access): likely questions for this role, answers built ONLY
//     from the person's résumé, a 30-second intro, a thank-you and a follow-up email.
//
// Truth rules: Seen holds no reported interview QUESTIONS, so questions are labelled as prepared by
// Seen for the role, never as "what applicants were asked". Every number in a generated answer or
// intro must appear in the résumé, or the answer is replaced by a coached one built from a real
// résumé bullet (guardPack). Emails are templates — the model never writes facts into them.

import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { excludedSource } from '../reports/excludedSources.js';
import { parseResume } from '../resume/parse/index.js';
import { bankQuestions, storyQuestion } from './interviewQuestionBank.js';
import { roleHistory, claimsOk, premiseOk, digitize, stripDurations, trimRelativeYears, jobOf, mergeSplitHeaders } from './prepClaims.js';
import { factSheet, factSheetText, bulletById } from './prepFacts.js';

// Generic title words never decide the field when a field word is present ("Marketing Coordinator").
const GENERIC_TITLE_RE = /\b(coordinator|assistant|associate|specialist|representative|rep|lead|senior|junior|sr|jr|i{1,3}|intern)\b/gi;
export function prepFamily(title) {
  // Nurses are patient-care, whatever else the title says ("Registered Nurse – Telemetry (Nights)").
  if (/\b(nurse|rn|lpn|lvn|cna|nursing assistant|medical assistant|caregiver|patient care)\b/i.test(String(title || ''))) return 'healthcare_support';
  const stripped = String(title || '').replace(GENERIC_TITLE_RE, ' ').replace(/\s+/g, ' ').trim();
  const byField = stripped ? detectRoleFamily(stripped, '').family : 'general';
  return byField !== 'general' ? byField : detectRoleFamily(title || '', '').family;
}

/** Tracker stages that mean "you have an interview". */
export const INTERVIEW_STAGES = ['Phone Screen', 'Interview', 'Final Round'];
export function isInterviewStage(stage) {
  return INTERVIEW_STAGES.includes(String(stage || ''));
}

// A report is about an interview when its outcome implies one, or its text names one.
const INTERVIEW_TEXT_RE = /\b(interview(?:ed|s|ing)?|phone screen|on-?site|final round|second round|panel|hirevue|loop|recruiter (?:call|screen))\b/i;
const POST_INTERVIEW_OUTCOMES = new Set(['interview', 'interviewing', 'offer', 'hired']);

function median(nums) {
  const v = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

// "… text … [Source: https://…]" / "[Public teamblind.com post: https://…]" → { text, url }.
export function splitSource(reportText) {
  const raw = String(reportText || '');
  const m = raw.match(/\[(?:Source|Public [^\]:]+?):\s*(https?:\/\/[^\s\]]+)\s*\]/i);
  const text = raw.replace(/\s*\[(?:Source|Public [^\]]+?)[^\]]*\]\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  return { text, url: m ? m[1] : null };
}

function sourceHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// What applicants to this company say the process involved — read from Seen's own accounts, never invented.
// Each signal needs the phrase in an account's own words; the count is how many accounts mention it.
const PROCESS_SIGNALS = [
  ['a video interview (HireVue or similar)', /\b(?:hirevue|hire vue|video interview|recorded (?:video )?interview|one[- ]way (?:video )?interview|pre-?recorded)\b/i],
  ['an online assessment or test', /\b(?:online assessment|assessment test|aptitude test|skills? test|pre-?employment test|personality test|situational judg[e]?ment|work sample|coding (?:test|challenge|assessment)|hackerrank|codility|take[- ]home)\b/i],
  ['a phone or recruiter screen first', /\b(?:phone screen|recruiter (?:screen|call|phone)|screening call|initial call|intro call)\b/i],
  ['a panel interview', /\b(?:panel interview|panel of|interviewed by (?:two|three|four|\d+) people|in front of (?:two|three|several))\b/i],
  ['a group interview', /\b(?:group interview|group session|group setting)\b/i],
  ['several rounds', /\b(?:(?:second|third|final|2nd|3rd) round|(?:three|four|five|\d+) rounds|multiple rounds|onsite loop|the loop)\b/i],
  ['a working interview or trial shift', /\b(?:working interview|trial shift|stage shift|a stage|shadow(?:ing)? shift|tryout)\b/i],
  ['a presentation or case exercise', /\b(?:case (?:study|interview)|presentation|mock (?:call|pitch|lesson|demo)|demo lesson|role[- ]play)\b/i],
  ['a background check', /\b(?:background check|background screening)\b/i],
  ['a drug test', /\b(?:drug (?:test|screen(?:ing)?)|urine test)\b/i],
  ['a same-day or on-the-spot offer', /\b(?:offer(?:ed)? (?:on the spot|same day|that day|right there)|hired on the spot|same[- ]day offer)\b/i],
];
export function processSignals(rows) {
  const counts = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const text = String(r?.report_text || '');
    if (!text) continue;
    for (const [label, re] of PROCESS_SIGNALS) if (re.test(text)) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
}

/**
 * What Seen's reports say about interviews at one company.
 * @param {Array<{outcome:string, rounds?:number, wait_days?:number, report_text?:string, role?:string, platform?:string, ghost_stage?:string}>} rows
 *   scorable reports for the company (the caller filters with SCORABLE_REPORTS_FILTER)
 * @param {{ role?: string }} [opts]
 */
export function interviewRecord(rows, { role = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false;
    if (POST_INTERVIEW_OUTCOMES.has(r.outcome)) return true;
    if (/interview|loop/i.test(String(r.ghost_stage || ''))) return true;
    return INTERVIEW_TEXT_RE.test(String(r.report_text || ''));
  });
  const after = { offer: 0, rejected: 0, ghosted: 0, waiting: 0 };
  for (const r of list) {
    if (r.outcome === 'offer' || r.outcome === 'hired') after.offer++;
    else if (r.outcome === 'rejected') after.rejected++;
    else if (r.outcome === 'ghosted') after.ghosted++;
    else after.waiting++;
  }
  const resolved = after.offer + after.rejected + after.ghosted;
  const rounds = median(list.map((r) => Number(r.rounds)).filter((n) => n > 0 && n <= 12));
  const waitDays = median(list.map((r) => Number(r.wait_days)).filter((n) => n > 0 && n <= 180));

  // Quotes: short, readable accounts, the role-matching ones first. Never more than three.
  // Round-2 test: a marketing applicant was shown a Data Analyst, a Software Engineer and a Recruiter
  // account sourced from glassdoor.* — a source the owner excluded. Excluded sources are never quoted, and
  // an account from a different, known role family is never quoted (it can still be counted above).
  const roleWords = String(role || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const targetFam = prepFamily(role);
  const quotes = list
    .map((r) => ({ r, ...splitSource(r.report_text) }))
    .filter((q) => q.text.length >= 40 && q.text.length <= 420 && INTERVIEW_TEXT_RE.test(q.text))
    .filter((q) => !(q.url && excludedSource(q.url)) && !/glassdoor|indeed/i.test(String(q.r.platform || '')))
    .filter((q) => {
      if (!q.r.role || targetFam === 'general') return true;
      const fam = prepFamily(q.r.role);
      return fam === 'general' || fam === targetFam;
    })
    .map((q) => ({ ...q, roleHit: roleWords.some((w) => `${q.r.role || ''} ${q.text}`.toLowerCase().includes(w)) }))
    .sort((a, b) => Number(b.roleHit) - Number(a.roleHit))
    .slice(0, 3)
    .map((q) => ({ text: q.text, role: q.r.role || null, outcome: q.r.outcome, source: q.url ? sourceHost(q.url) : (q.r.platform || null), url: q.url }));

  return {
    accounts: list.length,
    after,
    resolved,
    // what the accounts say the process involved (video interview, assessment, panel, several rounds…)
    process: processSignals(list),
    ghostedAfterInterviewPct: resolved >= 3 ? Math.round((after.ghosted / resolved) * 100) : null,
    offerAfterInterviewPct: resolved >= 3 ? Math.round((after.offer / resolved) * 100) : null,
    rounds,
    waitDays,
    quotes,
  };
}

// ── Follow-up schedule ────────────────────────────────────────────────────────────────────────────
function addBusinessDays(ms, n) {
  const d = new Date(ms);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d.toISOString();
}

/** Thank-you the same day, a follow-up after 5 business days, a last check after 10. */
export function followUpPlan(interviewAtIso, nowMs = Date.now()) {
  const t = Date.parse(interviewAtIso || '');
  const base = Number.isFinite(t) ? t : nowMs;
  return {
    thankYouBy: new Date(base + 24 * 3600e3).toISOString(),
    followUpOn: addBusinessDays(base, 5),
    lastCheckOn: addBusinessDays(base, 10),
  };
}

// ── Pay range from the company's own listings ────────────────────────────────────────────────────
function pct(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/**
 * A listing's pay text as numbers: "$111k", "$168k–$227k", "$21–$34/hr", "$55,000 - $65,000 a year".
 * Returns { lo, hi } in the text's own unit, or null.
 */
export function parseSalaryText(text) {
  const t = String(text || '').toLowerCase().replace(/,/g, '');
  const nums = [...t.matchAll(/\$\s?(\d+(?:\.\d+)?)\s?(k)?/g)].map((m) => Number(m[1]) * (m[2] ? 1000 : 1)).filter((n) => n > 0);
  if (!nums.length) return null;
  return { lo: nums[0], hi: nums[1] || nums[0] };
}

/**
 * Pay from listings with salary_min/salary_max (or a salary text). Hourly (< 200) and yearly figures are never mixed;
 * the unit with more listings wins. Needs at least 3 listings, else null.
 */
export function payRange(jobs, { unit = null } = {}) {
  const hourly = [];
  const yearly = [];
  for (const j of Array.isArray(jobs) ? jobs : []) {
    const parsed = (j?.salary_min == null && j?.salary_max == null) ? parseSalaryText(j?.salary) : null;
    const lo = parsed ? parsed.lo : Number(j?.salary_min);
    const hi = parsed ? parsed.hi : Number(j?.salary_max);
    const vals = [lo, hi].filter((n) => Number.isFinite(n) && n > 0);
    if (!vals.length) continue;
    const mid = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mid < 200) hourly.push(mid); else if (mid >= 10000 && mid <= 1_000_000) yearly.push(mid);
  }
  // a salaried field never reads "130" as $130 an hour (a listing that stores $130k as 130)
  const pick = unit === 'year' ? { unit: 'year', v: yearly } : hourly.length >= yearly.length ? { unit: 'hour', v: hourly } : { unit: 'year', v: yearly };
  if (pick.v.length < 3) return null;
  const s = pick.v.sort((a, b) => a - b);
  const round = (n) => (pick.unit === 'hour' ? Math.round(n * 2) / 2 : Math.round(n / 1000) * 1000);
  return { unit: pick.unit, low: round(pct(s, 0.25)), high: round(pct(s, 0.75)), listings: s.length };
}

// ── Résumé facts ─────────────────────────────────────────────────────────────────────────────────
const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|K\b|m\b|M\b)?/g;
const normNum = (s) => String(s).toLowerCase().replace(/[\s,$]/g, '');

/** Every number-like token in a text, normalized ("$1,200" → "1200", "92 %" → "92%"). */
export function numbersIn(text) {
  const t = String(text || '').replace(/\b(?:30|60|90)[-\s]second\b/gi, ' ').replace(/\b(?:24|48)[-\s]hours?\b/gi, ' ');
  return (t.match(NUM_RE) || []).map(normNum).filter((n) => /\d/.test(n));
}

/**
 * True when every number in `text` also appears in the résumé. Spoken numbers count ("ninety-four
 * percent" is 94%). Lengths of time ("5 years") are not résumé text; claimsOk checks them against the
 * résumé's dates.
 */
export function numbersBacked(text, resumeText) {
  const have = new Set(numbersIn(digitize(resumeText)).flatMap((n) => [n, n.replace(/%$/, '')]));
  return numbersIn(stripDurations(digitize(text))).every((n) => have.has(n) || have.has(n.replace(/%$/, '')));
}

/** Résumé bullets worth telling as stories: action lines, metrics first, deduped. */
export function storyBullets(resumeText, limit = 6) {
  const lines = String(resumeText || '').split(/\r?\n/).map((l) => l.replace(/^[\s•●▪◦*·\-–—]+/, '').trim());
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    if (l.length < 35 || l.length > 260) continue;
    if (!/^[A-Z]/.test(l) || /@|https?:\/\/|\bphone\b/i.test(l)) continue;
    if (!/\b[a-z]+ed\b|\b(led|ran|built|grew|cut|won|made|sold|kept|trained|handled|managed|resolved)\b/i.test(l)) continue;
    const key = l.toLowerCase().slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out.sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a))).slice(0, limit);
}

// ── Questions (deterministic core; the model may add role-specific ones) ──────────────────────────
function universalQuestions(company, role) {
  return [
    { q: 'Tell me about yourself.', why: 'Almost every interview opens with it. Use your 30-second intro above.' },
    { q: `Why do you want to work at ${company}?`, why: 'They want to hear you chose them, not just any job. Name one specific thing about them.' },
    { q: role ? `Why are you a good fit for the ${role} job?` : 'Why are you a good fit for this job?', why: 'Match two things they asked for to two things you have done.' },
    { q: 'Tell me about a time something went wrong at work and how you handled it.', why: 'A behavioral question: answer with what happened, what you did, and how it ended.' },
    { q: 'What questions do you have for us?', why: 'Always have two. Ask what success looks like in the first 90 days, and what the next step is.' },
  ];
}

/** The questions almost every first screen asks, whatever the role (round-2 test: none were in the pack). */
export function screenStaples(company, pay) {
  const range = pay ? (pay.unit === 'hour' ? `$${pay.low}–$${pay.high} an hour` : `$${Math.round(pay.low / 1000)}k–$${Math.round(pay.high / 1000)}k a year`) : null;
  return [
    { q: `What do you know about ${company}?`, why: 'They check you did your homework. Name what they sell, who their customers are, and one recent thing you read.' },
    { q: 'What are your pay expectations?', why: range ? (pay.scope === 'market' ? `The same job at other employers on Seen pays about ${range} (${company}'s own listings don't say). Give a range you would accept, not a single number.` : `${company}'s similar listings on Seen pay about ${range}. Give a range you would accept, not a single number.`) : 'Give a range you would accept, not a single number; check the posting and similar listings first.' },
    { q: 'When could you start, and what hours can you work?', why: 'Have a real answer: your notice period, your start date, and any schedule limits.' },
    { q: 'Why are you looking for a new job now?', why: 'Keep it short and forward-looking. If you were laid off, say so plainly in one sentence ("my role was cut in a restructuring") and move to what you want next — never complaints about a past employer.' },
  ];
}

/**
 * A 30-second intro built only from the résumé's own roles and best bullet, with one blank for the reason —
 * used whenever the model's intro fails the guard (round 2: the card promised an intro and showed none).
 */
export function fallbackIntro({ resumeText, role, company, nowMs = Date.now() }) {
  let doc = null;
  try { doc = parseResume({ text: String(resumeText || '') }); } catch { doc = null; }
  const exp = doc ? mergeSplitHeaders(doc.experience || []) : [];
  const roles = exp.filter((e) => e && (e.title || e.company));
  if (!roles.length) return null;
  // "Chicago Youth Arts Collective (nonprofit)" is said without its note
  const co = (e) => String(e.company || '').replace(/\s*\([^)]*\)/g, '').replace(/\.+$/, '').trim();
  // "an HVAC technician", "an RN", "a Store Manager".
  const a = (t) => { const w = String(t || '').trim().split(/\s+/)[0] || ''; return (/^[A-Z]{2,}/.test(w) ? /^[AEFHILMNORSX]/.test(w) : /^[aeiou]/i.test(w)) ? 'an' : 'a'; };
  const title = (e) => String(e.title || '').replace(/\s*\([^)]*\)/g, '').trim();
  const lower = (t) => String(t || '').replace(/^\s*[A-Z](?=[a-z])/, (c) => c.toLowerCase()).replace(/[.;\s]+$/, '');
  const ym = (d) => { const m = String(d || '').match(/^(\d{4})(?:-(\d{2}))?/); return m ? Number(m[1]) * 12 + Number(m[2] || 1) : null; };
  const nowYm = (() => { const d = new Date(nowMs); return d.getUTCFullYear() * 12 + d.getUTCMonth() + 1; })();
  // "2017 – 2026" with no month, written in 2026, is a job still held or one that ended this year — told as
  // current, never "Most recently I was" (round 4, Ray)
  const isNow = (e) => /present|current/i.test(String(e.end || '')) || (/^\d{4}$/.test(String(e.end || '').trim()) && Number(String(e.end).trim()) * 12 + 1 >= nowYm - 11);
  const fam = prepFamily(role);
  // the job told first is the most recent one in the target's field, else the most recent one (round 3: the
  // intro said "Before that, I was a Barista" for a barista job still held and started earlier)
  const inField = roles.find((e) => prepFamily(e.title) === fam && fam !== 'general');
  const f0 = prepFamily(roles[0].title);
  // the latest job leads unless it is a job in another known field (a barista job beside a marketing internship)
  const featured = inField && f0 !== fam && f0 !== 'general' ? inField : roles[0];
  const latestEnd = Math.max(...roles.map((e) => (isNow(e) ? nowYm : ym(e.end) || 0)));
  const featuredEnd = isNow(featured) ? nowYm : ym(featured.end) || 0;
  // the line with a result leads ("Grew Instagram followers from 2,100 to 3,400 …"), not the first duty
  const tellScore = (t) => (OUTCOME_RE.test(t) ? 2 : 0) + (/\d/.test(t) ? 1 : 0) + (/\bfrom\s+\$?[\d.,]+%?\s+to\s+\$?[\d.,]/i.test(t) ? 1 : 0);
  const best = storyBullets((featured.bullets || []).map((b) => b.text).join('\n'), 6).sort((x, y) => tellScore(y) - tellScore(x))[0] || featured.bullets?.[0]?.text;
  // a degree finished in the last year (or still under way) leads for someone early in their career
  const edu = (doc?.education || []).find((e) => e && (e.degree || e.field) && e.school);
  const eduEnd = edu ? ym(edu.end) : null;
  const recentGrad = edu && eduEnd && eduEnd >= nowYm - 12 && !roles.some((e) => /\b(?:manager|director|senior|lead|supervisor)\b/i.test(e.title || ''));
  const parts = [];
  if (recentGrad) {
    const deg = [edu.degree, edu.field].filter(Boolean).join(edu.degree && edu.field ? ' in ' : '');
    parts.push(eduEnd <= nowYm ? `I just finished ${a(deg)} ${deg} at ${edu.school}.` : `I'm finishing ${a(deg)} ${deg} at ${edu.school}.`);
  }
  const when = isNow(featured) ? "I'm" : (featuredEnd >= latestEnd && !recentGrad ? 'Most recently I was' : 'I was');
  const said = featured.title ? `${when} ${a(title(featured))} ${title(featured)}${co(featured) ? ` at ${co(featured)}` : ''}` : `${isNow(featured) ? "I'm at" : 'I worked at'} ${co(featured)}`;
  parts.push(`${said}${best ? `, where I ${lower(best).replace(/;\s+(best|top|biggest|highest|most)\b/i, ', and my $1')}` : ''}.`);
  // another job held now is "also", never "before that"
  const alsoNow = roles.find((e) => e !== featured && isNow(e));
  if (alsoNow && alsoNow.title) parts.push(`I also work as ${a(title(alsoNow))} ${title(alsoNow)}${co(alsoNow) ? ` at ${co(alsoNow)}` : ''}.`);
  else {
    const fs = ym(featured.start);
    const prev = roles.find((e) => e !== featured && !isNow(e) && (ym(e.end) || 0) <= (fs || 0));
    if (prev) parts.push(prev.title ? `Before that, I was ${a(title(prev))} ${title(prev)}${co(prev) ? ` at ${co(prev)}` : ''}.` : `Before that, I worked at ${co(prev)}.`);
  }
  parts.push(`I'm interested in the ${role || 'this'} role at ${company} because [the one thing that drew you to this job].`);
  return parts.join(' ');
}

// A résumé line that tells a story (an outcome), not a duty or a header.
const OUTCOME_RE = /\b(cut|reduced|lowered|saved|raised|grew|increased|improved|boosted|built|created|launched|automated|wrote|designed|trained|coached|mentored|precepted|named|awarded|won|recognized|promoted|resolved|opened|led)\b/i;
// A bullet that starts with what the person did, past or present ("Mentor 5 new reps", "Cut shrink…").
const VERB_START_RE = /^(?:[A-Z][a-z]+(?:ed|t)|Led|Ran|Built|Grew|Cut|Won|Made|Sold|Kept|Wrote|Set|Took|Found|Drove|Brought|Gave|Held|Met|Hit|Beat|Began|Taught|Caught|Care|Handle|Answer|Manage|Support|Train|Run|Lead|Serve|Prepare|Process|Teach|Plan|Coordinate|Maintain|Operate|Install|Diagnose|Repair|Assist|Help|Work|Mentor|Coach|Own|Build|Book|Design|Write|Create|Develop|Reconcile|Close|Sell|Prospect|Schedule|Supervise|Oversee|Monitor|Analy[sz]e|Report|Track|Resolve|Handle|Cook|Prep|Clean|Load|Pick|Pack|Drive|Deliver|Greet|Check|Verify|Document|Chart|Administer|Assess|Precept|Float)\b/;
const LEAD_TITLE_RE = /\b(lead|supervisor|manager|head|director|charge|foreman|captain|principal|senior|sr\.?)\b/i;
const LEADS_PEOPLE_RE = /\b(lead|led|supervis\w*|manag\w*|coach\w*|mentor\w*|train\w*|hired|schedul\w*|team of|crew of)\b/i;

/**
 * The résumé's best stories: real job bullets (never the summary, a header, a license or a date line),
 * outcomes and numbers first, recent jobs first, at most two from one job.
 */
export function resumeStories(resumeText, limit = 4, history = roleHistory(resumeText), role = '') {
  const lead = LEAD_TITLE_RE.test(role);
  const pool = history.flatMap((r, ri) => r.bullets.map((b) => ({ text: String(b).replace(/^[\s•●▪◦*·\-–—]+/, '').trim(), job: r, ri })))
    .filter((x) => x.text.length >= 25 && x.text.length <= 260 && VERB_START_RE.test(x.text))
    // Outcomes and numbers first, recent jobs well ahead of old part-time ones, and for a lead role the
    // lines about leading people (2026-10-25 grade: the 18-person team lost to a 6-associate line).
    .map((x) => ({ ...x, score: (/\d/.test(x.text) ? 2 : 0) + (OUTCOME_RE.test(x.text) ? 2 : 0) + (lead && LEADS_PEOPLE_RE.test(x.text) ? 2 : 0) + Math.max(-1, 2 - x.ri * 1.25) }))
    .sort((a, b) => b.score - a.score);
  const per = new Map();
  const out = [];
  for (const x of pool) {
    const k = x.job.company || x.job.title;
    if ((per.get(k) || 0) >= (x.ri === 0 ? 3 : 2)) continue;
    per.set(k, (per.get(k) || 0) + 1);
    out.push(x);
    if (out.length >= limit) break;
  }
  if (out.length) return out;
  return storyBullets(resumeText, limit).map((text) => ({ text, job: null }));
}

/** The free-of-model pack: always available, always honest. */
export function fallbackPack({ company, role, resumeText, nowMs = Date.now() }) {
  const fam = prepFamily(role);
  const used = new Set();
  const answers = resumeStories(resumeText, 4, roleHistory(resumeText), role).map(({ text, job }) => {
    const q = storyQuestion(text, used, fam, job?.company);
    used.add(q);
    const where = job?.company ? `From your time at ${job.company}: ` : 'From your résumé: ';
    return {
      q,
      answer: `${where}"${text}" Tell it in about a minute: what the situation was, what you did step by step, and how it ended.`,
      resume_fact: text,
      coached: true,
    };
  });
  const questions = bankQuestions(fam, { role, resumeText });
  return { questions, answers, intro: fallbackIntro({ resumeText, role, company, nowMs }), family: fam, model: false };
}

// ── Model prompt + guard ─────────────────────────────────────────────────────────────────────────
const PREP_RULES = [
  '- The FACT SHEET is the only truth about the person. Never invent an employer, title, number, tool, degree, certification, duty, practice, method, cause, team size, schedule, shift, promotion, result or date.',
  '- Every number you write appears in the fact sheet exactly, written as digits.',
  '- Lengths of time come only from the fact sheet\'s rounded lengths or start years ("since 2021", "about 5 years"). Never months. Never "this year" or "last year". Never repeat an OUT OF DATE line as current or future.',
  '- Each answer is built on ONE bullet, named by its ID ("J1.3"). Tell it as that job, at that employer. Never merge two bullets into one story.',
  '- Where a story needs a detail the bullet does not give, write a short question in [square brackets] for the person to answer ("[what made that month hard?]"). Never put a made-up example inside brackets, and never nest brackets.',
  '- Never say the person was promoted, "worked their way up", or did anything the fact sheet does not state.',
  '- Never state the person\'s current situation (in school, getting certified, unemployed) unless the fact sheet says it. A certification listed is already earned.',
  '- Questions are what a hiring manager for this role at this seniority asks (a lead or manager is asked about leading people). Never build a question on a premise the fact sheet does not state (a tool, a shift, a past industry, a failure); ask it open ("Which scheduling systems have you used?").',
  '- Facts about the EMPLOYER (its systems, size, plans) come only from the posting. With no posting, state none.',
  '- When the posting asks for something the fact sheet lacks, ask about it and leave the answer as an honest [how you would close the gap].',
  '- Each answer answers its own question. Write every "why" to the person as "you".',
  '- Plain, natural English a person would say out loud. No buzzwords, no clichés, no repeating the same result twice.',
];

export function prepPrompt({ company, role, jobText, resumeText, stage = '', nowMs = Date.now() }) {
  const sheet = factSheet(resumeText, nowMs);
  const system = ['You prepare a job seeker for one interview. Output ONLY a JSON object.', 'Hard rules:', ...PREP_RULES,
    '- If the company is widely known for a specific interview format (for example Amazon\'s Leadership Principles with STAR answers), name it and shape the questions to it — only when you are certain it applies to this kind of role. Never invent a company value.',
  ].join('\n');
  const user = [
    `COMPANY: ${String(company || '').slice(0, 120)}`,
    `ROLE: ${String(role || '').slice(0, 160)}`,
    stage === 'Phone Screen' ? 'STAGE: a first phone screen (usually a recruiter). Ask what a recruiter or first-round screener asks about this role and this person.'
      : stage === 'Final Round' ? 'STAGE: a final-round interview with the hiring team. Make the questions deep and specific to the job posting.'
      : 'STAGE: an interview with the hiring manager or team. Make the questions specific to the role\'s duties and requirements.',
    jobText ? `JOB POSTING (may be partial):\n<<<\n${String(jobText).slice(0, 5000)}\n>>>` : 'JOB POSTING: not provided.',
    factSheetText(sheet),
    `RÉSUMÉ TEXT (the same facts, as written):\n<<<\n${String(resumeText || '').slice(0, 6000)}\n>>>`,
    'Return JSON: {"questions":[{"q":"...","why":"one sentence to the person on what they are checking"}] (6 questions specific to this role and posting, not "tell me about yourself"),',
    '"answers":[{"q":"one of your questions, same text","bullet":"J1.2","situation":"one first-person sentence setting the scene, details the bullet lacks as [questions]","action":"what I did, in spoken first person, only what the bullet states","result":"the outcome exactly as the bullet states it, or [how did it end?]"}] (4 answers for the 4 questions this person can answer best, each on a different bullet, strongest and most recent bullets first),',
    '"intro":"a 30-second first-person answer to \\"tell me about yourself\\": current job, one strongest result, the path before it, and why this role (the reason as a [bracket] if the fact sheet gives none)"}',
  ].join('\n\n');
  return { system, user, sheet };
}

/**
 * The second pass: a strict fact-check of the draft against the fact sheet. It may only delete,
 * turn an unsupported detail into a [question for the person], fix grammar, or reopen a question's
 * false premise — never add a fact.
 */
export function verifyPrompt({ company, role, jobText, resumeText, draft, nowMs = Date.now() }) {
  const sheet = factSheet(resumeText, nowMs);
  const system = [
    'You fact-check an interview prep pack before a job seeker pays for it. Output ONLY a JSON object.',
    'Check every sentence of every question, answer and the intro against the FACT SHEET (facts about the person) and the JOB POSTING (facts about the employer).',
    'For each sentence: if it states or implies anything the sources do not say — a method, practice, purpose, cause, tool, shift, schedule, promotion, number, length of time, result, or a fact about the employer — remove that part, or replace it with a short [question for the person]. If a question rests on a false premise about the person, rewrite it as an open question. If an answer does not answer its question, fix the answer using only its bullet.',
    'Fix grammar. Remove nested brackets. Remove a result stated twice. Never add a new fact. Keep the person\'s voice and keep everything that is supported.',
    'Rules the pack must follow:', ...PREP_RULES,
  ].join('\n');
  const user = [
    `COMPANY: ${String(company || '').slice(0, 120)}`,
    `ROLE: ${String(role || '').slice(0, 160)}`,
    jobText ? `JOB POSTING:\n<<<\n${String(jobText).slice(0, 5000)}\n>>>` : 'JOB POSTING: not provided (so state no facts about the employer).',
    factSheetText(sheet),
    `DRAFT PACK:\n<<<\n${JSON.stringify(draft).slice(0, 12000)}\n>>>`,
    'Return the corrected pack with exactly the same JSON shape: {"questions":[{"q","why"}],"answers":[{"q","bullet","situation","action","result"}],"intro":"..."}',
  ].join('\n\n');
  return { system, user };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

const STOP = new Set('the and that with this from have were what when your they them their there then than into about which while would could should also just more most very some such only over each other after before because where being been does doing made make many much like will able across within without upon onto'.split(' '));
const contentWords = (t) => (String(t || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').match(/[a-z][a-z0-9+#.-]{3,}/g) || []).map((w) => w.replace(/[.-]+$/, '')).filter((w) => w.length >= 4 && !STOP.has(w));
/** Share of a text's content words found in the résumé (placeholders in [brackets] are not counted). */
export function groundedShare(text, resumeText) {
  const words = contentWords(text);
  if (!words.length) return 1;
  const have = new Set(contentWords(resumeText));
  const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
  const haveStems = new Set([...have].map(stem));
  const hit = words.filter((w) => have.has(w) || haveStems.has(stem(w))).length;
  return hit / words.length;
}

// A claim about the person's CURRENT situation the résumé does not make ("you go to school full-time",
// "I'm also getting certified in Google Analytics" — both false in the round-2 test).
const STATUS_RE = /\b(go(?:ing)? to school|full[- ]time student|currently (?:studying|enrolled|in school)|still in school|(?:getting|becoming|working (?:on|toward)|pursuing|studying for) (?:my |a |an |the )?(?:[A-Z][\w.+-]* ){0,4}(?:certification|certificate|degree|license|diploma)|(?:getting|becoming) certified|between jobs|unemployed)\b/i;
const RESUME_STATUS_RE = /\b(expected|in progress|anticipated|currently enrolled|candidate for|pursuing)\b/i;

// "[with content on [topics]]" → "[with content on topics]".
const flattenBrackets = (t) => {
  let out = '';
  let depth = 0;
  for (const ch of String(t || '')) {
    if (ch === '[') { if (depth++ === 0) out += ch; continue; }
    if (ch === ']') { if (depth > 0 && --depth === 0) out += ch; continue; }
    out += ch;
  }
  return out.replace(/\[\s*\]/g, '').replace(/\s+/g, ' ').trim();
};
const splitSentences = (t) => String(t || '').split(/(?<!\b(?:St|Mt|Mr|Mrs|Ms|Dr|Inc|Co|Jr|Sr|vs|No)\.)(?<=[.!?])\s+(?=[A-Z"“[(])/).map((x) => x.trim()).filter(Boolean);
const bracketFree = (t) => String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const qWords = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 3 && !STOP.has(w)));
function sameQuestion(a, b) {
  const A = qWords(a); const B = qWords(b);
  if (!A.size || !B.size) return norm(a) === norm(b);
  let n = 0; for (const w of A) if (B.has(w)) n += 1;
  return n / Math.min(A.size, B.size) >= 0.7;
}
// "She wants to see her process" → "You want to see your process" (verbs agree with "you").
const VERB_YOU = { is: 'are', was: 'were', has: 'have', does: 'do', "doesn't": "don't", "isn't": "aren't", "wasn't": "weren't", "hasn't": "haven't" };
const youVerb = (v) => VERB_YOU[v.toLowerCase()] || (/(ss|sh|ch|x|o)es$/i.test(v) ? v.slice(0, -2) : /ies$/i.test(v) ? `${v.slice(0, -3)}y` : /s$/i.test(v) && !/ss$/i.test(v) ? v.slice(0, -1) : v);
const youWhy = (t) => String(t || '')
  .replace(/\b(?:the candidate|the applicant|she|he)\s+(\w+(?:n't)?)\b/gi, (m, v) => `${/^[A-Z]/.test(m) ? 'You' : 'you'} ${youVerb(v)}`)
  .replace(/\bthe (?:candidate|applicant)'s\b/gi, 'your').replace(/\b(?:the candidate|the applicant)\b/gi, 'you')
  .replace(/\bshe's\b|\bhe's\b/gi, "you're").replace(/\b(?:she|he)\b/gi, 'you').replace(/\b(?:her|his)\b/gi, 'your').replace(/\bhim\b/gi, 'you');

/**
 * Keep only what the résumé backs, sentence by sentence. A sentence that fails a check is removed (or,
 * when it set the scene, becomes a [question] for the person); an answer survives when its own facts do.
 * Coached answers from the résumé fill the rest.
 */
export function guardPack(raw, { company, role, resumeText, pay = null, stage = '', nowMs = Date.now() }) {
  const base = fallbackPack({ company, role, resumeText, nowMs });
  const sheet = factSheet(resumeText, nowMs);
  const history = sheet.history;
  const ctx = { resumeText, history, company, role, nowMs };
  const resumeNorm = norm(resumeText);
  const statusOk = (t) => RESUME_STATUS_RE.test(resumeText) || !STATUS_RE.test(t);
  const staleText = sheet.stale.map((x) => norm(x.line));
  const repeatsStale = (t) => staleText.some((st) => st.length > 10 && norm(t).includes(st.slice(0, 40)));
  const sentenceOk = (t, fact) => numbersBacked(t, resumeText) && statusOk(t) && claimsOk(t, { ...ctx, fact }) && !repeatsStale(t);

  const qs = [];
  for (const x of Array.isArray(raw?.questions) ? raw.questions : []) {
    const q = flattenBrackets(String(x?.q || '').trim().slice(0, 240));
    const why = youWhy(flattenBrackets(String(x?.why || '').trim().slice(0, 240)));
    if (q.length <= 10 || !/[?]$/.test(q) || !statusOk(q) || !premiseOk(q, ctx) || repeatsStale(q)) continue;
    if (qs.some((y) => sameQuestion(y.q, q))) continue;
    qs.push({ q, why: statusOk(why) ? why : '' });
  }

  const usedBullets = new Set();
  const answers = [];
  for (const x of Array.isArray(raw?.answers) ? raw.answers : []) {
    const q = flattenBrackets(String(x?.q || '').trim().slice(0, 240));
    // The story's line: by ID from the fact sheet (exact text, one job), else a quoted résumé line.
    const byId = bulletById(sheet, x?.bullet);
    let fact = byId?.text || String(x?.resume_fact || '').trim().slice(0, 300);
    if (!byId && fact && !(norm(fact).length > 15 && resumeNorm.includes(norm(fact).slice(0, 60)))) continue;
    if (!byId && history.some((r) => r.bullets.length) && !jobOf(fact.split(/;\s+/)[0], history)) continue; // a title or date line
    if (!q || !fact || usedBullets.has(norm(fact).slice(0, 60))) continue;
    const parts = {};
    for (const k of ['situation', 'action', 'result']) {
      const raw2 = trimRelativeYears(flattenBrackets(String(x?.[k] || '').trim().slice(0, 700)), ctx);
      const keep = splitSentences(raw2).filter((t) => sentenceOk(t, fact) && (/\[[^\]]+\]/.test(t) && bracketFree(t).length < 40 ? true : groundedShare(t, resumeText) >= (k === 'situation' ? 0.4 : 0.55)));
      parts[k] = keep.join(' ');
    }
    if (!parts.situation && x?.situation) parts.situation = '[Set the scene in one sentence: where you were and what was going on.]';
    if (!parts.result && x?.result) parts.result = '[How did it end?]';
    if (bracketFree(parts.action).length < 25) continue; // nothing of its own facts survived
    const answer = [parts.situation, parts.action, parts.result].filter(Boolean).join(' ');
    if (!sentenceOk(answer, fact)) continue;
    usedBullets.add(norm(fact).slice(0, 60));
    answers.push({ q, answer, situation: parts.situation, action: parts.action, result: parts.result, resume_fact: fact, ...(bracketFree(answer).length < 60 ? { coached: true } : {}) });
  }

  // The intro keeps its supported sentences; too little left → the résumé-built intro.
  const introKeep = splitSentences(trimRelativeYears(flattenBrackets(typeof raw?.intro === 'string' ? raw.intro : ''), ctx))
    .filter((t) => sentenceOk(t, '') && (/\b(interested|excited|drawn|why|because)\b/i.test(t) || groundedShare(t, resumeText) >= 0.5));
  const modelIntro = introKeep.length >= 2 && introKeep.join(' ').length > 80 ? introKeep.join(' ').slice(0, 900) : null;
  const intro = modelIntro || base.intro;

  const usedFacts = new Set(answers.map((a) => norm(a.resume_fact).slice(0, 60)));
  const fill = base.answers.filter((a) => !usedFacts.has(norm(a.resume_fact).slice(0, 60)) && !answers.some((y) => sameQuestion(y.q, a.q)));
  const finalAnswers = [...answers, ...fill].slice(0, 4);
  const answered = finalAnswers.map((a) => ({ q: a.q, why: (qs.find((x) => sameQuestion(x.q, a.q)) || {}).why || (a.coached ? 'A story from your résumé. Tell it in about a minute.' : 'Your prepared answer is below.') }));
  // A phone screen is a recruiter call: the staples (pay, start date, why now, what you know) come first.
  const staples = screenStaples(company, pay);
  // With the model's questions, the field bank only tops the list up; without them, it leads.
  const open = universalQuestions(company, role).slice(0, 2);
  const field = qs.length >= 4 ? [...qs, ...base.questions.slice(0, 2)] : [...qs, ...base.questions].slice(0, Math.max(4, qs.length));
  const ordered = stage === 'Phone Screen'
    ? [...open, ...staples, ...answered, ...field]
    : [...open, ...field, ...answered, ...staples];
  const questions = [];
  for (const x of ordered) {
    if (questions.some((y) => sameQuestion(y.q, x.q))) continue;
    questions.push({ q: x.q, why: x.why || 'Answer with one real example: what happened, what you did, how it ended.' });
  }
  return {
    questions: questions.slice(0, 14),
    answers: finalAnswers,
    intro,
    resume_check: sheet.stale.map(({ line, note }) => ({ line, note })),
    family: base.family,
    model: answers.length >= 2 || !!modelIntro,
    dropped: (raw?.answers?.length || 0) - answers.length,
  };
}

// ── Emails (templates; the person fills the interviewer's name) ──────────────────────────────────
export function prepEmails({ company, role, name }) {
  const r = role || 'the role';
  const sign = `\n\n${name || '[your name]'}`;
  return {
    thankYou: {
      subject: `Thank you — ${r} interview`,
      body: `Hi [interviewer's name],\n\nThank you for taking the time to talk with me about the ${r} role at ${company}. I enjoyed hearing about [one thing they told you], and it made me even more interested in the job.\n\nIf there is anything else I can send you, I'm happy to.${sign}`,
    },
    followUp: {
      subject: `Following up — ${r}`,
      body: `Hi [interviewer's name],\n\nI wanted to follow up on my interview for the ${r} role at ${company}. I'm still very interested, and I'd be glad to answer anything else. Is there an update on next steps you can share?\n\nThank you again for your time.${sign}`,
    },
  };
}

/**
 * The person's name for an email sign-off: the résumé's first line when it reads as a name ("Maria Lopez"),
 * else a profile name that reads as one. Sign-up stores the email handle as profiles.name
 * ("wtp.maria.1025"), which must never sign an email.
 */
export function signOffName(resumeText, profileName) {
  const looksLikeName = (s) => /^[A-Z][a-zA-Z'’-]+(?: [A-Z][a-zA-Z'’.-]*){1,3}$/.test(String(s || '').trim());
  const first = String(resumeText || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) || '';
  const head = first.split(/\s[|·•]\s|,\s/)[0].trim();
  if (looksLikeName(head)) return head;
  if (looksLikeName(profileName)) return String(profileName).trim();
  return '';
}

/** Stable cache key for one person's prep for one company + role. */
export function prepKey(company, role) {
  return `${norm(company).slice(0, 80)}|${norm(role).slice(0, 80)}`;
}
