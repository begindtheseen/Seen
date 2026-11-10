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
import { INSTANCE_CLASSES, ACTION_FAMILIES, LIGHT_VERBS, SAME_THING, PEOPLE_GROUPS } from './fieldAliases.js';
import { escapeRegExp } from '../text/escapeRegExp.js';

// ── statement classes a résumé cannot speak to ──────────────────────────────────────────────────────────────────
const PHYSICAL_TEXT_RE = /\b(?:lift(?:ing|s)?\s+(?:up\s+to\s+)?\d{1,3}\s*\+\s*(?:lbs?\.?|pounds?)|walk(?:ing|s)?,|(?:some\s+)?sitting,|climbing,|lifting\s+for|lift(?:ing|s)?\b[^.;]{0,40}?\d{1,3}\s*(?:lbs?\.?|pounds?|kg|kilograms?)|(?:carry|carrying|push(?:ing)?|pull(?:ing)?|moving)\b[^.;]{0,40}?\d{1,3}\s*(?:lbs?\.?|pounds?|kg)|stand(?:ing|s)?\b[^.;]{0,30}?(?:periods?|hours?|shifts?|long|extended|prolonged|entire|full)|walk(?:s|ing)?,?\s+stand|on\s+(?:your|their|my)\s+feet|climb(?:ing|s)?\s+(?:up\s+and\s+down\s+)?(?:ladders?|stairs?)|(?:up\s+and\s+down|go\s+up)\s+(?:the\s+)?stairs|\bstairs\b|ladder\s+usage|step\s+stool|bend(?:s|ing)?\b|stoop(?:s|ing)?\b|kneel(?:s|ing)?\b|crouch(?:es|ing)?\b|squat(?:s|ting)?\b|reach(?:ing)?\s+overhead|repetitive\s+(?:motions?|lifting|movements?)|repetitious|manual\s+dexterity|work\s+at\s+(?:a\s+)?heights?|height\s+of\s+up\s+to|exposure\s+to\s+(?:heat|cold|noise|dust|fumes|weather|chemicals)|extreme\s+(?:heat|cold|temperatures?)|outdoor\s+(?:work|conditions)|all\s+weather|noise\s+levels?|vision\s+(?:requirements?|abilities)|hearing)\b/i;
const SCHEDULE_TEXT_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}\s*(?:am|pm)|shifts?|overtime|weekends?|holidays?|nights?|evenings?|overnights?|on[- ]call|rotating|part[- ]time|full[- ]time|hours?\s+(?:per|a|each)\s+week|\d+\s*hours?\b|schedule|availability|available\s+to\s+work|travel(?:ing|ling)?\b|relocat\w*|commute|on[- ]?site|in[- ]office|hybrid|remote)\b/i;
const ELIGIBILITY_TEXT_RE = /\b(?:authori[sz](?:ed|ation)\s+to\s+work|legally\s+(?:able|eligible|authori[sz]ed)|work\s+authori[sz]ation|(?:u\.?s\.?\s+)?citizen(?:ship)?|green\s+card|permanent\s+resident|eligible\s+to\s+work|employment\s+eligibility|(?:18|21)\s+years\s+(?:of\s+age|old)|(?:18|21)\s+or\s+older|at\s+least\s+(?:18|21)\b|background\s+(?:check|screen\w*|investigation)|drug\s+(?:test|screen)\w*|reliable\s+transportation|own\s+(?:vehicle|transportation|car)|insur(?:ed|ance)\s+vehicle|valid\s+driver['’]?s?\s+licen[sc]e|driver['’]?s?\s+licen[sc]e|clean\s+driving\s+record|motor\s+vehicle\s+record|fingerprint\w*|live\s*scan|security\s+clearance|clearance|pre-employment|pass\s+(?:a|the)\s+(?:physical|screen)|sponsorship|visa)\b/i;
const LANGUAGE_RE = /\b(English|Spanish|French|Mandarin|Cantonese|Chinese|Vietnamese|Tagalog|Korean|Arabic|Portuguese|German|Russian|Hindi|Japanese|Italian|Polish|Somali|Amharic|Haitian\s+Creole|ASL|American\s+Sign\s+Language)\b/;
// a résumé line can show these (a licence on the résumé, a clearance held)
const SHOWABLE_ELIGIBILITY = [
  { re: /\bdriver['’]?s?\s+licen[sc]e|\bclean\s+driving\s+record/i, proof: /\bdriver['’]?s?\s+licen[sc]e|\bCDL\b|\bClass\s+[ABC]\b/i },
  { re: /\bsecurity\s+clearance|\bclearance\b/i, proof: /\b(?:secret|top\s+secret|TS\/SCI|clearance)\b/i },
];

