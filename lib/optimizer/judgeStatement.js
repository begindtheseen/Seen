// Judging ONE requirement statement against the résumé's lines (director, 2026-11-10, R2).
//
// Why: a duty statement with no extracted fact fell to "cannot_tell" — "Scan and label inventory items" was "?" for a
// résumé that says "Pick, pack and ship orders using RF scanner", and "Perform preventative maintenance … of production
// line equipment" was "?" for a warehouse associate (the honest answer is "not shown"). "cannot_tell" is not a judgement.
//
// The rule, as implemented:
//   1. A statement's CLASS decides whether a résumé can speak to it at all. Physical ability, schedule/availability,
//      eligibility/authorisation, soft traits (and a language nobody lists) are things only the person can say: they are
//      `cannot_tell`, with `ask: { kind, text }` so a screen can say "Only you can say: lift up to 50 pounds".
//      What the posting promises or waives ("No experience required!") is never judged (statementVerdicts skips it).
//   2. Every other statement (duty, skill, tool, requirement) is judged on its CONCEPTS: the specific words the line asks
//      for, read as verbs ("scan", "label") and object phrases ("inventory", "preventative maintenance"). Generic words
//      (work, team, support, perform, ensure, provide, maintain, equipment alone …) never carry a match; soft words and
//      "follow the procedures" phrases are taken out first. A list's examples ("including scissor lifts, forklifts…")
//      are alternatives: any one proves the phrase they illustrate, and an INSTANCE proves its CLASS through
//      fieldAliases.js (forklift ⇒ warehouse equipment, RF scanner ⇒ scan, Epic ⇒ EHR).
//   3. A concept is shown on ONE résumé line (never a header, an objective or a line still in progress): a verb by its
//      stem, an object phrase by all its words on that line, or by an instance of its class. An object phrase whose
//      HEAD noun alone is on a line is half-shown ("maintenance" for "preventative maintenance") — it can make a
//      statement `partly`, never `shown`, and the missing modifier is named.
//   4. shown = every concept shown (on at most two lines); partly = at least one concept that is not a weak word is
//      shown or half-shown — `missing` names the rest in the statement's own words; otherwise not_shown. Facts the reader
//      extracted from the line (skills, terms) stand in for the words they cover, with their own verdict and proof line.
//      False proof is the worst error: a weak verb alone ("report", "receive") never makes a statement partly, and no
//      line is cited that does not hold the words it is cited for.
//
// Paraphrase by STRUCTURE (engineer V, 2026-11-10 — "Present findings · not on your résumé" beside "Presented churn findings
// to the VP" is the error that breaks trust fastest):
//   5. A statement and each résumé line are read as ACTION + OBJECT (+ qualifiers). Word forms of one action — verb,
//      noun, agent noun (present / presentation / presenter; educate / teaching / train / onboard) — are ONE family
//      (fieldAliases.js ACTION_FAMILIES); things written two ways are one SAME_THING family (new hires = new agents,
//      inventory records = cycle counts); people nouns are PEOPLE_GROUPS. Action is matched to action and object to
//      object, separately: action AND a specific object (or its same-thing form) on a line = shown; the object alone =
//      partly; the ACTION ALONE IS NOTHING (it is never cited).
//   6. Who it is for ("to operations and clinical leaders", "for classes of 10-15 agents"), how ("in plain language"),
//      when ("from day one through nesting", "after discharge") are qualifiers: not asked. A verb that adds nothing before
//      an action noun ("Deliver new-hire training", "Provide one-on-one feedback") is light: the noun is the action.
//   7. Proof ranking: a doing line (bullet under a role) beats a title, a skills list or a summary; a line that shows more
//      of the statement beats one that shows less; a number breaks a tie. A skills-list, education or certification line
//      never proves a DUTY (only a named skill or tool), and a header line never proves anything but its title.
import { tokenize, stemWord, findStemmed } from './lemma.js';
import { proofLines, aliasEntriesFor, proofOnLine } from './lineProof.js';
import { INSTANCE_CLASSES, ACTION_FAMILIES, LIGHT_VERBS, SAME_THING, PEOPLE_GROUPS, TITLE_PROVES } from './fieldAliases.js';
import { escapeRegExp } from '../text/escapeRegExp.js';

// ── statement classes a résumé cannot speak to ──────────────────────────────────────────────────────────────────
const PHYSICAL_TEXT_RE = /\b(?:lift(?:ing|s)?\s+(?:up\s+to\s+)?\d{1,3}\s*\+\s*(?:lbs?\.?|pounds?)|walk(?:ing|s)?,|(?:some\s+)?sitting,|climbing,|lifting\s+for|lift(?:ing|s)?\b[^.;]{0,40}?\d{1,3}\s*(?:lbs?\.?|pounds?|kg|kilograms?)|(?:carry|carrying|push(?:ing)?|pull(?:ing)?|moving)\b[^.;]{0,40}?\d{1,3}\s*(?:lbs?\.?|pounds?|kg)|stand(?:ing|s)?\b[^.;]{0,30}?(?:periods?|hours?|shifts?|long|extended|prolonged|entire|full)|walk(?:s|ing)?,?\s+(?:and\s+)?stand|reaching,|grasping|(?:exposure|exposed)\s+to\s+(?:all\s+|the\s+|extreme\s+)?(?:cleaning|chemicals?|heat|cold|noise|dust|fumes|weather|outdoor|temperatures?|walk-in|freezers?|hazard\w*|blood|bodily|infectious|sun|rain|vibration|loud|moving\s+mechanical|high\s+voltage)|walk-in\s+coolers?|freezers?\s+at|team[- ]lift|too\s+heavy|heavy\s+or\s+awkward|on\s+(?:your|their|my)\s+feet|climb(?:ing|s)?\s+(?:up\s+and\s+down\s+)?(?:ladders?|stairs?)|(?:up\s+and\s+down|go\s+up)\s+(?:the\s+)?stairs|\bstairs\b|ladder\s+usage|step\s+stool|bend(?:s|ing)?\b|stoop(?:s|ing)?\b|kneel(?:s|ing)?\b|crouch(?:es|ing)?\b|squat(?:s|ting)?\b|reach(?:ing)?\s+overhead|repetitive\s+(?:motions?|lifting|movements?)|repetitious|manual\s+dexterity|work\s+at\s+(?:a\s+)?heights?|height\s+of\s+up\s+to|exposure\s+to\s+(?:heat|cold|noise|dust|fumes|weather|chemicals)|extreme\s+(?:heat|cold|temperatures?)|outdoor\s+(?:work|conditions)|all\s+weather|noise\s+levels?|vision\s+(?:requirements?|abilities)|hearing)\b/i;
const SCHEDULE_TEXT_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}\s*(?:am|pm)|shifts?|overtime|weekends?|holidays?|nights?|evenings?|overnights?|on[- ]call|rotating|part[- ]time|full[- ]time|hours?\s+(?:per|a|each)\s+week|\d+\s*hours?\b|schedule|availability|available\s+to\s+work|travel(?:ing|ling)?\b|relocat\w*|commute|on[- ]?site|in[- ]office|hybrid|remote)\b/i;
const ELIGIBILITY_TEXT_RE = /\b(?:authori[sz](?:ed|ation)\s+to\s+work|legally\s+(?:able|eligible|authori[sz]ed)|work\s+authori[sz]ation|(?:u\.?s\.?\s+)?citizen(?:ship)?|green\s+card|permanent\s+resident|eligible\s+to\s+work|employment\s+eligibility|(?:18|21)\s+years\s+(?:of\s+age|old)|(?:18|21)\s+or\s+older|at\s+least\s+(?:18|21)\b|background\s+(?:check|screen\w*|investigation)|drug\s+(?:test|screen)\w*|reliable\s+transportation|(?:form|means|mode)\s+of\s+transportation|internet\s+connection|access\s+to\s+a\s+(?:computer|laptop|vehicle|car)|own\s+(?:vehicle|transportation|car)|insur(?:ed|ance)\s+vehicle|valid\s+driver['’]?s?\s+licen[sc]e|driver['’]?s?\s+licen[sc]e|clean\s+driving\s+record|motor\s+vehicle\s+record|fingerprint\w*|live\s*scan|security\s+clearance|clearance|pre-employment|pass\s+(?:a|the)\s+(?:physical|screen)|sponsorship|visa)\b/i;
const LANGUAGE_RE = /\b(English|Spanish|French|Mandarin|Cantonese|Chinese|Vietnamese|Tagalog|Korean|Arabic|Portuguese|German|Russian|Hindi|Japanese|Italian|Polish|Somali|Amharic|Haitian\s+Creole|ASL|American\s+Sign\s+Language)\b/;
// a résumé line can show these (a licence on the résumé, a clearance held)
const SHOWABLE_ELIGIBILITY = [
  { re: /\bdriver['’]?s?\s+licen[sc]e|\bclean\s+driving\s+record/i, proof: /\bdriver['’]?s?\s+licen[sc]e|\bCDL\b|\bClass\s+[ABC]\b/i },
  { re: /\bsecurity\s+clearance|\bclearance\b/i, proof: /\b(?:secret|top\s+secret|TS\/SCI|clearance)\b/i },
];

