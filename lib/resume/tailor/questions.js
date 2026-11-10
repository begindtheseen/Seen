// Questions whose answers become résumé text — the only way anything the résumé does not already say
// can reach the document (director's rule 2: unknowns are asked, and the answer becomes the text).
//
// Two kinds:
//   • gap questions — one per real, unmet, plausible requirement of the posting (the verdict's
//     unsupported rows, filtered defensively by kind and shape — never re-reading the posting), attached
//     to the role most likely to hold it, with the question as visible text and a template that turns the
//     answer into a finished line (or a certification entry for a credential);
//   • number questions — the role family's measure ("How many patients per shift?"), never asked when a
//     bullet of that role already states a number in that measure.
//
// Every template either renders grammatical English or refuses (returns '' so the screen asks again): the
// judges exported "Delivered 5-6 patients…", "Picked and packed 150 orders orders per shift", "Delivered
// yes, 98%." and "Maintained [your number]." (studio.md D5, optimize.md 9).
import { escapeRegExp } from '../../text/escapeRegExp.js';
import { ROLE_FAMILIES, hasRoleTerm } from '../../application-intelligence/roleOntology.js';
import { resolveConcept } from '../../resume-intelligence/taxonomy.js';
import { KNOWN_VERBS } from '../health/verbs.js';
import { baseFromPast, baseFromGerund, pastTense } from '../rewrite/inflect.js';
import { credentialHeld } from '../../optimizer/credentials.js';
import { HOURLY_ONLY } from './competencies.js';
import { isGapNote, stemsCovered, cleanLine } from './verdict.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── answer → line templates, one per role-family measure (roleOntology.js ROLE_FAMILIES[*].metrics) ──
// kind count:     "{verb} {N} {noun}{tail}"   — the answer must carry a number; its own noun and rate win
// kind rate:      a percentage / score ("98%", "4.6/5"); a bare 0–100 number is read as a percent
// kind money:     "$40K", "1.2M", "40,000"
// kind duration:  a number with a time unit ("3 years", "18 months")
// kind statement: the person's own line, which must start with a verb and carry a number
export const ANSWER_TEMPLATES = {
  'customers per shift': { kind: 'count', verb: 'Served', noun: 'customers', tail: 'per shift', people: true },
  'guests per shift': { kind: 'count', verb: 'Served', noun: 'guests', tail: 'per shift', people: true },
  'patients per shift': { kind: 'count', verb: 'Cared for', noun: 'patients', tail: 'per shift', people: true },
  'patients per day': { kind: 'count', verb: 'Supported', noun: 'patients', tail: 'per day', people: true },
  'students taught': { kind: 'count', verb: 'Taught', noun: 'students', tail: '', people: true },
  'transactions per shift': { kind: 'count', verb: 'Rang up', noun: 'transactions', tail: 'per shift' },
  'orders per shift': { kind: 'count', verb: 'Picked and packed', noun: 'orders', tail: 'per shift' },
  'stops per shift': { kind: 'count', verb: 'Completed', noun: 'stops', tail: 'per shift' },
  'vehicles per shift': { kind: 'count', verb: 'Handled', noun: 'vehicles', tail: 'during a busy shift' },
  'forms/records per day': { kind: 'count', verb: 'Processed', noun: 'records', tail: 'per day' },
  'accounts/invoices per period': { kind: 'count', verb: 'Processed', noun: 'invoices', tail: '' },
  'incidents handled': { kind: 'count', verb: 'Responded to', noun: 'incidents', tail: '' },
  'projects delivered': { kind: 'count', verb: 'Delivered', noun: 'projects', tail: '' },
  'jobs/units completed': { kind: 'count', verb: 'Completed', noun: 'jobs', tail: '' },
  'satisfaction rating': { kind: 'rate', make: (n) => `Held a ${n} customer satisfaction rating` },
  'scan accuracy': { kind: 'rate', make: (n) => `Maintained ${n} scan accuracy` },
  'on-time rate': { kind: 'rate', make: (n) => `Delivered with a ${n} on-time rate` },
  accuracy: { kind: 'rate', make: (n) => `Kept a ${n} accuracy rate` },
  'order accuracy': { kind: 'rate', make: (n) => `Kept order accuracy at ${n}` },
  'quota attainment': { kind: 'rate', make: (n) => `Reached ${n} quota attainment` },
  'sales total': { kind: 'money', make: (n) => `Reached ${n} in sales` },
  revenue: { kind: 'money', make: (n) => `Generated ${n} in revenue` },
  'safety record': { kind: 'duration', make: (n) => `Kept a clean safety record for ${n}` },
  'wait time': { kind: 'duration', make: (n) => `Kept guest wait times to ${n} during rushes` },
  'quality measure': { kind: 'statement' },
  'latency/perf improvement': { kind: 'statement' },
  'users/scale': { kind: 'statement' },
  'reporting time saved': { kind: 'statement' },
  'efficiency gain': { kind: 'statement' },
  'traffic/leads growth': { kind: 'statement' },
  'campaign ROI/ROAS': { kind: 'statement' },
  'score/outcome improvement': { kind: 'statement' },
  'team/budget size': { kind: 'statement' },
  'volume/outcome': { kind: 'statement' },
};
// The example shown on the screen, so the person knows what shape of answer becomes which line.
export const ANSWER_HINT = { count: 'a number ("12", or "about 12 a day")', rate: 'a percentage or a score ("98%", "4.6/5")', money: 'an amount ("$40K")', duration: 'a length of time ("3 years")', statement: 'one line that starts with a verb and has the number in it' };

const NO_ANSWER_RE = /^(?:no|nope|n\/a|na|none|not really|nothing|idk|i don'?t know|unsure|not sure|-+)\.?$/i;
const LEAD_FILLER_RE = /^(?:(?:yes|yeah|yep|sure|ok|okay)\b[,.!:;\s-]*)?(?:i\s+(?:would\s+say|think|guess)\s+|i\s+|we\s+)?/i;
const QTY_RE = /^((?:about|around|approximately|approx\.?|roughly|up to|over|more than|nearly|almost|at least|~)\s*)?(\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b)\b)?\+?(?:\s*(?:-|–|to)\s*\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b)\b)?\+?)?)(.*)$/i;
const RATE_TAIL_RE = /^(?:per|a|an|each|every)\s+(?:shift|day|night|week|month|quarter|year|hour|visit)\b|^(?:daily|weekly|monthly|nightly|hourly|yearly|annually)\b/i;
const PEOPLE_RE = /\b(?:patients|residents|clients|customers|guests|members|students|callers|visitors|shoppers|families|children|kids|learners|people)$/i;
const PREP_RE = /^(?:on|in|at|across|for|during|with|from|over|under|within|between|throughout)\b/i;

