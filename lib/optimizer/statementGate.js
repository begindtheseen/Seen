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
import { escapeRegExp } from '../text/escapeRegExp.js';

// Words a statement never ends on: a joiner, a preposition, an article, an auxiliary.
export const BAD_END_RE = /\b(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|into|including|includes|include|such|like|e\.g|i\.e|via|than|that|which|who|while|both|either|your|our|their|is|are|be|will|can|has|have|was|across|within|through|over|between|about|around|without|towards?|per|after|before|during|under|upon|onto|among|using|whether|may|might|must|should|would|could|shall|along|where|when|so|not|does|do|you|you'll|you’ll|we|our|nor|its|this|these|those|such|very|more|most|other|another|each|every|any|all|some|also|but|yet|though|although|because|if|based|due|according|subject|responsible|relative|adheres|ensuring)$/i;
// A statement never opens on a leftover of the line before it.
const LEFTOVER_START_RE = /^(?:and|or|but|also|plus|nor|then|so|as\s+well\s+as|including|includes|include|etc|e\.g|i\.e|which|who|that|while|whereas|with\s+(?:a|an|the)\s+(?:focus|emphasis))\b/i;
// a verb that needs an object: a statement that ends on one was cut ("Write and maintain")
const OBJECT_VERBS = new Set('write maintain develop design build create manage lead implement support perform provide ensure conduct prepare review deliver drive establish evaluate identify improve monitor operate oversee own coordinate execute define analyze analyse handle assist install repair inspect test track document communicate collaborate partner present negotiate sell train mentor coach supervise administer process organize organise schedule plan research recommend translate configure deploy integrate automate optimize enforce introduce implementing introducing developing maintaining managing building designing creating leading supporting providing ensuring conducting preparing reviewing delivering driving establishing evaluating identifying improving monitoring operating overseeing coordinating executing defining analyzing handling'.split(' '));
// a line whose head is a personal trait ("Embraces emerging technologies…", "Clinical acumen and ability to communicate…",
// "Work ethic, solid communication skills…", "A bias to ship…", "Stay calm under pressure…"): a résumé line can only show
// it by naming the trait — anything else is a question for the person, never "not shown" on a leftover word (R3)
export const TRAIT_HEAD_RE = /^(?:\S+\s+){0,2}?(?:embrac\w*|acumen|ethic|mindset|attitude|calm|composed|bias|obsess\w*|self-[a-z]+|adaptab\w*|flexib\w*|resilien\w*|accountab\w*|integrity|empath\w*|curio\w*|humble|humility|hunger|hungry|grit|driven|enthusias\w*|positive|professionalism|reliab\w*|dependab\w*|punctual\w*|passion\w*|presence|demeanor|personality|energetic|motivat\w*|initiative|ownership|work\s+ethic|team\s+player|people\s+person|thrive\w*|comfortable\s+with\s+(?:ambiguity|change|uncertainty)|eager\w*|willing\w*|desire)\b/i;
// verbs that are rarely nouns: a short statement that ends on one was cut ("Write and maintain")
const END_VERBS = new Set('write maintain develop manage lead implement ensure conduct prepare deliver drive establish evaluate identify improve monitor operate oversee own coordinate execute define analyze analyse handle assist install repair inspect communicate collaborate negotiate sell train mentor supervise administer organize organise research recommend translate configure deploy integrate automate optimize enforce introduce complete obtain create build perform provide'.split(' '));
// the first / second person of a company pitch ("We move fast", "Our team values…", "Us")
const PITCH_SUBJECT_RE = /^(?:we|our|us|we['’](?:re|ll|ve|d))\b|\bwe\s+(?:are|were|will|have|had|do|did|can|could|would|need|want|offer|provide|value|believe|move|work|build|make|hire|seek|look|love|expect|ask|pay|support|encourage|invest|use|run|ship|serve|help|partner|care|operate)\b|\b(?:you['’]ll|you\s+will)\s+(?:be\s+(?:part|joining|working\s+with)|join|have\s+the\s+(?:chance|opportunity)|enjoy|get\s+to|receive|earn)\b/i;
// the company talking about itself or its process ("In 2025, Creatio was named to Inc.'s Best Workplaces list", "Pay may
// vary depending on…", "Affected employees will be expected to…", "Wells Fargo requires you to directly represent…")
const COMPANY_VOICE_RE = /^in\s+(?:19|20)\d\d\b|^by\s+joining\b|^with\s+(?:onboarding|us|our)\b|\bbase\s+pay\b|\bjob\s+description\s+(?:may|is\s+not|does\s+not)\b|\bmay\s+change\b|^some\s+roles\s+may\b|\bemployees\s+must\s+be\s+aware\b|^(?:essential\s+)?(?:duties|responsibilities)(?:\s+and\s+responsibilities)?\s+(?:for|of|include)\b|^the\s+(?:hardest|best|most|biggest|toughest|antiquated|successful\s+candidate\s+will\s+be\s+one)\b|^(?:applicants?|candidates?)\s+(?:will\s+not|may\s+not|applying|are\s+encouraged|will\s+be\s+considered)\b|^hiring\s+decisions\b|\bmay\s+be\s+available\b|\bis\s+welcome\b|^training\s+(?:on|is|will|may|for)\b|^develop\s+your\s+(?:skills|career)\b|\byears\s+of\s+(?:compassion|excellence|service|history|caring|innovation|tradition|growth|serving|experience\s+serving)\b|^seeking\b|^with\s+a\s+(?:culture|reputation|mission|team)\b|\bshifts?\s+available\b|^flexible\s+(?:scheduling|schedules?|hours)\b|^want\s+to\b|\b(?:offers?|employment)\s+(?:of\s+employment\s+)?(?:is|are|will\s+be)\s+contingent\b|\bapplicants?\s+who\b|^the\s+above\b|\bexhaustive\s+list\b|^if\s+you\b|^as\s+(?:the|a|an|our)\s+[^,]{0,60}\b(?:platform|company|leader|provider|firm|organi[sz]ation|business|brand|employer|startup|team|network|system)\b|^the\s+(?:requirements|duties|responsibilities|qualifications)\s+(?:listed|below|above|described)\b|^beyond\b|^everything\b|^depending\s+on\b|^payments?\s+(?:are|is|will)\b|^(?:individual\s+|total\s+|base\s+)?(?:compensation|pay)\s+(?:varies|vary|may|will|is|depends|ranges?)\b|^(?:unlimited|endless|great|amazing|exciting|real|growth)\s+opportunit|^opportunit(?:y|ies)\s+(?:to|for)\b|^the\s+kind\s+of\b|^this\s+(?:role|position|job|opportunity)\s+(?:is|will\s+be|offers|sits|reports)\b|^this\s+(?:role|position|job|opportunity)\s+(?:is|will\s+be|offers|sits|reports)\b|\b(?:was|were|has\s+been|have\s+been|is|are)\s+(?:named|recognized|recognised|ranked|awarded|founded|headquartered|backed|funded|trusted|proud)\b|^(?:pay|compensation|salary|the\s+(?:pay|salary|base\s+pay))\s+(?:may|will|is|range|ranges|varies|depends)\b|^(?:affected\s+)?employees\s+(?:will|may|must|are)\b|\brequires\s+(?:you|candidates|applicants|all\s+(?:candidates|applicants))\s+to\s+(?:directly\s+)?represent\b|\bat\s+the\s+heart\s+of\b|\bour\s+(?:dna|mission|culture|values|story)\b/i;
// a line that opens on an imperative duty ("Represent our brand at events") may say "our"
const DUTY_IMPERATIVE_RE = /^(?:Represent|Support|Serve|Help|Assist|Grow|Build|Maintain|Manage|Lead|Train|Partner|Work|Collaborate|Drive|Develop|Design|Deliver|Own|Run|Ensure|Provide|Promote|Sell|Protect|Monitor|Operate|Coordinate|Handle|Answer|Greet|Care|Communicate|Educate|Advocate|Uphold|Follow|Use|Create|Write|Prepare|Present|Report|Track|Process|Clean|Stock|Inspect|Install|Repair|Test|Analy[sz]e|Review|Implement|Improve|Identify|Execute|Plan|Schedule|Organi[sz]e|Recruit|Hire|Onboard|Mentor|Coach|Supervise|Oversee|Direct|Engage|Contribute|Participate|Act|Champion|Explore|Expand|Scale|Launch|Ship|Shape|Define|Set|Keep|Respond|Resolve|Escalate|Meet|Exceed|Achieve|Close|Negotiate|Prospect|Convert|Generate|Conduct|Perform|Complete|Document|Record|Enter|Verify|Collect|Deploy|Configure|Integrate|Automate|Optimi[sz]e|Debug|Troubleshoot|Translate|Evaluate|Assess|Research|Investigate)\b/;
// a negative persona or an anti-requirement ("Leaders who need complete specifications before their team can start")
export const PERSONA_RE = /^(?:(?:leaders|people|candidates|someone|anyone|those|individuals|engineers|managers|folks|applicants)\s+who\s+(?:need|want|prefer|require|expect|wait|insist|are\s+not|aren['’]t|don['’]t|do\s+not|can['’]t|cannot|won['’]t|struggle|avoid|get\s+frustrated))\b|^(?:this\s+(?:role|job|position|opportunity)\s+(?:is\s+not|isn['’]t)|not\s+(?:a\s+(?:good\s+|great\s+)?fit|for\s+you|for\s+(?:people|someone|those))|you\s+(?:won['’]t|will\s+not)\s+(?:enjoy|like|thrive|succeed)|you\s+(?:need|want|prefer)\s+(?:a\s+lot\s+of|constant|detailed|complete)\b)/i;
// a mid-text capitalised opener after a lower-case word: two bullets glued with no punctuation ("… execution focus
// Adaptable and resilient …", "Optical analysis tools such as Zemax Hands-on experience in optical design")
const GLUE_OPENERS = 'We|Our|This|These|The|You|Your|Candidates|Applicants|Experience|Experienced|Hands-on|Strong|Proven|Demonstrated|Demonstrable|Excellent|Exceptional|Outstanding|Ability|Able|Knowledge|Proficiency|Proficient|Familiarity|Familiar|Understanding|Expertise|Must|Minimum|Highly|Adaptable|Collaborative|Self-motivated|Self-starter|Detail-oriented|Comfortable|Willingness|Willing|Solid|Deep|Bachelor[\'’]?s|Master[\'’]?s|Required|Preferred|Substantial|Frequent|Occasional|Regular|Prior|Previous|Effective|Flexible|Reliable|Organized|Motivated|Passion|Passionate|Curious|Curiosity|Track|Working|Basic|Advanced|Intermediate|Fluent|Fluency|Bilingual|Valid|Current|Certified|Certification|Licensed|Availability|Available|Desire';
const GLUE_RE = new RegExp(`(?<=(?:^|\\s)[a-z0-9(][\\w'’/-]{0,30}[a-z0-9%)])\\s(?=(?:${GLUE_OPENERS})\\s+[a-z])`, 'g');
const GLUE_AFTER_NAME_RE = new RegExp(`(?<=\\b(?:[A-Z][a-z]{2,}|[A-Z]{2,6}))\\s(?=(?:Hands-on|Experience|Exposure|Clear|Strong|Proven|Demonstrated|Excellent|Ability|Knowledge|Proficiency|Familiarity|Understanding|Expertise|Minimum|Must|Dedicated|Committed)\\s+(?:with|in|of|to|written|verbal|experience|knowledge|understanding|skills?|ability|communication|working|years?|proficiency)\\b)`, 'g');
// any capitalised word after a lower-case one in a long flat line ("… unexpected challenges Take ownership of feature
// releases", "… Android app Product design intuition"): two bullets glued — never after a preposition, an article, a
// conjunction or a verb that takes a name ("use Salesforce daily", "build React components")
const GLUE_CAP_RE = /(?<=(?:^|\s)([a-z][\w'’/-]{0,30}))\s(?=[A-Z][a-z]{2,}(?:-[a-z]+)?\s+[a-z])/g;
// a job title in running text ("… with the Account Executive / Account Manager / service Executive for …") is no glue
const ROLE_NOUN_RE = /^(?:Executive|Manager|Director|Engineer|Lead|Leader|Officer|Specialist|Coordinator|Associate|Representative|Analyst|Administrator|Assistant|Supervisor|Technician|President|Partner|Owner|Team|Department|Group|Center|Centre|Office|Unit|Division|Program|Platform|Suite|Cloud|Studio|Server|Services?)\b/;
// an item that repeats the list's shape ("… prompt engineering | Introductory knowledge of Python …") opens a new item even
// after a word that could take a name
const STRONG_ITEM_RE = /^[A-Z][a-z]+(?:\s+[a-z]+){0,1}\s+(?:knowledge|experience|understanding|proficiency|familiarity|expertise)\s+(?:of|with|in)\b|^(?:Knowledge|Experience|Understanding|Proficiency|Familiarity|Expertise)\s+(?:of|with|in)\b/;
// (at the END of a unit only the words that can never close one: "…from multiple", "…meet corporate", "…for assigned")
const END_NEEDS_NOUN_RE = /^(?:senior|junior|enterprise|mid-level|entry-level|cross-functional|the|a|an|our|your|their|its|these|those|multiple|several|various|numerous|each|every|many|both|key|corporate|assigned|internal|external|federal|regional|national|global|strategic|operational|financial|clinical|primary|secondary)$/i;
// (before a cut: the words above plus a few determiners — never "as appropriate", "where applicable", which end a unit)
const CUT_NEEDS_NOUN_RE = /^(?:experienced|seasoned|skilled|talented|motivated|dedicated|qualified|commercial|industrial|residential|professional|relevant|related|the|a|an|our|your|their|its|this|that|these|those|multiple|several|various|numerous|other|each|every|any|some|many|few|both|key|corporate|assigned|internal|external|federal|regional|national|global|strategic|operational|financial|clinical|primary|secondary|senior|junior|technical|cross-functional)$/i;
// a unit that opens the way a requirement does (used inside a unit to find a second start)
const SHAPE_START_RE = /^(?:(?:At\s+least|Minimum|A\s+minimum)\b|\d|(?:[A-Z][a-z]+,?\s+){0,3}(?:[\w-]+\s+)?(?:experience|knowledge|proficiency|familiarity|understanding|expertise)\b|(?:Experience|Knowledge|Proficiency|Familiarity|Understanding|Ability|Bachelor|Master|Degree|Must|Strong|Excellent|Proven|Demonstrated)\b|(?:BS|BA|MS|MBA)(?:\/[A-Z]{2})?\s+(?:degree|in)\b)/;
// a credential acronym with its own level word ("CPA preferred", "PMP certification a plus") starts its own statement (R7)
const CRED_CUE_START_RE = /^(?:[A-Z]{2,6}(?:[\s-]?\d{1,4})?(?:\s+(?:certification|certificate|license|licence|designation))?|[A-Z][\w-]*(?:\s+[A-Z0-9][\w-]*){0,2}\s+(?:certification|certificate|license|licence))\s+(?:is\s+)?(?:preferred|required|desired|(?:a\s+)?(?:big\s+|strong\s+)?plus)\b/;
// determiners and adjectives that a noun must follow — a statement never ends on one
export const NEEDS_NOUN_RE = /^(?:the|a|an|our|your|their|its|this|that|these|those|multiple|several|various|numerous|other|all|each|every|any|some|many|few|both|key|relevant|related|existing|internal|external|corporate|assigned|appropriate|applicable|federal|regional|national|global|cross-functional|technical|strategic|operational|financial|clinical|current|future|prior|previous|new|senior|junior|major|minor|primary|secondary|additional|specific|general|overall|respective|such|same|different|diverse|complex|large|small|daily|weekly|monthly|annual)$/i;
const NAME_TAKERS = /^(?:[a-z]{2,}ing|fluent|native|bilingual|proficient|certified|licensed|registered|experienced|senior|junior|strong|excellent|advanced|basic|modern|valid|current|active|several|multiple|various|major|key|core|and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|into|onto|using|use|via|like|than|our|your|their|its|including|such|across|within|over|under|between|through|about|around|build|building|leverage|leveraging|know|learn|manage|managing|support|supporting|maintain|maintaining|configure|deploy|administer|operate|operating|run|running|write|writing|own|lead|join|joining|bring|apply|applying|is|are|be|was|were|called|named|e\.g|i\.e|vs|plus|especially|particularly|notably|namely|both|either|any|all|every|each|which|whose|where|when|while|if|that|this|these|those|new|other|another|based|located)$/i;
const LIST_ITEM_RE = /,\s(?:and\s)?(?=(?:experience|knowledge|(?:an?\s)?ability|understanding|familiarity|proficiency|(?:a\s)?(?:strong|solid|deep|demonstrated|proven)\s(?:understanding|knowledge|experience|background|track)|excellent\s(?:communication|written|verbal|organizational))\s(?:with|in|of|to|interacting|working|using|building|leading|managing|designing|developing|and)\b)/g;
// a word that only opens a line, met in the middle of one ("… program support Maintain compliance", "… strategic story
// What", "… build on Background", "… skills Excel skills"): two lines glued
const MID_CAP_RE = /(?<=(?:^|\s)[a-z0-9][\w'’-]{0,30}[a-z0-9,)%])\s(?:What|How|Why|Who|When|Where|Background|Overview|Summary|Qualifications|Requirements|Responsibilities|Benefits|Mastery|Proficiency|Maintain|Help|Lead|Develop|Manage|Ensure|Provide|Support|Perform|Conduct|Coordinate|Participate|Assist|Prepare|Review|Create|Build|Drive|Own|Partner|Collaborate|Communicate|Identify|Implement|Deliver|Design|Define|Plan|Track|Monitor|Train|Mentor|Report|Respond|Resolve|Must|Ability|Experience|Knowledge|Strong|Excellent|Proven|Demonstrated|Familiarity|Understanding|Ideally|Preferably|Bonus)(?=\s+[a-z]|\s*$)/;
const TITLE_TAIL_RE = /\s(?=(?:A|An|The|[A-Z][\w'’&-]+)(?:\s+(?:[A-Z][\w'’&-]*|of|and|the|a|to|in|for|at|&)){3,7}(?:\s*$|,\s))/;
const GLUE_SUFFIX_RE = /(?<=[a-z][a-z,)]?)\s(?=[A-Z][a-z]{3,}(?:al|ive|ous|ful|able|ible|ent|ant|ary|ory|ic|tion|ment|ness|ity)\s+[a-z]+\s+[a-z])/g;
// a sentence end inside a statement: "infrastructure for the Enterprise. Strong experience", "desired.Capable",
// "(… etc.) Enterprise/Domain Admin"
const ABBREV_BEFORE_DOT = /(?:\b(?:e\.g|i\.e|etc|vs|incl|approx|no|inc|ltd|co|corp|jr|sr|dr|mr|mrs|ms|st|u\.s|u\.k|a\.m|p\.m|ph\.d|b\.s|b\.a|m\.s|m\.a|yrs|hrs|min|max|avg|[A-Za-z]))$/i;
function sentenceBoundaries(text) {
  const t = String(text || '');
  const at = [];
  const re = /([.!?])(["”’']?\)?)(\s*)(?=["“(]?[A-Z][a-z]|["“(]?[A-Z]{2,}\b|[A-Z]\.[A-Z]\.\s)/g;
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
function prevWord(t, at) { const i = t.lastIndexOf(' ', at - 1); return t.slice(i + 1, at); }
export function splitRunOnStatement(source) {
  const t = String(source || '').replace(/\s+/g, ' ').trim();
  const cuts = [];
  // the end of the third word: a cut needs three words before it
  let third = -1; { let sp = 0; for (let i = 0; i < t.length && sp < 3; i++) if (t[i] === ' ') { sp++; if (sp === 3) third = i - 1; } if (third < 0) third = t.length; }
  for (const b of sentenceBoundaries(t)) cuts.push({ ...b, sentence: true });
  // a dash between two items ("Active or pending California DEA license - 2+ years of experience treating …") when the
  // second opens like an item
  { const re = / [-–—] (?=\S)/g; let m; while ((m = re.exec(t))) if (m.index > third && t.slice(0, m.index).split(/\s+/).length > 5 && opensLikeItem(t.slice(m.index + 3, m.index + 83))) cuts.push({ cut: m.index, next: m.index + 3, sentence: true }); }
  // a long line with a capitalised common word after a lower-case one ("… issues and requirements Conventional work
  // schedule, with 4 days per week …"): a common adjective / abstract noun by its ending, never a name
  if (t.split(/\s+/).length > 12) {
    GLUE_SUFFIX_RE.lastIndex = 0;
    let m;
    while ((m = GLUE_SUFFIX_RE.exec(t))) {
      const prev = prevWord(t, m.index);
      if (/^[a-z]/.test(prev) && !ROLE_NOUN_RE.test(t.slice(m.index + 1, m.index + 40)) && !/^(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|into|using|use|via|like|than|our|your|their|its|at|including|such)$/i.test(prev)) cuts.push({ cut: m.index, next: m.index + m[0].length });
    }
  }
  // a prose sentence that lists several requirements ("… an Electrical Engineer with a strong understanding of analog
  // CMOS circuit design, experience with transistor-level design and simulation, experience interacting with fabs, and
  // an ability to integrate designs …"): one statement per requirement phrase
  if (t.split(/\s+/).length > 15) {
    const listCuts = [];
    LIST_ITEM_RE.lastIndex = 0;
    let m;
    while ((m = LIST_ITEM_RE.exec(t))) listCuts.push({ cut: m.index, next: m.index + m[0].length });
    if (listCuts.length >= 2) cuts.push(...listCuts);
  }
  if (t.split(/\s+/).length > 11) {
    GLUE_CAP_RE.lastIndex = 0;
    let m;
    while ((m = GLUE_CAP_RE.exec(t))) {
      const next = t.slice(m.index + 1, m.index + 40);
      // a capitalised verb opening the next line ("… cash handling Using our point-of-sale system") splits after anything
      // but a preposition or an article; any other capitalised word only after a word that does not take a name
      const verbNext = /^(?:[A-Z][a-z]{1,}ing|Use|Help|Maintain|Ensure|Provide|Assist|Support|Perform)\b/.test(next);
      const ok = verbNext ? !/^(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|into|via|like|than|our|your|their|its|including|such|is|are|be)$/i.test(m[1])
        : !NAME_TAKERS.test(m[1]) && !OBJECT_VERBS.has(m[1].toLowerCase()) && !DUTY_IMPERATIVE_RE.test(m[1].charAt(0).toUpperCase() + m[1].slice(1)) && !ROLE_NOUN_RE.test(next);
      if (ok && m.index > third) cuts.push({ cut: m.index, next: m.index + m[0].length });
    }
  }
  // a flat paragraph's items glued with no punctuation ("… fluid systems Getting hands on with building and testing",
  // "… Fluids Engineering Exposure to manufacturing methods"): cut before a capitalised word that opens like an item
  if (t.split(/\s+/).length > 9) {
    const re = /\s(?=[A-Z][a-z][\w'’-]*[\s,])/g;
    let m;
    while ((m = re.exec(t))) {
      const prev = prevWord(t, m.index);
      const head40 = t.slice(m.index + 1, m.index + 41);
      const verbNext = /^[A-Z][a-z]+\b/.test(head40) && dutyHead(head40.split(/\s+/)[0]);
      if (m.index > third && /^[a-z0-9]/.test(prev) && !/[:;,]$/.test(prev) && (verbNext || STRONG_ITEM_RE.test(head40) || /^(?:Curious|Eagerness|Passion|Passionate|Comfortable|Interest|Hardworking|Hard-working|Punctual|Dependable|Detail-oriented)\b/.test(head40) || !NAME_TAKERS.test(prev)) && !OBJECT_VERBS.has(prev.toLowerCase()) && !/^(?:and|or|of|in|with|to|for|at|by|on|the|a|an|as|from|into|via|like|than|our|your|their|its|including|such|is|are|be|use|using)$/i.test(prev) && !/[(/]$/.test(prev) && opensLikeItem(t.slice(m.index + 1, m.index + 80)) && !ROLE_NOUN_RE.test(t.slice(m.index + 1, m.index + 40))) cuts.push({ cut: m.index, next: m.index + 1 });
    }
  }
  // a Title-Case heading run glued to the end ("… to be in EquipmentShare yard A Workplace For All At EquipmentShare")
  { const m = TITLE_TAIL_RE.exec(t); if (m && /^[a-z]/.test(prevWord(t, m.index)) && !/^(?:the|a|an|of|by|in|for|to|with|at|from|and|or|on|as|via|our|your|their)$/.test(prevWord(t, m.index)) && m.index > third) cuts.push({ cut: m.index, next: m.index + 1, sentence: true }); }
  for (const re of [GLUE_RE, GLUE_AFTER_NAME_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) cuts.push({ cut: m.index, next: m.index + m[0].length });
  }
  // R7: a credential acronym with its own level word glued after another requirement ("BS/BA degree in Finance/Accounting
  // CPA preferred") starts its own statement
  { const re = /\s(?=[A-Z][\w-]*\s)/g; let m; while ((m = re.exec(t))) if (CRED_CUE_START_RE.test(t.slice(m.index + 1, m.index + 90))) if (m.index > 0 && t.slice(0, m.index).split(/\s+/).length >= 3 && !/^(?:a|an|the|of|in|with|and|or)$/i.test(prevWord(t, m.index))) cuts.push({ cut: m.index, next: m.index + 1, sentence: true, keep: true }); }
  // R6: inside one unit, a second complete start — "… under pressure Please note that …", "… a plus Ethics: Commitment to …",
  // or a capitalised start that parses as its own requirement shape after a piece that already has one ("… sales cycles
  // Concentrated, non-point-solution experience: …", "… (LSW) At least one year of … experience") — is a new unit
  if (t.split(/\s+/).length > 8) {
    const re = /\s(?=(?:\*\*|(?:What|Why|Who|How|Where)\b|[A-Z]{2,6}\s|(?:BS|BA)\/|At\s+[A-Z]|Please\s+note\b|[A-Z][a-z]+(?:\s+(?:&|and|[A-Z][a-z]+)){0,2}:\s+[A-Z]|[A-Z][a-z]+[\s,]))/g;
    let m, n = 0;
    while ((m = re.exec(t)) && n++ < 200) {
      if (m.index <= third) continue;
      const rest0 = t.slice(m.index + 1, m.index + 120);
      // (a legal notice, a "Please note", or a section lead-in about the company glued onto the last item ends it, whatever
      // word comes before)
      if (/^(?:What|Why|Who|How|Where)\b[^.?!]{0,100}\?/.test(rest0) && /\?\s*["”]?\s*$/.test(t)) { cuts.push({ cut: m.index, next: m.index + 1, sentence: true }); continue; }
      if (/^(?:\*\*|Please\s+note\b|At\s+[A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3},\s+(?:you|we|our)\b)/.test(rest0)) { cuts.push({ cut: m.index, next: m.index + 1, sentence: true }); continue; }
      const prev = prevWord(t, m.index);
      if (!(/(?:^[a-z0-9][\w/-]*|\))$/.test(prev) || (/^[A-Z][\w-]+$/.test(prev) && /^(?:Excellent|Strong|Proven|Demonstrated|Proficiency|Experience|Knowledge|Ability|Familiarity|Bachelor|Master|\d)/.test(rest0))) || /[:;,]$/.test(prev) || CUT_NEEDS_NOUN_RE.test(prev) || (/^(?:and|or|nor|of|in|with|to|for|at|by|on|as|from|into|via|plus|than|like|is|are|be|use|using|including|such)$/i.test(prev) && !/\ba\s+plus$/i.test(t.slice(Math.max(0, m.index - 8), m.index)))) continue;
      const rest = t.slice(m.index + 1, m.index + 301);
      if (/^(?:\*\*|Please\s+note\b)/.test(rest) || /^[A-Z][a-z]+(?:\s+(?:&|and|[A-Z][a-z]+)){0,2}:\s+[A-Z]/.test(rest)) { cuts.push({ cut: m.index, next: m.index + 1, sentence: true }); continue; }
      const head = t.slice(0, m.index);
      const restUnit = rest.split(/(?<=[.;])\s/)[0];
      if (head.split(/\s+/).length >= 4 && restUnit.split(/\s+/).length >= 3 && SHAPE_START_RE.test(restUnit) && statementShape(restUnit.replace(/,/g, ''), {}) && statementShape(head, {})) cuts.push({ cut: m.index, next: m.index + 1, sentence: true });
    }
  }
  // R4: a cut that is not a sentence end is justified only when the piece after it opens like a requirement item does (a
  // repeated item shape: a duty verb, "N+ years", "Experience/Knowledge/Ability…", a credential) — "Comply with applicable |
  // Propio and client requirements…" is one item, never two
  for (let k = cuts.length - 1; k >= 0; k--) if (!cuts[k].sentence && !opensLikeItem(t.slice(cuts[k].next, cuts[k].next + 80))) cuts.splice(k, 1);
  // R5: never cut after a word that needs a noun after it ("information from multiple | Government organizations", "meet
  // corporate | Model Risk Management", "teams for assigned | Relay development programs"): the piece before would be clipped
  for (let k = cuts.length - 1; k >= 0; k--) if (!cuts[k].sentence && (CUT_NEEDS_NOUN_RE.test(prevWord(t, cuts[k].cut)) || /^(?:or|and|nor|of|in|with|to|for|at|by|on|as|from|into|via|plus|than|like)$/i.test(prevWord(t, cuts[k].cut)))) cuts.splice(k, 1);
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
    if (out.length && p.split(/\s+/).length < 3 && !CRED_CUE_START_RE.test(p)) out[out.length - 1] = `${out[out.length - 1]} ${p}`;
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
export function validateStatement(text, { source = '', kind = '', named = false, company = '' } = {}) {
  const t = String(text || '').trim();
  const reasons = [];
  // the employer as the subject ("Samsara is in full growth mode", "Samsara (NYSE: IOT) sits at the center of …")
  const co = String(company || '').replace(/[^A-Za-z0-9&']/g, ' ').trim().split(/\s+/)[0] || '';
  if (co.length >= 3 && new RegExp(`^(?:the\\s+)?${escapeRegExp(co)}(?:['’]s)?\\b(?:\\s+[A-Z][\\w&.-]*){0,3}(?:\\s*\\([^)]{0,30}\\))?\\s+(?:is|are|was|has|have|sits|builds|offers|provides|helps|serves|makes|delivers|powers|works|believes|values|exists|operates|leads|connects|combines|brings|employs|partners|continues|remains|empowers|enables)\\b`, 'i').test(t)) reasons.push('pitch');
  const words = t.split(/\s+/).filter(Boolean);
  // two words pass only as a list of names ("PostgreSQL, Redis", "Claude Code", "GitLab CI")
  // (two words also pass when the reader read a requirement from them: "Inventory management", "Customer service")
  if ((words.length < 3 && !(words.length === 2 && (named || words.every((w) => /^[A-Z0-9][\w.+#/-]*,?$/.test(w)) || (dutyHead(words[0]) && /^[a-z]{3,}$/.test(words[1]))))) || words.length > 40) reasons.push('length');
  if (!/^[A-Z0-9"“(]/.test(t)) reasons.push('lowercase_start');
  if (LEFTOVER_START_RE.test(t)) reasons.push('leftover_start');
  if (/[,;:&/–—-]$/.test(t) || BAD_END_RE.test(t.replace(/[.!?]+$/, ''))) reasons.push('bad_end');
  if (clipped(t, source)) reasons.push('clipped');
  if (sentenceBoundaries(t).length || (GLUE_RE.lastIndex = 0, GLUE_RE.test(t)) || (GLUE_AFTER_NAME_RE.lastIndex = 0, GLUE_AFTER_NAME_RE.test(t))) reasons.push('run_on');
  if (MID_CAP_RE.test(t)) reasons.push('run_on');
  if (!balanced(t)) reasons.push('brackets');
  if (gluedHeading(t) || (words.length <= 6 && words.every((w) => /^(?:[A-Z][\w'’&/-]*|to|of|and|&|the|a|for|in)$/.test(w)) && /\b(?:you|we|need|know|what|how|why|about|hours|role|job|position)\b/i.test(t)) || (words.length <= 6 && /\b(?:this|the)\s+(?:role|position|job|team)$/i.test(t)) || isHeadingPhrase(t.replace(/,\s*[A-Z][\w .-]{0,30}$/, ''))) reasons.push('heading');
  const dutyOpen = (DUTY_IMPERATIVE_RE.test(t) || /^[A-Z][a-z]{1,}ing\b/.test(t)) && !/^(?:we|our|us)\b/i.test(t);
  if ((PITCH_SUBJECT_RE.test(t) && !dutyOpen) || COMPANY_VOICE_RE.test(t) || (/\$\s?\d|\/(?:hr|hour)\b|\bper\s+hour\b/i.test(t) && !PROSE_CUE_RE.test(t)) || (source && PITCH_SUBJECT_RE.test(String(source).replace(/^[\s•*-]+/, '')) && !PROSE_CUE_RE.test(source) && !DUTY_IMPERATIVE_RE.test(t)) ||  /^your\s/i.test(t) || /^you(?:['’]re|\s+(?:are|get|can|may|might|could|love|enjoy|thrive|want|like|care|believe|know|see|join|work\s+with))\b/i.test(t)) reasons.push('pitch');
  if (/\b(?:our|us)\b/.test(t) && !dutyOpen) reasons.push('our');
  if (PERSONA_RE.test(t) || PERSONA_RE.test(String(source || '').replace(/^[\s•*-]+/, ''))) reasons.push('persona');
  if ((kind === 'physical' || kind === 'schedule') && !PHYSICAL_OR_SCHEDULE_RE.test(`${t} ${source}`)) reasons.push(PROSE_CUE_RE.test(source || t) || REQUIREMENT_CUE_RE.test(source || t) ? 'rekind' : 'not_physical');
  if (/\bhttps?:\/\/|\bwww\.[a-z]/i.test(t)) reasons.push('url');
  // a sub-heading read as a line ("Partner Channel Strategy", "Sales Alignment", "Refills & Continued Use") or an ALL-CAPS
  // heading glued to either end ("QUALITY ASSURANCE", "PREVIOUS EXPERIENCE - 2-3 years …", "… (written and verbal) COMPENSATION")
  if (!named && words.length >= 2 && words.length <= 4 && words.every((w) => /^(?:[A-Z][\w'’/-]*|&|and|of|the|for|to|in)$/.test(w)) && !words.some((w) => /^[A-Z0-9]{2,}$|[a-z][A-Z]|\d/.test(w))) reasons.push('heading');
  if (/^[A-Z][A-Z&/]{2,}(?:\s+[A-Z][A-Z&/]{2,}){0,3}(?:\s*[-–:]\s|\s+[A-Z][a-z]|$)/.test(t) && isHeadingPhrase((t.match(/^[A-Z][A-Z&/ ]{2,}[A-Z]/) || [''])[0].toLowerCase()) || /\s[A-Z]{4,}(?:\s+[A-Z]{3,}){0,2}$/.test(t) && isHeadingPhrase((t.match(/[A-Z]{4,}(?:\s+[A-Z]{3,}){0,2}$/) || [''])[0].toLowerCase())) reasons.push('heading');
  if ((!named && /^[A-Z&/ -]{3,40}$/.test(t)) || /^[A-Z]{3,}(?:\s+[A-Z]{3,}){1,3}\s*[-–:]\s/.test(t)) reasons.push('heading');
  if (/\s[a-z]$|\bwith\s+\d+$/.test(t)) reasons.push('clipped');
  // (a unit that ends on a determiner or an adjective with no noun — "…from multiple", "…meet corporate" — is clipped)
  if (words.length >= 3 && END_NEEDS_NOUN_RE.test(String(words[words.length - 1]).replace(/[.,;:!?]+$/, ''))) reasons.push('clipped');
  // a duty written in Title Case is a sub-heading ("Creating Meaningful Data Abstractions", "Comfortable with Ambiguity")
  if (!named && (kind === 'duty' || /^[A-Z][a-z]+(?:ed|ing)\b/.test(t)) && words.length >= 2 && words.length <= 4 && words.every((w) => /^(?:[A-Z][\w'’&/-]*|with|of|and|&|the|a|for|in|to)$/.test(w)) && !words.some((w) => /^[A-Z0-9]{2,}$|[a-z][A-Z]|\d/.test(w))) reasons.push('heading');
  if (/\s[A-Z]{4,}(?:\s+[A-Z]{3,}){0,3}\s/.test(` ${t} `.slice(1)) && /\s([A-Z]{4,}(?:\s+[A-Z]{3,}){0,3})\s/.test(t) && isHeadingPhrase(t.match(/\s([A-Z]{4,}(?:\s+[A-Z]{3,}){0,3})\s/)[1].toLowerCase())) reasons.push('run_on');
  if (kind === 'duty' && words.length >= 2 && words.length <= 6 && words.every((w) => /^(?:[A-Z][\w'’&/-]*|with|of|and|&|the|a|for|in|to)$/.test(w)) && /^(?:[A-Z][a-z]+ing|Comfortable|Strong|Deep|Excellent)\b/.test(t)) reasons.push('heading');
  if (kind === 'duty' && /^(?:more|most|many|few|much|the|a|an|this|that|these|those|it|its|everything|everyone|payments?|depending|there|here|all|most|some|each|any|outlines?|tasks?\s+(?:are|is|will))\b/i.test(t)) reasons.push('not_a_duty');
  if (!words.some((w) => { const x = w.toLowerCase().replace(/[^a-z0-9+#&'-]/g, ''); return x.length > 1 && !STOP.has(x); })) reasons.push('no_content');
  return { ok: reasons.filter((r) => r !== 'rekind' && r !== 'our').length === 0, reasons };
}
GLUE_RE.lastIndex = 0;

// what a physical or schedule line names (a statement under "Physical demands" that names none of it — "Handle
// work-related stress", "Judgment, troubleshooting, problem-solving" — is not a physical demand)
const PHYSICAL_OR_SCHEDULE_RE = /\b(?:lift\w*|carry\w*|push\w*|pull\w*|stand\w*|sit|sitting|seated|walk\w*|climb\w*|bend\w*|stoop\w*|kneel\w*|crouch\w*|reach\w*|squat\w*|twist\w*|grasp\w*|grip\w*|lbs?|pounds?|kg|feet|ladders?|stairs|heights?|vision|visual|acuity|hearing|hear|see|speak|talk\w*|dexterity|hands?|wrists?|fingers?|arms?|repetitive|motions?|movement|physical\w*|sedentary|outdoors?|outside|weather|temperatures?|heat|cold|noise|noisy|loud|dust|fumes|chemicals|hazard\w*|ppe|protective|warehouse|freezer|cooler|driv\w*|vehicle|shifts?|schedules?|hours?|nights?|weekends?|holidays?|overtime|on-call|on\s+call|rotation|rotating|travel\w*|days?|week|weeks|evenings?|mornings?|overnights?|availability|available|full-time|part-time|flexib\w*|seasonal|per\s+diem|prn|weather|computer|screen|keyboard|telephone|phone|desk|office|environment|exposure|exposed|conditions?)\b/i;

function escapeTail(t) { return String(t).split(/\s+/).slice(-3).map((w) => escapeRegExp(w)).join('\\s+'); }
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
  for (let k = Math.min(6, w.length - 2); k >= 1; k--) {
    const tail = w.slice(w.length - k).join(' ');
    if (/^[A-Z][\w&'’/-]*,?(?:\s+(?:[A-Z][\w&'’/-]*,?|and|&|of))*(?:\s+(?:experience|skills|education|training|requirements|qualifications))?$/.test(tail) && isHeadingPhrase(tail) && /[a-z0-9]$/.test(w[w.length - k - 1] || '')) return true;
  }
  return false;
}

/** Was the statement cut inside a phrase? (it ends on a verb waiting for its object, or "both X", or the source line
 * goes on with "and …", ", and …", "of …" right after the words the statement ends on) */
function clipped(t, source) {
  if (/\band\s+similar$/i.test(t)) return false;
  const words = t.replace(/[.!?]+$/, '').split(/\s+/);
  const last = (words[words.length - 1] || '').toLowerCase().replace(/[^a-z'-]/g, '');
  // (a noun that looks like a verb after a preposition or article is the object — "… to CD/flash drive")
  if (END_VERBS.has(last) && words.length <= 6 && !/\b(?:to|on|onto|into|from|the|a|an|your|their|our|its)\s+(?:\S+\s+)?\S+$/i.test(t)) return true;
  if (/\b(?:both|either|neither|between)\s+(?!way\b)[\w-]+$/i.test(t)) return true;
  // an example name cut after its first word ("… a medical assistant program such as Commission" from "such as Commission
  // on Accreditation of Allied Health Education Programs")
  if (/\b(?:such\s+as|including|like|e\.g\.?)\s+[A-Z][\w-]*$/.test(t) && source && new RegExp(`${escapeTail(t)}\\s+(?:on|of|for|and|&)?\\s*[A-Z]`).test(String(source).replace(/\s+/g, ' '))) return true;
  // a line that only introduces a list ("With completion of at least one of the following")
  if (/\b(?:the\s+following|as\s+follows|below)$/i.test(t)) return true;
  // a list cut after its last verb ("… building systems, leading teams, and stepping" from "and stepping in hands-on")
  if (/\b[a-z]{3,}ing\s[^,]{2,60},\s(?:[^,]{2,60},\s)?(?:and|or)\s[a-z]+ing$/i.test(t) && source && !new RegExp(`${escapeTail(t)}\\s*(?:[.;:!?)]|$)`, 'i').test(String(source).replace(/\s+/g, ' '))) return true;
  // a noun that needs its complement ("… and the drive" from "the drive to learn proprietary systems quickly")
  if (/\b(?:the|a|an)\s+(?:drive|ability|desire|willingness|passion|capacity|motivation|commitment|eagerness|interest|need|opportunity|chance)$/i.test(t)) return true;
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
  // a cut the compression makes on purpose: the rationale or an example clause after the requirement
  if (/^\s*[,—–-]?\s*(?:with\s+(?:the\s+|an\s+)?(?:ability|focus|emphasis)|which|that|who|so\s+that|in\s+order|to\s+(?:ensure|help|support|drive|deliver|enable|meet|keep|make)|including|such\s+as|e\.g|i\.e|while|as\s+well\s+as|where|when|ideally|preferably|as\s+needed|as\s+required|across|within)\b/i.test(rest)) return false;
  // the statement ends on a word that needs its complement ("in accordance", "activities focused", "a team large enough")
  if (/\b(?:accordance|compliance|line|addition|order|relation|respect|regard|charge|focused|based|related|aligned|dedicated|committed|responsible|eligible|enough|depending|according|due|prior|relative|subject|similar\s+to|able|capable)$/i.test(t.replace(/[.!?]+$/, ''))) return true;
  // any other cut inside a clause: the line goes on with a word, not with a modifier the compression drops on purpose
  // (a level said after the requirement, a dash, a parenthesis, a purpose or condition clause is cut on purpose)
  if (/^\s*(?:[-–—:]\s|\(|,?\s*(?:is|are|will\s+be|would\s+be)?\s*(?:strongly\s+|highly\s+|very\s+)?(?:preferred|required|desired|a\s+(?:big\s+|strong\s+)?plus|beneficial|helpful|recommended|mandatory|an\s+asset|essential|necessary|a\s+must|nice\s+to\s+have|considered)\b)/i.test(rest)) return false;
  if (/^\s+(?!(?:in|on|at|for|with|across|within|from|by|through|via|using|during|under|per|including|such\s+as|as|while|when|whenever|where|which|that|who|whose|if|because|since|to|so|rather\s+than|ideally|preferably|e\.g|etc|and\s+(?:similar|other|related|equivalent))\b)[a-z]/.test(rest)) return true;
  return /^\s*(?:,\s*(?:and|or|&)(?:\/or)?\s|,\s[^,.;]{1,50}(?:,\s[^,.;]{1,50}){0,6},?\s(?:and|or|&)(?:\/or)?\s|(?:and|or)(?:\/or)?\s|&\s|\/|of\s|-\s?[a-z])/i.test(rest) && !/^\s*,?\s*(?:and|or)\s+(?:similar|other|related|equivalent|more)\b/i.test(rest);
}

// a requirement cue in prose (spec: must, required, experience with/in, ability to, N+ years, proficient, a licence /
// certification / degree, you will / you'll + a duty verb)
const PROSE_CUE_RE = /\b(?:must|required?|requires|experience\s+(?:with|in|of|as|using|[a-z]{3,}ing)|ability\s+to|able\s+to|\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)|proficien\w*|licen[sc]\w*|certif\w*|degree|diploma|bachelor\w*|master['’]?s|knowledge\s+of|knowledgeable\s+(?:of|in|about)|familiar\w*\s+with|skilled\s+in|expertise\s+in)\b|\byou(?:['’]ll|\s+will)\s+(?:also\s+)?[a-z]+/i;
const DUTY_START_RE = /^[A-Z][a-z]+(?:s)?\b/;

/**
 * Confidence of a statement from the STRUCTURE it was read from. `row` is the requirement row
 * ({ kind, explicit, origin }); `duty` says the line opens on an imperative duty verb.
 */
export function statementConfidence(row, source, { duty = false } = {}) {
  const r = row || {};
  const origin = r.origin || 'line';
  // (a whole line is structure whether or not a heading the reader knows sits above it: a PDF or email copy turns bullets
  // into plain lines, and the reading must not change with the copy)
  if (origin === 'bullet' || origin === 'line') return 'high';
  const src = String(source || '');
  if (PROSE_CUE_RE.test(src) || REQUIREMENT_CUE_RE.test(src)) return 'medium';
  if (r.kind === 'responsibilities' && duty && DUTY_START_RE.test(src.replace(/^[\s•*-]+/, ''))) return 'medium';
  // a piece cut out of a flat run under a recognised requirements / duties heading ("runon"): medium — the validator
  // decides whether it reads whole. A piece the gate itself cut out of a glued line ("glued") needs its own cue.
  if (r.explicit && (r.kind === 'requirements' || r.kind === 'preferred' || r.kind === 'responsibilities') && origin !== 'glued') return 'medium';
  // a piece cut out of a glued line at a boundary the segmenter can justify (it opens like a requirement item)
  if (origin === 'glued' && r.explicit && opensLikeItem(src) && !/^(?:This|These|We|Our|Join|At)\b/.test(src)) return 'medium';
  return 'low';
}

// ── R4: the DISPLAY GRAMMAR. A unit is shown only when it parses as one of a closed set of requirement shapes. ──────────
const NUM_WORD = '(?:\\d{1,2}(?:\\.\\d)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)';
const SHAPES = [
  // experience: "3+ years …", "Minimum of two years …", "Experience with/in …", "Previous retail experience", "Track record of …"
  ['experience', new RegExp(`^(?:(?:a\\s+)?(?:minimum|at\\s+least|over|more\\s+than)\\s+(?:of\\s+)?)?${NUM_WORD}\\s*(?:\\(\\d+\\)\\s*)?\\+?\\s*(?:or\\s+more\\s+)?(?:(?:-|–|to|or)\\s*${NUM_WORD}\\s*\\+?\\s*)?(?:years?|yrs?|months?)\\b|^(?:[\\w&/'’-]+\\s+){0,5}?(?:experience|experienced|background|track\\s+record|history)\\b`, 'i')],
  // credential / education / licence
  ['credential', /^(?:BSN|MSN|ADN|DNP|RN|LPN|LVN|CNA|CPA|CFA|CMA|PMP|MBA|PhD|JD|CDL|EMT|CPR|BLS|ACLS)$/],
  ['credential', /\b(?:degree|diploma|ged|bachelor['’]?s?|master['’]?s?|associate['’]?s?\s+degree|ph\.?d|doctorate|mba|b\.?s\.?|licen[sc](?:e|ed|ure)|certifi(?:ed|cation|cate)|credential|clearance|accredit\w*|board[- ]certified|cpr|bls|acls|cdl|journeyman|registered\s+(?:nurse|dietitian|behavior)|rn|lpn|lvn|cna|cpa|pe|pmp|coc|stcw)\b|\bcertifications\b|\bholders?\s+of\b/i],
  // ability: "Ability to …", "Able to …", "Willingness to …", "Available to …"
  ['ability', /^(?:(?:the|an|a|proven|demonstrated|strong|excellent)\s+)?(?:ability|abilities|able|capable|capacity|willing(?:ness)?|available|availability|aptitude|eager(?:ness)?|desire|prepared\s+(?:for|to)|ready\s+to)\b/i],
  // knowledge / skill: "Knowledge of …", "Proficiency in …", "Strong communication skills", "Attention to detail"
  ['knowledge', /^(?:(?:[\w-]+,?\s+){0,6}?(?:knowledge|knowledgeable|proficiency|proficient|familiarity|familiar|understanding|expertise|expert|fluency|fluent|bilingual|bi-lingual|multilingual|skilled|skills?|competenc(?:e|y|ies)|command|comfort(?:able)?|literacy|literate|mastery|grasp|foundation|grounding|fundamentals|aptitude|intuition|judgment|judgement|acumen|presence|discipline)\b|attention\s+to\s+detail)/i],
  // R5: a skill named before its noun ("TIG welding and general fabrication ability", "CAD proficiency (SolidWorks …)")
  ['knowledge', /^(?:[\w&/+#.-]+,?\s+){1,6}?(?:ability|abilities|proficiency|expertise|competence|competency|skills?)\b/i],
  // R5: a trait or interest ("Must be a dependable self-starter…", "Thrives in a small biotech…", "Commitment to working
  // safely", "Passion for collaborative care", "Eagerness to learn", "Curious, analytical mindset…", "Interest in AI…")
  ['trait', /^(?:must\s+be\s+(?:a|an)\s|(?:thrives?|enjoys?|curious|passionate|eager|excited|motivated|self-motivated|self-starter|driven|adaptive|adaptable|introspective)\b|(?:(?:a|an)\s+)?(?:(?:strong|genuine|deep|real|demonstrated)\s+)?(?:passion|interest|eagerness|enthusiasm|curiosity|commitment|drive|love|appetite|dedication)\s+(?:for|in|to)\b|(?:[\w-]+,?\s+){0,4}mindset\b)/i],
  // a profile of the person the posting asks for ("Hands-on electromechanical technician with strong … aptitude",
  // "Strong communicator who can document observations clearly")
  // (R6: any person-noun the posting describes with "who can / who brings / who enjoys" — "A dedicated and compassionate BCBA
  // who brings…", "Strong communicators who can…", "A motivator and mentor who enjoys…")
  ['profile', /^(?:an?\s+)?(?:[\w-]+,?\s+){0,5}?[A-Za-z][\w-]*\s+who\s+(?:can|is|are|has|have|brings?|enjoys?|thrives?|loves?|wants?|takes?|knows?|understands?)\b/i],
  ['profile', /^(?:[\w-]+,?\s+){0,4}?(?:technician|communicator|engineer|professional|leader|operator|self-starter|starter|team\s+player|problem[- ]solver|individual|collaborator|builder|thinker|achiever)\s+(?:with|who|that)\b/i],
  // condition: schedule, physical, travel, age, screening, authorisation, transport
  ['condition', /\b(?:mon(?:day)?|tues?(?:day)?|sun(?:day)?)\s*(?:-|–|—|to|through|thru)\s*(?:fri(?:day)?|sat(?:urday)?|sun(?:day)?|thu(?:rs(?:day)?)?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b(?:reside|be\s+located|live|be\s+based)\s+(?:within|in|near)\b|\b(?:is|are)\s+(?:required|mandatory|a\s+must)\b|\bmandatory\s+requirements?\b|^must\s+(?:meet|follow|adhere|comply|demonstrate|work|attend|undergo|submit|provide|reside|live|speak|read|use|have|hold|possess|pass|complete|maintain|obtain|be\s+(?:able|willing|available|authorized|eligible|at\s+least|over|18|21))\b|^successful\s+completion\s+of\b|\b(?:outdoor\w*|exposure\s+to|travel\w*|lift\w*|stand\w*|sit|walk\w*|bend\w*|kneel\w*|climb\w*|push\w*|pull\w*|carry\w*|weekends?|nights?|evenings?|holidays?|shifts?|overtime|on-call|schedules?|hours|full-time|part-time|rotat\w*|relocat\w*|on-?site|hybrid|in[- ]office|commut\w*|background\s+(?:check|investigation|screening)|drug\s+(?:test|screen)\w*|fingerprint\w*|authori[sz]ed\s+to\s+work|work\s+authori[sz]ation|eligib\w*|citizen\w*|\d{2}\s+years\s+(?:of\s+age|old)|years\s+of\s+age|driv(?:er|ing)['’]?s?\s+(?:licen[sc]e|record)|transportation|immuniz\w*|vaccin\w*|pounds|lbs)\b/i],
];
// a duty: an imperative, third-person or gerund verb opening a verb phrase with an object
const DUTY_VERB = new Set(`remove scrape sweep mop wipe sanitize empty refill carry copy hunt fax prep count leave leaves place step pitch cover rotate stock increase decrease boost expand embed machine turn navigate interact hold recognize recognise scale scan wrap print tag weigh cut sew paint shape invent play shoot defuse anticipate preserve explore tear aid get marshal keep accept achieve act adapt address adhere administer advise advocate align analyse analyze answer apply approve architect arrange assemble assess assign assist attend audit author automate balance bill brief build calibrate care champion chart check clean close coach code collaborate collect communicate compile complete comply conduct configure confirm connect consolidate consult contribute convert cook coordinate counsel create cultivate debug decide define deliver demonstrate deploy design detect determine develop diagnose direct dispatch dispense display distribute document draft drive edit educate enforce engage ensure enter escalate escort establish estimate evaluate examine execute expand explain facilitate fabricate file fill finalize fix follow forecast foster gather generate greet grow guide handle help hire identify implement improve inform inspect install instruct integrate interact interpret interview investigate issue keep label launch lead learn liaise lift load locate log maintain manage measure meet mentor merchandise migrate model monitor motivate move negotiate notify observe obtain onboard open operate optimize optimise order organize organise own oversee pack participate partner patrol perform pick plan prepare present prioritize process procure produce program promote propose prospect protect prototype provide publish purchase pursue qualify quote read rebuild receive recommend reconcile record recruit reduce refine register reinforce relay repair replace replenish report represent research resolve respond restock review run safeguard schedule scope screen secure select sell serve service set ship shape share solve sort source specify staff stage standardize stock streamline structure submit summarize supervise support survey sustain take teach test track train transcribe transfer transform translate transport triage troubleshoot tutor understand unload update uphold use utilize validate verify visit wash weld work write`.split(/\s+/));
function dutyHead(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (DUTY_VERB.has(w)) return true;
  if (/s$/.test(w) && (DUTY_VERB.has(w.slice(0, -1)) || DUTY_VERB.has(w.replace(/ies$/, 'y')) || DUTY_VERB.has(w.replace(/es$/, '')))) return true;
  if (/ing$/.test(w)) { const b = w.slice(0, -3); return DUTY_VERB.has(b) || DUTY_VERB.has(`${b}e`) || DUTY_VERB.has(b.replace(/(.)\1$/, '$1')); }
  return false;
}
// process notes, contract terms, contact lines, legal lines: never displayed, whatever their shape
const NOT_A_REQUIREMENT_RE = /^benefit:\s|^benefits?\b|^interviews?\s+(?:will|are|may)\b|\b(?:other|additional)\s+(?:duties|responsibilities|tasks)(?:\s+and\s+responsibilities)?\s+as\s+(?:directed|assigned|needed|required|requested)\b|\b(?:opt\s+(?:back\s+)?(?:in|out)|sms|text\s+messages?|reply\s+with)\b|^(?:contractors?|freelancers?|consultants?)\s+(?:may|will|are|must\s+not)\b|^(?:requirements?|duties)\s+may\s+(?:include|vary|change)\b|^exceptions?\b|\baccommodations?\s+(?:will|may)\s+be\b|^for\s+(?:help|questions|more\s+information)\b|\breply\s+(?:help|stop)\b|\bcontact\s+us\b|\b(?:e-?mail|phone\s+number)\b.*\b(?:at|to)\b|\bwe\s+(?:are\s+an?|do\s+not\s+accept)\b|\bnot\s+guaranteed\b|\bat\s+(?:will|any\s+time)\b|^(?:the\s+)?(?:final|actual|starting|base|total)\s+(?:salary|pay|compensation|offer|wage)s?\b|\b(?:salary|pay|compensation|wages?)\s+(?:is|are|will\s+be|may\s+be)\s+(?:based|determined|commensurate)\b|\b(?:compensation|pay|salary|earnings|wages?|income)\s+(?:may|will|can)\s+vary\b|\b(?:other|additional|various|related|miscellaneous|any)\s+(?:[\w/-]+\s+){0,5}(?:duties|tasks|activities|projects|responsibilities|assignments)\s+(?:as\s+)?(?:assigned|directed|needed|required|requested)\b|\band\/or\s+(?:activities|tasks|duties)\s+as\s+(?:assigned|directed|needed|required)\b|\bposition\s+level\b|\blevel\s+(?:will\s+be\s+)?(?:determined|commensurate)\b|\bsome\s+(?:roles|positions|jobs)\s+(?:may\s+)?require\b|^(?:(?:bachelor|master|doctoral|doctorate|phd|ph\.d\.?|associate|graduate)['’]?s?\s+(?:or|and|\/)\s+)?(?:bachelor|master|doctoral|doctorate|phd|ph\.d\.?|associate|graduate)['’]?s?\s+level$|^as\s+(?:a|an|the|our)?\s*[^,.]{2,80},\s+you(?:['’]ll|\s+will)\b|\b(?:in|with)\s+your\s+(?:email|application|cover\s+letter|submission)\b|\bsubject\s+line\b|^to\s+confirm\s+you\b|^(?:continue|grow|advance|develop)\s+your\s+(?:professional\s+)?(?:growth|career|skills|development)\b|\b(?:are|is)\s+held\s+(?:weekly|daily|monthly|\w+\s+times)\b|\bsubject\s+to\s+(?:eligibility|availability|approval|change)\b|\bdoes\s+not\s+guarantee\b|^if\s+(?:qualified|selected|hired|invited|approved)\b|^(?:revenue|sales|acquisitions|dispositions|growth|profits?|bookings|arr|users|customers)\s+(?:increased|grew|rose|doubled|tripled|reached)\b|\byear\s+over\s+year\b[^.]{0,30}\d{4}$|[\w.+-]+@[\w-]+\.[\w.]+|^remote-first\b|\bno\s+(?:required\s+)?commute\b|\ball\s+assigned\s+(?:[\w-]+\s+){0,3}(?:activities|duties|tasks)\b|^(?:firm|company|employer)[- ]provided\b|\bpaid\s+(?:[\w-]+\s+){0,3}(?:fees|renewals?)\b|\b(?:overtime|bonus(?:es)?|stipends?|reimbursement|relocation|housing|parking)\s+(?:is|are)\s+(?:also\s+)?available\b|\bis\s+available\s+during\b|\bto\s+help\s+you\s+(?:master|succeed|grow|learn)\b|\bto\s+support\s+your\s+(?:life|growth|wellbeing|well-being|family)\b|^(?:flexible|generous)\s+(?:work\s+)?(?:schedules?|hours|pto|time\s+off)\b|\b1:1\s+coaching\s+to\b|\boffer\s+letter\b|\bcompensation\s+decisions\b|\bfactors\s+are\s+considered\b|\b(?:fluency|proficiency|literacy)\s+means\b|\bto\s+learn\s+more\b|\bread\s+(?:this|our|the)\s+(?:blog|post|article)\b|\bthe\s+following\s+laws\b|\bwe\s+(?:also\s+)?offer\b|\b(?:pay|compensation|salary)\b[^.]{0,50}\b(?:may|will|can)\s+vary\b|\bwill\s+be\s+shared\s+if\b|\breq(?:uisition)?\.?\s+id\b|\bjob\s+title\s*:|\baccessible\s+to\s+all\s+users\b|\bunsolicited\s+(?:agency\s+)?(?:resumes|candidates)\b|\bdo\s+not\s+forward\s+resumes\b|^by\s+submitting\s+your\s+application\b|^whether\s+you['’]re\b|\brestrictions\s+apply\b|\bcompany[- ]paid\b|\bemployee\s+favorite\b|\?\s*["”]?\s*$|^(?:together\s+with\s+[^,]{2,40},\s+)?employees\s+(?:receive|get|enjoy|define|choose|set|are\s+eligible|have\s+access)\b|^success\s+(?:is|will\s+be)\s+measured\b|\b(?:is|are)\s+(?:also\s+)?acceptable\.?$|\b(?:has|have)\s+been\s+our\b|\bour\s+(?:mindset|history|story|founders?)\b|\b(?:tracks?|options?|positions?|roles?|openings?)\s+(?:are|is)\s+available\b|\bany\s+other\s+(?:tasks?|functions?|duties|responsibilit(?:y|ies))\b[^.]{0,80}\b(?:as\s+)?(?:instructed|assigned|directed|requested|required)\b|^every\s+[^.]{0,40}\bemployees?\s+(?:is|are)\s+expected\b|^[^:]{2,40}:\s+we\s|\beligible\s+(?:to\s+participate\s+in|for)\s+(?:our|a|the)\s[^.]{0,40}\b(?:bonus|plan|program|benefits?|incentives?)\b|\bis\s+an?\s+(?:non-?profit|not-for-profit|leading|global|fast-growing|privately[- ]held|publicly[- ]traded)\b/i;
// "experience" as a verb ("Founders experience a moment of clarity…", "You'll experience the whole stack") is no experience ask
// a Title Case benefit / section line ("Training and Development Opportunities", "Career Growth Opportunities")
const OPPORTUNITY_HEAD_RE = /^(?:[A-Z][a-z]+\s+(?:and|&)\s+)?(?:[A-Z][a-z]+\s+){0,2}Opportunit(?:y|ies)$/;
const VERB_EXPERIENCE_RE = /^(?:[A-Z][a-z]+s|[Yy]ou(?:['’]ll|\s+will)|[Tt]hey|[Ww]e(?:['’]ll)?)\s+experience\s+(?:a|an|the|our|real|what)\b/;

const ITEM_OPEN_RE = new RegExp(`^(?:(?:a\\s+)?(?:minimum|at\\s+least)\\b|${NUM_WORD}\\s*\\+?\\s*(?:(?:-|–|to)\\s*${NUM_WORD}\\s*\\+?\\s*)?(?:years?|yrs?)\\b|(?:(?:strong|excellent|solid|deep|proven|demonstrated|hands-on|working|basic|advanced|good|exceptional|outstanding|prior|previous)\\s+)*(?:experience|knowledge|ability|able|proficiency|proficient|familiarity|familiar|understanding|expertise|skills?|track\\s+record|background|fluency|fluent|willingness|comfort|exposure|grasp|first[- ]hand)\\b|(?:a\\s+)?(?:bachelor|master|associate|high\\s+school|degree|diploma|certif|licen[sc]|valid|current|active)|must\\b|attention\\s+to|self-|detail-|highly\\s+|adaptable|collaborative|curious|passion|holders?\\s+of|responsible\\s+for|good\\s+(?:communication|written|verbal)|clear\\s+(?:written|verbal|communication)|fluent|safety\\s+culture|scrappy|enthusiastic|motivated|driven|organized|resourceful|punctual|dependable|hardworking)`, 'i');
function opensLikeItem(s) {
  const t = String(s || '').trim();
  // (a trailing pitch glued on — "… 35 wpm This role is on-site, which…" — may be cut off: the piece after it is hidden)
  return ITEM_OPEN_RE.test(t) || STRONG_ITEM_RE.test(t) || TRAIT_LINE_RE.test(t) || /^[A-Z][a-z]+\s+and\s+[a-z]+\s+[a-z]{3,}(?:tion|sion|ment|ance|ence|ing|ness)s?\b/.test(t) || /^(?:BS|BA|B\.S\.|B\.A\.|MS|MA|MBA|PhD|AA|AS)(?:\s*\/\s*(?:BS|BA|MS|MA))?\s+(?:degree|in)\b/.test(t) || CRED_CUE_START_RE.test(t) || (/^[A-Z][a-z]+ly\s+[a-z]+/.test(t) && dutyHead(t.split(/\s+/)[1])) || /^(?:Bi-?lingual|Multilingual|Hardworking|Hard-working|Eagerness|Curious|Comfortable|Interest|Passion|Passionate|Enthusiasm|Curiosity|Commitment|Willingness|Excellent|Proven|Demonstrated|Self-motivated|Thrives?|Enjoys?|Good\s+(?:communication|written|verbal|interpersonal)|Fluent|Safety\s+culture)\b/.test(t) || /^[A-Z][a-z]{3,}(?:tion|sion|ance|ence|ment)s?\s+(?:with|of|and|for|in|to)\b/.test(t) || /^(?:\S+\s+){0,3}(?:schedule|shifts?|hours|travel|on-?site|hybrid|remote)\b/i.test(t) || /^(?:This\s+(?:role|position|job|is)|These|We|We['’](?:re|ll|ve)|Our|Join|At\s+[A-Z])\b/.test(t) || (/^[A-Z]/.test(t) && dutyHead(t.split(/\s+/)[0]));
}
/** Does a clause open on a duty verb ("keep accurate notes…", "Run Executive Business Reviews…")? */
export function isDutyClause(s) { const w = String(s || '').trim().split(/\s+/)[0]; return dutyHead(w); }
// a short trait line made of the qualities postings screen on ("Punctual and dependable", "Safety culture and mindset",
// "Time management and multitasking", "Reliable and predictable attendance")
const TRAIT_LINE_RE = /^(?:(?:highly|very|extremely)\s+)?(?:punctual|dependable|reliable|hard[- ]?working|detail[- ]oriented|disciplined|organi[sz]ed|self[- ](?:motivated|starter|directed)|motivated|proactive|adaptable|flexible(?!\s+(?:work|schedul|hours|arrangement|time|pto))|resourceful|personable|professional|positive|honest|trustworthy|team[- ]oriented|customer[- ]focused|results[- ]driven|time\s+management|multi-?tasking|problem[- ]solving|critical\s+thinking|communication|interpersonal|leadership|teamwork|safety\s+culture|work\s+ethic|attention|good\s+(?:communication|judgment)|effective\s+(?:english\s+)?communication|excellent\s+(?:communication|customer|interpersonal|organizational)|strong\s+(?:work\s+ethic|communication))\b/i;
/** Which display shape a unit parses as (or null). */
export function statementShape(text, { kind = '', named = false } = {}) {
  const t = String(text || '').trim();
  // a "Label: unit" line ("Real-time Risk Dashboards: Design and maintain Power BI …") has the shape of its unit (R5)
  { const lab = t.slice(0, 300).match(/^([^:]{3,60}):\s+([A-Z(].{8,})$/s); if (lab && lab[1].split(/\s+/).length <= 6) { const inner = statementShape(lab[2], { kind, named }); if (inner) return inner; } }
  const words = t.split(/\s+/);
  if (kind === 'physical' || kind === 'schedule') return SHAPES.find(([n]) => n === 'condition')[1].test(t) ? 'condition' : null;
  // (a duty opens on its verb — "Lead a layered team … degree programs" is a duty, whatever nouns it names)
  if (kind === 'duty' && words.length >= 3 && /^[A-Z][a-z]+\b/.test(t) && dutyHead(words[0]) && !/^(?:lift|stand|sit|walk|travel|work)\b/i.test(t)) return 'duty';
  for (const [name, re] of SHAPES) if (re.test(t) && (name !== 'condition' || words.length <= 25) && !(name === 'trait' && /\b(?:you(?:['’]ll|\s+will)|we|our)\b/i.test(t))) return name;
  if ((words.length >= 3 || (words.length === 2 && /^[a-z]{3,}$/.test(words[1]))) && /^[A-Z]/.test(t) && (dutyHead(words[0]) || (/ly$/i.test(words[0]) && dutyHead(words[1])) || /^(?:responsible|accountable)\s+for\b/i.test(t))) return 'duty';
  // a noun-phrase duty under a duties heading ("Patient and family education", "Interdisciplinary care coordination") (R4)
  // (a phrase in Title Case — "People Management" — is a sub-heading, not an item)
  if (kind === 'duty' && words.length >= 4 && words.length <= 30 && /^[A-Z][a-z]+(?:\s+(?:and|&)\s+[a-z]+)?\s+(?:[a-z]+\s+)?[a-z]{3,}(?:tion|sion|ment|ance|ence|al|ing|ery|sis)s?\s+(?:of|in|for|with|to|on)\s/.test(t) && !/\b(?:we|our|you|your)\b/i.test(t)) return 'duty';
  if (kind === 'duty' && words.length >= 2 && words.length <= 8 && /^[A-Z]/.test(t) && words.slice(1).some((w) => /^[a-z]/.test(w)) && !/[,;:!?]/.test(t) && NOMINAL_END_RE.test(t) && !/\b(?:is|are|was|were|will|can|may|we|our|you|your|us)\b/i.test(t)) return 'duty';
  if (words.length <= 12 && TRAIT_LINE_RE.test(t) && !/\b(?:we|our|you|your|us)\b/i.test(t)) return 'trait';
  // a bare skill / tool list ("PostgreSQL, Redis", "SQL and Python", "Customer service and cash handling") the reader read
  if (named && words.length <= 12 && !/\b(?:is|are|was|were|will|can|may|we|our|you|your)\b/i.test(t)) return 'skill';
  return null;
}

const NOMINAL_END_RE = /(?:[a-z]{2}(?:tion|sion|ment|ance|ence|ing|ery|sis|ship)s?|\b(?:education|care|support|oversight|review|maintenance|training|planning|outreach|compliance|documentation|reporting|analysis|design|research|assessment|counseling|intake|coordination|inventory|safety|sales|service|operations|logistics|administration))\.?$/i;
// R5: the company speaking is never a requirement ("ANSER is seeking an experienced Knowledge Manager…", "England is
// Immediately Hiring Experienced CDL-A Truck Drivers!", "Currently, we stand as a pioneering enterprise…", "As an accredited
// … provider, BAYADA complies with…")
const SEEKING_RE = /^(?:[A-Z][\w.&'’-]*\s+){1,5}(?:is|are)\s+(?:(?:immediately|currently|now|actively)\s+)?(?:seeking|hiring|looking\s+for|recruiting|searching\s+for)\b/i;
const WE_SUBJECT_RE = /^(?:(?:currently|today|now|here|together|at\s+[A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3}),?\s+)?(?:we(?:['’](?:re|ve|ll))?|our\s+(?:team|company|firm|organization|mission|people|culture|clients?|founders?)|the\s+company)\s/i;
const COMPANY_VERB_RE = /\b(?:stands?\s+as|(?:is|are)\s+(?:a|an|the)\s+(?:leading|pioneering|premier|trusted|growing|fast-growing|global|national|nonprofit|non-profit|proud)|(?:is|are)\s+proud\s+to|prides?\s+(?:itself|ourselves))\b/i;
export function companySpeaks(text, company = '') {
  const t = String(text || '').trim();
  if (/\b(?:must|required|requires)\b/i.test(t) && !SEEKING_RE.test(t)) return false;
  if (SEEKING_RE.test(t) || WE_SUBJECT_RE.test(t) || COMPANY_VERB_RE.test(t)) return true;
  if (/^as\s+(?:an?|the)\s[^.]{3,160}?\b(?:provider|employer|company|organi[sz]ation|firm|agency|contractor|institution|business|leader|group),\s+[A-Z]/i.test(t)) return true;
  const words = String(company || '').split(/\s+/).filter((w) => /^[A-Z][\w.&'’-]{2,}$/.test(w) && !/^(?:The|Inc|LLC|Corp|Group|Company|Services|Health|Care|Home)\.?$/.test(w));
  for (const w of words) if (new RegExp(`^(?:[A-Z][\\w.&'’-]*\\s+){0,3}${escapeRegExp(w)}(?:['’]s)?(?:\\s+[A-Z][\\w.&'’-]*){0,3}\\s+(?:is|are|was|has|have|provides|offers|complies|believes|values|serves|stands|delivers|builds|helps)\\b`).test(t)) return true;
  return false;
}
/** Decide confidence + display on a statement in place. */
export function gateStatement(st, row, { duty = false, company = '' } = {}) {
  const confidence = statementConfidence(row, st.source, { duty });
  const v = validateStatement(st.text, { source: st.source, kind: st.kind, named: Array.isArray(st.factIds) && st.factIds.length > 0, company });
  const named = Array.isArray(st.factIds) && st.factIds.length > 0;
  let shape = statementShape(st.text, { kind: st.kind, named }) || (row && row.skillItem && st.text.split(/\s+/).length <= 9 ? 'skill' : null);
  // R5 (recall): a whole bullet under a real duties heading that opens on a capital and reads as a phrase is a duty item
  // even when no closed shape names it ("Snow and ice removal", "Overall ship's command and responsibility to ensure safety")
  // R6 (director): every bullet under a real duties / requirements heading is shown unless a named rule says why not — a
  // bullet with no closed shape is an 'item' (it never counts toward its list's majority, so a list of places or of
  // setting descriptions is still held back by the list judgement)
  if (!shape && row && row.explicit && row.origin === 'bullet' && ['requirements', 'responsibilities', 'preferred'].includes(row.kind) && !row.skillItem && !/:\s*$/.test(String(st.source || '')) && /^[A-Z(]/.test(st.text) && st.text.split(/\s+/).length >= 3) shape = 'item';
  const junk = (st.text.split(/\s+/).length <= 8 && !/[.,;]/.test(st.text) && isHeadingPhrase(st.text.replace(/[’]/g, "'").toLowerCase())) || NOT_A_REQUIREMENT_RE.test(st.text) || VERB_EXPERIENCE_RE.test(st.text) || OPPORTUNITY_HEAD_RE.test(st.text) || companySpeaks(st.text, company);
  // (a condition under a duties heading — "This role follows a hybrid schedule." — is a condition, not a bad duty)
  if (shape === 'condition' && v.reasons.includes('not_a_duty') && /^(?:this|the)\s+(?:role|position|job)\b/i.test(st.text)) { v.reasons = v.reasons.filter((x) => x !== 'not_a_duty'); v.ok = v.reasons.filter((x) => x !== 'rekind' && x !== 'our').length === 0; }
  st.confidence = confidence;
  st.shape = shape || null;
  // ("our"/"us" in a line with no requirement shape is a pitch; inside one — "a hybrid schedule from our Dallas office" — it is not)
  const ourPitch = v.reasons.includes('our') && !shape;
  // (a long whole credential / experience line is still one requirement: "Minimum Degree Required: Bachelor's Degree, in
  // lieu of a degree, … three years of …")
  // (R7: inside a list under a real duties / requirements heading, Title Case is not a heading signal — "Inventory Control",
  // "Patient Intake And Scheduling" are items; only a known heading phrase is a heading there)
  if (v.reasons.includes('heading') && row && row.explicit && row.origin === 'bullet' && ['requirements', 'responsibilities', 'preferred'].includes(row.kind) && !isHeadingPhrase(st.text.replace(/[’]/g, "'").toLowerCase()) && st.text.split(/\s+/).length >= 2) { v.reasons = v.reasons.filter((x) => x !== 'heading'); v.ok = v.reasons.filter((x) => x !== 'rekind' && x !== 'our').length === 0; }
  // (a lone credential acronym — "BSN" — is a requirement, not a heading)
  if (shape === 'credential' && (/^[A-Z][A-Za-z]{1,5}$/.test(st.text.trim()) || /^(?:Active\s+|Current\s+)?(?:(?:Top\s+)?Secret|TS\s*\/\s*SCI|Public\s+Trust)\b/i.test(st.text.trim()))) { v.reasons = v.reasons.filter((x) => x !== 'heading' && x !== 'length'); v.ok = v.reasons.filter((x) => x !== 'rekind' && x !== 'our').length === 0; }
  // (R5: so may any whole bullet with a shape — a long duty is one unit, never cut and never hidden for its length)
  if (v.reasons.includes('length') && st.text.split(/\s+/).length <= 60 && (shape === 'credential' || shape === 'experience' || (shape && row && (row.origin === 'bullet' || row.origin === 'line') && !v.reasons.includes('run_on')))) { v.reasons = v.reasons.filter((x) => x !== 'length'); v.ok = v.reasons.filter((x) => x !== 'rekind' && x !== 'our').length === 0; }
  st.display = confidence !== 'low' && v.ok && !ourPitch && !!shape && !junk;
  if (!st.display) st.hideReason = [confidence === 'low' ? 'low_confidence' : '', shape ? '' : 'no_shape', junk ? 'not_a_requirement' : '', ...v.reasons].filter(Boolean).join(',');
  else delete st.hideReason;
  // a line under a physical / schedule heading that names no physical demand or schedule is not that kind ("Handle
  // work-related stress" is hidden; "Excel skills are essential" is a requirement)
  if (v.reasons.includes('rekind') || v.reasons.includes('not_physical')) st.kind = 'requirement';
  return st;
}