// ── words ─────────────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set('one two three four five six seven eight nine ten you yourself along away a an the and or of to in on at by for with from as into onto per via than that which who whom whose this these those their our your its it is are be been being was were will would can could should may might must shall do does did has have had not no nor any all each every both either some such other others own same so too very also just only well up down out over under about across within without through throughout during before after above below between among while when where how what whether if then there here etc e.g i.e eg ie including include includes like plus more most less least much many few several various new high low wide broad full entire whole overall necessary needed needs need required requirement requirements requires require preferred desired ideal ideally plus bonus'.split(/\s+/));
// words that name no specific thing a résumé could show (director: "work, team, support, perform, ensure, provide,
// maintain, equipment alone — do not carry a match by themselves")
const GENERIC = new Set(['work', 'working', 'team', 'teams', 'support', 'supporting', 'perform', 'performing', 'ensure', 'ensuring', 'provide', 'providing', 'maintain', 'maintaining', 'equipment', 'use', 'using', 'utilize', 'utilizing', 'assist', 'assisting', 'help', 'helping', 'duty', 'duties', 'task', 'tasks', 'ability', 'able', 'strong', 'excellent', 'good', 'great', 'solid', 'effective', 'effectively', 'efficient', 'efficiently', 'accurate', 'accurately', 'proper', 'properly', 'appropriate', 'experience', 'experienced', 'knowledge', 'skill', 'skills', 'year', 'years', 'minimum', 'environment', 'environments', 'setting', 'settings', 'similar', 'related', 'relevant', 'item', 'items', 'product', 'products', 'box', 'boxes', 'goods', 'process', 'processes', 'system', 'systems', 'information', 'issue', 'issues', 'problem', 'problems', 'job', 'jobs', 'role', 'position', 'company', 'manner', 'way', 'ways', 'time', 'day', 'days', 'daily', 'regular', 'regularly', 'basic', 'general', 'member', 'members', 'staff', 'personnel', 'people', 'employee', 'employees', 'area', 'areas', 'level', 'levels', 'standard', 'standards', 'operation', 'operations', 'procedure', 'procedures', 'specification', 'specifications', 'activity', 'activities', 'execute', 'executing', 'performance', 'point', 'contact', 'education', 'practical', 'show', 'owner', 'owners', 'technology', 'technologies', 'knowledgeable', 'familiar', 'structured', 'patient', 'patients', 'family', 'families', 'visitor', 'visitors', 'client', 'clients', 'customer', 'customers', 'guest', 'guests', 'resident', 'residents', 'student', 'students', 'colleague', 'colleagues', 'coworker', 'coworkers', 'adult', 'adults', 'learner', 'learners', 'program', 'graduate', 'requested', 'needed', 'as-needed', 'potential', 'any', 'individualized', 'individualised', 'on-site', 'onsite', 'consistent', 'consistently', 'reliable', 'clear', 'clearly', 'closely', 'internal', 'external', 'end-to-end', 'existing', 'applicable', 'relevant', 'ongoing', 'established', 'execution', 'accredited', 'approved', 'aptitude', 'grasp', 'fundamentals', 'foundation', 'outcome', 'outcomes', 'individual', 'individuals', 'others', 'public', 'alongside', 'organization', 'organisation', 'ongoing', 'efficiency', 'efficiencies', 'opportunity', 'opportunities', 'initiative', 'initiatives', 'hours', 'hour', 'minutes', 'ride', 'always', 'never', 'times', 'volume', 'high-volume', 'document', 'documents', 'assigned', 'related', 'number', 'amount', 'quantity', 'computer', 'computers', 'however', 'even', 'candidate', 'candidates', 'prior', 'previous', 'proficient', 'skilled', 'think', 'wonder', 'see', 'look', 'looks', 'lot', 'able', 'enable', 'allow', 'allows', 'directly', 'closely', 'involved', 'involving', 'ensure', 'meet', 'needs', 'business', 'case-by-case', 'open', 'considering', 'exceptional', 'qualification', 'qualifications', 'listed', 'list', 'mainstream', 'large-scale', 'scale', 'impactful', 'comprehensive', 'complex', 'technically', 'technical', 'personal', 'direct', 'indirect', 'world-class', 'cutting-edge', 'state-of-the-art', 'robust', 'scalable', 'reliable', 'stable', 'modern', 'best', 'practice', 'practices', 'environment', 'principles', 'concepts', 'fundamentals', 'platform', 'platforms', 'solution', 'solutions', 'component', 'components', 'function', 'functions', 'need', 'needs', 'level', 'demonstrate', 'demonstrated', 'proven', 'make', 'take', 'get', 'keep', 'conduct', 'participate', 'complete', 'completing', 'serve', 'act', 'carry', 'stay', 'current', 'necessary', 'variety', 'range', 'multiple', 'other', 'additional', 'key', 'core', 'main', 'primary', 'overall', 'detailed', 'quick', 'quickly', 'immediately', 'timely', 'appropriately', 'professional', 'hands-on', 'world', 'real-world', 'unique', 'custom', 'common', 'various', 'specific', 'certain', 'concern', 'concerns', 'thing', 'things', 'part', 'parts', 'piece', 'pieces', 'basis', 'etc', 'familiarity', 'understanding', 'proficiency', 'expertise', 'exposure', 'comfortable', 'comfort', 'willing', 'willingness', 'desire', 'interest', 'passion', 'track', 'background', 'success', 'successful', 'successfully', 'responsible', 'responsibility', 'responsibilities', 'expected', 'expectation', 'expectations', 'oversee', 'implement', 'implementing', 'identify', 'drive', 'driving', 'deliver', 'improve', 'improving', 'involve', 'involving', 'apply', 'applying', 'bring', 'like', 'want', 'love', 'enjoy', 'achieve']);
// soft traits a résumé cannot prove (the statement is a trait when nothing else is left)
const SOFT = new Set(['communication', 'communicate', 'communicating', 'communicator', 'interpersonal', 'organizational', 'organisational', 'organized', 'organised', 'independently', 'independent', 'teamwork', 'team-player', 'reliable', 'reliability', 'dependable', 'dependability', 'punctual', 'punctuality', 'attendance', 'attention', 'detail', 'details', 'detail-oriented', 'urgency', 'motivated', 'self-motivated', 'self-starter', 'motivation', 'steady', 'pace', 'fast-paced', 'fast', 'paced', 'flexible', 'flexibility', 'adaptable', 'adaptability', 'positive', 'attitude', 'professionalism', 'multitask', 'multitasking', 'multi-task', 'prioritize', 'prioritise', 'prioritization', 'initiative', 'judgment', 'judgement', 'critical', 'thinking', 'friendly', 'courteous', 'enthusiastic', 'enthusiasm', 'energetic', 'honest', 'honesty', 'integrity', 'collaborative', 'collaborate', 'collaboration', 'cooperative', 'cooperation', 'instructions', 'instruction', 'directions', 'direction', 'follow', 'following', 'safely', 'verbal', 'written', 'oral', 'listening', 'listener', 'patience', 'patient-centered', 'empathy', 'empathetic', 'compassion', 'compassionate', 'calm', 'pressure', 'accountable', 'accountability', 'trustworthy', 'eager', 'learn', 'learner', 'learning', 'curious', 'curiosity', 'ownership', 'self-directed', 'driven', 'hardworking', 'hard-working', 'work-ethic', 'ethic', 'people-person', 'personable', 'outgoing', 'interpersonal', 'tact', 'tactful', 'diplomacy', 'discretion', 'confidentiality', 'resourceful', 'resilient', 'resilience', 'proactive', 'proactively', 'focused', 'diligent', 'thorough', 'meticulous', 'conscientious', 'creative', 'creativity', 'analytical', 'time-management', 'stress', 'ambiguity', 'mindset', 'sense', 'oriented', 'verbally', 'priorities', 'tidy', 'clear', 'concise', 'partner', 'partnering', 'challenge', 'challenges', 'thrive', 'thriving', 'succeed', 'adapt', 'adapting', 'foster', 'fosters', 'fostering', 'partnership', 'partnerships', 'appearance', 'attire', 'groomed', 'well-groomed', 'presentable', 'neat', 'autonomous', 'autonomy', 'autonomously', 'smile', 'smiling', 'connection', 'connections', 'motivational', 'cross-functional', 'cross-functionally', 'active', 'engaging', 'engage', 'engaged', 'engagement', 'smooth', 'smoothly', 'adhering', 'adhere', 'vision', 'values', 'mission', 'culture', 'dress', 'ethics', 'ethical', 'respect', 'respectful', 'warm', 'welcoming', 'polite', 'approachable', 'humble', 'hungry', 'grit', 'passionate', 'excitement', 'excited', 'fun', 'energy', 'upbeat', 'cheerful', 'helpful', 'kind', 'caring', 'mature', 'ambitious', 'competitive', 'persuasive', 'confident', 'confidence', 'assertive', 'decisive', 'common', 'coachable', 'open-minded', 'receptive', 'feedback', 'excellence', 'gravitas', 'presence', 'demeanor', 'demeanour', 'personality', 'mentality', 'pay', 'forward', 'incomplete', 'perseverance', 'persistence', 'dedication', 'dedicated', 'commitment', 'committed', 'loyal', 'loyalty', 'eagerness', 'readiness', 'deadline', 'deadlines', 'deadline-driven', 'organize', 'organizing', 'prioritizing', 'team-oriented', 'people-oriented', 'results-oriented', 'goal-oriented', 'service-oriented', 'customer-oriented', 'self-motivation', 'go-getter', 'can-do', 'playing', 'role', 'inclusive', 'belonging', 'diversity', 'humility', 'solid', 'fastidious', 'interact', 'interacting', 'interaction', 'interactions', 'empathetic', 'focused', 'customer-focused', 'self-starter', 'superior', 'juggle']);
// soft PHRASES taken out before the concepts are read ("follow all safety procedures", "work safely", "safety awareness")
const SOFT_PHRASE_RE = /\b(?:follow(?:s|ing)?|adhere(?:s|nce)?\s+to|comply(?:ing)?\s+with|compliance\s+with|abide\s+by)\s+(?:all\s+|company\s+|established\s+|standard\s+(?:operating\s+)?|safety\s+|written\s+|verbal\s+|work\s+)*(?:procedures?|polic(?:y|ies)|rules|instructions|directions|guidelines|guidance|protocols|SOPs?|standards|expectations)(?:\s*\([A-Z]{2,5}s?\))?|\bsafety\s+(?:awareness|conscious(?:ness)?|minded|first)|\bwork(?:ing)?\s+safely|\bin\s+a\s+safe\s+(?:and\s+\w+\s+)?manner|\btime[- ]management(?:\s+skills?)?|\b(?:[a-z]+\s+)?problem[- ]solving(?:\s+skills?)?|\bcritical\s+thinking|\b(?:(?:excellent|strong|good|effective)\s+)?(?:written|writing|verbal|oral)(?:\s+(?:and|&|\/)\s+(?:verbal|oral|written|writing))?\s+(?:communication|presentation)?(?:\s+skills)?(?=\W|$)|\bwriting\s+(?:and\s+communication\s+)?skills|\bas\s+part\s+of\s+a\s+team|\bwith\s+(?:a|the)\s+team|\bteam\s+player/gi;
// verbs that start a duty clause (a verb concept, never part of the object phrase)
const VERBS = new Set(('scan label pack ship load unload pick receive put store stock organize organise sort count weigh wrap palletize stage ' +
  'deliver drive operate install repair maintain inspect test diagnose troubleshoot calibrate replace assemble fabricate weld solder wire ' +
  'read interpret write draft prepare process enter record report document track monitor review audit reconcile post file invoice bill ' +
  'answer greet assist serve cook prep bake clean sanitize wash cut slice package ring cash count balance open close ' +
  'teach train coach mentor lead supervise manage schedule plan coordinate communicate negotiate sell present design develop build code ' +
  'deploy configure administer analyze analyse model forecast budget measure research evaluate assess triage treat administer chart ' +
  'educate counsel care bathe feed transfer transport escort dispense compound fill restock replenish merchandise display ' +
  'conduct perform provide ensure support handle respond resolve escalate collect verify validate approve submit procure specify obtain ' +
  'order purchase source move lift push pull climb follow keep utilize use participate implement improve identify create develop guide run hold give host offer turn partner recommend explain share align').split(/\s+/));
// judge-side equivalences: the same thing written as another word form
const SAME_STEM = { scanner: 'scan', scanning: 'scan', rf: 'scan', barcode: 'scan', shipping: 'ship', shipment: 'ship', packing: 'pack', receiving: 'receiv', preventiv: 'preventativ', diagnosi: 'diagnos', diagnostic: 'diagnos', troubleshoot: 'troubleshoot', calibration: 'calibrat', installation: 'install', inspection: 'inspect', repairs: 'repair', operator: 'operat', operation: 'operat', labeling: 'label', labell: 'label', invoic: 'invoice', palletiz: 'pallet', loader: 'load', welder: 'weld', mechanic: 'mechanic', inventori: 'inventory', stocking: 'stock', cashier: 'cash', register: 'cash', schedul: 'scheduling', merchandis: 'merchandis' };
export function foldStem(stem) { return fold(stem); }
function fold(stem) {
  let s = SAME_STEM[stem] || stem;
  if (SAME_STEM[s]) s = SAME_STEM[s];
  if (/ation$/.test(s) && s.length > 7) s = s.slice(0, -5) + 'at';
  return s;
}
const stemOf = (w) => fold(stemWord(w));
const GENERIC_STEMS = new Set([...GENERIC].map(stemOf));
const SOFT_STEMS = new Set([...SOFT].map(stemOf));
const STOP_STEMS = new Set([...STOP].map(stemOf));

