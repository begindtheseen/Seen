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

import { detectRoleFamily, roleFamily } from '../application-intelligence/roleOntology.js';

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
  const roleWords = String(role || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const quotes = list
    .map((r) => ({ r, ...splitSource(r.report_text) }))
    .filter((q) => q.text.length >= 40 && q.text.length <= 420 && INTERVIEW_TEXT_RE.test(q.text))
    .map((q) => ({ ...q, roleHit: roleWords.some((w) => `${q.r.role || ''} ${q.text}`.toLowerCase().includes(w)) }))
    .sort((a, b) => Number(b.roleHit) - Number(a.roleHit))
    .slice(0, 3)
    .map((q) => ({ text: q.text, role: q.r.role || null, outcome: q.r.outcome, source: q.url ? sourceHost(q.url) : (q.r.platform || null), url: q.url }));

  return {
    accounts: list.length,
    after,
    resolved,
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
 * Pay from listings with salary_min/salary_max. Hourly (< 200) and yearly figures are never mixed;
 * the unit with more listings wins. Needs at least 3 listings, else null.
 */
export function payRange(jobs) {
  const hourly = [];
  const yearly = [];
  for (const j of Array.isArray(jobs) ? jobs : []) {
    const lo = Number(j?.salary_min);
    const hi = Number(j?.salary_max);
    const vals = [lo, hi].filter((n) => Number.isFinite(n) && n > 0);
    if (!vals.length) continue;
    const mid = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mid < 200) hourly.push(mid); else if (mid >= 10000 && mid <= 1_000_000) yearly.push(mid);
  }
  const pick = hourly.length >= yearly.length ? { unit: 'hour', v: hourly } : { unit: 'year', v: yearly };
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

/** True when every number in `text` also appears in the résumé. */
export function numbersBacked(text, resumeText) {
  const have = new Set(numbersIn(resumeText).flatMap((n) => [n, n.replace(/%$/, '')]));
  return numbersIn(text).every((n) => have.has(n) || have.has(n.replace(/%$/, '')));
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
    { q: 'Tell me about yourself.', why: 'Almost every interview opens with it. Use your 30-second intro below.' },
    { q: `Why do you want to work at ${company}?`, why: 'They want to hear you chose them, not just any job. Name one specific thing about them.' },
    { q: role ? `Why are you a good fit for the ${role} job?` : 'Why are you a good fit for this job?', why: 'Match two things they asked for to two things you have done.' },
    { q: 'Tell me about a time something went wrong at work and how you handled it.', why: 'A behavioral question: answer with what happened, what you did, and how it ended.' },
    { q: 'What questions do you have for us?', why: 'Always have two. Ask what success looks like in the first 90 days, and what the next step is.' },
  ];
}

function familyQuestions(fam) {
  const f = roleFamily(fam);
  if (!f) return [];
  const out = [];
  for (const p of (f.employerPriorities || []).slice(0, 2)) {
    out.push({ q: `Give me an example of when you showed ${p}.`, why: `${f.label} employers screen for ${p}.` });
  }
  for (const risk of (f.interviewRisks || []).slice(0, 1)) {
    const body = risk.replace(/\.$/, '');
    let q = null;
    let m;
    if ((m = body.match(/^Expect questions on (.+)$/i))) q = `How would you handle ${m[1]}?`;
    else if ((m = body.match(/^Be ready to (?:describe|explain|walk through) (.+)$/i))) q = `Can you walk me through ${m[1]}?`;
    if (q) out.push({ q, why: `A common ${f.label.toLowerCase()} interview question.` });
  }
  return out;
}

/** The free-of-model pack: always available, always honest. */
export function fallbackPack({ company, role, resumeText }) {
  const fam = detectRoleFamily(role || '', '').family;
  const bullets = storyBullets(resumeText, 5);
  const questions = [...universalQuestions(company, role), ...familyQuestions(fam)].slice(0, 8);
  const answers = bullets.slice(0, 4).map((b, i) => ({
    q: i === 0 ? 'Tell me about a time you made a difference at work.' : i === 1 ? 'Tell me about a time you handled something hard.' : i === 2 ? 'What is your proudest result?' : 'Tell me about a time you worked with a team.',
    answer: `Tell this one from your résumé: "${b}" Say what the situation was, what you did step by step, and how it ended — in about a minute.`,
    resume_fact: b,
    coached: true,
  }));
  return { questions, answers, intro: null, family: fam, model: false };
}

// ── Model prompt + guard ─────────────────────────────────────────────────────────────────────────
export function prepPrompt({ company, role, jobText, resumeText }) {
  const system = [
    'You prepare a job seeker for one interview. Output ONLY a JSON object.',
    'Hard rules:',
    '- Use ONLY facts written in the RÉSUMÉ. Never invent employers, titles, numbers, tools, degrees or results.',
    '- Every number you write must appear in the résumé exactly. If the résumé has no number for a story, use none.',
    '- Questions are the ones a hiring manager for this role is likely to ask. Do not claim they were reported by anyone.',
    '- Plain, natural English a person would say out loud. No buzzwords.',
  ].join('\n');
  const user = [
    `COMPANY: ${String(company || '').slice(0, 120)}`,
    `ROLE: ${String(role || '').slice(0, 160)}`,
    jobText ? `JOB POSTING (may be partial):\n<<<\n${String(jobText).slice(0, 5000)}\n>>>` : 'JOB POSTING: not provided.',
    `RÉSUMÉ:\n<<<\n${String(resumeText || '').slice(0, 7000)}\n>>>`,
    'Return JSON: {"questions":[{"q":"...","why":"one sentence on what they are checking"}] (6 role-specific questions, not generic ones like "tell me about yourself"),',
    '"answers":[{"q":"...","answer":"a 60-second spoken answer in first person using one résumé story","resume_fact":"the exact résumé line it is built on"}] (4 answers),',
    '"intro":"a 30-second first-person answer to \\"tell me about yourself\\" built only from the résumé, ending with why this role"}',
  ].join('\n\n');
  return { system, user };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

/** Keep only what the résumé backs. Answers that fail are replaced by coached ones. */
export function guardPack(raw, { company, role, resumeText }) {
  const base = fallbackPack({ company, role, resumeText });
  const resumeNorm = norm(resumeText);
  const qs = (Array.isArray(raw?.questions) ? raw.questions : [])
    .map((x) => ({ q: String(x?.q || '').trim().slice(0, 240), why: String(x?.why || '').trim().slice(0, 240) }))
    .filter((x) => x.q.length > 10 && x.q.endsWith('?'));
  const answers = (Array.isArray(raw?.answers) ? raw.answers : [])
    .map((x) => ({ q: String(x?.q || '').trim().slice(0, 240), answer: String(x?.answer || '').trim().slice(0, 1400), resume_fact: String(x?.resume_fact || '').trim().slice(0, 300) }))
    .filter((x) => x.q && x.answer.length > 60)
    // The story must be a real résumé line (by its words), and every number must be the résumé's.
    .filter((x) => x.resume_fact && norm(x.resume_fact).length > 15 && resumeNorm.includes(norm(x.resume_fact).slice(0, 60)))
    .filter((x) => numbersBacked(x.answer, resumeText));
  const intro = typeof raw?.intro === 'string' && raw.intro.length > 60 && numbersBacked(raw.intro, resumeText) ? raw.intro.trim().slice(0, 900) : null;

  const seenQ = new Set();
  const questions = [...universalQuestions(company, role).slice(0, 2), ...qs, ...base.questions]
    .filter((x) => { const k = norm(x.q); if (seenQ.has(k)) return false; seenQ.add(k); return true; })
    .slice(0, 8);
  const usedFacts = new Set(answers.map((a) => norm(a.resume_fact).slice(0, 60)));
  const fill = base.answers.filter((a) => !usedFacts.has(norm(a.resume_fact).slice(0, 60)));
  const finalAnswers = answers.length >= 2 ? answers.slice(0, 4) : [...answers, ...fill].slice(0, 4);
  return { questions, answers: finalAnswers, intro, family: base.family, model: answers.length > 0 || !!intro, dropped: (raw?.answers?.length || 0) - answers.length };
}

// ── Emails (templates; the person fills the interviewer's name) ──────────────────────────────────
export function prepEmails({ company, role, name }) {
  const r = role || 'the role';
  const sign = `\n\n${name || '[your name]'}`;
  return {
    thankYou: {
      subject: `Thank you — ${r} interview`,
      body: `Hi [interviewer's name],\n\nThank you for taking the time to talk with me today about the ${r} role at ${company}. I enjoyed hearing about [one thing they told you], and it made me even more interested in the job.\n\nIf there is anything else I can send you, I'm happy to.${sign}`,
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
