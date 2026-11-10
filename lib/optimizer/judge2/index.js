// judge2 — a clean-room second statement judge. For each requirement statement, against each résumé line:
//   read both into units (reading.js), match unit to unit through knowledge (match.js), weigh matches by how specific
//   the words are (idf.js), and decide from STRUCTURE with thresholds set once (THRESHOLDS below):
//     SHOWN       a doing line does the statement's action on its object
//     PARTLY      the action matches on a doing line and the object is narrower / absent, or the object is there and the
//                 action is weaker — the missing part named in the statement's own words
//     NOT SHOWN   no line does that kind of thing
//     CANNOT TELL what a résumé does not state (schedule, physical ability, work eligibility, attitude), unless a line
//                 plainly shows it
// Gate statements (years, degree, licence, certification, language) keep the gate's own grade and sentence.
// Same input and output shape as lib/optimizer/statements.js statementVerdicts; runOptimizer takes it through
// `options.statementJudge`.
import { occupationOf, relation } from '../../occupations/index.js';
import { relateActivities } from '../../occupations/activities.js';
import { fieldsOf } from '../../text/tradeTalk.js';
import { escapeRegExp } from '../../text/escapeRegExp.js';
import { readResume } from './resume.js';
import { readStatement, surfaceTokens } from './reading.js';
import { readLine, unitOnLine, tradeOnLine, pairContext } from './match.js';
import { whyOf, verbStart, spanOf, allOnResume, dedupeItems } from './phrase.js';
import { formsOf } from './reading.js';

/**
 * Thresholds — set once on the shared sets, then frozen. Each is a statement about evidence, not about an example:
 *  STRONG       a unit is "matched" at this strength or above (exact or close knowledge, never a family guess)
 *  SHOWN_COV    the share of the statement's specificity-weighted head the line must hold for SHOWN
 *  SPEC_SHOWN   SHOWN needs the matched words to carry at least this much specificity together (generic words alone
 *               never show a duty)
 *  SPEC_PARTLY  PARTLY needs at least this much
 *  PARTLY_COV   or this share of the weighted head
 *  OWN_FLOOR    under a role of the posting's own occupation a generic word weighs at least this much (it means the
 *               posting's thing there: "run the shift" in a shift supervisor's line)
 *  CROSS_SPEC   on a known different field, a credited match needs a word at least this specific
 */
export const THRESHOLDS = Object.freeze({ STRONG: 0.8, SHOWN_COV: 0.6, SPEC_SHOWN: 0.25, SPEC_PARTLY: 0.3, PARTLY_COV: 0.5, OWN_FLOOR: 0.3, CROSS_SPEC: 0.5 });

