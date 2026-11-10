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
  if (p.kind === 'gap') { const line = gapLine({ ...p, _raw: raw }, stripFiller(raw)); return line ? (p.answerKind === 'credential' ? line : `${line}.`) : ''; }
  if (p.unit === 'line' && p.template) {
    // the person's own line with their number placed in it; no number in the answer → asked again
    const a = stripFiller(raw);
    if (!/\d/.test(a)) return '';
    if (p.slot === 'insert') { const m = a.match(/(?:about|around|over|more than|nearly|up to|~)?\s*\$?\d[\d,.]*\s*(?:k|m)?\+?(?:\s*(?:-|–|to)\s*\d[\d,.]*\+?)?/i); return m ? `${p.template.replace('[number]', m[0].trim())}.`.replace(/\.\.$/, '.') : ''; }
    return `${p.template.replace(/,\s*\[the number[^\]]*\]$/, '')}, ${a.replace(/[.\s]+$/, '')}.`;
  }
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
      if (st.importance && st.importance !== 'required') continue;
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
      if (/[a-z]s$/i.test(word) && !/ss$/i.test(word) && !KNOWN_VERBS.has(word.toLowerCase()) && !/^(?:sales|logistics|operations|analytics|payroll)$/i.test(word) && !w.slice(i, k + 1).some((x) => /-/.test(x))) {
        const noun = w.slice(i, k + 1).join(' ').replace(/[^A-Za-z\s/&-]/g, '').trim();
        return { mode: 'insert', noun, template: [...w.slice(0, i), '[number]', ...w.slice(i)].join(' ') };
      }
    }
  }
  // a list line ("Answered phones, greeted visitors, sorted mail") has no single place a number belongs: not asked
  if (/[,;]/.test(t)) return null;
  return { mode: 'append', noun: '', template: `${t}, [the number — how many, how much or how often]` };
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
      const short = line.length > 70 ? `${line.slice(0, 70).replace(/\s+\S*$/, '')}…` : line;
      const question = slot.mode === 'insert' ? `How many ${slot.noun.toLowerCase()} — in your line "${short}"?` : `What number goes with your line "${short}" — how many, how much or how often?`;
      const p = { id: `n_${b.id}`, kind: 'metric', itemId: e.id, bulletId: b.id, roleTitle: e.displayTitle || e.title, company: e.displayCompany || e.company, unit: 'line', line, slot: slot.mode, question, template: slot.template, requirement: st || r.label, why: `Your line "${short}" shows ${st ? `"${st}"` : r.label}, which ${who} requires, but no line of yours puts a number on it. If you know one you can defend, it goes into this line exactly where shown.` };
      prompts.push(p);
    }
  }
  return prompts;
}
const contentStemsQ = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map((w) => w.replace(/(?:ing|ed|es|s)$/, '').slice(0, 6));
const isRegularRoleLike = (e) => !/\b(?:intern|internship|part[- ]?time|seasonal|temporary|volunteer|summer)\b/i.test(`${e.title || ''} ${e.employmentType || ''}`);

export { pastTense };
