// Interview Prep truth checks for the claims a model makes that a digit check cannot see (2026-10-25
// eval: "the last three and a half years as an Assistant Store Manager" — 5.5 by her dates; "almost four
// years at St. Aurelia" — 6.2; "At Twin Lakes, I was generating this Monday report" — it was North Loop;
// "sixty to seventy calls" escaped the digit guard; "the P&L piece" — not on her résumé; "worked my way
// up from Material Handler" — one combined role; "since June of this year" — June 2024).
//
// Everything here is computed from the résumé's own dates, employers and words. A claim the résumé
// cannot back fails, and guardPack drops (or replaces) the answer, intro or question that made it.

import { parseResume } from '../resume/parse/index.js';
import { pacificDate } from '../time/pacific.js';

// ── Number words → digits ────────────────────────────────────────────────────────────────────────
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const UNIT_AFTER = /^\s*(?:and a half\s+)?(?:percent|%|years?|yrs?|months?|weeks?|hours?|hundred|thousand|million)\b/i;

/**
 * Spoken numbers as digits, so the number checks see them: "ninety-four percent" → "94 percent",
 * "sixty to seventy" → "60 to 70", "three and a half years" → "3.5 years", "a year and a half" → "1.5 years",
 * "thirty thousand" → "30000". Small words (one–nine) are converted only before a unit ("five years"),
 * never in ordinary speech ("one thing", "two of us").
 */
export function digitize(text) {
  let t = String(text || '');
  t = t.replace(/\ba year and a half\b/gi, '1.5 years').replace(/\bhalf a year\b/gi, '0.5 years');
  const word = new RegExp(`\\b(${Object.keys(TENS).join('|')})(?:[-\\s](${Object.keys(ONES).slice(0, 9).join('|')}))?\\b|\\b(${Object.keys(ONES).join('|')})\\b`, 'gi');
  t = t.replace(word, (m, tens, unit, ones, offset, whole) => {
    const n = tens ? TENS[tens.toLowerCase()] + (unit ? ONES[unit.toLowerCase()] : 0) : ONES[ones.toLowerCase()];
    if (n >= 10) return String(n);
    return UNIT_AFTER.test(whole.slice(offset + m.length)) ? String(n) : m;
  });
  t = t.replace(/\b(\d+) and a half\b/gi, (_, n) => String(Number(n) + 0.5));
  t = t.replace(/\b(\d+(?:\.\d+)?) thousand\b/gi, (_, n) => String(Math.round(Number(n) * 1000)));
  t = t.replace(/\b(\d+) hundred(?: and)? (\d{1,2})\b/gi, (_, h, r) => String(Number(h) * 100 + Number(r)));
  t = t.replace(/\b(\d+) hundred\b/gi, (_, h) => String(Number(h) * 100));
  t = t.replace(/\b(\d+(?:\.\d+)?) million\b/gi, (_, n) => `${n}M`);
  return t;
}

// ── Role history from the résumé's dates ─────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEGAL = /\b(inc|llc|ltd|co|corp|corporation|company|plc|group|the)\b/g;
export const employerKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');

function monthNum(v, nowYm) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (/present|current|now/.test(s)) return nowYm;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})/))) return Number(m[1]) * 12 + Number(m[2]) - 1;
  if ((m = s.match(/^(\d{4})$/))) return Number(m[1]) * 12 + 5; // a bare year: mid-year, marked approximate
  return null;
}

/**
 * Each job with its dates and length, computed against today (California date). `months` is null when
 * a date is missing. Bare years ("2014 – 2016") are approximate.
 */
export function roleHistory(resumeText, nowMs = Date.now()) {
  let exp = [];
  try { exp = parseResume({ text: String(resumeText || '') }).experience || []; } catch { exp = []; }
  const [y, mo] = pacificDate(new Date(nowMs)).split('-').map(Number);
  const nowYm = y * 12 + mo - 1;
  return exp.filter((e) => e && (e.title || e.company)).map((e) => {
    const s = monthNum(e.start, nowYm);
    const en = monthNum(e.end, nowYm);
    const current = /present|current|now/i.test(String(e.end || ''));
    // "Jun 2018 – Mar 2021" counts both end months; a current job runs to today.
    const months = s != null && en != null && en >= s ? en - s + (current ? 0 : 1) : null;
    return {
      title: String(e.title || '').trim(),
      company: String(e.company || '').trim(),
      start: e.start || '',
      end: e.end || '',
      current,
      approx: /^\d{4}$/.test(String(e.start || '')) || /^\d{4}$/.test(String(e.end || '')),
      startYm: s,
      endYm: en,
      months,
      bullets: (e.bullets || []).map((b) => String(b?.text || b || '')).filter(Boolean),
    };
  });
}