// ── families (fieldAliases.js) ────────────────────────────────────────────────────────────────────────────────
function familyIndex(list) {
  const byStem = new Map();
  const phrases = [];
  const add = (s, id) => { if (!s) return; if (!byStem.has(s)) byStem.set(s, new Set()); byStem.get(s).add(id); };
  for (const f of list) {
    for (const w of String(f.forms || '').split(/\s+/).filter(Boolean)) { const raw = stemWord(w); add(raw, f.id); add(fold(raw), f.id); }
    for (const p of f.phrases || []) {
      // a form with digits or a colon ("1:1", "5S") is matched on the raw text; a word phrase by contiguous stems
      if (/[^A-Za-z\s'-]/.test(p) || /^[A-Z0-9]{2,}s?$/.test(p)) phrases.push({ id: f.id, re: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(p)}s?(?![A-Za-z0-9])`, /[a-z]/.test(p) ? 'i' : '') });
      else phrases.push({ id: f.id, stems: tokenize(p).map((t) => t.stem) });
    }
  }
  return { byStem, phrases, byId: new Map(list.map((f) => [f.id, f])) };
}
const ACTIONS = familyIndex(ACTION_FAMILIES);
const THINGS = familyIndex(SAME_THING);
const PEOPLE = familyIndex(PEOPLE_GROUPS);
/** The family ids a text holds (its single-word forms by stem, its phrases contiguous). */
function familiesIn(idx, toks, text) {
  const out = new Set();
  for (const t of toks) { for (const id of idx.byStem.get(t.stem) || []) out.add(id); for (const id of idx.byStem.get(fold(t.stem)) || []) out.add(id); }
  for (const p of idx.phrases) if (p.re ? p.re.test(text) : findStemmed(toks, p.stems).length) out.add(p.id);
  return out;
}
const famOfStem = (idx, s) => idx.byStem.get(s) || null;
const NEAR = new Map(ACTION_FAMILIES.map((f) => [f.id, new Set(f.near || [])]));
// neighbouring kinds of doing are neighbours both ways
for (const f of ACTION_FAMILIES) for (const n of f.near || []) { if (!NEAR.has(n)) NEAR.set(n, new Set()); NEAR.get(n).add(f.id); }
// a people group a posting names as a class ("adults") is proved by any group it lists
const PEOPLE_PROVES = new Map(PEOPLE_GROUPS.map((g) => [g.id, new Set([g.id, ...(g.proves || [])])]));
const whoWord = (w) => !!famOfStem(PEOPLE, w.stem);
const audienceWord = (w) => whoWord(w) || PARTNER_WORDS.has(w.raw);
// organisations and outside roles a statement names as who the work is WITH ("with cardiologists, home health agencies")
const PARTNER_WORDS = new Set(['physician', 'physicians', 'doctor', 'doctors', 'provider', 'providers', 'cardiologist', 'cardiologists', 'specialist', 'specialists', 'pharmacist', 'pharmacists', 'therapist', 'therapists', 'vendor', 'vendors', 'supplier', 'suppliers', 'insurer', 'insurers', 'payer', 'payers', 'agency', 'agencies', 'carrier', 'carriers', 'partner', 'partners', 'department', 'departments', 'subcontractor', 'subcontractors', 'subs', 'contractor', 'contractors', 'superintendent', 'superintendents', 'supervisor', 'crews', 'founder', 'founders', 'owners', 'audiences', 'audience', 'nontechnical', 'non-technical', 'customers', 'clients', 'operations', 'engineering', 'product', 'finance', 'sales', 'marketing', 'hr', 'it', 'legal', 'qa', 'leads', 'supervisors', 'vp', 'vps', 'ceo', 'cfo', 'c-suite', 'board']);
// the state a place is kept in, as the action that keeps it so
const STATE_VERB = { clean: 'clean', organized: 'organize', organised: 'organize', tidy: 'tidy', stocked: 'stock', sanitized: 'sanitize' };
const KEEP_STATE_RE = /\bkeep(?:s|ing)?\s+(?:the\s+|all\s+|a\s+|your\s+|our\s+)?((?:[a-z-]+\s+){0,2}?[a-z-]+)\s+(clean|organized|organised|tidy|stocked|sanitized)\b(?:\s+(?:and|&)\s+(?:clean|organized|organised|tidy|stocked|sanitized|safe))?/gi;
// manner and time qualifiers taken out before the concepts are read ("in plain language", "from day one through nesting")
const MANNER_RE = /\bin\s+plain\s+(?:language|english)\b|\bin\s+(?:a|an)\s+(?:[a-z-]+\s+){0,2}(?:manner|way|fashion)\b|\bfrom\s+day\s+one\b(?:\s+(?:through|to|until)\s+[a-z-]+(?:\s+[a-z-]+)?)?|\bfrom\s+[a-z-]+(?:\s+[a-z-]+)?\s+(?:through|until|thru)\s+[a-z-]+(?:\s+[a-z-]+)?|\bat\s+(?:all\s+times|every\s+(?:shift|visit|step))\b|\bon\s+(?:a\s+)?(?:daily|weekly|monthly|regular|ongoing)\s+basis\b/gi;

// ── concepts ──────────────────────────────────────────────────────────────────────────────────────────────────
const SCOPE_PREP = new Set(['down', 'across', 'within', 'throughout', 'during', 'under', 'according', 'per', 'around', 'among', 'when', 'while', 'where', 'whenever', 'if', 'unless', 'so', 'because', 'since', 'until', 'that', 'which', 'who', 'whose', 'without', 'beyond', 'regardless', 'before', 'after', 'once']);
const KEEP_PREP = new Set(['of', 'for', 'to', 'with', 'using', 'on', 'about', 'from', 'into', 'by', 'through', 'via', 'as', 'against']);
const AUDIENCE_PREP = new Set(['to', 'with', 'for', 'from', 'by']);
// a group a session is held for ("for classes of 10-15 agents")
const GROUP_WORDS = new Set(['class', 'classes', 'group', 'groups', 'cohort', 'cohorts', 'audiences', 'audience']);
// what is taught or presented is a list of topics: any one shows the teaching
const TOPIC_FAMS = new Set(['teach', 'present', 'coach', 'facilitate']);
const RECORD_HEADS = new Set(['record', 'report', 'data', 'document', 'log', 'file', 'count', 'level']);
const LY_NOUNS = new Set(['supply', 'assembly', 'family', 'italy', 'anomaly', 'monopoly', 'jelly', 'belly', 'ally', 'rally', 'reply', 'poly']);
const SOFT_CUE_RE = /\b(?:skills?|ability|abilities|willing(?:ness)?|mindset|mentality|interpersonal|communicat\w*|judg(?:e)?ment|attitude|self-motivated|independently|proactive|curiosity|curious|eager|desire|passion|comfortable|comfort|thrive|attention|organized|organizational|collaborat\w*|relationship|focus(?:ed)?)\b/i;
// a single word that names a learnable skill or tool stays a concept even in a soft line ("Proficiency in Excel")
const SKILL_WORD_RE = /^(?:[A-Z][A-Za-z0-9+#.]*[A-Z0-9+#][A-Za-z0-9+#.]*|[A-Z][a-z]+(?:[A-Z][a-z]+)+|excel|sql|python|java|spanish|french|bilingual|negotiation|presentation|bookkeeping|accounting|welding|forklift|sales|coding|typing|budgeting|forecasting|scheduling|payroll|invoicing|billing)$/;
const WHO_WORDS = new Set(['personnel', 'staff', 'team', 'teams', 'clients', 'client', 'customers', 'customer', 'employees', 'members', 'people', 'users', 'patients', 'students', 'leadership', 'executives', 'managers', 'stakeholders', 'partners', 'vendors', 'others', 'colleagues', 'residents', 'families', 'guests']);
const QUALIFIER_PREP = new Set(['for', 'from', 'by']);
const TAIL_NOUNS = new Set(['equipment', 'system', 'systems', 'tools', 'tool', 'items', 'item', 'products', 'product', 'records', 'reports', 'procedures', 'machinery', 'devices', 'software', 'applications', 'programs', 'materials']);
// verbs that name a skill by themselves (a warehouse "scan", a tech "calibrate"); "read", "provide", "specify" do not
const SPECIFIC_VERBS = new Set(('scan label pack ship load unload pick put palletize wrap weigh stock restock replenish merchandise sort install repair inspect diagnose troubleshoot ' +
  'calibrate replace assemble fabricate weld solder wire deliver cook prep bake sanitize slice cash ring balance reconcile invoice bill audit post file teach tutor coach mentor ' +
  'supervise schedule negotiate sell code deploy configure administer analyze analyse model forecast budget triage treat chart educate counsel bathe feed transfer transport dispense ' +
  'compound fill draw greet answer receive load unload count lift clean').split(/\s+/));
const EXAMPLE_CUE_RE = /\s*(?:\(\s*(?:e\.g\.?|i\.e\.?|such\s+as|including|like)?[,:]?\s*([^()]{2,140})\)|,?\s+(?:including|such\s+as|like|e\.g\.?|for\s+example)[,:]?\s+([^.;]{2,140}))/i;
/** Words of one clause, cleaned, with their stems (stop, generic and soft words marked). */
function words(text) {
  return tokenize(text).map((t) => {
    // an acronym's plural is the acronym ("APIs" = "API", "LLMs" = "LLM")
    const orig = String(text).slice(t.start, t.end);
    let stem = /^[A-Z]{2,}s$/.test(orig) ? orig.slice(0, -1).toLowerCase() : fold(t.stem);
    // a word that is a different thing inside a fixed term ("logistic regression" is statistics, not logistics)
    if (stem === 'logistic' && /^\s+regression/i.test(String(text).slice(t.end))) stem = 'logistic-regression';
    const raw = t.raw;
    return { raw, stem, stop: STOP_STEMS.has(stem) || STOP.has(raw) || /^\d+[+%]?$/.test(raw), generic: GENERIC_STEMS.has(stem) || GENERIC.has(raw) || (/^[a-z]{4,}ly$/.test(raw) && !LY_NOUNS.has(raw)), soft: SOFT_STEMS.has(stem) || SOFT.has(raw), start: t.start, end: t.end };
  });
}

/**
 * The concepts a statement asks for: [{ kind: 'verb'|'object', stems: [...], head, surface, examples: [[stems]...] }]
 * plus whether only soft words were left (a trait). `text` is the statement as a person reads it.
 */
export function statementConcepts(text) {
  let t = String(text || '').replace(/[“”"]/g, '');
  // examples: alternatives that prove the phrase they follow
  let examples = [];
  const ex0 = t.match(EXAMPLE_CUE_RE);
  // (an acronym in brackets — "Physical Therapist (PT)" — is the same thing said again, not an example list)
  const ex = ex0 && !(ex0[1] && /^\s*[A-Z][A-Za-z0-9&/+.-]{1,8}\s*$/.test(ex0[1])) ? ex0 : null;
  if (ex) {
    const body = (ex[1] || ex[2] || '').replace(/\band\s+similar\b|\band\s+others?\b|\betc\.?/gi, '');
    examples = body.split(/\s*,\s*|\s+(?:and|or)\s+|\s*\/\s*/).map((x) => x.trim()).filter((x) => x && x.split(/\s+/).length <= 4);
    t = t.slice(0, ex.index) + ' ' + t.slice(ex.index + ex[0].length);
  }
  // a short parenthetical that is an acronym or a gloss is the same thing said again — the acronym proves the phrase
  const acronyms = [];
  for (const m of t.matchAll(/((?:[A-Za-z][\w-]*\s+){1,4})\(\s*([A-Z][A-Za-z0-9&/+-]{1,8})\s*\)/g)) acronyms.push({ phrase: m[1].trim().toLowerCase(), acronym: m[2] });
  t = t.replace(/\(([^()]{1,60})\)/g, ' ');
  // how and when ("in plain language", "from day one through nesting") are not asked
  t = t.replace(MANNER_RE, ' ').replace(/\band\/or\b/gi, 'or').replace(/\bbusiness[- ]to[- ]business\b/gi, 'B2B').replace(/\bbusiness[- ]to[- ]consumer\b/gi, 'B2C');
  // the employer's own name is not something a résumé shows ("CSI’s cash/money handling processes", "CSI policies"):
  // a capitalised possessive, or an acronym before a policy word, is dropped; "-related" / "-based" modifiers say only "about"
  t = t.replace(/\b(?:[A-Z]{2,6}|[A-Z][a-z]+(?:[A-Z][a-z]+)*)['’]s\b/g, ' ').replace(/\b[A-Z]{2,6}\s+(?=(?:policies|policy|guidelines|guidance|procedures|processes|process|standards|values|brand|programs?|expectations|practices)\b)/g, ' ')
    .replace(/\b([a-z]+)-(?:related|based|focused|oriented|driven|specific)\b/gi, '$1').replace(/\bincluding,?\s+but\s+not\s+limited\s+to\b|\bbut\s+(?:are|is)\s+not\s+limited\s+to\b/gi, ' including ');
  // "Keep the warehouse clean and organized" is the action "clean" on the place: read it as "clean the warehouse"
  t = t.replace(KEEP_STATE_RE, (m, place, state) => `${STATE_VERB[state.toLowerCase()] || state.toLowerCase()} ${place}`);
  // two verbs that open the line as one activity ("Create or improve", "Develop and update", "Train and coach"): one
  // action, either form proves it — "or" always, "and" only for neighbouring kinds of doing
  let coFams = null, coSurface = '';
  const lead0 = (t.match(/^\s*(?:(?:proven|demonstrated|hands-on|prior|previous|strong)\s+)?(?:experience|ability|able)\s+(?:to\s+|in\s+|with\s+)?/i) || [''])[0];
  const co0 = t.slice(lead0.length).match(/^\s*([A-Za-z]+)\s*(?:,\s*([A-Za-z]+)\s*,?)?\s*(\s(?:and|or|&)\s|\/|\s?and\/or\s)\s*([A-Za-z]+)\b/);
  const co = co0 ? Object.assign(co0, { index: co0.index + lead0.length }) : null;
  if (co) {
    const vs = [co[1], co[2], co[4]].filter(Boolean);
    const fams = vs.map((v) => verbFamilies(v.toLowerCase()));
    if (fams.every((f) => f && f.size)) {
      const near = (a, b) => [...a].some((x) => b.has(x) || [...b].some((y) => (NEAR.get(x) || new Set()).has(y)));
      // ("Build and evaluate predictive models": a line that builds the model shows the action — the gist rule, V)
      if (/or|\/|and|&/.test(co[3]) || fams.every((f, k) => k === 0 || near(fams[0], f))) {
        coFams = new Set(fams.flatMap((f) => [...f]));
        coSurface = t.slice(co.index, co.index + co[0].length).trim();
        t = t.slice(0, co.index) + ' ' + co[4] + t.slice(co.index + co[0].length);
      }
    }
  }
  // "Collaborate with nursing, physicians, and case management", "Partner with SDRs to share feedback": working WITH named
  // people is the action (coordinate) and the people are its object — a line that worked with one of them shows it
  let partnerConcept = null;
  let partnerVerb = '';
  const pw = t.match(/^\s*(?:collaborat\w*|partner(?:s|ing)?|work(?:s|ing)?|liais\w*)(?:\s+(?:closely|cross-functionally|directly))?\s+with\s+((?:[^,.;]|,(?=\s*(?:and\s+)?[a-z]))+?)(?=\s+(?:to|on|in|for|so|and\s+(?:to\s+)?[a-z]+e\b)\s|[.;]|$)/i);
  if (pw) {
    const ws0 = words(pw[1]).filter((w) => !w.stop && !GENERIC.has(w.raw) && !FIELD_ADJ.has(w.raw) && !/^(?:teams?|internal|external|all|other|key|cross-functional|individual)$/.test(w.raw));
    // ("agency leadership and individual producers": "leadership" names nobody in particular)
    const ws = ws0.filter((w) => !whoWord(w)).length ? ws0.filter((w) => !whoWord(w)) : ws0;
    if (ws.length) {
      partnerVerb = (pw[0].match(/^\s*([A-Za-z-]+)/) || [, 'work with'])[1];
      partnerConcept = { kind: 'object', stems: [ws[0].stem], head: ws[0].stem, surface: pw[1].trim(), examples: ws.map((w) => [w.stem]), partner: true, clause: 0 };
      t = t.slice(0, pw.index) + ' coordinate ' + t.slice(pw.index + pw[0].length);
    }
  }
  const softRemoved = SOFT_PHRASE_RE.test(t);
  SOFT_PHRASE_RE.lastIndex = 0;
  t = t.replace(SOFT_PHRASE_RE, ' , ');
  const concepts = [];
  let sawSoft = softRemoved;
  // clauses: list separators; "or" between the last two items makes the list any-of
  const clauses = t.split(/\s*[,;:+]\s*|\s+(?:and|or|as\s+well\s+as|plus)\s+|\s+&\s+|\s+\/\s+/i).map((c) => c.trim()).filter(Boolean);
  const anyOf = /\bor\b/i.test(t) && !/\band\b/i.test(t);
  let audience = false; // the last clause ended "to / with / for <people>": a bare list of people after it continues it
  let topicVerb = false; // a teach / present / coach verb was read: "on / about <topics>" lists what is taught
  let inTopic = false;
  const first = words(t).find((w) => !w.stop);
  const leadVerb = !!first && (VERBS.has(first.raw) || VERBS.has(first.raw.replace(/(?:s|es|ed|ing)$/, '')) || !!verbFamilies(first.raw) || first.soft);
  for (const [ci, clause] of clauses.entries()) {
    const at = concepts.length;
    const ws = words(clause);
    if (ws.some((w) => w.soft && !w.stop)) sawSoft = true;
    const cw = ws.filter((w) => !w.stop && !w.soft);
    // "…to operations and clinical leaders", "…with cardiologists, home health agencies and insurers"
    const cwSpecific = cw.filter((w) => !w.generic || audienceWord(w));
    const cwLast = cwSpecific[cwSpecific.length - 1];
    if (audience && cwLast && cw.length <= 5 && (audienceWord(cwLast) || GROUP_WORDS.has(cwLast.raw)) && !verbFamilies(cw[0].raw)) continue;
    audience = false;
    // segments at prepositions: "repairs | of production line equipment"; a scope qualifier ("across all modules",
    // "according to customer specifications", "in a fast-paced setting") says where, not what — it is not asked for
    const segs = [];
    let cur = [], skip = false, prep = null;
    for (const w of ws) {
      if (SCOPE_PREP.has(w.raw)) { if (cur.length && !skip) segs.push({ ws: cur, prep }); cur = []; skip = true; continue; }
      // a scope qualifier ("during the course of treatment", "that powers research") runs to the end of the clause
      if (KEEP_PREP.has(w.raw)) { if (skip) continue; if (cur.length) segs.push({ ws: cur, prep }); cur = []; prep = w.raw; continue; }
      if (skip) continue;
      cur.push(w);
    }
    if (cur.length && !skip) segs.push({ ws: cur, prep });
    let emptyLead = false;
    let prevAudience = false;
    segs.forEach(({ ws: seg, prep: segPrep }, si) => {
      // "Communicate effectively with other warehouse team members": after a soft verb, "with …" names who, not what
      if (si === 0) emptyLead = seg.some((w) => w.soft) && !seg.some((w) => !w.stop && !w.soft && !w.generic);
      if (si > 0 && emptyLead && segPrep === 'with') { if (si === segs.length - 1) audience = true; return; }
      const content = seg.filter((w) => !w.stop && !w.soft);
      // "for new and existing agents": the people list starts in this clause and goes on in the next
      if (!content.length || (si > 0 && AUDIENCE_PREP.has(segPrep) && !content.some((w) => !w.generic))) { if (si > 0 && AUDIENCE_PREP.has(segPrep) && si === segs.length - 1) audience = true; return; }
      // who it is for / with ("to … leaders", "for classes of 10-15 … agents", "with cardiologists"): not asked
      const last = content[content.length - 1];
      if (si > 0 && (segPrep === 'to' || leadVerb || concepts.some((c) => c.kind === 'verb')) && (AUDIENCE_PREP.has(segPrep) || (segPrep === 'of' && prevAudience)) && (audienceWord(last) || (GROUP_WORDS.has(last.raw) && segPrep !== 'of'))) {
        prevAudience = true;
        if (si === segs.length - 1) audience = true;
        return;
      }
      prevAudience = false;
      if (si > 0 && topicVerb && (segPrep === 'on' || segPrep === 'about')) inTopic = true;
      let i = 0;
      // a clause that opens on a verb: a SPECIFIC verb is its own concept ("Scan", "label inventory items"); a verb of a
      // known family ("present", "educate", "lead") is too; a general one ("read", "specify") is not asked by itself
      const v = content[0].raw;
      // a clause that is only a gerund ("Hitting or exceeding quota") is a verb, never an object of its own
      if (content.length === 1 && /^[a-z]{4,}ing$/.test(v)) {
        const base = [v.slice(0, -3), `${v.slice(0, -3)}e`, v.slice(0, -4)].find((x) => SPECIFIC_VERBS.has(x));
        const fam = verbFamilies(v);
        if ((base || fam) && si === 0) { concepts.push(verbConcept(content[0], v, fam)); if (fam && [...fam].some((f) => TOPIC_FAMS.has(f))) topicVerb = true; }
        return;
      }
      const fam = si === 0 ? verbFamilies(v) : null;
      const verbLike = VERBS.has(v) || VERBS.has(v.replace(/(?:s|es|ed|ing)$/, '')) || VERBS.has(v.replace(/(?:s|d|ing)$/, '')) || (content.length > 1 && /^[a-z]+(?:ize|ise|ate)$/.test(v)) || (fam && (content.length > 1 || concepts.length === 0) && !/(?:tion|ment|ance|ence|sis|ing)s?$/.test(v) && !(content.length === 1 && /[^s]s$|ss$/.test(v) && !VERBS.has(v.replace(/s$/, ''))));
      if (verbLike) {
        i = 1;
        const base = [v, v.replace(/(?:s|es|ed|ing)$/, ''), v.replace(/(?:s|d|ing)$/, '')].find((x) => SPECIFIC_VERBS.has(x));
        // a light verb before an action noun adds nothing ("Deliver new-hire training", "Provide one-on-one feedback")
        const objText = content.length > 1 ? clause.slice(content[1].start, content[content.length - 1].end) : '';
        const light = [v, v.replace(/(?:s|es|ed|ing)$/, ''), v.replace(/(?:s|d|ing)$/, '')].some((x) => LIGHT_VERBS.has(x)) && objText && objectIsAction(objText);
        if (si === 0 && !light && (base || fam)) {
          const vc = verbConcept(content[0], base === 'put' ? 'put away' : v, fam);
          if (coFams && !concepts.some((c) => c.kind === 'verb')) { vc.families = new Set([...(vc.families || []), ...coFams]); vc.surface = coSurface; }
          concepts.push(vc);
          if (vc.families && [...vc.families].some((f) => TOPIC_FAMS.has(f))) topicVerb = true;
        }
      }
      // the object phrase: the specific words left, at most the last three (head last)
      let obj = content.slice(i).filter((w) => !w.generic);
      // a soft head ("customer and founder feedback", "client relationships"): its modifiers are not a thing to show
      const segLast = seg.filter((w) => !w.stop).slice(-1)[0];
      if (segLast && segLast.soft && !segLast.generic) obj = obj.filter((w) => SKILL_WORD_RE.test(clause.slice(w.start, w.end)) || famOfStem(THINGS, w.stem) || THINGS.phrases.some((p) => (p.re && p.re.test(clause.slice(w.start, w.end))) || (p.stems && p.stems.length === 1 && p.stems[0] === stemWord(w.raw))));
      // a field adjective is never asked by itself: dropped when it modifies a noun, and a clause of only field adjectives
      // ("mechanical" in "mechanical and electrical troubleshooting") is the next clause's modifier
      if (obj.length && obj.every((w) => FIELD_ADJ.has(w.raw))) obj = [];
      else if (obj.length > 1) obj = obj.filter((w, n) => n === obj.length - 1 || !FIELD_ADJ.has(w.raw));
      // the class the WHOLE segment names ("warehouse equipment" — "equipment" alone is generic, the class is not)
      const segText = clause.slice(seg[0].start, seg[seg.length - 1].end);
      const classIds = INSTANCE_CLASSES.filter((c) => c.names.test(segText)).map((c) => c.id);
      if (!obj.length) {
        // only people after the verb ("Educate patients and families", "Greet customers"): who the action is for IS
        // the object — one any-of concept, proved by its people group, never by itself
        const who = content.slice(i).filter((w) => whoWord(w));
        if (who.length && concepts.some((c) => c.kind === 'verb') && !inTopic) concepts.push({ kind: 'who', stems: who.map((w) => w.stem), head: who[who.length - 1].stem, surface: clause.slice(who[0].start, who[who.length - 1].end), groups: new Set(who.flatMap((w) => [...(famOfStem(PEOPLE, w.stem) || [])])) });
        return;
      }
      const tail = obj.slice(-3);
      // the words as the posting wrote them, a trailing class noun kept ("high vacuum systems", "test equipment")
      const lastContent = content[content.length - 1];
      const end = TAIL_NOUNS.has(lastContent.raw) && lastContent.end > tail[tail.length - 1].end ? lastContent.end : tail[tail.length - 1].end;
      const firstKept = content.slice(i).find((w) => !w.generic) || tail[0];
      let surface = clause.slice(Math.min(firstKept.start, tail[0].start), end).replace(/\s+/g, ' ');
      if (classIds.length) { const cl = INSTANCE_CLASSES.find((c) => c.id === classIds[0]); const m = segText.match(cl.names); if (m) surface = m[0]; }
      // "experience designing reliable data processing": a gerund that opens the object is its action
      if (si === 0 && tail.length > 1 && /^[a-z]{4,}ing$/.test(tail[0].raw) && verbFamilies(tail[0].raw) && !concepts.some((c) => c.kind === 'verb' && c.clause === undefined)) {
        concepts.push(verbConcept(tail[0], tail[0].raw, verbFamilies(tail[0].raw)));
        tail.shift();
        surface = clause.slice(tail[0].start, end).replace(/\s+/g, ' ');
      }
      const fullStems = content.slice(i).filter((w) => w.start >= firstKept.start).map((w) => w.stem);
      concepts.push({ kind: 'object', stems: tail.map((w) => w.stem), fullStems, head: tail[tail.length - 1].stem, surface, phrase: tail.map((w) => w.raw).join(' '), segment: segText, classIds,
        topic: inTopic || undefined,
        // "for production personnel", "from vendors": who it is for, not what is asked
        // ("for production personnel" is who it is for; "for technology transfer" is what is asked)
        qualifier: si > 0 && ((QUALIFIER_PREP.has(segPrep) && seg.some((w) => WHO_WORDS.has(w.raw))) || (emptyLead && segPrep === 'with')), shownAs: classIds.length ? surface : clause.slice(tail[0].start, tail[tail.length - 1].end).replace(/\s+/g, ' ') });
    });
    // the clause each concept was read from: a verb acts on the objects of its own clause (a bare list item after it
    // — "…training materials, job aids and e-learning modules" — is still its object)
    for (const c of concepts.slice(at)) c.clause = ci;
  }
  // the examples hang on the last object concept before them (the phrase they illustrate)
  if (examples.length) {
    const target = [...concepts].reverse().find((c) => c.kind === 'object') || null;
    const exStems = examples.map((e) => words(e).filter((w) => !w.stop && !w.generic).map((w) => w.stem)).filter((s) => s.length);
    if (target) target.examples = exStems; else concepts.push({ kind: 'object', stems: exStems[0] || [], head: (exStems[0] || []).slice(-1)[0], surface: examples[0], examples: exStems });
  }
  // people named one after another are ONE any-of "who" ("patients and families"); topics taught ("on medications, diet
  // and warning signs") are ONE any-of object: any one shows what is taught
  const merged = [];
  for (const c of concepts) {
    if (c.kind === 'who') { const w = merged.find((x) => x.kind === 'who'); if (w) { w.groups = new Set([...w.groups, ...c.groups]); w.surface = `${w.surface} or ${c.surface}`; w.alts = [...(w.alts || [w.stems]), c.stems]; continue; } }
    if (c.topic && c.kind === 'object') { const tp = merged.find((x) => x.topic); if (tp) { tp.examples = [...(tp.examples || [tp.stems]), c.stems, ...(c.examples || [])]; tp.surface = `${tp.surface}, ${c.surface}`; tp.shownAs = tp.surface; continue; } }
    merged.push(c);
  }
  if (partnerConcept) {
    const vi = merged.findIndex((c) => c.kind === 'verb');
    // (the action is said in the posting's own word: "Partner", "Collaborate")
    if (vi >= 0 && merged[vi].surface === 'coordinate') merged[vi].surface = partnerVerb;
    merged.splice(vi >= 0 ? vi + 1 : 0, 0, partnerConcept);
  }
  // the alternatives of an "X or Y" list: the concepts on either side of an "or" (never a word outside the list)
  if (/\bor\b/i.test(t)) {
    const low = t.toLowerCase();
    const objs = merged.filter((c) => c.kind === 'object' && !c.partner);
    const posOf = (c) => low.indexOf(String(c.shownAs || c.surface || '').toLowerCase().split(/[,\s]+/)[0]);
    const ps = objs.map((c) => ({ c, p: posOf(c) })).filter((x) => x.p >= 0).sort((a, b) => a.p - b.p);
    ps.forEach((x, n) => {
      const before = n > 0 ? low.slice(ps[n - 1].p, x.p) : '';
      const after = n + 1 < ps.length ? low.slice(x.p, ps[n + 1].p) : '';
      if (/\bor\b/.test(before) || /\bor\b/.test(after)) x.c.alt = true;
    });
  }
  for (const c of merged) if (c.kind === 'object') for (const a of acronyms) if (String(c.surface || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3).every((w) => a.phrase.includes(w)) && String(c.surface || '').length > 3) c.acronyms = [...(c.acronyms || []), a.acronym];
  let kept = merged.filter((c) => c.stems.length);
  // a line that is only an action noun and who it is for ("Patient and family education", "Staff training"): the noun is
  // the action, the people its object
  if (!kept.length) {
    // (never from a when / why tail: "…to agents after training")
    const cut = t.search(/\b(?:after|before|during|while|when|once|until|to\s+ensure|so\s+that)\b/i);
    const ws = words(cut > 0 ? t.slice(0, cut) : t);
    const act = ws.find((w) => verbFamilies(w.raw));
    if (act) {
      kept = [verbConcept(act, act.raw, verbFamilies(act.raw))];
      const who = ws.filter((w) => whoWord(w));
      if (who.length) kept.push({ kind: 'who', stems: who.map((w) => w.stem), head: who[who.length - 1].stem, surface: who.map((w) => w.raw).join(' or '), groups: new Set(who.flatMap((w) => [...(famOfStem(PEOPLE, w.stem) || [])])) });
    }
  }
  // a soft line with one stray word left ("Willingness to learn, grow…", "ability to engage active and passive
  // candidates", "Exercise independent judgment") is a trait: the leftover word is not something it asks to be shown
  const softLine = SOFT_CUE_RE.test(text);
  const objectish = kept.filter((c) => c.kind !== 'verb' || !c.familyOnly);
  const trait = !objectish.length ? sawSoft && !kept.length : softLine && objectish.length === 1 && objectish[0].stems.length === 1 && !objectish[0].classIds?.length && !SKILL_WORD_RE.test(objectish[0].surface) && !kept.some((c) => c.kind === 'verb' && c.families && c.families.size);
  return { concepts: trait ? [] : kept, all: kept, trait, anyOf };
}
// verb families a word belongs to (by its stem), or null — a plural noun ("sales", "reports") is not the verb
function verbFamilies(raw) {
  const w = String(raw || '').toLowerCase();
  if (/[^s]s$/.test(w) && !VERBS.has(w.replace(/s$/, '')) && !VERBS.has(w.replace(/es$/, '')) && !/(?:ies|ses|ches|shes|xes|zes)$/.test(w)) return null;
  const f = famOfStem(ACTIONS, fold(stemWord(w))) || famOfStem(ACTIONS, stemWord(w));
  return f && f.size ? new Set(f) : null;
}
function verbConcept(word, surface, fam) {
  return { kind: 'verb', stems: [word.stem], head: word.stem, surface, families: fam || null, familyOnly: !SPECIFIC_VERBS.has(word.raw) && !SPECIFIC_VERBS.has(word.raw.replace(/(?:s|es|ed|ing)$/, '')) && !SPECIFIC_VERBS.has(word.raw.replace(/(?:s|d|ing)$/, '')) };
}
/** Does an object phrase name an action ("new-hire training", "one-on-one feedback", "assessments")? */
function objectIsAction(objText) {
  const toks = tokenize(objText);
  if (!toks.length) return false;
  const head = toks[toks.length - 1];
  if (famOfStem(ACTIONS, head.stem) || famOfStem(ACTIONS, fold(head.stem))) return true;
  const things = familiesIn(THINGS, toks, objText);
  return things.has('one-on-one') || things.has('call-review') || things.has('discovery') || familiesIn(ACTIONS, toks, objText).has('coach');
}
// ── lines ─────────────────────────────────────────────────────────────────────────────────────────────────────
const linesCache = new Map();
// adjectives that only name the field a thing is in ("clinical documentation", "mechanical and electrical troubleshooting"):
// they never decide a match when the thing itself is shown
const FIELD_ADJ = new Set(['clinical', 'technical', 'medical', 'mechanical', 'electrical', 'operational', 'financial', 'administrative', 'analytical', 'digital', 'strategic', 'tactical', 'commercial', 'interdisciplinary', 'multidisciplinary', 'cross-functional', 'hands-on', 'hardware', 'reusable', 'recurring', 'regular', 'scheduled', 'routine', 'critical', 'meaningful', 'complex', 'advanced']);
const CONTACT_RE = /[\w.+-]+@[\w-]+\.[\w.]+|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\blinkedin\.com\b/i;
// a line in a licences / certifications block, or one that names a credential and nothing done
const CERT_LINE_RE = /\b(?:certif\w*|certificate|licen[sc]e[ds]?|licensure|registered\s+nurse|BLS|ACLS|PALS|CPR|ServSafe|OSHA[\s-]?\d+|food\s+handler|first\s+aid|CDL)\b/i;
function judgeLines(resumeText) {
  const key = String(resumeText || '');
  if (linesCache.has(key)) return linesCache.get(key);
  const out = proofLines(key)
    // (a name / contact line at the top — an email, a phone number — proves nothing: "Logistics & Operations Coordinator —
    // Naperville, IL — priya.…@…")
    .filter((l) => !l.inProgress && !l.objective && l.kind !== 'header' && !CONTACT_RE.test(l.text))
    .map((l, idx) => {
      const stems = new Set();
      for (const w of words(l.match)) { stems.add(w.stem); if (w.raw.includes('-')) for (const p of w.raw.split('-')) if (p) stems.add(stemOf(p)); }
      // an instance on the line proves its class ("forklift" ⇒ warehouse equipment)
      const classes = new Set();
      for (const c of INSTANCE_CLASSES) if (c.instances.some((re) => re.test(l.match))) classes.add(c.id);
      const toks = tokenize(l.match);
      // a line that only LISTS (skills, education, a licence or certification) proves a named skill or tool, never a duty
      const cert = l.kind !== 'bullet' && l.kind !== 'role' && CERT_LINE_RE.test(l.match) && !/^[\s•\-*·–]*[A-Z][a-z]+ed\b/.test(l.match);
      return { ...l, jstems: stems, classes, idx, cert, listOnly: l.kind === 'skills' || l.kind === 'education' || cert,
        actions: familiesIn(ACTIONS, toks, l.match), things: familiesIn(THINGS, toks, l.match), people: familiesIn(PEOPLE, toks, l.match),
        number: /\d/.test(l.match.replace(/\b(?:19|20)\d\d\b/g, '')) };
    });
  if (linesCache.size > 50) linesCache.clear();
  linesCache.set(key, out);
  return out;
}
function classesNaming(phrase) {
  return INSTANCE_CLASSES.filter((c) => c.names.test(phrase)).map((c) => c.id);
}
// a place a clean / organise / stock action happens in: any place proves it (a "work area" is where the warehouse is kept)
const PLACE_STEMS = new Set(['warehous', 'store', 'kitchen', 'floor', 'area', 'station', 'dock', 'aisl', 'stockroom', 'unit', 'facility', 'shop', 'restaurant', 'office', 'lab', 'walk-in', 'workstation', 'room', 'site', 'bay', 'cooler', 'freezer', 'shelf', 'shelv', 'workspac', 'space', 'counter', 'line', 'pantry', 'premis', 'build', 'lobby'].map((x) => fold(x)));
const PLACE_ACTIONS = new Set(['clean', 'organize', 'store']);
/** A concept that names a skill or tool a list may prove ("Excel", "Talkdesk", "warehouse management system"). */
function skillish(c) {
  if (c.kind !== 'object') return false;
  if ((c.classIds && c.classIds.length) || (c.aliasRes && c.aliasRes.length)) return true;
  const s = String(c.surface || '');
  return (c.stems.length === 1 && SKILL_WORD_RE.test(s)) || /[A-Z]{2,}|[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|\+\+|#/.test(s) || (c.stems.length <= 3 && /^[A-Z]/.test(s) && s.split(/\s+/).every((w) => /^[A-Z0-9]/.test(w)));
}
// a role or licence named inside a longer one is a different role: "Physical Therapist" inside "Physical Therapist Assistant"
const JUNIOR_RE = /^\s*(?:assistants?|aides?|techs?|technicians?|apprentices?|helpers?|students?|trainees?|interns?|candidates?|associates?)\b/i;
function juniorOf(concept, line) {
  const toks = tokenize(line.match);
  const want = (concept.stems || []).map(String);
  if (want.length < 1) return false;
  for (let i = 0; i + want.length <= toks.length; i++) {
    if (!want.every((w, k) => fold(toks[i + k].stem) === w || toks[i + k].stem === w)) continue;
    const after = line.match.slice(toks[i + want.length - 1].end);
    if (JUNIOR_RE.test(after) && !JUNIOR_RE.test(String(concept.surface || '').split(/\s+/).pop() || '')) return true;
  }
  return false;
}
/** How a concept stands on one line: 2 = shown, 1 = only its head noun (half), 0 = not. */
// (a hyphenated word: every part on the line, a generic LAST part optional — "test-system" ← "test cell"; "member-facing"
// is never "face shelves")
const hasStem = (line, st) => line.jstems.has(st) || (st.includes('-') && (() => { const ps = st.split('-').filter(Boolean); while (ps.length > 1 && (GENERIC_STEMS.has(stemOf(ps[ps.length - 1])) || GENERIC.has(ps[ps.length - 1]))) ps.pop(); return ps.every((p) => line.jstems.has(stemOf(p))); })());
const famHit = (idx, st, have) => { const f = famOfStem(idx, st); return !!f && [...f].some((id) => have.has(id)); };
// a word of the statement is on the line as itself, or as another form of the same action / the same thing
const stemOnLine = (line, st) => hasStem(line, st) || famHit(ACTIONS, st, line.actions) || famHit(THINGS, st, line.things);
function onLine(concept, line, duty) {
  // a list (skills, education, a certification) proves only a named skill or tool — never a doing
  if (line.listOnly && (concept.kind !== 'object' || (duty && !skillish(concept)))) return 0;
  if (concept.credential && !line.cert && line.kind !== 'role' && !/\blicen[sc]e|\bcertif/i.test(line.match)) return 0;
  if (concept.kind === 'verb') return line.jstems.has(concept.head) || (concept.families && [...concept.families].some((f) => line.actions.has(f))) ? 2 : 0;
  if (concept.kind === 'who') return [...concept.groups].some((g) => [...(PEOPLE_PROVES.get(g) || [g])].some((x) => line.people.has(x))) || (concept.alts || [concept.stems]).some((a) => a.every((s) => line.jstems.has(s))) ? 2 : 0;
  if (concept.stems.every((s) => hasStem(line, s))) return juniorOf(concept, line) ? 0 : 2;
  if (concept.classIds && concept.classIds.some((id) => line.classes.has(id))) return 2;
  if (concept.aliasProofs && concept.aliasProofs.some((p) => proofOnLine(line, p))) return 2;
  if (concept.examples && concept.examples.some((e) => e.length && e.every((s) => stemOnLine(line, s)))) return 2;
  // the same thing in other words: the whole phrase ("training materials" ← "help center articles") or word by word
  // ("new-hire training" ← "onboard new agents")
  if (concept.things && [...concept.things].some((id) => line.things.has(id))) return 2;
  // a job title is its field's work ("Barista — Starbucks" is food-service / customer-service experience)
  if (line.kind === 'role' && line.title && TITLE_PROVES.some((t) => t.req.test(String(concept.surface || '').trim()) && t.title.test(line.title))) return 2;
  // (a one-word object is never proved by another FORM OF AN ACTION alone: "a preceptor" is not "Educate patients")
  if (concept.stems.every((s) => stemOnLine(line, s)) && concept.stems.some((s) => !hasStem(line, s)) && !(concept.stems.length === 1 && !famHit(THINGS, concept.stems[0], line.things))) return 2;
  // half: the head noun alone ("maintenance" for "preventative maintenance"), never a short or place-like head ("line")
  // a record-like head ("inventory records", "repair reports"): the subject word carries the meaning
  if (concept.stems.length > 1 && RECORD_HEADS.has(concept.head) && concept.stems.slice(0, -1).some((x) => x.length >= 6 && !GENERIC_STEMS.has(x) && line.jstems.has(x))) return 1;
  // (the head noun alone is no longer half: "workload balancing" is not "focus on balance", "GSE development" is not
  // "professional development days" — one shared word never makes a statement partly, V)
  return 0;
}
// a teaching line ("Trained customers on setup…") is low proof of most things — but it is the doing line for teaching
const TEACHING_FAMS = new Set(['teach', 'coach', 'facilitate']);
function lineRank(c, line) {
  const teachingConcept = (c.families && [...c.families].some((f) => TEACHING_FAMS.has(f))) || (c.stems || []).some((s) => [...(famOfStem(ACTIONS, s) || [])].some((f) => TEACHING_FAMS.has(f)));
  return line.rank + (line.teaches && teachingConcept ? 2 : 0);
}
/** The same-thing families that name the WHOLE concept (its head included): "trainee progress" is not "trainees". */
function thingsOf(c) {
  const out = new Set();
  const text = String(c.segment || c.shownAs || c.surface || '');
  const toks = tokenize(text);
  if (!toks.length) return out;
  const head = [...toks].reverse().find((t) => t.stem === c.head || fold(t.stem) === c.head) || toks[toks.length - 1];
  for (const p of THINGS.phrases) {
    if (p.re) { const m = text.match(p.re); if (m && m.index + m[0].length >= head.start) out.add(p.id); continue; }
    const hits = findStemmed(toks, p.stems);
    if (hits.some((h) => h.end >= head.end)) out.add(p.id);
  }
  for (const id of famOfStem(THINGS, head.stem) || []) out.add(id);
  for (const id of famOfStem(THINGS, fold(head.stem)) || []) out.add(id);
  return out;
}
/** Is the statement a duty (it opens on what to do), not a skill or tool to have? */
function dutyShaped(text) {
  const w = tokenize(String(text || '').replace(/^[\s•\-*·–]+/, ''))[0];
  if (!w) return false;
  const r = w.raw;
  return VERBS.has(r) || VERBS.has(r.replace(/(?:s|es|ed|ing)$/, '')) || VERBS.has(r.replace(/(?:s|d|ing)$/, '')) || !!verbFamilies(r) || /^keep|^stay$/.test(r);
}

/**
 * Judge a statement's concepts on the résumé lines. `locked` = stems the reader's facts already decided (they are not
 * judged twice). Returns { concepts: [{ ...concept, got, line }], status, evidence, missing } or null when the
 * statement names nothing specific.
 */
export function judgeConcepts(text, resumeText, { locked = new Set() } = {}) {
  const { concepts, trait, anyOf } = statementConcepts(text);
  let free = concepts.filter((c) => !c.stems.every((s) => locked.has(s)));
  if (!free.length) return { concepts: [], trait, anyOf };
  const lines = judgeLines(resumeText);
  const duty = dutyShaped(text);
  // a licence or certification is shown only by a licence line or a job title ("the supervising PT" is someone else)
  const credential = /\blicen[sc]e|\bcertif|\bregistered\b|\bboard[- ]certified/i.test(text);
  for (const c of free) {
    if (credential && c.kind === 'object') c.credential = true;
    c.classIds = [...new Set([...(c.classIds || []), ...classesNaming(c.phrase || c.surface)])];
    // a field-standard alias names the same thing (EMR ← Epic, POS ← cash register)
    const entries = c.kind === 'object' ? aliasEntriesFor([c.surface, c.phrase].filter(Boolean)) : [];
    c.aliasProofs = [...entries.flatMap((e) => e.proofs || []), ...(c.acronyms || [])];
    c.aliasRes = c.aliasProofs.length ? c.aliasProofs : null;
    if (c.kind === 'object') c.things = thingsOf(c);
  }
  // every concept on every line, then each concept's proof line: the line that shows it best, then the one that shows
  // MORE of the statement (the action and its object together), then the doing line, then a number, then the most recent
  const grid = lines.map((l) => free.map((c) => onLine(c, l, duty)));
  const cover = grid.map((row) => row.reduce((n, g, k) => n + (g ? (free[k].kind === 'verb' ? 1 : 2) : 0), 0));
  // a verb of a general family ("check", "present", "lead") is the statement's action only on a line that also shows
  // one of its objects: "Checked deliveries against invoices" does not check food quality
  // (a verb's objects: the objects read after it, up to the next verb)
  // (a place a clean / organise / stock action happens in is not its object: any line that does the action shows it)
  const isPlace = (c, v) => c.kind === 'object' && v && v.families && [...v.families].some((f) => PLACE_ACTIONS.has(f)) && c.stems.every((x) => PLACE_STEMS.has(x));
  // (verbs in a row — "Mentor, coach, and support therapists" — share the objects after the last of them)
  const objsOf = (k) => { const out = []; let n = k + 1; while (n < free.length && free[n].kind === 'verb') n++; for (; n < free.length && free[n].kind !== 'verb'; n++) if (!free[n].qualifier && !isPlace(free[n], free[k])) out.push(n); return out; };
  const hasObj = (k, li) => objsOf(k).some((n) => grid[li][n] > 0) || (locked.size && [...locked].some((s) => lines[li].jstems.has(s)));
  free.forEach((c, k) => {
    let best = null;
    c.anyLine = lines.some((l, li) => grid[li][k] > 0);
    // (every verb with an object in its scope: "Volunteer coach, youth soccer" does not coach therapists)
    // (a general verb — "check", "present" — acts only with its object on the same line; a specific one — "scan", "coach" — is
    // its own skill, and is dropped below when nothing it acts on is shown anywhere: "Volunteer coach" never coaches therapists)
    const needsObject = c.kind === 'verb' && c.familyOnly && (objsOf(k).length > 0 || locked.size > 0);
    lines.forEach((l, li) => {
      const got = grid[li][k];
      if (!got) return;
      if (needsObject && !hasObj(k, li)) return;
      const key = [got, cover[li], lineRank(c, l), l.number ? 1 : 0, -l.idx];
      if (!best || key.some((x, n) => key.slice(0, n).every((y, m) => y === best.key[m]) && x > best.key[n])) best = { got, line: l, key };
    });
    c.got = best ? best.got : 0;
    c.line = best ? best.line : null;
  });
  // a neighbouring kind of doing on the SAME line as the object counts as the action ("Document daily notes and progress"
  // tracks progress; "Train agents" coaches them; "Plan … storage areas" creates the storage plan)
  free.forEach((c, k) => {
    if (c.kind !== 'verb' || c.got || !c.families) return;
    const near = new Set([...c.families].flatMap((f) => [...(NEAR.get(f) || [])]));
    if (!near.size) return;
    let best = null;
    lines.forEach((l, li) => {
      // (a neighbouring action needs a THING on the line, not only who it was for)
      if (l.listOnly || ![...near].some((f) => l.actions.has(f)) || !objsOf(k).some((n) => free[n].kind === 'object' && grid[li][n] > 0)) return;
      const key = [cover[li], lineRank(c, l), l.number ? 1 : 0, -l.idx];
      if (!best || key.some((x, n) => key.slice(0, n).every((y, m) => y === best.key[m]) && x > best.key[n])) best = { line: l, key };
    });
    if (best) { c.got = 2; c.line = best.line; c.anyLine = true; }
  });
  // the action on a line with the object's HEAD ("Troubleshoot test cell problems" for "troubleshoot … hardware failures"):
  // the object's modifiers say which kind, the line does the thing — shown
  free.forEach((c, k) => {
    if (c.kind !== 'verb' || c.got !== 2 || !c.line) return;
    for (const n of objsOf(k)) {
      const o = free[n];
      if (o.got || o.kind !== 'object' || o.stems.length < 2) continue;
      const L = c.line;
      const head = o.stems[o.stems.length - 1];
      if (stemOnLine(L, head) && !GENERIC_STEMS.has(head) && head.length >= 4) { o.got = 2; o.line = L; }
    }
  });
  // a one-word object shown with the words the posting wrote around it ("delivery performance" on "Report weekly on delivery
  // performance") is the whole phrase, not one word
  for (const c of free) if (c.kind === 'object' && c.got === 2 && c.stems.length === 1 && c.fullStems && c.fullStems.length > 1 && c.line && c.fullStems.every((x) => hasStem(c.line, x))) c.stems = c.fullStems;
  // a statement that names only a general action ("Build strong partnerships…", "Coordinate care with …") has nothing a line
  // could show: a line that "built weekly schedules" does not build partnerships
  if (free.every((c) => c.kind === 'verb' && c.familyOnly)) for (const c of free) { c.got = 0; c.line = null; }
  // a place cleaned / organised / stocked is shown wherever the line does that action ("Kept work area clean")
  const placeVerb = free.find((c) => c.kind === 'verb' && c.got === 2 && c.families && [...c.families].some((f) => PLACE_ACTIONS.has(f)));
  for (const c of free) if (placeVerb && c.kind === 'object' && !c.got && c.stems.every((s) => PLACE_STEMS.has(s))) { c.got = 2; c.line = placeVerb.line; }
  // who the action is for proves nothing without the action
  if (!free.some((c) => c.kind === 'verb' && c.got > 0)) for (const c of free) if (c.kind === 'who') { c.got = 0; c.line = null; }
  // the ACTION ALONE is nothing: when the statement names an object and no line shows it, a line that only does the
  // verb is not cited (unless the reader's facts carry the object)
  // (per verb: its own objects; a verb the résumé does with something else is not "missing", its object is)
  const drop = new Set();
  free.forEach((c, k) => {
    if (c.kind !== 'verb') return;
    const o = objsOf(k);
    // (nothing it acts on is shown: the missing part is the object, in the posting's words — never "Partner" or "Develop")
    if (o.length && o.every((n) => !free[n].got) && (!locked.size || (c.familyOnly && !c.got))) drop.add(c);
  });
  free = free.filter((c) => !drop.has(c));
  for (const c of free) {
    if (c.got !== 1 || !c.line) continue;
    // the posting's words this line holds (for a half match: "shows inventory", never the whole phrase); `missing` keeps
    // only the words the line does not hold
    const ws = words(c.surface).filter((w) => !w.stop);
    c.shownWords = ws.filter((w) => c.line.jstems.has(w.stem)).map((w) => w.raw).join(' ');
    const rest = ws.filter((w) => !c.line.jstems.has(w.stem)).map((w) => w.raw);
    if (rest.length) { c.shownAs = c.shownAs || c.surface; c.surface = rest.join(' '); }
  }
  return { concepts: free, trait, anyOf };
}
/** The class of a statement a résumé cannot speak to, with what to ask: { kind, text } or null. */
export function askOf(st, resumeText, constraintKinds = []) {
  const text = String(st.text || '');
  const src = String(st.source || text);
  const ask = (kind) => ({ kind, text: text.charAt(0).toLowerCase() + text.slice(1) });
  if (constraintKinds.includes('background') || constraintKinds.includes('age') || ELIGIBILITY_TEXT_RE.test(src)) {
    for (const s of SHOWABLE_ELIGIBILITY) if (s.re.test(src)) { const l = judgeLines(resumeText).find((x) => s.proof.test(x.match)); if (l) return { kind: 'eligibility', text: ask('eligibility').text, line: l }; }
    return ask('eligibility');
  }
  if (/\btravel(?:ing|ling)?\b/i.test(src) && !/\b(?:experience|industry|agency|agent|nurse|booking|arrangements?|coordinat\w*)\b/i.test(src)) return ask('schedule');
  const loc = locationAsk(text, src, resumeText);
  if (loc) return loc;
  if (st.kind === 'physical' || constraintKinds.includes('physical') || (PHYSICAL_TEXT_RE.test(src) && !/\b(?:experience|years?)\b/i.test(src))) return ask('physical');
  if (st.kind === 'schedule' || constraintKinds.includes('schedule') || (SCHEDULE_TEXT_RE.test(src) && words(text.replace(SCHEDULE_TEXT_RE, ' ')).filter((w) => !w.stop && !w.generic && !w.soft && !/^(?:work|willing|available|week|including|also|time|follows|consistent|regular|position|role)$/.test(w.raw)).length <= 3 && !/\b(?:experience|skills?|knowledge)\b/i.test(src))) return ask('schedule');
  const lang = text.match(LANGUAGE_RE);
  if (lang && words(text.replace(LANGUAGE_RE, ' ')).filter((w) => !w.stop && !w.generic && !w.soft && !/^(?:read|writ|speak|communic|fluen|bilingual|languag|proficien|verbal|oral)/.test(w.stem)).length === 0) {
    const l = judgeLines(resumeText).find((x) => new RegExp(`\\b${escapeRegExp(lang[1])}\\b`, 'i').test(x.text));
    return { kind: 'language', text: ask('language').text, language: lang[1], line: l || null };
  }
  return null;
}


// ── settling a statement's items (the gist rule) ───────────────────────────────────────────────────────────────
// A recruiter reads a long requirement for its GIST: "Present findings to technical and nontechnical audiences, explain
// trade-offs, and recommend clear next steps" is shown by "Presented churn findings to the VP … and recommended two
// retention campaigns". The first unit of the statement (its first action and the list of things it acts on) is the
// core — every core item must be shown; what follows ("explain trade-offs", "from setup through completion") is
// secondary — when at least half of it is shown too, the rest is not held against the line. A core item that is not
// shown keeps the statement partly ("Maintain accurate records of shipments, permits, and delivery receipts" with no
// permits). Items are statements.js verdict items ({ got, display, missingText, qualifier, inferred, fact, … }).
const CORE_END_RE = /(?:[,;]\s+(?:and\s+|or\s+)?|\s+(?:and|or)\s+|\s+(?:to|in\s+order\s+to)\s+)(?=([A-Za-z]+))/g;
/** Where the statement's core (first action + its objects) ends, as a character index. */
export function coreEnd(text) {
  const t = String(text || '');
  CORE_END_RE.lastIndex = 0;
  let m;
  let seenContent = false;
  while ((m = CORE_END_RE.exec(t)) !== null) {
    const next = (m[1] || '').toLowerCase();
    if (m.index > 12) seenContent = true;
    if (seenContent && (VERBS.has(next) || VERBS.has(next.replace(/(?:s|es|ed|ing)$/, '')) || VERBS.has(next.replace(/(?:s|d|ing)$/, '')) || verbFamilies(next) || /^(?:explain|recommend|share|refine|isolate|establish|define|align|integrate|investigate|explore|combine|partner|collaborate|work|ensure|drive|own)/.test(next))) return m.index;
  }
  return t.length;
}
export function settleItems(text, items, { gate = false } = {}) {
  if (gate || !Array.isArray(items) || items.length < 2) return items;
  const t = String(text || '').toLowerCase();
  const end = coreEnd(text);
  const pos = (i) => { const w = String(i.missingText || i.display || '').toLowerCase().replace(/^one of /, '').split(/[,\s]+/).filter((x) => x.length > 2); if (!w.length) return -1; const at = t.indexOf(w[0]); return at; };
  const real = items.filter((i) => !(i.qualifier && !i.got));
  const core = real.filter((i) => { const p = pos(i); return p >= 0 && p < end; });
  const rest = real.filter((i) => !core.includes(i));
  if (!core.length || !rest.length) return items;
  const ok = (i) => i.got === 2 && !i.inferred;
  if (!core.every(ok)) return items;
  const shownRest = rest.filter(ok).length;
  // (a core shown in two or more parts carries the line on its own: the rest is what the role adds)
  if (shownRest * 2 < rest.length && core.filter(ok).length < 2) return items;
  return items.filter((i) => !rest.includes(i) || ok(i));
}

// ── where the work is (V) ──────────────────────────────────────────────────────────────────────────────────────
// "Hybrid, with primary location in Salt Lake City" / "You are currently in Vancouver and can work from our office": the
// résumé's own city (its header) is part of it → partly (the in-person commitment is still theirs to say); another city →
// not shown; a commitment with no place named → only the person can say.
const ONSITE_RE = /\b(?:in[- ]person|on[- ]?site|in[- ]office|in\s+the\s+office|from\s+our\s+office|our\s+office|hybrid|headquarters|relocat\w*|commut\w*|located\s+in|based\s+in|currently\s+in|work\s+from\s+(?:our|the)|days?\s*\/\s*week\s+in)\b/i;
function headerLines(resumeText) { return String(resumeText || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5); }
function locationAsk(text, src, resumeText) {
  if (!ONSITE_RE.test(src) || /\b(?:experience|years?)\b/i.test(src)) return null;
  const ask = { kind: 'schedule', text: text.charAt(0).toLowerCase() + text.slice(1) };
  // the places it names: capitalised words after in / at / near / from, not the employer's office words
  const places = [];
  const re = /\b(?:in|at|near|from|to)\s+((?:Downtown\s+|West\s+|East\s+|North\s+|South\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;
  let m;
  while ((m = re.exec(text)) !== null) { const p = m[1].replace(/^(?:Downtown|West|East|North|South)\s+/, ''); if (!/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Canada|United|The|Our|We|You|Remote|Hybrid)$/.test(p.split(' ')[0])) places.push(p); }
  if (!places.length) return ask;
  const hdr = headerLines(resumeText);
  for (const p of places) {
    const l = hdr.find((x) => new RegExp(`\\b${escapeRegExp(p)}\\b`, 'i').test(x));
    if (l) return { ...ask, status: 'partly', line: l, why: `you list ${p}`, missing: 'the in-person days' };
  }
  const city = hdr.map((x) => x.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*[A-Z]{2}\b/)).find(Boolean);
  return city ? { ...ask, status: 'not_shown', missing: places[0] } : ask;
}
// ── trait-led statements (V) ──────────────────────────────────────────────────────────────────────────────────
const TRAIT_EXTRA = new Set(['disciplined', 'discipline', 'tenacious', 'tenacity', 'assertive', 'hunter', 'bias', 'scrappy', 'hustle', 'sustainable', 'urgency', 'multitasking', 'multi-tasking', 'relationship', 'relationships', 'builder', 'influence', 'influential', 'trust', 'professional', 'appearance', 'presence', 'judgment', 'judgement', 'initiative', 'savvy', 'acumen', 'polished', 'articulate', 'charismatic', 'competitive', 'coachable', 'thoughtful', 'pragmatic', 'humble', 'gritty', 'organized', 'organised', 'detail-oriented', 'self-starter', 'communicator', 'collaborator', 'team-player', 'cross-functionally', 'cross-functional', 'adapt', 'adaptable', 'comfortable', 'thrive', 'thrives', 'passionate', 'curious', 'driven', 'proactive']);
const TRAIT_LEAD_SKIP = new Set(['strong', 'excellent', 'exceptional', 'outstanding', 'superior', 'great', 'good', 'solid', 'high', 'degree', 'of', 'a', 'an', 'the', 'you', 'are', 'demonstrate', 'demonstrated', 'have', 'show', 'proven', 'must', 'be', 'is', 'very', 'highly', 'extremely', 'and', 'with', 'act', 'maintain', 'possess', 'sound']);
/** Does the statement lead with a trait (what a résumé line can demonstrate but never state as fact)? */
export function traitLed(text) {
  const t = String(text || '').replace(/^[\s•\-*·–]+/, '');
  if (/^(?:ability|able|experience|knowledge|proficien|familiar|degree|bachelor|license|certif)/i.test(t)) return false;
  const ws = words(t.replace(SOFT_PHRASE_RE, ' soft ')).filter((w) => !TRAIT_LEAD_SKIP.has(w.raw));
  SOFT_PHRASE_RE.lastIndex = 0;
  if (!ws.length) return false;
  const lead = ws.slice(0, 2);
  // "Collaborate with engineering teams to integrate models", "Organize and store inventory": a line with a real object
  // to show is judged on it, whatever soft word opens it
  if (!TRAIT_EXTRA.has(lead[0].raw) && !/-(?:oriented|minded)$/.test(lead[0].raw) && statementConcepts(t).all.some((c) => c.kind === 'object' && !c.partner)) return false;
  const isTrait = (w) => w.soft || w.raw === 'soft' || TRAIT_EXTRA.has(w.raw) || /-(?:oriented|minded|driven|focused)$/.test(w.raw) || (w.raw === 'time' );
  return isTrait(lead[0]) || (lead[0].generic && lead[1] && isTrait(lead[1]));
}

// ── which line is cited first (V) ───────────────────────────────────────────────────────────────────────────
// Among a statement's proof lines the first one cited is the line a recruiter would point to: the one that shows the
// most of the statement, then a doing line (a bullet under a role) over a title, a skills list or a summary, then one
// with a number, then the most recent. A name / contact line is never cited.
const KIND_RANK = { bullet: 6, role: 4, summary: 2, skills: 1, education: 1, other: 2 };
export function rankEvidence(evidence, items, resumeText) {
  if (!Array.isArray(evidence) || evidence.length < 2) return evidence;
  const lines = proofLines(resumeText);
  const first = String(resumeText || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  const info = (t) => lines.find((l) => l.text === t || (t && l.text.includes(t)) || (t && t.includes(l.text) && l.text.length > 20));
  const cites = (t) => items.filter((i) => (i.line === t) || (i.evidence && i.evidence.some((e) => e.line === t))).filter((i) => i.got > 0).length;
  const scored = evidence.map((e, n) => {
    if (!e.line) return { e, key: [-1, 0, 0, -n] };
    const l = info(e.line);
    const bad = CONTACT_RE.test(e.line) || e.line === first;
    return { e, key: [bad ? -1 : cites(e.line), l ? KIND_RANK[l.kind] ?? 2 : 2, /\d/.test(e.line.replace(/\b(?:19|20)\d\d\b/g, '')) ? 1 : 0, -n] };
  });
  scored.sort((a, b) => { for (let k = 0; k < 4; k++) if (a.key[k] !== b.key[k]) return b.key[k] - a.key[k]; return 0; });
  return scored.map((x) => x.e);
}

/**
 * Does a résumé line share something SPECIFIC with a statement — a non-generic word, or another form of the same action /
 * the same thing? (The invariant behind every "shown": one generic shared word never proves a statement.)
 */
export function sharesSpecific(statementText, lineText) {
  const st = words(String(statementText || '')).filter((w) => !w.stop && (!w.generic || famOfStem(ACTIONS, w.stem)) && !w.soft);
  if (!st.length) return true;
  // an instance of a class the statement names ("warehouse equipment" ← "forklift")
  if (INSTANCE_CLASSES.some((c) => c.names.test(String(statementText)) && c.instances.some((re) => re.test(String(lineText))))) return true;
  const lw = words(String(lineText || ''));
  const have = new Set(lw.map((w) => w.stem));
  const toks = tokenize(String(lineText || ''));
  const acts = familiesIn(ACTIONS, toks, lineText), things = familiesIn(THINGS, toks, lineText);
  return st.some((w) => have.has(w.stem) || famHit(ACTIONS, w.stem, acts) || famHit(THINGS, w.stem, things));
}

// ── the same-field prior (V) ────────────────────────────────────────────────────────────────────────────────
// A person who holds the posting's own occupation does its core duties: a duty they do needs less lexical evidence than the
// same duty for an outsider — never none (a line must still exist). `lineCoverage` is how much of a statement's specific
// words (or other forms of the same action / thing) ONE doing line holds; the verdict uses it only for same-field pairs.
export function lineCoverage(statementText, resumeText) {
  const st = words(String(statementText || '').replace(/\([^()]*\)/g, ' ').replace(MANNER_RE, ' ')).filter((w) => !w.stop && !w.soft && (!w.generic || famOfStem(ACTIONS, w.stem)));
  const uniq = [...new Map(st.map((w) => [w.stem, w])).values()];
  if (!uniq.length) return { shared: 0, total: 0, line: null };
  let best = { shared: 0, total: uniq.length, line: null };
  for (const l of judgeLines(resumeText)) {
    // (a doing line: a job title's words are the person's role, not the duty)
    if (l.kind !== 'bullet') continue;
    const n = uniq.filter((w) => stemOnLine(l, w.stem)).length;
    if (n > best.shared || (n === best.shared && best.line && l.rank > best.line.rank)) best = { shared: n, total: uniq.length, line: l };
  }
  return { ...best, line: best.line ? best.line.text : null };
}