function stripFiller(answer) {
  return String(answer || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').replace(LEAD_FILLER_RE, '').trim();
}
const collapseRepeats = (s) => s.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
const singular = (w) => w.replace(/ies$/i, 'y').replace(/(?<=[^s])s$/i, '');

function countLine(t, a) {
  const m = a.match(QTY_RE);
  if (!m) return '';
  const qty = `${m[1] || ''}${m[2]}`.replace(/\s+/g, ' ').trim();
  if (/^\s*(?:%|\/|percent\b)/i.test(m[3])) return ''; // "98%" answers a rate, not a count
  let rest = m[3].trim().replace(/^[,;:]\s*/, '');
  // the answer's own noun ("70 calls", "120 panel installs") replaces the template's when it gives one
  let noun = t.noun;
  const nm = rest.match(/^((?:[a-z][a-z/-]*\s+){0,2}?[a-z][a-z/-]*s)\b(.*)$/i);
  if (nm && !RATE_TAIL_RE.test(rest) && !PREP_RE.test(rest)) {
    noun = nm[1].toLowerCase();
    rest = nm[2].trim();
  } else if (nm && singular(nm[1].toLowerCase()) === singular(t.noun)) { rest = nm[2].trim(); }
  let verb = t.verb;
  if (noun !== t.noun && t.people && !PEOPLE_RE.test(noun)) verb = 'Handled';
  let tail = t.tail;
  const rate = rest.match(RATE_TAIL_RE);
  if (rate) { tail = rate[0]; rest = rest.slice(rate[0].length).trim(); }
  // drop the template's unit words when the answer repeats them ("150 orders per shift" → no "orders orders")
  rest = rest.replace(new RegExp(`^${escapeRegExp(t.noun)}\\b`, 'i'), '').trim();
  if (rest && !PREP_RE.test(rest) && !/^[,;(]/.test(rest)) rest = '';
  const line = [verb, qty, noun, tail, rest].filter(Boolean).join(' ');
  return collapseRepeats(line);
}

function rateValue(a) {
  const m = a.match(/\d+(?:\.\d+)?\s*%|\d(?:\.\d+)?\s*\/\s*\d+|\d+(?:\.\d+)?/);
  if (!m) return '';
  let v = m[0].replace(/\s+/g, '');
  // a bare number is a percent only when it reads as one: "4.6" or "5" could be a score out of 5 — asked again
  if (/^\d+(?:\.\d+)?$/.test(v)) { if (Number(v) > 100 || Number(v) <= 5) return ''; v = `${v}%`; }
  return v;
}

function statementLine(a) {
  const words = a.split(/\s+/);
  if (words.length < 3 || !/\d/.test(a)) return '';
  const first = words[0].toLowerCase().replace(/[^a-z-]/g, '');
  const isVerb = KNOWN_VERBS.has(first) || !!baseFromPast(first, KNOWN_VERBS) || !!baseFromGerund(first, KNOWN_VERBS);
  if (!isVerb) return '';
  return cap(a);
}

const ANSWER_PREP_RE = /^(to|for|at|in|on|with|across|during|while|as|through)\s+/i;

// An answer becomes the line in the person's own words: a verb-led answer IS the line; a tool answered with where /
// what-for becomes "Used <tool> for …"; a "-ing" duty becomes its own verb ("cash handling" + "a $5K drawer every shift
// at Target" → "Handled cash: a $5K drawer every shift at Target"); anything else is asked again ('' = "start with what
// you did"). Never "Performed <requirement> for […]" (T3: the judges' wrong-field electrician got exactly that).
function gapLine(prompt, a) {
  const label = prompt.label || prompt.requirement || '';
  if (prompt.answerKind === 'credential') return /^(?:yes|yeah|yep|y|i do|i have|i hold)\b/i.test(String(prompt._raw || a)) ? label : '';
  let body = a.trim().replace(/^(?:yes|yeah|yep|sure)\b[,.!:;\s-]*/i, '').trim();
  if (!body || body.split(/\s+/).length < 2) return '';
  const [w0, ...more] = body.split(/\s+/);
  const w = String(w0 || '').toLowerCase().replace(/[^a-z-]/g, '');
  const pastBase = baseFromPast(w, KNOWN_VERBS);
  const gerBase = baseFromGerund(w, KNOWN_VERBS);
  // the person's own verb leads: their line, as written (a present or -ing lead takes the past: it is done work)
  if (KNOWN_VERBS.has(w) || pastBase || gerBase) {
    const base = pastBase || gerBase || w;
    const verb = pastBase ? w0 : pastTense(base);
    return collapseRepeats(`${cap(verb.toLowerCase())} ${more.join(' ')}`.trim());
  }
  if (stemsCovered(body, label)) return ''; // only repeats the requirement
  const pm = body.match(ANSWER_PREP_RE);
  if (prompt.answerKind === 'tool') {
    const prep = pm ? pm[1].toLowerCase() : 'for';
    if (pm) body = body.slice(pm[0].length).trim();
    return body.split(/\s+/).length >= 1 ? collapseRepeats(`Used ${label} ${prep} ${body}`) : '';
  }
  // a "-ing" duty carries its own verb: "cash handling" → "Handled cash"
  const lw = label.split(/\s+/);
  const head = lw[lw.length - 1].toLowerCase();
  const hb = /ing$/.test(head) ? baseFromGerund(head, KNOWN_VERBS) : null;
  if (hb) {
    const obj = lw.slice(0, -1).join(' ');
    return collapseRepeats(`${cap(pastTense(hb))}${obj ? ` ${obj}` : ''} ${pm ? '' : '— '}${body}`.replace(/\s+/g, ' ').replace(/ — /, ': ').trim());
  }
  return '';
}

/**
 * The line an answer becomes, or '' when the answer cannot honestly become one (no number for a count, a
 * bare "yes", a repeat). Exported through optimizer.js / tailor.js / engine-client.ts as bulletFromAnswer.
 */
export function bulletFromAnswer(prompt, answer) {
  const raw = String(answer || '').trim();
  if (!raw || NO_ANSWER_RE.test(raw)) return '';
  const p = prompt || {};
  if (p.facet || p.kind === 'detail') return composeDetailAnswer(p, raw).line;
  if (p.kind === 'gap') { const line = gapLine({ ...p, _raw: raw }, stripFiller(raw)); return line ? (p.answerKind === 'credential' ? line : `${line}.`) : ''; }
  if (p.unit === 'line' || /\[number\]/.test(String(p.template || ''))) { const r = composeLineAnswer(p, raw); return r.line; }
  const a = stripFiller(raw);
  if (!a) return '';
  const t = ANSWER_TEMPLATES[p.unit];
  let line = '';
  if (!t) {
    // an unknown measure: the person's number and noun after the role's own verb ("Delivered 40 orders a night")
    const m = a.match(QTY_RE);
    if (m && /^\s*[a-z]/i.test(m[3] || '')) line = collapseRepeats(`${cap(p.action || 'Delivered')} ${a}`);
  } else if (t.kind === 'count') line = countLine(t, a);
  else if (t.kind === 'rate') { const v = rateValue(a); line = v ? t.make(v) : ''; }
  else if (t.kind === 'money') { const m = a.match(/\$?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|million|billion|thousand)?\+?/i); line = m ? t.make(m[0].replace(/\s+(?=[kmb]\b)/i, '').trim()) : ''; }
  else if (t.kind === 'duration') { const m = a.match(/(?:under|less than|about|over|more than|nearly)?\s*\d+(?:\.\d+)?\+?\s*(?:-|–|to)?\s*\d*\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|shifts?)\b/i); line = m ? t.make(m[0].trim()) : ''; }
  else if (t.kind === 'statement') line = statementLine(a);
  return line ? `${line.replace(/[.;,\s]+$/, '')}.` : '';
}

/**
 * A number question's answer, placed ONLY in the slot the question defined (round 3: a bare "25" became "…WMS
 * (Manhattan), 25." and "Do 25 cycle counts and help…"). Returns { line, problem } — `problem` is a plain reason the
 * screen shows when the answer cannot honestly complete the line.
 */
