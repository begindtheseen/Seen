// Requirement STATEMENTS — the unit a person reads (director, 2026-11-10: "a person who read these postings would
// never list 'SE' or 'Training' as a requirement; they would restate each requirement line").
//
// One statement per requirement-bearing line of the posting (requirements, qualifications, duties; preferred marked).
// Its `text` is a faithful compression of that line: words only from the line itself, plus a closed list of
// connectives ("and similar", "plus"). The facts read from the line (skills, terms, constraints) are evidence INSIDE
// the statement; the verdict judges a statement from its facts (statementVerdicts).
//
//   statements: [{ id, text, source, kind: 'requirement'|'preferred'|'duty'|'schedule'|'physical', importance, factIds }]
//   verdict:    [{ id, text, status: 'shown'|'partly'|'not_shown'|'cannot_tell', evidence: [{ line, why }], missing: [words],
//                  kind, importance }]
import { REQUIREMENT_CUE_RE, RESPONSIBILITY_CUE_RE, WAIVER_SENTENCE_RE, PAY_SENTENCE_RE, levelText, isBoilerplate } from './postingSections.js';
import { judgeConcepts, askOf, statementConcepts, foldStem as fold, settleItems, traitLed } from './judgeStatement.js';
import { proofLines, notYetHeld, credentialLine } from './lineProof.js';
import { tokenize } from './lemma.js';
import { INSTANCE_CLASSES } from './fieldAliases.js';
import { escapeRegExp } from '../text/escapeRegExp.js';
import { gateStatement, splitRunOnStatement, BAD_END_RE as GATE_BAD_END_RE, PERSONA_RE, TRAIT_HEAD_RE, isDutyClause, statementShape } from './statementGate.js';