// ── words ─────────────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set('you yourself along away a an the and or of to in on at by for with from as into onto per via than that which who whom whose this these those their our your its it is are be been being was were will would can could should may might must shall do does did has have had not no nor any all each every both either some such other others own same so too very also just only well up down out over under about across within without through throughout during before after above below between among while when where how what whether if then there here etc e.g i.e eg ie including include includes like plus more most less least much many few several various new high low wide broad full entire whole overall necessary needed needs need required requirement requirements requires require preferred desired ideal ideally plus bonus'.split(/\s+/));
// words that name no specific thing a résumé could show (director: "work, team, support, perform, ensure, provide,
// maintain, equipment alone — do not carry a match by themselves")
const GENERIC = new Set(['work', 'working', 'team', 'teams', 'support', 'supporting', 'perform', 'performing', 'ensure', 'ensuring', 'provide', 'providing', 'maintain', 'maintaining', 'equipment', 'use', 'using', 'utilize', 'utilizing', 'assist', 'assisting', 'help', 'helping', 'duty', 'duties', 'task', 'tasks', 'ability', 'able', 'strong', 'excellent', 'good', 'great', 'solid', 'effective', 'effectively', 'efficient', 'efficiently', 'accurate', 'accurately', 'proper', 'properly', 'appropriate', 'experience', 'experienced', 'knowledge', 'skill', 'skills', 'year', 'years', 'minimum', 'environment', 'environments', 'setting', 'settings', 'similar', 'related', 'relevant', 'item', 'items', 'product', 'products', 'box', 'boxes', 'goods', 'process', 'processes', 'system', 'systems', 'information', 'issue', 'issues', 'problem', 'problems', 'job', 'jobs', 'role', 'position', 'company', 'manner', 'way', 'ways', 'time', 'day', 'days', 'daily', 'regular', 'regularly', 'basic', 'general', 'member', 'members', 'staff', 'personnel', 'people', 'employee', 'employees', 'area', 'areas', 'level', 'levels', 'standard', 'standards', 'operation', 'operations', 'procedure', 'procedures', 'specification', 'specifications', 'activity', 'activities', 'execute', 'executing', 'performance', 'point', 'contact', 'education', 'practical', 'show', 'owner', 'owners', 'technology', 'technologies', 'knowledgeable', 'familiar', 'structured', 'patient', 'patients', 'family', 'families', 'visitor', 'visitors', 'client', 'clients', 'customer', 'customers', 'guest', 'guests', 'resident', 'residents', 'student', 'students', 'colleague', 'colleagues', 'coworker', 'coworkers', 'adult', 'adults', 'learner', 'learners', 'individual', 'individuals', 'others', 'public', 'alongside', 'organization', 'organisation', 'ongoing', 'efficiency', 'efficiencies', 'opportunity', 'opportunities', 'initiative', 'initiatives', 'hours', 'hour', 'minutes', 'ride', 'always', 'never', 'times', 'volume', 'high-volume', 'document', 'documents', 'assigned', 'related', 'number', 'amount', 'quantity', 'computer', 'computers', 'however', 'even', 'candidate', 'candidates', 'prior', 'previous', 'proficient', 'skilled', 'think', 'wonder', 'see', 'look', 'looks', 'lot', 'able', 'enable', 'allow', 'allows', 'directly', 'closely', 'involved', 'involving', 'ensure', 'meet', 'needs', 'business', 'case-by-case', 'open', 'considering', 'exceptional', 'qualification', 'qualifications', 'listed', 'list', 'mainstream', 'large-scale', 'scale', 'impactful', 'comprehensive', 'complex', 'technically', 'technical', 'personal', 'direct', 'indirect', 'world-class', 'cutting-edge', 'state-of-the-art', 'robust', 'scalable', 'reliable', 'stable', 'modern', 'best', 'practice', 'practices', 'environment', 'principles', 'concepts', 'fundamentals', 'platform', 'platforms', 'solution', 'solutions', 'component', 'components', 'function', 'functions', 'need', 'needs', 'level', 'demonstrate', 'demonstrated', 'proven', 'make', 'take', 'get', 'keep', 'conduct', 'participate', 'complete', 'completing', 'serve', 'act', 'carry', 'stay', 'current', 'necessary', 'variety', 'range', 'multiple', 'other', 'additional', 'key', 'core', 'main', 'primary', 'overall', 'detailed', 'quick', 'quickly', 'immediately', 'timely', 'appropriately', 'professional', 'hands-on', 'world', 'real-world', 'unique', 'custom', 'common', 'various', 'specific', 'certain', 'concern', 'concerns', 'thing', 'things', 'part', 'parts', 'piece', 'pieces', 'basis', 'etc', 'familiarity', 'understanding', 'proficiency', 'expertise', 'exposure', 'comfortable', 'comfort', 'willing', 'willingness', 'desire', 'interest', 'passion', 'track', 'background', 'success', 'successful', 'successfully', 'responsible', 'responsibility', 'responsibilities', 'expected', 'expectation', 'expectations', 'oversee', 'implement', 'implementing', 'identify', 'drive', 'driving', 'deliver', 'improve', 'improving', 'involve', 'involving', 'apply', 'applying', 'bring', 'like', 'want', 'love', 'enjoy', 'achieve']);
// soft traits a résumé cannot prove (the statement is a trait when nothing else is left)
const SOFT = new Set(['communication', 'communicate', 'communicating', 'communicator', 'interpersonal', 'organizational', 'organisational', 'organized', 'organised', 'independently', 'independent', 'teamwork', 'team-player', 'reliable', 'reliability', 'dependable', 'dependability', 'punctual', 'punctuality', 'attendance', 'attention', 'detail', 'details', 'detail-oriented', 'urgency', 'motivated', 'self-motivated', 'self-starter', 'motivation', 'steady', 'pace', 'fast-paced', 'fast', 'paced', 'flexible', 'flexibility', 'adaptable', 'adaptability', 'positive', 'attitude', 'professionalism', 'multitask', 'multitasking', 'multi-task', 'prioritize', 'prioritise', 'prioritization', 'initiative', 'judgment', 'judgement', 'critical', 'thinking', 'friendly', 'courteous', 'enthusiastic', 'enthusiasm', 'energetic', 'honest', 'honesty', 'integrity', 'collaborative', 'collaborate', 'collaboration', 'cooperative', 'cooperation', 'instructions', 'instruction', 'directions', 'direction', 'follow', 'following', 'safely', 'verbal', 'written', 'oral', 'listening', 'listener', 'patience', 'patient-centered', 'empathy', 'empathetic', 'compassion', 'compassionate', 'calm', 'pressure', 'accountable', 'accountability', 'trustworthy', 'eager', 'learn', 'learner', 'learning', 'curious', 'curiosity', 'ownership', 'self-directed', 'driven', 'hardworking', 'hard-working', 'work-ethic', 'ethic', 'people-person', 'personable', 'outgoing', 'interpersonal', 'tact', 'tactful', 'diplomacy', 'discretion', 'confidentiality', 'resourceful', 'resilient', 'resilience', 'proactive', 'proactively', 'focused', 'diligent', 'thorough', 'meticulous', 'conscientious', 'creative', 'creativity', 'analytical', 'time-management', 'stress', 'ambiguity', 'mindset', 'sense', 'oriented', 'writing', 'verbally', 'priorities', 'tidy', 'clear', 'concise', 'partner', 'partnering', 'challenge', 'challenges', 'thrive', 'thriving', 'succeed', 'adapt', 'adapting', 'foster', 'fosters', 'fostering', 'partnership', 'partnerships', 'appearance', 'attire', 'groomed', 'well-groomed', 'presentable', 'neat', 'autonomous', 'autonomy', 'autonomously', 'smile', 'smiling', 'connection', 'connections', 'motivational', 'cross-functional', 'cross-functionally', 'active', 'engaging', 'engage', 'engaged', 'engagement', 'smooth', 'smoothly', 'adhering', 'adhere', 'vision', 'values', 'mission', 'culture', 'dress', 'ethics', 'ethical', 'respect', 'respectful', 'warm', 'welcoming', 'polite', 'approachable', 'humble', 'hungry', 'grit', 'passionate', 'excitement', 'excited', 'fun', 'energy', 'upbeat', 'cheerful', 'helpful', 'kind', 'caring', 'mature', 'ambitious', 'competitive', 'persuasive', 'confident', 'confidence', 'assertive', 'decisive', 'common', 'coachable', 'open-minded', 'receptive', 'feedback', 'excellence', 'gravitas', 'presence', 'demeanor', 'demeanour', 'personality', 'mentality', 'pay', 'forward', 'incomplete', 'perseverance', 'persistence', 'dedication', 'dedicated', 'commitment', 'committed', 'loyal', 'loyalty', 'eagerness', 'readiness', 'deadline', 'deadlines', 'deadline-driven', 'organize', 'organizing', 'prioritizing', 'team-oriented', 'people-oriented', 'results-oriented', 'goal-oriented', 'service-oriented', 'customer-oriented', 'self-motivation', 'go-getter', 'can-do', 'playing', 'role', 'inclusive', 'belonging', 'diversity', 'humility', 'solid', 'fastidious', 'interact', 'interacting', 'interaction', 'interactions', 'empathetic', 'focused', 'customer-focused', 'self-starter', 'superior', 'juggle']);
// soft PHRASES taken out before the concepts are read ("follow all safety procedures", "work safely", "safety awareness")
const SOFT_PHRASE_RE = /\b(?:follow(?:s|ing)?|adhere(?:s|nce)?\s+to|comply(?:ing)?\s+with|compliance\s+with|abide\s+by)\s+(?:all\s+|company\s+|established\s+|standard\s+(?:operating\s+)?|safety\s+|written\s+|verbal\s+|work\s+)*(?:procedures?|polic(?:y|ies)|rules|instructions|directions|guidelines|protocols|SOPs?|standards)(?:\s*\([A-Z]{2,5}s?\))?|\bsafety\s+(?:awareness|conscious(?:ness)?|minded|first)|\bwork(?:ing)?\s+safely|\bin\s+a\s+safe\s+(?:and\s+\w+\s+)?manner|\btime[- ]management\s+skills?|\b(?:[a-z]+\s+)?problem[- ]solving(?:\s+skills?)?|\bcritical\s+thinking|\b(?:(?:excellent|strong|good|effective)\s+)?(?:written|writing|verbal|oral)(?:\s+(?:and|&|\/)\s+(?:verbal|oral|written|writing))?\s+(?:communication|presentation)?(?:\s+skills)?(?=\W|$)|\bwriting\s+(?:and\s+communication\s+)?skills|\bas\s+part\s+of\s+a\s+team|\bwith\s+(?:a|the)\s+team|\bteam\s+player/gi;
// verbs that start a duty clause (a verb concept, never part of the object phrase)
const VERBS = new Set(('scan label pack ship load unload pick receive put store stock organize organise sort count weigh wrap palletize stage ' +
  'deliver drive operate install repair maintain inspect test diagnose troubleshoot calibrate replace assemble fabricate weld solder wire ' +
  'read interpret write draft prepare process enter record report document track monitor review audit reconcile post file invoice bill ' +
  'answer greet assist serve cook prep bake clean sanitize wash cut slice package ring cash count balance open close ' +
  'teach train coach mentor lead supervise manage schedule plan coordinate communicate negotiate sell present design develop build code ' +
  'deploy configure administer analyze analyse model forecast budget measure research evaluate assess triage treat administer chart ' +
  'educate counsel care bathe feed transfer transport escort dispense compound fill restock replenish merchandise display ' +
  'conduct perform provide ensure support handle respond resolve escalate collect verify validate approve submit procure specify obtain ' +
  'order purchase source move lift push pull climb follow keep utilize use participate implement improve identify create develop guide run hold give host offer turn partner').split(/\s+/));
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
const PARTNER_WORDS = new Set(['physician', 'physicians', 'doctor', 'doctors', 'provider', 'providers', 'cardiologist', 'cardiologists', 'specialist', 'specialists', 'pharmacist', 'pharmacists', 'therapist', 'therapists', 'vendor', 'vendors', 'supplier', 'suppliers', 'insurer', 'insurers', 'payer', 'payers', 'agency', 'agencies', 'carrier', 'carriers', 'partner', 'partners', 'department', 'departments', 'operations', 'engineering', 'product', 'finance', 'sales', 'marketing', 'hr', 'it', 'legal', 'qa', 'leads', 'supervisors', 'vp', 'vps', 'ceo', 'cfo', 'c-suite', 'board']);
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
const WEAK_HEADS = new Set(['target', 'goal', 'calendar', 'material', 'training', 'environment', 'record', 'report', 'data', 'document', 'log', 'file', 'list', 'manager', 'specialist', 'associat', 'assistant', 'coordinator', 'representativ', 'technician', 'engineer', 'engineering', 'analyst', 'officer', 'agent', 'clerk', 'lead', 'director', 'worker', 'operator', 'operat', 'member', 'professional', 'case', 'experienc', 'line', 'lines', 'floor', 'room', 'site', 'side', 'unit', 'units', 'level', 'center', 'centr', 'shift', 'field', 'group', 'model', 'plan', 'program', 'project', 'team', 'servic', 'manag', 'report', 'skill', 'control', 'support']);
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
    const stem = fold(t.stem);
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
  const ex = t.match(EXAMPLE_CUE_RE);
  if (ex) {
    const body = (ex[1] || ex[2] || '').replace(/\band\s+similar\b|\band\s+others?\b|\betc\.?/gi, '');
    examples = body.split(/\s*,\s*|\s+(?:and|or)\s+|\s*\/\s*/).map((x) => x.trim()).filter((x) => x && x.split(/\s+/).length <= 4);
    t = t.slice(0, ex.index) + ' ' + t.slice(ex.index + ex[0].length);
  }
  // a short parenthetical that is an acronym or a gloss is the same thing said again
  t = t.replace(/\(([^()]{1,60})\)/g, ' ');
  // how and when ("in plain language", "from day one through nesting") are not asked
  t = t.replace(MANNER_RE, ' ');
  // "Keep the warehouse clean and organized" is the action "clean" on the place: read it as "clean the warehouse"
  t = t.replace(KEEP_STATE_RE, (m, place, state) => `${state.toLowerCase().replace(/ed$|d$/, '').replace(/^organiz$/, 'organize').replace(/^sanitiz$/, 'sanitize').replace(/^stock$/, 'stock')} ${place}`);
  // two verbs that open the line as one activity ("Create or improve", "Develop and update", "Train and coach"): one
  // action, either form proves it — "or" always, "and" only for neighbouring kinds of doing
  let coFams = null, coSurface = '';
  const co = t.match(/^\s*([A-Za-z]+)\s*(?:,\s*([A-Za-z]+)\s*,?)?\s+(and|or|&|\/)\s+([A-Za-z]+)\b/);
  if (co) {
    const vs = [co[1], co[2], co[4]].filter(Boolean);
    const fams = vs.map((v) => verbFamilies(v.toLowerCase()));
    if (fams.every((f) => f && f.size)) {
      const near = (a, b) => [...a].some((x) => b.has(x) || [...b].some((y) => (NEAR.get(x) || new Set()).has(y)));
      if (/or|\//.test(co[3]) || fams.every((f, k) => k === 0 || near(fams[0], f))) {
        coFams = new Set(fams.flatMap((f) => [...f]));
        coSurface = t.slice(co.index, co.index + co[0].length).trim();
        t = t.slice(0, co.index) + ' ' + co[4] + t.slice(co.index + co[0].length);
      }
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
  for (const [ci, clause] of clauses.entries()) {
    const at = concepts.length;
    const ws = words(clause);
    if (ws.some((w) => w.soft && !w.stop)) sawSoft = true;
    const cw = ws.filter((w) => !w.stop && !w.soft);
    // "…to operations and clinical leaders", "…with cardiologists, home health agencies and insurers"
    if (audience && cw.length && cw.length <= 4 && audienceWord(cw[cw.length - 1]) && !verbFamilies(cw[0].raw)) continue;
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
      if (si > 0 && emptyLead && segPrep === 'with') return;
      const content = seg.filter((w) => !w.stop && !w.soft);
      // "for new and existing agents": the people list starts in this clause and goes on in the next
      if (!content.length) { if (si > 0 && AUDIENCE_PREP.has(segPrep) && si === segs.length - 1) audience = true; return; }
      // who it is for / with ("to … leaders", "for classes of 10-15 … agents", "with cardiologists"): not asked
      const last = content[content.length - 1];
      if (si > 0 && (AUDIENCE_PREP.has(segPrep) || (segPrep === 'of' && prevAudience)) && (audienceWord(last) || (GROUP_WORDS.has(last.raw) && segPrep !== 'of'))) {
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
      const verbLike = VERBS.has(v) || VERBS.has(v.replace(/(?:s|es|ed|ing)$/, '')) || VERBS.has(v.replace(/(?:s|d|ing)$/, '')) || (content.length > 1 && /^[a-z]+(?:ize|ise|ate)$/.test(v)) || (fam && (content.length > 1 || concepts.length === 0) && !/(?:tion|ment|ance|ence|sis|ings)$/.test(v));
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
      const obj = content.slice(i).filter((w) => !w.generic);
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
      concepts.push({ kind: 'object', stems: tail.map((w) => w.stem), head: tail[tail.length - 1].stem, surface, phrase: tail.map((w) => w.raw).join(' '), segment: segText, classIds,
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
  const kept = merged.filter((c) => c.stems.length);
  // a soft line with one stray word left ("Willingness to learn, grow…", "ability to engage active and passive
  // candidates", "Exercise independent judgment") is a trait: the leftover word is not something it asks to be shown
  const softLine = SOFT_CUE_RE.test(text);
  const objectish = kept.filter((c) => c.kind !== 'verb' || !c.familyOnly);
  const trait = !objectish.length ? sawSoft && !kept.length : softLine && objectish.length === 1 && objectish[0].stems.length === 1 && !objectish[0].classIds?.length && !SKILL_WORD_RE.test(objectish[0].surface) && !kept.some((c) => c.kind === 'verb' && c.families && c.families.size);
  return { concepts: trait ? [] : kept, all: kept, trait, anyOf };
}
// verb families a word belongs to (by its stem), or null
function verbFamilies(raw) {
  const w = String(raw || '').toLowerCase();
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
  return things.has('one-on-one') || things.has('call-review') || familiesIn(ACTIONS, toks, objText).has('coach');
}
// ── lines ─────────────────────────────────────────────────────────────────────────────────────────────────────
const linesCache = new Map();
// a line in a licences / certifications block, or one that names a credential and nothing done
const CERT_LINE_RE = /\b(?:certif\w*|certificate|licen[sc]e[ds]?|licensure|registered\s+nurse|BLS|ACLS|PALS|CPR|ServSafe|OSHA[\s-]?\d+|food\s+handler|first\s+aid|CDL)\b/i;
function judgeLines(resumeText) {
  const key = String(resumeText || '');
  if (linesCache.has(key)) return linesCache.get(key);
  const out = proofLines(key)
    .filter((l) => !l.inProgress && !l.objective && l.kind !== 'header')
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
/** How a concept stands on one line: 2 = shown, 1 = only its head noun (half), 0 = not. */
const hasStem = (line, st) => line.jstems.has(st) || (st.includes('-') && st.split('-').filter(Boolean).every((p) => line.jstems.has(stemOf(p))));
const famHit = (idx, st, have) => { const f = famOfStem(idx, st); return !!f && [...f].some((id) => have.has(id)); };
// a word of the statement is on the line as itself, or as another form of the same action / the same thing
const stemOnLine = (line, st) => hasStem(line, st) || famHit(ACTIONS, st, line.actions) || famHit(THINGS, st, line.things);
function onLine(concept, line, duty) {
  // a list (skills, education, a certification) proves only a named skill or tool — never a doing
  if (line.listOnly && (concept.kind !== 'object' || (duty && !skillish(concept)))) return 0;
  if (concept.kind === 'verb') return line.jstems.has(concept.head) || (concept.families && [...concept.families].some((f) => line.actions.has(f))) ? 2 : 0;
  if (concept.kind === 'who') return [...concept.groups].some((g) => [...(PEOPLE_PROVES.get(g) || [g])].some((x) => line.people.has(x))) || (concept.alts || [concept.stems]).some((a) => a.every((s) => line.jstems.has(s))) ? 2 : 0;
  if (concept.stems.every((s) => hasStem(line, s))) return 2;
  if (concept.classIds && concept.classIds.some((id) => line.classes.has(id))) return 2;
  if (concept.aliasProofs && concept.aliasProofs.some((p) => proofOnLine(line, p))) return 2;
  if (concept.examples && concept.examples.some((e) => e.length && e.every((s) => stemOnLine(line, s)))) return 2;
  // the same thing in other words: the whole phrase ("training materials" ← "help center articles") or word by word
  // ("new-hire training" ← "onboard new agents")
  if (concept.things && [...concept.things].some((id) => line.things.has(id))) return 2;
  if (concept.stems.every((s) => stemOnLine(line, s)) && concept.stems.some((s) => !hasStem(line, s))) return 2;
  // half: the head noun alone ("maintenance" for "preventative maintenance"), never a short or place-like head ("line")
  // a record-like head ("inventory records", "repair reports"): the subject word carries the meaning
  if (concept.stems.length > 1 && RECORD_HEADS.has(concept.head) && concept.stems.slice(0, -1).some((x) => x.length >= 6 && !GENERIC_STEMS.has(x) && line.jstems.has(x))) return 1;
  if (concept.stems.length > 1 && line.jstems.has(concept.head) && !GENERIC_STEMS.has(concept.head) && concept.head.length >= 5 && !WEAK_HEADS.has(concept.head)) return 1;
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
  for (const c of free) {
    c.classIds = [...new Set([...(c.classIds || []), ...classesNaming(c.phrase || c.surface)])];
    // a field-standard alias names the same thing (EMR ← Epic, POS ← cash register)
    const entries = c.kind === 'object' ? aliasEntriesFor([c.surface, c.phrase].filter(Boolean)) : [];
    c.aliasProofs = entries.flatMap((e) => e.proofs || []);
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
  const objsOf = (k) => { const out = []; for (let n = k + 1; n < free.length && free[n].kind !== 'verb'; n++) if (!free[n].qualifier) out.push(n); return out; };
  const hasObj = (k, li) => objsOf(k).some((n) => grid[li][n] > 0) || (locked.size && [...locked].some((s) => lines[li].jstems.has(s)));
  free.forEach((c, k) => {
    let best = null;
    c.anyLine = lines.some((l, li) => grid[li][k] > 0);
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
    if (c.kind !== 'verb' || !c.anyLine) return;
    const o = objsOf(k);
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
  if (st.kind === 'physical' || constraintKinds.includes('physical') || (PHYSICAL_TEXT_RE.test(src) && !/\b(?:experience|years?)\b/i.test(src))) return ask('physical');
  if (st.kind === 'schedule' || constraintKinds.includes('schedule') || (SCHEDULE_TEXT_RE.test(src) && words(text.replace(SCHEDULE_TEXT_RE, ' ')).filter((w) => !w.stop && !w.generic && !w.soft && !/^(?:work|willing|available|week|including|also|time|follows|consistent|regular|position|role)$/.test(w.raw)).length <= 3 && !/\b(?:experience|skills?|knowledge)\b/i.test(src))) return ask('schedule');
  const lang = text.match(LANGUAGE_RE);
  if (lang && words(text.replace(LANGUAGE_RE, ' ')).filter((w) => !w.stop && !w.generic && !w.soft && !/^(?:read|writ|speak|communic|fluen|bilingual|languag|proficien|verbal|oral)/.test(w.stem)).length === 0) {
    const l = judgeLines(resumeText).find((x) => new RegExp(`\\b${escapeRegExp(lang[1])}\\b`, 'i').test(x.text));
    return { kind: 'language', text: ask('language').text, language: lang[1], line: l || null };
  }
  return null;
}

