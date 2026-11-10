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
import { ROLE_FAMILIES, GENERAL_FAMILY } from '../../application-intelligence/roleOntology.js';
import { resolveConcept } from '../../resume-intelligence/taxonomy.js';
import { findMetrics } from '../health/bullet.js';
import { KNOWN_VERBS } from '../health/verbs.js';
import { baseFromPast, baseFromGerund, pastTense } from '../rewrite/inflect.js';
import { credentialHeld } from '../../optimizer/credentials.js';
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
  rest = rest.replace(new RegExp(`^${t.noun}\\b`, 'i'), '').trim();
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

// gap templates: the posting's own label + the person's answer in one slot
const GAP_TEMPLATES = {
  tool: { verb: 'Used', prep: 'to', slot: (where) => `what you used it for${where ? ` at ${where}` : ''}` },
  activity: { verb: 'Performed', prep: 'for', slot: (where) => `what or whom${where ? ` at ${where}` : ''}` },
  knowledge: { verb: 'Applied', prep: 'in', slot: (where) => `which work${where ? ` at ${where}` : ''}` },
};
// "Handled merchandising / opening and closing" reads as said aloud; "Performed head-to-toe assessments / insurance
// verification" for the -tion/-ment/-sis kind; never "Handled cash handling"
const verbFor = (kind, label) => (kind !== 'activity' ? (GAP_TEMPLATES[kind] || GAP_TEMPLATES.activity).verb : /ing\b/i.test(label) && !/handling/i.test(label) ? 'Handled' : 'Performed');
const ANSWER_PREP_RE = /^(to|for|at|in|on|with|across|during|while|as|through)\s+/i;