const PERIOD_RE = /\b(?:per|a|an|each|every)\s+(shift|day|night|week|month|quarter|year|visit|call)\b|\b(daily|weekly|monthly|nightly|quarterly|yearly|annually)\b/i;
export function composeLineAnswer(p0, raw) {
  // whatever the screen hands back — the full prompt, the package question, or just its template / line — is enough
  let p = p0 || {};
  if (!p.nounWords && p.line) { const sl = numberSlot(p.line); if (sl) p = { ...p, ...sl, slot: 'insert' }; }
  if (!p.nounWords && /\[number\]/.test(String(p.template || ''))) {
    const m = String(p.template).match(/^(.*?)\s*\[number\]\s*(.*?)(?:\s*\[a shift[^\]]*\])?(?:\s+(.*))?$/);
    if (m) {
      const hasSlot = /\[a shift[^\]]*\]/.test(p.template);
      const tail = hasSlot ? String(p.template).split(/\[a shift[^\]]*\]/)[1].trim() : '';
      const nounWords = hasSlot ? String(p.template).split('[number]')[1].split(/\[a shift/)[0].trim() : String(m[2] || '').split(/\s+/).slice(0, 3).join(' ');
      const after = hasSlot ? tail : String(p.template).split('[number]')[1].trim().slice(nounWords.length).trim();
      p = { ...p, slot: 'insert', before: m[1].trim(), nounWords, after, needsPeriod: hasSlot };
    }
  }
  const a = stripFiller(String(raw || ''));
  if (!a || NO_ANSWER_RE.test(String(raw || '').trim())) return { line: '', problem: 'Leave it blank if you do not have a number you can defend.' };
  const num = a.match(/(?:about|around|over|more than|nearly|up to|~)?\s*\$?\d[\d,.]*(?:\s*(?:k|m)\b)?\+?(?:\s*(?:-|–|to)\s*\d[\d,.]*\+?)?/i);
  if (!num) return { line: '', problem: 'Type a number — for example "12" or "about 12".' };
  if (p.slot !== 'insert' || !p.nounWords) return { line: '', problem: 'This line has no place for a number.' };
  let period = '';
  const pm = a.match(PERIOD_RE);
  if (pm) period = pm[1] ? `${pm[0].split(/\s+/)[0].toLowerCase() === 'per' ? 'per' : 'a'} ${pm[1].toLowerCase()}` : pm[2].toLowerCase();
  if (p.needsPeriod && !period) return { line: '', problem: `Say how often — for example "${num[0].trim()} a week" or "${num[0].trim()} a month".` };
  // the line already says how often: a different period in the answer would contradict it
  if (!p.needsPeriod && period) { const own = String([p.before, p.nounWords, p.after].join(' ')).match(PERIOD_RE); if (own && own[0].toLowerCase() !== period && !(own[2] && period.endsWith(own[2].replace(/ly$/, '')))) return { line: '', problem: `Your line already says "${own[0]}" — type just the number.` }; }
  // nothing but the number and its period may come from the answer: anything else is the person's to write into the line
  const rest = a.replace(num[0], '').replace(PERIOD_RE, '').replace(new RegExp(`\\b${escapeRegExp(p.nounWords.split(' ').slice(-1)[0])}\\b`, 'i'), '').replace(/[\s,.;:-]+/g, ' ').trim();
  if (rest && rest.split(/\s+/).length > 1) return { line: '', problem: `Only the number goes into this line — type just "${num[0].trim()}${period ? ` ${period}` : ''}".` };
  const line = [p.before, num[0].trim(), p.nounWords, p.needsPeriod ? period : '', p.after].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (/\d[\d,.]*\s+\d/.test(line.replace(num[0].trim(), 'N')) && /N\s+\d/.test(line.replace(num[0].trim(), 'N'))) return { line: '', problem: 'That would put two numbers side by side.' };
  return { line: `${line.replace(/[.;,\s]+$/, '')}.`, problem: null };
}

/**
 * A gap question's answer → { line, problem }: the line the person's answer becomes, or the plain reason it cannot.
 */
export function composeGapAnswer(p, raw) {
  if (p && (p.facet || p.kind === 'detail')) return composeDetailAnswer(p, raw);
  const r = String(raw || '').trim();
  if (!r || NO_ANSWER_RE.test(r)) return { line: '', problem: 'Leave it blank if it is not true for you — nothing is added.' };
  const line = bulletFromAnswer({ ...p, kind: 'gap' }, r);
  if (line) return { line, problem: null };
  if (p.answerKind === 'credential') return { line: '', problem: 'Answer "yes" only if you hold it — it is added under Certifications as the posting names it.' };
  if (p.answerKind === 'tool') return { line: '', problem: `Say what you used ${p.label || 'it'} for, or start with what you did — e.g. "reconciled vendor accounts in it".` };
  return { line: '', problem: 'Start with what you did, in your own words — e.g. "Coordinated discharge plans for 5 patients a shift".' };
}

/** The template line shown beside the question ("Your answer becomes: …"), with a visible slot. */
export function answerPreview(prompt) {
  if (prompt.kind === 'gap') {
    const role = prompt.company ? ` under ${prompt.roleTitle ? `${prompt.roleTitle} at ` : ''}${prompt.company}` : '';
    if (prompt.answerKind === 'credential') return `${prompt.label} goes under Certifications when you answer yes.`;
    if (prompt.answerKind === 'tool') return `Used ${prompt.label} for [what, and where] — or your own line starting with what you did. It goes${role}.`;
    return `Your answer, starting with what you did, becomes a line${role} in your words.`;
  }
  const t = ANSWER_TEMPLATES[prompt.unit];
  if (!t) return '';
  if (t.kind === 'count') return `${[t.verb, '[number]', t.noun, t.tail].filter(Boolean).join(' ')}.`;
  if (t.kind === 'statement') return `[one line starting with a verb, with the number${prompt.company ? `, about your work at ${prompt.company}` : ''}]`;
  return `${t.make('[' + (t.kind === 'rate' ? 'percentage' : t.kind === 'money' ? 'amount' : 'length of time') + ']')}.`;
}

