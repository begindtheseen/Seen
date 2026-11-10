// THE posting pay reader — one helper for every tool that speaks a posting's pay (Job Insights,
// Interview Prep). Deterministic, no network.
//
//   readPostingPay(postingText) → { text, low, high, unit, upTo, source } | null
//     text   the pay as a person would say it: "$36.50 – $58.40 an hour", "Up to $21 an hour"
//     low / high  numbers (high null for a single figure); unit 'hour'|'year'|'visit'|… or null
//     source the posting's own clause, verbatim (HTML entities decoded): "salary range for this
//            position is $36.50 - $58.40 (Hourly Rate)"
//
// Rules (judge cases, 2026-11-10): pay is read only from a sentence that states pay — never "$2B ARR",
// a "$2.4 trillion industry", a $75/month gym stipend, a sign-on bonus or an HSA contribution; a
// template placeholder ("$000,000 – $000,00") is no pay; "$21 &mdash; $23" reads as $21 – $23 and
// no entity ever reaches the output.
import { sectionPosting, PAY_SENTENCE_RE } from '../optimizer/postingSections.js';

const ENTITIES = { amp: '&', nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', lt: '<', gt: '>', bull: '•', middot: '·', trade: '™', reg: '®', copy: '©', dollar: '$' };
/** Decode the HTML entities stored postings carry ("&mdash;", "&amp;", "&#39;") — one pass, never twice. */
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const MONEY = String.raw`\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?`;
const BIG_UNIT = String.raw`(?:[bBmM]\b|bn\b|billion|million|trillion)`;
const PER = String.raw`(?:\s*\/\s*(?:yr|year|hr|hour)\.?)?`;
const DASH = String.raw`(?:-|–|—|to|and)`;
const PAY_RANGE_RE = new RegExp(String.raw`(up to\s+|starting at\s+|from\s+)?(${MONEY})(?![\d,]*\s*${BIG_UNIT})(?:\s*USD)?${PER}(?:\s*${DASH}\s*(${MONEY}|\d[\d,]*(?:\.\d+)?\s?[kK]?)(?!\s*${BIG_UNIT}))?(\+)?`, 'i');
const BARE_RANGE_RE = /\b(\d{2,3}(?:,\d{3})?\s?[kK]?)\s*(?:-|–|—|to)\s*(\d{2,3}(?:,\d{3})?\s?[kK])\b/;
const PAY_WORD_RE = /\b(?:pay|salary|salaries|wage|wages|compensation|hourly|per\s+hour|an\s+hour|\/\s?h(?:ou)?r|per\s+year|a\s+year|annual(?:ly)?|\/\s?yr|base|range|rate|ote|earn(?:ing)?s?|per\s+visit|per\s+diem)\b/i;
const PERK_WORD_RE = /\b(?:reimburse\w*|stipend|sign[- ]?on|signing|referral|differential|tuition|assistance|allowance|discount|membership|bonus|401|match|repayment|relocation|equity|premiums?|contribut\w*|hsa|deductible|insurance|incentive|wellness|retirement|gift|credit)\b/i;
const CORE_PAY_RE = /\b(?:compensation|\d+k?\s+base|base\s+salary|salary|pay\s+range|base\s+pay|pay\s+rate|hourly\s+(?:rate|wage|range|pay)|wage|compensation\s+range|salary\s+range|starting\s+pay|rate\s+of\s+pay|pay\s+(?:is|of|starts))\b/i;
const UNIT_RE = /(per\s+hour|an\s+hour|\/\s?hr\b|\/\s?hour|hourly|per\s+year|a\s+year|per\s+annum|annually|annual|\/\s?yr\b|\/\s?year|per\s+visit|per\s+point|per\s+shift|per\s+week|weekly|per\s+month|monthly|per\s+diem)/i;
function unitOf(u) {
  const s = u.toLowerCase();
  if (/hour|hr/.test(s)) return ['hour', 'an hour'];
  if (/year|annum|annual|yr/.test(s)) return ['year', 'a year'];
  if (/visit/.test(s)) return ['visit', 'per visit'];
  if (/point/.test(s)) return ['point', 'per point'];
  if (/shift/.test(s)) return ['shift', 'per shift'];
  if (/week/.test(s)) return ['week', 'a week'];
  if (/month/.test(s)) return ['month', 'a month'];
  return ['day', 'per day'];
}
const num = (s) => {
  if (!s) return null;
  const t = String(s).replace(/[$,\s]/g, '');
  const k = /k$/i.test(t);
  const n = parseFloat(t.replace(/k$/i, ''));
  return Number.isFinite(n) ? (k ? n * 1000 : n) : null;
};
// "$000,000", "$00.00", "$X" — a template the employer never filled in
const placeholder = (s) => !/[1-9]/.test(String(s || ''));

/** Pay stated in ONE sentence (decoded text), or null. */
export function payInSentence(sentence) {
  const s = decodeEntities(sentence);
  if (!PAY_SENTENCE_RE.test(s) || !PAY_WORD_RE.test(s)) return null;
  if (PERK_WORD_RE.test(s) && !CORE_PAY_RE.test(s)) return null;
  let m = PAY_RANGE_RE.exec(s);
  let low, high, upTo = false, figure, at;
  if (m) {
    if (placeholder(m[2]) || (m[3] && placeholder(m[3]))) return null;
    // the figure next to a perk word is not the pay ("up to $75/month gym reimbursement")
    at = m.index + m[0].length;
    const near = s.slice(Math.max(0, m.index - 40), at + 40);
    if (PERK_WORD_RE.test(near) && !CORE_PAY_RE.test(near)) return null;
    low = num(m[2]); high = num(m[3]);
    if (m[3] && /k$/i.test(m[3].trim()) && !/k$/i.test(m[2].trim()) && low < 1000) low *= 1000;
    upTo = /^up to/i.test(m[1] || '');
    const lead = m[1] ? `${m[1].trim().replace(/^\w/, (c) => c.toUpperCase())} ` : '';
    figure = `${lead}${m[2].replace(/\s+/g, '')}${m[3] ? ` – ${m[3].replace(/\s+/g, '').replace(/^(?!\$)/, '$')}` : ''}${m[4] || ''}`;
  } else if ((m = BARE_RANGE_RE.exec(s)) && /\b(?:base|salary|compensation|pay)\b/i.test(s)) {
    if (placeholder(m[1]) || placeholder(m[2])) return null;
    low = num(m[1]); high = num(m[2]);
    if (low < 1000 && high >= 1000) low *= 1000;
    figure = `${m[1].replace(/\s+/g, '')} – ${m[2].replace(/\s+/g, '')}`;
    at = m.index + m[0].length;
  } else return null;
  if (!low || (high && high < low)) return null;
  // the unit that goes with THIS figure: written on it ("$130,000/yr."), right after it, or
  // "hourly / annual" just before it — never a unit from elsewhere in a run-on sentence
  const before = s.slice(Math.max(0, m.index - 60), m.index);
  const after = UNIT_RE.exec(s.slice(at, at + 40));
  const onFigure = /\/\s*(yr|year|hr|hour)\b/i.exec(m[0]);
  const u = onFigure || after || /\b(hourly|annual|yearly)\b/i.exec(before);
  const [unit, said] = u ? unitOf(u[1]) : [null, ''];
  // the quote: from the pay words just before the figure to the end of the figure (and its unit)
  const cue = [...before.matchAll(/\b(?:(?:annual|us|base|hourly|starting|anticipated)\s+)*(?:salary|pay|compensation|wages?|rate|earn)\b/gi)].pop();
  const start = cue ? m.index - before.length + cue.index : m.index;
  let end = after && after.index <= 4 ? at + after.index + after[0].length : at;
  const usd = /^\s*USD\b/.exec(s.slice(end));
  if (usd) end += usd[0].length;
  const q0 = s.slice(start, end);
  if ((q0.match(/\(/g) || []).length > (q0.match(/\)/g) || []).length) { const c = s.indexOf(')', end); if (c > 0 && c - end <= 30) end = c + 1; }
  const text = `${figure.replace(/\s*\/\s*(?:yr|year|hr|hour)\.?/gi, '')}${said ? ` ${said}` : ''}`;
  return { text, low, high: high || null, unit, upTo, quote: s.slice(start, end).replace(/\s+/g, ' ').trim() };
}

/** The pay a posting states (a range wins over a single figure), or null. */
export function readPostingPay(postingText) {
  const text = decodeEntities(postingText);
  const found = [];
  for (const r of sectionPosting(text)) {
    const p = payInSentence(r.sentence);
    if (p) found.push(p);
  }
  if (!found.length) return null;
  const best = found.find((p) => p.high) || found[0];
  return { text: best.text, low: best.low, high: best.high, unit: best.unit, upTo: best.upTo, source: best.quote };
}