function gapLine(prompt, a) {
  const label = prompt.label || prompt.requirement || '';
  if (prompt.answerKind === 'credential') return /^(?:yes|yeah|yep|y|i do|i have|i hold)\b/i.test(String(prompt._raw || a)) ? label : '';
  const t = GAP_TEMPLATES[prompt.answerKind] || GAP_TEMPLATES.activity;
  let body = a.trim();
  let prep = t.prep;
  const pm = body.match(ANSWER_PREP_RE);
  if (pm) { prep = pm[1].toLowerCase(); body = body.slice(pm[0].length).trim(); } // the person's own preposition wins
  const [w0, ...more] = body.split(/\s+/);
  const w = String(w0 || '').toLowerCase();
  const verbBase = KNOWN_VERBS.has(w) ? w : (baseFromPast(w, KNOWN_VERBS) || baseFromGerund(w, KNOWN_VERBS));
  if (verbBase && !pm) {
    // "tracking appointments" → "Used Dentrix to track appointments"; an activity answered with a verb has no slot
    if (prompt.answerKind !== 'tool') return '';
    prep = 'to'; body = [verbBase, ...more].join(' ');
  } else if (prep === 'to' && !verbBase) prep = 'for'; // "Used Dentrix to a 6-dentist practice" → "for"
  // an answer that only repeats the requirement adds nothing ("Performed insurance billing for insurance billing")
  if (!body || body.split(/\s+/).length < 2 || stemsCovered(body, label)) return '';
  return collapseRepeats(`${verbFor(prompt.answerKind, label)} ${label} ${prep} ${body}`);
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
    if (prompt.answerKind === 'credential') return `${prompt.label} — added under Certifications when you answer yes.`;
    const t = GAP_TEMPLATES[prompt.answerKind] || GAP_TEMPLATES.activity;
    return `${verbFor(prompt.answerKind, prompt.label)} ${prompt.label} ${t.prep} [${t.slot(prompt.company)}].`;
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
export function gapQuestions(base, verdict, { max = 5, company = '' } = {}) {
  const resumeText = [base.basics.summary || '', base.basics.headline || '', ...base.experience.flatMap((e) => [e.title, e.company, e.summary || '', ...e.bullets.map((b) => b.text)]), ...base.skills.flatMap((g) => g.items), ...base.certifications.map((c) => c.text || c.name || ''), ...base.education.map((e) => [e.degree, e.field, e.institution].filter(Boolean).join(' '))].map(cleanLine).filter(Boolean).join('\n');
  const roles = base.experience.filter((e) => !isGapNote(e) && e.company);
  if (!roles.length) return [];
  // where it most plausibly happened: the most recent role that proves anything the posting asks for (the
  // person's own order), else their first role — HIPAA is asked about the dental office, not the 2011 logistics job
  const home = roles.find((e) => (verdict.roleWeight.get(e.id) || 0) > 0) || roles[0];
  const rows = [...verdict.unmet].filter((r) => askableGap(r, resumeText)).sort((a, b) => b.weight - a.weight);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = r.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = answerKindOf(r.label);
    if (!kind) continue;
    if (kind === 'credential' && credentialHeld(resumeText, r.label)) continue;
    const label = kind === 'tool' || kind === 'credential' ? r.label : shownLabel(r.label);
    const asks = r.importance === 'required' ? 'asks for' : 'would like';
    const who = company ? company.charAt(0).toUpperCase() + company.slice(1) : '';
    const question = kind === 'credential' ? `${who ? `${who} ${asks}` : `The posting ${asks}`} ${label}. Do you hold it?`
      : kind === 'tool' ? `${who ? `${who} ${asks}` : `The posting ${asks}`} ${label}. Did you use it at ${home.company} or anywhere else? If so, what for?`
      : kind === 'knowledge' ? `${who ? `${who} ${asks}` : `The posting ${asks}`} ${label}. Did you work with it at ${home.company} or anywhere else? If so, in what work?`
      : `${who ? `${who} ${asks}` : `The posting ${asks}`} ${label}. Did you do this at ${home.company} or anywhere else? If so, for what or whom?`;
    const p = { id: `g_${out.length}_${key.replace(/[^a-z0-9]+/g, '_').slice(0, 30)}`, kind: 'gap', itemId: home.id, roleTitle: home.title, company: home.company, requirement: r.label, label, answerKind: kind, unit: 'gap', question, why: `No line on your résumé shows ${label}. If it is true, your answer becomes a line under ${home.title || home.company}; if not, leave it — nothing is added.` };
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
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nouns = String(unit || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !/^(?:per|and|the|for|with|from|each|every|your|day|days|week|weeks|month|months|year|years|shift|shifts|hour|hours|period|time|rate|total|measure|improvement|growth|size|completed|handled|taught|delivered)$/.test(w));
  if (nouns.some((n) => new RegExp(`\\d[\\d,.]*\\+?%?\\s*(?:-\\s*\\d+\\s*)?(?:[A-Za-z-]+\\s+){0,3}${esc(n.replace(/(?:es|s)$/, ''))}`, 'i').test(t))) return true;
  const per = String(unit || '').match(/\bper\s+(shift|day|week|month|hour|year)\b/i);
  if (per && new RegExp(`\\d[\\d,.]*\\+?\\s*(?:-\\s*\\d+\\s*)?(?:[A-Za-z-]+\\s+){0,4}(?:per|a|an|each)\\s+${per[1]}`, 'i').test(t)) return true;
  if (/\b(?:rating|satisfaction|accuracy|quality|attainment|rate)\b/i.test(unit) && /\b\d(?:\.\d)?\s*\/\s*5\b|\b\d{2,3}(?:\.\d)?%/.test(t)) return true;
  if (/\bunit\b/i.test(t) && /patients/.test(unit) && /\d+[- ]bed\b/i.test(t) && /\d+\s*(?:-\s*\d+\s*)?(?:\w+\s+){0,2}patients/i.test(t)) return true;
  return false;
}

/**
 * Number questions for the roles that matter (the verdict's evidence decides which) — at most two roles,
 * never a role with no company, never a gap note, never a measure the role already states.
 */
export function numberQuestions(base, verdict, decisions, scoredRoles, { maxRoles = 2 } = {}) {
  const prompts = [];
  // the most recent roles that prove something the posting asks for, in the person's own order
  const idx = (d) => base.experience.findIndex((e) => e.id === d.itemId);
  const order = [...decisions].filter((d) => d.decision === 'keep' || d.decision === 'trim').sort((a, b) => ((verdict.roleWeight.get(b.itemId) || 0) > 0) - ((verdict.roleWeight.get(a.itemId) || 0) > 0) || idx(a) - idx(b));
  let roles = 0;
  for (const d of order) {
    if (roles >= maxRoles) break;
    const e = base.experience.find((x) => x.id === d.itemId);
    const role = (scoredRoles || []).find((r) => r.itemId === d.itemId);
    if (!e || !role || isGapNote(e) || !e.company) continue;
    if (!(verdict.roleWeight.get(e.id) > 0) && !['core', 'supporting'].includes(d.tier)) continue;
    const text = [e.title, ...e.bullets.map((b) => b.text)].join('\n');
    const metricBullets = e.bullets.filter((b) => findMetrics(b.text).length).length;
    if (e.bullets.length >= 3 && metricBullets >= 2) continue; // already measured
    let added = 0;
    if (!e.start && !e.end && !e.dateText) { prompts.push({ id: `p_${d.itemId}_dates`, itemId: d.itemId, roleTitle: e.title, company: e.company, kind: 'dates', question: 'When did you work here? (e.g. "Jun 2021 – Mar 2023")', unit: 'dates', template: 'The dates you give are printed next to the role.', why: 'Dates let a recruiter place this role — without them the most relevant job on the page looks unverified.' }); added++; }
    const fam = role.family === 'general' ? GENERAL_FAMILY : (ROLE_FAMILIES[role.family] || GENERAL_FAMILY);
    for (const [i, m] of (fam.metrics || []).slice(0, 2).entries()) {
      if (!ANSWER_TEMPLATES[m.unit] || roleStatesMeasure(m.unit, text)) continue;
      if (ANSWER_TEMPLATES[m.unit].kind === 'statement' && metricBullets > 0) continue; // the role already shows a measured result
      const p = { id: `p_${d.itemId}_${i}`, itemId: d.itemId, roleTitle: e.title, company: e.company, kind: 'metric', question: m.q, unit: m.unit, why: e.bullets.length ? 'A real number here makes this role your strongest evidence.' : 'This role matters for this posting but has no bullets yet — one true number makes it count.' };
      p.template = answerPreview(p);
      p.answerHint = ANSWER_HINT[ANSWER_TEMPLATES[m.unit].kind];
      prompts.push(p); added++;
    }
    if (added) roles++;
  }
  return prompts;
}

export { pastTense };
