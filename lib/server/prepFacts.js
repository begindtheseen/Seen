// The fact sheet for Interview Prep: every true thing the résumé says, numbered, so the model writes
// from IDs instead of free text and Seen can check every answer against one exact line (2026-10-25
// independent grade: answers fused two bullets, credited a story to the wrong job, kept "sitting for REG
// in 2025" as a plan in October 2026, and never noticed an ACLS that expired in 2025).

import { parseResume } from '../resume/parse/index.js';
import { pacificDate } from '../time/pacific.js';
import { roleHistory, spokenLength } from './prepClaims.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (v) => {
  const s = String(v || '');
  let m;
  if (/present|current/i.test(s)) return 'present';
  if ((m = s.match(/^(\d{4})-(\d{2})/))) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return s || '?';
};
const clean = (t) => String(t || '').replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/\s+/g, ' ').trim();

const MONTH_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const FUTURE_WORDS = /\b(expected|anticipated|sitting for|scheduled|planned|planning to|will (?:take|sit|complete|graduate|finish)|target(?:ing)?|in progress|pursuing|enrolled|candidate)\b/i;
const EXPIRES = /\b(exp\.?|expires?|expiring|valid (?:through|until|to)|renew(?:s|al)? (?:due|by))\b/i;

/**
 * Lines a hiring manager would read as out of date today: a certification past its expiry, or a plan
 * dated in the past ("sitting for REG in 2025" in October 2026). Each comes with what to do about it.
 */
export function staleLines(resumeText, nowMs = Date.now()) {
  const today = pacificDate(new Date(nowMs));
  const [y, mo] = today.split('-').map(Number);
  const nowYm = y * 12 + mo - 1;
  const out = [];
  // Clause by clause: "Passed FAR and AUD in 2024; sitting for REG in 2025." has one done, one stale.
  const clauses = String(resumeText || '').split(/\r?\n/).flatMap((l) => clean(l).split(/;\s+|\.\s+(?=[A-Z])/));
  for (const raw of clauses) {
    const line = clean(raw);
    if (line.length < 6 || line.length > 220) continue;
    const re = new RegExp(`(?:(${MONTH_RE})\\s+)?(20\\d{2})`, 'gi');
    for (const m of line.matchAll(re)) {
      const year = Number(m[2]);
      const monIdx = m[1] ? MONTHS.findIndex((x) => m[1].toLowerCase().startsWith(x.toLowerCase())) : 11;
      const ym = year * 12 + Math.max(0, monIdx);
      if (ym >= nowYm) continue;
      const before = line.slice(Math.max(0, m.index - 40), m.index);
      if (EXPIRES.test(before)) {
        out.push({ line, kind: 'expired', note: `This shows as expired (${m[0]}). Renew it before the interview, or be ready to say when you will — an employer that requires it will check.` });
        break;
      }
      if (FUTURE_WORDS.test(line) && !/\b(passed|completed|earned|graduated|finished)\b/i.test(line)) {
        out.push({ line, kind: 'past_plan', note: `This is written as a plan for ${m[0]}, which has passed. Update it to what happened (done, scheduled for a new date, or dropped) — an interviewer will ask.` });
        break;
      }
    }
  }
  return out;
}

/**
 * Jobs (J1, J2…) with dates, rounded length and numbered bullets (J1.1…), plus skills, certifications,
 * education, the résumé's own stated years and its out-of-date lines.
 */
export function factSheet(resumeText, nowMs = Date.now()) {
  let doc = {};
  try { doc = parseResume({ text: String(resumeText || '') }) || {}; } catch { doc = {}; }
  const history = roleHistory(resumeText, nowMs);
  const jobs = history.map((r, i) => ({
    id: `J${i + 1}`,
    title: r.title,
    company: r.company,
    dates: `${fmt(r.start)} – ${fmt(r.end)}`,
    length: spokenLength(r.months),
    current: r.current,
    bullets: r.bullets.map((b, j) => ({ id: `J${i + 1}.${j + 1}`, text: clean(b) })).filter((b) => b.text.length > 3),
  }));
  const skills = (doc.skills || []).flatMap((g) => g.items || []).map(clean).filter(Boolean);
  const certifications = (doc.certifications || []).map((c) => clean(c.text || [c.name, c.issuer, c.date].filter(Boolean).join(', '))).filter(Boolean);
  const education = (doc.education || []).map((e) => clean([e.degree, e.field && `in ${e.field}`, e.school, e.end].filter(Boolean).join(' '))).filter(Boolean);
  const statedYears = String(resumeText || '').split(/\r?\n/).flatMap((l) => clean(l).split(/;\s+|\.\s+(?=[A-Z])/))
    .filter((c) => /(\d+(?:\.\d+)?)\+?\s*years?\s+(?:of\s+(?:\w+\s+){0,2})?(?:experience|in\b|as\b|installing|servicing|working|leading|managing|teaching|nursing|selling|building)/i.test(c))
    .map((c) => c.slice(0, 160));
  return { today: pacificDate(new Date(nowMs)), jobs, skills, certifications, education, statedYears, stale: staleLines(resumeText, nowMs), history };
}

/** One bullet by ID ("J2.3"), or null. */
export function bulletById(sheet, id) {
  const m = String(id || '').trim().match(/^J(\d+)\.(\d+)$/i);
  if (!m) return null;
  const job = sheet.jobs[Number(m[1]) - 1];
  const b = job?.bullets[Number(m[2]) - 1];
  return b ? { ...b, job } : null;
}

/** The fact sheet as the model reads it. */
export function factSheetText(sheet) {
  const lines = [`FACT SHEET (built by Seen from the résumé; today is ${sheet.today}). These are the ONLY facts about the person.`];
  for (const j of sheet.jobs) {
    lines.push(`${j.id}: ${j.title || 'Role'}${j.company ? ` — ${j.company}` : ''} · ${j.dates} (${j.length})${j.current ? ' · current job' : ''}`);
    for (const b of j.bullets) lines.push(`  ${b.id}: ${b.text}`);
  }
  if (sheet.skills.length) lines.push(`SKILLS: ${sheet.skills.join('; ')}`);
  if (sheet.certifications.length) lines.push(`CERTIFICATIONS: ${sheet.certifications.join('; ')}`);
  if (sheet.education.length) lines.push(`EDUCATION: ${sheet.education.join('; ')}`);
  if (sheet.statedYears.length) lines.push(`THE RÉSUMÉ STATES: ${sheet.statedYears.join('; ')}`);
  if (sheet.stale.length) lines.push(`OUT OF DATE TODAY (never repeat these as current or future): ${sheet.stale.map((s) => s.line).join(' | ')}`);
  return lines.join('\n');
}
