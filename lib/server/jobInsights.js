// Job Insights — a 10-second, quote-backed read of what a posting really asks, dealbreakers first.
// Deterministic and KEYLESS: no model, no network. Every field is a pure function of the posting.
//
// v5 (2026-11-10, judge baseline 4.7/10 — 77% of postings carried canned "hidden requirements"):
//   • ONE reading. The requirement list is the fit check's: extractJobFacts over the SAME text with
//     the SAME options (title, company, DB taxonomy) that api/optimizer.js passes, so Insights never
//     shows a requirement the verdict does not read (pinned by jobInsights.invariant.test.mjs).
//   • Every item quotes the posting. `items[]` = { text, kind, importance, source, gate } where
//     `source` is the posting sentence it was read from, verbatim (whitespace aside). An item whose
//     sentence cannot be found in the posting is dropped, never shown unsourced.
//   • Dealbreakers first: licences / certifications / years / degree / age / required schedule /
//     language, then the requirement skills ("any of" choices as one item), then the core duties;
//     preferred items last and labelled; nothing from the About / benefits / footer text.
//   • "Hidden requirements" are only conditions a requirement / duty / schedule sentence states
//     (schedule, physical, screening, travel, equipment), each carrying its sentence. No fallback:
//     a posting that states none answers [] and says so (`conditions_note`).
//   • The tip is built from this posting's own gates or choices, or it is absent ('').
//   • Pay only from a sentence that states pay (never "$2B ARR", a gym stipend or a sign-on bonus).
//
// Response shape (legacy fields kept for old clients and the job_insights cache):
//   { what_they_want: string[≤7], hidden_requirements: string[], insider_tip, description_summary,
//     items: [{ text, kind, importance, source, gate }], hidden_items: [{ text, kind, source }],
//     conditions_note, pay: { text, source } | null, tip_source, read, requirements_read }

import { extractJobFacts } from '../optimizer/extractJobFacts.js';
import { requirementSentences, sectionPosting, splitPostingSentences, RULED_OUT_RE, PAY_SENTENCE_RE, REQUIREMENT_CUE_RE } from '../optimizer/postingSections.js';
import { displaySkill } from '../optimizer/explainScore.js';
import { cutAtSentence, splitSentences } from '../text/sentences.js';
import { escapeRegExp } from '../text/escapeRegExp.js';