const EXPERIENCE_LEAD = /^(?:experience|knowledge|understanding|familiarity|proficiency|expertise|fluency|comfort|exposure)\s+(?:with|in|of|using|on|across|around)\s+/i;
// Lead-ins that say how much, not what ("Experience with", "Demonstrated experience", "You have", "Must have").
const LEAD_INS = [
  /^at\s+[A-Z][\w&.'’ -]{0,30},\s+you(?:['’]ll|\s+will)\s*:?\s*/i,
  /^as\s+(?:the|an?|our)\s+[^,]{2,60},\s+you(?:['’]ll|\s+will)\s+/i,
  /^(?:[A-Z]{2,}\s+){1,5}\+\s*/,
  /^in\s+this\s+(?:role|position),?\s+you(?:['’]ll|\s+will)\s+(?:also\s+)?/i,
  /^(?:(?:alongside|with|as\s+part\s+of)\s+[^,]{3,50},\s+)?you(?:['’]ll|\s+will)\s+(?:also\s+)?(?:be\s+responsible\s+for\s+|be\s+(?=[a-z]+ing\b))?/i,
  /^(?:the\s+)?[A-Z][\w ]{2,40}?\s+will\s+be\s+responsible\s+for\s+/,
  /^(?:as\s+an?\s+[A-Z][\w&/ -]{2,40}?,?\s+you\s+(?:must|will|should|need\s+to|have\s+to)\s+(?:be\s+)?)/,
  /^(?:as\s+an?\s+[^,]{2,60},\s+you(?:'ll|’ll|\s+will)\s+)/i,
  // (disjoint: the colon is optional and whitespace is consumed once — no ReDoS on "SKILLS\t\tDuties\t\tDuties…")
  /^(?:(?:Qualifications|Education|Experience|Requirements|Skills|Responsibilities|Duties|QUALIFICATIONS|EDUCATION|EXPERIENCE|REQUIREMENTS|SKILLS|DUTIES|RESPONSIBILITIES)(?:[ \t]{0,4}:)?[ \t]{1,8}){1,4}(?=[A-Z0-9])/,
  /^[A-Z]{4,}(?=[A-Z][a-z])/,
  /^with\s+(?=[a-z]+ing\b)/i,
  /^(?:the\s+ideal\s+candidate\s+(?:will\s+have|has|is|will\s+be)\s+)/i,
  /^(?:we(?:'re|’re|\s+are)\s+looking\s+for\s+(?:someone|a\s+candidate|candidates|people|a\s+person)\s+(?:with|who\s+(?:has|have|is|are|can))\s+)/i,
  /^(?:you\s+(?:have|bring|are|will\s+have|possess|'ll\s+have|’ll\s+have)\s+)/i,
  /^you['’]re\s+(?:(?:a|an)\s+)?/i,
  /^you\s+(?:have|hold|possess|bring)\s+(?:an?|the)\s+(?=\S+\s)/i,
  /^you\s+(?:need|must|should)\s+(?:to\s+)?(?:have|hold|possess)\s+(?:an?\s+)?/i,
  /^you\s+(?!(?:will|must|should|may|might|can|could|need|have|are|were|'ll|’ll)\b)(?=[a-z]+\s)/i,
  /^(?:candidates?\s+(?:must|should|will)\s+(?:have|possess|be)\s+)/i,
  /^(?:must\s+(?:have|possess|be\s+able\s+to|be)\s+)/i,
  /^(?:(?:a\s+)?(?:proven|demonstrated|documented|strong|solid)\s+track\s+record\s+(?:of|in|with)\s+)/i,
  /^(?:track\s+record\s+(?:of|in|with)\s+)/i,
  /^(?:(?:demonstrated|proven|strong|solid|excellent|exceptional|outstanding|deep|extensive|hands-on|working|in-depth|thorough|advanced|basic)\s+)+/i,
  EXPERIENCE_LEAD,
  /^(?:experience|expertise|background)\s+(?=[a-z]+ing\b)/i,
  /^(?:proficient|skilled|experienced|familiar|comfortable|versed)\s+(?:with|in|at|using)\s+/i,
  /^(?:ability|able)\s+to\s+/i,
  /^(?:comfort(?:able)?\s+(?:working\s+)?(?:with|in|on)\s+)/i,
];
// the level said after the requirement ("… is a strong plus", "… preferred", "… is required", "a plus, though we…"):
// the statement's importance says it, the text does not repeat it
const LEVEL_TAIL_RE = /(?:,?\s+(?:is|are|would\s+be)\s+(?:a\s+)?(?:strong\s+|big\s+|huge\s+|definite\s+)?(?:plus|bonus|preferred|required|desired|a\s+must|nice\s+to\s+have|helpful|advantageous|beneficial|an\s+asset|recommended|mandatory)|,?\s+(?:a\s+plus|strongly\s+preferred|preferred|required|desired|is\s+a\s+must))\b.*$/i;
// a location label run into the last bullet of a flat posting ("… or other providers US Remote")
const PLACE_TAIL_RE = /\s+(?:US\s+Remote|Remote(?:\s+US)?|Hybrid|On-?site|In-?office)\s*$/;
// Rationale after the requirement: cut at the first of these once the head carries 3+ words.
const RATIONALE_RE = /(?:,\s+(?:and\s+)?(?:has|have|is|are)\s|\s*[:;—–]\s+|\s+-\s+|,?\s+(?:in\s+order\s+to|so\s+that|to\s+ensure|to\s+help|which|that\s+(?:raise|make|help|allow|ensure)|with\s+the\s+ability\s+to|while\s+(?:maintaining|[a-z]{3,}ing)|as\s+needed|when\s+needed|when\s+necessary|as\s+required|ideally|preferably|rather\s+than)\b)/i;
const EXAMPLE_SIGNAL_RE = /\b(?:e\.g\.?|i\.e\.?|such\s+as|including|like|for\s+example)\b/i;
const BAD_END_RE = /\b(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|into|including|includes|include|such|like|e\.g|i\.e|via|than|that|which|who|while|both|either|your|our|their|is|are|be|will|can|has|have|was|across|within|through|over|between|about|around|without|towards?|per|after|before|during|under|upon|onto|among|using|whether|may|might|must|should|would|could|shall|along|where|when|so|not|does|do|you|you'll|you’ll|we|our)$/i;

function sentenceCase(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

// does the text after a cut go on with the list or phrase the cut sits in?
const LIST_GOES_ON_RE = /^(?:,?\s*(?:and|or|&|nor)(?:\/or)?\s|,\s[^,.;]{1,50}(?:,\s[^,.;]{1,50}){0,6},?\s(?:and|or|&)(?:\/or)?\s|\s+of\s|\/)/i;
/** Cut a long statement at the last whole-phrase boundary within `max` characters. */
function cutWhole(t, max) {
  const cands = [];
  const re = /,\s|\s(?=(?:and|or|with|for|in|to|by|while|through|across|using|including|on|at|within|from|via|as)\s)/g;
  let m;
  while ((m = re.exec(t)) && m.index <= max) cands.push(m.index);
  const ok = (i) => {
    const head = t.slice(0, i).replace(/[\s,]+$/, '');
    return head.split(/\s+/).length >= 4 && !BAD_END_RE.test(head) && !LIST_GOES_ON_RE.test(t.slice(i)) && !/\b(?:both|either|between)\s+[\w-]+$/i.test(head) && balancedParens(head);
  };
  for (let k = cands.length - 1; k >= 0; k--) if (ok(cands[k])) return t.slice(0, cands[k]);
  // no whole phrase fits: the old cut (the gate hides the statement when it reads clipped)
  const head = t.slice(0, max);
  const commas = [...head.matchAll(/,\s/g)].map((x) => x.index).filter((i) => t.slice(0, i).split(/\s+/).length >= 4);
  return commas.length ? t.slice(0, commas[commas.length - 1]) : head.replace(/\s+\S*$/, '');
}
function balancedParens(t) { return (t.match(/\(/g) || []).length === (t.match(/\)/g) || []).length; }

/** Keep at most three items of an example list, ending "and similar" when the posting signals examples. */
function trimExamples(t) {
  // a parenthetical
  t = t.replace(/\s*\(([^()]*)\)(?=([-‑]?))/g, (m0, inner, glued) => {
    const i = inner.trim();
    if (/^[A-Z][A-Za-z0-9&/+-]{1,9}s?$/.test(i)) return glued ? m0 : ''; // "(LOTO)" after its long form: the long form once
    const signal = EXAMPLE_SIGNAL_RE.test(i);
    const body = i.replace(/^(?:e\.g\.?|i\.e\.?|such\s+as|including|like|for\s+example)[,:]?\s*/i, '');
    const items = body.split(/\s*,\s*|\s+(?:or|and)\s+/).filter(Boolean);
    if (!signal && i.length > 45) return '';
    if (items.length > 3) return ` (${signal ? 'e.g. ' : ''}${items.slice(0, 3).join(', ')}${signal ? ' and similar' : ''})`;
    return ` (${i})`;
  });
  // a list after "including / such as / like"
  const m = t.match(/^(.*?\b(?:including|such\s+as|like)\s+)(.+)$/i);
  if (m) {
    const items = m[2].split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/).filter(Boolean);
    // the list ends where the line goes on to say why ("including AI tools, to work smarter, solve problems")
    const why = items.findIndex((x) => /^(?:to|which|that|while|so|in\s+order|as\s+well)\b/i.test(x));
    if (why > 0) t = `${m[1]}${items.slice(0, Math.min(why, 3)).join(', ')}${why > 3 ? ' and similar' : ''}`;
    else if (items.length > 3) t = `${m[1]}${items.slice(0, 3).join(', ')} and similar`;
  }
  return t;
}

// R4: a displayed statement is a WHOLE unit — a whole list item or a whole sentence. Only a leading filler (how much, never
// what) and a trailing parenthetical may go; nothing is cut inside a clause and no word is written into the line.
const UNIT_FILLERS = [
  /^(?:the\s+)?(?:ideal|successful|right|qualified)\s+(?:candidate|applicant|person|individual)s?\s+(?:will|should|must|would)\s+(?:have|be|possess|bring|demonstrate)\s+/i,
  /^(?:the\s+)?(?:ideal|successful|right|qualified)\s+(?:candidate|applicant|person|individual)s?\s+(?:has|have|is|are|possesses|brings)\s+/i,
  /^(?:candidates?|applicants?)\s+(?:must|should|will)\s+(?:have|possess|be|demonstrate)\s+/i,
  /^(?:you\s+(?:must|should|will|need\s+to)\s+(?:have|possess|hold|be)|you\s+(?:have|bring|possess|hold)|you['’](?:ll|ve)\s+(?:have|got))\s+/i,
  /^(?:you\s+(?:will|must|should|may)|you['’]ll)\s+(?:also\s+)?(?=[a-z]+\s)/i,
  /^must\s+(?:be\s+able\s+to|have|possess|hold)\s+(?!and\b)/i,
  /^(?:is|are|has|have)\s+(?=(?:an?\s+)?(?:proficient|skilled|experienced|familiar|comfortable|fluent|knowledgeable|hands-on|experience|expertise|strong|deep|solid|demonstrated|proven|working|\d))/i,
];
const BENEFIT_LABEL_RE = /^(?:time\s+off|pto|paid\s+time\s+off|vacation|holidays?|benefits?|perks?|compensation|pay|salary|insurance|health|medical|dental|vision|401\s?\(?k\)?|retirement|equity|bonus|wellness|parental\s+leave|learning|growth|remote|location|culture)$/i;
export function unitText(sentence) {
  let t = String(sentence || '').slice(0, 1500).replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9(“"$]+/, '').replace(/^(?:AND|OR)\s+[A-Z][A-Z ]{2,30}:\s*/, '').trim();
  // a short label before a colon names the requirement; the words after it are the requirement
  const lab = t.match(/^((?:[A-Z][\w’'&/-]*)(?:\s+[\w’'&/-]+){0,4}):\s+(\S.{8,})$/);
  // (only a short noun label goes — "Education:", "Required:"; a label that is itself a duty or a clause stays:
  // "Design and scale backend services: Architect Next.js API routes…" is one item)
  if (lab && !/\b(?:e\.g|i\.e|including|such as)$/i.test(lab[1])) {
    if (BENEFIT_LABEL_RE.test(lab[1])) t = `Benefit: ${lab[2]}`;
    else if ((lab[1].split(/\s+/).length <= 2 && !isDutyClause(lab[1])) || /^(?:(?:minimum|required|preferred|basic|desired|additional)\s+)?(?:degree|education|experience|skills?|certifications?|licen[sc]e|qualifications?|requirements?|knowledge|training)(?:\s+(?:required|preferred|level))?$/i.test(lab[1])) t = lab[2];
  }
  for (const re of UNIT_FILLERS) { const n = t.replace(re, ''); if (n !== t && n.split(/\s+/).length >= 2) { t = n; break; } }
  // a leading article left by a filler ("a valid licence") goes; the trailing parenthetical goes
  t = t.replace(/^(?:an?|the)\s+(?=\S+\s)/i, '');
  // (a trailing parenthetical stays: "(or eligibility)", "(Edius and/or Adobe Premiere)" are part of the requirement)
  t = t.replace(/\s+([,.;:])/g, '$1').replace(/[\s,;:–—-]+$/, '').replace(/\.$/, '').trim();
  // a location label glued onto the last item of a flat posting ("… or other providers US Remote")
  { const n = t.replace(PLACE_TAIL_RE, ''); if (n !== t && n.split(/\s+/).length >= 3) t = n; }
  return sentenceCase(t);
}

/** A faithful, readable compression of one posting line (words only from the line). */
export function compressStatement(sentence, { max = 150 } = {}) {
  // a teaser cut with an ellipsis ("Perform routine examinations, p…") ends at the last whole item
  // (a statement is ≤150 characters: nothing past the line's first 1,500 can reach it)
  let t = String(sentence || '').slice(0, 1500).replace(/[,;]?\s*\S{0,15}(?:…|\.\.\.)\s*$/, '').replace(/\s+/g, ' ').replace(/^[\s•▪◦·‣\-–*:;,]+/, '').replace(/^(?:AND|OR)\s+[A-Z][A-Z ]{2,30}:\s*/, '').trim();
  // a list continuation's leftover ("And experience in …", "Also …", "Plus …", "As well as …") is not part of the ask
  t = t.replace(/^(?:and|also|plus|as\s+well\s+as)\s+(?=\S)/i, '');
  // "Required field of study: A field relevant to the role…" / "Minimum education: Bachelor's degree…": a short label
  // before a colon says which requirement; the words after it are the requirement
  const lab = t.match(/^((?:[A-Z][\w’'&/-]*)(?:\s+[\w’'&/-]+){0,4}):\s+(\S.{8,})$/);
  if (lab && !/\b(?:e\.g|i\.e|including|such as)$/i.test(lab[1])) t = lab[2];
  // "one or more of: A, B, C" — the colon opens the list, it ends no clause
  t = t.replace(/\b((?:one|two|three|any|some|all|each|several)(?:\s+or\s+more)?\s+of(?:\s+the\s+following)?)\s*:\s*/i, '$1 ');
  // a line under "someone who …" ("Has hands-on experience with LLM APIs", "Is proficient in TypeScript")
  t = t.replace(/^(?:has|have|is|are)\s+(?=(?:an?\s+)?(?:proficient|skilled|experienced|familiar|comfortable|fluent|knowledgeable|hands-on|experience|expertise|strong|deep|solid|demonstrated|proven|working|\d))/i, '');
  const original = t;
  for (const re of LEAD_INS) {
    const n = t.replace(re, '');
    // "comfortable working in a fast-paced cleanroom" keeps its verb: what is left must not start with an article
    // and what is left must not start with a preposition ("Working hands-on in a mainstream ML stack" keeps its verb)
    // "Experience in repairs and dry docking" keeps its lead-in: a short remainder ("Repairs and dry docking",
    // "Multicultural working environment") no longer says it is an experience the person must have (R3)
    if (re === EXPERIENCE_LEAD && n !== t && n.replace(LEVEL_TAIL_RE, '').split(/\s+/).length < 5) continue;
    if (n.split(/\s+/).length >= 2 && !(n !== t && /^(?:a|an|the|this|our|in|on|at|with|for|of|to|from|by|into|across|within)\s/i.test(n))) t = n;
  }
  // "3+ years of professional experience in a hands-on manufacturing environment" → "3+ years in a hands-on …"
  t = t.replace(/\b(\d{1,2}\+?\s*(?:[-–]\s*\d{1,2}\s*)?years?)\s+(?:of\s+)?(?:(?:professional|relevant|related|direct|progressive|hands-on|prior|previous|recent|proven|demonstrated|industry)\s+)*experience\s+(in|with|as|at)\s+/i, '$1 $2 ');
  { const at = t.search(LEVEL_TAIL_RE); const n = (at >= 0 && (at >= t.length * 0.5 || t.slice(0, at).split(/\s+/).length >= 4) ? t.slice(0, at) : t).replace(PLACE_TAIL_RE, ''); if (n.split(/\s+/).length >= 3) t = n; }
  // rationale: once the head says the requirement
  const r = t.search(RATIONALE_RE);
  if (r > 0 && t.slice(0, r).split(/\s+/).length >= 3) t = t.slice(0, r);
  t = trimExamples(t);
  t = t.replace(/\s+([,.;:])/g, '$1').replace(/[\s,.;:–—-]+$/, '').trim();
  // posting casing carried mid-line ("a high School Diploma/ GED"): a common noun goes to lower case; names and acronyms stay
  t = t.replace(/(?<=[^\s.!?:]\s+)(School|Diploma|Degree|Experience|Skills?|Knowledge|Ability|Years?|Customer|Service|Equivalent|Certificate|Certification|License|Licence|Training|Communication|Management|Environment|Industry|Field|Related|Minimum|Preferred|Required|Strong|Excellent|Proven|Working|Basic|Advanced|Proficiency|Understanding)\b(?![-'’]?[A-Z])/g, (w) => w.toLowerCase()).replace(/\/\s+(?=[A-Z])/g, '/');
  // too long: cut at the last clause boundary before the limit that leaves a whole phrase — never inside a coordinated
  // list ("Lead the evaluation, design" from "…evaluation, design, and development of…"), never before the last
  // item ("…to identify both technical" from "…both technical and operational challenges"), never before an "of …"
  // complement ("Domain expertise in the areas" — R3)
  // (a statement of at most 22 words is kept whole a little past the limit: a whole requirement beats a cut one)
  if (t.length > max && !(t.split(/\s+/).length <= 22 && t.length <= max + 30)) t = cutWhole(t, max);
  // and never more than 22 words (the display gate's limit): the same whole-phrase cut, at the 22nd word
  if (t.split(/\s+/).length > 22) { const at = t.split(/\s+/).slice(0, 22).join(' ').length; t = cutWhole(t, at); }
  for (let k = 0; k < 4 && BAD_END_RE.test(t); k++) t = t.replace(/[\s,]*\b\S+$/, '');
  // a cut never drops the other way to meet the requirement ("… or related discipline OR 8 years of equivalent experience")
  { const alt = original.match(/\b(or)\s+((?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\+?\s+(?:\(\d+\)\s+)?years?\s+of\s+(?:[\w-]+\s+){0,3}?experience)\b/i);
    if (alt && !t.toLowerCase().includes(alt[2].toLowerCase())) t = `${t.replace(/[\s,.;:–—-]+$/, '')}, or ${alt[2]}`; }
  // an unclosed parenthesis left by a cut ("Commercial payer requirements (Understanding Medicare…") goes
  const open = t.lastIndexOf('('); if (open > t.lastIndexOf(')')) t = t.slice(0, open);
  if ((t.match(/\)/g) || []).length > (t.match(/\(/g) || []).length) t = t.replace(/\)\s*$/, '');
  t = t.replace(/[\s,.;:!–—-]+$/, '').trim();
  // never shorter than three words when the line itself is longer ("Hands-on HubSpot experience", not "HubSpot experience")
  if (t.split(/\s+/).length < 3 && original.split(/\s+/).length >= 3) {
    t = (original.length > max ? original.slice(0, max).replace(/\s+\S*$/, '') : original).replace(/[\s,.;:!–—-]+$/, '');
    for (let k = 0; k < 4 && BAD_END_RE.test(t) && t.split(/\s+/).length > 3; k++) t = t.replace(/[\s,]*\b\S+$/, '');
    // still ending on a joiner ("Partner deeply with"): the line up to its first clause boundary, else the line
    if (BAD_END_RE.test(t)) { const cl = original.split(/,\s|;\s|\s[—–-]\s/)[0]; t = (cl.length <= max ? cl : original.slice(0, max).replace(/\s+\S*$/, '')).replace(/[\s,.;:!–—-]+$/, ''); for (let k = 0; k < 6 && BAD_END_RE.test(t) && t.split(/\s+/).length > 2; k++) t = t.replace(/[\s,]*\b\S+$/, ''); }
  }
  return sentenceCase(t);
}

// an imperative opening a duty line (the verbs a duties list uses)
const DUTY_VERB_START_RE = /^(?:Grow|Achieve|Prospect|Convert|Expand|Sell|Generate|Exceed|Meet|Hit|Organi[sz]e|Store|Troubleshoot|Keep|Report|Communicate|Inspect|Install|Repair|Diagnose|Calibrate|Clean|Sanitize|Wash|Prepare|Cook|Bake|Serve|Greet|Answer|Respond|Resolve|Escalate|Collect|Verify|Validate|Review|Audit|Reconcile|Post|File|Enter|Record|Document|Track|Monitor|Schedule|Coordinate|Plan|Lead|Train|Coach|Mentor|Supervise|Manage|Oversee|Direct|Develop|Design|Build|Write|Draft|Edit|Create|Analy[sz]e|Research|Evaluate|Assess|Identify|Implement|Improve|Drive|Deliver|Transport|Move|Lift|Sort|Count|Weigh|Wrap|Label|Restock|Replenish|Merchandise|Display|Set|Order|Purchase|Negotiate|Sell|Present|Teach|Instruct|Tutor|Educate|Counsel|Administer|Dispense|Chart|Triage|Treat|Assemble|Fabricate|Weld|Solder|Wire|Test|Measure|Conduct|Participate|Attend|Work|Act|Partner|Collaborate|Ensure|Provide|Assist|Help|Support|Handle|Complete|Process|Operate|Maintain|Follow|Use|Utilize|Read|Interpret|Submit|Obtain|Specify|Procure|Promote|Represent|Guide|Escort|Check|Close|Open|Ship|Pack|Pick|Load|Unload|Receive|Scan|Stock|Ring|Balance|Bill|Invoice|Code|Deploy|Configure|Test|Debug|Own|Run|Execute|Launch|Manage|Recruit|Interview|Hire|Onboard|Advise|Consult|Liaise|Facilitate|Lead)\b/;
const PITCH_START_RE = /^(?:[A-Z][\w&]*(?:\s+[A-Z][\w&]*){0,3}\s+(?:provides|offers|is\s+(?:a|an|the|part|proud)|are\s+(?:a|an|the)|helps|builds|delivers|was\s+founded)\b|most\s+of\s+our\s|key\s+responsibilities\s+include|as\s+an?\s+[\w ]{2,40},\s+your\s+duties|together,|essential\s+functions|when\s+an?\s|as\s+[\w’'.-]+\s+\w+\s+(?:grows|expands|scales)\b|if\s+successful|\d+\s+years\s+of\s+(?:compassion|excellence|service|history|caring|innovation|tradition|growth|serving)|[A-Z][a-z]+\s+[A-Z]\.?,?\s+(?:RN|LPN|LVN|CNA|MD|NP|PA|BSN|MSN)$|\([^()]{2,30}\)$|due\s+to\b|[\w ,]{0,60}\bwill\s+play\s+(?:a|an)\s+[\w-]+\s+role\b|employees?\s+may\s+be\s+(?:required|asked)|[A-Z][a-z]+s\s+at\s+[A-Z]|when\s+you|how\s|why\s|what\s(?!you\s+(?:need|bring|have))|think\s+of|our\s|we\s|we['’](?:re|ll|ve|d)\s|your\s+(?:work|role|impact|day|team|career|growth|safety)\b|the\s+(?:science|team|company|role|position|work|mission|science)\s+(?:keeps|is|are|has|have|will|was)\b|as\s+(?:our|we|the\s+company|a\s+company)\b|rather\s+than|more\s+resources|even\s+if|if\s+you|however|but\s|not\s+all|research\s+shows|this\s+(?:is|role|position|job|team|means|makes)\b|these\s|there\s+(?:is|are|will)\b|here\s|it['’]s\s|they\s|you\s+(?:may|might|could)\s+be|you(?:['’]ll|\s+will)\s+(?:be\s+(?:part|joining|working\s+with)|join|have\s+the\s+(?:chance|opportunity))|join\s|learn\s+more|read\s+(?:more|about)|watch\s|check\s+out|click\s|visit\s|apply\s|note:|interested\b|in\s+this\s+role,?\s+you\s+(?:will|['’]ll)\s+(?:join|be\s+part)|at\s+[A-Z][\w&.'’-]*,\s+(?:we|you|our)\b)/i;
const STATEMENT_KIND = { requirements: 'requirement', preferred: 'preferred', responsibilities: 'duty', schedule: 'schedule', physical: 'physical' };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Statements from the posting's requirement rows (postingSections.requirementSentences) and the facts read from them.
 * Sets `statementId` on every fact whose evidence is one of the rows; facts read from the title are meta (none).
 */
export function buildStatements(rows, facts, { promiseRows = [], company = '' } = {}) {
  const out = [];
  const bySource = new Map();
  const list = rows || [];
  for (let ri = 0; ri < list.length; ri++) {
    let r = list[ri];
    // R4: a list item the reader split at semicolons for its levels is ONE displayed unit ("Run Executive Business Reviews
    // with customers; keep accurate notes on performance, risks, and trends.")
    let parts = null;
    if (r.whole && r.part === 0) {
      const ps = [r.sentence];
      let k = ri;
      while (list[k + 1] && list[k + 1].whole === r.whole && list[k + 1].part > 0) { ps.push(list[k + 1].sentence); k++; }
      // (kept whole only when every part is the same kind of item — "Run Executive Business Reviews…; keep accurate notes…";
      // "Architect reliable backends and APIs; familiarity with AWS … is important" is a duty and a requirement: two units)
      const duties = ps.filter((x) => isDutyClause(x)).length;
      const prefs = ps.filter((x) => STATED_PREFERENCE_RE.test(x)).length;
      if ((duties === ps.length || duties === 0) && (prefs === 0 || prefs === ps.length) && ps.length === k - ri + 1) { parts = ps; ri = k; r = { ...r, sentence: r.whole }; }
    }
    const src = String(r.sentence || '').trim();
    if (src.length < 6 || bySource.has(norm(src))) continue;
    const factsOf = (sentence) => facts.filter((f) => f.evidence && (sameSource(f.evidence, sentence) || (parts && sentence === src && parts.some((x) => sameSource(f.evidence, x)))));
    // a diploma line followed by "N years … or a degree": one requirement with its parts ("High school diploma, plus
    // 3+ years in a hands-on manufacturing environment or a bachelor's degree in engineering, math or science")
    const nx = list[ri + 1];
    if (nx && nx.kind === r.kind && /^(?:a\s+)?(?:high\s+school\s+diploma|ged|diploma)\b/i.test(src) && src.length < 90 && /\byears?\b[^.]*\bor\b[^.]*\b(?:degree|bachelor|associate|master)/i.test(nx.sentence)) {
      const both = `${unitText(src)}, plus ${unitText(nx.sentence).replace(/^./, (c) => c.toLowerCase())}`;
      const st = { id: `s${out.length + 1}`, ri, text: both, source: `${src} ${nx.sentence}`, sources: [src, nx.sentence], kind: STATEMENT_KIND[r.kind] || 'requirement', importance: r.importance === 'preferred' ? 'preferred' : 'required', factIds: [] };
      out.push(st); bySource.set(norm(src), st); bySource.set(norm(nx.sentence), st); ri++;
      continue;
    }
    // a sentence about the company, the team or the reader ("When you see what modern language models…", "Your work
    // will have a direct impact…", "Think of us as…") or a question states no requirement, whatever was read from it
    // (the terms read from such a line go with it — a pitch names no requirement; a constraint it states stays)
    const companyVoice = /^(?:we['’](?:re|ll|ve|d)|we|our)\s/i.test(src.replace(/^[\s•\-*]+/, '')) && !/\b(?:must|required|requires)\b/i.test(src);
    // "… will join the Accounting team, reporting directly to the Accounting Manager" says where the job sits, not what it asks
    const reportsTo = /\breporting\s+(?:directly\s+)?(?:in)?to\s+(?:the|our|a|an)\b/i.test(src) && !/\b(?:must|required|years?\s+of|ability\s+to|experience\s+(?:with|in))\b/i.test(src);
    // a persona the posting does NOT want ("Leaders who need complete specifications before their team can start") is
    // never a requirement: its words are not read as asks (R3)
    const persona = PERSONA_RE.test(src.replace(/^[\s•\-*]+/, ''));
    const pitch = persona || companyVoice || reportsTo || /^[A-Z][a-z]+s\s+at\s+[A-Z]/.test(src) || (PITCH_START_RE.test(src.replace(/^[\s•\-*]+/, '')) && !/\b(?:must\s+(?:have|possess|hold|be\s+able)|required|years?\s+of|ability\s+to|experience\s+(?:with|in))\b/i.test(src)) || /\?\s*["”]?\s*$/.test(src);
    if (pitch) {
      const fsP = factsOf(src);
      // the company's own voice ("We're placing Senior Developers (4+ yrs…) across …") is a pitch even with a figure in it
      const voice = /^(?:we['’](?:re|ll|ve|d)|we|our|this\s+(?:is|role|position|company))\s/i.test(src.replace(/^[\s•\-*]+/, ''));
      // (a condition said in the company's voice is still a condition: "We conduct background checks", "We require a valid RN licence")
      const condition = fsP.some((f) => f.factType === 'constraint' && ['background', 'certification', 'license', 'licence', 'schedule', 'physical', 'age', 'language', 'degree'].includes(f.kind));
      if (persona || (voice && !condition) || !fsP.some((f) => f.factType === 'constraint')) { for (const f of fsP) f._pitch = true; continue; }
    }
    // "other duties as assigned" asks for nothing a résumé could show; a line that is the job title is no requirement
    if (/^performs?\s+(?:all\s+)?other\s+(?:assigned\s+)?duties/i.test(src)) continue;
    if (/\bother\s+(?:related\s+|similar\s+|job[- ]related\s+)?(?:duties|tasks|responsibilities)\s+(?:as\s+)?(?:assigned|required|needed|directed|requested)\b/i.test(src) && src.length < 140) continue;
    // the pay ("Competitive wages: $65,000 - $80,000 + bonus opportunities") is never a requirement
    if (PAY_SENTENCE_RE.test(src) && !/\b(?:required|must|years?\s+of|experience\s+(?:in|with))\b/i.test(src)) continue;
    const fs = factsOf(src);
    // what the posting waives or promises ("No experience required!") is a promise, never a requirement
    if (WAIVER_SENTENCE_RE.test(src) && src.length < 120 && !/\b(?:must|but|however)\b/i.test(src)) {
      const st = { id: `s${out.length + 1}`, ri, text: unitText(src), source: src, sources: [src], kind: 'promise', importance: 'required', factIds: [] };
      out.push(st); bySource.set(norm(src), st);
      continue;
    }
    // a line with nothing read from it states a requirement only when it asks for something, or is a duty: under a
    // duties heading every line that opens on a verb ("Troubleshoot problems", "Keep the warehouse clean and organized")
    const bare = src.replace(/^[\s•\-*]+/, '');
    // a noun-phrase duty under a real duties heading ("Day-to-day handling of litigation cases", "Interaction with
    // expert witnesses …") is a duty too
    const nominalDuty = r.kind === 'responsibilities' && r.explicit && /^[A-Z][\w'’-]*(?:\s+[a-z][\w-]*)?(?:\s+(?:and|&)\s+[a-z]+)?\s+(?:of|with|for|in|on|to)\s+[a-z]/.test(bare) && bare.split(/\s+/).length >= 4 && bare.split(/\s+/).length <= 30;
    const dutyLine = r.kind === 'responsibilities' && (RESPONSIBILITY_CUE_RE.test(bare) || DUTY_VERB_START_RE.test(bare) || nominalDuty || (/^[A-Z]/.test(bare) && isDutyClause(bare) && bare.split(/\s+/).length >= 3));
    // a credential line with nothing the vocabulary knows ("RN/LVN with a current valid license to practice as issued by the
    // State Board of Nursing") still asks for something (R3)
    // a whole item under a requirements heading that parses as a requirement shape ("Punctual and dependable", "Safety
    // culture and mindset") asks for something even with no word the vocabulary knows (R4 display grammar)
    const shaped = r.explicit && ['requirements', 'preferred'].includes(r.kind) && (r.origin === 'bullet' || r.origin === 'line' || r.origin === 'sentence') && !isBoilerplate(bare) && !!statementShape(unitText(bare), { kind: 'requirement' });
    const asks = REQUIREMENT_CUE_RE.test(src) || dutyLine || r.skillItem || shaped || (r.explicit && /\b(?:licen[sc]e[ds]?|licensure|certifi(?:ed|cation|cate)|degree|diploma|clearance|registered)\b/i.test(src));
    if (!fs.length && !asks) continue;
    // a heading-like stub with nothing read from it ("Bonus points for:", "Certification and Licensing") is not a requirement
    if (!fs.length && !r.skillItem && !shaped && !(dutyLine && bare.split(/\s+/).length >= 2 && !/[:]$/.test(bare)) && (src.split(/\s+/).length <= 4 || /^(?:[A-Z][\w&'’-]*|and|&|of|the|for)(?:\s+(?:[A-Z][\w&'’-]*|and|&|of|the|for)){0,5}$/.test(src.replace(/[:.]$/, '')))) continue;
    // a lower-case continuation with no ask of its own ("equally comfortable in a boardroom…") belongs to the line before
    const prev = out[out.length - 1];
    if (prev && /^[a-z]/.test(src) && !REQUIREMENT_CUE_RE.test(src) && !fs.length) { prev.sources.push(src); bySource.set(norm(src), prev); continue; }
    // a run-on line (two bullets glued, a sentence end the splitter missed) is one statement per piece; the facts read
    // from the line go to the piece that names them (R3 display gate)
    const pieces = splitRunOnStatement(src);
    let made = 0;
    for (const [pi, piece] of pieces.entries()) {
      // a duty / requirement that owns an example list ("Architect and contribute to … development including: Compiler
      // front-end (…), Back-end (…)") reads as the lead alone; the examples stay in the source and its facts
      const lead = piece.match(/^(.{20,}?)\s*,?\s*(?:including|such\s+as|e\.g\.?)\s*:\s+\S/);
      const text = lead && lead[1].split(/\s+/).length >= 5 && (isDutyClause(lead[1]) || /^(?:experience|knowledge|proficien|ability|familiar)/i.test(lead[1])) ? unitText(lead[1]) : unitText(piece);
      if (!text || out.some((s) => norm(s.text) === norm(text))) continue;
      const pfs = pieces.length > 1 ? fs.filter((f) => factNamedIn(f, piece)) : fs;
      // a line of only heading words ("EXPERIENCE, SKILLS AND ABILITIES", "Required Education, skills, and knowledge")
      if (/^(?:(?:required|preferred|minimum|education|skills?|knowledge|abilities|experience|requirements?|qualifications?|competencies|and|&|,|\s)+)$/i.test(text)) { if (pieces.length === 1) for (const f of fs) f._pitch = true; continue; }
      // a single word ("Training") is a heading or a stray term, never a requirement a person would restate
      if (!/\s/.test(text) && !/^[A-Z][A-Z0-9&/+-]{1,9}$/.test(text)) { if (pieces.length === 1) for (const f of fs) f._pitch = true; continue; }
      // a broken fragment ("Partner deeply with") with nothing read from it is not a requirement
      if (!pfs.length && text.split(/\s+/).length < 3 && BAD_END_RE.test(piece.replace(/[\s.:;,]+$/, ''))) continue;
      // a requirement written under a duties heading ("You have a high school diploma or GED", "Organized and proficient in
      // Google Docs") is a requirement, not a duty (R3)
      const reqShaped = r.kind === 'responsibilities' && (STRONG_REQ_OPEN_RE.test(piece.replace(/^[\s•*-]+/, '')) || /^(?:successful(?:ly)?\s+(?:pass|complet)|you\s+(?:have|possess|hold)\b|you['’]ve\b)/i.test(piece.replace(/^[\s•*-]+/, '')));
      const st = { id: `s${out.length + 1}`, ri, text, source: pieces.length > 1 ? piece : src, sources: [pieces.length > 1 ? piece : src, ...(parts && pieces.length === 1 ? parts : [])], rowSource: src, row: pieces.length > 1 && pi > 0 ? { ...r, origin: 'glued' } : r, duty: dutyLine && !reqShaped, kind: reqShaped ? 'requirement' : (STATEMENT_KIND[r.kind] || 'requirement'), importance: reqShaped ? 'required' : pieceImportance(r, piece), factIds: [] };
      out.push(st);
      made++;
      if (made === 1) bySource.set(norm(src), st);
    }
  }
  // INVARIANT (R4, verdict gold): a plain bullet under a requirements / duties / preferred heading always becomes a
  // statement — displayed or hidden, never lost ("Patient and family education", "This role follows a hybrid schedule.").
  // A line the reader skipped above is kept here as its whole unit; what it is (a pitch, the pay, "other duties as
  // assigned", a heading stub) is the reason it is hidden, and anything else goes through the display gate like any line.
  for (let ri = 0; ri < list.length; ri++) {
    const r = list[ri];
    if (!isPlainItem(r)) continue;
    const src = String(r.sentence || '').trim();
    if (!/[A-Za-z]{2}/.test(src) || out.some((s) => (s.sources || []).some((x) => sameSource(src, x)) || (s.rowSource && sameSource(src, s.rowSource)))) continue;
    const bare = src.replace(/^[\s•\-*]+/, '');
    const text = unitText(src) || bare;
    const hide = plainItemHideReason(bare, text);
    const duty = r.kind === 'responsibilities';
    const st = { id: '', ri, text, source: src, sources: [src], rowSource: src, row: r, duty, kind: STATEMENT_KIND[r.kind] || 'requirement', importance: pieceImportance(r, src), factIds: [], plainHide: hide };
    let at = out.findIndex((o) => typeof o.ri === 'number' && o.ri > ri);
    if (at < 0) at = out.length;
    out.splice(at, 0, st);
  }
  out.forEach((s, i) => { s.id = `s${i + 1}`; });
  // a promise in the benefits / about lines ("No nights or weekends!", "No experience required!")
  for (const r of promiseRows || []) {
    const src = String(r.sentence || '').trim();
    if (src.length < 6 || src.length > 160 || !WAIVER_SENTENCE_RE.test(src) || /\b(?:must|but|however)\b/i.test(src) || out.some((s) => s.sources.some((x) => sameSource(src, x)))) continue;
    out.push({ id: `s${out.length + 1}`, text: unitText(src), source: src, sources: [src], kind: 'promise', importance: 'required', factIds: [] });
  }
  // what the posting waives or promises, read from any line ("No call - No nights - No weekends"): one statement per line
  for (const f of facts) {
    if (f.kind !== 'waived' || !f.evidence || out.some((s) => s.sources.some((src) => sameSource(f.evidence, src)))) continue;
    out.push({ id: `s${out.length + 1}`, text: unitText(f.evidence), source: f.evidence, sources: [f.evidence], kind: 'promise', importance: 'required', factIds: [] });
  }
  facts.forEach((f, i) => {
    if (!f.evidence || /^Job title:/i.test(f.evidence)) return;
    // a line read as several statements (a run-on split): the piece that names the fact, else the first
    const cands = out.filter((s) => s.sources.some((src) => sameSource(f.evidence, src)) || (s.rowSource && sameSource(f.evidence, s.rowSource)));
    const st = cands.length > 1 ? cands.find((s) => factNamedIn(f, s.source)) || cands[0] : cands[0];
    if (!st) return;
    f.statementId = st.id;
    st.factIds.push(f.normalizedLabel || `f${i}`);
  });
  // a requirement line that only states a physical demand or a schedule is that kind ("Lift up to 50 pounds")
  for (const st of out) {
    if (st.kind !== 'requirement' && st.kind !== 'preferred') continue;
    const fs2 = facts.filter((f) => f.statementId === st.id);
    if (!fs2.length || fs2.some((f) => f.factType !== 'constraint')) continue;
    if (fs2.every((f) => f.kind === 'physical')) st.kind = 'physical';
    else if (fs2.every((f) => f.kind === 'schedule')) st.kind = 'schedule';
  }
  // a promise the posting itself contradicts ("No experience required!" and "Minimum of 1 year of experience"): linked,
  // so a tool can say so
  for (const p of out.filter((x) => x.kind === 'promise')) {
    const what = /\bexperience\b/i.test(p.source) ? /\b(?:\d+\+?\s*(?:years?|months?)|experience\s+(?:in|with|as))\b/i : /\bdegree\b/i.test(p.source) ? /\b(?:degree|bachelor|associate)/i : /\b(?:nights?|weekends?|holidays?|overnights?)\b/i.test(p.source) ? /\b(?:nights?|weekends?|holidays?|overnights?)\b/i : null;
    if (!what) continue;
    const hits = out.filter((x) => x.kind !== 'promise' && x.importance === 'required' && what.test(x.source) && !WAIVER_SENTENCE_RE.test(x.source));
    if (hits.length) p.contradictedBy = hits.map((x) => x.id);
  }
  // the display gate: confidence from the structure the line came from, display only when it also reads right
  // (a line that says what an earlier displayed line already says — "Need to be patient, compassionate, and able to
  // work well in a team environment" / "Patient, compassionate, and able to work well in a team" — is hidden)
  for (const st of out) {
    if (st.kind === 'promise') { const v = gateStatement(st, { origin: 'line', explicit: true, kind: 'requirements' }); if (!v.display) st.display = false; continue; }
    gateStatement(st, st.row, { duty: st.duty, company });
    if (st.plainHide) { st.display = false; st.hideReason = [st.hideReason, st.plainHide].filter(Boolean).join(','); }
    // a requirement-shaped line in a duties list ("Ability to discuss cloud … credibly", "Holder of valid STCW
    // certifications", "Hands-on electromechanical technician with …") is a requirement
    // (only a line that OPENS as a requirement does — "N+ years …", "Experience with …", a degree / licence; a duty under a
    // responsibilities heading is a duty, R4)
    if (st.importance === 'duty' && st.shape && !['duty', 'ability'].includes(st.shape) && !isDutyClause(st.text)) { st.importance = 'required'; st.kind = 'requirement'; }
    // a "Label: duty" line ("Testing strategies at scale: Ensure quality by designing robust … testing strategies") is a duty
    // by its own words, wherever it sits (never under a preferred heading)
    { const lab = String(st.source || '').match(/^[^:]{3,70}:\s+([A-Z][a-z]+)\b/); if (lab && st.importance === 'required' && st.kind === 'requirement' && isDutyClause(lab[1]) && !/^(?:experience|knowledge|skills?|education|requirements?|qualifications?)\b/i.test(st.source)) { st.importance = 'duty'; st.kind = 'duty'; } }
    if (st.display) {
      const mine = stemSet(st.text);
      const twin = out.find((o) => o !== st && o.display && o.kind !== 'promise' && out.indexOf(o) < out.indexOf(st) && nearSame(mine, stemSet(o.text)));
      if (twin) { st.display = false; st.hideReason = 'duplicate'; }
    }
  }
  for (const s of out) { delete s.sources; delete s.rowSource; delete s.row; delete s.duty; delete s.ri; delete s.plainHide; }
  return out;
}
/** A plain list item under a requirements / duties / preferred heading (the invariant's subject). */
export function isPlainItem(r) {
  return !!(r && r.explicit && ['requirements', 'preferred', 'responsibilities'].includes(r.kind) && (r.origin === 'bullet' || r.origin === 'line'));
}
/** Why a plain item the reader skipped is hidden (null = let the display gate decide). */
function plainItemHideReason(bare, text) {
  if (/\bother\s+(?:related\s+|similar\s+|job[- ]related\s+|assigned\s+)?(?:duties|tasks|responsibilities)\b/i.test(bare)) return 'other_duties';
  if (PAY_SENTENCE_RE.test(bare) && !/\b(?:required|must|years?\s+of|experience\s+(?:in|with))\b/i.test(bare)) return 'pay';
  if (PERSONA_RE.test(bare)) return 'persona';
  if (/\?\s*["”]?\s*$/.test(bare)) return 'question';
  if (/^(?:(?:required|preferred|minimum|education|skills?|knowledge|abilities|experience|requirements?|qualifications?|competencies|and|&|,|\s)+)$/i.test(text.replace(/[:.]$/, ''))) return 'heading';
  if (/:$/.test(bare)) return 'heading';
  if (!/\s/.test(text) && !/^[A-Z][A-Z0-9&/+-]{1,9}$/.test(text)) return 'one_word';
  return null;
}
function nearSame(a, b) {
  if (a.size < 2 || b.size < 2) return false;
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / Math.min(a.size, b.size) >= 0.85 && inter / Math.max(a.size, b.size) >= 0.6;
}
const STRONG_REQ_OPEN_RE = /^(?:(?:a\s+)?(?:minimum|at\s+least)\b|\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|(?:one|two|three|four|five|six|seven|eight|nine|ten)\b[^.]{0,20}\byears?\b|(?:\w+\s+){0,2}experience\s+(?:with|in|as|of)\b|(?:a\s+)?(?:bachelor|master|associate|high\s+school|degree|diploma|ged)|(?:valid|current|active)\s+[\w\s]{0,30}(?:licen[sc]e|certification)|holders?\s+of|must\s+(?:have|hold|possess|be)\b)/i;
/** A piece of a split line keeps the line's level unless the level came from another piece ("(high-voltage experience
 * preferred)" makes the rest of the sentence no less required) */
function pieceImportance(r, piece) {
  if (r.importance === 'responsibility') return 'duty';
  if (r.kind === 'preferred') return 'preferred';
  if (r.importance !== 'preferred') return 'required';
  // R4: a statement is preferred only when the line SAYS so ("preferred", "a plus", "nice to have", "bonus", "desired");
  // "Familiarity with …", "exposure to …" or an "ideally …" aside under a requirements heading is a requirement
  const lt = levelText(piece).replace(/[-–—(,]\s*ideally\b[^.;)]*\)?/gi, ' ').replace(/\((?!\s*(?:strongly\s+)?(?:preferred|a\s+plus|desired|nice\s+to\s+have|optional|bonus)\s*\))[^()]{0,160}\)/g, ' ');
  return STATED_PREFERENCE_RE.test(lt) && !/\b(?:required|must)\b/i.test(lt) ? 'preferred' : 'required';
}
const STATED_PREFERENCE_RE = /\b(?:prefer(?:red|ably)?|helpful|nice[- ]to[- ]haves?|(?:is\s+)?a\s+(?:big\s+|huge\s+|strong\s+|definite\s+)?plus|bonus|desired|desirable|advantage(?:ous)?|beneficial|an\s+asset|(?:is|are)\s+recommended|not\s+(?:required|mandatory))\b/i;
/** Does a statement's source line name this fact (its label or one of its posting phrases)? */
function factNamedIn(f, text) {
  const t = String(text || '').toLowerCase();
  if (f.factType === 'constraint') {
    if (f.kind === 'years') return /\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?(?:years?|yrs?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/i.test(t);
    if (f.kind === 'degree') return /\b(?:degree|diploma|ged|bachelor|associate|master|ph\.?d|doctorate|mba|high\s+school)/i.test(t);
  }
  return [f.label, ...(f.postingPhrases || [])].filter(Boolean).some((p) => t.includes(String(p).toLowerCase()));
}
/**
 * THE requirement count (R3/R4; coordinator: "one count everywhere, the one the person sees"): every DISPLAYED statement,
 * every kind — never a promise or a hidden line. `runOptimizer().requirement_count` is this number; every screen and every tool
 * (Job Insights' probe included) prints it or calls this on the same `statements` — never its own count.
 */
export function displayedRequirementCount(statements) {
  return displayedRequirements(statements).length;
}
/** The statements that count (see displayedRequirementCount), in posting order. */
export function displayedRequirements(statements) {
  // R4 (director): the count is what the person SEES — every displayed statement, every kind (schedule and physical lines
  // included); never a promise (those are not judged) or a hidden line
  return (statements || []).filter((s) => s && s.display !== false && s.kind !== 'promise');
}
/** Is a fact's evidence (a row sentence, possibly cut at 240) this source line? */
export function sameSource(evidence, source) {
  const a = norm(evidence), b = norm(source);
  if (!a || !b) return false;
  return a === b || (a.length >= 40 && b.startsWith(a)) || (b.length >= 40 && a.startsWith(b));
}

/**
 * The verdict per statement (R2, director 2026-11-10: "every duty and skill statement must be judged against the résumé's
 * lines directly"). See judgeStatement.js for the rule. In short:
 *   • a promise / waiver is never judged (it is left out of the verdict list; `facts.statements` keeps it);
 *   • physical ability, schedule, eligibility, a soft trait or a language nobody lists → 'cannot_tell' with
 *     `ask: { kind: 'physical'|'schedule'|'eligibility'|'trait'|'language', text }`;
 *   • everything else is judged on its concepts: the reader's facts (any-of groups need one) plus the line's own
 *     specific words, each shown on ONE résumé line → 'shown' / 'partly' (naming what is missing) / 'not_shown';
 *   • constraints keep their own grade (G's constraints.js), with the résumé line that meets them as evidence
 *     (the education line, the licence line, the dated roles counted for a years figure). A years figure counted from
 *     the whole career never proves a statement whose own subject the résumé does not show.
 * Evidence entries are `{ line, why }`, `line` omitted when there is no résumé line (never null).
 */
export function statementVerdicts(statements, matches, constraints, facts = [], { resumeText = '' } = {}) {
  const WHY = { exact: (m) => `shows ${m.surface}`, alias: (m) => `shows ${m.surface}, in other words`, title: (m) => `your job title shows ${m.surface}`, field: (m) => `${m.surface} comes with your field`, related: (m) => `close to ${m.surface}` };
  const out = [];
  for (const st of statements || []) {
    if (st.kind === 'promise') continue;
    const ms = (matches || []).filter((m) => m.statementId === st.id);
    const cs = (constraints || []).filter((c) => c.statementId === st.id && c.kind !== 'waived');
    const consKinds = cs.map((c) => c.kind);
    const judgedCons = cs.filter((c) => ['degree', 'years', 'certification', 'management', 'seniority', 'licence', 'license', 'language', 'gpa'].includes(c.kind));
    const hardFacts = ms.filter((m) => !(m.soft || m.kind === 'trait'));
    // 0. a trait line ("Embraces emerging technologies…"): shown on a line that names the trait, else asked (a line that
    // OPENS on the trait is one even when the reader read an example from it — "including AI tools")
    if (!judgedCons.length && TRAIT_HEAD_RE.test(st.text) && (!hardFacts.length || (TRAIT_OPEN_RE.test(st.text) && !hardFacts.some((m) => m.matched)))) {
      const l = traitLine(st.text, resumeText);
      out.push(l ? row(st, 'shown', [{ line: l, why: 'names it' }], []) : row(st, 'cannot_tell', [], [], { kind: 'trait', text: lowerFirst(st.text) }));
      continue;
    }
    // 1. what only the person can say
    if (!judgedCons.length && !hardFacts.some((m) => m.matched)) {
      const ask = askOf(st, resumeText, consKinds);
      if (ask) {
        // a place the posting names: the résumé's own city is part of it (the in-person commitment is still theirs to say)
        if (ask.status) { out.push(row(st, ask.status, ask.line ? [{ line: ask.line, why: ask.why }] : [], ask.missing ? [ask.missing] : [], ask.status === 'partly' ? { kind: 'schedule', text: ask.text } : undefined)); continue; }
        if (ask.line) { out.push(row(st, 'shown', [{ line: ask.line.text, why: ask.kind === 'language' ? `lists ${ask.language}` : 'shows it' }], [])); continue; }
        out.push(row(st, 'cannot_tell', [], [], { kind: ask.kind, text: ask.text }));
        continue;
      }
    }
    // 2. the reader's facts, one concept per any-of group
    const items = [];
    const groups = new Map();
    for (const m of ms) { const k = m.anyOf || m.requirement; groups.set(k, [...(groups.get(k) || []), m]); }
    const exm = String(st.text).match(/\s*\((?:e\.g\.?|i\.e\.?|such\s+as|including|like)[,:]?\s*([^()]+)\)|,?\s+(?:including|such\s+as|like|e\.g\.?|for\s+example)[,:]?\s+(.+)$/i);
    const exampleText = exm ? (exm[1] || exm[2] || '') : '';
    const mainText = exm ? String(st.text).replace(exm[0], ' ') : String(st.text);
    // examples are alternatives only when the line names what they illustrate ("Computer systems, including CRM
    // software": "computer systems" is generic, so CRM software IS the ask)
    const mainAsks = !!exampleText && statementConcepts(mainText).all.length > 0;
    const inPart = (ph, part) => { const want = stemSet(ph); const have = stemSet(part); return want.size > 0 && [...want].every((x) => have.has(x)); };
    const inText = (surface) => { const want = stemSet(surface); return want.size > 0 && [...want].every((x) => stemSet(st.text).has(x)); };
    let softFacts = 0;
    const locked = new Set();
    for (const g of groups.values()) {
      for (const m of g) for (const ph of [m.surface, ...(m.postingPhrases || [])]) for (const x of stemSet(ph)) locked.add(x);
      const met = g.find((m) => m.matched);
      // a soft skill the fit check matched is shown here too (the verdict and the statement never disagree); an unmatched
      // soft skill is not asked of a résumé
      if (g.every((m) => m.soft || m.kind === 'trait')) {
        softFacts++;
        if (met) items.push({ fact: true, soft: true, got: met.inferred || met.via === 'related' ? 1 : 2, weak: false, display: met.surface, line: met.evidence && !met.inferred ? met.evidence : null, why: (WHY[met.via] || WHY.exact)(met), inferred: !!met.inferred });
        continue;
      }
      const named = g.find((m) => inText(m.surface)) || g.find((m) => (m.postingPhrases || []).some(inText));
      // an example the line gives ("Root cause analysis (e.g. Fishbone, 8D, A3)") is one way to show it, never asked by itself
      const isExample = exampleText && mainAsks && g.every((m) => [m.surface, ...(m.postingPhrases || [])].some((ph) => inPart(ph, exampleText)) && ![m.surface, ...(m.postingPhrases || [])].some((ph) => inPart(ph, mainText)));
      if (isExample && !met) continue;
      // an example proves its head only when the résumé line holds the example's own word ("cleaning" is not "clean record")
      if (isExample && met && !(met.evidence && [met.surface, ...(met.postingPhrases || [])].some((ph) => new RegExp(`(?<![A-Za-z])${escapeRegExp(String(ph))}`, 'i').test(met.evidence)))) continue;
      // a fact the statement's text does not name (cut with the line's tail) is not asked here — and proves it only when
      // it is one of the line's own examples ("… including scissor lifts, forklifts, hand trucks, electric dollies")
      // (a fact read from the line's tail that the fit check MATCHED still counts: the verdict and the statement agree)
      if (!named && !met) continue;
      const label0 = named ? ((named.postingPhrases || []).find(inText) || named.surface) : g[0].surface;
      // in the statement's own casing ("CRM software", never "crm software")
      const at = String(st.text).toLowerCase().indexOf(String(label0).toLowerCase());
      const label = at >= 0 ? String(st.text).slice(at, at + String(label0).length) : label0;
      // "close to X" (a related skill) is part of the way there, never proof
      items.push({ fact: true, got: met ? (met.via === 'related' ? 1 : 2) : 0, weak: false, display: g.length > 1 && !met ? `one of ${g.map((m) => m.surface).join(', ')}` : label,
        line: met && met.evidence && !met.inferred ? met.evidence : null, why: met ? (WHY[met.via] || WHY.exact)(met) : null, inferred: !!(met && met.inferred) });
    }
    // 3. the line's own words
    // a statement a constraint reads (a degree, years, a licence) is judged by that constraint and its facts only
    // (a years figure alone does not stand in for its subject: "1–3 years in loan processing or mortgage operations" is
    // judged on "loan processing", "mortgage operations" too — a nurse's dated roles never prove it)
    const onlyYears = judgedCons.length > 0 && judgedCons.every((c) => c.kind === 'years');
    const j = judgedCons.length && !onlyYears ? { concepts: [], anyOf: false }
      : judgeConcepts(onlyYears ? st.text.replace(YEARS_PHRASE_RE, ' ') : st.text, resumeText, { locked });
    for (const c of j.concepts) {
      // what the line shows, in the posting's words: the class it is an instance of, or the words it holds
      const display = c.got === 2 && c.classIds && c.classIds.length && c.line && !c.stems.every((x) => c.line.jstems.has(x)) ? classPhrase(c) : (c.shownAs || c.surface);
      items.push({ fact: false, single: c.kind === 'object' && c.stems.length === 1 && !(c.classIds && c.classIds.length && c.line && c.line.classes && c.classIds.some((id) => c.line.classes.has(id))), got: c.got, weak: c.kind === 'verb' ? WEAK_VERB(c.head) : c.stems.every((x) => WEAK_VERB(x)), display, missingText: c.kind === 'verb' && c.surface === 'put' ? 'put away' : c.surface,
        line: c.line ? c.line.text : null, why: c.got === 2 ? `shows ${display}` : c.got === 1 ? `shows ${c.shownWords || headWord(c)}` : null, qualifier: !!c.qualifier });
    }
    // 4. constraints: their own grade, with the résumé line(s) behind it
    const orDegree = (facts || []).some((f) => f.factType === 'constraint' && f.kind === 'degree' && f.statementId === st.id && Array.isArray(f.alternatives) && f.alternatives.some((a) => a.years && !a.degree));
    const subjectShown = items.some((i) => i.got > 0 && !i.weak);
    const subjectAsked = items.filter((i) => !i.qualifier).length > 0;
    const gateGrades = [];
    for (const c of judgedCons) {
      if (orDegree && c.kind === 'years' && !c.gate) continue;
      // a constraint read from words the statement does not show (a run-on line cut short) does not decide it
      if (!constraintInText(c, st.text)) continue;
      const grade = c.statementStatus || (c.status === 'met' ? 'shown' : c.status === 'unmet' ? 'not_shown' : 'cannot_tell');
      if (grade === 'cannot_tell') continue;
      // (the gates engineer's years rows carry their own subject: `scope`, `counted` = exactly the roles summed — [] when
      // nothing on the résumé names the subject —, `nearest`, `lookedFor`; the line takes that grade — one status per line)
      void subjectShown; void subjectAsked;
      gateGrades.push(grade);
      const ev = constraintEvidence(c, resumeText);
      // a credential listed as not yet held ("CPA Candidate"): `missing` says so (constraints.js `pending`)
      items.push({ fact: true, got: grade === 'shown' ? 2 : grade === 'partly' ? 1 : 0, display: c.label, evidence: ev, why: c.message || c.sentence,
        ...(c.pending ? { missingText: `${String(c.label || '').replace(/^(?:an?|the)\s+/i, '')} — you list ${c.pending}` } : {}) });
    }
    // a credential the cited line says is not yet held ("CPA Candidate", "REG in progress") is part of the way there,
    // never shown: the line stays as evidence and `missing` says what is not held
    for (const i of items) {
      if (i.got < 1) continue;
      const lines = i.evidence ? i.evidence.map((e) => e.line).filter(Boolean) : [i.line].filter(Boolean);
      const label = String(i.display || '').replace(/^(?:an?|the)\s+/i, '');
      const q = lines.length ? lines.map((l) => notYetHeld(l, label)).find(Boolean) : null;
      if (!q) continue;
      // (a constraint already graded "partly" for it keeps its own sentence; `missing` still says what is not held)
      i.missingText = `${label} — you list ${q}`;
      if (i.got === 2) { i.got = 1; if (i.evidence) i.evidence = i.evidence.map((e) => ({ ...e, why: `you list ${q}` })); else i.why = `you list ${q}`; }
    }
    // the gist (V): every core item shown and at least half of the rest → the rest is not held against the line
    items.splice(0, items.length, ...settleItems(st.text, items, { gate: judgedCons.length > 0 }));
    // 5. the verdict
    // a half match with no résumé line to show for it is no match; a line of only qualifiers is judged on them
    for (const i of items) if (i.got > 0 && !i.line && !(i.evidence && i.evidence.length) && !(i.fact && i.inferred)) i.got = 0;
    let real = items.filter((i) => !i.qualifier || i.got > 0);
    if (!real.length && items.length) real = items;
    if (!real.length) {
      // nothing a résumé line could show: a soft trait (or a line of generic words)
      out.push(row(st, 'cannot_tell', [], [], { kind: 'trait', text: lowerFirst(st.text) }));
      continue;
    }
    // "Retail experience or service industry background": one of the alternatives is enough
    // every fact the reader read from the line is matched: the line is shown unless a NAMED part is missing (a phrase,
    // an acronym, a product name) — never for a stray word ("clinic", "Outcomes")
    if (real.some((i) => i.fact && !i.soft) && real.filter((i) => i.fact).every((i) => i.got === 2 && !i.inferred)) {
      real = real.filter((i) => i.fact || i.got > 0 || !i.single || /^[A-Z][A-Z0-9&/+.-]{1,9}$|^[A-Z][a-z0-9]+[A-Z]/.test(String(i.display || '')));
    }
    const anyOfList = j.anyOf || (/\bor\b/i.test(st.text) && !/\band\b/i.test(st.text) && !judgedCons.length);
    const full = real.filter((i) => i.got === 2 && !i.inferred);
    const half = real.filter((i) => i.got === 1 || (i.got === 2 && i.inferred));
    // partly needs something real: a fact the reader read, a phrase of two or more words, a specific verb ("scan"), or
    // two single words — one common word alone ("hire", "evidence", "cleaning", "payments") proves nothing
    const strong0 = [...full, ...half].filter((i) => !i.weak);
    const single = strong0.filter((i) => !i.fact && i.single);
    const strong = strong0.filter((i) => i.fact || !i.single).concat(single.length >= 2 ? single : []);
    let status;
    // the alternatives are the line's objects; a fact the line names outside them (the verb: "Selling to data teams,
    // developers or technical buyers") is still asked
    const factItems = real.filter((i) => i.fact);
    const objItems = real.filter((i) => !i.fact);
    const anyShown = anyOfList && (factItems.length && objItems.length
      ? factItems.every((i) => i.got === 2 && !i.inferred) && objItems.some((i) => i.got === 2)
      : full.length > 0);
    if (anyOfList ? anyShown : full.length === real.length) status = 'shown';
    else if (strong.length) status = 'partly';
    else status = 'not_shown';
    // evidence: one entry per résumé line, saying what it shows
    const evidence = [];
    const add = (line, why) => {
      if (!why) return;
      if (!line) { if (!evidence.some((e) => e.why === why)) evidence.push({ why }); return; }
      const e = evidence.find((x) => x.line === line);
      const sentence = (w) => /^[A-Z]/.test(w);
      if (!e) evidence.push({ line, why });
      // a constraint's own sentence says it all; two short reasons on one line are joined
      else if (sentence(why)) e.why = why;
      else if (!sentence(e.why) && !e.why.toLowerCase().includes(why.replace(/^shows /, '').toLowerCase()) && !why.toLowerCase().includes(e.why.replace(/^shows /, '').toLowerCase())) e.why = `${e.why} and ${why.replace(/^shows /, '')}`;
      else if (!sentence(e.why) && why.length > e.why.length && why.toLowerCase().includes(e.why.replace(/^shows /, '').toLowerCase())) e.why = why;
    };
    if (status !== 'not_shown') for (const i of [...full, ...half]) {
      if (i.evidence) for (const e of i.evidence) add(e.line, e.why); else if (!i.inferred) add(i.line, i.why);
    }
    // ONE STATUS PER LINE (G2): a line a gate judged (years, degree, licence, certification) reads as the gate graded it — a
    // person never sees a requirement met in the verdict and "not shown" in the list
    if (gateGrades.length) {
      const g = gateGrades.every((x) => x === 'shown') ? 'shown' : gateGrades.every((x) => x === 'not_shown') ? 'not_shown' : 'partly';
      if (g !== status) {
        status = g;
        if (status === 'not_shown') evidence.length = 0;
        if (status === 'partly') for (const i of real) if (i.fact && i.evidence && i.got === 1) for (const e of i.evidence) add(e.line, e.why);
        if (status !== 'not_shown' && !evidence.length) for (const i of [...full, ...half]) { if (i.evidence) for (const e of i.evidence) add(e.line, e.why); else if (!i.inferred) add(i.line, i.why); }
      }
      // (a not-shown line carries no evidence — the gate's own sentence is in `constraints`)
      if (status === 'not_shown') evidence.length = 0;
    }
    let missing = status === 'shown' ? [] : dedupeMissing(real.filter((i) => i.got < 2 || i.inferred).map((i) => wholeWordsOf(i.missingText || i.display, st.text)).filter(Boolean));
    if (status !== 'shown' && !missing.length) missing = real.filter((i) => i.fact && i.got < 2).map((i) => i.missingText || i.display).filter(Boolean);
    // a statement led by a trait ("Detail-oriented and disciplined when…", "Time management and multitasking") that no line
    // demonstrates is the person's to say, never "not shown" (V)
    if (status === 'not_shown' && !gateGrades.length && traitLed(st.text)) { out.push(row(st, 'cannot_tell', [], [], { kind: 'trait', text: lowerFirst(st.text) })); continue; }
    out.push(row(st, status, evidence.slice(0, 3), missing));
    void softFacts;
  }
  return out;
}

const YEARS_PHRASE_RE = /\b(?:minimum\s+(?:of\s+)?|at\s+least\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\d+\)\s*)?\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)(?:\s+of)?(?:\s+(?:professional|relevant|related|direct|progressive|hands-on|prior|previous|recent|proven|demonstrated|industry|paid|full-time))*(?:\s+experience)?(?:\s+(?:in|with|as|of|doing))?/gi;
const CONSTRAINT_WORDS = { years: /\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\(\d+\)\s+)?years?\b/i,
  degree: /\b(?:degree|diploma|ged|bachelor|associate|master|ph\.?d|doctorate|mba|b\.?s\.?|b\.?a\.?|m\.?s\.?|md|do|high\s+school|graduate|equivalen)/i,
  management: /\b(?:manag|supervis|lead|direct\s+reports|people)/i, seniority: /\b(?:senior|lead|principal|staff|years?|manag|supervis)/i };
function constraintInText(c, text) {
  const re = CONSTRAINT_WORDS[c.kind];
  return re ? re.test(text) : true;
}
function row(st, status, evidence, missing, ask) {
  // confidence / display: the R3 display gate (statementGate.js). A statement read before the gate existed (a cached
  // reading) is shown, as before.
  const r = { id: st.id, text: st.text, status, evidence, missing, kind: st.kind, importance: st.importance, confidence: st.confidence || 'high', display: st.display !== false };
  if (ask) r.ask = ask;
  return r;
}
const lowerFirst = (t) => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);
const WEAK_VERB = (stem) => WEAK_STEMS.has(stem);
const WEAK_STEMS = new Set(['tool', 'office', 'improvement', 'improv', 'management', 'development', 'system', 'speak', 'gain', 'advanc', 'report', 'receiv', 'handl', 'manag', 'prepar', 'communicat', 'organiz', 'clean', 'record', 'review', 'check', 'monitor', 'coordinat', 'answer', 'respond', 'document', 'track', 'plan', 'lead', 'train', 'customer', 'safety', 'quality', 'service', 'store', 'mov', 'run', 'open', 'clos', 'set', 'build', 'creat', 'develop', 'writ', 'read', 'test', 'operat', 'process', 'put', 'sort', 'count', 'enter', 'help']);
function stemSet(text) { return new Set(tokenize(text).map((t) => fold(t.stem)).filter((x) => x.length > 2 && !STEM_STOP.has(x))); }
const STEM_STOP = new Set(['and', 'the', 'for', 'with', 'one', 'any', 'all']);
function headWord(c) { const w = String(c.surface || '').split(/\s+/); return w[w.length - 1] || c.surface; }
function classPhrase(c) {
  for (const id of c.classIds || []) { const cl = INSTANCE_CLASSES.find((x) => x.id === id); const m = cl && String(c.segment || '').match(cl.names); if (m) return m[0].toLowerCase(); }
  return c.surface;
}
/**
 * A `missing` entry in whole words (coordinator, screens run: "ventory management", "re a strong mentor"): a token that is
 * only part of a word of the statement becomes that whole word; a contraction's leftover ("re", "s", "ll") at the
 * front is dropped; trailing joiners go. A label that is not in the statement's words at all (a fact's own label,
 * "Master's degree") is kept as it is.
 */
export function wholeWordsOf(item, text) {
  const words = String(text || '').split(/[\s,;:()]+/).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z0-9+#&'’/.-]/g, ''));
  let toks = String(item || '').trim().split(/\s+/).filter(Boolean);
  toks = toks.map((tk) => {
    const k = tk.toLowerCase().replace(/[^a-z0-9+#&'’/.-]/g, '');
    if (!k || k.length < 3 || !/^[a-z]/.test(k) || lower.includes(k)) return tk;
    let i = lower.findIndex((w) => w.length > k.length && (w.endsWith(k) || w.startsWith(k)) && /^[a-z]/.test(w));
    // the same word in another form ("training" for the statement's "Train"): the statement's own form
    if (i < 0) { const st = stemOf(k); i = st ? lower.findIndex((w) => w && stemOf(w) === st) : -1; }
    return i >= 0 ? words[i].replace(/[^A-Za-z0-9+#&'’/.-]+$/, '') : tk;
  });
  while (toks.length && /^(?:re|s|ll|ve|d|t|m)$/i.test(toks[0])) toks.shift();
  while (toks.length > 1 && GATE_BAD_END_RE.test(toks[toks.length - 1])) toks.pop();
  while (toks.length > 1 && /^(?:and|or|of|the|a|an|to|with|in|for)$/i.test(toks[0])) toks.shift();
  return toks.join(' ').replace(/[,;:]+$/, '');
}
const TRAIT_OPEN_RE = /^(?:embrac|ethic|work\s+ethic|mindset|attitude|self-|adaptab|flexib|resilien|passion|curio|driven|motivat|enthusias|humble|eager)/i;
/** The résumé line that names the statement's trait word ("adaptable" ↔ "adaptability"), or null. */
function traitLine(text, resumeText) {
  const m = String(text || '').match(TRAIT_HEAD_RE);
  if (!m) return null;
  const word = (m[0].match(/([a-z][a-z-]{3,})$/i) || [])[1];
  if (!word) return null;
  const root = word.toLowerCase().slice(0, Math.max(5, Math.min(7, word.length - 2)));
  const re = new RegExp(`(?<![a-z])${escapeRegExp(root)}`, 'i');
  const l = proofLines(resumeText).find((x) => !x.inProgress && x.kind !== 'role' && re.test(x.text));
  return l ? l.text : null;
}
function stemOf(w) { const t = tokenize(String(w || '')); return t.length === 1 ? fold(t[0].stem) : ''; }
/** One of "Microsoft Office" / "Microsoft Office Suite": a missing item whose words sit inside another's is dropped. */
export function dedupeMissing(list) {
  const items = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
  const sets = items.map((x) => stemSet(x));
  return items.filter((x, i) => !items.some((y, k) => k !== i && sets[i].size && [...sets[i]].every((w) => sets[k].has(w)) && (sets[k].size > sets[i].size || k < i)));
}
const EDU_LINE_RE = /\b(?:diploma|ged|high\s+school|degree|bachelor|associate|master|b\.?s\.?|b\.?a\.?|m\.?s\.?|mba|ph\.?d|university|college|coursework|a\.a\.?s?\.?)\b/i;
/** The résumé line(s) behind a met constraint: the education line, the licence line, the dated roles counted. */
function constraintEvidence(c, resumeText) {
  const lines = proofLines(resumeText).filter((l) => !l.inProgress);
  const why = c.message || c.sentence || '';
  if (c.kind === 'degree' || c.kind === 'gpa') {
    const l = lines.filter((x) => EDU_LINE_RE.test(x.text)).sort((a, b) => (b.kind === 'education') - (a.kind === 'education'))[0];
    return [l ? { line: l.text, why } : { why }];
  }
  if ((c.kind === 'years' || c.kind === 'management' || c.kind === 'seniority') && Array.isArray(c.counted) && c.counted.length) {
    const ev = [];
    for (const r of c.counted.slice(0, 3)) {
      const l = r.title ? lines.find((x) => x.kind === 'role' && x.title && x.title.trim() === String(r.title).trim()) || lines.find((x) => x.kind === 'role' && x.text.includes(r.title)) : null;
      if (l) ev.push({ line: l.text, why: `${r.title}${r.span ? `, ${r.span}` : ''}` });
    }
    if (ev.length) { if (why) ev[0].why = why; return ev; }
    return [{ why }];
  }
  if (c.kind === 'certification' || c.kind === 'licence' || c.kind === 'license' || c.kind === 'language') {
    // the licence / certification line itself, never an education line (V: "Arizona RN license" ← "B.S. Nursing — Arizona State University")
    const cl = credentialLine(resumeText, c.label || c.value);
    if (cl) return [{ line: cl, why }];
    const want = [...stemSet(String(c.label || c.value || '').replace(/\b(?:an?|the|certification|certificate|certified|licen[sc]e[ds]?|licensure|card|valid|current|active|state|in)\b/gi, ' '))];
    const l = want.length ? lines.filter((x) => want.every((w) => stemSet(x.text).has(w))).sort((a, b) => b.rank - a.rank)[0] : null;
    return [l ? { line: l.text, why } : { why }];
  }
  return [{ why }];
}