const GATE_KINDS = new Set(['degree', 'years', 'certification', 'management', 'seniority', 'licence', 'license', 'language', 'gpa']);
const CONSTRAINT_WORDS = {
  years: /\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\(\d+\)\s+)?years?\b/i,
  degree: /\b(?:degree|diploma|ged|bachelor|associate|master|ph\.?d|doctorate|mba|b\.?s\.?|b\.?a\.?|m\.?s\.?|md|do|high\s+school|graduate|equivalen)/i,
  management: /\b(?:manag|supervis|lead|direct\s+reports|people)/i,
  seniority: /\b(?:senior|lead|principal|staff|years?|manag|supervis)/i,
};
// what a résumé does not state and no recruiter expects it to (classes of statement, by their words)
const ELIGIBILITY_RE = /\b(?:authori[sz]ed\s+to\s+work|work\s+authori[sz]ation|eligib\w*\s+to\s+work|legally\s+(?:able|eligible)|sponsorship|visa|u\.?s\.?\s+citizen\w*|citizenship|background\s+(?:check|screen\w*|investigation)|drug\s+(?:test\w*|screen\w*)|criminal|at\s+least\s+1[68]|1[68]\s+years\s+(?:of\s+age|or\s+older|old)|years\s+of\s+age|reliable\s+(?:transportation|vehicle)|own\s+(?:vehicle|transportation|car)|access\s+to\s+(?:a\s+)?(?:vehicle|car|computer|internet)|immuniz\w*|vaccin\w*|tb\s+test|pre-?employment)\b/i;
const SCHEDULE_RE = /\b(?:nights?|evenings?|weekends?|holidays?|overtime|on-?call|rotating|flexible\s+(?:schedule|hours)|schedule\s+flexibility|availability|available\s+(?:to\s+work|for)|full-?time|part-?time|hours\s+(?:per|a)\s+week|\d+\s*(?:-|–|to)\s*\d+\s*hours|shifts?\s+(?:including|as\s+needed)|travel(?:ing)?\s+(?:up\s+to|\d|required|as\s+needed|to)|overnight|work\s+(?:any|all)\s+shifts?)\b/i;
const PHYSICAL_RE = /\b\d+\s*(?:lbs?|pounds|kg)\b|\b(?:stand|standing|walk|walking|sit|sitting)\s+(?:for|up\s+to|throughout|during|the\s+(?:entire|whole|full))|\bon\s+(?:your|their|one's)\s+feet\b|\bphysical(?:ly)?\b|\b(?:bend|bending|stoop|stooping|kneel|kneeling|crouch|crouching|twist|twisting|climb|climbing|squat|squatting|lift|lifting|reach|reaching|grasp|grasping)\b|\b(?:hot|cold|wet|noisy|loud|dusty)\s+(?:environments?|conditions?)|\b(?:temperatures?|freezer|cooler)\b/i;
const LOCATION_RE = /\bcurrently\s+(?:in|located|based|living|residing)\b|\b(?:from|at|in)\s+our\s+(?:office|offices|headquarters|hq|location|site|campus)\b|\b(?:located\s+(?:in|within|near)|based\s+(?:in|out\s+of)|resid\w*\s+(?:in|within)|live\s+(?:in|within|near)|commut\w*|relocat\w*|within\s+\d+\s+miles)\b|\b(?:on-?site|onsite|hybrid|in\s+(?:the\s+)?office)\b(?=[^.]*\b(?:role|position|job|days?|week|schedule|work(?:s|ing)?\s+(?:from|in|at)|required|requirement)\b)/i;
const COMPLY_RE = /^(?:follow|follows|following|adhere|adheres|comply|complies|abide|abides|observe|observes|uphold|upholds|maintain\s+compliance|ensure\s+compliance)\b/i;
// the employer's OWN rules (a résumé never states that someone follows a future employer's policies)
const RULE_OBJ_RE = /\b(?:our|company|company's|employer's|organizational|organization's|departmental|facility|store|site|location)\s+(?:\w+\s+){0,2}(?:polic\w*|procedures?|guidelines?|rules?|standards?|protocols?|expectations?)\b|\bcode\s+of\s+conduct\b|\bpolicies\b/i;
// a SETTING a role is in, named by the words of a requirement ("experience in a healthcare environment", "previous
// retail experience"), and the trade-talk field keys whose occupations work in it
const SETTINGS = [
  [/\b(?:health\s*care|hospital|clinic(?:al)?|medical|patient\s+care|post-acute|home\s+health|long-term\s+care|nursing\s+home)\b/i, ['healthcare', 'nursing']],
  [/\b(?:restaurant|food\s+service|kitchen|coffee\s+shop|cafe|café|hospitality|quick[-\s]service|fast\s+food|dining|catering)\b/i, ['food']],
  [/\b(?:retail|store|grocery|merchandising)\b/i, ['retail', 'sales']],
  [/\b(?:warehouse|distribution|logistics|fulfillment|supply\s+chain)\b/i, ['warehouse']],
  [/\b(?:call\s+cent(?:er|re)|contact\s+cent(?:er|re)|customer\s+(?:service|support|care))\b/i, ['support', 'retail', 'food']],
  [/\b(?:office|administrative|clerical|front\s+desk)\b/i, ['office']],
  [/\b(?:construction|job\s*site)\b/i, ['construction', 'trades']],
  [/\b(?:classroom|school|k-12|education(?:al)?|teaching)\b/i, ['k12']],
  [/\b(?:sales|selling)\b/i, ['sales', 'retail']],
  [/\b(?:accounting|bookkeeping|finance)\b/i, ['accounting']],
  [/\b(?:software|engineering\s+team|tech(?:nology)?\s+(?:company|industry))\b/i, ['software']],
];
const BASIC_RE = /\b(?:read(?:ing)?|writ(?:e|ing)|speak(?:ing)?|understand(?:ing)?)\b[^.]{0,40}\b(?:english|instructions|directions)\b|\bfollow\w*\s+(?:(?:written|oral|verbal|simple|basic)\s+)?(?:(?:and|or)\s+(?:written|oral|verbal)\s+)?(?:instructions|directions)\b|\bbasic\s+(?:math|arithmetic|computer)\b|\bcount\s+(?:change|money)\b|\bcomputer\s+literate\b/i;
// character and soft-skill words: a statement LED by one with nothing specific beside it is the person's to say
const TRAIT_WORDS = new Set(('detail detailed oriented organized organizational reliable reliability dependable dependability punctual punctuality motivated motivation self starter positive attitude team player teamwork communication communicator communicate interpersonal friendly courteous professional professionalism flexible flexibility adaptable adaptability multitask multitasking prioritize time management fast paced independently independent initiative integrity honest honesty ethic ethics passion passionate enthusiastic enthusiasm energetic calm patient patience empathetic empathy compassionate compassion problem solving critical thinking judgment judgement accountable accountability ownership curious curiosity creative creativity collaborative collaboration customer focused results driven urgency hard working hardworking eager quick learner learn willingness positive outgoing personable polite respectful respect warm caring kind energy driven self directed resourceful resilient humble sense humor verbal written skills strong excellent good great effective ability dynamic environment pressure deadlines deadline multiple priorities tasks pace paced composure stress').split(' '));

/** @typedef {import('./reading.js').Unit} Unit */

/**
 * @param {any[]} statements reader statements ({ id, text, kind, importance, confidence, display, … })
 * @param {any[]} _matches the fit check's facts (not read: this judge reads the statement's words)
 * @param {any[]} constraints the gates' rows ({ statementId, kind, status, statementStatus, message, … })
 * @param {any[]} _facts
 * @param {{ resumeText?: string, jobTitle?: string, field?: any }} [opts]
 */
export function statementVerdicts(statements, _matches, constraints, _facts = [], { resumeText = '', jobTitle = '', field = null } = {}) {
  const R = readResume(resumeText);
  const ctx = resumeContext(R, jobTitle, field);
  const out = [];
  for (const st of statements || []) {
    if (st.kind === 'promise') continue;
    out.push(judgeOne(st, (constraints || []).filter((c) => c.statementId === st.id && c.kind !== 'waived'), R, ctx));
  }
  return out;
}
export { statementVerdicts as statementJudge };

/** Everything about the résumé and the posting that every statement needs, read once. */
function resumeContext(/** @type {ReturnType<typeof readResume>} */ R, /** @type {string} */ jobTitle, /** @type {any} */ field) {
  const posting = jobTitle ? safeOcc(jobTitle) : null;
  // "Amazon Fulfillment Center DFW7 — Fulfillment Associate": when only the second part is a job title, it is the title
  for (const r of R.roles) if (r.employer && !safeOcc(r.title) && safeOcc(r.employer)) { const t = r.title; r.title = r.employer; r.employer = t; }
  const roleOcc = R.roles.map((r) => safeOcc(r.title, r.employer));
  // the field verdict's own list of the roles that put the person in the posting's field (same title, however the two
  // readers cut the header: one contains the other, or they share most of their words)
  const norm = (/** @type {string} */ t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sameTitles = ((field && field.level === 'same' && Array.isArray(field.sameRoles)) ? field.sameRoles : []).map((/** @type {any} */ x) => norm(x.title)).filter(Boolean);
  const sameTitle = (/** @type {string} */ t) => {
    const a = norm(t);
    if (!a) return false;
    return sameTitles.some((b) => a === b || a.includes(b) || b.includes(a) || (() => { const A = new Set(a.split(' ')); const B = b.split(' '); const shared = B.filter((w) => A.has(w)).length; return shared >= 2 && shared * 2 >= Math.max(A.size, B.length); })());
  };
  const own = R.roles.map((r, i) => {
    if (sameTitle(r.title) || sameTitle(`${r.title} ${r.employer}`)) return true;
    if (!jobTitle) return false;
    const o = roleOcc[i];
    if (posting && o && o.code === posting.code) return true;
    try { const rel = relation(r.title, jobTitle); return !!rel && (rel.relation === 'same' || rel.relation === 'ladder'); } catch { return false; }
  });
  const fields = [...new Set([posting, ...roleOcc].filter(Boolean).flatMap((o) => fieldsOf(o.code)))];
  // the fields each job works in: its occupation's, else what its employer's name says it is (a hospital, a café)
  const roleFields = R.roles.map((r, i) => {
    const f = roleOcc[i] ? fieldsOf(roleOcc[i].code) : [];
    for (const [re, keys] of SETTINGS) if (/** @type {RegExp} */ (re).test(`${r.title} ${r.employer}`)) f.push(.../** @type {string[]} */ (keys));
    return [...new Set(f)];
  });
  const lines = R.lines.filter((l) => ['doing', 'skills', 'cert', 'education', 'role', 'summary', 'contact'].includes(l.kind)).map((l, i) => {
    const rl = readLine(l.text);
    const roleIdx = l.kind === 'role' ? R.roles.findIndex((r) => r.line === l.text) : l.role;
    return { ...l, i, rl, roleIdx, own: roleIdx != null && roleIdx >= 0 ? own[roleIdx] : false, verbStart: verbStart(l.text, !!rl.units[0] && rl.units[0].fams.some((/** @type {any} */ f) => f.kind === 'action')) };
  });
  const differentField = !!(field && field.level === 'different' && field.known !== false);
  // every base form of every résumé word ("copies" holds "copy")
  const resumeWords = new Set(surfaceTokens(R.lines.map((l) => l.text).join(' ')).flatMap((t) => formsOf(t.w)));
  return { R, lines, fields, roleFields, differentField, resumeWords, posting };
}

function safeOcc(/** @type {string} */ title, /** @type {string} */ employer = '') {
  try { const o = occupationOf(title, employer ? { employer } : {}); return o && (o.confidence === 'exact' || o.confidence === 'close') ? o : null; } catch { return null; }
}

/** A row in the shape every screen reads. */
function row(/** @type {any} */ st, /** @type {string} */ status, /** @type {any[]} */ evidence, /** @type {string[]} */ missing, /** @type {any} */ extra = {}) {
  const r = { id: st.id, text: st.text, status, evidence, missing, kind: st.kind, importance: st.importance, confidence: st.confidence || 'high', display: st.display !== false, ...extra };
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}
const lowerFirst = (/** @type {string} */ t) => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);

function judgeOne(/** @type {any} */ st, /** @type {any[]} */ cons, /** @type {any} */ R, /** @type {any} */ ctx) {
  const text = String(st.text || '');
  const minor = /^\s*(?:help|helps|helping|assist|assists|assisting|support|supports|supporting|participate|participates|participating)\b/i.test(text) ? { minor: true } : {};
  // 1. gates keep their own grade and sentence (the scoring engineer's)
  const gates = cons.filter((c) => GATE_KINDS.has(c.kind));
  if (gates.length) {
    const g = gateRow(st, gates, ctx);
    if (g) return { ...g, ...minor };
  }
  // 2. what only the person can say
  const ask = askKind(st, text);
  if (ask === 'location') return { ...locationRow(st, text, ctx), ...minor };
  // 3. the statement against every line
  const S = readStatement(text, { kind: st.kind });
  if (ask) {
    // (a physical or schedule ask a doing line plainly states is shown by that line: "Lift up to 50 pounds" ← "lift and
    // stack 50 lb cases all shift")
    const v = ask === 'physical' || ask === 'schedule' ? judgeStatement(st, S, ctx, { doingOnly: true }) : null;
    if (v && v.status === 'shown') return { ...v, ...minor };
    return row(st, 'cannot_tell', [], [], { ask: { kind: ask, text: lowerFirst(text) }, ...minor });
  }
  // a credential (licence, certification, degree, accredited program) is shown only by the credential itself
  if (CREDENTIAL_RE.test(text)) return { ...credentialRow(st, S, ctx), ...minor };
  const verdict = settingRow(st, S, ctx) || judgeStatement(st, S, ctx);
  // a statement led by a trait, with nothing specific beside it, is the person's to say unless a line plainly shows it
  if (verdict.status === 'partly' && traitLed(S)) return row(st, 'cannot_tell', [], [], { ask: { kind: 'trait', text: lowerFirst(text) }, ...minor });
  // 4. a trait, a basic ability or the employer's own rules that no line shows: the person's to say
  if (verdict.status === 'not_shown') {
    const k = traitLed(S) ? 'trait' : BASIC_RE.test(text) ? 'ability' : (COMPLY_RE.test(text) && RULE_OBJ_RE.test(text)) ? 'compliance' : null;
    if (k) return row(st, 'cannot_tell', [], [], { ask: { kind: k === 'compliance' ? 'trait' : k, text: lowerFirst(text) }, ...minor });
    const allUnits = S.clauses.flatMap((c) => [...c.actions, ...c.objects]);
    if (!allUnits.some((u) => u.spec >= 0.15)) return row(st, 'cannot_tell', [], [], { ask: { kind: 'trait', text: lowerFirst(text) }, ...minor });
  }
  return { ...verdict, ...minor };
}

/** The class of a statement only the person can answer, or null. */
function askKind(/** @type {any} */ st, /** @type {string} */ text) {
  if (st.kind === 'schedule') return 'schedule';
  if (st.kind === 'physical') return 'physical';
  if (ELIGIBILITY_RE.test(text)) return 'eligibility';
  // the job describing itself to the reader ("You will join our team as a summer intern from June …")
  if (/^\s*(?:you\s+will|you'll)\s+(?:join|be\s+(?:part|joining|based|reporting)|report\s+to|start)\b/i.test(text)) return 'schedule';
  const duty = st.kind === 'duty' && !/^\s*(?:be|must|able|available|willing|work\s+(?:a|any|all|nights|weekends|holidays|flexible))/i.test(text);
  if (!duty && LOCATION_RE.test(text)) return 'location';
  if (!duty && SCHEDULE_RE.test(text)) return 'schedule';
  // (a physical demand: with an ability / frequency word, or two physical words together — "lifting, carrying, standing")
  if (!duty && PHYSICAL_RE.test(text) && (/\b(?:able|ability|must|frequent\w*|occasional\w*|up\s+to|required|requires|regularly|lbs?|pounds|extended\s+periods?)\b/i.test(text) || (text.match(new RegExp(PHYSICAL_RE.source, 'gi')) || []).length >= 2)) return 'physical';
  return null;
}

/** A statement led by a trait word with nothing specific beside it. */
function traitLed(/** @type {any} */ S) {
  const us = S.clauses.flatMap((/** @type {any} */ c) => [...c.actions, ...c.objects]);
  if (!us.length) return false;
  const isTrait = (/** @type {Unit} */ u) => u.tokens.every((t) => TRAIT_WORDS.has(t));
  const firstWord = surfaceTokens(S.text)[0];
  // (a non-trait action or a specific thing beside the trait is judged: "… skills with the ability to sell and negotiate")
  return (isTrait(us[0]) || (!!firstWord && TRAIT_WORDS.has(firstWord.w))) && !us.some((u) => !isTrait(u) && (u.spec >= 0.35 || u.role === 'action'));
}

/**
 * A setting ask ("Experience in a healthcare environment", "Previous retail, customer service, or hospitality
 * experience", "Experience in home health"): shown by a job whose occupation works in that setting — the job header is
 * the proof (a header proves a title, a tenure, a setting; never a duty). Only for a statement with no action of its own.
 */
function settingRow(/** @type {any} */ st, /** @type {any} */ S, /** @type {any} */ ctx) {
  if (st.kind === 'duty' || S.clauses.some((/** @type {any} */ c) => c.actions.length) || S.clauses.length > 1) return null;
  // (phrased as WHERE someone worked — "experience in", "background", "environment" — never as what they know)
  const raw = String(st.text || '');
  if (!/\b(?:experience|background|environment|setting|industry|sector|field)\b/i.test(raw) || /\b(?:knowledge|understanding|familiarity|proficien\w*|expertise)\b/i.test(raw)) return null;
  const want = SETTINGS.filter(([re]) => /** @type {RegExp} */ (re).test(S.text));
  if (!want.length) return null;
  // the statement must be about the setting itself: nothing specific left once the setting words are set aside
  const rest = S.clauses[0].objects.filter((/** @type {Unit} */ u) => !want.some(([re]) => /** @type {RegExp} */ (re).test(u.text)) && !/^(?:environment|setting|industry|field|background|work|operations?|experience|space|sector|role|position|business|organization|company|facility)s?$/.test(u.text));
  if (rest.some((/** @type {Unit} */ u) => u.spec >= 0.3)) return null;
  const fieldsWanted = new Set(want.flatMap(([, f]) => /** @type {string[]} */ (f)));
  for (let i = 0; i < ctx.R.roles.length; i++) {
    const fs = ctx.roleFields[i] || [];
    if (!fs.some((/** @type {string} */ f) => fieldsWanted.has(f))) continue;
    const r = ctx.R.roles[i];
    const line = ctx.lines.find((/** @type {any} */ l) => l.kind === 'role' && l.roleIdx === i);
    if (!line) continue;
    return row(st, 'shown', [{ line: line.text, why: `you ${r.current ? 'work' : 'worked'} as ${r.title}${r.employer ? ` at ${r.employer}` : ''}` }], []);
  }
  return null;
}

/**
 * A credential with no gate grade: shown only by a line that names it — a certifications / education / skills line, the
 * name line ("Grace Okafor, RN") or a job title — holding every specific word of it (or its trade-talk name), and not as
 * a junior form of it ("Physical Therapist Assistant license" is not a Physical Therapist licence).
 */
function credentialRow(/** @type {any} */ st, /** @type {any} */ S, /** @type {any} */ ctx) {
  const text = String(st.text || '');
  const c = S.clauses[0];
  const units = c ? [...c.actions, ...c.objects, ...c.details.filter((/** @type {Unit} */ d) => d.spec >= 0.5)] : [];
  const want = units.filter((/** @type {Unit} */ u) => u.spec >= 0.2 && !u.tokens.every((t) => CRED_WORDS.has(t)));
  const groups = c && c.or ? [...new Set(want.map((/** @type {Unit} */ u) => u.alt))].map((g) => want.filter((/** @type {Unit} */ u) => u.alt === g)) : [want];
  const level = degreeLevel(text);
  const lines = ctx.lines.filter((/** @type {any} */ l) => ['cert', 'education', 'skills', 'contact', 'role', 'summary'].includes(l.kind));
  for (const l of lines) {
    if (level && degreeLevel(l.text) !== level) continue;
    const juniorOnLine = (l.text.match(JUNIOR_RE) || []).map((x) => x.toLowerCase());
    if (juniorOnLine.some((j) => !new RegExp(`\\b${escapeRegExp(j)}\\b`, 'i').test(text))) continue;
    const pc = pairContext(units, l.rl);
    const tt = tradeOnLine(l.text, c ? c.head : text, ctx.fields).m >= THRESHOLDS.STRONG;
    const ok = tt || groups.some((g) => g.length > 0 && g.every((/** @type {Unit} */ u) => unitOnLine(u, l.rl, pc).m >= THRESHOLDS.STRONG));
    if (!ok || (!want.length && !level && !tt)) continue;
    const role = l.roleIdx != null && l.roleIdx >= 0 ? ctx.R.roles[l.roleIdx] : null;
    return row(st, 'shown', [{ line: l.text, why: whyOf(l, want.map((/** @type {Unit} */ u) => unitOnLine(u, l.rl, pc).at).filter(Boolean), { verbStart: false, role }) }], []);
  }
  const miss = c ? spanOf(text, [...c.actions, ...c.objects].flatMap((/** @type {Unit} */ u) => u.tokens)) : '';
  return row(st, 'not_shown', [], miss ? [miss] : []);
}
const CREDENTIAL_RE = /\b(?:licen[sc]e[ds]?|licensure|certif(?:ied|ication|icate)s?|registered\s+(?:nurse|dietitian|technologist|pharmacist)|degree|diploma|graduat(?:e|ion)\s+(?:of|from)|accredited|bachelor'?s?|master'?s?|associate'?s\s+degree|ged|ph\.?\s?d|mba|clearance)\b/i;
const CRED_WORDS = new Set(['license', 'licence', 'licensed', 'licensure', 'certification', 'certificate', 'certified', 'degree', 'diploma', 'graduate', 'graduation', 'accredited', 'program', 'active', 'valid', 'current', 'state', 'unrestricted', 'equivalent', 'related', 'field', 'approved', 'school', 'board', 'good', 'standing', 'credential', 'card', 'obtain', 'ability', 'eligible', 'eligibility']);
const JUNIOR_RE = /\b(?:assistant|aide|apprentice|helper|trainee|student|candidate|intern|technician|tech|in\s+progress|pursuing|expected|coursework)\b/gi;
/** The degree level a text names (abbreviations included), or null. @param {string} t */
function degreeLevel(t) {
  if (/\b(?:ph\.?\s?d|doctor(?:ate|al)|d\.?n\.?p|ed\.?d)\b/i.test(t)) return 'doctorate';
  if (/\b(?:master'?s?|m\.?\s?s\.?|m\.?\s?a\.?|mba|msn|m\.?ed|mph|msw)\b/i.test(t)) return 'master';
  if (/\b(?:bachelor'?s?|b\.?\s?s\.?|b\.?\s?a\.?|bsn|b\.?sc|bba|bfa)\b/i.test(t)) return 'bachelor';
  if (/\b(?:associate'?s?\s+(?:degree|of)|a\.?\s?a\.?\s?s?\.?|a\.?\s?s\.?|adn)\b/.test(t)) return 'associate';
  return null;
}

/** A place the posting names: the résumé's own city is part of it (partly); another city is not; no place, ask. */
function locationRow(/** @type {any} */ st, /** @type {string} */ text, /** @type {any} */ ctx) {
  const places = surfaceTokens(text).filter((t, i) => i > 0 && /^[A-Z][a-z]{2,}/.test(t.s) && !/^(?:Hybrid|Remote|Must|Office|On|Onsite|In|Our|The|We|You)$/.test(t.s)).map((t) => t.w);
  if (!places.length) return row(st, 'cannot_tell', [], [], { ask: { kind: 'schedule', text: lowerFirst(text) } });
  const contact = ctx.lines.find((/** @type {any} */ l) => l.kind === 'contact' && places.some((p) => l.rl.words.has(p)));
  if (!contact) return row(st, 'not_shown', [], [spanOf(text, places) || places.join(' ')].filter(Boolean));
  const commitment = (text.match(LOCATION_RE) || [''])[0];
  const city = places.filter((p) => contact.rl.words.has(p));
  return row(st, 'partly', [{ line: contact.text, why: `you live in ${surfaceTokens(contact.text).filter((t) => city.includes(t.w)).map((t) => t.s).join(' ')}` }], commitment ? [commitment.trim()] : []);
}

/** Gate statements: the gate's grade (statementStatus, else met/unmet), its sentence, and the line behind it. */
function gateRow(/** @type {any} */ st, /** @type {any[]} */ gates, /** @type {any} */ ctx) {
  const text = String(st.text || '');
  const grades = [];
  const evidence = [];
  const missing = [];
  let sawCannot = false;
  for (const c of gates) {
    const re = /** @type {any} */ (CONSTRAINT_WORDS)[c.kind];
    if (re && !re.test(text)) continue;
    const grade = c.statementStatus || (c.status === 'met' ? 'shown' : c.status === 'unmet' ? 'not_shown' : 'cannot_tell');
    if (grade === 'cannot_tell') { sawCannot = true; continue; }
    grades.push(grade);
    const why = c.message || c.sentence || '';
    for (const l of gateLines(c, ctx)) if (!evidence.some((e) => e.line === l)) evidence.push({ line: l, why });
    if (grade !== 'shown') missing.push(c.pending ? `${String(c.label || '').replace(/^(?:an?|the)\s+/i, '')} — you list ${c.pending}` : String(c.label || '').replace(/^(?:an?|the)\s+/i, ''));
  }
  if (grades.length) {
    const status = grades.every((x) => x === 'shown') ? 'shown' : grades.every((x) => x === 'not_shown') ? 'not_shown' : 'partly';
    if (status !== 'not_shown' && !evidence.length) {
      // a credited gate with no line behind it on this page: say the gate's sentence on the most relevant line kind
      const why = (gates.find((c) => c.message || c.sentence) || {}).message || '';
      const l = ctx.lines.find((/** @type {any} */ x) => x.kind === 'role') || null;
      if (l) evidence.push({ line: l.text, why });
    }
    return row(st, status, status === 'not_shown' ? [] : evidence.slice(0, 3), status === 'shown' ? [] : missing.filter(Boolean));
  }
  if (!sawCannot) return null;
  const kinds = new Set(gates.map((c) => c.kind));
  if (kinds.has('degree') || kinds.has('gpa')) return row(st, 'cannot_tell', [], [], { ask: { kind: 'eligibility', text: lowerFirst(text) } });
  if (kinds.has('certification') || kinds.has('licence') || kinds.has('license')) {
    if (/\b(?:ability|able|obtain|within\s+\d+|willing\w*|eligib\w*)\b/i.test(text)) return row(st, 'cannot_tell', [], [], { ask: { kind: 'eligibility', text: lowerFirst(text) } });
    const label = String((gates.find((c) => c.label) || {}).label || text).replace(/^(?:an?|the)\s+/i, '');
    return row(st, 'not_shown', [], [label]);
  }
  return null;   // years / language / management the gate could not grade: judged on the statement's words
}

/** The résumé lines behind a gate's grade: its own line, the roles it counted, the education line, the language line. */
function gateLines(/** @type {any} */ c, /** @type {any} */ ctx) {
  const out = [];
  if (c.line) out.push(String(c.line));
  if (Array.isArray(c.counted)) for (const r of c.counted.slice(0, 2)) {
    const l = ctx.lines.find((/** @type {any} */ x) => x.kind === 'role' && r.title && x.text.includes(String(r.title)));
    if (l) out.push(l.text);
  }
  if ((c.kind === 'degree' || c.kind === 'gpa') && !out.length) {
    const l = ctx.lines.find((/** @type {any} */ x) => x.kind === 'education');
    if (l) out.push(l.text);
  }
  if (c.kind === 'language' && !out.length) {
    const want = surfaceTokens(String(c.label || c.value || '')).map((t) => t.w).filter((w) => w !== 'english' && w.length > 3);
    const l = ctx.lines.find((/** @type {any} */ x) => want.some((w) => x.rl.words.has(w)));
    if (l) out.push(l.text);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// the line judge

const RANK = { shown: 3, partly: 2, not_shown: 1 };
/** Development trace (off in production): which rule decided each statement, on which line. */
export const _trace = { on: false, /** @type {any[]} */ log: [] };
// a matched head counts for SHOWN when it brings at least this share of its own phrase's specificity
const GROUP_COV = 0.5;
// SHOWN needs the line to hold at least this share of the heads' specificity (a list asked with "and": most of it)
const HEAD_SHARE = 0.6;
// an action matched with no object word beside it must be at least this specific (effective, the weaker side's)
const ACT_SPEC = 0.35;
// how many of the closest doing lines are asked the O*NET activity question (precise, slow: ~1 ms a call)
const ACTIVITY_LINES = 3;
// a detail matched beside the action must be at least this specific to count ("active threats", not "team")
const DETAIL_SPEC = 0.4;

/**
 * Score one clause against one line.
 * @param {any} c clause @param {any} line @param {any} ctx @param {Unit[]} allUnits every unit of the statement (context)
 */
function scoreClause(c, line, ctx, allUnits) {
  const T = THRESHOLDS;
  const pc = pairContext(allUnits, line.rl);
  const floor = line.own ? T.OWN_FLOOR : 0.05;
  const w = (/** @type {Unit} */ u) => Math.max(u.spec, floor) * (u.role === 'action' || u.head ? 1 : 0.5);
  const res = new Map();
  for (const u of [...c.actions, ...c.objects, ...c.details]) res.set(u, unitOnLine(u, line.rl, pc));
  // trade talk on each object group and on the clause head (the posting's thing under the line's trade name)
  const groups = [...new Set(c.objects.map((/** @type {Unit} */ o) => o.alt))];
  for (const g of groups) {
    const us = c.objects.filter((/** @type {Unit} */ o) => o.alt === g);
    const tt = tradeOnLine(line.text, us.map((/** @type {Unit} */ u) => u.text).join(' '), ctx.fields);
    if (tt.m) for (const u of us) if ((res.get(u)?.m || 0) < tt.m) res.set(u, { m: tt.m, via: tt.via, at: '', atSpec: u.spec });
  }
  const headTT = c.actions.length ? tradeOnLine(line.text, c.head, ctx.fields) : { m: 0, via: '' };
  if (headTT.m) for (const u of [...c.actions, ...c.objects.filter((/** @type {Unit} */ o) => o.head)]) if ((res.get(u)?.m || 0) < headTT.m) res.set(u, { m: headTT.m, via: headTT.via, at: '', atSpec: u.spec });
  const m = (/** @type {Unit} */ u) => res.get(u)?.m || 0;
  const A = c.actions.length ? Math.max(...c.actions.map(m)) : null;
  const heads = c.objects.filter((/** @type {Unit} */ o) => o.head);
  // H: the best head's match; headShare: how much of the heads' specificity is matched (an "or" list needs one)
  const H = !heads.length ? null : Math.max(...heads.map(m));
  const hw = (/** @type {Unit} */ h) => Math.max(h.spec, 0.05);
  const headShare = !heads.length ? 0 : c.or ? (H >= T.STRONG ? 1 : 0) : heads.filter((/** @type {Unit} */ h) => m(h) >= T.STRONG).reduce((/** @type {number} */ a, /** @type {Unit} */ h) => a + hw(h), 0) / heads.reduce((/** @type {number} */ a, /** @type {Unit} */ h) => a + hw(h), 0);
  // an example of the thing ("including A, B, C") that the line names
  const exampleHit = c.details.filter((/** @type {Unit} */ d) => d.example && d.spec >= 0.3 && m(d) >= T.STRONG).reduce((/** @type {number} */ a, /** @type {Unit} */ d) => Math.max(a, d.spec), 0);
  const core = [...c.actions, ...c.objects];
  // (the own-occupation floor lifts a generic word only where it is matched: it means the posting's thing there; an
  // unmatched generic word stays light either way)
  const wc = (/** @type {Unit} */ u) => (m(u) >= T.STRONG ? w(u) : Math.max(u.spec, 0.05) * (u.role === 'action' || u.head ? 1 : 0.5));
  const totalW = core.reduce((a, u) => a + wc(u), 0);
  const cov = totalW ? core.reduce((a, u) => a + wc(u) * m(u), 0) / totalW : 0;
  const matched = core.filter((u) => m(u) >= T.STRONG);
  // a matched word's specificity is the weaker side's (the line's word may be more generic than the posting's)
  // (under a job of the posting's own occupation a generic word weighs at least OWN_FLOOR: it means the posting's thing)
  const e = (/** @type {Unit} */ u) => { const r = res.get(u); return Math.max(Math.min(u.spec, r && r.atSpec != null && r.atSpec > 0 ? r.atSpec : u.spec), line.own ? T.OWN_FLOOR : 0); };
  // the specificity the matched words carry together (a generic word under the posting's own occupation weighs OWN_FLOOR)
  const maxSpec = matched.reduce((a, u) => a + e(u), 0);
  const actionHit = A != null && A >= T.STRONG;
  const headHit = H != null && H >= T.STRONG;
  const headSpec = heads.length ? Math.max(...heads.filter((/** @type {Unit} */ h) => m(h) >= T.STRONG).map((/** @type {Unit} */ h) => e(h)), 0) : 0;
  // how much of its own phrase a matched head brings with it ("UI suite" holds "suite" of "MS Office Suite": a third)
  let groupCov = 0;
  for (const h of heads) {
    if (m(h) < T.STRONG) continue;
    const us = c.objects.filter((/** @type {Unit} */ o) => o.alt === h.alt);
    const tot = us.reduce((/** @type {number} */ a, /** @type {Unit} */ u) => a + Math.max(u.spec, 0.05), 0);
    groupCov = Math.max(groupCov, us.reduce((/** @type {number} */ a, /** @type {Unit} */ u) => a + Math.max(u.spec, 0.05) * m(u), 0) / tot);
  }
  const objectHit = c.objects.some((/** @type {Unit} */ o) => m(o) >= T.STRONG);
  // the best-held object group, whatever its head
  let bestGroup = 0;
  let bestGroupWords = 0;
  for (const g of new Set(c.objects.map((/** @type {Unit} */ o) => o.alt))) {
    const us = c.objects.filter((/** @type {Unit} */ o) => o.alt === g);
    const tot = us.reduce((/** @type {number} */ a, /** @type {Unit} */ u) => a + Math.max(u.spec, 0.05), 0);
    const got = us.filter((/** @type {Unit} */ u) => m(u) >= T.STRONG);
    const cv = got.reduce((/** @type {number} */ a, /** @type {Unit} */ u) => a + Math.max(u.spec, 0.05), 0) / tot;
    if (cv > bestGroup) { bestGroup = cv; bestGroupWords = got.length; }
  }
  // who / where / with what the action is done, named on the line ("Brief … on active threats" ← "Briefed … on active threats")
  const detailHit = c.details.filter((/** @type {Unit} */ d) => !d.example && m(d) >= T.STRONG).reduce((/** @type {number} */ a, /** @type {Unit} */ d) => Math.max(a, e(d)), 0);
  // (the action's own specificity, the weaker side's, with no occupation floor: a generic verb is generic everywhere)
  const eRaw = (/** @type {Unit} */ u) => { const r = res.get(u); return Math.min(u.spec, r && r.atSpec > 0 ? r.atSpec : u.spec); };
  const actSpec = c.actions.filter((/** @type {Unit} */ u) => m(u) >= T.STRONG).reduce((/** @type {number} */ a, /** @type {Unit} */ u) => Math.max(a, eRaw(u)), 0);
  return { res, A, H, cov, matched, maxSpec, actSpec, detailHit, bestGroup, bestGroupWords, actionHit, headHit, headSpec, heads, groupCov, objectHit, headShare, exampleHit, crossOk: matched.some((u) => e(u) >= T.CROSS_SPEC) || exampleHit >= T.CROSS_SPEC };
}

/** The verdict of one clause on one line, from structure and the frozen thresholds. */
function clauseStatus(/** @type {any} */ s, /** @type {any} */ c, /** @type {any} */ line, /** @type {any} */ ctx) {
  const T = THRESHOLDS;
  const cross = ctx.differentField;
  const specShown = cross ? T.CROSS_SPEC : T.SPEC_SHOWN;
  const specPartly = cross ? T.CROSS_SPEC : T.SPEC_PARTLY;
  // (on a known different field the most specific matched word must carry the claim by itself)
  if (cross && !s.crossOk) return 'not_shown';
  const hasAction = c.actions.length > 0;
  const hasObject = s.heads.length > 0;
  // the head object counts when the line brings at least half of its phrase — or the line sits under a job of the
  // posting's own occupation, where a narrower phrase still names the posting's thing (the occupation prior)
  const head = s.headHit && (s.groupCov >= GROUP_COV || line.own);
  if ((!hasAction || s.actionHit) && (!hasObject || (head && s.headShare >= HEAD_SHARE)) && s.cov >= T.SHOWN_COV && s.maxSpec >= specShown) { s.rule = 'shown'; return 'shown'; }
  // an example the statement gives, named on the line: at least part of it
  // (when the head itself is generic — "tools such as Excel" — or matched; an example under an unmatched specific head is
  // an example of something the line does not do)
  if (s.exampleHit >= specPartly && (s.headHit || s.actionHit || !s.heads.some((/** @type {Unit} */ h) => h.spec >= 0.3))) { s.rule = 'example'; return 'partly'; }
  if (s.maxSpec < specPartly) return 'not_shown';
  // PARTLY: the action on a related object (any object word matched, or the posting's own occupation), the object with a
  // weaker action, or most of the weighted head
  // (an action alone, with no object word on the line, must be a specific verb — "develop", "build", "evaluate" are not)
  if (s.actionHit && (!hasObject || s.objectHit || line.own || s.actSpec >= ACT_SPEC)) { s.rule = !hasObject ? 'action:no-object' : s.objectHit ? 'action+some-object' : 'action:own'; return 'partly'; }
  // (the action on the line with what it is done to, for or with: a specific detail of the statement named beside it)
  if (s.actionHit && s.detailHit >= DETAIL_SPEC) { s.rule = 'action+detail'; return 'partly'; }
  if (head && s.headSpec >= specPartly) { s.rule = 'object'; return 'partly'; }
  // (no verb of its own — a light verb was passed over: the thing named on the line with a specific detail of it)
  if (false && !hasAction && s.objectHit && s.detailHit >= DETAIL_SPEC) { s.rule = 'object+detail'; return 'partly'; }
  // (most of one named thing: at least two of its words and half its specificity — "cross-browser compatibility issues")
  if (false && s.bestGroup >= GROUP_COV && s.bestGroupWords >= 2) { s.rule = 'most-of-a-thing'; return 'partly'; }
  // (most of the weighted head, from at least two of its words)
  if (s.cov >= T.PARTLY_COV && s.matched.length >= 2) { s.rule = 'coverage'; return 'partly'; }
  return 'not_shown';
}

/** Which lines may prove a statement: a duty only by doing lines; a skill / tool / credential also by list lines. */
function allowedLines(/** @type {any} */ st, /** @type {any} */ S, /** @type {any} */ ctx) {
  const duty = st.kind === 'duty';
  return ctx.lines.filter((/** @type {any} */ l) => {
    if (l.kind === 'doing') return true;
    if (duty) return false;
    if (l.kind === 'skills' || l.kind === 'cert' || l.kind === 'education') return true;
    // (a job header proves a title, a setting or a tenure ask only — settingRow; never a skill or a duty)
    return false;
  });
}

function judgeStatement(/** @type {any} */ st, /** @type {any} */ S, /** @type {any} */ ctx, { doingOnly = false } = {}) {
  const allUnits = S.clauses.flatMap((/** @type {any} */ c) => [...c.actions, ...c.objects, ...c.details]);
  const lines = allowedLines(st, S, ctx).filter((/** @type {any} */ l) => !doingOnly || l.kind === 'doing');
  const duty = st.kind === 'duty';
  if (!allUnits.length) return row(st, 'not_shown', [], []);
  // per clause: the best line
  const per = S.clauses.map((/** @type {any} */ c) => {
    let best = null;
    for (const line of lines) {
      const s = scoreClause(c, line, ctx, allUnits);
      const status = clauseStatus(s, c, line, ctx);
      // (the line that DOES the head action on the head object first, then the one with more specific evidence)
      const tier = (s.actionHit ? 1 : 0) + (s.headHit ? 2 : 0);
      const key = [RANK[/** @type {'shown'} */ (status)], line.kind === 'doing' ? 1 : 0, Math.round(s.maxSpec * 5), tier, s.cov, line.own ? 1 : 0, -(line.roleIdx ?? 9)];
      if (!best || cmp(key, best.key) > 0) best = { line, s, status, key };
    }
    return { c, best };
  });
  // the kind of work, for the core clause on the closest lines (O*NET activities: exact/close "same" counts as a
  // match of action and object; a "related" activity is never proof)
  for (const p of per) {
    if (!p.best || p.best.status === 'shown' || !p.c.actions.length || !p.c.objects.length || ctx.differentField) continue;
    const cands = lines.filter((/** @type {any} */ l) => l.kind === 'doing').map((/** @type {any} */ l) => ({ l, s: scoreClause(p.c, l, ctx, allUnits) })).sort((a, b) => b.s.cov - a.s.cov).slice(0, ACTIVITY_LINES);
    for (const { l, s } of cands) {
      let ra = null;
      try { ra = relateActivities(l.text, p.c.head); } catch { ra = null; }
      if (ra && ra.relation === 'same' && (ra.confidence === 'exact' || ra.confidence === 'close')) {
        const status = s.headHit || s.actionHit ? 'shown' : 'partly';
        if (RANK[/** @type {'shown'} */ (status)] > RANK[/** @type {'shown'} */ (p.best.status)]) p.best = { line: l, s, status, key: p.best.key, activity: ra.via && ra.via.title };
        break;
      }
    }
  }
  const core = per[0];
  const coreStatus = core.best ? core.best.status : 'not_shown';
  const others = per.slice(1).filter((/** @type {any} */ p) => p.c.actions.length || p.c.objects.length);
  const otherCredited = others.filter((/** @type {any} */ p) => p.best && p.best.status !== 'not_shown');
  let status = coreStatus;
  if (status === 'shown' && others.length && otherCredited.length * 2 < others.length) status = 'partly';
  // (a later clause lifts a refused core to partly only when a line SHOWS that clause — a half match of a side clause
  // is too little to credit the statement)
  if (status === 'not_shown' && otherCredited.some((/** @type {any} */ p) => p.best.status === 'shown' || p.best.line.own)) status = 'partly';
  // evidence: the core's line, then a line that proves another clause or object group the first does not
  /** @type {Array<{ line: string, why: string }>} */
  const evidence = [];
  const cite = (/** @type {any} */ b) => {
    if (!b || !b.line || evidence.some((e) => e.line === b.line.text)) return;
    const shared = [...b.s.res.values()].filter((r) => r.m >= THRESHOLDS.STRONG && r.at).map((r) => r.at);
    const role = b.line.roleIdx != null && b.line.roleIdx >= 0 ? ctx.R.roles[b.line.roleIdx] : null;
    evidence.push({ line: b.line.text, why: whyOf(b.line, shared, { verbStart: b.line.verbStart, role }) });
  };
  if (status !== 'not_shown') {
    if (coreStatus !== 'not_shown') cite(core.best);
    for (const p of otherCredited) cite(p.best);
  }
  // missing: the core's unmatched head words and the clauses no line shows, in the statement's own words
  /** @type {string[]} */
  let missing = [];
  /** @type {string[]} */
  let note = [];
  const unmatched = (/** @type {any} */ p) => {
    const s = p.best && p.best.status !== 'not_shown' ? p.best.s : null;
    const miss = [];
    const lost = (/** @type {Unit} */ u) => !s || (s.res.get(u)?.m || 0) < THRESHOLDS.STRONG;
    // (a lost action is said with what it acts on — "operates Spectralink/Zebra phone" — never as a lone verb)
    if (p.c.actions.length && p.c.actions.every(lost) && s) {
      const phrase = spanOf(String(st.text), [...p.c.actions[0].tokens, ...(p.c.objects.find((/** @type {Unit} */ o) => o.head)?.tokens || [])], { cross: true });
      if (phrase && /\s/.test(phrase)) miss.push(phrase);
    }
    for (const g of new Set(p.c.objects.map((/** @type {Unit} */ o) => o.alt))) {
      const us = p.c.objects.filter((/** @type {Unit} */ o) => o.alt === g);
      if (us.filter((/** @type {Unit} */ u) => u.head).every(lost) && (!p.c.or || !s)) miss.push(spanOf(String(st.text), us.flatMap((/** @type {Unit} */ u) => u.tokens)));
    }
    return miss;
  };
  if (status === 'partly') {
    if (coreStatus !== 'not_shown') missing.push(...unmatched(core)); else missing.push(spanOf(String(st.text), [...core.c.actions, ...core.c.objects].flatMap((/** @type {Unit} */ u) => u.tokens)));
    for (const p of others) if (!p.best || p.best.status === 'not_shown') missing.push(spanOf(String(st.text), [...p.c.actions, ...p.c.objects].flatMap((/** @type {Unit} */ u) => u.tokens)));
  }
  if (status === 'shown') {
    // details the line does not hold are a note beside a shown line, never a gap
    const s = core.best.s;
    const lostDetails = core.c.details.filter((/** @type {Unit} */ d) => d.spec >= 0.4 && (s.res.get(d)?.m || 0) < THRESHOLDS.STRONG);
    if (lostDetails.length) note = [spanOf(String(st.text), lostDetails.flatMap((/** @type {Unit} */ u) => u.tokens))];
  }
  missing = dedupeItems([...new Set(missing.filter((x) => x && !allOnResume(x, ctx.resumeWords) && !loneLead(x, String(st.text))))]);
  note = note.filter((x) => x && !allOnResume(x, ctx.resumeWords));
  if (status === 'partly' && !missing.length) {
    // partly with nothing nameable missing: the line holds every head word, so the gap is in the details
    const lostDetails = core.c.details.filter((/** @type {Unit} */ d) => d.spec >= 0.3 && (!core.best || (core.best.s.res.get(d)?.m || 0) < THRESHOLDS.STRONG));
    const d = lostDetails.length ? spanOf(String(st.text), lostDetails.flatMap((/** @type {Unit} */ u) => u.tokens)) : '';
    if (d && !allOnResume(d, ctx.resumeWords)) missing.push(d);
  }
  if (status !== 'not_shown' && !evidence.length) status = 'not_shown';
  if (_trace.on) _trace.log.push({ text: st.text, status, rule: core.best ? core.best.s.rule || (core.best.activity ? 'activity' : '') : '', line: core.best && core.best.line.text, matched: core.best ? [...core.best.s.res.entries()].filter(([, r]) => r.m >= THRESHOLDS.STRONG).map(([u, r]) => `${u.text}~${r.at || r.via}`) : [], others: otherCredited.length });
  const extra = {};
  if (note.length) /** @type {any} */ (extra).note = note;
  // a close line under the bar is asked as a question, never hidden behind "not shown"; a duty's skills-line word is
  // asked as "did you do this at <job>?"
  if (status !== 'shown' && !ctx.differentField) {
    const cand = candidateFor(st, S, ctx, allUnits, evidence.map((e) => e.line), duty);
    if (cand) /** @type {any} */ (extra).candidate = cand;
  }
  return row(st, status, status === 'not_shown' ? [] : evidence.slice(0, 3), status === 'shown' ? [] : status === 'not_shown' ? notShownMissing(st, S, ctx) : missing, extra);
}

/** A missing item that is only the statement's opening word ("Operates", "Building"): a fragment, never printed. */
function loneLead(/** @type {string} */ item, /** @type {string} */ text) {
  return !/\s/.test(item.trim()) && text.trim().toLowerCase().startsWith(item.trim().toLowerCase()) && item.trim().length < text.trim().length - 3;
}

/** For a not-shown statement, what is missing: the core clause's head in the statement's words. */
function notShownMissing(/** @type {any} */ st, /** @type {any} */ S, /** @type {any} */ ctx) {
  const c = S.clauses[0];
  if (!c) return [];
  const p = spanOf(String(st.text), [...c.actions, ...c.objects].flatMap((/** @type {Unit} */ u) => u.tokens), { cross: true });
  return p && !allOnResume(p, ctx.resumeWords) && !loneLead(p, String(st.text)) ? [p] : [];
}

/** The single closest line that is not already cited, as a question; null when nothing is close. */
function candidateFor(/** @type {any} */ st, /** @type {any} */ S, /** @type {any} */ ctx, /** @type {Unit[]} */ allUnits, /** @type {string[]} */ cited, /** @type {boolean} */ duty) {
  const c = S.clauses[0];
  if (!c) return null;
  let best = null;
  for (const line of ctx.lines) {
    if (cited.includes(line.text) || !['doing', 'skills', 'cert'].includes(line.kind)) continue;
    const s = scoreClause(c, line, ctx, allUnits);
    if (s.maxSpec < 0.35 || !(s.headHit || (s.actionHit && s.H > 0))) continue;
    if (!best || s.cov > best.s.cov) best = { line, s };
  }
  if (!best) return null;
  const words = [...best.s.res.values()].filter((r) => r.m >= THRESHOLDS.STRONG && r.at).map((r) => r.at);
  if (best.line.kind !== 'doing') {
    if (!duty) return null;   // a list line already decides a skill ask
    const job = ctx.R.roles[0];
    return { line: best.line.text, why: `your skills line mentions ${[...new Set(words)].slice(0, 2).join(' and ') || 'it'}${job && job.employer ? ` — did you do this at ${job.employer}?` : ' — did you do this in a job?'}` };
  }
  return { line: best.line.text, why: best.line.verbStart ? `your line says you ${lowerFirst(best.line.text.split(/\s*;\s*/)[0]).slice(0, 90).replace(/\s+\S*$/, '')}` : `your line names ${[...new Set(words)].slice(0, 2).join(' and ')}` };
}

function cmp(/** @type {number[]} */ a, /** @type {number[]} */ b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