// ── Text ─────────────────────────────────────────────────────────────────────────────────────────
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// HTML → lines (block / list boundaries become line breaks so the reader sees its sections).
function stripToLines(s) {
  return String(s || '')
    .replace(/<\s*(?:br|\/p|\/li|\/div|\/tr|\/h[1-6]|li|p|div|h[1-6]|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}
const HTML_TAG_RE = /<\/?(?:p|li|br|div|ul|ol|h[1-6]|strong|b|em|span|table|tr|td)\b[^>]*>/i;
/**
 * The posting text every tool reads. A plain posting (every stored row but a handful) is read AS IS —
 * the fit check (api/optimizer.js) passes the description untouched, and Insights used to flatten
 * it first (stripToLines dropped blank lines and re-wrapped it), so the two could read different
 * requirements. Only markup is turned into lines, because the reader does not parse HTML (raw
 * Greenhouse HTML read as one "<p><strong>…" sentence and lost "Go, Java, C/C++" as a choice).
 */
export function postingTextForReader(description) {
  const s = String(description || '');
  return HTML_TAG_RE.test(s) ? stripToLines(s).join('\n') : s;
}
const norm = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).toLowerCase().match(/[a-z0-9+#]+/g) || [];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── Source sentences: the posting's own words, verbatim ──────────────────────────────────────────
// The reader quotes the CLEANED text it read (quotes straightened, bullets normalised, hard wraps
// joined, 240 chars max), so its `evidence` is found back in the posting itself: the posting
// sentence that holds it, else the posting sentence that shares the most words with it.
function sourceIndex(postingText) {
  const flat = norm(postingText);
  const pieces = [];
  for (const s of splitPostingSentences(postingText)) pieces.push(norm(s));
  for (const s of splitSentences(postingText)) pieces.push(norm(s));
  const uniq = [...new Set(pieces)].filter(p => p.length >= 3 && flat.includes(p));
  return { flat, pieces: uniq.map(p => ({ text: p, words: new Set(words(p)) })) };
}
const MAX_SOURCE = 320;
function clip(s) {
  if (s.length <= MAX_SOURCE) return s;
  const head = s.slice(0, MAX_SOURCE);
  const ws = head.lastIndexOf(' ');
  return (ws > MAX_SOURCE * 0.6 ? head.slice(0, ws) : head).replace(/[\s,;:—–-]+$/, '');
}
function findSource(idx, evidence) {
  const e = norm(evidence).replace(/^[•\-*]\s*/, '');
  if (!e || /^Job title:/i.test(e)) return null;
  // the whole posting sentence that holds the evidence, when it is in the posting as written
  const holds = idx.pieces.filter(p => p.text.includes(e));
  if (holds.length) return clip(holds.sort((a, b) => a.text.length - b.text.length)[0].text);
  // the evidence is a reflowed sentence the posting hard-wraps: its longest line-piece
  const inside = idx.pieces.filter(p => e.length >= 40 && e.includes(p.text) && p.text.length >= e.length * 0.6);
  if (inside.length) return clip(inside.sort((a, b) => b.text.length - a.text.length)[0].text);
  if (idx.flat.includes(e)) return clip(e);
  const ew = new Set(words(e));
  if (!ew.size) return null;
  let best = null, bestScore = 0;
  for (const p of idx.pieces) {
    let shared = 0;
    for (const w of ew) if (p.words.has(w)) shared++;
    const score = shared / Math.max(ew.size, Math.min(p.words.size, ew.size * 2));
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best && bestScore >= 0.6 ? clip(best.text) : null;
}

// ── Credential display names (a \b-anchored dictionary over the requirement's own sentence) ──────
const CERT_TERMS = [
  [/valid\s+driver'?s?\s+licen[cs]e/i, "Valid driver's license"],
  [/\bdriver'?s?\s+licen[cs]e/i, "Driver's license"],
  [/class\s*a\s*cdl|\bcdl\b[^.]{0,20}class\s*a/i, 'CDL Class A'],
  [/class\s*b\s*cdl|\bcdl\b[^.]{0,20}class\s*b/i, 'CDL Class B'],
  [/\bcdl\b/i, 'CDL'],
  [/forklift\s+(?:certif|licen|operat)/i, 'Forklift certification'],
  [/\bosha\s*10\b/i, 'OSHA 10'],
  [/\bosha\s*30\b/i, 'OSHA 30'],
  [/servsafe/i, 'ServSafe certification'],
  [/food\s+handler'?s?\s*(?:card|permit|certif)?/i, "Food handler's card"],
  [/\btips\s+certif|\btips\s+certified|tips\s+alcohol/i, 'TIPS certification'],
  [/\bbls\b/i, 'BLS'],
  [/\bacls\b/i, 'ACLS'],
  [/\bpals\b/i, 'PALS'],
  [/\bcpr\b/i, 'CPR certification'],
  [/\brn\s+licen[cs]e|registered\s+nurse\s+licen[cs]e|\brn\b(?=[^.]{0,15}licen)/i, 'RN license'],
  [/\bcna\b/i, 'CNA license'],
  [/\blvn\b|\blpn\b/i, 'LVN/LPN license'],
  [/\btwic\b/i, 'TWIC card'],
  [/security\s+guard\s+(?:card|licen)|\bguard\s+card\b/i, 'Security guard card'],
  [/cosmetology\s+(?:licen|certif)/i, 'Cosmetology license'],
  [/\bepa\s*608\b|epa\s+(?:universal|certif)/i, 'EPA 608 certification'],
  [/\base\s+certif|\base\b(?=[^.]{0,15}certif)/i, 'ASE certification'],
];
const certWords = (t) => t.toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/).filter((w) => w && !/^(?:certification|certified|card|license|licence|permit|valid|current|active|a|an|the)$/.test(w));
const sameCert = (a, b) => { const [x, y] = [certWords(a), certWords(b)].sort((p, q) => p.length - q.length); return x.length > 0 && x.every((w) => y.includes(w)); };
function certDisplay(label, sentence) {
  const hits = CERT_TERMS.filter(([re]) => re.test(sentence)).map(([, d]) => d).filter(d => sameCert(d, label));
  const valid = hits.find(d => /^Valid /.test(d));
  return valid || (hits.length === 1 ? hits[0] : cap(label));
}
const US_STATES = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';
const STATE_LICENCE_RE = new RegExp(`\\b(${US_STATES})\\b[^.;]{0,60}\\blicen[sc]|\\blicen[sc](?:e|ed|ure)\\b[^.;]{0,40}\\b(?:in|by)\\s+(?:the\\s+)?(?:state\\s+of\\s+)?(${US_STATES})\\b`);
// "RN license" read from "Active Arizona RN license" is shown as the posting scopes it: "Arizona RN license"
function withState(text, sentence) {
  const m = STATE_LICENCE_RE.exec(sentence);
  const st = m && (m[1] || m[2]);
  return st && !text.includes(st) ? `${st} ${text}` : text;
}

// ── Conditions a requirement / duty / schedule sentence states (never the blurb) ─────────────────
const SHIFT_TERMS = [
  [/\b(?:1st|first)\s+shift/i, '1st shift'],
  [/\b(?:2nd|second)\s+shift/i, '2nd shift'],
  [/\b(?:3rd|third)\s+shift/i, '3rd shift'],
  [/\bnight\s+shift/i, 'night shift'],
  [/\bovernight\s+shift|\bgraveyard\b/i, 'overnight shift'],
  [/\bswing\s+shift/i, 'swing shift'],
];
function namedShifts(sentence) {
  const out = [];
  const time = sentence.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  for (const [re, label] of SHIFT_TERMS) if (re.test(sentence)) out.push(label);
  if (out.length && time) out[0] = `${out[0]} (${time[1].replace(/\s+/g, '')}–${time[2].replace(/\s+/g, '')})`;
  return out;
}
function equipmentOf(sentence) {
  const out = [];
  if (/reliable\s+transportation/i.test(sentence)) out.push('Reliable transportation');
  if (/own\s+(?:vehicle|car)|use\s+of\s+(?:a|your)\s+(?:car|vehicle)|provide\s+your\s+own\s+(?:car|vehicle)/i.test(sentence)) out.push('Your own vehicle');
  if (/own\s+(?:hand\s+)?tools|provide\s+your\s+own\s+tools|bring\s+your\s+own\s+tools/i.test(sentence)) out.push('Your own tools');
  if (/smartphone\s+(?:required|access)|own\s+(?:a\s+)?smartphone/i.test(sentence)) out.push('A smartphone');
  return out;
}
function travelOf(sentence) {
  const pct = sentence.match(/\btravel[^.;]{0,40}?(?:up\s+to\s+)?(\d{1,3})\s*%|(?:up\s+to\s+)?(\d{1,3})\s*%\s+(?:of\s+(?:the\s+)?time\s+)?travel/i);
  if (pct) return `Travel: up to ${pct[1] || pct[2]}%`;
  if (/\b(?:travel\s+(?:is\s+)?required|required\s+to\s+travel|must\s+(?:be\s+(?:able|willing)\s+to\s+)?travel|willing(?:ness)?\s+to\s+travel|overnight\s+travel)\b/i.test(sentence)) return 'Travel required';
  return null;
}
const SCREEN_LABEL = { 'background check': 'Background check', 'drug test': 'Drug test', 'drug screen': 'Drug screen', 'drug screening': 'Drug screening', mvr: 'Driving record check (MVR)', 'motor vehicle record': 'Driving record check (MVR)', 'clean driving record': 'Clean driving record', fingerprint: 'Fingerprinting', fingerprinting: 'Fingerprinting', fingerprints: 'Fingerprinting' };
const SCREEN_HOW = {
  'Background check': { re: /background/i, lead: 'Offers depend on a check', act: 'Have your past employers and addresses ready.' },
  'Drug test': { re: /drug/i, lead: 'Before you start', act: 'Plan for a drug test before your start date.' },
  'Drug screen': { re: /drug/i, lead: 'Before you start', act: 'Plan for a drug screen before your start date.' },
  'Drug screening': { re: /drug/i, lead: 'Before you start', act: 'Plan for a drug screen before your start date.' },
  'Driving record check (MVR)': { re: /mvr|motor vehicle|driving/i, lead: 'They check your driving', act: 'Recent tickets or accidents can rule you out.' },
  'Clean driving record': { re: /driving/i, lead: 'They check your driving', act: 'Recent tickets or accidents can rule you out.' },
  Fingerprinting: { re: /fingerprint/i, lead: 'Before you start', act: 'Allow time for fingerprinting.' },
};
const SCREEN_SENTENCE = {
  'Background check': 'Offers depend on a background check — have your past employers and addresses ready.',
  'Drug test': 'Expect a drug test before your start date.',
  'Drug screen': 'Expect a drug screen before your start date.',
  'Drug screening': 'Expect a drug screen before your start date.',
  'Driving record check (MVR)': 'They will pull your driving record (MVR), so recent tickets matter.',
  'Clean driving record': 'They want a clean driving record — recent tickets or accidents can rule you out.',
  Fingerprinting: 'Expect fingerprinting before you start.',
};
const EQUIPMENT_SENTENCE = {
  'Reliable transportation': "You'll need reliable transportation to get to work.",
  'Your own vehicle': "You'll need your own vehicle for this job.",
  'Your own tools': "You're expected to bring your own tools.",
  'A smartphone': "You'll need a smartphone for the job.",
};
function joinList(xs) { return xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }
// a schedule word that commits your time (not just "full-time")
const SHIFT_COMMITMENT_RE = /night|overnight|weekend|evening|holiday|on-call|rotating|shift|early morning|blackout|open availability/i;

// ── Pay: only from a sentence that states pay ────────────────────────────────────────────────────
const MONEY = String.raw`\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?`;
const BIG_UNIT = String.raw`(?:[bBmM]\b|bn\b|billion|million|trillion)`;
const PER = String.raw`(?:\s*\/\s*(?:yr|year|hr|hour)\.?)?`;
const DASH = String.raw`(?:-|–|—|to|and|&[mn]dash;)`;
const PAY_RANGE_RE = new RegExp(String.raw`(up to\s+|starting at\s+|from\s+)?(${MONEY})(?![\d,]*\s*${BIG_UNIT})(?:\s*USD)?${PER}(?:\s*${DASH}\s*(${MONEY}|\d[\d,]*(?:\.\d+)?\s?[kK]?)(?!\s*${BIG_UNIT}))?(\+)?`, 'i');
const BARE_RANGE_RE = /\b(\d{2,3}(?:,\d{3})?\s?[kK]?)\s*(?:-|–|—|to|&[mn]dash;)\s*(\d{2,3}(?:,\d{3})?\s?[kK])\b/;
const PAY_WORD_RE = /\b(?:pay|salary|salaries|wage|wages|compensation|hourly|per\s+hour|an\s+hour|\/\s?h(?:ou)?r|per\s+year|a\s+year|annual(?:ly)?|\/\s?yr|base|range|rate|ote|earn(?:ing)?s?|per\s+visit|per\s+diem)\b/i;
const PERK_WORD_RE = /\b(?:reimburse\w*|stipend|sign[- ]?on|signing|referral|differential|tuition|assistance|allowance|discount|membership|bonus|401|match|repayment|relocation|equity|premiums?|contribut\w*|hsa|deductible|insurance|incentive|wellness|retirement|gift|credit)\b/i;
const CORE_PAY_RE = /\b(?:compensation|\d+k?\s+base|base\s+salary|salary|pay\s+range|base\s+pay|pay\s+rate|hourly\s+(?:rate|wage|range|pay)|wage|compensation\s+range|salary\s+range|starting\s+pay|rate\s+of\s+pay|pay\s+(?:is|of|starts))\b/i;
const UNIT_RE = /(per\s+hour|an\s+hour|\/\s?hr\b|\/\s?hour|hourly|per\s+year|a\s+year|per\s+annum|annually|annual|\/\s?yr\b|\/\s?year|per\s+visit|per\s+point|per\s+shift|per\s+week|weekly|per\s+month|monthly|per\s+diem)/i;
function unitName(u) {
  const s = u.toLowerCase().replace(/\s+/g, ' ');
  if (/hour|hr/.test(s)) return 'an hour';
  if (/year|annum|annual|yr/.test(s)) return 'a year';
  if (/visit/.test(s)) return 'per visit';
  if (/point/.test(s)) return 'per point';
  if (/shift/.test(s)) return 'per shift';
  if (/week/.test(s)) return 'a week';
  if (/month/.test(s)) return 'a month';
  return s;
}
function payOf(sentence) {
  if (!PAY_SENTENCE_RE.test(sentence) || !PAY_WORD_RE.test(sentence)) return null;
  if (PERK_WORD_RE.test(sentence) && !CORE_PAY_RE.test(sentence)) return null;
  let m = PAY_RANGE_RE.exec(sentence);
  let figure;
  let at;
  if (m) {
    figure = `${m[1] ? m[1].trim().replace(/^\w/, c => c.toUpperCase()) + ' ' : ''}${m[2].replace(/\s+/g, '')}${m[3] ? ` – ${m[3].replace(/\s+/g, '')}` : ''}${m[4] || ''}`;
    at = m.index + m[0].length;
    // the figure next to a perk word is not the pay ("up to $75/month gym reimbursement")
    const near = sentence.slice(Math.max(0, m.index - 40), at + 40);
    if (PERK_WORD_RE.test(near) && !CORE_PAY_RE.test(near)) return null;
  } else if ((m = BARE_RANGE_RE.exec(sentence)) && /\b(?:base|salary|compensation|pay)\b/i.test(sentence)) {
    figure = `${m[1].replace(/\s+/g, '')} – ${m[2].replace(/\s+/g, '')}`;
    at = m.index + m[0].length;
  } else return null;
  // the unit that goes with THIS figure: written on it ("$130,000/yr."), right after it, or
  // "hourly / annual" just before it — never a unit from elsewhere in a run-on sentence
  const before = sentence.slice(Math.max(0, m.index - 60), m.index);
  const after = UNIT_RE.exec(sentence.slice(at, at + 40));
  const onFigure = /\/\s*(yr|year|hr|hour)\b/i.exec(m[0]);
  const unit = onFigure || after || /\b(hourly|annual|yearly)\b/i.exec(before);
  // the quote: from the pay words just before the figure to the end of the figure (and its unit)
  const cue = [...before.matchAll(/\b(?:(?:annual|us|base|hourly|starting|anticipated)\s+)*(?:salary|pay|compensation|wages?|rate|earn)\b/gi)].pop();
  const start = cue ? m.index - before.length + cue.index : m.index;
  let end = after && after.index <= 4 ? at + after.index + after[0].length : at;
  const usd = /^\s*USD\b/.exec(sentence.slice(end));
  if (usd) end += usd[0].length;
  const q0 = sentence.slice(start, end);
  if ((q0.match(/\(/g) || []).length > (q0.match(/\)/g) || []).length) { const c = sentence.indexOf(')', end); if (c > 0 && c - end <= 30) end = c + 1; }
  return { text: unit ? `${figure.replace(/\s*\/\s*(?:yr|year|hr|hour)\.?$/i, '')} ${unitName(unit[1])}` : figure, range: /–/.test(figure), quote: sentence.slice(start, end).trim() };
}
function findPay(rows, idx) {
  const found = [];
  for (const r of rows) {
    const p = payOf(r.sentence);
    if (!p) continue;
    const q = norm(p.quote);
    const source = q.length >= 4 && idx.flat.includes(q) ? q : findSource(idx, r.sentence);
    if (source) found.push({ text: p.text, range: p.range, source });
  }
  if (!found.length) return null;
  const best = found.find(p => p.range) || found[0];
  return { text: best.text, source: best.source };
}

// ── Skill display ────────────────────────────────────────────────────────────────────────────────
function skillName(f, { lower = false } = {}) {
  // a requirement in the posting's own words (lib/optimizer/postingTerms.js) is shown as the posting wrote it
  if (f.term) return lower ? f.label : f.label.replace(/^[a-z]/, (c) => c.toUpperCase());
  if (f.normalizedLabel === 'c++' && (f.postingPhrases || []).includes('c/c++')) return 'C/C++';
  const d = displaySkill(f.normalizedLabel);
  return lower ? d : cap(d);
}
// A duty sentence starts with what you do ("Install, maintain and repair…", "Demonstrates critical
// thinking…"); a narrative sentence ("What ships here isn't metrics on a dashboard", "It shows up on
// the loading dock") states no requirement and is never read as one.
const DUTY_VERBS = 'lead|manage|oversee|supervise|train|coach|mentor|develop|design|build|ship|own|drive|define|partner|collaborate|work|write|create|plan|prepare|perform|provide|ensure|maintain|monitor|review|analy[sz]e|report|track|coordinate|schedule|communicate|respond|answer|greet|assist|support|help|handle|process|resolve|deliver|operate|install|repair|troubleshoot|inspect|test|diagnose|clean|stock|pick|pack|load|unload|receive|count|scan|ring|open|close|administer|assess|document|educate|implement|execute|achieve|exceed|champion|raise|take|participate|conduct|run|set|use|apply|follow|comply|identify|serve|sell|cook|transport|move|organi[sz]e|file|enter|update|reconcile|post|record|audit|research|evaluate|recommend|negotiate|present|launch|grow|scale|improve|optimi[sz]e|automate|integrate|deploy|configure|secure|protect|care|treat|demonstrate|assume|adhere|uphold|embrace|foster|promote|enforce|verify|calculate|measure|estimate|generate|prospect|source|recruit|interview|hire|onboard|act|keep|make|establish|direct|contribute|bring|translate|architect|code|program|engineer|debug|craft|produce|edit|publish|approve|prioriti[sz]e|delegate|instruct|guide|advise|consult|counsel|represent|investigate|observe|detect|prevent|mitigate|dispatch|navigate|weld|fabricate|assemble|wire|terminate|pull|lift|carry|sort|label|package|wrap|replenish|merchandise|order|purchase|bill|invoice|collect|balance|forecast|budget|model|query|visuali[sz]e|explore|experiment|iterate|refine|validate|qualify|nurture|engage|connect|host|facilitate|teach|tutor|grade|chart|triage|admit|discharge|transfer|titrate|infuse|draw';
const DUTY_START_RE = new RegExp(`^(?:[•\\-*]\\s*)?(?:${DUTY_VERBS})(?:s|es|ed|d|ing)?\\b`, 'i');
const YOU_RE = /\byou(?:'ll|’ll| will| should| must| would| can)\b/i;
// "Holder of valid COC (STCW Reg III/2)" states a credential the way a mariner's posting does
const CREDENTIAL_CUE_RE = /\b(?:holder\s+of|hold(?:s|ing)?\s+(?:a|an|the|valid|current|active)|possess(?:es|ion\s+of)?|valid|current|active|certified|licensed)\b/i;
function statesSomething(src, row) {
  return (row && row.explicit && (row.kind === 'requirements' || row.kind === 'preferred'))
    || REQUIREMENT_CUE_RE.test(src) || CREDENTIAL_CUE_RE.test(src) || DUTY_START_RE.test(src) || YOU_RE.test(src);
}
const itemWords = (t) => new Set(t.toLowerCase().replace(/\([^)]*\)/g, ' ').match(/[a-z0-9+#]+/g) || []);
// a skill item that only repeats a gate read from the same sentence ("Warehouse" beside "1+ year of
// experience in warehouse or similar environment", "CPR" beside "CPR certification")
function repeatsGate(item, gates) {
  const w = itemWords(item.text);
  return gates.some((g) => {
    if ((g.kind === 'licence' || g.kind === 'certification') && sameCert(g.text, item.text)) return true;
    if (g.source !== item.source || !(g.kind === 'years' || g.kind === 'degree')) return false;
    const gw = itemWords(g.text);
    return w.size > 0 && [...w].every((x) => gw.has(x));
  });
}
// the requirement sits inside a negation ("…isn't metrics on a dashboard", "no experience with X needed")
function negated(f, src) {
  const lower = src.toLowerCase();
  const phrases = [...(f.postingPhrases || []), f.label].map(p => String(p || '').toLowerCase()).filter(Boolean);
  for (const p of phrases) {
    const i = lower.indexOf(p);
    if (i < 0) continue;
    return /\b(?:not|isn't|isn’t|aren't|aren’t|won't|won’t|don't|don’t|doesn't|doesn’t|never|without|no)\s+(?:[\w/-]+\s+){0,5}$/.test(lower.slice(Math.max(0, i - 50), i));
  }
  return false;
}

// Several posting terms read from one phrase ("integration, abstraction, or platform layers",
// "COC (STCW Reg III/2)") are ONE requirement: shown once, as the posting wrote that phrase.
function tidySpan(span) {
  let t = span.replace(/[\s,([]+$/, '').replace(/\s+,/g, ',');
  // two parts: "revenue recognition, and financial reporting principles" → "… and …"
  if ((t.match(/,/g) || []).length === 1) t = t.replace(/,\s+(and|or)\s+/, ' $1 ');
  return t;
}
function closeBrackets(t) {
  let out = t;
  if ((out.match(/\(/g) || []).length > (out.match(/\)/g) || []).length) out += ')';
  if ((out.match(/\[/g) || []).length > (out.match(/\]/g) || []).length) out += ']';
  return out;
}
function mergeTermRuns(rows) {
  const out = [];
  const done = new Set();
  for (const r of rows) {
    if (done.has(r)) continue;
    const group = r.f.term && r.item.kind !== 'any_of' ? rows.filter((o) => o.f.term && o.item.kind !== 'any_of' && o.item.source === r.item.source && o.item.importance === r.item.importance) : [r];
    if (group.length >= 2) {
      const lower = r.item.source.toLowerCase();
      const at = group.map((g) => { const i = lower.indexOf(g.f.label.toLowerCase()); return i < 0 ? null : [i, i + g.f.label.length]; });
      if (at.every(Boolean)) {
        const start = Math.min(...at.map((a) => a[0]));
        const stop = Math.max(...at.map((a) => a[1]));
        const span = r.item.source.slice(start, stop);
        if (span.length <= 64 && (span.match(/,/g) || []).length <= 3 && !/[.;:!?]\s/.test(span)) {
          group.forEach((g) => done.add(g));
          out.push({ f: r.f, item: { ...r.item, text: closeBrackets(cap(tidySpan(span))), labels: group.flatMap((g) => g.item.labels) } });
          continue;
        }
      }
    }
    done.add(r);
    out.push(r);
  }
  return out;
}

// ── Insider tip: this posting's own gate or choice, or nothing ───────────────────────────────────
const YEARS_FIGURE_RE = /\d{1,2}\s*\+?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\(\d+\)\s+)?years?\b/i;
function insiderTip(items) {
  const req = items.filter(i => i.importance === 'required');
  const quoted = (i, re) => clauseAround(i.source, re) || i.source;
  const lic = req.filter(i => i.kind === 'licence');
  if (lic.length) {
    const q = quoted(lic[0], /licen[sc]/i);
    const choice = / or /i.test(q) || / or /i.test(lic[0].text);
    const also = lic[1] && !q.toLowerCase().includes(lic[1].text.toLowerCase().replace(/^valid /, '')) ? ` It also asks for ${lic[1].text.replace(/^Valid /, 'a valid ')}.` : '';
    return { tip: `The licence is the gate here: "${q}". ${choice ? 'Say which one you hold' : 'Say you hold it'} in your first line.${also}`, source: q };
  }
  const certAll = req.filter(i => i.kind === 'certification');
  // lead with the credential whose own sentence states it as a requirement ("Basic Life Support (BLS)
  // CPR through American Heart Association"), not one named in passing
  const cue = (i) => Number(/\b(?:certif|required|current|valid|active|must)\w*/i.test(i.source));
  const cert = [...certAll].sort((a, b) => (cue(b) - cue(a)) || (a.source.length - b.source.length));
  if (cert.length) {
    const word = escapeRegExp(cert[0].text.replace(/ certification$/i, '').split(/\s+/)[0]);
    const q = quoted(cert[0], new RegExp(`\\b${word}`, 'i'));
    const names = joinList(cert.slice(0, 2).map(i => i.text));
    return { tip: `They screen for it: "${q}". If you hold ${names}, put ${cert.length > 1 ? 'them' : 'it'} in your first line, spelled the way they spell it.`, source: q };
  }
  const years = req.find(i => i.kind === 'years');
  const anyOfFirst = req.find(i => i.kind === 'any_of');
  // one sentence only when the choice is the stack the years are counted in ("…in Go, Java or C/C++")
  const toolish = (t) => /^[A-Z0-9][\w+#./-]*$/.test(t) || /[a-z][A-Z]|[A-Z]{2}/.test(t);
  if (years && anyOfFirst && anyOfFirst.text.replace(/^Any of:\s*/, '').split(', ').every(toolish)) {
    const opts = anyOfFirst.text.replace(/^Any of:\s*/, '');
    const q = quoted(years, YEARS_FIGURE_RE);
    return { tip: `The experience bar: "${q}". They accept any of ${opts} — name the one you use, with your years in it, in your first line.`, source: q };
  }
  if (years) {
    const q = quoted(years, YEARS_FIGURE_RE);
    const bare = /^\d+\+ years? of experience$/i.test(years.text);
    return { tip: `The experience bar: "${q}". ${bare ? "Say how many years you have in your first line, so a screener doesn't have to count." : 'Say your years in exactly that work in your first line.'}`, source: q };
  }
  const anyOf = req.find(i => i.kind === 'any_of');
  if (anyOf) return { tip: `They accept any one of ${anyOf.text.replace(/^Any of:\s*/, '')} — name the one you use most, in their spelling. You don't need all of them.`, source: anyOf.source };
  const sched = req.find(i => i.kind === 'schedule');
  if (sched) {
    const q = quoted(sched, /shift|weekend|night|holiday|on[- ]call|hours|availab|evening|overnight|rotation/i);
    return { tip: `The schedule is a gate: "${q}". Say plainly in your application that you can work it.`, source: q };
  }
  const degree = req.find(i => i.kind === 'degree');
  if (degree) {
    const q = quoted(degree, /bachelor|master|degree|diploma|\bged\b|doctorate|associate|\bb\.?s\b|\bb\.?a\b|ph\.?d/i);
    const school = /high school|diploma|\bged\b/i.test(degree.text);
    const equiv = !school && /equivalent|in lieu/i.test(degree.text + ' ' + q);
    const act = school ? 'List it in your education section — screeners often filter on it.'
      : equiv ? "If you don't hold the degree, say in your first lines how your experience stands in for it." : 'Put your degree where a screener sees it in the first lines.';
    return { tip: `The education bar: "${q}". ${act}`, source: q };
  }
  // the posting names its tools: the exact words, where they are true
  const named = req.filter(i => i.tool).slice(0, 3).map(i => ({ ...i, text: i.text.replace(/ \(or similar\)$/, '') }));
  if (named.length >= 2) return { tip: `It names ${joinList(named.map(i => i.text))} — use those exact words on your résumé wherever they're true, not a synonym.`, source: named[0].source };
  if (named.length === 1) return { tip: `It names ${named[0].text} — if you've worked with it, write "${named[0].text}" on your résumé, not a synonym.`, source: named[0].source };
  return { tip: '', source: null };
}

// The posting's own clause around a match — verbatim, so it can be quoted: from the last clause break
// before the match to the next one after it, cut at a comma or a word when it runs long.
function clauseAround(src, re, max = 170) {
  const text = String(src || '');
  const m = re.exec(text);
  if (!m) return null;
  let start = 0;
  for (const b of text.slice(0, m.index).matchAll(/[.;:•!?](?=\s)|\s[-–—]\s/g)) start = b.index + b[0].length;
  const rest = text.slice(m.index);
  const stop = rest.search(/[.;!?](?=\s|$)|\s[-–—]\s/);
  let end = stop < 0 ? text.length : m.index + stop;
  if (end - start > max) {
    const comma = text.indexOf(', ', m.index + m[0].length + 12);
    end = comma > 0 && comma - start <= max ? comma : Math.min(end, start + max);
    if (end - start >= max) { const ws = text.lastIndexOf(' ', end); if (ws > m.index + m[0].length) end = ws; }
    if (end - start > max + 40) start = Math.max(start, text.lastIndexOf(' ', Math.max(0, m.index - 30)) + 1);
  }
  // never quote half a parenthesis: "Bachelor's Degree (BBA, BA or BS" → "… or BS)"
  const open = (t) => (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
  if (open(text.slice(start, end)) > 0) { const close = text.indexOf(')', end); if (close > 0 && close - end <= 80) end = close + 1; }
  if (open(text.slice(start, end)) < 0) { const o = text.lastIndexOf('(', start); if (o >= 0 && start - o <= 80) start = o; }
  const c = text.slice(start, end).replace(/^[\s,\-–—•*]+|[\s,\-–—:]+$/g, '')
    // a heading run into the line ("Required Skills & Qualifications Minimum of 3 years…")
    .replace(/^(?:(?:Required|Preferred|Minimum|Basic|Key|Desired)\s+)?(?:(?:Skills|Experience|Education)\s*(?:&|and)\s*)?(?:Qualifications|Requirements|Skills)\s*:?\s+(?=[A-Z0-9])/, '');
  return c.length >= 4 ? c : null;
}

// ── description_summary ──────────────────────────────────────────────────────────────────────────
// What the job is (the posting's own first sentences about the ROLE, never the company blurb), what
// it asks for and the pay the posting states, in whole sentences (never cut mid-word).
const ROLE_SENTENCE_RE = /\b(?:[Yy]ou(?:'|’)?ll|[Yy]ou will|[Tt]his role|in this role|as (?:a|an|the) [A-Z]|[Ww]e(?:'|’)re looking for|[Ww]e are looking for|(?:[Tt]he|[Tt]his|[Oo]ur) [A-Z][\w&-]*(?: (?:&|[A-Z][\w&-]*)){0,5} will)\b/;
function summarize(title, company, rows, what, pay) {
  const co = /^[a-z][a-z0-9]*$/.test(String(company || '')) ? company.charAt(0).toUpperCase() + company.slice(1) : company;
  const role = title ? `${title}${co ? ` at ${co}` : ''}` : 'This role';
  const ok = (s) => s.length >= 30 && !PAY_SENTENCE_RE.test(s) && !RULED_OUT_RE.test(s);
  const intro = rows.find(r => (r.kind === 'about' || r.kind === 'culture' || r.kind === 'responsibilities') && ok(r.sentence) && ROLE_SENTENCE_RE.test(r.sentence));
  const duties = rows.filter(r => r.kind === 'responsibilities' && r !== intro && ok(r.sentence) && (DUTY_START_RE.test(r.sentence) || YOU_RE.test(r.sentence)));
  const roleSents = [intro, ...duties].filter(Boolean).slice(0, 2).map(r => cutAtSentence(r.sentence, 260));
  const end = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);
  const parts = [`${role}.`, ...roleSents.map(end)];
  if (what.length) parts.push(`What it asks for: ${what.join('; ')}.`);
  // the pay in the posting's own words ("between 140 - 170k base"), never a figure re-typed
  if (pay) parts.push(`Pay: ${end(pay.source.replace(/^(?:compensation|pay|salary)\s*:?\s*/i, '').replace(/^\w/, (c) => c.toUpperCase()))}`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ── The older flat post-check, kept for callers that still pass a flat insight ───────────────────
const SKILL_PATTERNS = new Map([
  ['Python', /python/i], ['Java', /java\b/i], ['JavaScript', /javascript/i], ['TypeScript', /typescript/i], ['React', /react/i],
  ['Node.js', /node\.?js|node\b/i], ['AWS', /\baws\b|amazon web services/i], ['Kubernetes', /kubernetes|k8s/i], ['Docker', /docker/i],
  ['PostgreSQL', /postgres(ql)?/i], ['SQL', /\bsql\b/i], ['C++', /c\+\+/i], ['Go', /\bgolang\b|\bgo\b/i], ['Ruby', /ruby/i], ['Kotlin', /kotlin/i],
  ['Machine Learning', /machine learning|\bml\b/i], ['Excel', /\bexcel\b/i], ['Salesforce', /salesforce/i],
]);
function skillInPosting(display, lowerText) {
  if (display === 'C/C++') return /\bc\/c\+\+/i.test(lowerText);
  const re = SKILL_PATTERNS.get(display);
  return re ? re.test(lowerText) : null; // null = not a dictionary skill
}
function yearsInPosting(n, text) {
  return new RegExp(`(?<!\\d)${escapeRegExp(n)}(?!\\d)\\s*\\+?\\s*(?:(?:-|–|—|to)\\s*\\d{1,2}\\s*\\+?\\s*)?(?:years?|yrs?)\\b`, 'i').test(text);
}
const SCHEDULE_MENTION_RE = /\b(?:shifts?|schedul(?:e|es|ed|ing)|weekends?|overnights?|graveyard|nights?|on[- ]call|rotating|overtime|(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)))\b/i;
export function postingMentionsSchedule(text) { return SCHEDULE_MENTION_RE.test(String(text || '')); }
const SCHEDULE_CLAIM_RE = /\b(?:shifts?|schedules?|weekends?|non-standard hours|availability)\b/i;
export function verifyInsightAgainstPosting(insight, description, readNames = null) {
  const read = new Set((readNames || []).map(n => String(n).toLowerCase()));
  const text = stripHtml(description);
  const lower = text.toLowerCase();
  const what = [];
  for (const item of insight.what_they_want || []) {
    const any = /^Any of: (.+)$/.exec(item);
    if (any) {
      const kept = any[1].split(', ').filter(d => read.has(d.toLowerCase()) || skillInPosting(d, lower) !== false);
      if (kept.length >= 2) what.push(`Any of: ${kept.join(', ')}`);
      else if (kept.length === 1) what.push(`${kept[0]} (or similar)`);
      continue;
    }
    const similar = /^(.+) \(or similar\)$/.exec(item);
    const years = /^(\d{1,2})\+ years? /.exec(item);
    if (years) { if (yearsInPosting(years[1], text)) what.push(item); continue; }
    const name = (similar ? similar[1] : item).replace(/ \((?:e\.g\. .*|preferred)\)$/, '');
    if (!read.has(name.toLowerCase()) && skillInPosting(name, lower) === false) continue;
    what.push(item);
  }
  const scheduleOk = postingMentionsSchedule(text);
  const hidden = (insight.hidden_requirements || []).filter(h => scheduleOk || !SCHEDULE_CLAIM_RE.test(h));
  let tip = insight.insider_tip || '';
  if (!scheduleOk && SCHEDULE_CLAIM_RE.test(tip)) tip = '';
  return { ...insight, what_they_want: [...new Set(what)], hidden_requirements: hidden, insider_tip: tip };
}

// ── Main entry — pure + deterministic ────────────────────────────────────────────────────────────
const GATE_ORDER = ['licence', 'certification', 'years', 'degree', 'age', 'schedule', 'language', 'experience'];
const NOT_READ_TIP = "This listing doesn't say what it requires — ask the hiring team for the full job description before you put time into an application.";
const MAX_ITEMS = 14;
const READ_SECTIONS = new Set(['requirements', 'preferred', 'responsibilities']);

/**
 * @param {{ title?: string, company?: string, description?: string, needsSummary?: boolean,
 *           taxonomy?: { aliases: object, relationships: object } | null }} input
 *   `taxonomy` = the DB overlay the fit check reads (lib/server/skillTaxonomy.js); pass the same one.
 */
export function buildJobInsights(input = {}) { return analyze(input).result; }
function analyze({ title, company, description, needsSummary = true, taxonomy = null } = {}) {
  const postingText = postingTextForReader(description);
  // EXACTLY the fit check's call (api/optimizer.js): same text, title, company and taxonomy
  const facts = extractJobFacts(postingText, { jobTitle: title || '', company: company || '', taxonomy: taxonomy || undefined });
  const idx = sourceIndex(postingText);
  const rows = sectionPosting(postingText);
  const rowOf = new Map(rows.map(r => [norm(r.sentence), r]));
  const reqRows = requirementSentences(postingText).filter(r => !RULED_OUT_RE.test(r.sentence));

  const skills = facts.filter(f => f.factType === 'skill' && !f.soft);
  const constraints = facts.filter(f => f.factType === 'constraint');
  const byLabel = new Map(skills.map(f => [f.normalizedLabel, f]));

  // 1. gates — the requirements that rule a person in or out
  const gates = [];
  for (const c of constraints) {
    const sentence = c.evidence || c.sentence || '';
    let kind = null, text = '';
    if (c.kind === 'certification') {
      const display = certDisplay(c.label, sentence);
      kind = /licen[sc]/i.test(display) ? 'licence' : 'certification';
      text = kind === 'licence' ? withState(display, sentence) : display;
    } else if (c.kind === 'years') { kind = 'years'; text = cap(c.label); }
    else if (c.kind === 'degree') { kind = 'degree'; text = cap(c.label.replace(/^an? /, '').replace(/, or an? /g, ', or ')); }
    else if (c.kind === 'age') { kind = 'age'; text = `Must be ${c.value}+`; }
    else if (c.kind === 'language' && c.value !== 'english') { kind = 'language'; text = cap(c.label); }
    else if (c.kind === 'management') { kind = 'experience'; text = 'Management / supervisory experience'; }
    else if (c.kind === 'schedule' && c.importance === 'required') {
      const commit = (c.items || []).filter(i => SHIFT_COMMITMENT_RE.test(i));
      if (commit.length) { kind = 'schedule'; text = `Availability: ${commit.join(', ')}`; }
    }
    if (!kind) continue;
    const source = findSource(idx, sentence);
    if (!source) continue;
    if (kind === 'years' && !yearsInPosting(c.value, source)) continue;
    // the employer's own history ("a family-founded organization with over 25 years of experience")
    if (kind === 'years' && /\b(?:over|more than|nearly|almost|celebrating)\s+\d+\s+years/i.test(source) && !/\byou\b|candidate|applicant|minimum|required|must|\d+\s*\+\s*(?:years?|yrs?)/i.test(source)) continue;
    // a years figure that is not about experience ("celebrating 50 years of compassion") is no gate
    if (kind === 'years' && !/experien|\bexp\b|background|working|professional|industry|related|relevant|practice|track record|in (?:a|an|the)\s|as (?:a|an)\s|\byears? (?:of|in) [a-z-]+ (?:roles?|work|positions?|environments?|settings?)|\b(?:years?|yrs?)\s+(?:of\s+)?(?:managing|leading|building|running|selling|supporting|operating|teaching|working|doing|developing|designing|in|as|with)\b/i.test(source)) continue;
    const credential = (k) => k === 'licence' || k === 'certification';
    if (credential(kind) && gates.some(g => credential(g.kind) && sameCert(g.text, text))) continue;
    gates.push({ text, kind, importance: c.importance === 'preferred' ? 'preferred' : 'required', source, gate: c.importance !== 'preferred', labels: [c.label] });
  }
  // "7+ years of management experience" already says it
  if (gates.some(g => g.kind === 'years' && /manag|supervis|leadership/i.test(g.text))) for (let i = gates.length - 1; i >= 0; i--) if (gates[i].kind === 'experience') gates.splice(i, 1);
  gates.sort((a, b) => GATE_ORDER.indexOf(a.kind) - GATE_ORDER.indexOf(b.kind));

  // 2./3. requirement skills (a choice is one item, examples ride with their skill) and core duties
  if (constraints.some(c => c.kind === 'language')) for (const f of skills) if (/^bilingual\b/.test(f.normalizedLabel)) byLabel.delete(f.normalizedLabel);
  const used = new Set();
  const skillRows = [];
  for (const f of skills) {
    if (!byLabel.has(f.normalizedLabel) || used.has(f.normalizedLabel)) continue;
    if (!READ_SECTIONS.has(f.section)) continue; // the title, a schedule note, the blurb: not a requirement line
    if (f.exampleOf && byLabel.has(f.exampleOf)) continue; // shown with the skill it illustrates
    const evidence = f.evidence || '';
    const row = rowOf.get(norm(evidence)) || null;
    const source = findSource(idx, evidence);
    if (!source || !statesSomething(source, row) || negated(f, source)) continue;
    let text, labels, kind;
    if (f.anyOf && f.anyOfLabels && f.anyOfLabels.length >= 2) {
      const members = f.anyOfLabels.map(l => byLabel.get(l)).filter(Boolean);
      if (members.length < 2) continue;
      members.forEach(m => used.add(m.normalizedLabel));
      text = `Any of: ${members.map(m => skillName(m)).join(', ')}`;
      labels = members.map(m => m.label);
      kind = 'any_of';
    } else {
      used.add(f.normalizedLabel);
      const ex = (f.examples || []).map(l => byLabel.get(l)).filter(Boolean);
      ex.forEach(m => used.add(m.normalizedLabel));
      const name = skillName(f);
      const exNames = ex.map(m => skillName(m, { lower: true }));
      const exList = exNames.length > 1 ? `${exNames.slice(0, -1).join(', ')} or ${exNames[exNames.length - 1]}` : exNames[0];
      text = ex.length ? `${name} (e.g. ${exList})` : f.orSimilar ? `${name} (or similar)` : name;
      labels = [f.label, ...ex.map(m => m.label)];
      kind = (f.section === 'requirements' || f.section === 'preferred' || f.hard || REQUIREMENT_CUE_RE.test(source) || CREDENTIAL_CUE_RE.test(source)) ? 'skill' : 'duty';
    }
    skillRows.push({ f, item: { text, kind, importance: f.importance === 'preferred' ? 'preferred' : 'required', source, gate: false, labels, tool: kind !== 'any_of' && !f.term && !(f.examples || []).length && /^[A-Z0-9]/.test(displaySkill(f.normalizedLabel)) } });
  }
  const rank = ({ f, item }) => [
    item.kind === 'duty' ? 1 : 0,
    f.section === 'requirements' ? 0 : 1,
    item.kind === 'any_of' || f.hard ? 0 : 1,
    f.term ? 1 : 0,
    -(f.weight || 0),
    -(f.mentions || 0),
  ];
  const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  skillRows.sort(cmp);

  // the same thing named twice in one sentence: "Microsoft Office" and the posting's "Microsoft Office Suite"
  const longerTwin = ({ f, item }) => f.term && skillRows.some((o) => o.item !== item && o.item.source === item.source
    && o.item.text.length < item.text.length && new RegExp(`\\b${escapeRegExp(o.item.text.toLowerCase())}\\b`).test(item.text.toLowerCase()));
  const keptSkills = mergeTermRuns(skillRows.filter((r) => !repeatsGate(r.item, gates) && !longerTwin(r)));
  // a sparse posting (fewer than 3 stated skills) also shows the traits it states ("Punctual and excellent attendance")
  if (keptSkills.filter((r) => r.item.importance === 'required').length + gates.length < 3) {
    for (const f of facts.filter((x) => x.factType === 'skill' && x.soft && READ_SECTIONS.has(x.section))) {
      const source = findSource(idx, f.evidence || '');
      if (!source || !statesSomething(source, rowOf.get(norm(f.evidence || '')) || null) || negated(f, source)) continue;
      keptSkills.push({ f, item: { text: skillName(f), kind: 'trait', importance: f.importance === 'preferred' ? 'preferred' : 'required', source, gate: false, labels: [f.label] } });
    }
  }

  const items = [];
  const add = (it) => { if (it && it.source && it.text && !items.some(x => x.text.toLowerCase() === it.text.toLowerCase())) items.push(it); };
  for (const g of gates.filter(g => g.importance === 'required')) add(g);
  for (const s of keptSkills.filter(s => s.item.importance === 'required')) add(s.item);
  for (const g of gates.filter(g => g.importance === 'preferred')) add(g);
  for (const s of keptSkills.filter(s => s.item.importance === 'preferred')) add(s.item);
  const shown = items.slice(0, MAX_ITEMS);

  // conditions the requirement / duty / schedule sentences state — each a plain sentence that says
  // what the posting asks and what to do about it, with the sentence it came from
  const hidden = [];
  // `make(q)` writes the sentence around the posting's own clause `q` (verbatim, from the source)
  const addHidden = (label, kind, sentence, re, make) => {
    const source = findSource(idx, sentence);
    if (!source || hidden.some(h => h.label.toLowerCase() === label.toLowerCase())) return;
    const q = re ? clauseAround(source, re) : null;
    hidden.push({ text: make(q), label, kind, source });
  };
  const SCHED_RE = /shift|weekend|night|holiday|evening|overnight|part[- ]time|seasonal|temporary|hours|on[- ]call|rotat|availab|blackout|mornings?/i;
  const gateSchedule = shown.some(i => i.kind === 'schedule');
  const physical = [];
  for (const r of reqRows) {
    const shifts = namedShifts(r.sentence);
    if (!shifts.length) continue;
    addHidden(shifts.join(', '), 'schedule', r.sentence, /shift/i, (q) => (shifts.length > 1
      ? `It names ${joinList(shifts.map(x => `a ${x}`))} — ask which one this opening is before you apply.`
      : /\d:\d|\d\s*(?:am|pm)/i.test(shifts[0]) || !q
        ? `It's ${/^[aeio]|^8/i.test(shifts[0]) ? 'an' : 'a'} ${shifts[0]} — apply only if you can work those hours every week.`
        : `It's ${/^[aeio]|^8/i.test(shifts[0]) ? 'an' : 'a'} ${shifts[0]}: "${q}". Apply only if you can work it every week.`));
  }
  for (const c of constraints) {
    const sentence = c.evidence || c.sentence || '';
    if (c.kind === 'schedule' && !gateSchedule) {
      const its = (c.items || []).filter(i => !/^full-time$/.test(i));
      // a named shift from the same sentence already says it ("2nd shift (2:30pm–11pm)")
      const src = findSource(idx, sentence);
      if (!its.length || hidden.some(h => h.kind === 'schedule' && h.source === src)) continue;
      addHidden(its.join(', '), 'schedule', sentence, SCHED_RE, (q) => (q
        ? `The schedule: "${q}". Check it fits your week before you apply.`
        : `The schedule includes ${joinList(its)} — check it fits your week before you apply.`));
    } else if (c.kind === 'physical') {
      physical.push({ items: c.items && c.items.length ? c.items : [c.label], sentence });
    } else if (c.kind === 'background') {
      const label = SCREEN_LABEL[c.label] || cap(c.label);
      const how = SCREEN_HOW[label] || SCREEN_HOW['Background check'];
      addHidden(label, 'screening', sentence, how.re, (q) => (q ? `${how.lead}: "${q}". ${how.act}` : `Expect a ${c.label} before an offer. ${how.act}`));
    }
  }
  // every physical demand in one sentence; of two lift figures, the heavier is the one to plan for
  if (physical.length) {
    const all = [...new Set(physical.flatMap(p => p.items))];
    const lifts = all.filter(i => /^lift \d+ lbs$/.test(i));
    const maxLift = lifts.sort((x, y) => Number(y.match(/\d+/)[0]) - Number(x.match(/\d+/)[0]))[0];
    const its = all.filter(i => !lifts.includes(i) || i === maxLift);
    const src = physical.find(p => (maxLift ? p.items.includes(maxLift) : true)).sentence;
    addHidden(its.join(', '), 'physical', src, /lift|stand|on (?:your|their) feet|bend|stoop|kneel|climb|walk|push|carry|repetitive|crouch|squat|noise|outdoor/i,
      (q) => `It's physical work: ${q ? `"${q}"` : `you'll need to ${joinList(its)}`}. If you've done work like that, say so in your application.`);
  }
  for (const r of reqRows) {
    for (const e of equipmentOf(r.sentence)) addHidden(e, 'equipment', r.sentence, /transportation|vehicle|\bcar\b|tools|smartphone/i, (q) => (q ? `You'll need this from day one: "${q}".` : EQUIPMENT_SENTENCE[e]));
    const t = travelOf(r.sentence);
    if (t) addHidden(t, 'travel', r.sentence, /travel/i, (q) => `The job involves travel: "${q || t}". ${/%/.test(t) ? 'Make sure that works before you apply.' : 'Ask how often before you apply.'}`);
    if (/\bovertime\b/i.test(r.sentence) && /\b(?:available|availability|must|required|willing|able|expected|mandatory)\b/i.test(r.sentence)) {
      addHidden('Overtime', 'schedule', r.sentence, /overtime/i, (q) => `Overtime is expected${q ? `: "${q}"` : ''}. Ask how much is typical before you accept.`);
    }
  }
  // one sentence for the checks before an offer ("a background check and a drug screen"), not three
  const checks = hidden.filter(h => h.kind === 'screening' && /^(?:Background check|Drug|Fingerprinting)/.test(h.label));
  if (checks.length >= 2) {
    const q = clauseAround(checks[0].source, /background|drug|fingerprint/i);
    const names = checks.map(h => h.label.toLowerCase());
    const merged = { text: q ? `Before an offer: "${q}". Have your past employers and addresses ready.` : `Before you start they run ${joinList(names.map(n => `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`))} — have your past employers and addresses ready.`, label: checks.map(h => h.label).join(', '), kind: 'screening', source: checks[0].source };
    hidden.splice(hidden.indexOf(checks[0]), 1, merged);
    for (const h of checks.slice(1)) hidden.splice(hidden.indexOf(h), 1);
  }
  const hiddenItems = hidden.slice(0, 6);

  const read = shown.length > 0;
  let conditionsNote = '';
  if (read && !hiddenItems.length) {
    const missing = ['schedule', 'physical', 'screening'].filter(k => !(k === 'schedule' && gateSchedule));
    conditionsNote = `This posting states no ${missing.length === 3 ? 'schedule, physical or screening' : missing.join(' or ')} conditions.`;
  }

  const pay = findPay(rows, idx);
  const tip = read ? insiderTip(shown) : { tip: NOT_READ_TIP, source: null };
  const what = shown.slice(0, 7).map(i => (i.importance === 'preferred' ? `${i.text} (preferred)` : i.text));
  const requirementsRead = skills.length + constraints.filter(c => ['degree', 'years', 'certification', 'language', 'management'].includes(c.kind)).length;

  const result = {
    what_they_want: what,
    hidden_requirements: hiddenItems.map(h => h.text),
    insider_tip: tip.tip,
    description_summary: needsSummary && stripHtml(description).length >= 80 ? summarize(title, company, rows, what, pay) : '',
    items: shown.map(({ labels: _l, tool: _t, ...i }) => i),
    hidden_items: hiddenItems,
    conditions_note: conditionsNote,
    pay,
    tip_source: tip.source,
    read,
    requirements_read: requirementsRead,
  };
  return { result, facts, labels: shown.map(i => i.labels), postingText };
}

/**
 * The same reading with what is behind it: the reader's facts and, per shown item, the reader labels
 * it stands for. For the invariant test and the eval only — the response never carries engine labels.
 */
export function insightReading(input = {}) { return analyze(input); }
