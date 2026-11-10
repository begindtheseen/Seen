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
import { readPostingPay, decodeEntities } from '../jobs/postingPay.js';

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
function sourceIndex(rawText) {
  // quotes are shown, so they are the DECODED posting ("$21 — $23", never "&mdash;")
  const postingText = decodeEntities(rawText);
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
  const e = norm(decodeEntities(evidence)).replace(/^[•\-*]\s*/, '');
  if (!e || /^Job title:/i.test(e)) return null;
  // the whole posting sentence that holds the evidence, when it is in the posting as written
  const holds = idx.pieces.filter(p => p.text.includes(e));
  if (holds.length) return clip(holds.sort((a, b) => a.text.length - b.text.length)[0].text.replace(/^[:;,.\s]+/, ''));
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
// a Workday header line ("1st shift (United States of America)", "Shift: 2nd Shift") is metadata, not a
// sentence about the job's schedule
const SHIFT_HEADER_RE = /^(?:(?:work\s+)?shift|schedule)?\s*:?\s*(?:1st|2nd|3rd|first|second|third|day|night|evening|overnight)\s+shift\s*(?:\([^)]*\))?\s*$|\((?:United States(?: of America)?|USA|U\.S\.A?\.?|Canada|United Kingdom)\)/i;
function namedShifts(sentence) {
  const out = [];
  if (SHIFT_HEADER_RE.test(String(sentence).trim())) return out;
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
const EQUIPMENT_SENTENCE = {
  'Reliable transportation': "You'll need reliable transportation to get to work.",
  'Your own vehicle': "You'll need your own vehicle for this job.",
  'Your own tools': "You're expected to bring your own tools.",
  'A smartphone': "You'll need a smartphone for the job.",
};
function joinList(xs) { return xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }
// a schedule word that commits your time (not just "full-time")
const SHIFT_COMMITMENT_RE = /night|overnight|weekend|evening|holiday|on-call|rotating|shift|early morning|blackout|open availability/i;

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
    // the field of a degree is part of the degree ("a Bachelor's degree in accounting"), not a skill
    if (g.kind === 'degree' && new RegExp(`\\b(?:degree|diploma|major|BS|BA|B\\.S\\.|B\\.A\\.)\\s+(?:in|of)\\s+(?:[\\w&-]+,?\\s+){0,3}${escapeRegExp(item.text.toLowerCase())}\\b`, 'i').test(item.source)) return true;
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
// The years advice composed by what the object IS: an environment ("your years working in a
// manufacturing environment"), a function ("your years in provider enrollment"), a role ("your years as
// a department manager"). Anything else is said in the posting's own words.
const FUNCTION_END_RE = /(?:ing|ion|ment|ance|ence|ics|ogy|ity|ure|ship|work|operations|sales|services?|support|care|design|finance|banking|hygiene|law|research|analysis|maintenance|logistics|retail|hospitality|assurance|accounting|marketing|development|engineering|construction|nursing|recruiting|programming|commissioning|manufacturing)$/i;
function yearsTip(text, q) {
  const m = /^\d+\+ years? (?:of )?(?:(?:professional|relevant|direct|hands-on|progressive|proven|solid|related)\s+)*(?:experience\s+)?(?:(in|as|with|working in|doing|of)\s+)?(.+?)(?:\s+experience)?$/i.exec(text);
  const prep = m && m[1] ? m[1].toLowerCase() : '';
  const obj = m ? m[2].replace(/^(?:(?:solid|relevant|professional|progressive|related|proven|direct|hands-on|recent)\s+)+/i, '').trim() : '';
  const bare = !obj || /^experience$/i.test(obj);
  const first = 'in your first line';
  if (bare) return `The experience bar: "${q}". Put your total years as a number ${first}, so a screener doesn't have to count.`;
  if (/\b(?:environment|setting|facility|fab|plant|warehouse|hospital|clinic|office|kitchen|store|restaurant|lab|laboratory)s?$/i.test(obj)) return `The experience bar: "${q}". Put your years working in ${/^(?:an?|the)\s/i.test(obj) ? obj : `${article(obj)} ${obj}`} ${first}.`;
  if (prep === 'as') return `The experience bar: "${q}". Put your years as ${obj} ${first}.`;
  const last = obj.split(/\s+/).pop();
  if (FUNCTION_END_RE.test(last) || /^[A-Z]{2,}[\w/-]*$/.test(last)) return `The experience bar: "${q}". Put your years in ${obj} ${first}.`;
  return `Say how many years you have, in the posting's words: "${q}".`;
}
// Each gate gets its own advice, naming the posting's own term; no gate and no named tool → no tip.
function insiderTip(items0, conditions = []) {
  // a statement item names its gate by the reader's short label ("Arizona RN license"), not the whole line
  const items = items0.map(i => (i.short ? { ...i, text: i.short } : i));
  const req = items.filter(i => i.importance === 'required');
  const quoted = (i, re) => clauseAround(i.source, re) || i.source;
  const lic = req.filter(i => i.kind === 'licence');
  if (lic.length) {
    const q = quoted(lic[0], /licen[sc]/i);
    const name = lic[0].text.replace(/^Valid /, '');
    const alts = / or /i.test(name) ? name.replace(/\s+(?:electrical\s+|state\s+)?licen[sc]e$/i, '') : null;
    const also = lic[1] && !q.toLowerCase().includes(lic[1].text.toLowerCase().replace(/^valid /, '')) ? ` It also asks for ${/^Valid /.test(lic[1].text) ? lic[1].text.replace(/^Valid /, 'a valid ') : `${article(lic[1].text)} ${lic[1].text}`}.` : '';
    return { tip: alts
      ? `The licence is the gate here: "${q}". Say which you hold — ${alts} — in your first line, with the state that issued it.${also}`
      : /driver/i.test(name)
        ? `The licence is the gate here: "${q}". Say you have one wherever the application asks — it is checked before an interview.${also}`
        : `The licence is the gate here: "${q}". Put your ${name} in your first line, with its number if you have one.${also}`, source: q };
  }
  const certAll = req.filter(i => i.kind === 'certification');
  // lead with the credential whose own sentence states it as a requirement ("Basic Life Support (BLS)
  // CPR through American Heart Association"), not one named in passing
  const cue = (i) => Number(/\b(?:certif|required|current|valid|active|must)\w*/i.test(i.source));
  const cert = [...certAll].sort((a, b) => (cue(b) - cue(a)) || (a.source.length - b.source.length));
  if (cert.length) {
    const word = escapeRegExp(cert[0].text.replace(/ certification$/i, '').split(/\s+/)[0]);
    const q = quoted(cert[0], new RegExp(`\\b${word}`, 'i'));
    const first = cert[0].text.replace(/ certification$/i, '');
    return { tip: `They screen for it: "${q}". If you hold ${joinList(cert.slice(0, 2).map(i => i.text))}, list it as "${first}" near the top — a screener searching for "${first}" won't find a paraphrase.`, source: q };
  }
  const years = req.find(i => i.kind === 'years');
  // a statement that carries a choice ("At least one programming language: Go, Java or C/C++") is one too
  const stmtChoice = req.find(i => Array.isArray(i.anyOfNames) && i.anyOfNames.length >= 2);
  const anyOfFirst = req.find(i => i.kind === 'any_of') || (stmtChoice ? { ...stmtChoice, text: `Any of: ${stmtChoice.anyOfNames.join(', ')}` } : null);
  const toolish = (t) => /^[A-Z0-9][\w+#./-]*$/.test(t) || /[a-z][A-Z]|[A-Z]{2}/.test(t);
  if (years && anyOfFirst && anyOfFirst.text.replace(/^Any of:\s*/, '').split(', ').every(toolish)) {
    const opts = anyOfFirst.text.replace(/^Any of:\s*/, '');
    const q = quoted(years, YEARS_FIGURE_RE);
    return { tip: `The experience bar: "${q}". They accept any of ${opts} — name the one you use, with your years in it, in your first line.`, source: q };
  }
  if (years) {
    const q = quoted(years, YEARS_FIGURE_RE);
    return { tip: yearsTip(years.text, q), source: unquote(q) };
  }
  // a choice of named tools (Python, Go, Rust) — never a list of plucked phrases
  const anyOf = anyOfFirst && anyOfFirst.text.replace(/^Any of:\s*/, '').split(', ').every(toolish) ? anyOfFirst : null;
  if (anyOf) return { tip: `They accept any one of ${anyOf.text.replace(/^Any of:\s*/, '')} — name the one you use most, in their spelling. You don't need all of them.`, source: anyOf.source };
  const sched = conditions.find(c => c.kind === 'schedule' && c.gate);
  if (sched) {
    const q = clauseAround(sched.source, /shift|weekend|night|holiday|on[- ]call|hours|availab|evening|overnight|rotation/i) || sched.source;
    return { tip: `The schedule is a gate: "${q}". ${q.toLowerCase().includes(String(sched.label).toLowerCase()) ? `If you can work ${sched.label}` : 'If those hours work for you'}, say so in the first line of your application — it's screened early.`, source: unquote(q) };
  }
  const degree = req.find(i => i.kind === 'degree');
  if (degree) {
    const q = quoted(degree, /bachelor|master|degree|diploma|\bged\b|doctorate|associate|\bb\.?s\b|\bb\.?a\b|ph\.?d/i);
    const school = /high school|diploma|\bged\b/i.test(degree.text);
    const equiv = !school && /equivalent|in lieu/i.test(degree.text + ' ' + q);
    const deg = degree.text.replace(/ or equivalent experience$/i, '').replace(/^\w/, c => c.toLowerCase()).replace(/^bachelor/, 'Bachelor').replace(/^master/, 'Master').replace(/^associate/, 'Associate');
    const act = school ? 'Put your diploma or GED in your education section even if it feels basic — screeners filter on it.'
      : equiv ? `No ${deg}? Lead with the years of work that stand in for it.` : 'Put that degree first in your education section, worded the way they word it.';
    return { tip: `The education bar: "${q}". ${act}`, source: q };
  }
  // the posting names its tools: the exact words, where they are true
  const named = (items0.some(i => Array.isArray(i.tools))
    ? [...new Set([...items0.filter(i => i.importance === 'required'), ...items0.filter(i => i.importance === 'duty')].flatMap(i => i.tools || []))].map(t => ({ text: t, source: (items0.find(i => (i.tools || []).includes(t)) || {}).source }))
    : req.filter(i => i.tool).map(i => ({ ...i, text: i.text.replace(/ \(or similar\)$/, '') }))).slice(0, 3);
  if (named.length >= 2) return { tip: `It names ${joinList(named.map(i => i.text))} — use those exact words on your résumé wherever they're true, not a synonym.`, source: named[0].source };
  if (named.length === 1) return { tip: `It names ${named[0].text} — if you've worked with it, write "${named[0].text}" on your résumé, not a synonym.`, source: named[0].source };
  return { tip: '', source: null };
}

// The posting's own clause around a match — verbatim, so it can be quoted: from the last clause break
// before the match to the next one after it, cut at a comma or a word when it runs long.
function clauseAround(src, re, max = 120) {
  const text = String(src || '');
  const m = re.exec(text);
  if (!m) return null;
  let start = 0;
  for (const b of text.slice(0, m.index).matchAll(/[.;:•!?](?=\s)|\s[-–—]\s(?![\d$])/g)) start = b.index + b[0].length;
  const rest = text.slice(m.index);
  const stop = rest.search(/[.;!?](?=\s|$)|\s[-–—]\s(?![\d$])/);
  let end = stop < 0 ? text.length : m.index + stop;
  const natural = [start, end];
  if (end - start > max) {
    const factEnd = m.index + m[0].length;
    const comma = text.indexOf(', ', factEnd + 12);
    if (comma > 0 && comma - start <= max) end = comma;
    else if (factEnd - start <= max - 20) { const ws = text.lastIndexOf(' ', start + max); end = ws > factEnd ? ws : start + max; }
    else {
      // the fact sits deep in a long line: quote the words around it
      const a = text.lastIndexOf(' ', Math.max(start, m.index - 40));
      start = Math.max(start, a < 0 ? start : a + 1);
      const ws = text.lastIndexOf(' ', start + max);
      end = Math.min(end, ws > factEnd ? ws : Math.max(factEnd, start + max));
    }
  }
  // never quote half a parenthesis: "Bachelor's Degree (BBA, BA or BS" → "… or BS)"
  const open = (t) => (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
  if (open(text.slice(start, end)) > 0) {
    const close = text.indexOf(')', end);
    const paren = text.lastIndexOf('(', end);
    // close the parenthesis when that stays short; else end the quote before it
    if (close > 0 && close - end <= 80 && close + 1 - start <= max) end = close + 1;
    else if (paren > m.index + m[0].length) end = paren;
    else if (close > 0 && close - end <= 80) end = close + 1;
  }
  if (open(text.slice(start, end)) < 0) { const o = text.lastIndexOf('(', start); if (o >= 0 && start - o <= 80) start = o; }
  // last guard: a quote longer than the cap is the words around the fact, with "…" either side
  if (end - start > max) {
    const a = text.lastIndexOf(' ', Math.max(start, m.index - 45));
    const b = text.indexOf(' ', Math.min(end, m.index + m[0].length + 55));
    start = Math.max(start, a < 0 ? start : a + 1);
    end = Math.min(end, b < 0 ? end : b);
  }
  const cutEnd = end < natural[1];
  const cutStart = start > natural[0];
  const c = text.slice(start, end).replace(/^[\s,\-–—•*]+|[\s,\-–—:]+$/g, '')
    // a heading run into the line ("Required Skills & Qualifications Minimum of 3 years…")
    .replace(/^\((.*)\)$/, '$1')
    // a heading word glued to the front ("Offices Roles posted in New York…")
    .replace(/^(?:Offices?|Locations?|Schedule|Benefits|Requirements|Qualifications|Responsibilities|Compensation|Hours|Shifts?|Travel|About|Perks|Duties|Education|Experience|Overview|Summary)\s+(?=[A-Z][a-z]+\s+\S+\s+\S+)/, '')
    .replace(/^(?:(?:Required|Preferred|Minimum|Basic|Key|Desired)\s+)?(?:(?:Skills|Experience|Education)\s*(?:&|and)\s*)?(?:Qualifications|Requirements|Skills)\s*:?\s+(?=[A-Z0-9])/, '');
  // a cut quote says so: "…" where words were left out (strip it to find the quote in the posting)
  return c.length >= 4 ? `${cutStart ? '…' : ''}${c}${cutEnd ? '…' : ''}` : null;
}
const unquote = (q) => String(q || '').replace(/^…|…$/g, '');

// ── description_summary ──────────────────────────────────────────────────────────────────────────
// What the job is (the posting's own first sentences about the ROLE, never the company blurb), what
// it asks for and the pay the posting states, in whole sentences (never cut mid-word).
const ROLE_SENTENCE_RE = /\b(?:[Yy]ou(?:'|’)?ll|[Yy]ou will|[Tt]his role|in this role|as (?:a|an|the) [A-Z]|[Ww]e(?:'|’)re looking for|[Ww]e are looking for|(?:[Tt]he|[Tt]his|[Oo]ur) [A-Z][\w&-]*(?: (?:&|[A-Z][\w&-]*)){0,5} will)\b/;
// An item as words inside a sentence: "a valid driver's license", "any one of Go, Python or React",
// "social media" — a proper name or acronym keeps its case.
// "an MD", "an RN license", "a BLS card", "an hourly role"
function article(w) {
  const t = String(w).trim();
  if (/^[A-Z]{2,}\b/.test(t)) return /^[AEFHILMNORSX]/.test(t) ? 'an' : 'a';
  return /^(?:[aeio]|u(?!ni|s[aeu]))/i.test(t) || /^hour/i.test(t) ? 'an' : 'a';
}
function phraseOf(i) {
  const t = i.text;
  if (i.kind === 'any_of') { const xs = t.replace(/^Any of:\s*/, '').split(', '); return `any one of ${xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0]}`; }
  if (i.kind === 'age') return `applicants ${t.replace(/^Must be (\d+)\+$/, '$1')} or older`;
  if (i.kind === 'experience') return 'management or supervisory experience';
  // an either-or bar is said as one: "either 3+ years in a manufacturing environment or a Bachelor's degree"
  const either = /^(.+?), or (.+)$/.exec(t);
  if (either && i.kind === 'degree') {
    const side = (x) => (/^\d/.test(x) || /^(?:an?|the)\s/i.test(x) ? x : `${article(x)} ${x}`);
    return `either ${side(either[1])} or ${side(either[2])}`;
  }
  // "Anesthesia care for outpatient GI" → "anesthesia care…"; "Microsoft Project PWA" keeps its name
  const lowerable = !i.tool && /^[A-Z][a-z'’-]+(?:\s+[a-z(]|$)/.test(t);
  let w = lowerable && !/^(?:Bachelor|Master|Associate)/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  if ((i.kind === 'degree' || i.kind === 'licence' || i.kind === 'certification') && /(?:degree|diploma|licen[sc]e|card|certificate|permit|doctorate)\b/i.test(w) && !/^(?:a|an)\s/i.test(w) && !/ or equivalent experience$/.test(w) ? true : false) {
    w = `${article(w)} ${w.replace(/^(?:Valid|High|Doctorate)\b/, (x) => x.toLowerCase())}`;
  } else if (i.kind === 'degree' && !/^(?:a|an)\s/i.test(w)) {
    w = `${article(w)} ${w.replace(/^High\b/, 'high')}`;
  }
  return w;
}
// A reader statement as words after "asks for" / "prefers": "a high school diploma or …",
// "at least 1 year in a warehouse…", "the ability to read and interpret schematics", "being comfortable
// working in a cleanroom". A gate written as "Medical License: Unrestricted…" is said by its short name.
const BASE_VERB_RE = new RegExp(`^(?!(?:direct|lead|model|order|record|process|present|program|engineer|code|host|draw|bill|chart|grade|label|package|balance|forecast|budget|query|source|post|file|set|run|act|test|use|support)\\b)(?:${DUTY_VERBS}|read|speak|travel|lift|stand|learn|think|adapt|thrive|pass|meet|obtain|hold|possess|demonstrate|complete)\\b(?!s\\b|ed\\b|ing\\b)`, 'i');
const ADJ_START_RE = /^(?:comfortable|able|willing|familiar|proficient|fluent|available|knowledgeable|skilled|experienced|detail[- ]oriented|organized|reliable|self[- ]motivated|eager|passionate|capable|flexible|bilingual)\b/i;
// a verb-looking first word followed by one of these is a noun compound ("Track record", "Work ethic")
const NOUN_AFTER_VERBISH_RE = /^(?:record|records|ethic|experience|history|management|improvement|generation|delivery|patterns?|automation|planning|analysis|control|quality|processes?|tools?|skills?|knowledge|background|leadership|capabilities|strategy|orders?|systems?|software|services?|reports?|data)$/;
// "Building or scaling…" — a gerund that is an activity, not one of the -ing nouns
const GERUND_RE = /^(?!(?:training|engineering|marketing|accounting|pricing|banking|nursing|manufacturing|programming|recruiting|consulting|clothing|housing|lighting|plumbing|roofing|staffing|trucking|underwriting|budgeting|forecasting|scheduling|onboarding|networking|computing|messaging|tooling|caring|catering|coaching|teaching|tutoring|counseling|counselling|auditing|sourcing|procurement|purchasing|merchandising|advertising|publishing|writing|reporting|testing|modeling|modelling|logging|monitoring|machining|welding|painting|framing|cleaning|cooking|baking)\b)[a-z]+ing\b/i;
/** A statement item as words after "asks for" (exported for tests). */
export function spokenStatement(i) {
  let t = (i.gate && i.short && /^[^:]{2,40}:\s/.test(i.text) ? i.short : i.text).replace(/ \((?:e\.g\. [^)]*|or similar)\)$/, '').trim();
  t = t.replace(/^(?:a\s+)?minimum\s+of\s+/i, 'at least ').replace(/^minimum\s+(?=\d)/i, '').replace(/\s+(?:required|minimum)$/i, '');
  const COMMON_FIRST = /^(?:A|An|The|At|Strong|Excellent|Exceptional|Solid|Proven|Deep|Advanced|Basic|Working|Current|Active|Valid|Prior|Previous|Demonstrated|Good|Great|Knowledge|Experience|Ability|Familiarity|Understanding|Proficiency|High|Hands-on|Professional|Relevant|Excellent|Effective|Outstanding|Superior)\b/;
  const lower = (COMMON_FIRST.test(t) || /^[A-Z][a-z'’-]+(?:\s+[a-z(]|$)/.test(t)) && !(i.tools || []).some((x) => t.startsWith(x));
  if (lower) t = t.charAt(0).toLowerCase() + t.slice(1);
  const lc = (x) => `${x.charAt(0).toLowerCase()}${x.slice(1)}`;
  // the joining form follows the first word's class: a noun phrase as is ("a track record closing…"),
  // a gerund as experience ("experience building or scaling…"), a verb phrase as an ability ("the ability
  // to engage…"), an adjective as a state ("being comfortable…")
  const second = (t.split(/\s+/)[1] || '').toLowerCase();
  const nounCompound = NOUN_AFTER_VERBISH_RE.test(second);
  if (/^(?:track record|background|history|passion|bias|desire|deep understanding|strong understanding|solid understanding|working knowledge|understanding|record)\b/i.test(t)) return `${article(t)} ${lc(t)}`;
  if (!nounCompound && GERUND_RE.test(t)) return `experience ${lc(t)}`;
  if (!nounCompound && BASE_VERB_RE.test(t)) return `the ability to ${lc(t)}`;
  if (ADJ_START_RE.test(t)) return `being ${lc(t)}`;
  const head = t.split(/\s+/).slice(0, 4).join(' ');
  if (!/^(?:an?|the|at|\d)/i.test(t) && /\b(?:diploma|degree|licen[sc]e|certificate|card|permit)\b/i.test(head) && !/^(?:[A-Z]{2,}\s+(?:certification|required))$/.test(t)) return `${article(t)} ${t}`;
  return t;
}
function asksSentence(items) {
  const statementsPath = items.some(i => 'short' in i);
  const spoken = statementsPath ? spokenStatement : (i) => phraseOf({ ...i, text: i.text.replace(/ \((?:e\.g\. [^)]*|or similar)\)$/, '') });
  const reqItems = items.filter(i => i.importance === 'required' && i.kind !== 'age');
  let req = (reqItems.some(i => !i.soft) ? reqItems.filter(i => !i.soft) : reqItems).slice(0, 3).map(spoken);
  // a phrase with its own commas is said with one other at most; a very long one alone
  if (req.some(x => x.includes(',') || x.length > 60)) req = req.slice(0, 2);
  if (req[0] && req[0].length > 100) req = req.slice(0, 1);
  const pref = items.find(i => i.importance === 'preferred');
  if (!req.length && !pref) return '';
  // never "ability to" + a noun, never a doubled article; and the sentence fits ~240 characters
  const fix = (x) => x.replace(/\b(a|an|the)\s+(?:a|an|the)\b/gi, '$1');
  req = req.map(fix);
  // a statement with its own commas is joined with "plus", so its parts don't read as separate asks
  const list = (xs) => (xs.length < 2 ? xs[0] : xs.some(x => x.includes(',') || / and /.test(x)) ? xs.slice(0, 2).join(', plus ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  if (!req.length) return `It prefers ${fix(spoken(pref))}.`;
  let out = `It asks for ${list(req)}${pref ? `, and prefers ${fix(spoken(pref))}` : ''}.`;
  if (out.length > 240 && pref) out = `It asks for ${list(req)}.`;
  while (out.length > 240 && req.length > 1) { req = req.slice(0, -1); out = `It asks for ${list(req)}.`; }
  return out;
}

function displayCompany(company) {
  const c = String(company || '').trim();
  return /^[a-z][a-z0-9-]*$/.test(c) ? c.charAt(0).toUpperCase() + c.slice(1) : c;
}
function summarize(title, company, rows, items, pay) {
  const co = displayCompany(company);
  const role = title ? `${title}${co ? ` at ${co}` : ''}` : 'This role';
  const ok = (s) => s.length >= 30 && !PAY_SENTENCE_RE.test(s) && !RULED_OUT_RE.test(s);
  const intro = rows.find(r => (r.kind === 'about' || r.kind === 'culture' || r.kind === 'responsibilities') && ok(r.sentence) && ROLE_SENTENCE_RE.test(r.sentence));
  // prose stays prose: a "You'll …" duty may follow the intro; an imperative bullet ("Receive and put
  // away inventory") never is glued after it — with no intro, one bullet is introduced as the day's work
  const youDuty = rows.find(r => r.kind === 'responsibilities' && r !== intro && ok(r.sentence) && YOU_RE.test(r.sentence));
  const bullet = rows.find(r => r.kind === 'responsibilities' && ok(r.sentence) && DUTY_START_RE.test(r.sentence));
  const tidy = (t) => cutAtSentence(decodeEntities(t), 260).replace(/\s+([!?.,;:])/g, '$1').replace(/[:;,]+$/, '');
  const end = (t) => (/[.!?…]$/.test(t) ? t : `${t}.`);
  const roleSents = intro
    ? [tidy(intro.sentence), ...(youDuty ? [tidy(youDuty.sentence)] : [])].map(end)
    : youDuty ? [end(tidy(youDuty.sentence))]
    : bullet ? [`Day to day: ${end(tidy(bullet.sentence).replace(/^\w/, (c) => c.toLowerCase()))}`] : [];
  const parts = [`${role}.`, ...roleSents];
  const asks = asksSentence(items);
  if (asks) parts.push(asks);
  // the pay in the posting's own words ("between 140 - 170k base"), never a figure re-typed
  if (pay) parts.push(`It states the pay: "${pay.source}".`);
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
const GATE_ORDER = ['licence', 'certification', 'years', 'degree', 'age', 'language', 'experience'];
const MAX_ITEMS = 14;
const READ_SECTIONS = new Set(['requirements', 'preferred', 'responsibilities']);
const CONDITION_ORDER = ['conflict', 'work_authorization', 'location', 'onsite', 'contract', 'schedule', 'relocation', 'travel', 'physical', 'screening', 'equipment', 'promise'];

// Spans of the posting that sit under a "Preferred / Nice to have" heading, in the decoded, whitespace-
// normalised text (a flat posting's "PREFERRED SKILLS AND EXPERIENCE:" heading the reader can miss).
// An item read from inside one is preferred — never shown as asked.
const PREF_HEAD_RE = /\b(?:preferred|nice[- ]to[- ]haves?|bonus points|desired|pluses|a plus)\b(?:[\w &/'’-]{0,40}?)\s*:/gi;
const ANY_HEAD_RE = /(?:\b(?:[A-Z][A-Z&/'’-]{2,}\s+){0,5}[A-Z][A-Z&/'’-]{2,}\s*:)|(?:(?:^|[.!?]\s+|\s)(?:[A-Z][\w&/'’-]*\s+){0,4}(?:Qualifications|Requirements|Responsibilities|Skills|Experience|Benefits|Compensation|Education|Perks|Duties)\s*:)/g;
function preferredSpans(flat) {
  const heads = [...flat.matchAll(ANY_HEAD_RE)].map((m) => m.index + m[0].length);
  const spans = [];
  for (const m of flat.matchAll(PREF_HEAD_RE)) {
    const from = m.index + m[0].length;
    const to = heads.find((h) => h > from + 5) ?? flat.length;
    spans.push([from, to]);
  }
  return spans;
}
const inSpans = (flat, spans, source) => {
  const at = flat.indexOf(norm(unquote(source)));
  return at >= 0 && spans.some(([a, b]) => at >= a && at < b);
};
// A label that is not a requirement a person would read: a clipped clause ("Employees say about",
// "CO II maintains", "Hazard co", "Rience with …"), or one generic word ("Training", "Compliance").
const GENERIC_ONE_WORD = new Set(['training', 'compliance', 'onboarding', 'communication', 'leadership', 'teamwork', 'sales', 'documentation', 'organization', 'support', 'management', 'operations', 'safety', 'quality', 'analysis', 'research', 'reporting', 'coordination', 'administration', 'planning', 'performance', 'interviews', 'above', 'access', 'voice', 'higher', 'domain', 'real-world', 'clienteling', 'integration', 'abstraction', 'installation', 'cleaning', 'intervention', 'impart', 'ownership', 'security', 'channel', 'resource', 'resources', 'protocol', 'scheduling']);
const CLIPPED_END_RE = /\b(?:about|with|for|of|to|in|on|at|by|from|and|or|the|a|an|your|our|their|its|say|says|said|maintains|leverages|pertaining|including|such|as|where|that|which|who|varying|reflecting|integrating|operating|using)$/i;
function readableItem(it) {
  if (it.kind !== 'skill' && it.kind !== 'duty' && it.kind !== 'trait') return true;
  const t = it.text.replace(/ \((?:e\.g\. [^)]*|or similar)\)$/, '').trim();
  if (CLIPPED_END_RE.test(t)) return false;
  if (/\b(?:say|says|maintains|leverages|pertaining|varying|reflecting)\b/i.test(t)) return false;
  if (!/\s/.test(t) && GENERIC_ONE_WORD.has(t.toLowerCase())) return false;
  // a label in the posting's own words: every word is a whole word of its sentence (no "Hazard co")
  if (!it.term) return true;
  // a posting term that starts with a duty verb ("Presents product") is a clipped clause
  if (/^[A-Z]?[a-z]+s\b/.test(t) && DUTY_START_RE.test(t)) return false;
  const src = unquote(it.source).toLowerCase();
  for (const w of t.toLowerCase().split(/[\s/,]+/).filter((x) => /^[a-z][a-z'-]+$/.test(x))) if (!new RegExp(`\\b${escapeRegExp(w)}`).test(src)) return false;
  for (const w of t.toLowerCase().split(/[\s/,]+/).filter((x) => /^[a-z][a-z'-]+$/.test(x))) if (!new RegExp(`${escapeRegExp(w)}\\b`).test(src)) return false;
  return true;
}
// The display source: the clause that carries the item, ≤ 120 characters ("…" marks a cut)
function capSource(source, text) {
  if (source.length <= 120) return source;
  const word = (text.replace(/^Any of:\s*/, '').match(/[A-Za-z0-9+#][\w+#.-]*/) || [])[0];
  const near = (word && clauseAround(source, new RegExp(`\\b${escapeRegExp(word)}`, 'i'))) || clauseAround(source, /\S/);
  if (near && unquote(near).length <= 122) return near;
  const ws = source.lastIndexOf(' ', 117);
  return `${source.slice(0, ws > 60 ? ws : 117).replace(/[\s,;:—–-]+$/, '')}…`;
}

// A reader constraint as a gate: its kind and its short name ("Arizona RN license", "2+ years of …").
function gateOf(c) {
  const sentence = c.evidence || c.sentence || '';
  if (c.kind === 'certification') {
    const display = certDisplay(c.label, sentence);
    const kind = /licen[sc]/i.test(display) ? 'licence' : 'certification';
    return { kind, text: kind === 'licence' ? withState(display, sentence) : display };
  }
  if (c.kind === 'years') return { kind: 'years', text: cap(c.label).replace(/\s*\([^)]*$/, '') };
  if (c.kind === 'degree') return { kind: 'degree', text: cap(c.label.replace(/^an? /, '').replace(/, or an? /g, ', or ')) };
  if (c.kind === 'age') return { kind: 'age', text: `Must be ${c.value}+` };
  if (c.kind === 'language' && c.value !== 'english') return { kind: 'language', text: cap(c.label) };
  if (c.kind === 'management') return { kind: 'experience', text: 'Management / supervisory experience' };
  return { kind: null, text: '' };
}

// A line whose content is only generic traits ("Organizational and time management skills", "Work
// independently and as part of a team") — useful, but never ahead of the job itself.
const TRAIT_WORDS = new Set('communication communicate communicates interpersonal organizational organisational organized organised organization time management teamwork team teams independently independent part work works working follow follows instructions directions safely safe safety detail details attention reliable reliability dependable punctual punctuality positive attitude fast-paced fast paced pace steady self-starter self motivated flexible flexibility adaptable written verbal oral skills skill ability abilities strong excellent good great problem-solving solving problem problems multitask multi-task multitasking prioritize prioritise collaborative collaborate collaboration others environment ethic professional professionalism demeanor friendly customer-focused english read write speak learn quickly eager willingness willing hard-working hardworking energetic enthusiastic initiative judgment judgement listening interpersonally driven people cooperative courteous respectful honest integrity'.split(' '));
const STOP = new Set('a an the and or of to in on with as at for be is are your our their you we it its while well both effectively effective high level highly very have has must can able'.split(' '));
function isSoftTrait(text) {
  const words = String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  return words.length > 0 && words.every((w) => TRAIT_WORDS.has(w));
}

// ── Items from the reader's STATEMENTS (one restated requirement per posting line, in the reader's
// wording). Each item: { text (the statement), kind, importance, source, gate } + internal `short` (the
// gate's short name the tip names), `labels`, `tool`. A waiver or a promise the reader filed as a
// requirement ("No experience required!", "We provide comprehensive training") is not an item; it is
// returned as a promise for the conditions.
const WAIVER_RE = /^(?:no|not)\b|\b(?:not|isn['’]t)\s+(?:required|necessary|needed)\b|\bno\s+(?:prior\s+|previous\s+)?(?:experience|degree)\b|^we\s+(?:provide|offer|will)\b|\bwill\s+train\b|\btraining\s+(?:is\s+)?provided\b/i;
// a line about hours or the body belongs to the conditions, not to the list of what they ask
const CONDITION_LINE_RE = /\b(?:lift(?:ing)?\s+(?:up\s+to\s+)?\d|standing|stand for|bending|stooping|kneeling|climb(?:ing)?\s+ladders?|ladders?)\b|\b(?:shifts?|weekends?|overtime|nights?|on[- ]call|holidays?|overnight)\b|\b(?:background\s+(?:check|screen|clearance)|drug\s+(?:test|screen)|fingerprint|motor vehicle record|driving record)\b/i;
function itemsFromStatements(facts, { idx, prefSpans = [] }) {
  const statements = facts.statements || [];
  const byStatement = new Map();
  for (const f of facts) if (f.statementId) (byStatement.get(f.statementId) || byStatement.set(f.statementId, []).get(f.statementId)).push(f);
  const items = [];
  const waivers = [];
  const places = [];
  for (const st of statements) {
    if (!['requirement', 'preferred', 'duty'].includes(st.kind)) continue;
    const source0 = findSource(idx, st.source || st.text);
    if (!source0) continue;
    // the reader's line, tidied: no space before punctuation, no level tail ("… is a plus")
    let text = cap(String(st.text || '').trim().replace(/\s+([!?.,;:])/g, '$1')
      .replace(/^(?:you(?:'ll|’ll| will)?\s+(?:have|bring|possess)|you(?:'re|’re| are)|have)\s+(?=\S)/i, '')
      .replace(/,?\s+(?:is|are|would be|will be)\s+(?:a\s+)?(?:strong(?:ly)?\s+|big\s+|huge\s+|definite\s+|highly\s+)?(?:plus|bonus|preferred|nice[- ]to[- ]have|advantage|ideal|desired|desirable|welcome|helpful)\b.*$/i, '')
      .replace(/\s+(?:is|are)\s+(?:necessary|required|needed|a must|mandatory|essential)\b.*$/i, '')
      .replace(/[.;:,]+$/, ''));
    if (!text) continue;
    if (WAIVER_RE.test(text)) { waivers.push({ text, source: source0 }); continue; }
    // a heading run into the line ("WILL EXPECT YOU TO HAVE: - University degree…") and a lead-in
    // ("Successful candidates must have completed …", "Every hire must demonstrate …") are not the requirement
    text = text.replace(/^(?:[A-Z][A-Z'’&/-]+\s+){2,}[A-Z][A-Z'’&/-]*\s*:?\s*[-–•]*\s*/, '')
      .replace(/^(?:(?:successful|ideal|qualified)\s+)?(?:candidates?|applicants?|every hire|you)\s+(?:must|should|will|need to)\s+(?:have|be|demonstrate|hold|possess)\s+/i, '')
      .replace(/^(?:minimum|required|preferred)\s*:\s*/i, '').trim();
    if (!text || text.split(/\s+/).length < 2 && !(byStatement.get(st.id) || []).length) continue;
    // a heading or boilerplate line the reader kept ("What you need", "THIS ROLE YOU GET", "As required by local
    // law", "The range displayed on each job posting…", "We are seeking a highly organized …")
    const linked0 = byStatement.get(st.id) || [];
    if (/^(?:what|who|why|how)\b[^.]{0,30}\b(?:you|we)\b[^.]{0,20}$/i.test(text) || /^[A-Z\s'’&/:-]{6,}$/.test(text)) continue;
    // company copy, legal notes and other roles' terms ("Our global team of 800…", "The job description may change…",
    // "You may request access, deletion", "Some roles may also require…", "By owning the full stack")
    if (/^(?:our|by)\b|\bjob description\b|\bmay\s+(?:change|request|be supplemented)\b|\ball\s+\w+\s+employees\b|\bsome roles may\b|\bpersonal (?:data|information)\b|\bprivacy\b/i.test(text)) continue;
    const gateFact = linked0.some((f) => f.factType === 'constraint' && ['certification', 'years', 'degree', 'age'].includes(f.kind));
    if (!gateFact && /\b(?:salary|individual pay|pay is determined|compensation|the range|benefits?|equal opportunity|local law|core values|e-?verify|accommodation)\b|^we\s+(?:are|['’]re)\s+(?:seeking|looking|hiring)\b|^(?:this|our)\s+(?:role|team|company|mission)\b/i.test(text)) continue;
    // a pitch line the reader filed as a duty ("The bar is knowing where AI …", "Reliability … are fundamental")
    if ((st.kind === 'duty' || st.importance === 'duty') && !gateFact && !DUTY_START_RE.test(text) && /\b(?:is|are|means|was|were)\b/.test(text)) continue;
    text = cap(text);
    // a choice the line names only by its kind ("At least one programming language") keeps its options
    {
      const opts = (byStatement.get(st.id) || []).filter((f) => f.factType === 'skill' && f.anyOf && !f.soft).map((f) => skillName(f));
      if (opts.length >= 2 && !opts.some((o) => text.toLowerCase().includes(o.toLowerCase()))) text = `${text}: ${opts.slice(0, -1).join(', ')} or ${opts[opts.length - 1]}`;
    }
    // an application instruction ("Please submit a link or PDF") is not a requirement
    if (/^(?:please|apply|submit|send|email|click)\b/i.test(text)) continue;
    const linked = byStatement.get(st.id) || [];
    // where the work is ("Chicago (preferred) or US remote") is a condition
    if (/\b(?:remote|on[- ]?site|hybrid|in[- ]office)\b/i.test(text) && !linked.some((f) => f.factType === 'skill' && !f.soft)) { places.push({ text, source: source0 }); continue; }
    // a line the reader filed as a duty that states an ask ("Must be a licensed physical therapist",
    // "4+ years of SAP development experience") is a requirement
    const asks = /^(?:must|need|required)\b|\b(?:must\s+(?:be|have|hold)|need\s+to\s+have|required|licensed|certified|\d+\+?\s*(?:years?|yrs?))\b/i.test(text) || linked.some((f) => f.factType === 'constraint' && ['certification', 'years', 'degree', 'age'].includes(f.kind));
    const isDuty = (st.kind === 'duty' || st.importance === 'duty') && !asks;
    if (CONDITION_LINE_RE.test(text) && !linked.some((f) => f.factType === 'constraint' && ['certification', 'years', 'degree'].includes(f.kind))) continue;
    // the gate this line states, if any (licence first, then years, degree…)
    const gates = linked.filter((f) => f.factType === 'constraint').map(gateOf).filter((g) => g.kind)
      .sort((a, b) => GATE_ORDER.indexOf(a.kind) - GATE_ORDER.indexOf(b.kind));
    const skillFacts = linked.filter((f) => f.factType === 'skill' && !f.soft);
    const kind = gates[0] ? gates[0].kind : isDuty ? 'duty' : skillFacts.length ? 'skill' : linked.some((f) => f.soft) ? 'trait' : 'requirement';
    let importance = isDuty ? 'duty' : st.importance === 'preferred' || st.kind === 'preferred' ? 'preferred' : 'required';
    // guard while the reader misses a flat "PREFERRED SKILLS AND EXPERIENCE:" heading
    if (importance === 'required' && inSpans(idx.flat, prefSpans, source0)) importance = 'preferred';
    const tools = skillFacts.filter((f) => !f.term && /^[A-Z0-9]/.test(displaySkill(f.normalizedLabel))).map((f) => skillName(f));
    // a line that is only its heading ("Minimum Degree Required") is said by the gate it states
    const shown = gates[0] && /^(?:(?:minimum|required|preferred|basic)\s+)?(?:degree|education|licen[sc]e|licensure|certifications?|experience)(?:\s+(?:required|requirements?))?$/i.test(text) ? gates[0].text : text;
    const anyOfNames = (linked.filter((f) => f.factType === 'skill' && f.anyOf && !f.soft)).map((f) => skillName(f));
    items.push({ anyOfNames, text: shown, kind, importance, source: capSource(source0, text), gate: importance === 'required' && !!gates[0], short: gates[0] ? gates[0].text : '', labels: linked.map((f) => f.label), tool: tools.length === 1 && importance === 'required', tools });
  }
  // gates → hard requirements → the top duties → at most two soft-trait lines → the other duties → preferred
  for (const it of items) it.soft = it.importance === 'required' && !it.gate && isSoftTrait(it.text);
  const stable = (xs) => xs.map((it, n) => [it, n]).sort((a, b) => (a[0].gate && b[0].gate ? GATE_ORDER.indexOf(a[0].kind) - GATE_ORDER.indexOf(b[0].kind) : 0) || (a[1] - b[1])).map((x) => x[0]);
  const gatesL = stable(items.filter((i) => i.importance === 'required' && i.gate));
  const hard = items.filter((i) => i.importance === 'required' && !i.gate && !i.soft);
  const duties = items.filter((i) => i.importance === 'duty');
  const soft = items.filter((i) => i.soft).slice(0, 2);
  const pref = items.filter((i) => i.importance === 'preferred');
  const order = [...gatesL, ...hard, ...duties.slice(0, 4), ...soft, ...duties.slice(4), ...pref];
  const seen = new Set();
  const out = order.filter((it) => { const k = it.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { items: out.slice(0, MAX_ITEMS), waivers, places };
}

// ── Items: the reader's units → display items. ONE function, so the reader's coming
// `facts.statements[]` (one restated requirement per posting line) replaces it without touching the
// rest. Each item: { text, kind, importance, source, gate, labels (reader labels), tool }.
function itemsFromFacts(facts, { idx, rowOf, prefSpans = [] }) {
  const skills = facts.filter(f => f.factType === 'skill' && !f.soft);
  const constraints = facts.filter(f => f.factType === 'constraint');
  const byLabel = new Map(skills.map(f => [f.normalizedLabel, f]));

  // 1. gates — the requirements that rule a person in or out (a schedule is a condition, not an item)
  const gates = [];
  for (const c of constraints) {
    const sentence = c.evidence || c.sentence || '';
    const { kind, text } = gateOf(c);
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
    const pref = c.importance === 'preferred' || inSpans(idx.flat, prefSpans, source);
    gates.push({ text, kind, importance: pref ? 'preferred' : 'required', source: capSource(source, text), gate: !pref, labels: [c.label] });
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
    const pref = f.importance === 'preferred' || inSpans(idx.flat, prefSpans, source);
    skillRows.push({ f, item: { text, kind, importance: pref ? 'preferred' : 'required', source: capSource(source, text), gate: false, labels, term: !!f.term, tool: kind !== 'any_of' && !f.term && !(f.examples || []).length && /^[A-Z0-9]/.test(displaySkill(f.normalizedLabel)) } });
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
      keptSkills.push({ f, item: { text: skillName(f), kind: 'trait', importance: f.importance === 'preferred' ? 'preferred' : 'required', source: capSource(source, skillName(f)), gate: false, labels: [f.label] } });
    }
  }
  const items = [];
  const add = (it) => { if (it && it.source && it.text && !items.some(x => x.text.toLowerCase() === it.text.toLowerCase())) items.push(it); };
  for (const g of gates.filter(g => g.importance === 'required')) add(g);
  for (const r of keptSkills.filter(r => r.item.importance === 'required')) add(r.item);
  for (const g of gates.filter(g => g.importance === 'preferred')) add(g);
  for (const r of keptSkills.filter(r => r.item.importance === 'preferred')) add(r.item);
  // an either-or bar holds the item it names ("3+ years in a manufacturing environment, or Bachelor's
  // degree" holds "3+ years in a manufacturing environment"): the contained one goes
  const lc = (t) => t.toLowerCase();
  const out = items.filter((it) => readableItem(it) && !items.some((o) => o !== it && /, or /i.test(o.text) && lc(o.text).includes(lc(it.text))));
  return out.slice(0, MAX_ITEMS);
}

// ── Conditions: what the posting states about the job itself — schedule, where, how long, who may
// apply, the physical work and the checks before an offer. Each is a sentence around the posting's
// own clause, with what to do about it.
const METRIC_LIFT_RE = /\blift(?:ing)?\b[^.;]{0,60}?(\d{1,3})\s*(?:kg|kgs|kilograms?|kilos?)\b/i;
const SHIFT_LEN_RE = /\b(\d{1,2})[- ]?(?:hour|hr)s?\s+shifts?\b/i;
const CONTRACT_RE = /\b(?:on\s*board|onboard|at sea|offshore|rotations?|tour of duty|contract(?:\s+(?:length|duration|term|period))?|assignments?|deployments?)\b[^.;]{0,50}?\b\d{1,2}\s*(?:(?:to|-|–)\s*\d{1,2}\s*)?(?:months?|weeks?)\b|\b\d{1,2}\s*(?:(?:to|-|–)\s*\d{1,2}\s*)?(?:months?|weeks?)\b[^.;]{0,40}?\b(?:on\s*board|onboard|at sea|offshore|contract|assignment|rotation|away from home)\b|\b\d{1,2}\s*(?:weeks?|days?)\s+on\b[^.;]{0,20}\b\d{1,2}\s*(?:weeks?|days?)\s+off\b|\b\d{1,2}[- ]month\s+(?:contract|assignment|engagement|term)\b/i;
const ONSITE_DAYS_RE = /\b(?:\d|one|two|three|four|five)\s*(?:\+\s*)?(?:or more\s+)?days?\s+(?:a|per|each|every)\s+week\b[^.;]{0,60}\b(?:office|on[- ]?site|in[- ]person|in the office|at (?:our|the) )|\b(?:in[- ]office|on[- ]?site|in[- ]person|in the office|hybrid)\b[^.;]{0,60}\b(?:\d|one|two|three|four|five)\s*(?:\+\s*)?(?:or more\s+)?days?\s+(?:a|per|each|every)\s+week\b/i;
const ONSITE_OFFICE_RE = /\boffice\s+(?:at least\s+)?(?:\d|one|two|three|four|five)\s*(?:\+\s*)?(?:or more\s+)?days?\b/i;
const ONSITE_ONLY_RE = /\b(?:fully|100%|entirely)\s+(?:on[- ]?site|in[- ]office|in[- ]person)\b|\bthis (?:is an?|role is|position is)\s+(?:an?\s+)?(?:fully\s+)?(?:on[- ]?site|in[- ]office|in[- ]person)\b/i;
const LOCATION_RES = [
  /\b(?:this|the)\s+(?:role|position|job|opening)\s+(?:is|will be)\s+(?:fully\s+)?(?:remote|based|located|hybrid)\b[^.;]{0,80}/i,
  /\b(?:role|position|job|you|candidates?|opportunity|team)\b[^.;]{0,40}\b(?:based|located)\s+(?:in|at|out of)\s+(?:our\s+)?[A-Z][\w.'’-]+(?:[ ,]+[A-Z][\w.'’-]+){0,4}/,
  /\bwork(?:ing)?\s+(?:from|out of|in|at)\s+(?:our|the)\s+(?:[A-Z][\w.'’-]+\s+){1,3}(?:office|offices|hub|headquarters|HQ|site|campus|plant|facility|warehouse|location|store|clinic|hospital)\b/,
  /\b(?:must|need to|required to|should)\s+(?:reside|live|be located|be based)\s+(?:in|within)\b[^.;]{2,60}/i,
  /\b(?:open to|for)\s+candidates\s+(?:residing|located|based|living)\s+(?:in|within)\b[^.;]{2,50}/i,
  /\bremote\s*(?:\(|-|–|—|,)?\s*(?:within\s+(?:the\s+)?|in\s+(?:the\s+)?)?(?:US|U\.S\.|United States|USA|Canada|UK|Europe|EU|LATAM)\b(?:\s*only)?\)?/i,
];
const RELOC_NO_RE = /\b(?:no|not|n['’]t|without)\b[^.;]{0,30}\breloc|\breloc\w*[^.;]{0,30}\b(?:not|unavailable|n['’]t)\b/i;
const RELOC_ASK_RE = /\bwilling(?:ness)?\s+to\s+relocate|\bmust\s+(?:be\s+(?:able|willing)\s+to\s+)?relocate|\bopen\s+to\s+relocat/i;
const RELOC_OFFER_RE = /\breloc\w*\s+(?:assistance|package|support|bonus|stipend|benefits?|is offered|offered|available|provided|reimbursement)/i;
const VISA_NO_RE = /\b(?:not|unable to|cannot|can['’]t|won['’]t|will not|no)\b[^.;]{0,30}\bsponsor|\bsponsorship\b[^.;]{0,40}\b(?:not|unavailable)\b|without (?:the need for )?(?:current or future )?(?:visa |employment )?sponsorship/i;
const CITIZEN_RE = /\b(?:U\.?S\.?|US) citizen(?:ship)?\b[^.;]{0,30}\b(?:required|must|only)|must be (?:a )?(?:U\.?S\.?|US) citizen|citizenship (?:is )?required|(?:active|current|ability to obtain|must (?:have|hold|obtain)) (?:a |an )?(?:secret|top secret|ts\/sci|security) clearance/i;
const AUTH_RE = /\bauthori[sz]ed to work|\bwork authori[sz]ation|\bright to work|\beligible to work|\blegally (?:able|permitted|authori[sz]ed) to work/i;
const VISA_YES_RE = /\b(?:will|can|able to)\s+sponsor|\bsponsorship (?:is )?(?:available|offered|provided)/i;
const ON_CALL_RE = /\bon[- ]call\b/i;
// "No overnight shifts", "not required to work weekends", "free of heavy lifting", "doesn't require travel"
const NEGATION_RE = /\b(?:no|not|never|without|none|zero|free\s+of|n['’]t(?:\s+\w+){0,2})\s+(?:[\w/-]+\s+){0,4}$/i;
/** Does the clause negate its own cue? (judged inside the cue's own comma/semicolon segment) */
export function negatesCue(clause, re) {
  const text = String(clause || '');
  const r = new RegExp(re.source, re.flags.replace('g', ''));
  const m = r.exec(text);
  if (!m) return false;
  const before = text.slice(0, m.index);
  const seg = before.slice(Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf('.'), before.lastIndexOf(' but ')) + 1);
  return NEGATION_RE.test(seg);
}
const ABSENT_SAY = {
  schedule: (q) => `The schedule rules these out: "${q}".`,
  physical: (q) => `It says the work isn't physical: "${q}".`,
  screening: (q) => `It says there's no such check: "${q}".`,
  travel: (q) => `It says there's no travel: "${q}".`,
  onsite: (q) => `It isn't office-bound: "${q}".`,
};

function conditionsFrom({ constraints, reqRows, rows, idx, statements = [], waivers = [], places = [], items = [] }) {
  const hidden = [];
  // `make(q)` writes the sentence around the posting's own clause `q` (verbatim, from the source)
  const addHidden = (label, kind, sentence, re, make, extra = {}) => {
    // the quote is the clause around the trigger, read from the WHOLE sentence (a run-on posting line
    // can be longer than a display source), and it is the condition's source when the posting holds it
    const full = norm(decodeEntities(sentence));
    const clause = re ? clauseAround(full, re) : null;
    const source = clause && idx.flat.includes(norm(unquote(clause))) ? clause : findSource(idx, sentence);
    if (!source || hidden.some(h => h.label.toLowerCase() === label.toLowerCase() || (h.kind === kind && h.source === source && kind !== 'screening'))) return;
    const q = clause && source === clause ? clause : (re && clauseAround(source, re)) || clauseAround(source, /\S/);
    // a heading fragment ("& On-Call Requirements") is not a sentence to quote
    if (!q || unquote(q).split(/\s+/).length < 2 || /^(?:&|and)\s|\brequirements?$/i.test(unquote(q))) return;
    // polarity: "No overnight shifts, no weekends" PROMISES the opposite of a hardship — it is said as
    // what the posting promises, never as something to be able to do
    if (!extra.polar && re && negatesCue(unquote(q || full), re)) {
      const said = ABSENT_SAY[kind];
      if (said && !hidden.some(h => h.absent && h.source === source)) hidden.push({ text: said(q), label: `no ${label}`, kind, source, gate: false, absent: true });
      return;
    }
    hidden.push({ text: make(q), label, kind, source, gate: !!extra.gate, absent: false });
  };
  const SCHED_RE = /shift|weekend|night|holiday|evening|overnight|part[- ]time|seasonal|temporary|hours|on[- ]call|rotat|availab|blackout|mornings?/i;
  const an = (w) => (/^[aeio]|^8/i.test(w) ? 'an' : 'a');
  const allRows = rows.filter(r => r.kind !== 'eeo');

  // schedule: named shifts with their hours, the reader's schedule facts, shift length, on-call, overtime
  for (const r of reqRows) {
    const shifts = namedShifts(r.sentence);
    if (!shifts.length) continue;
    addHidden(shifts.join(', '), 'schedule', r.sentence, /shift/i, (q) => (shifts.length > 1
      ? `It names ${joinList(shifts.map(x => `a ${x}`))} — ask which one this opening is before you apply.`
      : /\d:\d|\d\s*(?:am|pm)/i.test(shifts[0]) || !q
        ? `It's ${an(shifts[0])} ${shifts[0]} — apply only if you can work those hours every week.`
        : `It's ${an(shifts[0])} ${shifts[0]}: "${q}". Apply only if you can work it every week.`));
  }
  for (const c of constraints.filter(x => x.kind === 'schedule')) {
    const its = (c.items || []).filter(i => !/^full-time$/.test(i));
    if (!its.length) continue;
    const gate = c.importance === 'required' && its.some(i => SHIFT_COMMITMENT_RE.test(i));
    addHidden(its.join(', '), 'schedule', c.evidence || c.sentence || '', SCHED_RE, (q) => (q
      ? `${gate ? 'The schedule is required' : 'The schedule'}: "${q}". Check it fits your week before you apply.`
      : `The schedule includes ${joinList(its)} — check it fits your week before you apply.`), { gate });
  }
  for (const r of reqRows) {
    const len = SHIFT_LEN_RE.exec(r.sentence);
    if (len) addHidden(`${len[1]}-hour shifts`, 'schedule', r.sentence, SHIFT_LEN_RE, (q) => `The shifts are ${len[1]} hours long: "${q || len[0]}". Plan your week around that before you apply.`);
    if (ON_CALL_RE.test(r.sentence)) addHidden('on-call', 'schedule', r.sentence, ON_CALL_RE, (q) => `There is on-call work: "${q}". Ask how often the rotation comes round.`);
    if (/\bovertime\b/i.test(r.sentence) && /\b(?:available|availability|must|required|willing|able|expected|mandatory)\b/i.test(r.sentence)) {
      addHidden('Overtime', 'schedule', r.sentence, /overtime/i, (q) => `Overtime is expected${q ? `: "${q}"` : ''}. Ask how much is typical before you accept.`);
    }
  }

  // where and how long: who may apply, the place, office days, contract length, relocation
  for (const r of rows) {
    const t = decodeEntities(r.sentence);
    if (VISA_NO_RE.test(t)) addHidden('No visa sponsorship', 'work_authorization', t, /sponsor/i, (q) => `No visa sponsorship: "${q}". Apply only if you can already work there without one.`);
    else if (CITIZEN_RE.test(t)) addHidden('Citizenship or clearance', 'work_authorization', t, /citizen|clearance/i, (q) => `Who can apply: "${q}". Check you meet it before anything else — it rules people out before skills.`);
    else if (VISA_YES_RE.test(t)) addHidden('Visa sponsorship offered', 'work_authorization', t, /sponsor/i, (q) => `They sponsor visas: "${q}". Ask which visa types if you'd need one.`);
    else if (AUTH_RE.test(t) && /\b(?:must|required|only|need to|requires?)\b/i.test(t) && !/e-?verify|\bi-9\b|form i|contingent upon/i.test(t)) addHidden('Work authorisation', 'work_authorization', t, AUTH_RE, (q) => `They ask about work authorisation: "${q}". Have your status ready — it's asked early.`);
  }
  for (const r of allRows) {
    const t = decodeEntities(r.sentence);
    const loc = LOCATION_RES.map(re => re.exec(t)).find(Boolean);
    if (loc && !hidden.some(h => h.kind === 'location')) {
      const remote = /\bremote\b/i.test(loc[0]);
      addHidden('location', 'location', t, new RegExp(escapeRegExp(loc[0].slice(0, 24)), 'i'), (q) => `Where the work is: "${q || loc[0]}". ${remote ? 'Check you live where they can hire before you apply.' : 'Apply only if you can work from there.'}`);
    }
    if (ONSITE_DAYS_RE.test(t) || ONSITE_OFFICE_RE.test(t)) addHidden('office days', 'onsite', t, /days?\s+(?:a|per|each|every)\s+week|hybrid|in[- ]office|on[- ]?site/i, (q) => `Office days: "${q}". Check the commute to that office before you apply.`);
    else if (ONSITE_ONLY_RE.test(t)) addHidden('on-site', 'onsite', t, ONSITE_ONLY_RE, (q) => `It's on-site, every day: "${q}". Check the commute before you apply.`);
    if (CONTRACT_RE.test(t)) {
      const away = /board|sea|offshore|rotation|away/i.test(t);
      addHidden('contract length', 'contract', t, CONTRACT_RE, (q) => `It's a fixed stint: "${q}". ${away ? 'Plan for that time away from home before you apply.' : 'Ask whether it can extend or convert before you accept.'}`);
    }
    if (/\breloc/i.test(t)) {
      if (RELOC_NO_RE.test(t)) addHidden('no relocation', 'relocation', t, /reloc/i, (q) => `No help to move: "${q}". If you'd need to relocate, that cost is yours.`);
      else if (RELOC_ASK_RE.test(t)) addHidden('relocation asked', 'relocation', t, /reloc/i, (q) => `They ask about moving: "${q}". Say plainly whether you can relocate.`);
      else if (RELOC_OFFER_RE.test(t)) addHidden('relocation offered', 'relocation', t, /reloc/i, (q) => `They help with moving: "${q}". Ask what it covers if you'd need to move.`);
    }
  }

  // the reader's place lines ("Chicago (preferred) or US remote")
  for (const pl of places) if (!hidden.some(h => h.kind === 'location')) addHidden('location', 'location', pl.source, /remote|on[- ]?site|hybrid|in[- ]office|\b[A-Z][a-z]+/, (q) => `Where the work is: "${q}". ${/remote/i.test(q) ? 'Check you live where they can hire before you apply.' : 'Apply only if you can work from there.'}`);
  // the reader's own schedule lines (each judged for polarity like every other condition)
  for (const st of statements.filter(x => x.kind === 'schedule')) {
    addHidden(st.text, 'schedule', st.source || st.text, SCHED_RE, (q) => `The schedule: "${q}". Check it fits your week before you apply.`);
  }
  // physical demands (pounds and kilograms) in one sentence; of two lift figures, the heavier counts
  const physical = constraints.filter(c => c.kind === 'physical').map(c => ({ items: c.items && c.items.length ? c.items : [c.label], sentence: c.evidence || c.sentence || '' }));
  for (const r of rows.filter(x => REQ_KINDS_FOR_CONDITIONS.has(x.kind))) {
    const kg = METRIC_LIFT_RE.exec(decodeEntities(r.sentence));
    if (kg) physical.push({ items: [`lift ${kg[1]} kg`], sentence: r.sentence, kg: Number(kg[1]) });
  }
  if (physical.length) {
    const all = [...new Set(physical.flatMap(p => p.items))];
    const weight = (i) => { const m = /^lift (\d+) (lbs|kg)$/.exec(i); return m ? Number(m[1]) * (m[2] === 'kg' ? 2.2 : 1) : -1; };
    const lifts = all.filter(i => weight(i) >= 0).sort((x, y) => weight(y) - weight(x));
    const its = all.filter(i => weight(i) < 0 || i === lifts[0]);
    const src = physical.find(p => (lifts[0] ? p.items.includes(lifts[0]) : true)).sentence;
    addHidden(its.join(', '), 'physical', src, /lift|stand|on (?:your|their) feet|bend|stoop|kneel|climb|walk|push|carry|repetitive|crouch|squat|noise|outdoor/i,
      (q) => `It's physical work: ${q ? `"${q}"` : `you'll need to ${joinList(its)}`}. If you've done work like that, say so in your application.`);
  }
  // the reader's physical lines when no physical demand was read above
  if (!hidden.some(h => h.kind === 'physical')) {
    const st = statements.find(x => x.kind === 'physical');
    if (st) addHidden(st.text, 'physical', st.source || st.text, /lift|stand|bend|stoop|kneel|climb|walk|push|carry|repetitive|crouch|squat/i, (q) => `It's physical work: "${q}". If you've done work like that, say so in your application.`);
  }
  // what the posting promises or waives ("No experience required!", "no nights, weekends, or holidays")
  const promise = (text, sentence, make) => {
    const source = findSource(idx, sentence);
    if (!source || hidden.some(h => h.source === source || (h.absent && unquote(h.source) === unquote(source)))) return;
    const q = clauseAround(source, /\S/) || source;
    hidden.push({ text: make(q), label: text, kind: 'promise', source, gate: false, absent: true });
  };
  const waived = [...statements.filter(x => x.kind === 'promise' && /\bno\b[^.]{0,30}experience|experience\s+(?:is\s+)?not\s+(?:required|needed|necessary)/i.test(x.text)).map(x => ({ text: x.text, source: x.source || x.text })), ...waivers];
  for (const st of statements.filter(x => x.kind === 'promise' && !waived.some(w => w.text === x.text))) promise(st.text, st.source || st.text, (q) => `It promises: "${q}".`);
  for (const w of waived) {
    // "No experience required!" beside "Minimum of 1 year of experience…" — one line that says both
    const yrs = /experience/i.test(w.text) && items.find(i => i.kind === 'years' && i.importance === 'required');
    if (yrs) {
      const source = findSource(idx, w.source);
      const yq = clauseAround(yrs.source, YEARS_FIGURE_RE) || yrs.source;
      if (source && !hidden.some(h => h.kind === 'conflict')) hidden.push({ text: `The posting says both "${unquote(clauseAround(source, /\S/) || source)}" and "${unquote(yq)}" — ask which applies.`, label: 'experience asked and waived', kind: 'conflict', source, gate: false, absent: false });
      continue;
    }
    promise(w.text, w.source, (q) => `It says you don't need this: "${q}".`);
  }
  // the checks before an offer
  for (const c of constraints.filter(x => x.kind === 'background')) {
    const label = SCREEN_LABEL[c.label] || cap(c.label);
    const how = SCREEN_HOW[label] || SCREEN_HOW['Background check'];
    addHidden(label, 'screening', c.evidence || c.sentence || '', how.re, (q) => (q ? `${how.lead}: "${q}". ${how.act}` : `Expect a ${c.label} before an offer. ${how.act}`));
  }
  const checks = hidden.filter(h => h.kind === 'screening' && /^(?:Background check|Drug|Fingerprinting)/.test(h.label));
  if (checks.length >= 2) {
    const q = clauseAround(checks[0].source, /background|drug|fingerprint/i);
    const names = checks.map(h => h.label.toLowerCase());
    const merged = { text: q ? `Before an offer: "${q}". Have your past employers and addresses ready.` : `Before you start they run ${joinList(names.map(n => `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`))} — have your past employers and addresses ready.`, label: checks.map(h => h.label).join(', '), kind: 'screening', source: checks[0].source, gate: false };
    hidden.splice(hidden.indexOf(checks[0]), 1, merged);
    for (const h of checks.slice(1)) hidden.splice(hidden.indexOf(h), 1);
  }
  // checks the reader's list misses ("background clearance", "live scan", "TB test", "pre-employment physical")
  for (const r of reqRows) {
    const t = decodeEntities(r.sentence);
    if (/\bbackground\s+(?:clearance|investigation)|\blive\s?scan\b/i.test(t)) addHidden('Background check', 'screening', t, /background|live\s?scan/i, (q) => `Offers depend on a check: "${q}". Have your past employers and addresses ready.`);
    if (/\bTB\s+test|\btuberculosis\b|pre[- ]?employment\s+physical|physical\s+exam(?:ination)?\b/i.test(t)) addHidden('Health screening', 'screening', t, /TB\s+test|tuberculosis|physical/i, (q) => `There is a health check before you start: "${q}". Have your vaccination and TB records ready.`);
  }
  // equipment and travel
  for (const r of reqRows) {
    for (const e of equipmentOf(r.sentence)) addHidden(e, 'equipment', r.sentence, /transportation|vehicle|\bcar\b|tools|smartphone/i, (q) => (q ? `You'll need this from day one: "${q}".` : EQUIPMENT_SENTENCE[e]));
    const t = travelOf(r.sentence);
    if (t) addHidden(t, 'travel', r.sentence, /travel/i, (q) => `The job involves travel: "${q || t}". ${/%/.test(t) ? 'Make sure that works before you apply.' : 'Ask how often before you apply.'}`);
  }
  return hidden.sort((a, b) => CONDITION_ORDER.indexOf(a.kind) - CONDITION_ORDER.indexOf(b.kind)).slice(0, 8);
}
const REQ_KINDS_FOR_CONDITIONS = new Set(['requirements', 'responsibilities', 'preferred', 'physical', 'schedule', 'about']);

// A posting that is very short, or mostly about the company: one specific sentence on what it does and
// does not state, instead of a two-item list.
function postingNote({ company, rows, items, conditions, pay, postingText }) {
  const co = displayCompany(company) || 'the company';
  const about = rows.filter(r => r.kind === 'about' || r.kind === 'culture' || r.kind === 'benefits').length;
  const share = rows.length ? about / rows.length : 0;
  const short = norm(decodeEntities(postingText)).length < 600;
  const thin = items.filter(i => i.importance === 'required').length <= 2;
  if (!(items.length === 0 || (thin && (short || share >= 0.5)) || (share >= 0.7 && items.length < 5))) return '';
  const missing = [];
  if (!items.length) missing.push('what the job requires');
  // only what the posting truly leaves out: any figure, schedule or place word anywhere means it says something
  const all = decodeEntities(postingText);
  if (!pay && !/\$\s?\d|\b\d{2,3}\s?k\b|\bper\s+(?:hour|year|visit)\b/i.test(all)) missing.push('the pay');
  if (!conditions.some(c => c.kind === 'schedule') && !/\b(?:shifts?|weekends?|nights?|holidays?|hours|monday|friday|part[- ]time|full[- ]time|days?\s+(?:a|per)\s+week|schedule)\b/i.test(all)) missing.push('the schedule');
  if (!conditions.some(c => c.kind === 'location' || c.kind === 'onsite') && !/\b(?:remote|on[- ]?site|hybrid|in[- ]office|based in|located in|office|clinic|facility|warehouse|store)\b/i.test(all)) missing.push('where the work is');
  const states = items.slice(0, 2).map(phraseOf);
  const lead = short ? 'This posting is short' : `This posting is mostly about ${co}`;
  const said = states.length ? `: it asks only for ${joinList(states)}` : '';
  const orList = (xs) => (xs.length <= 1 ? xs[0] || '' : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
  const gap = missing.length ? `${said ? ', and' : ':'} it says nothing about ${orList(missing)}` : '';
  return `${lead}${said}${gap}${missing.length ? ' — ask the recruiter before you put time into an application' : ''}.`;
}

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
  const constraints = facts.filter(f => f.factType === 'constraint');

  // the reader's statements when this reading has them; a cached / older reading falls back to its facts
  const prefSpans = preferredSpans(idx.flat);
  const fromStatements = Array.isArray(facts.statements) && facts.statements.length > 0;
  const { items: shown, waivers, places } = fromStatements ? itemsFromStatements(facts, { idx, prefSpans }) : { items: itemsFromFacts(facts, { idx, rowOf, prefSpans }), waivers: [], places: [] };
  const conditions = conditionsFrom({ constraints, reqRows, rows, idx, statements: fromStatements ? facts.statements : [], waivers, places, items: shown });
  const read = shown.length > 0;
  const pay = (() => { const p = readPostingPay(postingText); return p ? { text: p.text, source: p.source } : null; })();
  const note = postingNote({ company, rows, items: shown, conditions, pay, postingText });
  const conditionsNote = read && !conditions.length ? 'This posting states no schedule, location, contract, physical or screening conditions.' : '';
  const tip = read ? insiderTip(shown, conditions) : { tip: '', source: null };
  // legacy strings: what they ask, a few duties, then what they prefer — ≤7
  const legacy = fromStatements ? shown : [...shown.filter(i => i.importance === 'required'), ...shown.filter(i => i.importance === 'duty').slice(0, 3), ...shown.filter(i => i.importance === 'preferred')];
  const what = legacy.slice(0, 7).map(i => (i.importance === 'preferred' ? `${i.text} (preferred)` : i.text));
  const skills = facts.filter(f => f.factType === 'skill' && !f.soft);
  const requirementsRead = skills.length + constraints.filter(c => ['degree', 'years', 'certification', 'language', 'management'].includes(c.kind)).length;

  const result = {
    what_they_want: what,
    hidden_requirements: conditions.map(h => h.text),
    insider_tip: tip.tip,
    description_summary: needsSummary && stripHtml(description).length >= 80 ? summarize(title, company, rows, shown, pay) : '',
    items: shown.map(({ labels: _l, tool: _t, term: _m, short: _s, tools: _ts, anyOfNames: _a, soft: _so, ...i }) => i),
    hidden_items: conditions,
    conditions_note: conditionsNote,
    posting_note: note,
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
