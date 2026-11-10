// Posting sections + structured constraints. The 2026-10-24 ATS audit's root cause for the
// inverted scores: requirements were a vocabulary grep over the WHOLE posting — "training" came
// from the benefits paragraph ("ongoing training"), "teamwork" from the core-values footer,
// "excel" from "how we grow and excel", and "Store Manager" in a duty sentence made an entry-level
// CSR a lead-level job. Here a posting is sectioned FIRST (Requirements / Responsibilities /
// Preferred / Physical / Schedule / Benefits / Culture / EEO / About) and requirements are read
// only from the sections that state them; years, degree + GPA, licence/certification, schedule,
// physical, language and management scope come out as structured constraints with their own
// match rules (hard gates), not as keywords. Pure, deterministic, no I/O.
import { splitSentences } from '../text/sentences.js';
import { dehyphenate } from './lemma.js';
import { escapeRegExp } from '../text/escapeRegExp.js';

// a preferred-type heading recognised by its WORDS, any case, any tail of heading words ("Bonus Points if you have",
// "BONUS POINTS IF YOU HAVE", "Nice to have experience", "Preferred Attributes", "Desired skills and experience",
// "Education, Experience, Skills and Abilities Preferred") — Insights' r5 guard list, R3
const HEAD_VOCAB = "(?:qualifications?|skills?|experience|requirements?|attributes|competenc(?:y|ies)|education|certifications?|licen[sc]es?|knowledge|abilities|background|traits|profile|extras?|items?|points?|credit|technical|soft|key|relevant|additional|and|&|if|you|have|for|to|would|be|great|but|not|required|the|following|of|plus|bonus|nice|desired|preferred|ideally|also|even|better|it'?s|a)";
const PREFERRED_HEAD_RE = new RegExp(`^(?:(?:bonus|nice[- ]to[- ]haves?|nice|preferred|desired|ideally|extra\\s+credit|pluses)(?:[\\s,/]+${HEAD_VOCAB}){0,8}|(?:${HEAD_VOCAB}[\\s,/]+){1,7}(?:preferred|desired|a\\s+plus|nice\\s+to\\s+have|bonus))$`, 'i');
const HEADINGS = [
  ['preferred', PREFERRED_HEAD_RE],
  // "We Value" / "WE VALUE" (Quantinuum), "Bonus if (not mandatory)" (Spare)
  ['preferred', /^(?:we\s+(?:also\s+)?value|bonus\s+if(?:\s+you)?(?:\s+have)?(?:\s*\(not\s+mandatory\))?|(?:it'?s\s+)?(?:a\s+)?bonus\s+if\b.{0,30}|not\s+mandatory\b.{0,30})$/i],
  // R5: "Qualifications We Prefer", "What Will Set You Apart", "It's a plus if", "You'd be a great fit with", "Bonus Points"
  ['preferred', /^(?:(?:qualifications|skills|experience|requirements|education)\s+)?(?:we|we'd)\s+(?:would\s+)?(?:prefer|love\s+to\s+see|like\s+to\s+see|be\s+excited\s+by)(?:\s+to\s+see)?|^what\s+(?:will|would|could)\s+(?:set\s+you\s+apart|make\s+you\s+stand\s+out|help\s+you\s+stand\s+out)|^it'?s\s+a\s+(?:big\s+)?plus\s+if(?:\s+you(?:\s+have)?)?|^(?:you'd|you\s+would|you'll|you\s+will)\s+be\s+(?:a\s+)?(?:great|perfect|ideal|strong)\s+fit\s+(?:with|if(?:\s+you(?:\s+have)?)?)|^bonus\s+points?(?:\s+(?:if|for))?(?:\s+you(?:\s+have)?)?$|^what\s+we'?d\s+(?:like|love)\s+to\s+see(?:,?\s+but\s+(?:is\s+)?not\s+required)?$|^(?:would\s+be\s+)?nice\s+to\s+see$/i],
  // R6: a section about the place, not the person ("The Setting", "The Environment", "Where You'll Work")
  ['culture', /^(?:the|our)\s+(?:setting|environment|clinic|practice|location|workplace|facility)$|^where\s+you'?ll\s+(?:work|be)$/i],
  ['requirements', /^(?:experience|skills|qualifications)(?:\s*(?:&|and)\s*(?:skills|experience|qualifications))?\s+(?:you(?:'ll)?\s+need|you\s+bring|we(?:'re)?\s+looking\s+for|required)$/i],
  ['requirements', /^(?:(?:key|core|required)\s+)?competenc(?:ies|y)(?:\s+(?:&|and)\s+(?:skills|abilities|attributes))?$/i],
  ['requirements', /^(?:(?:qualifications|skills|experience|requirements)\s+)?(?:you\s+must\s+have|what\s+you\s+must\s+have|must\s+have|job\s+specifications?|specifications|minimum\s+specifications)$/i],
  ['responsibilities', /^(?:(?:key\s+)?outcomes|your\s+charter|charter|what\s+you(?:'ll|\s+will)\s+(?:achieve|accomplish|own|drive|focus\s+on|work\s+on|be\s+working\s+on|tackle|spend\s+(?:your|most\s+of\s+your)\s+time\s+on)|(?:your\s+)?focus\s+areas|areas\s+of\s+focus|your\s+focus|(?:your\s+)?impact|(?:job|role|position|key)\s+expectations|expectations|what\s+we\s+expect(?:\s+from\s+you)?|principal\s+(?:duties|accountabilities)|accountabilities)$/i],
  ['preferred', /^(?:(?:a\s+)?(?:strong|big|huge)\s+plus(?:es)?|plus(?:es)?|extra\s+points?|differentiators?)$/i],
  ['process', /^(?:take[- ]home\b.{0,60}|(?:the\s+)?assignment\b.{0,40}|(?:technical\s+)?(?:assessment|exercise|challenge)\s*(?:details|instructions|\(.{0,30}\))?)$/i],
  ['preferred', /^(?:preferred(?:\s+(?:qualifications|skills|experience|requirements)(?:\s+(?:&|and)\s+(?:key\s+)?(?:competencies|experience|skills|qualifications|education))?)?|additional\s+(?:qualifications|skills)|nice[- ]to[- ]haves?|bonus(?:\s+points)?|desired(?:\s+(?:skills|qualifications))?|it'?s a plus if|pluses|what would make you stand out|(?:strong\s+)?candidates\s+(?:may|might)\s+also\s+have(?:\s+experience\s+(?:with|in))?|(?:it\s+would\s+be|it'?s)\s+(?:great|nice|a\s+bonus|a\s+plus)\s+if\s+you(?:\s+have)?|(?:bonus|extra\s+credit|even\s+better)\s+if\s+you(?:\s+have)?|nice\s+if\s+you\s+have|preferred\s+(?:education|certifications?|licen[sc]es?)|ideally,?\s+you(?:'ll|\s+will)?\s+have)$/i],
  ['physical', /^(?:physical\s+(?:requirements?|demands?|abilities)|working\s+conditions|work\s+environment)$/i],
  ['schedule', /^(?:(?:[\w-]+\s+){0,4}schedule|(?:work(?:ing)?\s+)?hours|shifts?|availability|work\s+schedule|hours\s+of\s+work|shift\s+details?)$/i],
  ['requirements', /^(?:what\s+(?:will\s+)?makes?\s+you\s+(?:successful|a\s+(?:great|good|strong)\s+(?:fit|candidate))|(?:(?:required|preferred|technical|core|key|soft|hard|essential|basic|minimum|relevant|related)\s+){1,2}skills(?:\s+(?:&|and)\s+(?:abilities|experience|knowledge|competencies))?|(?:(?!(?:of|is|are|list|our|the|this|a|an|my|their|your|these|those|with|for)\s)[\w&-]+,?\s+){0,5}(?:requirements?|qualifications?)(?:\s+(?:&|and)\s+(?:key\s+)?(?:competencies|skills|qualifications|requirements))?|key\s+skills|(?:(?:certifications?|licen[sc]es?|education|experience|skills|training|qualifications|knowledge|abilities)(?:\s*[,/&]\s*(?:and\s+)?|\s+and\s+)){1,5}(?:certifications?|licen[sc]es?|education|experience|skills|training|qualifications|knowledge|abilities)|(?:required\s+|minimum\s+)?(?:experience|education|training|skills)(?:,?\s+(?:&|and)\s+|,\s+)(?:experience|education|training|skills|certifications?|licen[sc](?:es?|ure)|knowledge|abilities)(?:,?\s+(?:&|and)\s+(?:experience|education|training|skills|certifications?|licen[sc](?:es?|ure)|knowledge|abilities))?|your\s+(?:profile|skills|experience|qualifications)|the\s+ideal\s+candidate\s+(?:has|will\s+have)|skills?\s*(?:&|and)\s*(?:qualifications?|experience|abilities)|skills|must[- ]haves?|what\s+you(?:'ll|\s+will)?\s+(?:need|bring)(?:\s+to\s+(?:have|know|succeed|bring|the\s+(?:role|team|table)))?|(?:what\s+)?you\s+need\s+to\s+(?:know|have)|what(?:'s|\s+is)\s+needed\??|what\s+we(?:'re|\s+are)\s+looking\s+for|we(?:'re|\s+are)\s+looking\s+for(?:\s+(?:someone|people|candidates|a\s+person|you))?(?:\s+who(?:\s+(?:has|have|is|are))?)?|who\s+you\s+are|about\s+you|what\s+you\s+have|you\s+(?:have|bring|are)|experience\s+(?:&|and)\s+skills|knowledge,?\s+skills(?:\s+(?:&|and)\s+abilities)?|education\s+(?:&|and)\s+experience|education|(?:successful|ideal)\s+(?:associates?|candidates?|team\s+members?)|you\s+(?:may|might)\s+be\s+a\s+(?:good|great|strong)\s+fit\s+if\s+you(?:\s+have)?|you(?:'ll|\s+will)\s+thrive\s+(?:here\s+)?if\s+you(?:\s+have)?|we(?:'d|\s+would)\s+love\s+(?:to\s+hear\s+from\s+you\s+)?if\s+you(?:\s+have)?|(?:what\s+)?you\s+should\s+have|to\s+be\s+successful(?:\s+in\s+this\s+role)?(?:,?\s+you(?:'ll|\s+will)?\s+(?:need|have))?|you\s+(?:are|have)\s+(?:a|an)\s+[\w\s-]{0,30}who|minimum\s+(?:education|experience)|(?:basic|minimum|required)\s+education|education,?\s+(?:licen[sc]es?|certifications?),?\s+(?:and\s+)?experiences?|(?:our\s+|the\s+)?tech(?:nology)?\s+stack|tools\s+(?:we\s+use|(?:&|and)\s+technologies)|(?:requirements|qualifications|skills)\s+for\s+(?:the\s+|our\s+|an?\s+)?[A-Za-z][\w &/()+.-]{2,60})$/i],
  ['responsibilities', /^(?:(?:[\w-]+\s+){0,4}(?:responsibilities|duties)|duties\s+(?:&|and)\s+responsibilities|essential\s+functions|what\s+you(?:'ll|\s+will)\s+(?:get\s+to\s+)?(?:do|own|be\s+doing)|(?:job\s+|key\s+)?(?:responsibilities|duties)\s+(?:include|are)|the\s+role|your\s+role|in\s+this\s+role|a\s+day\s+in\s+the\s+life|day[- ]to[- ]day|what\s+you'?ll\s+be\s+doing|position\s+(?:overview|summary|description)|job\s+(?:summary|description|overview)|role\s+(?:overview|summary|description)|overview\s+of\s+the\s+role|the\s+opportunity|objective|job\s+objective|representative\s+projects|(?:responsibilities|duties)\s+(?:for|of)\s+(?:the\s+|our\s+|an?\s+)?[A-Za-z][\w &/()+.-]{2,60}|about\s+the\s+(?:role|job|position))$/i],
  ['benefits', /^(?:what\s+you(?:'ll|\s+will)?\s+get(?:\s+(?:from\s+us|in\s+return))?|what'?s\s+in\s+it\s+for\s+you|what\s+we\s+(?:offer|give)\s+you|[A-Za-z][\w&'.-]*(?:\s+[A-Za-z][\w&'.-]*){0,3}\s+offers(?:\s+you)?|(?:[\w-]+\s+){0,4}(?:benefits?|perks|salary\s+(?:&|and)\s+compensation|compensation)|what\s+we\s+offer|what\s+(?:[\w&'’.-]+\s+){1,3}offers?(?:\s+you)?|our\s+offer|what'?s\s+in\s+it\s+for\s+you|compensation(?:\s+(?:&|and)\s+benefits)?|pay|hourly\s+wage|salary|total\s+rewards|rewards|why\s+(?:work\s+)?(?:for|with|at)\s+us|we\s+put\s+our\s+employees\s+first)$/i],
  ['culture', /^(?:(?:life|working|work)\s+(?:at|with)\s+(?!(?:a|an|the|least|heights?|home|our|your)\b)[\w&'.-]+(?:\s+[\w&'.-]+)?|(?:our|company|core)\s+values|culture|who\s+we\s+are|about\s+(?:us|the\s+company|the\s+team|[A-Z][\w&'’-]*(?:\s+[A-Z][\w&'’-]*){0,5})|our\s+(?:story|mission|team|company)|mission|why\s+join(?:\s+\w+)?\??|why\s+[A-Z][\w&]*\??|company\s+overview|overview|what\s+success\s+looks\s+like|company\s+culture(?:\s+(?:&|and)\s+perks)?|you'?ll\s+fit\s+right\s+in\s+if\s+you)$/i],
  ['location', /^(?:(?:role[- ]specific\s+)?location(?:[- ]based)?(?:\s+hybrid)?\s+policy|location(?:\s+(?:&|and)\s+flexibility)?|work\s+location|work\s+arrangement|where\s+you(?:'ll|\s+will)\s+work)$/i],
  ['process', /^(?:(?:you(?:'re|\s+are)\s+)?not\s+a\s+(?:good\s+|great\s+)?fit\s+if(?:\s+you)?|(?:who\s+)?this\s+(?:role\s+|job\s+)?is\s+not\s+for(?:\s+you\s+if)?|red\s+flags|what\s+we\s+(?:don'?t|do\s+not)\s+want|we\s+are\s+not\s+looking\s+for|logistics|how\s+we(?:'re|\s+are)\s+different|come\s+work\s+with\s+us|visa\s+sponsorship|your\s+safety\s+matters(?:\s+to\s+us)?|more\s+resources(?:\s+to\s+learn\s+about\s+our\s+work)?|our\s+process|interview\s+process|hiring\s+process|how\s+to\s+apply|next\s+steps)$/i],
  ['eeo', /^(?:equal\s+(?:employment\s+)?opportunity(?:\s+employer)?|eeo(?:\s+statement)?|diversity(?:\s+(?:&|and)\s+inclusion)?|accommodations?|legal|disclaimer|pay\s+transparency)$/i],
];

// words a heading never holds ("Propio and client requirements relating to…" is a sentence fragment, not a heading — R4)
const NOT_HEADING_WORD_RE = /\b(?:relating|related\s+to|applicable|is|are|includes?|including|which|that|who|client|clients|their|its|per)\b/i;
// "Physical Requirements of this Position", "Qualifications for the Role": a heading with a tail naming the job
for (const h of HEADINGS) {
  const re = h[1];
  // …and with a possessive in front ("Your Education and Experience", "Our Requirements")
  h[1] = { test: (x) => { const t = String(x || '').replace(/(?:\s*[?!]|\s*\.{2,}|…)+\s*$/, '').replace(/\s+(?:include|includes)\s*,?\s+but\s+(?:are\s+|is\s+)?not\s+limited\s+to\s*:?$/i, ''); if (NOT_HEADING_WORD_RE.test(t)) return false; const u = t.replace(/\s+(?:(?:of|for|in)\s+(?:the|this|our)\s+(?:position|role|job)|day[- ]to[- ]day|on\s+(?:the|our)\s+team|at\s+[A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})\s*$/, '').replace(/\s+(?:of|for|in)\s+(?:the|this|our)\s+(?:position|role|job)\s*$/i, ''); return re.test(t) || re.test(u) || re.test(u.replace(/^(?:your|our|the|key)\s+(?=\S+\s)/i, '')); } };
}
const listish = (r) => !r.explicit && !r.held && !['benefits', 'eeo', 'process', 'location'].includes(r.kind) && !BENEFITS_RE.test(r.sentence) && !EEO_RE.test(r.sentence);
// a short noun phrase with no verb and no sentence punctuation ("Time management and caseload prioritization")
function isSkillPhrase(s) {
  const t = String(s || '').trim().replace(/[.;]$/, '');
  const w = t.split(/\s+/);
  return w.length >= 2 && w.length <= 9 && /^[A-Z]/.test(t) && !/[.!?:]\s/.test(t) && !/\b(?:is|are|was|were|will|can|may|we|our|you|your|us|has|have|offer|offers|provide|provides)\b/i.test(t) && !BENEFITS_RE.test(t) && !PERKS_PLACE_RE.test(t) && !/\b(?:insurance|401|pto|paid|holidays?|vacation|discount|bonus|salary|pay)\b/i.test(t);
}
const REQ_OPENER_RE = /^(?:attention\s+to|\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|(?:a\s+)?(?:minimum|at\s+least)\b|(?:(?:strong|excellent|solid|deep|proven|demonstrated|hands-on|working|basic|advanced|good|exceptional|outstanding|prior|previous|effective|clear)\s+)*(?:experience|knowledge|ability|able|proficiency|proficient|familiarity|familiar|understanding|expertise|skills?|track\s+record|background|fluency|fluent|willingness|comfort(?:able)?|exposure|grasp)\b|(?:a\s+|an\s+)?(?:bachelor|master|associate|high\s+school|degree|diploma|certif|licen[sc]|valid|current|active)|must\b)/i;
// how a list item opens: 'duty' (an imperative / third-person / gerund duty verb), 'req' (a requirement opener), or null
function itemOpening(s) {
  const t = String(s || '').trim();
  if (REQ_OPENER_RE.test(t)) return 'req';
  const w = (t.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!/^[A-Z]/.test(t) || t.split(/\s+/).length < 3) return null;
  const base = [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ing$/, ''), w.replace(/ing$/, 'e')];
  return base.some((x) => DUTY_STARTERS.has(x) || ITEM_VERBS.has(x)) ? 'duty' : null;
}
const ITEM_VERBS = new Set('develop design build lead manage mentor coach collaborate partner participate document educate monitor coordinate assist supervise plan execute deliver drive own run analyze analyse apply present explore investigate implement integrate translate troubleshoot maintain perform conduct prepare review create write evaluate identify ensure support provide serve shape invent play move champion uphold shoot foster preserve keep share represent recruit train teach care operate inspect install repair test measure produce track report respond resolve handle complete process communicate engage negotiate sell prospect grow expand establish define set improve optimize automate configure deploy debug architect'.split(' '));
/** Is this short phrase a section heading the reader knows ("Qualifications", "Education", "What you'll do")? */
export function isHeadingPhrase(h) {
  const t = String(h || '').replace(/\u2019/g, "'").replace(/[:\-–]+$/, '').trim();
  return !!t && t.split(/\s+/).length <= 9 && HEADINGS.some(([, re]) => re.test(t));
}

const EEO_RE = /\b(?:personal\s+information|privacy\s+(?:policy|notice|statement)|legitimate\s+(?:website|careers?\s+page|recruit\w*)|recruit(?:ing|ment)\s+(?:scam|fraud)|fraudulent\s+(?:job|offer|recruit)\w*|phishing|equal\s+(?:employment\s+)?opportunity|without\s+regard\s+to|protected\s+(?:veteran|status|class)|sexual\s+orientation|gender\s+identity|national\s+origin|reasonable\s+accommodations?|employment\s+decisions\s+are\s+(?:based|made)|perform\s+each\s+essential\s+(?:duty|function)|essential\s+functions?\s+(?:of\s+(?:the|this)\s+(?:job|position))?\s*(?:with|without)|applicant\s+notices?|general\s+notice|know\s+your\s+rights|(?:workplace\s+)?accommodation\s+or\s+adjustment|workplace\s+accommodation|need\s+(?:an?\s+)?accommodation|affirmative\s+action|drug[- ]free\s+workplace|e-?verify|eeoe?\b|proud\s+to\s+be\s+an?\s+(?:equal|eeo)|department\s+of\s+homeland\s+security|social\s+security\s+administration|tentative\s+nonconfirmation|fair\s+chance|criminal\s+histories|background\s+check\s+policy|discriminat|privacy\s+policy|terms\s+of\s+use)\b/i;
const BENEFITS_RE = /\b(?:incentive\s+programs?|other\s+incentives|happy\s+hours?|catered|(?:family|team)\s+dinners?|dinner\s+nights?|lunches|snacks|food\s+trucks|team\s+offsites?|hackathons?|annual\s+budget\s+for|work\s+remotely\s+from\s+anywhere|in\s+your\s+own\s+time\s+zone|(?:range|suite|package)\s+of\s+benefits|benefits\s+(?:package|include|including)|proud\s+to\s+offer|compensation\s+(?:depends|is|range|offered)|base\s+salary|salary\s+range|annual\s+bonus|target\s+bonus|401\s?\(?k\)?|(?:paid\s+)?sabbaticals?|years\s+of\s+service|productivity\s+(?:bonus|incentives?)|earning\s+potential|parental\s+leave|long-term\s+incentives|company\s+stock|rewards?\s+marketplace|pay\s+decisions|evaluating\s+compensation|medical\s+insurance|additional\s+pay\s+may|weekly\s+pay(?:roll|checks?|days?)?|daily\s+pay|same[- ]day\s+pay|direct\s+deposit|medical(?:\/|,\s*)dental|dental|vision\s+(?:insurance|coverage|plan)|health\s+insurance|paid\s+time\s+off|pto\b|vacation|sick\s+(?:pay|leave|time)|tuition|employee\s+discount|discounts?\s+on|perks?|bonus(?:es)?\s+(?:program|eligible)|opportunities\s+for\s+advancement|career\s+growth|ongoing\s+training|paid\s+training|we\s+offer|competitive\s+(?:pay|wage|salary|compensation)|hourly\s+wage:|per\/hour|per\s+hour|premiums?\s+may|restricted\s+stock(?:\s+units?)?|rsus?\b|sign[- ]on\s+(?:bonus|payments?)|signing\s+bonus|package\s+will\s+include|we\s+will\s+equip\s+you|what\s+[\w&'’.-]+(?:\s+[\w&'’.-]+){0,2}\s+offers\s+you)\b/i;
const CULTURE_RE = /\b(?:core\s+values|our\s+values|we\s+believe|our\s+mission|mindful|passion(?:ate)?|we\s+are\s+(?:a|an|the)\s+(?:leading|fast[- ]growing|global)|headquartered|founded\s+in|was\s+founded|comprised\s+of|stands\s+for|why\s+(?:join|work)|excel\s+individually|grow\s+and\s+excel|community|culture|is\s+a\s+leading|we\s+strive|committed\s+to\s+(?:building|cultivating|fostering|creating)|feel\s+valued|rooted\s+in)\b/i;
// Boilerplate that is never a requirement, whatever block it sits in (2026-11-10 judge, optimize #2 / prep D9): export
// control ("To conform to U.S. Government export regulations…", "Learn more about the ITAR here"), a social-media
// invitation ("take a look at our 12 West Instagram page"), a call to action ("apply NOW and start work fast!"), a
// recruiting-fraud notice. One list for both readers (the vocabulary and the posting-terms reader).
export const EXPORT_CONTROL_RE = /\b(?:export\s+(?:control|regulations?|administration\s+regulations|laws?)|itar\b|international\s+traffic\s+in\s+arms|u\.?s\.?\s+(?:person|national)s?\b|lawful\s+permanent\s+resident|protected\s+individual|asylee)/i;
export const SOCIAL_CTA_RE = /\b(?:great\s+place\s+to\s+work|employees\s+(?:say|said)|best\s+places?\s+to\s+work|award(?:-winning|ed)?\b|apply\s+for\s+this|you['’]ve\s+spent\s+enough|(?:visit|follow|check\s+out|take\s+a\s+look\s+at|find|like)\s+(?:us\s+on\s+|our\s+)(?:[\w&’'-]+\s+){0,3}(?:instagram|facebook|linkedin|tiktok|twitter|youtube|glassdoor|website|blog)\b|(?:instagram|facebook|linkedin|tiktok|twitter|youtube)\s+(?:page|account|channel)|apply\s+(?:now|today)\b|start\s+work(?:ing)?\s+(?:fast|today|this\s+week)|if\s+you(?:['’]re|\s+are)\s+ready\s+to|click\s+(?:apply|here)|learn\s+more\s+about\s+(?:the\s+)?(?:itar|us|our|benefits)|will\s+never\s+ask\s+(?:you\s+)?(?:for|to)|official\s+(?:email|e-mail)\s+domain|(?:job|recruit\w*)\s+scams?)/i;
// A sentence written in another language than the posting's English ("UNA NUEVA CARRERA IMPULSADA POR TI",
// Concentrix) — its words are never requirements. Spanish/Portuguese/French function words, ≥30% of the sentence.
const FOREIGN_WORDS = new Set('una uno nueva nuevo por para los las el la del al que y en con se su sus es un tu te ti nuestro nuestra nuestros más mas como anima postularse carrera impulsada trabajo empleo usted ofrecemos buscamos requisitos experiencia o pero también le les lo sobre sin entre muy está estamos somos você nós não seu sua em com uma os ao pela pelo nous vous les des une est avec pour dans sur notre votre und der die das mit für von zu ist sind wir du dich dir unser unsere unseren im bei auf dem des eine ein einen als auch oder sowie verantwortest zusammen'.split(' '));
export function isForeignSentence(s) {
  const words = String(s || '').toLowerCase().match(/[a-záéíóúñãõçêâ]+/g) || [];
  if (words.length < 3) return false;
  const n = words.filter((w) => FOREIGN_WORDS.has(w)).length;
  return n >= 2 && n / words.length >= 0.3;
}
// perks, places and pay structure that a benefits/location block lists without a heading the reader knows
const PERKS_PLACE_RE = /\b(?:employee\s+assistance\s+program|eap\b|(?:employment|offers?(?:\s+of\s+employment)?|hire|hiring)\s+(?:is|are|will\s+be)?\s*contingent\s+(?:up)?on|your\s+employer\s+(?:will\s+be|is)|employer\s+of\s+record|(?:you\s+will\s+be\s+)?employed\s+by|headquarter(?:s|ed)|our\s+offices?|offices?\s+roles?|relocation\s+assistance|commission[- ]earning|stipend|parental\s+leave|family\s+planning|wellness\s+(?:programs?|stipends?|benefits?|reimbursements?|days?|perks?|allowance)|disability\s+(?:coverage|insurance)|health\s+savings|flexible\s+spending|life\s+insurance|stock\s+options?|employee\s+assistance|hybrid\s+positions?|on-site\s+expectations?|eligible\s+for\s+our)\b/i;
// legal and hiring-process disclaimers, pay-variance notes, culture lines (unseen-posting read, 2026-11-10)
const DISCLAIMER_RE = /\b(?:unlawful\s+in|notice\s+to\s+(?:[A-Z][a-z]+\s+)?applicants?|export\s+licen[sc]e|lie\s+detector|representative\s+of\s+the\s+(?:knowledge|skills?|duties)|(?:need|require)s?\s+(?:any\s+|an?\s+)?accommodations?|work\s+authori[sz]ation|reply\s+stop|privacy\s+act|financially\s+strong|temp-to-perm|not\s+(?:designed|intended)\s+to\s+(?:contain|be\s+(?:interpreted|construed))|comprehensive\s+(?:inventory|list(?:ing)?)\s+of\s+(?:all\s+)?(?:duties|responsibilities)|salary\s+offer|offer\s+may\s+vary|(?:offers?|provides?)\s+(?:top-tier|competitive|great|excellent|comprehensive)\s+benefits|safety-sensitive\s+positions?|national\s+security\s+requirements|may\s+ask\s+(?:candidates|applicants)|any\s+hiring\s+decision|reasonable\s+adjustments?|legally\s+authorized\s+to\s+work|authori[sz]ed\s+to\s+work\s+in|visa\s+sponsorship|skills\s+test\s+performance|(?:does|do)\s+not\s+meet\s+every|growth\s+opportunit\w*|internship\s+program\s+is\w*|without\s+using\s+ai|not\s+(?:designed|intended)\s+to\s+(?:cover|be\s+all[- ]inclusive)|subject\s+to\s+(?:firm|business|company)\s+needs|may\s+change\s+at\s+any\s+time|policy\s+applies\s+to\s+all\s+employment|physical\s+demands\s+described\s+here|remote-first\s+company|our\s+teams?\s+champion|through\s+our\s+values|if\s+you\s+had\s+worked\s+at|will\s+correlate\s+with|as\s+demonstrated\s+through\s+coursework|internal\s+job\s+level|we\s+need\s+people\s+who|your\s+work\s+directly\s+impacts)\b/i;
/** True when a sentence is boilerplate that never states a requirement (EEO, export control, benefits/pay, social, CTA, fraud, another language). */
export function isBoilerplate(s) {
  const t = String(s || '');
  return EEO_RE.test(t) || DISCLAIMER_RE.test(t) || EXPORT_CONTROL_RE.test(t) || SOCIAL_CTA_RE.test(t) || isForeignSentence(t) || (BENEFITS_RE.test(t) && !STRONG_CUE_RE.test(t)) || (PERKS_PLACE_RE.test(t) && !STRONG_CUE_RE.test(t));
}
// A sentence that says what the job is NOT ("What ships here isn't metrics on a dashboard" — Samsara read
// "dashboards" from it) or that nothing is needed ("No experience needed") states no requirement.
export const NEGATED_SENTENCE_RE = /\b(?:isn['’]t|aren['’]t|is\s+not\s+(?:about|just|only|a|an|the|for)|are\s+not\s+(?:about|just|only)|(?:don['’]t|do\s+not|doesn['’]t|does\s+not)\s+need|no\s+(?:prior\s+|previous\s+)?(?:experience|degree)\s+(?:is\s+)?(?:needed|necessary|required))\b/i;
export const REQUIREMENT_CUE_RE = /\b(?:required?|requirements?|must(?:\s+(?:be|have|possess))?|need(?:s|ed)?\s+to|needs?\b|needed\b|essential|mandatory|minimum|at\s+least|ability\s+to|able\s+to|proven|demonstrated|experience\s+(?:in|with|of)|years?\s+of|strong|excellent|solid|knowledge\s+of|familiar(?:ity)?\s+with|proficien(?:t|cy)|skilled\s+in|comfort(?:able)?\s+(?:with|to)|willing(?:ness)?\s+to|capable\s+of|preferred|a\s+plus|nice\s+to\s+have|bonus|ideal(?:ly)?|desired|exceptional|professional\s+(?:appearance|demeanor))\b/i;
// A preference cue. "primary/preferred language" (Kunai: "5+ years … with Go as your primary/preferred
// language") is an adjective, not a preference; an "annual bonus" is pay, not "a bonus to have".
export const PREFERRED_CUE_RE = /(?<![\/\w-])(?:prefer(?:red)?(?!\s*\/|\s+(?:language|languages|name|pronouns|method|location|tool|platform|stack)s?\b)|nice[- ]to[- ]haves?|(?:is\s+)?a\s+(?:big\s+|huge\s+|strong\s+)?plus|(?:is\s+|are\s+)?(?:big|huge|significant|major|definite)\s+plus\b|(?<!(?:annual|target|performance|sign[- ]on|signing|quarterly|referral|retention|cash|year[- ]end)\s)bonus(?!\s+(?:program|eligible|plan|potential|structure|opportunit\w*|pay)\b)|ideally|ideal(?!\s+(?:candidate|person|applicant|hire|team\s+member)s?\b)|desired|would\s+be\s+great|familiarity\s+with|exposure\s+to|helpful|beneficial|an\s+asset|(?:is|are)\s+recommended|advantage(?:ous)?)\b/i;
export const RESPONSIBILITY_CUE_RE = /^(?:[A-Z][a-z]+ing\b|Provid|Ensur|Maintain|Complet|Resolv|Follow|Help|Perform|Assist|Greet|Process|Operat|Stock|Clean|Educat|Us(?:e|ing)|Build|Drive|Deliver|Support|Handle|Answer|Prepar|Receiv|Pick|Pack|Load|Unload|Scan|Count|Ring|Open|Close)/;

// Section headings that sit INLINE in a posting stored as one flat line (every Greenhouse row in
// prod: 0 of 400 SpaceX rows had a newline). "… next quarter. Key Requirements Portfolio
// required. 2–4 years in social media …" (Groupon), "… the stack Who you are We're looking for …
// Minimum requirements Strong software engineering skills …" (Stripe), "… downstream What we're
// looking for 5+ years …" (Kunai). Each is cut out onto a line of its own so the heading reader
// sees it. A phrase counts only when it starts with a capital in the text and is followed by a
// capitalised word, a digit, a bullet or a colon; single words (Requirements, Qualifications …)
// only after a sentence end or at the start, so "the requirements of the role" never splits.
const INLINE_HEADINGS = [
  'key\\s+requirements', 'key\\s+responsibilities', 'key\\s+qualifications', 'key\\s+skills',
  '(?:minimum|basic|required|preferred|desired|additional|job|position|core)\\s+(?:requirements|qualifications|skills|experience)(?:\\s+(?:and|&)\\s+(?:key\\s+)?(?:competencies|experience|skills|qualifications|education))?',
  'requirements\\s+(?:and|&)\\s+qualifications', 'qualifications\\s+(?:and|&)\\s+(?:requirements|skills|experience)', 'skills\\s+(?:and|&)\\s+(?:qualifications|experience|requirements)',
  "what\\s+you(?:['’]ll|\\s+will)\\s+(?:need|bring|do|own|be\\s+doing)", 'what\\s+you\\s+(?:bring|have|need)', "what\\s+we(?:['’]re|\\s+are)\\s+looking\\s+for", 'what\\s+we\\s+need',
  'who\\s+you\\s+are', 'about\\s+you', 'you\\s+have', 'you\\s+bring', 'must[- ]haves?', 'nice[- ]to[- ]haves?', 'bonus\\s+points', "it['’]s\\s+a\\s+plus\\s+if",
  'your\\s+(?:profile|skills|experience|qualifications)', 'the\\s+ideal\\s+candidate\\s+(?:has|will\\s+have)',
  'about\\s+the\\s+(?:role|team|job|position|company)', 'the\\s+role', 'your\\s+role', 'role\\s+overview', 'position\\s+(?:overview|summary)', 'job\\s+(?:summary|description|overview)',
  'what\\s+success\\s+looks\\s+like', 'location\\s+(?:&|and)\\s+flexibility', 'company\\s+culture\\s+(?:&|and)\\s+perks', 'what\\s+we\\s+offer', 'our\\s+process', 'interview\\s+process',
  'benefits\\s+(?:&|and)\\s+perks', 'perks\\s+(?:&|and)\\s+benefits', 'compensation\\s+(?:&|and)\\s+benefits', 'equal\\s+opportunity\\s+employer', 'who\\s+we\\s+are', 'about\\s+us',
];
const SINGLE_HEADINGS = ['requirements', 'qualifications', 'responsibilities', 'duties', 'benefits', 'perks', 'skills', 'summary', 'preferred'];
const INLINE_HEADING_RE = new RegExp(`(^|\\s)((?:${INLINE_HEADINGS.join('|')}))(?=\\s*(:)|\\s+(\\S))`, 'gi');
const SINGLE_HEADING_RE = new RegExp(`(^|[.!?:;]\\s+)(${SINGLE_HEADINGS.join('|')})(?=\\s*(:)|\\s+(\\S+))`, 'gi');
export function cutInlineHeadings(l, { keepColon = false } = {}) {
  // the heading must start with a capital IN THE TEXT and be followed by a colon or by a capitalised
  // word, a number or a bullet (checked here: the regex is case-insensitive, so its lookahead is too)
  // keepColon: a "Heading: text" stays on one line (the listing page shows it that way)
  // a phrase inside a longer heading ("BONUS POINTS IF YOU HAVE:", "Bonus points for:") is not cut out of it (R3)
  const cut = (m0, pre, head, colon, next, offset, str) => {
    if (!colon && /^(?:if|you|for|to|and|&|of|that|we|would|when)$/i.test(next || '')) return m0;
    if (typeof str === 'string' && /(?:^|\s)(?:if|that|who|when|where|whether|and|&|for)\s*$/i.test(str.slice(0, offset + pre.length))) return m0;
    return /^[A-Z]/.test(head) && (colon || /^[A-Z0-9•("“]/.test(next || '')) ? (colon && keepColon ? `${pre}\n${head}` : `${pre}\n${head}\n`) : m0;
  };
  // a single word that is only the start of a longer heading ("Preferred Qualifications and …") is not one
  const single = (m0, pre, head, colon, next, offset, str) => (!colon && /^(?:qualifications?|requirements?|skills?|experience|and|&|competencies|responsibilities|duties|to|points|by)$/i.test(next || '') ? m0 : cut(m0, pre, head, colon, next, offset, str));
  // a cut heading's colon never opens the next line ("RESPONSIBILITIES: Perform …" → "RESPONSIBILITIES" / "Perform …")
  return l.replace(INLINE_HEADING_RE, cut).replace(SINGLE_HEADING_RE, single)
    // a one-word heading run into a flat list with no punctuation ("… and court appearances Qualifications Law degree …")
    .replace(/((?:^|(?<=\s))[a-z0-9](?:\S*[a-z)])?)\s+(Qualifications?|Requirements|Responsibilities|Duties|Benefits|Education|Preferred Qualifications|Minimum Qualifications|Basic Qualifications)\s+(?=[A-Z][a-z])/g, '$1\n$2\n')
    .replace(/\n[ \t]*:[ \t]*/g, '\n');
}

// Words a run-together bullet starts with (a requirement noun phrase or an imperative duty verb).
// A flat posting's bullets lose their punctuation: "… with Go as your primary/preferred language
// Experience building integration … consuming applications Comfort working with transactional
// systems …". The old rule split before ANY capitalised word after a lower-case word, so proper
// nouns broke sentences in half ("across | North America", "with how | Gen Z audiences"). Now a
// run-on is split only before one of these words, or before an "N+ years" figure.
const BULLET_STARTERS = new Set(`experience experienced ability able strong proven knowledge familiarity familiar comfort comfortable
  excellent exceptional outstanding demonstrated demonstrable deep hands-on solid working understanding bachelor bachelor's bachelors
  master's minimum must preferred prior previous background passion passionate track self-directed self-motivated native fluency
  fluent proficiency proficient expertise exposure willingness willing desire interest curiosity curious highly basic advanced
  intermediate detail-oriented detail effective attention certification certified current valid availability available have hold focus
  design build partner enforce integrate help collaborate lead own run define set maintain prototype coordinate support keep explore
  serve monitor develop create manage drive deliver participate debug write ensure provide contribute implement improve analyze analyse
  conduct perform prepare review report plan execute communicate mentor train identify establish oversee handle assist respond answer
  greet translate produce personally ship test investigate act champion evaluate research optimize scale automate operate configure
  shape influence present draft edit publish launch grow measure engage recruit negotiate organize schedule document resolve
  troubleshoot install repair inspect clean stock load unload pick pack work read utilize obtain specify submit procure attend`.split(/\s+/).filter(Boolean));
const DUTY_STARTERS = new Set('grow prospect achieve convert sell close negotiate guide escort greet prepare perform assist help maintain answer schedule process provide ensure operate clean stock load unload pick pack deliver monitor document record collect conduct coordinate support manage lead train review report respond resolve handle complete follow use operate install repair inspect test draw obtain administer educate communicate develop design build create write'.split(' '));
const DETERMINER_END_RE = /\b(?:the|a|an|of|to|for|with|in|on|at|our|their|and|or|by|from|as|per|into|all|your|its|via|like|than|is|are|be|past|last|next|over|first|nearly|about|around|almost|within|least|after|before|during|every|until|minimum|maximum|min|max|bachelor's|master's|associate's)$/i;
const YEARS_WORD_RE = /^(?:years?|yrs?)\b/i;
export function splitRunOn(sent) {
  if (sent.length <= 60) return [sent];
  const words = sent.split(' ');
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur.length ? cur[cur.length - 1] : '';
    const letters = w.replace(/[^A-Za-z'’-]/g, '');
    const bare = letters.toLowerCase().replace(/’/g, "'");
    // under 120 characters only an imperative duty verb starts a new bullet ("… initial patient intake Guide patients …")
    // in a long run (a flat bullet list) also: an article ("… law school An active member"), a capitalised abstract
    // noun ("… the case process Interaction with expert witnesses", "Attendance and preparation for …")
    const nextLower = /^[a-z]/.test(words[i + 1] || '');
    const startsBullet = /^[A-Z]/.test(w) && (DUTY_STARTERS.has(bare) || (sent.length > 120 && (BULLET_STARTERS.has(bare) || /^[A-Z][a-z]{4,}ing$/.test(letters)
      || (/^(?:A|An|The)$/.test(w) && nextLower) || (/^[A-Z][a-z]{3,}(?:tion|sion|ance|ence|ment|ship)s?$/.test(letters) && nextLower) || /^(?:Self-starter|Superior|Ideally|Day-to-day|Exceptional|Outstanding|Bilingual|Fluent)$/i.test(letters) || (/^(?:Valid|Current|Active)$/i.test(letters) && nextLower))));
    const startsYears = /^\d{1,2}(?:\+|\s*[-–]\s*\d{1,2}\+?)?$/.test(w) && YEARS_WORD_RE.test(words[i + 1] || '');
    // never inside a capitalised name ("the Sr. Lifecycle & CRM Marketing Lead")
    // a closing parenthesis ends a bullet even after a name ("… (skilled with Microsoft Office Suite) Experienced in …")
    // a verb still waiting for its object never ends a bullet ("Write and maintain | Advanced PowerShell scripts",
    // "in managing | Active Directory" — R3)
    const prevVerb = /^[a-z]/.test(prev) && (DUTY_STARTERS.has(prev.toLowerCase()) || /^[a-z]{3,}ing$/.test(prev));
    const prevOk = prev && /[a-z0-9)\]%]$/.test(prev) && (!/^[A-Z]/.test(prev) || /\)$/.test(prev)) && !DETERMINER_END_RE.test(prev) && !prevVerb;
    // after a capitalised name ("… Microsoft Office Suite Excellent verbal …") only an unmistakable requirement opener starts one
    const afterName = sent.length > 120 && prev && /^(?:[A-Z][a-z]+|[A-Z]{2,6})$/.test(prev) && /^(?:Excellent|Strong|Proven|Demonstrated|Ability|Must|Minimum|Knowledge|Proficiency|Familiarity|Experience|Bachelor's|Bachelors|High|Valid|Understanding|Expertise|Hands-on)$/.test(w) && /^[a-z]/.test(words[i + 1] || '') && !DETERMINER_END_RE.test(prev);
    // "N+ years" opens a requirement after any word ("… Golang and/or Python 2+ years of experience with Kubernetes")
    const yearsOk = startsYears && prev && /[A-Za-z0-9)\]%]$/.test(prev) && !DETERMINER_END_RE.test(prev) && !/^(?:and|or|to|than|least|over|of|with|minimum|min|plus)$/i.test(prev);
    if (cur.length >= 3 && ((prevOk && (startsBullet || startsYears)) || afterName || yearsOk)) { out.push(cur.join(' ')); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur.join(' '));
  return out.map((p) => p.trim()).filter(Boolean);
}

// Sentence splitter for flat and line-broken postings alike. Inline headings ("Job
// Requirements: Previous …", "Key Requirements Portfolio …") start a line of their own;
// sentences come from the ONE shared splitter (lib/text/sentences.js — "e.g." is not an end).
export function splitPostingSentences(text) {
  return splitPostingPieces(text).map((p) => p.text);
}
// lib/text/sentences.js skips the closing bracket after an abbreviation's dot ("(WS-Fed, OAuth, SAML, etc.) …"), so it
// keeps protecting for 240 characters and a real sentence end after it is missed ("… for the Enterprise. Strong
// experience in PowerShell …" read as one line — R3). The rest of the line after such a bracket is split again.
function splitSentencesSafe(part, depth = 0) {
  const out = [];
  for (const sent of splitSentences(part)) {
    const m = depth < 6 ? /[.!?]["”’']?[)\]]\s+(?=\S)/.exec(sent) : null;
    if (!m) { out.push(sent); continue; }
    const end = m.index + m[0].length;
    const rest = splitSentencesSafe(sent.slice(end), depth + 1);
    out.push(`${sent.slice(0, end).trim()} ${rest[0] || ''}`.trim(), ...rest.slice(1));
  }
  return out;
}
/**
 * The same split, with where each piece came from (R3 display gate): `origin` is 'bullet' (a whole bullet / numbered
 * line), 'line' (a whole line, or the text after a heading on its line), 'sentence' (one of several sentences of a
 * line, split at sentence punctuation) or 'runon' (cut out of a flat run at a semicolon list or a run-on boundary —
 * the least certain).
 */
export function splitPostingPieces(text) {
  // a line wrapped mid-sentence ("…deploy on\nAWS with Docker.") is one line: join a line that does not
  // end a sentence or a heading to a next line that starts in lower case, or a line that ends on a word
  // no sentence ends with ("on", "the", "and")
  const src = String(text || '').replace(/\r/g, '\n').replace(/([a-z0-9,;:])[ \t]*\n[ \t]*(?=[a-z(])/g, '$1 ').replace(/\b(the|a|an|of|to|for|with|in|on|at|and|or|by|from|as|using|via|into|our|your)[ \t]*\n[ \t]*(?=[A-Za-z0-9])/gi, '$1 ').replace(/•|▪|◦|‣|·|●/g, '\n• ').replace(/\n•[ \t]*\n+(?=[ \t]*\S)/g, '\n• ');
  const out = [];
  let bulletNo = 0;
  for (const line of src.split(/\n+/)) {
    const bullet = /^\s*(?:[•\-*]|\(?\d{1,2}[.)]|\(?[a-h][.)])\s+\S/.test(line);
    if (bullet) bulletNo++;
    let l = line.replace(/^\s*[•\-*]\s*/, '').replace(/\s+/g, ' ').trim();
    if (!l) continue;
    // a whole ALL-CAPS line is one heading ("WHAT YOU BRING TO THE ROLE:"), never cut into its words
    if (!bullet && /^[A-Z0-9][A-Z0-9 &'’/,()+.-]{2,80}:?$/.test(l) && /[A-Z]{3}/.test(l) && l.split(/\s+/).length <= 9) { out.push({ text: l.replace(/\s*:$/, ''), origin: 'line' }); continue; }
    // LinkedIn tracking tags ("#LI-Hybrid", "#LI-JJ1") end whatever came before them: what
    // follows is usually the benefits block, run into the last requirement with no punctuation
    l = l.replace(/\s*#LI-[\w-]+\s*/gi, '\n');
    // inline Title Case heading followed by a colon ("… Co-Presidents. Position Overview: Customer …")
    l = l.replace(/(?:^|\s)((?:[A-Z][\w&'’/-]*(?:\s+(?:and|&|of|the|to|for|in))?\s+){0,4}(?:[A-Z][\w&'’/-]*(?:\s+(?:if|you|have|for|would|be|a|we|need)){1,4}|[A-Z][\w&'’/-]*)\??):(?:\s|$)/g, (m0, head, at, str) => {
      // only after a sentence end, for a known heading, or a multi-word Title Case run: "… health of
      // the CRM: database hygiene …" is a sentence that names its list, not a heading
      const before = str.slice(0, at).trimEnd();
      // a known heading at the END of the capitalised run is the heading; the words before it end the previous line
      // ("… Google Suite Compensation: The base pay range …" pasted as one paragraph)
      // the whole run first ("… discipline PREFERRED SKILLS AND EXPERIENCE:" is one heading, never "PREFERRED" + "SKILLS AND
      // EXPERIENCE"; "BASIC QUALIFICATIONS:" never "BASIC" + "QUALIFICATIONS"), then the SHORTEST known suffix ("… Google
      // Suite Compensation:" → "Compensation", never "Suite Compensation")
      const hw = head.trim().split(/\s+/);
      const isHead = (h) => HEADINGS.some(([, re]) => re.test(h.replace(/’/g, "'")));
      // the LONGEST suffix that opens on a heading word ("PREFERRED SKILLS AND EXPERIENCE", "BASIC QUALIFICATIONS"),
      // else the shortest known suffix ("… Google Suite Compensation:" → "Compensation", never "Suite Compensation")
      let pick = -1;
      for (let k = hw.length; k >= 1; k--) if (HEAD_OPENER_RE.test(hw[hw.length - k]) && isHead(hw.slice(hw.length - k).join(' '))) { pick = k; break; }
      if (pick < 0) for (let k = 1; k <= hw.length; k++) if (isHead(hw.slice(hw.length - k).join(' '))) { pick = k; break; }
      // the words before a known suffix that end on a joiner ("Required Experience and | Education") are the heading too
      if (pick > 0 && pick < hw.length && /^(?:and|&|of|the|for|to|in)$/i.test(hw[hw.length - pick - 1])) pick = hw.length;
      const known = pick === hw.length;
      if (pick > 0 && pick < hw.length) return `${m0.slice(0, m0.indexOf(head))}${hw.slice(0, hw.length - pick).join(' ')}\n${hw.slice(hw.length - pick).join(' ')}: `;
      return !before || /[.!?:;)]$/.test(before) || known || head.trim().split(/\s+/).length >= 2 ? `\n${head}: ` : m0;
    });
    // an ALL-CAPS heading run inside a flat line ("… off the mat. OBJECTIVE The Seasonal …")
    l = l.replace(/(?:^|\s)((?:[A-Z][A-Z&'’/-]{1,}\s+){1,6})(?=[A-Z][a-z])/g, (m0, head) => (/[A-Z]{4,}/.test(head) ? `\n${head.trim()}\n` : m0));
    // "… Current CPR certification About Thrive Skilled Pediatric Care Thrive SPC operates …": an About-the-company heading
    // run into the last requirement of a flat posting starts a line of its own (R3)
    l = l.replace(/([a-z0-9.)])[ \t](About[ \t]+(?:[A-Z][\w&'’-]*[ \t]+){1,5})(?=[A-Z])/g, '$1\n$2\n');
    // an ALL-CAPS heading at the END of a flat line ("… streaming architecture on AWS/EKS WE'RE LOOKING FOR SOMEONE WHO"):
    // the longest known heading at the end of the capitalised run starts a line of its own (R3)
    l = l.replace(/([a-z0-9.,;)%])\s((?:[A-Z][A-Z&'’/-]+\s+){1,7}[A-Z][A-Z&'’/-]+):?\s*$/, (m0, pre, run) => {
      const ws = run.split(/\s+/);
      for (let k = ws.length; k >= 1; k--) {
        const h = ws.slice(ws.length - k).join(' ');
        if (/[A-Z]{4,}/.test(h) && isHeadingPhrase(h.toLowerCase())) return `${pre}${k < ws.length ? ' ' + ws.slice(0, ws.length - k).join(' ') : ''}\n${h}`;
      }
      return m0;
    });
    // a one-word ALL-CAPS heading left at the end of a line ("… Availability to start soon. PREFERRED") (R5)
    l = l.replace(/([a-z0-9.,;)%])\s([A-Z]{5,20}):?\s*$/, (m0, pre, w) => (SINGLE_HEADINGS.includes(w.toLowerCase()) || ['QUALIFICATIONS', 'REQUIREMENTS', 'RESPONSIBILITIES', 'DUTIES', 'BENEFITS', 'PREFERRED', 'BONUS', 'SKILLS'].includes(w) ? `${pre}\n${w}` : m0));
    // a Title Case heading run into the text after a lower-case word, as a pasted single paragraph leaves it
    // ("… or equivalent Physical Requirements Lift up to 50 lbs …"): the longest known heading at the start of the run
    l = l.replace(/((?:^|(?<=\s))[a-z0-9](?:\S*[a-z0-9,)%])?)[ \t]((?:[A-Z][\w'’&/-]*[ \t]+){1,6})(?=[A-Z0-9•(])/g, (m0, pre, run) => {
      if (JOINER_WORD_RE.test(pre)) return m0;
      const ws = run.trim().split(/\s+/);
      for (let k = ws.length; k >= 1; k--) {
        const head = ws.slice(0, k).join(' ');
        if (k === 1 && !/^(?:Requirements?|Qualifications?|Responsibilities|Duties|Benefits|Education|Skills)$/.test(head)) continue;
        if (HEADINGS.some(([kind, re]) => kind !== 'culture' && re.test(head.replace(/’/g, "'")))) return `${pre}\n${head}\n${ws.slice(k).join(' ')}${k < ws.length ? ' ' : ''}`;
      }
      return m0;
    });
    // the same for a sentence-case heading ("… or equivalent Physical requirements Be outside …", "What you'll do Own …")
    l = l.replace(/((?:^|(?<=\s))[a-z0-9](?:\S*[a-z0-9,)%])?)[ \t]([A-Z][a-z'’]+(?:[ \t]+[a-z&'’][\w'’&/-]*){1,8}):?[ \t](?=[A-Z0-9•(])/g, (m0, pre, run) => {
      const ws = run.trim().split(/\s+/);
      for (let k = ws.length; k >= 2; k--) {
        const head = ws.slice(0, k).join(' ');
        if (HEADINGS.some(([kind, re]) => kind !== 'culture' && re.test(head.replace(/’/g, "'")))) return `${pre}\n${head}\n${ws.slice(k).join(' ')}${k < ws.length ? ' ' : ''}`;
      }
      return m0;
    });
    // a heading left at the END of a line by a single-paragraph paste ("… the needs of the business Qualification")
    l = l.replace(/((?:^|(?<=\s))[a-z0-9](?:\S*[a-z0-9,)%])?)[ \t]((?:[A-Z][\w'’&/-]*[ \t]+){0,5}[A-Z][\w'’&/-]*):?\s*$/, (m0, pre, run) => {
      // a joiner before the run is part of a heading ("Preferred Skills and | Qualifications" — R3)
      if (JOINER_WORD_RE.test(pre)) return m0;
      const ws = run.split(/\s+/);
      for (let k = 1; k <= ws.length; k++) {
        const h = ws.slice(ws.length - k).join(' ');
        if (k === 1 && !/^(?:Requirements?|Qualifications?|Responsibilities|Duties|Benefits|Education|Skills)$/.test(h)) continue;
        if (HEAD_OPENER_RE.test(ws[ws.length - k]) && HEADINGS.some(([kind, re]) => kind !== 'culture' && re.test(h))) return `${pre}${k < ws.length ? ' ' + ws.slice(0, ws.length - k).join(' ') : ''}\n${h}`;
      }
      return m0;
    });
    // a sentence-case label run into the line before ("… and/or experience Required field of study: A field relevant …")
    l = l.replace(/([a-z0-9)%])[ \t]((?:Required|Minimum|Preferred|Desired|Additional)[ \t]+[a-z][a-z'’]{1,20}(?:[ \t]+[a-z][a-z'’]{1,20}){0,3}):[ \t]/g, '$1\n$2: ');
    // a sentence-case heading with its colon at the END of a line ("… research tooling You may be a good fit if you:")
    l = l.replace(/([a-z0-9,)%])[ \t]([A-Z][a-z'’]+(?:[ \t]+[a-z&'’][\w'’&/-]*){1,9}):[ \t]*$/, (m0, pre, run) => (isHeadingPhrase(run) ? `${pre}\n${run}:` : m0));
    // known section headings run into the text ("… next quarter. Key Requirements Portfolio …")
    l = cutInlineHeadings(l);
    for (const [partNo, part] of l.split(/\n+/).entries()) {
      let sents = splitSentencesSafe(part);
      // R4: a bullet that opens with a short label sentence ("Expand existing relationships. Identify opportunities to grow…")
      // is one item, label and description together
      if (bullet && sents.length > 1 && sents[0].split(/\s+/).length <= 5 && !/\b(?:experience|years?|degree|diploma|licen[sc]e|certif\w*|required|preferred)\b/i.test(sents[0]) && !PAY_SENTENCE_RE.test(sents[1]) && !isBoilerplate(sents[1])) sents = [`${sents[0]} ${sents[1]}`, ...sents.slice(2)];
      for (const sent0 of sents) {
        // a list written with semicolons ("…; Work with route drivers…; Prospect and convert leads…; Exceptional computer
        // skills;") is one item per semicolon — never one sentence that the benefits around it swallow
        const pieces = (sent0.match(/;\s/g) || []).length >= 3 ? sent0.split(/;\s+/) : [sent0];
        // bullet items that lost their line breaks run together with no punctuation
        for (const sent of pieces) {
          const runs = splitRunOn(sent.trim());
          // (each sentence of a bullet is still part of that bullet item)
          const origin = pieces.length > 1 || runs.length > 1 ? 'runon' : bullet ? 'bullet' : sents.length > 1 ? 'sentence' : 'line';
          // (a bullet's pieces know their bullet: a heading cut out of the middle of one is scoped to it)
          for (const p of runs) if (p) out.push({ text: p, origin, ...(bullet ? { bulletNo, mid: partNo > 0 } : {}) });
        }
      }
    }
  }
  return out;
}

// "Requirements for Senior Back-end Developers" / "Cashier Responsibilities": the role a heading names, when it names one
// whose words the job title does not share (a posting that lists several roles is read for the role in its title)
const ROLE_GENERIC = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'the', 'a', 'an', 'all', 'our', 'this', 'role', 'position', 'job', 'i', 'ii', 'iii']);
function otherRole(head, jobTitle) {
  if (!head || !jobTitle) return false;
  const m = String(head).match(/^(?:requirements|qualifications|responsibilities|duties|skills)\s+(?:for|of)\s+(?:the\s+|our\s+|a\s+|an\s+)?(.{3,60})$/i) || String(head).match(/^(.{3,40}?)\s+(?:requirements|qualifications|responsibilities|duties)$/i);
  if (!m || !new RegExp(`${INFER_TITLE_NOUN}s?\\b`, 'i').test(m[1])) return false;
  const stem = (w) => w.toLowerCase().replace(/(?:ers?|ing|s)$/, '');
  const want = new Set(String(jobTitle).split(/[^A-Za-z]+/).filter((w) => w && !ROLE_GENERIC.has(w.toLowerCase())).map(stem));
  const got = m[1].split(/[^A-Za-z]+/).filter((w) => w && !ROLE_GENERIC.has(w.toLowerCase())).map(stem);
  return got.length > 0 && !got.some((w) => want.has(w));
}
const JOINER_WORD_RE = /^(?:and|or|&|of|the|for|to|in|with|a|an)$/i;
const HEAD_OPENER_RE = /^(?:preferred|basic|minimum|required|key|additional|desired|nice|bonus|physical|work|job|position|what|who|about|your|our|the|education|skills?|qualifications?|requirements?|responsibilities|duties|benefits|compensation|pay|salary|schedule|hours|essential|core|must|ideal|primary|general|role|day)$/i;
function headingOf(raw) {
  // an enumerated heading ("I. Physical Requirements of this Position", "2) Qualifications")
  // (a leading emoji / symbol — "⭐ Bonus Points" — and a trailing aside — "What You'll Do (Choose Your Preferred
  // Opportunity):" — are not the heading's words, R5)
  const sentence = String(raw).replace(/\u2019/g, "'").replace(/^[^A-Za-z0-9(]{1,6}(?=[A-Za-z])/, '').replace(/^(?:[IVX]{1,4}|\d{1,2}|[A-H])[.)]\s+(?=[A-Z])/, '').replace(/^([^()\n]{3,80}?)\s*\([^()\n]{1,60}\)\s*(:?)\s*$/, '$1$2');
  const m = sentence.match(/^((?:[A-Za-z#][\w&'/#-]*\s){0,8}[A-Za-z][\w&'/-]*\??)\s*:\s*(.*)$/s);
  if (m) {
    for (const [kind, re] of HEADINGS) if (re.test(m[1].trim())) return { kind, rest: m[2].trim(), head: m[1].trim() };
  }
  // a short line with no sentence punctuation that IS a heading, whatever its case ("What you'll do")
  const bare = sentence.replace(/[:\-–]+$/, '').trim();
  if (bare.split(/\s+/).length <= 9 && !/[.!]$/.test(bare)) {
    const hit = HEADINGS.find(([, re]) => re.test(bare));
    if (hit) return { kind: hit[0], rest: '', head: bare };
  }
  // a Title Case / ALL-CAPS run at the start that IS a heading ("Required Qualifications Bachelor's …")
  const words = sentence.split(/\s+/);
  const titleish = (w) => /^[A-Z#&'’][\w&'’/#?-]*$/.test(w) || /^(?:of|the|and|in|for|&|to|a|our|you|if|it|we|us|at|'ll)$/i.test(w);
  let run = 0; while (run < words.length && run < 5 && titleish(words[run])) run++;
  for (let n = run; n >= 1; n--) {
    const head = words.slice(0, n).join(' ').replace(/[:\-–]+$/, '');
    if (!/^[A-Z#]/.test(head)) continue;
    const rest = words.slice(n).join(' ');
    if (n === words.length && /[.!?]$/.test(sentence) && sentence.length > 48) continue;
    if (n === 1 && rest && !/^[A-Z]{3,}$/.test(words[0])) continue; // "Preferred 1+ years …" is a sentence, not a heading
    if (HEADINGS.some(([, re]) => re.test(head))) {
      const kind = HEADINGS.find(([, re]) => re.test(head))[0];
      return { kind, rest: rest.trim(), head };
    }
  }
  return null;
}

/**
 * Section a posting. Returns [{ kind, sentence, explicit }] — `explicit` is true when the
 * sentence sits under a real heading; otherwise its kind comes from sentence-level cues.
 */
export function sectionPosting(text, { jobTitle = '' } = {}) {
  const pieces = splitPostingPieces(text);
  const out = [];
  let current = null; // kind under an explicit heading, or null before any heading
  let block = 0;
  let fromHeading = false;
  let listNo = 0; // R6: a list is a run of consecutive bullets in one block // the current kind was set by a real heading (R6: a culture / benefits block holds its own lists)
  for (const [pi, piece] of pieces.entries()) {
    if (headingOf(piece.text)) block++;
    if (!piece.bulletNo) listNo++;
    const s = piece.text;
    const push = (r) => out.push({ ...r, origin: piece.origin, block, ...(piece.bulletNo ? { list: `${block}.${listNo}` } : {}), ...(fromHeading && current && !REQUIREMENT_KINDS.has(current) ? { held: current } : {}) });
    const h = headingOf(s);
    if (h) {
      current = h.kind;
      fromHeading = true;
      // a block for ANOTHER role in a posting that covers several ("Requirements for Senior DevOps Engineers:") is not read
      if (REQUIREMENT_KINDS.has(current) && otherRole(h.head, jobTitle)) current = 'other';
      if (h.rest && current !== 'other') push({ kind: current, sentence: h.rest, explicit: true });
      continue;
    }
    // a short unpunctuated line between a heading or bullets and the bullets after it ("KEY RESPONSIBILITIES / Build the
    // materials / • Build customer … / Run the execution / • Run …") is a sub-heading of the list, not an item (R4)
    if (current && REQUIREMENT_KINDS.has(current) && piece.origin === 'line' && !piece.bulletNo && /^[A-Z]/.test(s) && !/[.!?:;,)]$/.test(s) && s.split(/\s+/).length <= 5
      && pieces[pi + 1] && pieces[pi + 1].bulletNo && pieces[pi - 1] && (pieces[pi - 1].bulletNo || headingOf(pieces[pi - 1].text))) { block++; continue; }
    // (the same sub-heading left at the end of the bullet before it by a one-paragraph paste: "… operator training. New
    // product introduction • Act as …")
    if (current && REQUIREMENT_KINDS.has(current) && piece.bulletNo && /^[A-Z]/.test(s) && !/[.!?:;,)]$/.test(s) && s.split(/\s+/).length <= 5
      && pieces[pi - 1] && pieces[pi - 1].bulletNo === piece.bulletNo && /[.!?]$/.test(pieces[pi - 1].text) && pieces[pi + 1] && pieces[pi + 1].bulletNo && pieces[pi + 1].bulletNo !== piece.bulletNo && !DUTY_STARTERS.has(s.split(/\s/)[0].toLowerCase())) { block++; continue; }
    if (EEO_RE.test(s)) { push({ kind: 'eeo', sentence: s, explicit: false }); continue; }
    // export control, a social-media invitation, a call to action, a fraud notice or a sentence in another language
    // is never a requirement — and an unlabelled block that starts with one does not inherit "requirements": what
    // follows is classified sentence by sentence until a real heading (judge optimize #2: the trailing "Instagram
    // page", "apply NOW", "UNA NUEVA CARRERA…" rows read as required)
    if (EXPORT_CONTROL_RE.test(s) || SOCIAL_CTA_RE.test(s) || isForeignSentence(s)) {
      push({ kind: 'eeo', sentence: s, explicit: false });
      if (current && REQUIREMENT_KINDS.has(current)) { current = 'about'; fromHeading = false; }
      continue;
    }
    // a requirement written after the legal block is still a requirement ("Experience with Google Analytics … is
    // required" pasted under the EEO paragraph was read as EEO text — round 6, Tasha)
    if (current === 'eeo' && STRONG_CUE_RE.test(s) && !EEO_RE.test(s) && !/\b(?:discriminat|protected class|accommodat|privacy|applicants? (?:are|will)|employer\b)/i.test(s)) {
      push({ kind: PREFERRED_CUE_RE.test(s) && !/\b(?:required|must)\b/i.test(s) ? 'preferred' : 'requirements', sentence: s, explicit: false }); continue;
    }
    if (current && current !== 'culture' && current !== 'about') {
      if (REQUIREMENT_KINDS.has(current) && PAY_SENTENCE_RE.test(s) && !STRONG_CUE_RE.test(s)) { push({ kind: 'benefits', sentence: s, explicit: false }); continue; }
      if (REQUIREMENT_KINDS.has(current) && BENEFITS_RE.test(s) && !REQUIREMENT_CUE_RE.test(s)) { push({ kind: 'benefits', sentence: s, explicit: false }); continue; }
      // a flat posting's culture/benefits paragraph after the last requirement has no heading of its
      // own (Kunai: "Our success over the past 20 years is rooted in … a culture of collaboration")
      if (REQUIREMENT_KINDS.has(current) && CULTURE_RE.test(s) && !STRONG_CUE_RE.test(s) && !/\b(?:skills?|experience|ability|knowledge)\b/i.test(s)) { push({ kind: 'culture', sentence: s, explicit: false }); continue; }
      // a requirement or a duty run on after the benefits list with no heading of its own ("… paid time off … Work with
      // route drivers to convert new sales opportunities; … 3+ years business to business sales experience preferred")
      if (current === 'benefits' && !BENEFITS_RE.test(s) && !PAY_SENTENCE_RE.test(s)) {
        const first = (s.split(/\s/)[0] || '').toLowerCase();
        if (STRONG_CUE_RE.test(s) || /\b(?:skills|knowledge\s+of)\b/i.test(s)) { push({ kind: PREFERRED_CUE_RE.test(levelText(s)) && !/\b(?:required|must)\b/i.test(s) ? 'preferred' : 'requirements', sentence: s, explicit: false }); continue; }
        if (/^[A-Z][a-z]+\s/.test(s) && (DUTY_STARTERS.has(first) || DUTY_STARTERS.has(first.replace(/s$/, ''))) && s.split(/\s+/).length >= 4) { push({ kind: 'responsibilities', sentence: s, explicit: false }); continue; }
      }
      push({ kind: current, sentence: s, explicit: true }); continue;
    }
    // no heading yet (or inside an About/culture block): classify the sentence on its own
    let kind = 'about';
    if (BENEFITS_RE.test(s)) kind = 'benefits';
    else if (PHYSICAL_RE.test(s) && REQUIREMENT_CUE_RE.test(s)) kind = 'physical';
    else if (SCHEDULE_CUE_RE.test(s) && /\b(?:must|required|able|available|availability|willing|including|flexible|open)\b/i.test(s)) kind = 'schedule';
    else if (CULTURE_RE.test(s) && !REQUIREMENT_CUE_RE.test(s)) kind = 'culture';
    // (a level inside parentheses — "(high-voltage experience preferred)" — sets the level of what is inside them only)
    else if (!/^(?:familiarity|exposure)\b/i.test(s) && PREFERRED_CUE_RE.test(levelText(s).replace(/\((?!\s*(?:strongly\s+)?(?:preferred|a\s+plus|desired|nice\s+to\s+have|optional|bonus)\s*\))[^()]{0,120}\)/g, ' ')) && !/\b(?:required|must)\b/i.test(s)) kind = 'preferred';
    else if (REQUIREMENT_CUE_RE.test(s)) kind = 'requirements';
    else if (RESPONSIBILITY_CUE_RE.test(s) || /\byou(?:'ll| will)\b/i.test(s) || (/^[A-Z][a-z]+s?\s/.test(s) && (DUTY_STARTERS.has(s.split(/\s/)[0].toLowerCase()) || DUTY_STARTERS.has(s.split(/\s/)[0].toLowerCase().replace(/s$/, ''))) && s.split(/\s+/).length >= 4)) kind = 'responsibilities';
    push({ kind, sentence: s, explicit: false });
  }
  // A posting with real Requirements/Responsibilities sections: a sentence we only GUESSED as a
  // requirement (company blurb with "needs" in it) is context unless it carries a strong cue.
  // R5: a list is decided by the LIST, not its heading — when most bullets of a run read as what the employee RECEIVES
  // ("Structured onboarding and training from experienced clinical staff", "Transparent paths for advancement", "Tuition
  // savings…"), the whole run is benefits, whatever heading it sits under
  const GIVEN_KINDS = new Set(['benefits', 'culture']);
  for (let i = 0; i < out.length;) {
    if (out[i].origin !== 'bullet' || !(REQUIREMENT_KINDS.has(out[i].kind) || GIVEN_KINDS.has(out[i].kind))) { i++; continue; }
    let j = i;
    while (j < out.length && out[j].origin === 'bullet' && out[j].block === out[i].block && (REQUIREMENT_KINDS.has(out[j].kind) || GIVEN_KINDS.has(out[j].kind))) j++;
    const run = out.slice(i, j);
    const asks = run.filter((r) => REQUIREMENT_KINDS.has(r.kind));
    if (run.length >= 3 && asks.length && run.filter((r) => GIVEN_KINDS.has(r.kind) || receivable(r.sentence)).length >= Math.ceil(run.length * 0.6)) for (const r of asks) if (receivable(r.sentence) || !ASK_RE.test(r.sentence)) { r.kind = 'benefits'; r.explicit = false; }
    i = j;
  }
  for (const r of out) delete r.block;
  // R5: a "Label: value" line whose label names a requirement ("Minimum Degree Required: Bachelor's Degree…", "Education:",
  // "Experience Required:", "Licence/Certification:", "Clearance:") is a requirement wherever it sits
  for (const r of out) if (REQ_LABEL_RE.test(r.sentence) && r.kind !== 'eeo') { r.kind = 'requirements'; r.explicit = true; }
  if (out.some((r) => r.explicit && (r.kind === 'requirements' || r.kind === 'responsibilities'))) {
    for (const r of out) if (!r.explicit && (r.kind === 'requirements' || r.kind === 'responsibilities') && !STRONG_CUE_RE.test(r.sentence)) r.kind = 'about';
  }
  // R4 STRUCTURE FIRST: a list the posting gives with no heading the reader knows (three or more consecutive bullet or
  // single lines, most of them opening the way requirement items do — a duty verb, "N+ years", "Experience/Knowledge/
  // Ability…", a credential) is read as a list of duties / requirements, whatever block it sits in
  for (let a = 0; a < out.length;) {
    const unitish = (r) => r.origin === 'bullet' || r.origin === 'line' || r.origin === 'sentence';
    if (!listish(out[a]) || !unitish(out[a])) { a++; continue; }
    let b = a;
    while (b < out.length && listish(out[b]) && unitish(out[b]) && out[b].sentence.split(/\s+/).length <= 45) b++;
    const run = out.slice(a, b);
    const items = run.map((r) => itemOpening(r.sentence));
    if (run.length >= 3 && items.filter(Boolean).length >= 3) {
      run.forEach((r, k) => { if (items[k]) { r.kind = items[k] === 'duty' ? 'responsibilities' : 'requirements'; r.explicit = true; r.listed = true; } });
    }
    // a run of short noun phrases inside such a list ("Interdisciplinary care coordination", "Inpatient rehabilitation
    // protocols", …) is an unlabelled skills list
    for (let c = 0; c < run.length;) {
      let d = c;
      while (d < run.length && !items[d] && isSkillPhrase(run[d].sentence)) d++;
      if (d - c >= 3) for (let k = c; k < d; k++) { run[k].kind = 'requirements'; run[k].explicit = true; run[k].listed = true; run[k].skillItem = true; }
      c = Math.max(d, c + 1);
    }
    a = Math.max(b, a + 1);
  }
  // R6: the same unlabelled-skills reading under a real requirements / preferred heading ("SSO, OIDC, and LDAP", "Data lakes
  // and high-availability services" in a "Relevant skills" list): three or more noun-phrase bullets in a row are skill items
  for (let c = 0; c < out.length;) {
    const ok = (r) => r.explicit && (r.kind === 'requirements' || r.kind === 'preferred') && r.origin === 'bullet' && isSkillPhrase(r.sentence);
    if (!ok(out[c])) { c++; continue; }
    let d = c;
    while (d < out.length && ok(out[d]) && out[d].kind === out[c].kind) d++;
    if (d - c >= 3) for (let k = c; k < d; k++) out[k].skillItem = true;
    c = Math.max(d, c + 1);
  }
  for (const r of out) delete r.held;
  return out;
}
// A sentence that states the pay ("Compensation … between 140 - 170k base with an up-to 20% annual bonus").
export const PAY_SENTENCE_RE = /(?:\$\s?\d|\b\d{2,3}(?:,\d{3}|\s?k)\b(?=[^.]{0,40}\b(?:base|salary|year|annual|per|range|compensation|pay|usd)\b)|\b(?:base\s+salary|salary\s+range|pay\s+range|hourly\s+(?:rate|wage|range)|compensation\s+(?:depends|is|range|offered|for\s+this)|annual\s+bonus|target\s+bonus)\b)/i;
const STRONG_CUE_RE = /\b(?:required?|must|years?\s+of|ability\s+to|able\s+to|proficien|experience\s+(?:in|with)|preferred|a\s+plus|degree|licen[sc]e|certif)\b/i;

// The part of a sentence that sets its level: a trailing ", ideally in a contact center" or
// ", preferably …" qualifies an extra, not the requirement it follows ("2+ years of phone and email
// customer support, ideally in a contact center" is required).
export function levelText(s) {
  // "… preferred, but not required" is preferred: a "required" that is negated sets no level
  // "5 - 7 years of accounting and/or audit experience, with a focus on church or ministry organizations preferred": the
  // level is the trailing qualifier's, not the line's (G2 seam, idx 412)
  return String(s || '').replace(/,\s+(?:with|ideally\s+with)\s+(?:a\s+|an\s+)?(?:focus|emphasis|background|experience|exposure)\s+(?:on|in|to|with)\s+[^.;]{2,120}?\s+(?:is\s+)?(?:strongly\s+)?preferred\b/gi, ' ').replace(/[,;(]\s*(?:ideally|preferably|ideal\s+if)\b[^.;)]*\)?/gi, ' ').replace(/\b(?:but\s+)?not\s+(?:strictly\s+)?required\b/gi, ' ');
}
const ROLE_PITCH_RE = /^(?:(?:with|in)\s+a\s+(?:strong\s+focus|dynamic\s+role|fast-paced\s+environment)|the\s+opportunity\b|a\s+unique\b|we\s+are\b|reporting\s+to\s+the\b|personal\s+(?:&|and)\s+professional\s+growth|as\s+an?\s+[A-Z][\w ,&/-]{2,60}\s+at\s+[A-Z]|(?:[A-Z][\w&'’.*-]*\s+){1,5}(?:is|are)\s+(?:a|an|the|one\s+of)\s|the\s+[A-Z][\w,]*(?:\s+[A-Z][\w,]*){0,4}\s+will\s+have\s+flexibility|at\s+[A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3},\s+(?:we|you|our)\b|we\s+(?:work|move|need|believe|value|offer|are\s+(?:a|an|the|proud))\b|as\s+a\s+member\s+of\b|additionally,\s+you\s+will\s+collaborate|alongside\s+\w+|(?:this|our)\s+(?:includes|approach|culture|commitment|benefits?\s+(?:include|package))\b|some\s+roles\s+may|as\s+(?:we|our|the\s+company|a\s+company)\b|we(?:'re|’re|\s+are)\s+(?:seeking|looking|hiring|expanding|growing|building|excited)|this\s+(?:role|position|opportunity|job)\s+(?:is|will|offers|sits|reports|plays)|this\s+is\s+(?:a|an|the|our)\b|the\s+(?:position|role)\s+(?:will|is|offers)|at\s+its\s+heart|you(?:'ll|’ll|\s+will)\s+(?:start|join|play|be\s+part|be\s+joining|report)|in\s+this\s+role,?\s+you(?:'ll|’ll|\s+will)\s+(?:join|be\s+part)|join\s+(?:us|our|a)\b|our\s+(?:team|company|mission)\b)/i;
// a list item a lead-in owns: short, no sentence of its own, not itself a requirement with a cue ("National Council on
// Interpreting in Health Care (NCIHC)", "Python", "Kafka or Kinesis")
function isListItem(s) {
  const t = String(s || '').trim();
  const w = t.split(/\s+/).length;
  return w <= 10 && !/[.!?]\s+\S/.test(t) && !/\b(?:must|required|years?\s+of|ability\s+to|experience\s+(?:in|with))\b/i.test(t) && !/^(?:you|we|our|the\s+candidate)\b/i.test(t);
}
export const REQUIREMENT_KINDS = new Set(['requirements', 'responsibilities', 'preferred', 'physical', 'schedule']);
const REQ_LABEL_RE = /^(?:(?:minimum|required|preferred)\s+)?(?:degree|education(?:al)?(?:\s+(?:level|requirements?))?|experience|licen[sc]e(?:\s*\/\s*certification)?|licensure|certifications?|clearance|security\s+clearance)(?:\s+(?:required|requirements?|level|type))?\s*:\s+\S/i;
const PREF_LEAD_RE = /\b(?:(?:don['’]t|do\s+not)\s+need\s+(?:to\s+(?:check|tick|meet)\s+every|all\s+of)|the\s+more\s+of\s+these|not\s+all\s+(?:are\s+)?required|bonus|a\s+plus|pluses|nice[- ]to[- ]haves?|not\s+(?:mandatory|required)|preferred|desired|desirable|ideally|extra\s+credit)\b/i;
const GIVE_RE = /\b(?:onboarding|(?:paid|ongoing|on-the-job|hands-on|structured|comprehensive)\s+training|training\s+(?:workshops?|programs?|provided|from)|continuing\s+education|workshops?|conferences?|paths?\s+for\s+(?:advancement|growth|development)|advancement|tuition|mentorship\s+(?:from|program)|support\s+from|supportive|workplace\s+that|environment\s+(?:that|where)|culture\s+(?:that|of)|partnerships?\s+and|savings|discounts?|wellness|stipends?|reimbursements?|allowances?|time\s+off|holidays?|insurance|retirement)\b/i;
const ASK_RE = /\b(?:experience|ability|able\s+to|knowledge|skills?|degree|diploma|licen[sc]e|certif\w*|must|required|years?|proficien\w*|familiar\w*)\b/i;
/** Does a list item read as something the employee receives (R5)? */
function receivable(sentence) {
  const t = String(sentence || '');
  if (ASK_RE.test(t) && !/\b(?:training|education|tuition)\b/i.test(t)) return false;
  if (DUTY_STARTERS.has((t.split(/\s/)[0] || '').toLowerCase())) return false;
  return GIVE_RE.test(t) || BENEFITS_RE.test(t);
}
/** The sentences a requirement may be read from, with their importance. */
export function requirementSentences(text, { jobTitle = '' } = {}) {
  // A semicolon separates requirements: "4+ years of HVAC service experience; commercial RTU and
  // chiller experience strongly preferred" is a REQUIRED figure and a preferred extra, not one
  // preferred sentence.
  // A sentence that rules a requirement out ("… also need PALS; this telemetry role does not") or
  // belongs to another posting is never a requirement — judged on the WHOLE sentence, before the split.
  const rows = sectionPosting(text, { jobTitle }).filter((r) => !RULED_OUT_RE.test(r.sentence)).flatMap((r) => (REQUIREMENT_KINDS.has(r.kind) && /;\s/.test(r.sentence)
    ? r.sentence.split(/;\s+/).filter((x) => x.trim().length >= 3).map((x, i, all) => ({ ...r, sentence: x.trim(), origin: all.length > 1 ? 'runon' : r.origin, ...(all.length > 1 ? { whole: r.sentence, part: i } : {}) }))
    : [r]));
  const out = [];
  let prefLead = null;
  for (const r0 of rows) {
    const r = { ...r0, sentence: String(r0.sentence || '').replace(/^[\s:;,–—-]+/, '').replace(/^(?:AND|OR)\s+[A-Z][A-Z ]{2,30}:\s*/, '').trim() };
    if (!REQUIREMENT_KINDS.has(r.kind) || !r.sentence) continue;
    // (a lead-in that says the items after it are a bonus is read before anything can drop it — "You don't need to check every
    // box, but the more of these you bring, the better:")
    if (prefLead && (prefLead.kind !== r.kind || /:\s*$/.test(r.sentence))) prefLead = null;
    if (/:\s*$/.test(r.sentence) && r.sentence.split(/\s+/).length <= 25 && PREF_LEAD_RE.test(r.sentence)) prefLead = { kind: r.kind };
    // "3+ years … manufacturing environment" / "OR bachelor's degree in …": one requirement with two ways to meet it
    // (SpaceX — the OR was split into two gates, director 2026-11-10)
    const prev = out[out.length - 1];
    if (prev && prev.kind === r.kind && (/^or\b/i.test(r.sentence) || /\bor$/i.test(prev.sentence))) {
      // (the posting's own words and punctuation are kept — "…experience; OR 5+ years…" reads the same however it was pasted)
      prev.sentence = `${prev.sentence.replace(/[.,]?\s*$/, '')}${prev.whole && !/;\s*$/.test(prev.sentence) && /;\s*OR\b/i.test(prev.whole) ? ';' : ''} ${r.sentence}`;
      continue;
    }
    // a sentence about the role or the company ("As we expand into new verticals…", "We're seeking an enthusiastic…",
    // "This role is the tip of the spear…", "The position will require extensive collaboration") states no requirement
    if (ROLE_PITCH_RE.test(r.sentence) && !STRONG_CUE_RE.test(r.sentence.replace(/\bwill\s+require\b/i, ''))) continue;
    // boilerplate inside a requirement block, or a sentence that says what the job is not, states no requirement
    if (isBoilerplate(r.sentence) || (NEGATED_SENTENCE_RE.test(r.sentence) && !/\b(?:required|must)\b/i.test(r.sentence))) continue;
    // R4: a lead-in that ends in a colon ("…established by:", "Technical expertise in one or more of the following languages:")
    // OWNS the short items after it — they are examples inside ONE statement, never separate requirements
    // (R5: "Label: text" sub-items whose text is not an imperative duty — "Control Mapping: Automatically mapping …",
    // "Automated Walkthroughs: Using AI to summarize …" — are items of the lead-in's list too; "Library Management: Develop
    // and maintain …" starts the next duty)
    const sub = r.sentence.match(/^((?:[A-Z][\w&/'’-]*\s?){1,5}):\s+(\S+)/);
    if (prev && prev.kind === r.kind && prev.owns && sub && r.sentence.split(/\s+/).length <= 30 && !DUTY_STARTERS.has(sub[2].toLowerCase())) {
      prev.sentence = `${prev.sentence.replace(/[,;.]\s*$/, '')}${prev.items ? '; ' : ' '}${r.sentence.replace(/[.;]\s*$/, '')}`;
      prev.items = (prev.items || 0) + 1;
      continue;
    }
    if (prev && prev.kind === r.kind && prev.owns && isListItem(r.sentence)) {
      prev.sentence = `${prev.sentence.replace(/[,;]\s*$/, '')}${prev.items ? ', ' : ' '}${r.sentence.replace(/[.;]\s*$/, '')}`;
      prev.items = (prev.items || 0) + 1;
      continue;
    }
    const lt = levelText(r.sentence).replace(/\((?!\s*(?:strongly\s+)?(?:preferred|a\s+plus|desired|nice\s+to\s+have|optional|bonus)\s*\))[^()]{0,120}\)/g, ' ');
    // a lead-in that says the items after it are a bonus ("It will be considered a bonus if (not mandatory):", "Nice to
    // have:") makes them preferred until the next lead-in or another kind (flat text, where it is no heading of its own)
    const pref = r.kind === 'preferred' || !!prefLead || (PREFERRED_CUE_RE.test(lt) && !/\b(?:required|must)\b/i.test(lt));
    const importance = pref ? 'preferred' : r.kind === 'responsibilities' ? 'responsibility' : 'required';
    const owns = /(?::|\b(?:such\s+as|including|include|includes|the\s+following|one\s+or\s+more\s+of(?:\s+the\s+following)?|any\s+of\s+the\s+following)\s*:?)\s*$/i.test(r.sentence);
    out.push({ sentence: owns ? r.sentence.replace(/\s*:\s*$/, ':') : r.sentence, kind: prefLead && !/:\s*$/.test(r.sentence) && r.kind === 'requirements' ? 'preferred' : r.kind, importance, explicit: r.explicit, origin: r.origin || 'line', ...(owns ? { owns: true } : {}), ...(r.whole ? { whole: r.whole, part: r.part } : {}), ...(r.skillItem ? { skillItem: true } : {}), ...(r.list != null ? { list: r.list } : {}) });
  }
  for (const r of out) { delete r.owns; delete r.items; }
  return out;
}

// ── structured constraints ──
const DEGREE_RE = /\b(high\s+school(?:\s+diploma)?|ged|associate'?s?\s+(?:degree|of\s+(?:arts|science|applied\s+science))|a\.a\.|a\.s\.|bachelor'?s?(?:\s+(?:degree|of\s+(?:arts|science)))?|b\.a\.|b\.s\.|master'?s?\s+(?:degree|of\s+\w+)|master['’]?s(?=\s*(?:or|\/)\s*(?:a\s+)?(?:ph\.?d|doctor))|bachelor['’]?s(?=\s*(?:or|\/)\s*(?:a\s+)?master)|m\.a\.|m\.s\.|mba|ph\.?d|doctorate)\b/gi;
const GPA_RE = /\b(\d(?:\.\d{1,2})?)\s*(?:\+|or\s+(?:higher|above|better))?\s*gpa\b|\bgpa\s*(?:of|minimum|at\s+least)?\s*(\d(?:\.\d{1,2})?)/i;
// "4+ years of HVAC service experience", "2–4 years in social media", "2+ years of phone and email customer
// support": the figure, and (in extractConstraints) the field it is counted in.
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
/** "Four or more years" → "4+ years", "two-plus years" → "2+ years", "five years' experience" → "5 years experience". */
export function wordYears(s) {
  return String(s || '')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)(\s*\(\d{1,2}\))?(\s*-\s*plus|\s+plus|\s+or\s+more|\s*\+)?(?=\s+(?:full\s+)?(?:years?|yrs?)\b)/gi, (m0, w, paren, more) => (paren ? m0 : `${NUM_WORDS[w.toLowerCase()]}${more ? '+' : ''}`))
    .replace(/\b(\d{1,2}\+?)\s*(?:-\s*plus|\s+plus|\s+or\s+more)(?=\s+(?:years?|yrs?)\b)/gi, '$1+')
    .replace(/\b(years?|yrs?)['’]/gi, '$1');
}
const YEARS_TAIL_RE = /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*\()?(\d{1,2})\)?\s*(?:\+|\s*(?:-|\u2013|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b(?!\s+(?:old|of\s+age|ago|is|are|was|has|have))(?:\s+(of|in|as|[a-z]{2,20}ing))?\s+([^.;:()]{2,90})/gi;
const YEARS_RE = /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*\()?(\d{1,2})\)?\s*(?:\+|\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:\+\s*)?(?:years?|yrs?)(?:\s+of)?(?:\s+(?:[a-z-]+\s+){0,5}?)?(?:experience|exp\b|background|in\s+a)/i;
const MGMT_RE = /\b(?:(?<!\b(?:project|product|program|account|case|change|data|risk|vendor|inventory|time|property|campaign|content|category|channel|community|event|revenue|records?|database|quality|configuration|release|incident|asset|portfolio|brand|media|marketing|pain|wound|medication|care|client|customer|relationship|contract|knowledge|supply\s+chain|fleet|facilities|document|information|performance|crisis|stress|weight|disease)\s)management\s+experience|manag(?:e|ing|ement)\s+(?:of\s+)?(?:a\s+)?(?:large\s+)?(?:team|teams|staff|people|department|call\s+center|operations)|supervis(?:e|ing|ory)|(?<!(?:minimal|little|no|limited|close|without|direct|under|general|constant)\s)supervision(?!\s+(?:of|from)\b)|direct\s+reports|people\s+management|team\s+management|leading\s+(?:a\s+)?team|lead\s+(?:a\s+)?team\s+of|customer\s+service\s+management)\b/i;
const CERT_RE = /\b((?:medical\s+assistant|pharmacy\s+technician|surgical\s+technologist|phlebotomy|phlebotomist|dental\s+assistant|patient\s+care\s+technician|nursing\s+assistant|home\s+health\s+aide|radiologic\s+technologist|respiratory\s+therapist|physical\s+therapist|occupational\s+therapist|social\s+work(?:er)?|counselor|massage\s+therapist)\s+(?:certificate|certification|license|licensure|registration)|(?:registered\s+nurse|rn|lpn|lvn|nursing)\s+licen[sc](?:e|ure)|licensed\s+(?:as\s+an?\s+)?(?:registered\s+nurse|rn|lpn|lvn|practical\s+nurse)|(?:journeyman|master)(?:\s+or\s+(?:journeyman|master))?\s+(?:electrical|electrician'?s?|plumbing|plumber'?s?|hvac|mechanical)?\s*licen[sc]e|electrical\s+(?:contractor\s+)?licen[sc]e|servsafe\s+(?:food\s+handler|manager)(?:\s+card|\s+certification)?|food\s+handler'?s?\s+(?:card|permit|certificat\w+)|servsafe|tips\s+certif\w+|alcohol\s+(?:server|seller)\s+(?:training|permit|certif\w+)|title\s+4|forklift\s+(?:certif\w+|licen[sc]e[ds]?)|osha\s+(?:10|30)|cpr(?:\s*\/\s*first\s+aid)?|first\s+aid|guard\s+card|tabc|bls\b|cdl(?:\s+class\s+[abc])?|class\s+[abc]\s+(?:cdl|licen[sc]e)|rn\s+licen[sc]e|cna\b|emt\b|notary|real\s+estate\s+licen[sc]e|cosmetology\s+licen[sc]e|security\s+licen[sc]e|driver'?s?\s+licen[sc]e|acls|pals|nihss|epa\s+(?:section\s+)?608(?:\s+universal)?|nate|cpa|(?:[A-Z][a-z]+\s+){0,2}teaching\s+licen[sc](?:e|ure)|teacher\s+certification)\b/gi;
const ACR_CERT_RE = /\b([A-Z][A-Z0-9]{1,6}(?:-[A-Z0-9]{1,4})?)\s+(?:\([^)]{3,70}\)\s+)?(?:[Cc]ertification|[Cc]ertified|[Ll]icen[sc]e|[Cc]redential)\b/g;
// acronyms the list above already reads, or that are not credentials
const CERT_RE_NAMES = /^(?:I|II|III|IV|V|TM|NSF|UL|CE|FCC|ISO|PTCRB|GCF|SOC|PCI|FDA|DOT|CPR|BLS|ACLS|PALS|CDL|RN|CNA|EMT|CPA|OSHA|EPA|NATE|TABC|US|USA|AHA|STATE|ANY|ALL|THE|IT|HR|AI|SAP)$/;
export const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
export const STATE_ABBR = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const STATE_NAME_RE = new RegExp(`\\b(${US_STATES.join('|')})\\b`);
/** The state a licence in the sentence names: right before it ("Texas Journeyman …"), or "licensed in <State>". */
// Title-Case words before a credential noun ("California Residential Electrician Certification"); each word is letters
// then one space, so the repetition is disjoint and linear
const NAMED_CRED_RE = /\b((?:[A-Z][A-Za-z'’.-]{0,30} ){1,6})(Certification|Certificate|License|Licence|Endorsement|Permit|Registration)\b/g;
const PAREN_ACR_CRED_RE = /\b((?:[A-Z][a-z]{1,30} ){1,5})\(([A-Z][A-Z0-9]{1,6})\) (?:[Cc]ertification|[Cc]ertificate|[Ll]icen[sc]e|[Rr]egistration)\b/g;
const STATE_LICENCE_RE = new RegExp(`\\blicen[sc]e (?:to practice )?in (?:the state of )?(${US_STATES.join('|')}|${Object.keys(STATE_ABBR).join('|')})\\b`);
const CRED_FILLER_RE = /^(?:(?:Current|Valid|Active|Must|Hold|Have|Possess|A|An|The|Unrestricted|Required|Proof|Of|And|Or|With)\s+)+/;
/** Credentials named in words, by acronym in parentheses, or by state alone (R4, G4 item 3). */
function namedCredentials(sentence) {
  const s = String(sentence || '').slice(0, 600).replace(/\s+/g, ' ');
  const found = [];
  for (const m of s.matchAll(PAREN_ACR_CRED_RE)) {
    const name = m[1].replace(CRED_FILLER_RE, '').trim();
    if (!name) continue;
    found.push({ label: `${name} (${m[2]}) ${/licen/i.test(m[0]) ? 'license' : 'certification'}`, value: `${name} (${m[2]})`.toLowerCase(), state: licenceState(s, m.index, m[0]) });
  }
  for (const m of s.matchAll(NAMED_CRED_RE)) {
    const name = m[1].replace(CRED_FILLER_RE, '').trim();
    // a name of its own: at least one word that is not a state, a generic word or the job title words
    const words = name.split(/\s+/).filter((w) => !US_STATES.includes(w) && !/^(?:State|Professional|Industry|Relevant|Applicable|Appropriate|Required|Necessary|Equivalent|Similar|Other|Any|All|Driver['’]?s?|Driving|Drivers)$/.test(w));
    if (!words.length || found.some((f) => f.value.startsWith(name.toLowerCase()))) continue;
    const state = licenceState(s, m.index, m[0]) || (US_STATES.find((st) => name.startsWith(st)) || null);
    found.push({ label: `${name} ${m[2]}`, value: `${name} ${m[2]}`.toLowerCase(), state });
  }
  // a CDL endorsement ("Class A CDL with hazmat and tanker endorsements") is its own credential requirement
  const en = s.match(/\b((?:hazmat|hazardous materials|tanker|passenger|school bus|doubles(?:\/triples)?|air brakes?|[HNPSTX])(?:(?:, | and | & |\/)(?:hazmat|hazardous materials|tanker|passenger|school bus|doubles(?:\/triples)?|air brakes?|[HNPSTX])){0,4}) endorsements?\b/i);
  if (en) found.push({ label: `${en[1]} endorsement${/ and | & |, /.test(en[1]) ? 's' : ''}`, value: `${en[1]} endorsement`.toLowerCase(), state: null });
  if (!found.length) {
    const st = s.match(STATE_LICENCE_RE);
    if (st) { const state = STATE_ABBR[st[1]] || st[1]; found.push({ label: `${state} license`, value: `${state} license`.toLowerCase(), state }); }
  }
  return found;
}
function licenceState(sentence, at, matched) {
  if (!/licen[sc]|\brn\b|registered\s+nurse|certificate|registration/i.test(matched + ' ' + sentence.slice(at, at + matched.length + 20))) return null;
  const after = sentence.slice(at + matched.length, at + matched.length + 40).match(new RegExp(`^\\s+in\\s+(?:the\\s+state\\s+of\\s+)?(${US_STATES.join('|')})\\b`));
  if (after) return after[1];
  const before = sentence.slice(Math.max(0, at - 40), at);
  const m = before.match(new RegExp(`\\b(${US_STATES.join('|')})\\s*(?:state\\s+)?$`));
  if (m) return m[1];
  const inState = sentence.match(new RegExp(`\\blicen[sc](?:ed|e|ure)\\s+(?:to\\s+practice\\s+)?in\\s+(?:the\\s+state\\s+of\\s+)?(${US_STATES.join('|')})\\b`));
  if (inState) return inState[1];
  const first = matched.match(STATE_NAME_RE);
  return first ? first[1] : null;
}
const WAIVED_RE = /\bno\s+(?:prior\s+|previous\s+)?(?:[a-z][a-z-]*\s+){0,3}(?:experience|degree|license|certification)\s+(?:is\s+|are\s+)?(?:required|needed|necessary)\b|\bno\s+(?:overnight\s+shifts|overnights|weekends|holidays|nights|pagers|on-call|call|nights\s+or\s+weekends)\b/gi;
// a sentence that waives or promises ("No experience required!", "No nights or weekends"): what the posting offers
export const WAIVER_SENTENCE_RE = new RegExp(WAIVED_RE.source, 'i');
const AGE_RE = /\b(?:(?:must\s+be\s+|minimum\s+age\s+(?:of\s+)?|at\s+least\s+)(\d{2})\s*(?:\+|years?(?:\s+of\s+age|\s+old)?|or\s+older)|(\d{2})\+\s*(?:years?\s+of\s+age|years\s+old|or\s+older))/i;
const LANGUAGES = 'english|spanish|french|mandarin|cantonese|chinese|vietnamese|tagalog|korean|arabic|portuguese|german|russian|hindi|japanese|italian|polish|somali|amharic|haitian\\s+creole|asl|american\\s+sign\\s+language';
const LANG_RE = new RegExp(`\\b(?:bilingual(?:\\s+(?:in\\s+)?(${LANGUAGES})(?:\\s*\\/\\s*(${LANGUAGES}))?)?|(?:fluent|fluency)\\s+(?:in\\s+)?(${LANGUAGES})|(${LANGUAGES})\\s*\\/\\s*(${LANGUAGES})|(${LANGUAGES})[- ]speaking|(${LANGUAGES})\\s+fluency)\\b`, 'i');
const BACKGROUND_RE = /\b((?:doj\s*(?:\/|and)?\s*fbi\s+)?live\s*scan(?:\s+criminal\s+(?:background\s+)?(?:check|clearance))?|background\s+check|drug\s+(?:test|screen(?:ing)?)|mvr|motor\s+vehicle\s+record|clean\s+driving\s+record|fingerprint\w*)\b/i;
export const SCHEDULE_CUE_RE = /\b(?:part[- ]time|full[- ]time|seasonal|temporary|weekends?|nights?|evenings?|overnight|early\s+mornings?|mornings?|holidays?|blackout\s+(?:period|dates?)|hours?\s+per\s+week|hours?\s*\/\s*week|shift\s+minimum|minimum\s+(?:of\s+)?\d+[- ]hour\s+shifts?|\d+[- ]hour\s+shifts?|open\s+availability|flexible\s+(?:hours|schedule|availability)|must\s+be\s+available|availability\s+to\s+work|rotating\s+shifts?|on[- ]call|peak\s+(?:season|periods?)|black\s+friday|thanksgiving)\b/i;
const PHYSICAL_RE = /\b(?:lift(?:ing)?[^.;]{0,60}?(?:up\s+to\s+|at\s+least\s+)?(\d{1,3})\s*(?:lbs?\.?|pounds?)|stand(?:ing)?\s+(?:for\s+)?(?:extended|long|prolonged|an\s+entire|the\s+entire|a\s+full|full)\s+(?:periods?|shifts?|hours)|stand\s+and\s+move|on\s+(?:your|their)\s+feet|climb(?:ing)?\s+(?:a\s+)?ladders?|bend(?:ing)?|stoop(?:ing)?|kneel(?:ing)?|crouch(?:ing)?|reach(?:ing)?\s+overhead|repetitive\s+motions?|walk(?:ing)?\s+(?:for\s+)?(?:extended|long)|restrictive\s+spaces|noise\s+levels?|outdoor\s+(?:work|conditions)|all\s+weather|push(?:ing)?\s+and\s+pull(?:ing)?)\b/i;

// The field a years figure is counted in: "4+ years of HVAC service experience" → "HVAC service"; "2–4
// years in social media, with …" → "social media"; "3+ years of experience" → null (no field).
const FIELD_STOP_RE = /\s*(?:\b(?:experience|exp|background|including|ideally|preferably|with|at\s+least|in\s+an?\b|in\s+the\b|within|where|who|that|in\s+production|in\s+a\s+high|and\s+(?:a|an|the)\b|or\s+(?:a|an|the|equivalent)\b|or\s+(?=(?:a\s+|an\s+)?(?:bachelor|associate|master|high\s+school|ged|degree|\d))|required|preferred|is|are)\b|,|—|–|\.(?=\s|$)|;|$)/i;
const FIELD_LEAD_RE = /^(?:(?:professional|relevant|related|hands-on|proven|progressive(?:ly)?|direct|recent|paid|full-time|total|overall|prior|previous|work|working|industry|practical|demonstrated|successful|combined)\s+)+/i;
function yearsField(fromNumber) {
  const m = fromNumber.match(/^(?:\w+\s*\()?\d{1,2}\)?\s*(?:\+|\s*(?:-|\u2013|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b\s*(?:of\s+|in\s+(?!an?\b|the\b)|as\s+(?:an?\s+)?|doing\s+|working\s+(?:in|as|with)\s+|building\s+(?:and\s+\w+\s+)?|running\s+|managing\s+|leading\s+|selling\s+|supporting\s+|operating\s+|teaching\s+)?(.*)$/i);
  if (!m) return null;
  // "of professional experience in a hands-on manufacturing environment": the qualifier before "experience" is not the field
  const tail = m[1].replace(FIELD_LEAD_RE, '');
  // a list of fields offered as a choice: "… in email marketing operations, CRM administration, or marketing operations"
  // (read by position, not one backtracking regex — CodeQL flagged the nested quantifiers as ReDoS)
  const head = tail.replace(/^experience\s+(?:in|with|as|doing)\s+/i, '');
  const span = (head.match(/^[^.;()]*/) || [''])[0];
  const at = span.search(/,\s*or\s+/i);
  if (at >= 3) {
    const rest = span.slice(at).replace(/^,\s*or\s+/i, '');
    const cut = rest.search(/\s*(?:\bexperience\b|,|$)/i);
    const last = rest.slice(0, cut).trim();
    const list = last ? `${span.slice(0, at)}, or ${last}` : '';
    if (list && list.split(/\s+/).length <= 12) return list.replace(FIELD_LEAD_RE, '').trim();
  }
  const stop = tail.search(FIELD_STOP_RE);
  let field = (stop >= 0 ? tail.slice(0, stop) : tail).replace(FIELD_LEAD_RE, '').replace(/[\s,]+$/, '').trim();
  if (/^experience\b/i.test(tail)) {
    // "N years of experience in/with <field>"
    const after = tail.match(/^experience\s+(?:in|with|as|doing)\s+(?:an?\s+|the\s+)?(.*)$/i);
    field = after ? after[1].slice(0, Math.max(0, after[1].search(FIELD_STOP_RE)) || after[1].length).replace(FIELD_LEAD_RE, '').trim() : '';
  }
  if (!field || field.split(/\s+/).length > 7 || /^\d/.test(field) || /^(?:of|in|the|a|an|experience|age|old)$/i.test(field)) return null;
  return field;
}
// The posting's own words for a years figure, field included: "4+ years of HVAC service experience",
// "2+ years in social media", "3+ years managing brand social media accounts", "3+ years of experience".
export function yearsLabel(min, fromNumber, field) {
  const yrs = min === 1 ? 'year' : 'years';
  if (!field) return `${min}+ ${yrs} of experience`;
  // a place, not a subject: "3+ years in a manufacturing environment", never "3+ years of manufacturing environment"
  // "2+ years of working as an insurance adjuster" → "2+ years as an insurance adjuster", never "years of as"
  if (/^(?:as|in|with|at)\s/i.test(field)) return `${min}+ ${yrs} ${field}`;
  if (/\b(?:environment|setting|facility|center|centre|plant|hospital|clinic|fab|office|organization|company|startup)s?$/i.test(field)) return `${min}+ ${yrs} in a ${field}`;
  const m = String(fromNumber).match(/^(?:\w+\s*\()?\d{1,2}\)?\s*(?:\+|\s*(?:-|\u2013|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b\s*(of\s+experience\s+(?:in|with|as|doing)|of|in|as|doing|working|building|running|managing|leading|selling|supporting|operating|teaching)?\b/i);
  const conn = m && m[1] ? m[1].toLowerCase().replace(/\s+/g, ' ') : 'of';
  const esc = escapeRegExp(field);
  const expAfter = new RegExp(`${esc}\\s+(?:experience|background)\\b`, 'i').test(fromNumber);
  if (/^of experience/.test(conn)) return `${min}+ ${yrs} ${conn} ${field}`;
  if (conn === 'of') return `${min}+ ${yrs} of ${field}${expAfter ? ' experience' : ''}`;
  return `${min}+ ${yrs} ${conn} ${field}${expAfter ? ' experience' : ''}`;
}
// A sentence that rules a requirement OUT or belongs to another posting: "Pediatric unit nurses also
// need PALS; this telemetry role does not", "Our sister company … is also hiring CDL-A drivers — see
// their separate postings".
export const RULED_OUT_RE = /\b(?:this|the|our)\s+(?:[\w-]+\s+){0,2}(?:role|position|job|opening)\s+(?:does\s+not|doesn['’]t|will\s+not|won['’]t)\b|\b(?:is|are)\s+not\s+(?:required|needed|necessary)\b|\bnot\s+required\s+for\s+this\b|\bseparate\s+postings?\b|\bsister\s+(?:company|companies|brand|division)\b|\b(?:our|the)\s+\w+\s+division\s+also\s+hires\b|\b(?:is|are)\s+(?:a\s+)?(?:bonus|plus|nice[- ]to[- ]haves?)\s*,?\s*(?:but\s+)?not\s+(?:a\s+)?(?:requirements?|required)\b|\b(?:don['’]t|do\s+not)\s+(?:meet|check|have)\s+(?:every|all)\b|\bencourage(?:d)?\s+(?:you\s+)?to\s+apply\b/i;

function degreeRank(label) {
  const l = String(label || '').toLowerCase().replace(/\./g, '');
  if (/high school|ged|diploma/.test(l)) return 1;
  if (/associate|^a[as]$/.test(l)) return 2;
  if (/bachelor|^b[as]$/.test(l)) return 3;
  if (/master|^m[as]$|mba/.test(l)) return 4;
  if (/phd|doctorate/.test(l)) return 5;
  return 0;
}
export const DEGREE_LABEL = { 1: 'a high school diploma', 2: "an Associate's degree", 3: "a Bachelor's degree", 4: "a Master's degree", 5: 'a doctorate' };

function scheduleFacts(sentence, nextSentence = '') {
  const s = sentence.toLowerCase();
  const items = [];
  const m = (re, label) => { const x = s.match(re); if (x) items.push(label(x)); };
  m(/\b(part[- ]time|full[- ]time|seasonal|temporary)\b/, (x) => x[1].replace(/\s/g, '-'));
  m(/\b(early\s+mornings?|mornings?)\b/, () => 'early mornings');
  m(/\bevenings?\b/, () => 'evenings');
  m(/\bnights?\b|\bovernight\b/, () => 'nights');
  m(/\bweekends?\b/, () => 'weekends');
  m(/\bholidays?\b/, () => 'holidays');
  m(/\bopen\s+availability\b/, () => 'open availability');
  m(/\b(?:up\s+to\s+|minimum\s+(?:of\s+)?|at\s+least\s+)?(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*hours?\s*(?:per|\/|a)\s*week\b/, (x) => `${x[1]}${x[2] ? `–${x[2]}` : ''} hours per week`);
  m(/\b(\d{1,2})[- ]hour\s+(?:shift\s+)?minimum\b|\bminimum\s+(?:of\s+)?(\d{1,2})[- ]hour\s+shifts?\b|\b(\d{1,2})[- ]hour\s+shifts?\b|\bshift\s+minimum\s+of\s+(\d{1,2})\s+hours?\b/, (x) => `${x[1] || x[2] || x[3] || x[4]}-hour shift minimum`);
  const bo = s.match(/blackout\s+(?:period|dates?)[^.]*?(?:from\s+)?(?:the\s+week\s+of\s+)?([a-z]+(?:\s+\d{1,2}(?:st|nd|rd|th)?)?)\s+(?:through|to|until|-|–)\s+([a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)/);
  if (bo) items.push(`holiday blackout ${bo[1]} – ${bo[2]}`);
  else if (/blackout/.test(s)) {
    const from = s.match(/from\s+(?:the\s+week\s+of\s+)?(?:american\s+)?(thanksgiving|black\s+friday|[a-z]+\s+\d{1,2})/);
    const to = (s + ' ' + (nextSentence || '')).toLowerCase().match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/);
    items.push(`holiday blackout${from ? ` from ${from[1].replace(/\b[a-z]/g, (ch) => ch.toUpperCase())}` : ''}${to ? ` through ${to[1].charAt(0).toUpperCase()}${to[1].slice(1)} ${to[2]}` : ' period'}`);
  }
  m(/\brotating\s+shifts?\b/, () => 'rotating shifts');
  m(/\bon[- ]call\b/, () => 'on-call');
  return [...new Set(items)];
}

/**
 * Structured constraints from the requirement sentences of a posting:
 *   { kind: 'years'|'degree'|'certification'|'management'|'age'|'language'|'schedule'|'physical'|'background',
 *     label, value, gate (hard knock-out when unmet), importance, sentence, alternatives? }
 * A sentence like "Bachelor's and 6+ years … or Associate's and 8+ years" becomes ONE
 * education_experience constraint with alternatives (met when ANY alternative is met).
 */
// "Staff" is a senior level only in tech titles (Staff Engineer); a Staff Accountant / Staff Nurse / Staff Attorney is
// entry-level (judge optimize #4: Tasha capped at 29 on Sargent & Lundy's Staff Accountant).
export const STAFF_TECH_RE = /\bstaff\s+(?:software\s+|data\s+|machine\s+learning\s+|ml\s+|security\s+|platform\s+|backend\s+|back-end\s+|frontend\s+|front-end\s+|full[- ]stack\s+|infrastructure\s+|site\s+reliability\s+|product\s+|ux\s+|research\s+)*(?:engineer|scientist|designer|product\s+manager|architect|developer|researcher|analyst)\b/i;
export function extractConstraints(text, { jobTitle = '' } = {}) {
  const rows = requirementSentences(text);
  const out = [];
  const seen = new Set();
  const push = (c) => { const key = `${c.kind}:${String(c.value ?? c.label).toLowerCase()}`; if (seen.has(key)) return; seen.add(key); out.push(c); };
  for (const r of rows) {
    const s = r.sentence;
    if (RULED_OUT_RE.test(s)) continue;
    const importance = r.importance === 'preferred' ? 'preferred' : 'required';
    const gateable = importance === 'required' && (r.kind === 'requirements' || r.explicit === false || /\b(?:required|must)\b/i.test(s));
    // degree + years (with "or" alternatives)
    const degrees = [...s.matchAll(DEGREE_RE)].map((m) => ({ label: m[0], rank: degreeRank(m[0]), index: m.index }));
    // years written as words read as figures ("Four or more years retail experience", "two-plus years", "five years'
    // experience" — G3); the figures are read from this copy, the sentence itself is kept
    const sy = wordYears(s);
    const years = [...sy.matchAll(new RegExp(YEARS_RE.source, 'gi'))].map((m) => ({ min: Number(m[1]), max: m[2] ? Number(m[2]) : null, index: m.index, text: m[0], field: yearsField(sy.slice(m.index)), from: sy.slice(m.index) }));
    // "N years of <field>" with no "experience" word ("2+ years of phone and email customer support")
    for (const m of sy.matchAll(YEARS_TAIL_RE)) {
      if (years.some((y) => Math.abs(y.index - m.index) < 4) || !m[3]) continue;
      const field = yearsField(sy.slice(m.index));
      if (field) years.push({ min: Number(m[1]), max: m[2] ? Number(m[2]) : null, index: m.index, text: m[0], field, from: s.slice(m.index) });
    }
    // a range that starts at 0 ("0–2 years of marketing experience (internships count)") sets no minimum
    for (let i = years.length - 1; i >= 0; i--) if (!years[i].min) years.splice(i, 1);
    const mgmt = MGMT_RE.test(s);
    const equivalent = /\b(?:or\s+equivalent|equivalent\s+(?:experience|combination)|in\s+lieu\s+of)\b/i.test(s);
    if (degrees.length || years.length) {
      // split into alternatives on " or " when both sides carry a degree or a years figure
      // split only on an "or" that starts another ALTERNATIVE (a degree or a years figure) —
      // "Business, Communication, Management, or Information Technology" is one degree's fields
      const parts = s.split(/,?\s+or\s+(?=(?:an?\s+)?(?:associate|bachelor|master|high\s+school|ged|ph\.?d|doctorate|(?:\w+\s+\()?\d{1,2}\)?\s*\+?\s*(?:years?|yrs?)|equivalent))/i);
      const alts = [];
      if (parts.length > 1 && degrees.length + years.length >= 2) {
        let offset = 0;
        for (const part of parts) {
          const pStart = s.indexOf(part, offset); const pEnd = pStart + part.length; offset = pEnd;
          const d = degrees.filter((x) => x.index >= pStart && x.index < pEnd).sort((a, b) => a.rank - b.rank)[0];
          const y = years.filter((x) => x.index >= pStart && x.index < pEnd)[0];
          if (d || y) alts.push({ degree: d ? d.rank : 0, years: y ? y.min : 0, management: mgmt, field: y ? y.field : null, from: y ? y.from : '' });
        }
      }
      // the primary figure is the first one; a later "with at least 4 years in a senior capacity" is its sub-condition,
      // never the requirement on its own (Flex: "10+ years … with at least 4 years operating in a senior or lead capacity")
      const subOf = (y) => /\b(?:with|including|of\s+which)\s+(?:at\s+least\s+)?$/i.test(s.slice(Math.max(0, y.index - 25), y.index)) || /\bat\s+least\s+$/i.test(s.slice(Math.max(0, y.index - 10), y.index)) && years.indexOf(y) > 0;
      const primaries = years.filter((y) => !subOf(y));
      const firstYears = years.length ? (primaries.length ? primaries.slice().sort((a, b) => a.index - b.index)[0] : years.reduce((a, b) => (b.min < a.min ? b : a))) : null;
      if (!alts.length) alts.push({ degree: degrees.length ? Math.min(...degrees.map((d) => d.rank).filter(Boolean)) || 0 : 0, years: firstYears ? firstYears.min : 0, management: mgmt, field: firstYears ? firstYears.field : null, from: firstYears ? firstYears.from : '' });
      const gpa = s.match(GPA_RE);
      const gpaMin = gpa ? Number(gpa[1] || gpa[2]) : null;
      if (alts.some((a) => a.degree) && !equivalent) {
        const altLabel = (a) => `${a.degree ? DEGREE_LABEL[a.degree] : a.years ? yearsLabel(a.years, a.from || '', a.field) : 'experience'}${a.degree && a.years ? ` + ${a.years} years${a.management ? ' of management' : ''}` : ''}`;
        push({ kind: 'degree', label: [...new Set(alts.map(altLabel))].join(', or ') + (gpaMin ? ` (GPA ${gpaMin.toFixed(1)}+)` : ''), value: Math.min(...alts.filter((a) => a.degree).map((a) => a.degree)), gpa: gpaMin, alternatives: alts, gate: gateable, importance, sentence: s });
      } else if (alts.some((a) => a.degree)) {
        push({ kind: 'degree', label: `${DEGREE_LABEL[alts.find((a) => a.degree).degree]} or equivalent experience`, value: alts.find((a) => a.degree).degree, gpa: gpaMin, alternatives: alts, gate: false, importance, sentence: s });
      }
      if (alts.some((a) => a.years)) {
        const minY = Math.min(...alts.filter((a) => a.years).map((a) => a.years));
        const alt = alts.find((a) => a.years === minY) || {};
        const field = alt.field || null;
        // years OR a degree ("3+ years in manufacturing OR a bachelor's in engineering"): neither is a gate on its own —
        // the degree constraint carries both alternatives and is met by either
        const orDegree = alts.some((a) => a.degree && !a.years) && alts.some((a) => a.years && !a.degree);
        const subs = years.filter((y) => y !== firstYears && subOf(y)).map((y) => ({ min: y.min, text: s.slice(y.index, y.index + 80).split(/[,;.]/)[0].trim() }));
        push({ kind: 'years', label: field ? yearsLabel(minY, alt.from || '', field) : `${minY}+ year${minY === 1 ? '' : 's'} of ${mgmt ? 'management/supervisory ' : ''}experience`, value: minY, management: mgmt, field, alternatives: alts, sub: subs.length ? subs : null, gate: gateable && minY >= 2 && !orDegree, importance, sentence: s });
      }
    } else if (mgmt && /\b(?:required|must|proven|demonstrated|experience)\b/i.test(s) && r.kind === 'requirements') {
      push({ kind: 'management', label: 'management / supervisory experience', value: 'management', gate: gateable, importance, sentence: s });
    }
    for (const m of s.matchAll(CERT_RE)) {
      // the state a licence is from ("Possession of a Texas Journeyman or Master electrical license", "licensed in New
      // Hampshire"): a recruiter screens on it first (judge optimize #4)
      const state = licenceState(s, m.index, m[1]);
      const base = m[1].replace(/\s+/g, ' ').trim().replace(/^licensed\s+(?:as\s+an?\s+)?(.+)$/i, (x, w) => `${w.replace(/^(?:rn|lpn|lvn)$/i, (a) => a.toUpperCase())} license`);
      push({ kind: 'certification', label: state && /licen[sc]|certificate|registration/i.test(base) && !new RegExp(`^${escapeRegExp(state)}\\b`, 'i').test(base) ? `${state} ${base}` : base, value: m[1].toLowerCase().replace(/\s+/g, ' ').trim(), state, compact: /\b(?:compact|multi-?state|nlc)\b/i.test(s) || null, gate: gateable && !/preferred|plus|willing|obtain|within/i.test(s), importance, sentence: s });
    }
    // a credential named by its acronym ("Current BCBA (Board-Certified Behavior Analyst) Certification required",
    // "PMP certification", "CCNA license") that the fixed list above does not know
    for (const m of s.matchAll(ACR_CERT_RE)) {
      if (CERT_RE_NAMES.test(m[1])) continue;
      push({ kind: 'certification', label: `${m[1]} certification`.replace(/certification$/, /licen[sc]/i.test(m[0]) ? 'license' : 'certification'), value: m[1].toLowerCase(), gate: gateable && /\b(?:required|must)\b/i.test(s) && !/preferred|plus|willing|obtain|within|eligible/i.test(s), importance, sentence: s });
    }
    // R4 (G4 item 3): a credential named in words ("Current California Residential Electrician Certification or higher
    // electrical certification", "Registered Professional Engineer (PE) certification required") or a licence by its state
    // alone ("Must hold active license in the state of CA or have submitted application for licensure") is a credential
    // requirement the lists above do not know; its prospective / optional wording stays on the sentence for the gate
    for (const c of namedCredentials(s)) {
      if (out.some((o) => o.kind === 'certification' && o.sentence === s && (c.value.includes(String(o.value)) || String(o.label).toLowerCase().includes(c.value)))) continue;
      push({ kind: 'certification', label: c.label, value: c.value, state: c.state, compact: null, gate: gateable && !/preferred|plus|desirable|nice\s+to\s+have|willing|obtain|within/i.test(s), importance, sentence: s });
    }
    // a physician's degree ("MD or DO from an accredited institution"), the medical licence, DEA, board certification
    if (/\b(?:MD|DO|M\.D\.|D\.O\.)\b/.test(s) && /\b(?:degree|accredited|graduate|from\s+an?)\b/i.test(s)) push({ kind: 'degree', label: 'an MD or DO degree', value: 5, alternatives: [{ degree: 5, years: 0 }], gate: gateable, importance, sentence: s });
    for (const m of s.matchAll(/\b(medical\s+licen[sc](?:e|ure)|dea\s+(?:licen[sc]e|registration|certificate)|board\s+(?:certified|certification|eligible|eligibility)(?:\s+or\s+(?:board\s+)?(?:eligible|certified))?(?:\s+(?:in|by\s+the)\s+(?:[A-Z][\w&-]*\s*){1,4})?)/gi)) {
      const state = licenceState(s, m.index, m[1]);
      push({ kind: 'certification', label: m[1].replace(/\s+(?:required|preferred|is|are|a|plus|and|or|with|from|by)\b(?!\s+(?:board\s+)?(?:eligible|certified)).*$/i, '').trim().replace(/^dea/i, 'DEA').replace(/^\w/, (c) => c.toUpperCase()), value: m[1].toLowerCase(), state, gate: gateable && !/\b(?:or\s+eligib\w*|eligibility\s+to\s+obtain|preferred|plus)\b/i.test(s), importance, sentence: s });
    }
    const age = s.match(AGE_RE);
    if (age) push({ kind: 'age', label: `${age[1] || age[2]}+ years old`, value: Number(age[1] || age[2]), gate: true, importance: 'required', sentence: s });
    // Every language ask in the sentence: a run-on posting line holds "English fluency is required
    // English/Spanish bilingual is a plus" (two asks; the first match alone dropped the bilingual one).
    const langSeen = new Set();
    for (const lang of s.matchAll(new RegExp(LANG_RE.source, 'gi'))) {
      const named = lang.slice(1).filter(Boolean).map((x) => x.toLowerCase());
      const other = named.find((x) => x !== 'english') || (/bilingual/i.test(lang[0]) ? 'spanish' : null);
      const lab = other ? `bilingual English/${other.charAt(0).toUpperCase()}${other.slice(1)}` : 'English fluency';
      if (langSeen.has(lab)) continue;
      langSeen.add(lab);
      const clause = s.slice(lang.index, lang.index + lang[0].length + 40);
      push({ kind: 'language', label: lab, value: other || 'english', gate: false, importance: PREFERRED_CUE_RE.test(clause) ? 'preferred' : importance, sentence: s });
    }
    if (SCHEDULE_CUE_RE.test(s) && (r.kind === 'schedule' || /\b(?:must|required|able|available|availability|willing|including|flexible|open|all\s+employees|expected|hours)\b/i.test(s))) {
      const items = scheduleFacts(s, (rows[rows.indexOf(r) + 1] || {}).sentence || '');
      if (items.length) {
        // one schedule row per posting: a posting that states its hours three ways ("12-hour shift minimum",
        // "full-time, 12-hour shifts", "part-time …") showed three rows (judge optimize #10)
        const prev = out.find((c) => c.kind === 'schedule');
        if (prev) { for (const it of items) if (!prev.items.includes(it)) prev.items.push(it); prev.label = prev.items.join(', '); prev.value = prev.items.join('|'); if (importance === 'required') prev.importance = 'required'; }
        else push({ kind: 'schedule', label: items.join(', '), value: items.join('|'), items, gate: false, importance, sentence: s });
      }
    }
    const ph = s.match(PHYSICAL_RE);
    if (ph) {
      const items = [];
      const lift = s.match(/lift(?:ing)?[^.;]{0,60}?(?:up\s+to\s+|at\s+least\s+)?(\d{1,3})\s*(?:lbs?\.?|pounds?)/i);
      if (lift) items.push(`lift ${lift[1]} lbs`);
      if (/stand(?:ing)?\s+(?:for\s+)?(?:extended|long|prolonged|an\s+entire|the\s+entire|a\s+full|full)|stand\s+and\s+move|on\s+(?:your|their)\s+feet/i.test(s)) items.push('stand for a full shift');
      if (/ladder/i.test(s)) items.push('climb ladders');
      if (/bend|stoop|kneel|crouch/i.test(s)) items.push('bend, stoop or kneel');
      if (/repetitive/i.test(s)) items.push('repetitive motions');
      if (/noise/i.test(s)) items.push('moderate to high noise');
      if (/restrictive\s+spaces/i.test(s)) items.push('restrictive spaces');
      if (/outdoor|all\s+weather/i.test(s)) items.push('outdoor conditions');
      if (items.length) push({ kind: 'physical', label: items.join(', '), value: items.join('|'), items, gate: false, importance, sentence: s });
    }
    const bg = s.match(BACKGROUND_RE);
    if (bg) push({ kind: 'background', label: bg[1].toLowerCase(), value: bg[1].toLowerCase(), gate: false, importance: 'required', sentence: s });
  }
  // What the posting WAIVES or PROMISES ("No previous wound care experience is required", "No overnight shifts, no
  // weekends"): read with its polarity so no tool can print the opposite (negated: true, never a gate)
  for (const r of sectionPosting(text)) {
    for (const m of String(r.sentence).matchAll(WAIVED_RE)) {
      const label = m[0].replace(/\s+/g, ' ').trim();
      push({ kind: 'waived', label: label.charAt(0).toUpperCase() + label.slice(1), value: label.toLowerCase(), negated: true, gate: false, importance: 'required', sentence: r.sentence });
    }
  }
  // the title itself: a senior/management role is a seniority constraint
  const t = String(jobTitle || '');
  const rank = /\b(chief|vp|vice president|c-level)\b/i.test(t) ? 6 : /\b(director|head of)\b/i.test(t) ? 5 : (/\b(manager|supervisor|principal|lead)\b/i.test(t) || STAFF_TECH_RE.test(t)) && !/\b(assistant\s+manager|shift\s+lead|team\s+lead|lead\s+(?:cashier|associate|barista|teller|server))\b/i.test(t) ? 4 : /\b(senior|sr\.?)\b/i.test(t) ? 3 : 0;
  if (rank >= 4) push({ kind: 'seniority', label: rank >= 5 ? 'director-level role' : 'management-level role', value: rank, gate: true, importance: 'required', sentence: t });
  return out;
}

// ── The title a posting gives itself ────────────────────────────────────────────────────────────
// A tailor with the title box empty read 1 requirement from a posting that reads 6 with it (Dev,
// round 3): the role family (which decides the vocabulary — a tech posting's "Go", algorithms,
// distributed systems) was detected from a blank title. The posting usually names its own role:
// "Job Title: …", "We're looking for a Backend Engineer", "As a Data Engineer, you will…", a short
// first line, or a field + role noun anywhere in the text ("software engineering skills").
const INFER_TITLE_NOUN = String.raw`(?:engineer(?:ing)?|developer|programmer|architect|analyst|scientist|designer|manager|director|coordinator|specialist|associate|representative|technician|nurse|teacher|accountant|administrator|consultant|recruiter|lead|supervisor|cashier|clerk|driver|assistant|intern|writer|editor|marketer|strategist|operator|mechanic|electrician|plumber|planner|buyer|merchandiser|dispatcher|paralegal|pharmacist|therapist|counselor|officer|agent|attendant|barista|server|cook|chef|host|stocker|picker|packer|warehouse associate|team member|crew member)`;
const INFER_TITLE_PHRASE = String.raw`((?:[A-Z][\w+#./'-]*|of|and|&|the)(?:[ -](?:[A-Z][\w+#./'-]*|of|and|&|the)){0,4}?[ -]?${INFER_TITLE_NOUN}s?)`;
const EXPLICIT_TITLE_RE = /\b(?:job\s+title|position(?:\s+title)?|role|title)\s*[:\-–—]\s*([^\n.;|(]{3,70})/i;
const INTRO_TITLE_RE = new RegExp(String.raw`\b(?:looking\s+for|seeking|hiring|hire|need|searching\s+for|recruiting|join\s+(?:us|our\s+team)\s+as|work(?:ing)?\s+as|role\s+of|position\s+of|as)\s+(?:an?\s+|the\s+)?(?:experienced\s+|talented\s+|motivated\s+|passionate\s+|skilled\s+|dedicated\s+|reliable\s+|senior\s+|junior\s+|mid-level\s+|full-time\s+|part-time\s+)*${INFER_TITLE_PHRASE}`, 'i');
const FIELD_TITLE_RE = /\b((?:software|backend|back-end|front-end|frontend|full[- ]stack|data|platform|devops|site reliability|machine learning|ml|security|cloud|mobile|ios|android|embedded|firmware|qa|test)\s+(?:engineer(?:ing)?|developer|scientist|analyst|architect))\b/i;
export function inferJobTitle(text) {
  const src = dehyphenate(String(text || '')).replace(/\r/g, '');
  if (!src.trim()) return '';
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').replace(/[\s,;:–—-]+$/, '').trim();
  const ex = src.match(EXPLICIT_TITLE_RE);
  if (ex && new RegExp(INFER_TITLE_NOUN, 'i').test(ex[1])) return clean(ex[1]).slice(0, 80);
  // a short first line that reads as a title ("Department Manager — Fry's Food Stores")
  const first = clean((src.split('\n').map((l) => l.trim()).find(Boolean) || '').split(/\s+[—–|]\s+|\s+-\s+|\s+at\s+|\s+@\s+/)[0]);
  if (first && first.length <= 60 && first.split(' ').length <= 6 && new RegExp(`\\b${INFER_TITLE_NOUN}s?$`, 'i').test(first)) return first;
  const intro = src.match(INTRO_TITLE_RE);
  if (intro) return clean(intro[1]).replace(/s$/, (m, off, str) => (/ies$|ss$/.test(str) ? m : '')).slice(0, 80);
  const field = src.match(FIELD_TITLE_RE);
  if (field) return clean(field[1]).replace(/\bengineering\b/i, 'Engineer').slice(0, 80);
  return '';
}