export function lengthLabel(months) {
  if (months == null) return 'length unknown';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y) return `${m} month${m === 1 ? '' : 's'}`;
  return `${y} year${y === 1 ? '' : 's'}${m ? ` ${m} month${m === 1 ? '' : 's'}` : ''}`;
}

const fmtYm = (v) => {
  const s = String(v || '');
  let m;
  if (/present|current/i.test(s)) return 'present';
  if ((m = s.match(/^(\d{4})-(\d{2})/))) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  return s || '?';
};

/** The ROLE HISTORY block for the model: the only lengths of time it may state. */
export function historyBlock(history, nowMs = Date.now()) {
  if (!history.length) return '';
  const lines = history.map((r) => `- ${r.title || 'Role'}${r.company ? ` — ${r.company}` : ''}: ${fmtYm(r.start)} – ${fmtYm(r.end)} (${lengthLabel(r.months)}${r.approx ? ', approximate' : ''})`);
  const first = history.map((r) => r.startYm).filter((v) => v != null);
  const total = first.length ? lengthLabel(Math.max(...history.map((r) => r.endYm ?? -1)) - Math.min(...first) + 1) : null;
  return [`ROLE HISTORY (computed by Seen from the résumé's own dates; today is ${pacificDate(new Date(nowMs))}):`, ...lines, total ? `- Whole work history: ${total}` : ''].filter(Boolean).join('\n');
}