// ── which unmet requirements are worth a question ──
const ACRONYMS_OK = new Set(['hipaa', 'emr', 'ehr', 'osha', 'cpr', 'bls', 'acls', 'pals', 'nrp', 'cdl', 'nec', 'gaap', 'sql', 'aws', 'gcp', 'crm', 'erp', 'pos', 'sox', 'cpa', 'rn', 'lpn', 'cna', 'hvac', 'plc', 'api', 'apis', 'etl', 'kpi', 'seo', 'sem', 'ppc', 'ehs', 'gmp', 'fda', 'iso', 'lean', 'cnc', 'rf', 'wms', 'tms', 'sap', 'ui', 'ux', 'qa', 'ci', 'cd', 'iv', 'icu', 'pacu', 'ccrn', 'nihss', 'tncc', 'ap', 'ar', 'gl', 'cma', 'cfa', 'pmp', 'csm', 'epa', 'dot', 'ase', 'nfpa', 'php', 'css', 'html', 'ios']);
const BAD_FIRST = /^(?:up|within|by|of|for|to|in|on|with|and|or|the|a|an|less|more|than|our|your|their|this|that|these|those|its|any|all|each|via|including)\b/i;
const BAD_LAST = /\b(?:incredible|exceptional|strong|excellent|outstanding|simultaneous|proficient|senior|junior|used|provided|based|reflecting|required|preferred|relevant|related|various|multiple|own|new|great|good|individual|ability|abilities|skills?|experience|knowledge|members'?|and|or|of|to|the|a|in|for|with)$/i;
const VERBY = /\b(?:gain|combine|represent|integrating|reflecting|pose|visit|apply|join|offer|offers|provides?|turns?|ensures?|helps?|seeking|looking)\b/i;
const CREDENTIAL_RE = /\b(?:licen[cs]e[ds]?|certif\w*|registration|registered|cpr|bls|acls|pals|cdl|cpa|ccrn|tncc|nrp|osha\s*\d+)\b/i;
const DEGREE_RE = /\b(?:degree|diploma|ged|bachelor'?s?|master'?s?|associate'?s?|b\.?s\.?n?|m\.?s\.?|mba|phd|doctorate)\b/i;
const ABSTRACT = new Set(['compliance', 'training', 'communication', 'leadership', 'teamwork', 'integrity', 'accountability', 'professionalism', 'organization', 'collaboration', 'reliability', 'safety', 'quality', 'service', 'support', 'operations', 'management', 'administration', 'documentation', 'coordination', 'flexibility', 'adaptability', 'initiative', 'ownership', 'growth', 'learning', 'innovation', 'excellence', 'diversity', 'travel', 'availability']);
// traits a line shows by how it reads, never an activity to "perform" ("Handled critical thinking for…")
const SOFT_PHRASE = /^(?:critical thinking|problem[- ]solving|time management|attention to detail|multi-?tasking|decision[- ]making|human relations?|interpersonal(?: skills)?|work ethic|team ?work|self[- ]motivat\w*|customer focus|emotional intelligence|active listening|good judgment|sound judgment|people skills|soft skills|written communication|verbal communication|positive attitude|professional demeanor|growth mindset)$/i;
const KNOWLEDGE_RE = /\b(?:terminology|regulations?|codes?|law|laws|compliance|standards?|principles|guidelines|policies|procedures|hipaa|gaap|osha|anatomy|theory)\b/i;

/** Is an unmet row something a person can honestly be asked about? Shape and kind only — never a re-read. */
export function askableGap(row, resumeText = '') {
  const label = String(row.label || '').trim();
  if (!label || row.soft) return false;
  if (row.importance && !['required', 'preferred', 'nice_to_have', 'responsibility'].includes(row.importance)) return false;
  if (/^one of\s/i.test(label)) return false; // an either/or set is answered by its members
  const words = label.split(/\s+/);
  if (words.length > 4 || label.length > 40) return false;
  if (/\d/.test(label) && !/\b(?:osha\s*\d+|\d+v|section\s*\d+)\b/i.test(label)) return false;
  if (BAD_FIRST.test(label) || BAD_LAST.test(label) || VERBY.test(label)) return false;
  if (DEGREE_RE.test(label)) return false;
  // a quality or a field, not something you did ("confidentiality", "compliance", "training"): no line answers it
  if (words.length === 1 && (/(?:ity|ness|ism|ance|ence|ship)$/i.test(label) || ABSTRACT.has(label.toLowerCase()))) return false;
  if (SOFT_PHRASE.test(label)) return false;
  // reader fragments: an adjective or "non-" lead ("favorable customer shopping", "non-internship marketing"), a slash
  // pair ("local laws/enterprise policies"), an "X of Y" clause ("performance of distributed systems"), a modifier
  // with no noun ("AI-powered")
  if (/^(?:favorable|positive|strong|excellent|proven|great|good|solid|effective|successful|outstanding|demonstrated|exceptional|high|deep|broad|basic|general|overall|various|key|core|relevant|non-\w+)\b/i.test(label)) return false;
  if (/\//.test(label) && !/^[A-Z0-9]{1,5}\/[A-Z0-9]{1,5}$/.test(label)) return false;
  if (/\s(?:of|for|to|with|from)\s/i.test(label)) return false;
  if (/-(?:powered|based|driven|focused|oriented|related|level|facing)$/i.test(label)) return false;
  // a job title ("Legal Secretary"), an organisation ("Veterans Health Administration"), an unknown initialism inside a
  // label ("Litigation LAA"), a participle tail ("ownership varying") or a bare -tion word ("creation") is no ask
  if (/\b(?:secretary|assistant|manager|nurse|engineer|technician|specialist|coordinator|director|clerk|associate|representative|officer|analyst|lead|supervisor|administrator)s?$/i.test(label) && words.length > 1) return false;
  if (/\b(?:administration|department|agency|association|institute|university|hospital|group|company|corporation|foundation|council|bureau|ministry)$/i.test(label)) return false;
  if (words.some((w) => /^[A-Z]{2,5}$/.test(w) && !ACRONYMS_OK.has(w.toLowerCase())) && !resolveConcept(label)) return false;
  if (/\b(?:varying|including|regarding|according|following|ranging|involving|requiring|working)$/i.test(label)) return false;
  if (words.length === 1 && /(?:tion|sion|ment)$/i.test(label) && !resolveConcept(label) && !/^(?:documentation|reconciliation|installation|automation|segmentation|inspection|onboarding)$/i.test(label)) return false; // education is judged by the verdict's own gate, never asked as a line
  // a shouted word or initials ("NOW", "CMD", "NMH", "OBE") is a real term only when it is a known one
  if (/^[A-Z][A-Z0-9&.-]{1,5}$/.test(label) && !ACRONYMS_OK.has(label.toLowerCase().replace(/[^a-z]/g, '')) && !resolveConcept(label)) return false;
  // a capitalised single word that is no known concept is usually a brand/page name read from the posting
  if (words.length === 1 && /^[A-Z][a-z]+$/.test(label) && !resolveConcept(label) && row.term) return false;
  // the résumé already shows it (the reader missed it) — never asked, never told to add it
  if (resumeText && resumeText.split('\n').some((l) => stemsCovered(label, l))) return false;
  return true;
}

const ACTIVITY_HEAD = /(?:ing|tion|sion|ment|sis|ance|ery|ure)s?$|^(?:triage|intake|audits?|reconciliations?|installs?|repairs?|inspections?|assessments?|rounds|outreach|follow-?ups?|onboarding|scheduling|billing|coding|charting|phlebotomy|venipuncture|dispatch|estimates?|takeoffs?|bookkeeping|payroll|forecasting|budgeting|closing|close|underwriting|collections|prospecting|merchandising|picking|packing|receiving|shipping|loading|welding|wiring|troubleshooting|debugging|testing|deployments?|migrations?|code reviews?)$/i;
const TOOL_HEAD = /\b(?:software|system|systems|platform|platforms|tools?|suite|application|applications|apps?|portal|database|databases|crm|erp|ehr|emr|wms|pos)$/i;
/** Which template reads grammatically for this label — or null, and then the question is not asked. */
function answerKindOf(label) {
  if (CREDENTIAL_RE.test(label)) return 'credential';
  if (KNOWLEDGE_RE.test(label)) return 'knowledge';
  const words = label.split(/\s+/);
  const head = words[words.length - 1];
  if (TOOL_HEAD.test(label)) return 'tool';
  const c = resolveConcept(label);
  // a product name: capitalised words ("Microsoft Office Suite", "Dentrix", "Epic", "Salesforce")
  if (/^(?:[A-Z][a-zA-Z0-9+#.-]*)(?:\s+[A-Z][a-zA-Z0-9+#.-]*)*$/.test(label) && !/^[A-Z]{2,}$/.test(label)) return words.length <= 3 ? 'tool' : null;
  if (/^[A-Z0-9+#.]{2,6}$/.test(label)) return c && /tool|software|platform/.test(c.category || '') ? 'tool' : null;
  if (ACTIVITY_HEAD.test(head) && !/(?:information|services?|experience|environment|sale|scope)$/i.test(head)) return 'activity';
  return null;
}
const shownLabel = (label) => (/^[A-Z][a-z]+(?:\s+[a-z]+)*$/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);

/**
 * One question per real, unmet, plausible requirement. `roles` = the base document's experience; the role
 * most likely to hold the requirement is the one with the most verdict evidence (ties → the person's order).
 */
// the families a term belongs to (an exact keyword or title of the family, or a multi-word one inside it)
function termFamilies(label) {
  const l = String(label || '').toLowerCase().trim();
  return Object.entries(ROLE_FAMILIES).filter(([, d]) => [...(d.titles || []), ...(d.keywords || [])].some((k) => k === l || (k.includes(' ') && hasRoleTerm(l, k)))).map(([f]) => f);
}
const FAMILY_NEAR = [['retail', 'customer_service', 'food_service', 'hospitality', 'sales'], ['warehouse', 'delivery_logistics', 'operations', 'manufacturing', 'skilled_trades'], ['clinical', 'healthcare_support'], ['administrative', 'healthcare_support', 'customer_service', 'finance_accounting', 'operations'], ['marketing', 'sales'], ['software_engineering', 'data']];
/** Plausible for this person: a term that belongs to some field is asked only when that field is the posting's, the
 * person's, or next to the person's ("receiving" is not asked of a nurse; "CDL" is asked of a warehouse lead). */
const HOURLY_FAMS = new Set(['retail', 'customer_service', 'food_service', 'hospitality', 'valet_parking', 'warehouse', 'delivery_logistics', 'security']);
export function plausibleFor(label, { jobFamily = '', personFamilies = [] } = {}) {
  // front-line work ("order picking", "cash handling") is no ask for a desk job, whatever a benefits line said
  if (HOURLY_ONLY.includes(String(label).toLowerCase()) && jobFamily && !HOURLY_FAMS.has(jobFamily)) return false;
  const fams = termFamilies(label);
  if (!fams.length) return true;
  const ok = new Set([...personFamilies, ...personFamilies.flatMap((f) => FAMILY_NEAR.filter((g) => g.includes(f)).flat())]);
  if (jobFamily && personFamilies.includes(jobFamily)) return fams.some((f) => ok.has(f));
  return fams.some((f) => ok.has(f) || f === jobFamily);
}

export function gapQuestions(base, verdict, { max = 3, company = '', statements = null, jobFamily = '', personFamilies = [] } = {}) {
  const resumeText = [base.basics.summary || '', base.basics.headline || '', ...base.experience.flatMap((e) => [e.title, e.company, e.summary || '', ...e.bullets.map((b) => b.text)]), ...base.skills.flatMap((g) => g.items), ...base.certifications.map((c) => c.text || c.name || ''), ...base.education.map((e) => [e.degree, e.field, e.institution].filter(Boolean).join(' '))].map(cleanLine).filter(Boolean).join('\n');
  const roles = base.experience.filter((e) => !isGapNote(e) && e.company);
  if (!roles.length) return [];
  // where it most plausibly happened: the most recent role that proves anything the posting asks for (the
  // person's own order), else their first role — HIPAA is asked about the dental office, not the 2011 logistics job
  const home = roles.find((e) => (verdict.roleWeight.get(e.id) || 0) > 0) || roles[0];
  const stmt = (r) => (r.statementId && Array.isArray(statements) ? (statements.find((x) => x.id === r.statementId) || {}).text || '' : '');
  const imp = (r) => (r.importance === 'required' ? 2 : r.importance === 'preferred' ? 1 : 0);
  const rows = [...verdict.unmet].filter((r) => askableGap(r, resumeText)).sort((a, b) => imp(b) - imp(a) || b.weight - a.weight);
  const seen = new Set();
  const out = [];
  const who = company ? company.charAt(0).toUpperCase() + company.slice(1) : 'This employer';
  for (const r of rows) {
    const key = r.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = answerKindOf(r.label);
    if (!kind) continue;
    if (kind === 'credential' && credentialHeld(resumeText, r.label)) continue;
    // a capitalised phrase is a TOOL only when it is a known one or reads like a product name (an inner capital, a
    // digit, a known acronym): "Disruptive Technology", "Military Health System" are the posting's prose, not tools
    if (kind === 'tool' && !resolveConcept(r.label) && !/[a-z][A-Z]|\d|^[A-Z]{2,6}$/.test(r.label)) continue;
    // only what the posting asks of the person (a requirement or a preferred item), never a duty line read as one
    if (r.importance && !['required', 'preferred'].includes(r.importance)) continue;
    // a participle or a quantifier is the posting's prose, not a requirement ("assigned station", "various duties")
    if (/^(?:assigned|designated|required|given|daily|weekly|various|other|general|additional|overall|related|flexible|adaptable|comfortable|able|willing|eager|motivated|unionized|diverse)\b/i.test(r.label)) continue;
    if (!plausibleFor(r.label, { jobFamily, personFamilies })) continue;
    // an activity a résumé line already names by its root ("receiving" ← "Receive and put away 8 to 10 inbound trailers")
    if (kind === 'activity') {
      const root = (w) => w.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
      const heads = r.label.split(/\s+/).filter((w) => w.replace(/[^a-z]/gi, '').length >= 6).map(root);
      const words = new Set(resumeText.split(/[^A-Za-z]+/).filter((w) => w.length >= 5).map(root));
      if (heads.length && heads.every((h) => words.has(h))) continue;
    }
    // a trait, or one bare word that is no known skill ("natural intuition", "architecture"), is not asked as a duty
    if (/\b(?:intuition|instincts?|passion|curiosity|mindset|drive|grit|hunger|empathy|creativity|vision|judg(?:e)?ment)\b/i.test(r.label)) continue;
    if (kind === 'activity' && !/\s/.test(r.label) && !resolveConcept(r.label) && !/^(?:payroll|scheduling|merchandising|budgeting|forecasting|bookkeeping|invoicing|onboarding|receiving|shipping|packing|picking|triage|phlebotomy|welding|wiring|dispatch|underwriting|prospecting|billing|coding|charting|auditing)$/i.test(r.label)) continue;
    // a word read off a schedule or a physical line ("Duty hours are scheduled…" → "scheduling") is not a skill to ask about
    // the unit a person reads is the posting's STATEMENT (lib/optimizer/statements.js): one question per statement (an
    // any-of line — "satellite operations or industrial automation" — is one ask, never two), only for a REQUIRED
    // requirement or duty line the résumé does not (fully) show
    const st = r.statementId && Array.isArray(statements) ? statements.find((x) => x.id === r.statementId) : null;
    if (st) {
      if (!['requirement', 'duty'].includes(st.kind)) continue;
      // a required line or a duty the posting lists ("Help with weekly inventory counts"), never a preferred extra
      if (st.importance && !['required', 'duty'].includes(st.importance)) continue;
      if (st.status && !['not_shown', 'partly'].includes(st.status)) continue;
      if (seen.has(`st:${st.id}`)) continue;
      seen.add(`st:${st.id}`);
    }
    const label = kind === 'tool' || kind === 'credential' ? r.label : shownLabel(r.label);
    const said = stmt(r);
    const head = label.split(/\s+/).slice(-1)[0].toLowerCase();
    const question = kind === 'credential' ? `Do you hold ${label}?`
      : kind === 'tool' ? `Have you used ${label}, and where — for what kind of work?`
      : kind === 'knowledge' ? `Do you know ${label}, and where have you applied ${/s$/.test(label) ? 'them' : 'it'}?`
      : /ing$/.test(head) ? `Have you done ${label} on the job — where, and how much of it?`
      : `Have you handled ${label} — where, and what did it involve?`;
    const asks = said ? `"${said}"` : label;
    const p = { id: `g_${out.length}_${key.replace(/[^a-z0-9]+/g, '_').slice(0, 30)}`, kind: 'gap', itemId: home.id, roleTitle: home.displayTitle || home.title, company: home.displayCompany || home.company, requirement: said || r.label, term: r.label, statement: said || null, statementId: r.statementId || null, label, answerKind: kind, unit: 'gap', question, why: `${who} ${r.importance === 'required' ? 'requires' : 'would like'} ${asks} and ${st && st.status === 'partly' ? `your lines show only part of it${Array.isArray(st.missing) && st.missing.length ? ` (not ${st.missing.slice(0, 2).join(' or ')})` : ''}` : 'none of your lines says it'} — answer only if it is true, and your words become a line under ${home.displayTitle || home.title || home.displayCompany || home.company}.` };
    p.template = answerPreview(p);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

// ── detail questions (round 6): a strong fit is asked about the ONE detail a listed duty names that the person's
// lines leave out ("keep ticket times under 6 minutes" ← no time on any line; "open or close" ← only a close shown;
// "weekly inventory counts" ← only the order shown). Each facet is a rule on the statement and on the résumé; the
// answer becomes one line in a fixed, honest shape (or the person's own verb-led words), never a guess.
const OPEN_RE = /\b(?:open(?:s|ed|ing|er|ers)?(?!\s+(?:to|ended|minded|door))|morning shift)\b/i;
const CLOSE_RE = /\b(?:clos(?:e|es|ed|ing|er|ers)|nightly|end[- ]of[- ](?:the[- ])?(?:night|day)|night shift|lock[- ]?up)\b/i;
const COUNT_HAS = /\b(?:inventory|stock|cycle)\s+counts?\b|\bcount(?:s|ed|ing)?\s+(?:the\s+)?(?:inventory|stock|product|back ?stock|cases|shelves|truck)\b|\btak(?:e|es|ing|en)\s+inventory\b/i;
const DETAIL_FACETS = [
  { id: 'service_time', asks: /\b(ticket|wait|service|drive[- ]?thru|hold|handle|response|turnaround)\s+times?\b|\bspeed of service\b/i,
    shown: (t) => /\d+(?:\.\d+)?\s*(?:sec(?:ond)?s?|min(?:ute)?s?)\b/i.test(t) },
  { id: 'open_close', asks: /\bopen(?:ing)?\s*(?:or|and|\/|&)\s*clos/i,
    shown: (t) => { const o = OPEN_RE.test(t), c = CLOSE_RE.test(t); return o === c; } },
  { id: 'inventory_count', asks: /\b(?:inventory|stock|cycle)\s+counts?\b|\bcount(?:s|ing)?\s+(?:the\s+)?(?:inventory|stock)\b|\btake inventory\b/i,
    shown: (t) => COUNT_HAS.test(t) },
  { id: 'online_orders', asks: /\b(?:online|delivery|third[- ]party|mobile|app)\b[^.;]{0,24}\borders?\b/i,
    shown: (t) => /\b(?:online|delivery|doordash|door dash|uber ?eats|grubhub|postmates|mobile orders?|app orders?|curbside|pick-?up orders?)\b/i.test(t) },
  { id: 'food_safety', asks: /\b(?:health code|health inspections?|inspection[- ]ready|food safety|temperature logs?|haccp)\b/i,
    shown: (t) => /\b(?:inspections?|temperature|temp logs?|haccp|food safety|line checks?|sanitiz\w*)\b/i.test(t) },
];
const DETAIL_PERIOD = /\b(daily|weekly|monthly|nightly|every (?:day|night|week|month|shift)|(?:once|twice) a (?:day|week|month)|each (?:week|month|shift))\b/i;
function detailVerb(p, base) { return p.tense === 'present' ? base : pastTense(base); }
function detailQuestionFor(f, st, ctx) {
  const at = ctx.company ? ` at ${ctx.company}` : '';
  if (f.id === 'service_time') {
    const m = st.match(f.asks);
    const w = (m && m[1] ? m[1].toLowerCase() : 'service');
    const noun = w === 'ticket' ? 'ticket times' : w === 'service' && /speed/i.test(m[0]) ? 'speed of service' : `${w} time${/times$/i.test(m[0]) ? 's' : ''}`;
    const asked = w === 'ticket' ? 'ticket or wait times' : noun;
    return { question: `Do you track ${asked}${at}? If so, what ${/s$/.test(asked) ? 'are they' : 'is it'}?`, noun, template: `${cap(detailVerb(ctx, 'keep'))} ${noun} [under N minutes].` };
  }
  if (f.id === 'open_close') {
    const closes = CLOSE_RE.test(ctx.text);
    return { question: closes ? 'Do you open as well as close?' : 'Do you close as well as open?', template: `${cap(detailVerb(ctx, 'run'))} both opening and closing shifts.` };
  }
  if (f.id === 'inventory_count') {
    // placing stock orders ("Weekly order for milk, cups and syrups"), never shipping customer orders ("Ship 1,800+ orders")
    const orders = /\b(?:place[sd]?|placing|weekly|daily|truck|supply|supplies|food|product|stock)\s+orders?\b|\border(?:s|ed|ing)?\s+(?:for|of)\s+(?!\d)/i.test(ctx.text);
    const cycle = /\bcycle counts?\b/i.test(st);
    // how often is the PERSON's to say: the posting's "weekly" is never put in their line
    const obj = cycle ? 'cycle counts' : 'inventory';
    const verb = cycle ? 'run' : 'count';
    return { question: cycle ? 'Do you run cycle counts? How often?' : orders ? 'Do you count inventory, or only place the order? How often?' : 'Do you count inventory? How often?', noun: obj, template: `${cap(detailVerb(ctx, verb))} ${obj} [how often].` };
  }
  if (f.id === 'online_orders') return { question: `Do you handle online, app or delivery orders${at}? Which ones?`, template: `${cap(detailVerb(ctx, 'handle'))} online and delivery orders ([which ones]).` };
  if (f.id === 'food_safety') return { question: 'Do you run food-safety or temperature checks on your shift?', template: `${cap(detailVerb(ctx, 'run'))} food-safety and temperature checks on shift.` };
  return null;
}
const ONLY_NO = /^(?:no|nope|not really|only\b|just\b|i only\b|i just\b)/i;
/** A detail question's answer → { line, problem }. */
export function composeDetailAnswer(p, raw) {
  const r = String(raw || '').trim();
  if (!r || NO_ANSWER_RE.test(r) || ONLY_NO.test(r)) return { line: '', problem: 'Then leave it — nothing is added, and your line already says what you do.' };
  const body = r.replace(/^(?:yes|yeah|yep|sure|i do|we do|correct)\b[,.!:;\s-]*/i, '').trim();
  const w0 = String(body.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z-]/g, '');
  // the person's own verb-led line is kept as written (their words, their tense)
  const FACET_WORD = { service_time: /\btimes?\b/i, open_close: /\b(?:open|clos)/i, inventory_count: /\b(?:inventor|stock)/i, online_orders: /\borders?\b/i, food_safety: /\b(?:safety|temp|inspect|checks?)\b/i };
  const ownVerb = p.facet !== 'service_time' && w0 && (KNOWN_VERBS.has(w0) || baseFromPast(w0, KNOWN_VERBS)) && body.split(/\s+/).length >= 3 && (!FACET_WORD[p.facet] || FACET_WORD[p.facet].test(body));
  if (ownVerb) return { line: `${collapseRepeats(cap(body)).replace(/[.;,\s]+$/, '')}.`, problem: null };
  const V = (b) => cap(detailVerb(p, b));
  if (p.facet === 'service_time') {
    const d = body.match(/(?:(under|below|less than|about|around|roughly|averag\w*|at)\s+)?(\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?)\s*(sec(?:ond)?s?|min(?:ute)?s?)\b/i);
    if (!d) return { line: '', problem: 'Type the time — for example "under 5 minutes" or "about 3 minutes".' };
    const unit = /^s/i.test(d[3]) ? 'seconds' : 'minutes';
    const q = (d[1] || '').toLowerCase();
    const lead = /^(?:under|below|less than)$/.test(q) ? 'under' : /^(?:about|around|roughly)$/.test(q) || /^averag/.test(q) ? 'around' : 'at';
    const ownNoun = (body.match(/\b(ticket|wait|drive[- ]?thru|window|handle|hold|response)\s+times?\b/i) || [])[0];
    return { line: `${V('keep')} ${(ownNoun || p.noun || 'service times').toLowerCase()} ${lead} ${d[2]} ${unit}.`, problem: null };
  }
  if (p.facet === 'open_close') return { line: `${V('run')} both opening and closing shifts.`, problem: null };
  if (p.facet === 'inventory_count') {
    const per = ((body.match(DETAIL_PERIOD) || [])[1] || '').toLowerCase();
    if (!per) return { line: '', problem: 'Say how often — for example "weekly" or "every month".' };
    return p.noun === 'cycle counts' ? { line: `${V('run')} cycle counts ${per}.`, problem: null } : { line: `${V('count')} inventory ${per}.`, problem: null };
  }
  if (p.facet === 'online_orders') {
    const names = body.replace(/^(?:we\s+use|we\s+do|through|on|via|with|from)\s+/i, '').replace(/[.;\s]+$/, '').trim();
    const list = names && names.split(/\s+/).length <= 8 && !/\b(?:not|never|don'?t)\b/i.test(names) ? names : '';
    return { line: `${V('handle')} online and delivery orders${list ? ` (${list})` : ''}.`, problem: null };
  }
  if (p.facet === 'food_safety') return { line: `${V('run')} food-safety and temperature checks on shift.`, problem: null };
  return { line: '', problem: 'Start with what you did, in your own words.' };
}
/**
 * Detail questions for a strong page: one per listed duty or requirement whose detail the person's lines leave out,
 * placed under the role that shows the rest of it (else the latest role). Never a bare re-ask of what a line shows.
 */
export function detailQuestions(base, statements, { company = '', max = 3 } = {}) {
  if (!Array.isArray(statements) || !base || !Array.isArray(base.experience)) return [];
  const roles = base.experience.filter((e) => !isGapNote(e) && e.company);
  if (!roles.length) return [];
  const text = [base.basics && base.basics.summary, ...roles.flatMap((e) => [e.title, ...(e.bullets || []).map((b) => b.text)]), ...(base.skills || []).flatMap((g) => g.items || [])].filter(Boolean).join('\n');
  const out = [];
  const used = new Set();
  for (const st of statements) {
    if (!st || st.display === false || !['duty', 'requirement'].includes(st.kind)) continue;
    if (!['shown', 'partly', 'not_shown'].includes(st.status)) continue;
    for (const f of DETAIL_FACETS) {
      if (used.has(f.id) || !f.asks.test(st.text || '')) continue;
      if (f.shown(text)) continue;
      // where the rest of the statement already sits: that role; else the latest role
      const evLine = Array.isArray(st.evidence) ? (st.evidence[0] && st.evidence[0].line) : st.evidence;
      // the detail is asked about the work they do now: the role holding the rest of the statement when it is current,
      // else the latest role (a 2018 front-desk line is no place to ask about handle times at today's job)
      const evRole = roles.find((e) => evLine && (e.bullets || []).some((b) => cleanLine(b.text) === cleanLine(evLine)));
      const isCurrent = (e) => !!e && (!e.end || /present|current|now/i.test(String(e.end)));
      const home = evRole && (evRole === roles[0] || isCurrent(evRole)) ? evRole : roles[0];
      const current = !home.end || /present|current|now/i.test(String(home.end));
      const firstWord = String(((home.bullets || [])[0] || {}).text || '').split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
      const tense = current && KNOWN_VERBS.has(firstWord) && !baseFromPast(firstWord, KNOWN_VERBS) ? 'present' : 'past';
      const where = home.displayCompany || home.company;
      const q = detailQuestionFor(f, st.text, { company: where, text, tense });
      if (!q) continue;
      used.add(f.id);
      out.push({ id: `d_${out.length}_${f.id}`, kind: 'detail', facet: f.id, tense, itemId: home.id, roleTitle: home.displayTitle || home.title, company: where, requirement: st.text, statement: st.text, statementId: st.id || null, term: st.text, label: st.text, answerKind: 'detail', unit: 'detail', question: q.question, noun: q.noun || '', period: q.period || '', template: q.template,
        why: `${company ? `${cap(company)} lists` : 'The posting lists'} "${st.text}". Your lines show ${st.status === 'shown' ? 'the work' : 'part of it'}, but not this detail — answer only if it is true, and it becomes a line under ${home.displayTitle || home.title || where}.` });
      break;
    }
    if (out.length >= max) break;
  }
  return out;
}

// "200+ transactions per shift" answers "customers or calls per shift": the role already states a number
// in this measure (its own noun, or the same rate), or a score for a score question.
export function roleStatesMeasure(unit, text) {
  const t = String(text || '');
  const esc = (w) => escapeRegExp(w);
  const nouns = String(unit || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !/^(?:per|and|the|for|with|from|each|every|your|day|days|week|weeks|month|months|year|years|shift|shifts|hour|hours|period|time|rate|total|measure|improvement|growth|size|completed|handled|taught|delivered)$/.test(w));
  if (nouns.some((n) => new RegExp(`\\d[\\d,.]*\\+?%?\\s*(?:-\\s*\\d+\\s*)?(?:[A-Za-z-]+\\s+){0,3}${esc(n.replace(/(?:es|s)$/, ''))}`, 'i').test(t))) return true;
  const per = String(unit || '').match(/\bper\s+(shift|day|week|month|hour|year)\b/i);
  if (per && new RegExp(`\\d[\\d,.]*\\+?\\s*(?:-\\s*\\d+\\s*)?(?:[A-Za-z-]+\\s+){0,4}(?:per|a|an|each)\\s+${escapeRegExp(per[1])}`, 'i').test(t)) return true;
  if (/\b(?:rating|satisfaction|accuracy|quality|attainment|rate)\b/i.test(unit) && /\b\d(?:\.\d)?\s*\/\s*5\b|\b\d{2,3}(?:\.\d)?%/.test(t)) return true;
  if (/\bunit\b/i.test(t) && /patients/.test(unit) && /\d+[- ]bed\b/i.test(t) && /\d+\s*(?:-\s*\d+\s*)?(?:\w+\s+){0,2}patients/i.test(t)) return true;
  return false;
}

// Where a number goes in the person's own line: before the counted noun after the verb ("Reconcile balance sheet
// accounts monthly" → "Reconcile [number] balance sheet accounts monthly"), else after the line.
const DET = /^(?:the|a|an|all|our|their|my|its|every|each)$/i;
// the objects a recruiter reads a number for: patients and beds, calls / tickets / orders, accounts and invoices, people led or
// trained, sites and stores, shipments, cases — never "medications", "phones", "documents"
const MEASURE_NOUN = /^(?:counts|patients|beds|residents|clients|customers|guests|members|students|calls|tickets|orders|requests|claims|cases|accounts|invoices|entities|vendors|suppliers|employees|staff|hires|associates|cashiers|cooks|baristas|servers|drivers|technicians|nurses|agents|reps|representatives|interns|volunteers|direct reports|reports|stores|locations|sites|branches|units|properties|projects|events|shipments|trucks|trailers|pallets|transactions|deals|campaigns|reconciliations|audits|inspections|installations|jobs|homes|buildings|classes|courses|workshops|sessions|users|services)$/i;
export function numberSlot(text) {
  const t = cleanLine(text).replace(/[.;,\s]+$/, '');
  const w = t.split(/\s+/);
  const v = (w[0] || '').toLowerCase().replace(/[^a-z-]/g, '');
  const isVerb = KNOWN_VERBS.has(v) || !!baseFromPast(v, KNOWN_VERBS);
  if (isVerb) {
    let i = 1;
    while (i < w.length && DET.test(w[i])) i++;
    for (let k = i; k < Math.min(w.length, i + 3); k++) {
      const word = w[k].replace(/[^A-Za-z-]/g, '');
      if (!word || /[,;:()]/.test(w[k].slice(0, -1))) break;
      if (MEASURE_NOUN.test(word) && !w.slice(i, k + 1).some((x) => /-/.test(x))) {
        const noun = w.slice(i, k + 1).join(' ').replace(/[^A-Za-z\s/&-]/g, '').trim();
        const before = w.slice(0, i).join(' '), nounWords = w.slice(i, k + 1).join(' '), after = w.slice(k + 1).join(' ');
        // a line that already says how often ("monthly", "per shift", "each week") takes a bare number; otherwise the
        // answer must say per what ("25 cycle counts a week")
        const hasPeriod = /\b(?:daily|weekly|monthly|quarterly|annually|yearly|nightly|per\s+\w+|a\s+(?:day|week|month|year|shift|night)|each\s+(?:day|week|month|year|shift|night)|every\s+\w+)\b/i.test(w.slice(k + 1, k + 5).join(" "));
        // a count of people (cooks, staff, hires, direct reports) or of places is a size, not a rate: no period asked
        const isSize = /^(?:employees|staff|hires|associates|cashiers|cooks|baristas|servers|drivers|technicians|nurses|agents|reps|representatives|interns|volunteers|reports|stores|locations|sites|branches|units|properties|entities|vendors|suppliers|accounts|beds|students|members|users|buildings|homes)$/i.test(word);
        return { mode: 'insert', noun, before, nounWords, after, needsPeriod: !hasPeriod && !isSize, template: [before, '[number]', nounWords, hasPeriod || isSize ? '' : '[a shift / a week / a month]', after].filter(Boolean).join(' ') };
      }
    }
  }
  // no known measure fits the line's object ("medications", "multi-line phones"): no question (round 3)
  return null;
}
const hasNumber = (t) => /\d/.test(String(t || '').replace(/\b(?:19|20)\d{2}\b/g, '')) || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|dozen|hundred|thousand)\b/i.test(String(t || ''));

/**
 * Number questions, aimed at ONE line (round 2): a line (a) in the current or the most relevant role, (b) that proves a
 * REQUIRED requirement, (c) with no number while no other line on that requirement has one either. The result is THAT
 * line with the number placed in it, shown in full; the why names the line. No such line → nothing is asked.
 */
export function numberQuestions(base, verdict, decisions, scoredRoles, { company = '', statements = null, max = 2 } = {}) {
  const roles = base.experience.filter((e) => !isGapNote(e) && e.company && isRegularRoleLike(e));
  const current = roles.filter((e) => e.end === 'present' || (!e.end && e.start));
  const relevant = [...roles].sort((a, b) => (verdict.roleWeight.get(b.id) || 0) - (verdict.roleWeight.get(a.id) || 0))[0];
  const pool = [...new Set([...current, relevant].filter(Boolean))].filter((e) => (verdict.roleWeight.get(e.id) || 0) > 0);
  const allBullets = base.experience.flatMap((e) => e.bullets);
  const prompts = [];
  // dates for a role that matters to this posting and has none: a recruiter cannot place it without them
  for (const e of roles) {
    if (prompts.length >= 1) break;
    if (!((verdict.roleWeight.get(e.id) || 0) > 0 || (decisions || []).some((d) => d.itemId === e.id && ['core', 'supporting'].includes(d.tier)))) continue;
    if (e.start || e.end || e.dateText) continue;
    prompts.push({ id: `p_${e.id}_dates`, itemId: e.id, roleTitle: e.displayTitle || e.title, company: e.displayCompany || e.company, kind: 'dates', question: `When did you work at ${e.displayCompany || e.company}? (e.g. "Jun 2021 – Mar 2023")`, unit: 'dates', template: 'The dates you give are printed next to the role.', why: `Your ${e.displayCompany || e.company} role is one of the most relevant to this posting but has no dates, so a recruiter cannot place it.` });
  }
  const who = company ? company.charAt(0).toUpperCase() + company.slice(1) : 'This employer';
  for (const e of pool) {
    for (const b of e.bullets) {
      if (prompts.filter((x) => x.kind === 'metric').length >= max) break;
      const reqs = (verdict.bulletReqs.get(b.id) || []).filter((r) => !r.soft && !r.inferred && r.via !== 'related' && r.importance === 'required');
      if (!reqs.length || hasNumber(b.text)) continue;
      const r = reqs[0];
      // a sibling line that proves the same requirement and already carries a number answers it
      if (allBullets.some((x) => x.id !== b.id && hasNumber(x.text) && (verdict.bulletReqs.get(x.id) || []).some((y) => y.label === r.label))) continue;
      if (prompts.some((p) => p.requirement === r.label)) continue;
      const slot = numberSlot(b.text);
      if (!slot) continue;
      const st0 = r.statementId && Array.isArray(statements) ? (statements.find((x) => x.id === r.statementId) || {}).text : '';
      // the statement only when it reads as what this line shows (short, and sharing the line's words); else the term
      const st = st0 && st0.split(/\s+/).length <= 10 && contentStemsQ(st0).filter((x) => contentStemsQ(b.text).includes(x)).length >= 1 ? st0 : '';
      const line = cleanLine(b.text).replace(/[.;,\s]+$/, '');
      // cut at a word, never inside a parenthesis
      let short = line;
      if (line.length > 70) { let c = line.slice(0, 70).replace(/\s+\S*$/, ''); const o = c.lastIndexOf('('); if (o > c.lastIndexOf(')')) c = c.slice(0, o).trimEnd(); short = `${c.replace(/[,;:\s]+$/, '')}…`; }
      const question = `How many ${slot.noun.toLowerCase()}${slot.needsPeriod ? ', and per what (a shift, a week, a month)' : ''} — in your line "${short}"?`;
      const p = { id: `n_${b.id}`, kind: 'metric', answerKind: 'number', label: r.label, term: r.label, itemId: e.id, bulletId: b.id, roleTitle: e.displayTitle || e.title, company: e.displayCompany || e.company, unit: 'line', line, slot: slot.mode, before: slot.before, nounWords: slot.nounWords, after: slot.after, needsPeriod: slot.needsPeriod, question, template: slot.template, requirement: st || r.label, why: `Your line "${short}" shows ${st ? `"${st}"` : r.label}, which ${who} requires, but no line of yours puts a number on it. If you know one you can defend, it goes into this line exactly where shown.` };
      prompts.push(p);
    }
  }
  return prompts;
}
const contentStemsQ = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map((w) => w.replace(/(?:ing|ed|es|s)$/, '').slice(0, 6));
const isRegularRoleLike = (e) => !/\b(?:intern|internship|part[- ]?time|seasonal|temporary|volunteer|summer)\b/i.test(`${e.title || ''} ${e.employmentType || ''}`);

export { pastTense };
