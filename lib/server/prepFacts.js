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
// "Target" the employer is not a target date (round 3: every Target job read as "a plan that has passed")
const FUTURE_WORDS = /\b(expected|anticipated|sitting for|scheduled|planned|planning to|will (?:take|sit|complete|graduate|finish)|targeting|target(?:ed)? (?:date|completion|graduation|for)|in progress|pursuing|enrolled|candidate)\b/i;
// a job's own date range ("Mar 2021 – Sep 2026", "2019 – Present") is history, never a plan
const DATE_RANGE_RE = /\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:[A-Z][a-z]{2,8}\.?\s+)?(?:19|20)\d{2}|present|current|now)\b/i;
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
      if (FUTURE_WORDS.test(line) && !DATE_RANGE_RE.test(line) && !/\b(passed|completed|earned|graduated|finished)\b/i.test(line)) {
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
  // lines the parser was unsure about (doc.meta.fidelity.uncertain): never told as a story under an employer
  const flat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const unsure = new Set(((doc.meta && doc.meta.fidelity && doc.meta.fidelity.uncertain) || []).map((u) => flat(u.line)).filter(Boolean));
  const jobs = history.map((r, i) => ({
    id: `J${i + 1}`,
    title: r.title,
    company: r.company,
    dates: `${fmt(r.start)} – ${fmt(r.end)}`,
    length: spokenLength(r.months),
    current: r.current,
    bullets: r.bullets.map((b, j) => ({ id: `J${i + 1}.${j + 1}`, text: clean(b), ...(unsure.has(flat(b)) ? { uncertain: true } : {}) })).filter((b) => b.text.length > 3),
  }));
  const skills = (doc.skills || []).flatMap((g) => g.items || []).map(clean).filter(Boolean);
  const certifications = (doc.certifications || []).map((c) => clean(c.text || [c.name, c.issuer, c.date].filter(Boolean).join(', '))).filter(Boolean);
  const education = (doc.education || []).map((e) => clean([e.degree, e.field && `in ${e.field}`, e.school, e.end].filter(Boolean).join(' '))).filter(Boolean);
  const statedYears = String(resumeText || '').split(/\r?\n/).flatMap((l) => clean(l).split(/;\s+|\.\s+(?=[A-Z])/))
    .filter((c) => /(\d+(?:\.\d+)?)\+?\s*years?\s+(?:of\s+(?:\w+\s+){0,2})?(?:experience|in\b|as\b|installing|servicing|working|leading|managing|teaching|nursing|selling|building)/i.test(c))
    .map((c) => c.slice(0, 160));
  return { today: pacificDate(new Date(nowMs)), jobs, skills, certifications, education, statedYears, stale: staleLines(resumeText, nowMs), history };
}

// An employer as people say it out loud: no note in parentheses, and no city glued on by the résumé's header
// ("Sunbelt Electric Contractors, Phoenix AZ" → "Sunbelt Electric Contractors"; "Midwest Distribution Partners,
// Joliet IL"); a name written as a lower-case slug reads as a name ("shinola" → "Shinola").
const US_STATE = '(?:A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])';
const CITY_TAIL_RE = new RegExp(`\\s*(?:,|\\s[-–—|]\\s)\\s*(?:[A-Z][A-Za-z.'-]*\\s?){1,3},?\\s+${US_STATE}\\.?\\s*$`);
export function spokenEmployer(company) {
  let s = String(company || '').replace(/\s*\([^)]*\)/g, '').replace(/\.+$/, '').trim();
  const cut = s.replace(CITY_TAIL_RE, '').trim();
  if (cut && cut !== s && cut.length >= 2) s = cut;
  if (s && s === s.toLowerCase() && /[a-z]/.test(s)) s = s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return s;
}

// A title said in a sentence: an ALL-CAPS title is said in ordinary capitals ("KITCHEN MANAGER" → "Kitchen Manager"),
// short acronyms kept (RN, HVAC, CNA, IT).
const KEEP_CAPS = /^(?:[A-Z]{1,4}|II|III|IV|HVAC|EMT-?\w*|CNA|LPN|LVN|RN|BSN|MSN|CPA|CFO|CEO|COO|CTO|VP|SVP|EVP|IT|QA|UX|UI|HR|PR|AR|AP|ICU|ER|OR)$/;
export function sayTitle(title) {
  const t = String(title || '').trim();
  if (!t || !/[A-Z]{3,}/.test(t) || /[a-z]/.test(t.replace(/\b[A-Z]{2,}\b/g, ''))) return t.replace(/\s+/g, ' ');
  return t.split(/(\s+|[-/,&])/).map((w) => (KEEP_CAPS.test(w) && w.length <= 4 && !/^(?:LEAD|CHEF|COOK|HEAD|SHIFT)$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join('').replace(/\s+/g, ' ');
}
// An employer name that is a system's slug, not a name a person says ("akidolabs", "whitewatermidstream", "Acme
// Careers Page"): null, and the sentence says "this company" or "here" instead.
export function employerOrNull(company) {
  const raw = String(company || '').trim();
  if (!raw || /\bcareers?(?:\s+(?:page|site|portal))?$/i.test(raw) || /^jobs?\b/i.test(raw)) return null;
  if (!/\s/.test(raw) && raw === raw.toLowerCase() && /[a-z]/.test(raw)) return null;
  return spokenEmployer(raw);
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
