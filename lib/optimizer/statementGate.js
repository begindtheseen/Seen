// The DISPLAY GATE on requirement statements (R3, director 2026-11-10: "stop chasing every malformed line; make it
// impossible to SHOW one"). A rule-based reader will never parse every posting perfectly; what a person sees must
// nevertheless read right. Every statement gets:
//
//   confidence  'high'   — a bullet / numbered item, or its own line under a requirements / qualifications /
//                          responsibilities heading;
//               'medium' — a sentence in prose that carries a requirement cue (must, required, experience with/in,
//                          ability to, N+ years, proficient, a licence / certification / degree, "you will" + a duty)
//                          or an imperative duty under a duties heading;
//               'low'    — anything else (inferred from a flat run, a pitch, an about / benefits block).
//   display     true only when confidence is not low AND the text passes `validateStatement` (after the safe repairs
//               in statements.js: a run-on split at its boundary, a leading "And" dropped, a list cut at a comma
//               re-attached). A hidden statement keeps its facts: matching and the score are unchanged.
//   hideReason  why it is hidden (for the data and the audits; never printed).
//
// Pure, deterministic, linear regexes only (every pattern is pinned by a 5,000-repetition test).
import { REQUIREMENT_CUE_RE, isHeadingPhrase } from './postingSections.js';