// ── Claim checks ─────────────────────────────────────────────────────────────────────────────────
const sentences = (t) => String(t || '').split(/(?<!\b(?:St|Mt|Mr|Mrs|Ms|Dr|Inc|Co|Corp|Jr|Sr|vs|No|U\.S)\.)(?<=[.!?])\s+(?=[A-Z"“[(])/).map((s) => s.trim()).filter(Boolean);
const lc = (s) => String(s || '').toLowerCase();
const normWords = (s) => ` ${lc(s).replace(/[^a-z0-9&]+/g, ' ').trim()} `;

const DURATION_RE = /\b(almost|nearly|close to|just under|about|around|roughly|over|more than|just over)?\s*(\d+(?:\.\d+)?|a couple(?: of)?|couple of|a few|several)\s*(\+)?\s*(?:years?|yrs?)\b/gi;
const FUTURE_BEFORE = /\b(in|within|next|every|after|for the next)\s*(?:the\s+)?$/i;

function employersIn(sentence, history) {
  const w = normWords(sentence);
  const keys = new Set();
  for (const r of history) {
    const k = employerKey(r.company);
    if (k && k.length >= 4 && w.includes(` ${k} `)) keys.add(k);
  }
  return keys;
}
function titlesIn(sentence, history) {
  const w = normWords(sentence);
  return history.filter((r) => {
    const t = normWords(r.title.split(/[,(–—|]/)[0]).trim();
    return t.length >= 6 && w.includes(` ${t} `);
  });
}

function candidatesFor(sentence, history, strict = false) {
  const emp = employersIn(sentence, history);
  if (emp.size) {
    const out = [];
    for (const k of emp) {
      const rs = history.filter((r) => employerKey(r.company) === k && r.months != null);
      if (rs.length) out.push(rs.reduce((a, r) => a + r.months, 0), ...rs.map((r) => r.months));
    }
    return out;
  }
  const byTitle = titlesIn(sentence, history).filter((r) => r.months != null);
  if (byTitle.length) return byTitle.map((r) => r.months);
  if (strict) return [];
  // No job named: the whole history, or any stretch from one job's start to the end of the latest.
  const ends = history.map((r) => r.endYm).filter((v) => v != null);
  if (!ends.length) return [];
  const last = Math.max(...ends);
  return [...new Set(history.map((r) => (r.startYm != null ? last - r.startYm + 1 : null)).filter((v) => v != null)), ...history.map((r) => r.months).filter((v) => v != null)];
}

function fits(qual, raw, plus, actualYears) {
  const q = lc(qual);
  const v = lc(raw);
  let lo; let hi;
  if (/couple/.test(v)) { lo = 1.5; hi = 2.9; } else if (/few/.test(v)) { lo = 2; hi = 4.9; } else if (/several/.test(v)) { lo = 3; hi = 9.9; } else {
    const n = Number(v);
    if (/almost|nearly|close to|just under/.test(q)) { lo = n - 1; hi = n + 0.05; } else if (plus || /over|more than|just over/.test(q)) { lo = n - 0.05; hi = Infinity; } else { lo = n - 0.6; hi = n + 0.99; } // people round down: "five years" for 5 years 8 months
  }
  return actualYears >= lo && actualYears <= hi;
}

/** Every "N years" in a text must match the résumé's dates (or be written in the résumé itself). */
export function durationsOk(text, { resumeText, history, strict = false }) {
  const resumeD = lc(digitize(resumeText));
  for (const s of sentences(digitize(text))) {
    for (const m of s.matchAll(DURATION_RE)) {
      const before = s.slice(0, m.index);
      if (FUTURE_BEFORE.test(before)) continue;
      const lit = lc(m[0]).replace(/^(almost|nearly|close to|just under|about|around|roughly|over|more than|just over)\s*/, '').trim();
      if (/^\d/.test(lit) && resumeD.includes(lit.replace(/\s+/g, ' '))) continue;
      const cands = candidatesFor(s, history, strict);
      if (!cands.length) return false;
      if (!cands.some((months) => fits(m[1] || '', m[2], m[3], months / 12))) return false;
    }
  }
  return true;
}

/** "this year" / "last year" only when a job on the résumé starts or ends in that year. */
export function relativeYearsOk(text, { history, company, nowMs = Date.now() }) {
  const year = Number(pacificDate(new Date(nowMs)).slice(0, 4));
  const years = new Set(history.flatMap((r) => [r.startYm, r.current ? null : r.endYm]).filter((v) => v != null).map((v) => Math.floor(v / 12)));
  for (const s of sentences(text)) {
    if (company && lc(s).includes(lc(company))) continue;
    if (/\b(?:earlier |later )?this year\b/i.test(s) && !years.has(year)) return false;
    if (/\blast year\b/i.test(s) && !years.has(year - 1)) return false;
  }
  return true;
}

/**
 * Drop a "last year" / "this year" the dates cannot back when it is only a time marker ("Last year, I
 * raised…" → "I raised…"); claimsOk still refuses one that cannot be removed ("since June of this year").
 */
export function trimRelativeYears(text, ctx) {
  if (relativeYearsOk(text, ctx)) return text;
  return String(text || '')
    .replace(/(^|[.!?]\s+)(?:last|this|earlier this) year,?\s+(\w)/gi, (_, lead, c) => `${lead}${c.toUpperCase()}`)
    .replace(/,?\s+(?:last|this|earlier this) year\b(?=[,.;!?]|\s+(?:and|but|so)\b)/gi, '');
}

const PROMO_RE = /\b(worked my way up|was promoted|got promoted|promoted (?:me|to)|moved up to|rose to|earned a promotion)\b/i;
export function promotionOk(text, { resumeText, history }) {
  if (!PROMO_RE.test(text)) return true;
  if (/promot/i.test(resumeText)) return true;
  for (let i = 0; i + 1 < history.length; i += 1) {
    if (employerKey(history[i].company) && employerKey(history[i].company) === employerKey(history[i + 1].company) && lc(history[i].title) !== lc(history[i + 1].title)) return true;
  }
  return false;
}

/** The job a résumé line is listed under. */
export function jobOf(fact, history) {
  const f = normWords(fact).trim().slice(0, 60);
  if (f.length < 15) return null;
  return history.find((r) => r.bullets.some((b) => normWords(b).includes(f) || f.includes(normWords(b).trim().slice(0, 60)))) || null;
}

/**
 * An answer told about one job sets the scene at that job: the first résumé employer it names must be
 * the one the story's line is listed under ("At Twin Lakes, I was generating this Monday report" — it was
 * North Loop). A later contrast ("Now at Pipewell…") is fine.
 */
export function employerOk(text, fact, history) {
  const own = jobOf(fact, history);
  if (!own) return true;
  const ownKey = employerKey(own.company);
  if (!ownKey) return true;
  const w = normWords(text);
  let first = null;
  let at = Infinity;
  for (const r of history) {
    const k = employerKey(r.company);
    if (!k || k.length < 4) continue;
    const i = w.indexOf(` ${k} `);
    if (i >= 0 && i < at) { at = i; first = k; }
  }
  return first == null || first === ownKey;
}

// Named tools, systems and terms: "NetSuite", "Power BI", "WMS", "P&L", "IEP".
const TERM_RE = /\b(?:[A-Z]&[A-Z]|[A-Z]{2,}[a-z]?s?|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+ (?:BI|AI|CRM|ERP|360))\b/g;
// Plain words and categories, not tools: naming a category ("other ERPs") claims nothing.
const TERM_OK = new Set(['I', 'STAR', 'OK', 'US', 'USA', 'AM', 'PM', 'TV', 'ID', 'FAQ', 'CEO', 'HR', 'ASAP', 'EST', 'PST', 'ET', 'PT', 'CT', 'ERP', 'CRM', 'POS', 'KPI', 'SOP', 'EHR', 'EMR', 'ATS']);
const WANT_RE = /\b(interested|excited|drawn|want|wanting|hope|hoping|love to|eager|looking forward|would like|curious|keen|could|would|can learn|ready to learn|pick up)\b/i;
const FIRST_PERSON_RE = /\b(I|I've|I'm|I'd|I was|my|me)\b/;
const PREMISE_RE = /\b(you've|you have|you were|you had|you did|you used|you ran|you led|you worked|you managed|your (?:time|work|experience|background|role|years) (?:at|with|in|as|on)|since you|as someone who|given your|with your)\b/i;

// "SDR" for "Sales Development Representative": the role's own initials are not a claim.
const initials = (s) => String(s || '').split(/[^A-Za-z]+/).filter((w) => w.length > 2).map((w) => w[0]).join('').toUpperCase();
function termsIn(s, allow) {
  return (s.match(TERM_RE) || []).map((t) => t.replace(/s$/, '')).filter((t) => !TERM_OK.has(t) && !allow.some((a) => lc(a).includes(lc(t)) || initials(a).includes(t)));
}
/** First-person claims may only name tools and terms the résumé names ("the P&L piece" was not). */
export function termsOk(text, { resumeText, company, role }) {
  const have = lc(resumeText);
  const allow = [company, role].filter(Boolean);
  for (const s of sentences(text)) {
    if (!FIRST_PERSON_RE.test(s) || WANT_RE.test(s)) continue;
    if (termsIn(s, allow).some((t) => !have.includes(lc(t)))) return false;
  }
  return true;
}

/**
 * A question may not rest on a premise the résumé does not state: "You've worked with Tableau and
 * Power BI…" (no Power BI), "You've used NetSuite for 3 years now" (since 2018).
 */
export function premiseOk(question, { resumeText, history, company, role }) {
  const have = lc(resumeText);
  const allow = [company, role].filter(Boolean);
  for (const s of sentences(question)) {
    if (!PREMISE_RE.test(s)) continue;
    if (termsIn(s, allow).some((t) => !have.includes(lc(t)))) return false;
    // A length of time in a premise must belong to a job the question names ("for 3 years" of NetSuite
    // is not a job), or be written in the résumé.
    if (!durationsOk(s, { resumeText, history, strict: true })) return false;
  }
  return true;
}

/** Every check for a first-person answer or intro. `fact` is the résumé line an answer is built on. */
export function claimsOk(text, { resumeText, history, company, role, fact = '', nowMs = Date.now() }) {
  return durationsOk(text, { resumeText, history })
    && relativeYearsOk(text, { history, company, nowMs })
    && promotionOk(text, { resumeText, history })
    && termsOk(text, { resumeText, company, role })
    && (!fact || employerOk(text, fact, history));
}

/** The text without its lengths of time ("5 years", "almost 4 yrs"), for the plain number check. */
export function stripDurations(text) {
  return String(text || '').replace(DURATION_RE, ' ').replace(/\b\d+(?:\.\d+)?\s*months?\b/gi, ' ');
}