// Words a statement never ends on: a joiner, a preposition, an article, an auxiliary.
export const BAD_END_RE = /\b(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|into|including|includes|include|such|like|e\.g|i\.e|via|than|that|which|who|while|both|either|your|our|their|is|are|be|will|can|has|have|was|across|within|through|over|between|about|around|without|towards?|per|after|before|during|under|upon|onto|among|using|whether|may|might|must|should|would|could|shall|along|where|when|so|not|does|do|you|you'll|you’ll|we|our|plus|nor|its|this|these|those|such|very|more|most|other|another|each|every|any|all|some)$/i;
// A statement never opens on a leftover of the line before it.
const LEFTOVER_START_RE = /^(?:and|or|but|also|plus|nor|then|so|as\s+well\s+as|including|includes|include|etc|e\.g|i\.e|which|who|that|while|whereas|with\s+(?:a|an|the)\s+(?:focus|emphasis))\b/i;
// a verb that needs an object: a statement that ends on one was cut ("Write and maintain")
const OBJECT_VERBS = new Set('write maintain develop design build create manage lead implement support perform provide ensure conduct prepare review deliver drive establish evaluate identify improve monitor operate oversee own coordinate execute define analyze analyse handle assist install repair inspect test track document communicate collaborate partner present negotiate sell train mentor coach supervise administer process organize organise schedule plan research recommend translate configure deploy integrate automate optimize enforce introduce implementing introducing developing maintaining managing building designing creating leading supporting providing ensuring conducting preparing reviewing delivering driving establishing evaluating identifying improving monitoring operating overseeing coordinating executing defining analyzing handling'.split(' '));
// the first / second person of a company pitch ("We move fast", "Our team values…", "Us")
const PITCH_SUBJECT_RE = /^(?:we|our|us|we['’](?:re|ll|ve|d))\b|\bwe\s+(?:are|were|will|have|had|do|did|can|could|would|need|want|offer|provide|value|believe|move|work|build|make|hire|seek|look|love|expect|ask|pay|support|encourage|invest)\b|\b(?:you['’]ll|you\s+will)\s+(?:be\s+(?:part|joining|working\s+with)|join|have\s+the\s+(?:chance|opportunity)|enjoy|get\s+to|receive|earn)\b/i;
// the company talking about itself or its process ("In 2025, Creatio was named to Inc.'s Best Workplaces list", "Pay may
// vary depending on…", "Affected employees will be expected to…", "Wells Fargo requires you to directly represent…")
const COMPANY_VOICE_RE = /^in\s+(?:19|20)\d\d\b|^this\s+(?:role|position|job|opportunity)\s+(?:is|will\s+be|offers|sits|reports)\b|\b(?:was|were|has\s+been|have\s+been|is|are)\s+(?:named|recognized|recognised|ranked|awarded|founded|headquartered|backed|funded|trusted|proud)\b|^(?:pay|compensation|salary|the\s+(?:pay|salary|base\s+pay))\s+(?:may|will|is|range|ranges|varies|depends)\b|^(?:affected\s+)?employees\s+(?:will|may|must|are)\b|\brequires\s+(?:you|candidates|applicants|all\s+(?:candidates|applicants))\s+to\s+(?:directly\s+)?represent\b|\bat\s+the\s+heart\s+of\b|\bour\s+(?:dna|mission|culture|values|story)\b/i;
// a line that opens on an imperative duty ("Represent our brand at events") may say "our"
const DUTY_IMPERATIVE_RE = /^(?:Represent|Support|Serve|Help|Assist|Grow|Build|Maintain|Manage|Lead|Train|Partner|Work|Collaborate|Drive|Develop|Design|Deliver|Own|Run|Ensure|Provide|Promote|Sell|Protect|Monitor|Operate|Coordinate|Handle|Answer|Greet|Care|Communicate|Educate|Advocate|Uphold|Follow|Use|Create|Write|Prepare|Present|Report|Track|Process|Clean|Stock|Inspect|Install|Repair|Test|Analy[sz]e|Review|Implement|Improve|Identify|Execute|Plan|Schedule|Organi[sz]e|Recruit|Hire|Onboard|Mentor|Coach|Supervise|Oversee|Direct|Engage|Contribute|Participate|Act|Champion|Explore|Expand|Scale|Launch|Ship|Shape|Define|Set|Keep|Respond|Resolve|Escalate|Meet|Exceed|Achieve|Close|Negotiate|Prospect|Convert|Generate|Conduct|Perform|Complete|Document|Record|Enter|Verify|Collect|Deploy|Configure|Integrate|Automate|Optimi[sz]e|Debug|Troubleshoot|Translate|Evaluate|Assess|Research|Investigate)\b/;
// a negative persona or an anti-requirement ("Leaders who need complete specifications before their team can start")
const PERSONA_RE = /^(?:(?:leaders|people|candidates|someone|anyone|those|individuals|engineers|managers|folks|applicants)\s+who\s+(?:need|want|prefer|require|expect|wait|insist|are\s+not|aren['’]t|don['’]t|do\s+not|can['’]t|cannot|won['’]t|struggle|avoid|get\s+frustrated))\b|^(?:this\s+(?:role|job|position|opportunity)\s+(?:is\s+not|isn['’]t)|not\s+(?:a\s+(?:good\s+|great\s+)?fit|for\s+you|for\s+(?:people|someone|those))|you\s+(?:won['’]t|will\s+not)\s+(?:enjoy|like|thrive|succeed)|you\s+(?:need|want|prefer)\s+(?:a\s+lot\s+of|constant|detailed|complete)\b)/i;
// a mid-text capitalised opener after a lower-case word: two bullets glued with no punctuation ("… execution focus
// Adaptable and resilient …", "Optical analysis tools such as Zemax Hands-on experience in optical design")
const GLUE_OPENERS = 'We|Our|This|These|The|You|Your|Candidates|Applicants|Experience|Experienced|Hands-on|Strong|Proven|Demonstrated|Demonstrable|Excellent|Exceptional|Outstanding|Ability|Able|Knowledge|Proficiency|Proficient|Familiarity|Familiar|Understanding|Expertise|Must|Minimum|Highly|Adaptable|Collaborative|Self-motivated|Self-starter|Detail-oriented|Comfortable|Willingness|Willing|Solid|Deep|Bachelor[\'’]?s|Master[\'’]?s|Required|Preferred|Substantial|Frequent|Occasional|Regular|Prior|Previous|Effective|Flexible|Reliable|Organized|Motivated|Passion|Passionate|Curious|Curiosity|Track|Working|Basic|Advanced|Intermediate|Fluent|Fluency|Bilingual|Valid|Current|Certified|Certification|Licensed|Availability|Available|Desire';
const GLUE_RE = new RegExp(`(?<=[a-z0-9%)][a-z0-9%)]?)\\s(?=(?:${GLUE_OPENERS})\\s+[a-z])`, 'g');
const GLUE_AFTER_NAME_RE = new RegExp(`(?<=\\b(?:[A-Z][a-z]{2,}|[A-Z]{2,6}))\\s(?=(?:Hands-on|Experience|Strong|Proven|Demonstrated|Excellent|Ability|Knowledge|Proficiency|Familiarity|Understanding|Expertise|Minimum|Must)\\s+(?:with|in|of|to|experience|knowledge|understanding|skills?|ability|communication|working|years?|proficiency)\\b)`, 'g');
// a sentence end inside a statement: "infrastructure for the Enterprise. Strong experience", "desired.Capable",
// "(… etc.) Enterprise/Domain Admin"
const ABBREV_BEFORE_DOT = /(?:\b(?:e\.g|i\.e|etc|vs|incl|approx|no|inc|ltd|co|corp|jr|sr|dr|mr|mrs|ms|st|u\.s|u\.k|a\.m|p\.m|ph\.d|b\.s|b\.a|m\.s|m\.a|yrs|hrs|min|max|avg|[A-Za-z]))$/i;
function sentenceBoundaries(text) {
  const t = String(text || '');
  const at = [];
  const re = /([.!?])(["”’']?\)?)(\s*)(?=["“(]?[A-Z][a-z]|["“(]?[A-Z]{2,}\b)/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 12), m.index);
    // "desired.Capable": no space is still a boundary between two words; "U.S.", "e.g. Kafka" are not
    if (m[1] === '.' && ABBREV_BEFORE_DOT.test(before) && !m[2] && !(!m[3] && new RegExp(`^(?:${GLUE_OPENERS})\\b`).test(t.slice(m.index + m[0].length)))) continue;
    // no space: a boundary between two words ("DNA.We’re", "U.S.Experience working")
    if (!m[3] && !/[A-Za-z]{2}$/.test(before) && !/^(?:[A-Z][a-z]+)/.test(t.slice(m.index + m[0].length))) continue;
    // a figure ("3.5 GPA") or a version ("Node.js") is no boundary
    if (/\d$/.test(before) && !m[3]) continue;
    at.push({ cut: m.index + m[1].length + m[2].length, next: m.index + m[0].length });
  }
  return at;
}

/** The pieces a run-on source line holds (split at sentence ends and glued bullets), or [the line] when it is one. */
export function splitRunOnStatement(source) {
  const t = String(source || '').replace(/\s+/g, ' ').trim();
  const cuts = [];
  for (const b of sentenceBoundaries(t)) cuts.push(b);
  for (const re of [GLUE_RE, GLUE_AFTER_NAME_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) cuts.push({ cut: m.index, next: m.index + m[0].length });
  }
  if (!cuts.length) return [t];
  cuts.sort((a, b) => a.cut - b.cut);
  const pieces = [];
  let start = 0;
  for (const c of cuts) {
    if (c.cut <= start) continue;
    pieces.push(t.slice(start, c.cut).trim());
    start = c.next;
  }
  pieces.push(t.slice(start).trim());
  // a piece of one or two words is not a requirement of its own ("Collaborative"): it stays with the piece before
  const out = [];
  for (const p of pieces.filter(Boolean)) {
    if (out.length && p.split(/\s+/).length < 3) out[out.length - 1] = `${out[out.length - 1]} ${p}`;
    else out.push(p);
  }
  return out.length ? out : [t];
}

const STOP = new Set('a an the and or of in on at to for with by from as is are be will can your our their this that these those you we it its into per via other related relevant strong excellent good great proven solid ability able skills skill experience knowledge understanding work working job role position team teams company environment level levels year years etc plus similar including such like must required preferred ideally including use using new all any some each every more most well also high highly'.split(' '));

/**
 * Is this statement text fit to show a person? Returns { ok, reasons } — reasons are short codes:
 * length, leftover_start, lowercase_start, bad_end, clipped, run_on, brackets, heading, pitch, persona,
 * not_physical, no_content.
 */
export function validateStatement(text, { source = '', kind = '' } = {}) {
  const t = String(text || '').trim();
  const reasons = [];
  const words = t.split(/\s+/).filter(Boolean);
  // two words pass only as a list of names ("PostgreSQL, Redis", "Claude Code", "GitLab CI")
  if ((words.length < 3 && !(words.length === 2 && words.every((w) => /^[A-Z0-9][\w.+#/-]*,?$/.test(w)))) || words.length > 22) reasons.push('length');
  if (!/^[A-Z0-9"“(]/.test(t)) reasons.push('lowercase_start');
  if (LEFTOVER_START_RE.test(t)) reasons.push('leftover_start');
  if (/[,;:&/–—-]$/.test(t) || BAD_END_RE.test(t.replace(/[.!?]+$/, ''))) reasons.push('bad_end');
  if (clipped(t, source)) reasons.push('clipped');
  if (sentenceBoundaries(t).length || (GLUE_RE.lastIndex = 0, GLUE_RE.test(t)) || (GLUE_AFTER_NAME_RE.lastIndex = 0, GLUE_AFTER_NAME_RE.test(t))) reasons.push('run_on');
  if (!balanced(t)) reasons.push('brackets');
  if (gluedHeading(t) || (words.length <= 6 && /\b(?:this|the)\s+(?:role|position|job|team)$/i.test(t)) || isHeadingPhrase(t.replace(/,\s*[A-Z][\w .-]{0,30}$/, ''))) reasons.push('heading');
  if (PITCH_SUBJECT_RE.test(t) || COMPANY_VOICE_RE.test(t) || (/\b(?:our|us)\b/.test(t) && !DUTY_IMPERATIVE_RE.test(t)) || /^your\s/i.test(t) || /^you(?:['’]re|\s+(?:are|get|can|may|might|could|love|enjoy|thrive|want|like|care|believe|know|see|join|work\s+with))\b/i.test(t)) reasons.push('pitch');
  if (PERSONA_RE.test(t) || PERSONA_RE.test(String(source || '').replace(/^[\s•*-]+/, ''))) reasons.push('persona');
  if ((kind === 'physical' || kind === 'schedule') && !PHYSICAL_OR_SCHEDULE_RE.test(`${t} ${source}`)) reasons.push('not_physical');
  if (!words.some((w) => { const x = w.toLowerCase().replace(/[^a-z0-9+#&'-]/g, ''); return x.length > 1 && !STOP.has(x); })) reasons.push('no_content');
  return { ok: reasons.length === 0, reasons };
}
GLUE_RE.lastIndex = 0;

// what a physical or schedule line names (a statement under "Physical demands" that names none of it — "Handle
// work-related stress", "Judgment, troubleshooting, problem-solving" — is not a physical demand)
const PHYSICAL_OR_SCHEDULE_RE = /\b(?:lift\w*|carry\w*|push\w*|pull\w*|stand\w*|sit|sitting|seated|walk\w*|climb\w*|bend\w*|stoop\w*|kneel\w*|crouch\w*|reach\w*|squat\w*|twist\w*|grasp\w*|grip\w*|lbs?|pounds?|kg|feet|ladders?|stairs|heights?|vision|visual|acuity|hearing|hear|see|speak|talk\w*|dexterity|hands?|wrists?|fingers?|arms?|repetitive|motions?|movement|physical\w*|sedentary|outdoors?|outside|weather|temperatures?|heat|cold|noise|noisy|loud|dust|fumes|chemicals|hazard\w*|ppe|protective|warehouse|freezer|cooler|driv\w*|vehicle|shifts?|schedules?|hours?|nights?|weekends?|holidays?|overtime|on-call|on\s+call|rotation|rotating|travel\w*|days?|week|weeks|evenings?|mornings?|overnights?|availability|available|full-time|part-time|flexib\w*|seasonal|per\s+diem|prn|weather|computer|screen|keyboard|telephone|phone|desk|office|environment|exposure|exposed|conditions?)\b/i;

function balanced(t) {
  let depth = 0;
  for (const ch of t) { if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') { depth--; if (depth < 0) return false; } }
  if (depth !== 0) return false;
  const dq = (t.match(/"/g) || []).length;
  const curlyOpen = (t.match(/“/g) || []).length, curlyClose = (t.match(/”/g) || []).length;
  return dq % 2 === 0 && curlyOpen === curlyClose;
}

/** A heading glued to the front or the end of a statement ("Qualifications Education High school diploma"). */
export function gluedHeading(text) {
  const w = String(text || '').replace(/[:.]+$/, '').split(/\s+/);
  for (let k = Math.min(5, w.length - 2); k >= 1; k--) {
    const head = w.slice(0, k).join(' ').replace(/:$/, '');
    if (/^[A-Z]/.test(head) && (w[k - 1].endsWith(':') || /^[A-Z]/.test(w[k] || '')) && isHeadingPhrase(head) && /^[A-Z]/.test(w[k] || '')) return true;
  }
  for (let k = Math.min(4, w.length - 2); k >= 1; k--) {
    const tail = w.slice(w.length - k).join(' ');
    if (/^[A-Z]/.test(tail) && /^(?:[A-Z][\w&'’/-]*|and|&|of)(?:\s+(?:[A-Z][\w&'’/-]*|and|&|of))*$/.test(tail) && isHeadingPhrase(tail) && /[a-z]$/.test(w[w.length - k - 1] || '')) return true;
  }
  return false;
}

/** Was the statement cut inside a phrase? (it ends on a verb waiting for its object, or "both X", or the source line
 * goes on with "and …", ", and …", "of …" right after the words the statement ends on) */
function clipped(t, source) {
  if (/\band\s+similar$/i.test(t)) return false;
  const words = t.replace(/[.!?]+$/, '').split(/\s+/);
  const last = (words[words.length - 1] || '').toLowerCase().replace(/[^a-z'-]/g, '');
  if (OBJECT_VERBS.has(last) && words.length <= 6) return true;
  if (/\b(?:both|either|neither|between)\s+[\w-]+$/i.test(t)) return true;
  const src = String(source || '').replace(/\s+/g, ' ');
  if (!src) return false;
  const tail = words.slice(-2).join(' ').replace(/[,.;:]+$/, '');
  if (!tail) return false;
  const lower = src.toLowerCase();
  const at = lower.lastIndexOf(tail.toLowerCase());
  if (at < 0) return false;
  const rest = src.slice(at + tail.length);
  // the statement already ends where the line ends, or at a clause the compression cuts on purpose
  if (!rest.trim() || /^\s*[.!?;:)]/.test(rest)) return false;
  return /^\s*(?:,\s*(?:and|or|&)(?:\/or)?\s|,\s[^,.;]{1,50}(?:,\s[^,.;]{1,50}){0,6},?\s(?:and|or|&)(?:\/or)?\s|(?:and|or)(?:\/or)?\s|&\s|\/|of\s|-\s?[a-z])/i.test(rest) && !/^\s*,?\s*(?:and|or)\s+(?:similar|other|related|equivalent|more)\b/i.test(rest);
}

// a requirement cue in prose (spec: must, required, experience with/in, ability to, N+ years, proficient, a licence /
// certification / degree, you will / you'll + a duty verb)
const PROSE_CUE_RE = /\b(?:must|required?|requires|experience\s+(?:with|in|of|as|using)|ability\s+to|able\s+to|\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)|proficien\w*|licen[sc]\w*|certif\w*|degree|diploma|bachelor\w*|master['’]?s|knowledge\s+of|knowledgeable\s+(?:of|in|about)|familiar\w*\s+with|skilled\s+in|expertise\s+in)\b|\byou(?:['’]ll|\s+will)\s+(?:also\s+)?[a-z]+/i;
const DUTY_START_RE = /^[A-Z][a-z]+(?:s)?\b/;

/**
 * Confidence of a statement from the STRUCTURE it was read from. `row` is the requirement row
 * ({ kind, explicit, origin }); `duty` says the line opens on an imperative duty verb.
 */
export function statementConfidence(row, source, { duty = false } = {}) {
  const r = row || {};
  const origin = r.origin || 'line';
  if (origin === 'bullet') return 'high';
  if (r.explicit && origin === 'line') return 'high';
  const src = String(source || '');
  if (PROSE_CUE_RE.test(src) || REQUIREMENT_CUE_RE.test(src)) return 'medium';
  if (r.kind === 'responsibilities' && duty && DUTY_START_RE.test(src.replace(/^[\s•*-]+/, ''))) return 'medium';
  if (r.explicit && (r.kind === 'requirements' || r.kind === 'preferred') && origin !== 'runon') return 'medium';
  return 'low';
}

/** Decide confidence + display on a statement in place. */
export function gateStatement(st, row, { duty = false } = {}) {
  const confidence = statementConfidence(row, st.source, { duty });
  const v = validateStatement(st.text, { source: st.source, kind: st.kind });
  st.confidence = confidence;
  st.display = confidence !== 'low' && v.ok;
  if (!st.display) st.hideReason = confidence === 'low' ? ['low_confidence', ...v.reasons].join(',') : v.reasons.join(',');
  else delete st.hideReason;
  return st;
}
