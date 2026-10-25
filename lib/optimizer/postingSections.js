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

const HEADINGS = [
  ['preferred', /^(?:preferred(?:\s+(?:qualifications|skills|experience)(?:\s+(?:&|and)\s+(?:key\s+)?competencies)?)?|additional\s+(?:qualifications|skills)|nice[- ]to[- ]haves?|bonus(?:\s+points)?|desired(?:\s+(?:skills|qualifications))?|it'?s a plus if|pluses|what would make you stand out)$/i],
  ['physical', /^(?:physical\s+(?:requirements?|demands?|abilities)|working\s+conditions|work\s+environment)$/i],
  ['schedule', /^(?:(?:\w+\s+)?schedule|hours|shifts?|availability|work\s+schedule|hours\s+of\s+work|shift\s+details?)$/i],
  ['requirements', /^(?:(?:\w+\s+)?(?:requirements?|qualifications?)(?:\s+(?:&|and)\s+(?:key\s+)?(?:competencies|skills|qualifications|requirements))?|key\s+skills|your\s+(?:profile|skills|experience|qualifications)|the\s+ideal\s+candidate\s+(?:has|will\s+have)|skills?\s*(?:&|and)\s*(?:qualifications?|experience|abilities)|skills|must[- ]haves?|what\s+you(?:'ll|\s+will)?\s+(?:need|bring)|what\s+we(?:'re|\s+are)\s+looking\s+for|who\s+you\s+are|about\s+you|what\s+you\s+have|you\s+(?:have|bring|are)|experience\s+(?:&|and)\s+skills|knowledge,?\s+skills(?:\s+(?:&|and)\s+abilities)?|education\s+(?:&|and)\s+experience|education|(?:successful|ideal)\s+(?:associates?|candidates?|team\s+members?))$/i],
  ['responsibilities', /^(?:(?:\w+\s+)?(?:responsibilities|duties)|duties\s+(?:&|and)\s+responsibilities|essential\s+functions|what\s+you(?:'ll|\s+will)\s+(?:do|own|be\s+doing)|the\s+role|your\s+role|in\s+this\s+role|a\s+day\s+in\s+the\s+life|day[- ]to[- ]day|what\s+you'?ll\s+be\s+doing|position\s+(?:overview|summary|description)|job\s+(?:summary|description|overview)|role\s+(?:overview|summary|description)|overview\s+of\s+the\s+role|the\s+opportunity|objective|job\s+objective|about\s+the\s+(?:role|job|position))$/i],
  ['benefits', /^(?:(?:\w+\s+){0,4}(?:benefits?|perks)|what\s+we\s+offer|what'?s\s+in\s+it\s+for\s+you|compensation(?:\s+(?:&|and)\s+benefits)?|pay|hourly\s+wage|salary|total\s+rewards|rewards|why\s+(?:work\s+)?(?:for|with|at)\s+us|we\s+put\s+our\s+employees\s+first)$/i],
  ['culture', /^(?:(?:our|company|core)\s+values|culture|who\s+we\s+are|about\s+(?:us|the\s+company|the\s+team|[A-Z][\w&]*)|our\s+(?:story|mission|team|company)|mission|why\s+join(?:\s+\w+)?\??|why\s+[A-Z][\w&]*\??|company\s+overview|overview|what\s+success\s+looks\s+like|company\s+culture(?:\s+(?:&|and)\s+perks)?|you'?ll\s+fit\s+right\s+in\s+if\s+you)$/i],
  ['location', /^(?:location(?:\s+(?:&|and)\s+flexibility)?|work\s+location|work\s+arrangement|where\s+you(?:'ll|\s+will)\s+work)$/i],
  ['process', /^(?:our\s+process|interview\s+process|hiring\s+process|how\s+to\s+apply|next\s+steps)$/i],
  ['eeo', /^(?:equal\s+(?:employment\s+)?opportunity(?:\s+employer)?|eeo(?:\s+statement)?|diversity(?:\s+(?:&|and)\s+inclusion)?|accommodations?|legal|disclaimer|pay\s+transparency)$/i],
];

const EEO_RE = /\b(?:equal\s+(?:employment\s+)?opportunity|without\s+regard\s+to|protected\s+(?:veteran|status|class)|sexual\s+orientation|gender\s+identity|national\s+origin|reasonable\s+accommodation|affirmative\s+action|drug[- ]free\s+workplace|e-?verify|fair\s+chance|criminal\s+histories|background\s+check\s+policy|discriminat|privacy\s+policy|terms\s+of\s+use)\b/i;
const BENEFITS_RE = /\b(?:(?:range|suite|package)\s+of\s+benefits|benefits\s+(?:package|include|including)|proud\s+to\s+offer|compensation\s+(?:depends|is|range|offered)|base\s+salary|salary\s+range|annual\s+bonus|target\s+bonus|401\s?\(?k\)?|medical(?:\/|,\s*)dental|dental|vision\s+(?:insurance|coverage|plan)|health\s+insurance|paid\s+time\s+off|pto\b|vacation|sick\s+(?:pay|leave|time)|tuition|employee\s+discount|discounts?\s+on|perks?|bonus(?:es)?\s+(?:program|eligible)|opportunities\s+for\s+advancement|career\s+growth|ongoing\s+training|paid\s+training|we\s+offer|competitive\s+(?:pay|wage|salary|compensation)|hourly\s+wage:|per\/hour|per\s+hour|premiums?\s+may)\b/i;
const CULTURE_RE = /\b(?:core\s+values|our\s+values|we\s+believe|our\s+mission|mindful|passion(?:ate)?|we\s+are\s+(?:a|an|the)\s+(?:leading|fast[- ]growing|global)|headquartered|founded\s+in|was\s+founded|comprised\s+of|stands\s+for|why\s+(?:join|work)|excel\s+individually|grow\s+and\s+excel|community|culture|is\s+a\s+leading|we\s+strive|committed\s+to\s+(?:building|cultivating|fostering|creating)|feel\s+valued|rooted\s+in)\b/i;
export const REQUIREMENT_CUE_RE = /\b(?:required?|requirements?|must(?:\s+(?:be|have|possess))?|need(?:s|ed)?\s+to|needs?\b|needed\b|essential|mandatory|minimum|at\s+least|ability\s+to|able\s+to|proven|demonstrated|experience\s+(?:in|with|of)|years?\s+of|strong|excellent|solid|knowledge\s+of|familiar(?:ity)?\s+with|proficien(?:t|cy)|skilled\s+in|comfort(?:able)?\s+(?:with|to)|willing(?:ness)?\s+to|capable\s+of|preferred|a\s+plus|nice\s+to\s+have|bonus|ideal(?:ly)?|desired|exceptional|professional\s+(?:appearance|demeanor))\b/i;
// A preference cue. "primary/preferred language" (Kunai: "5+ years … with Go as your primary/preferred
// language") is an adjective, not a preference; an "annual bonus" is pay, not "a bonus to have".
export const PREFERRED_CUE_RE = /(?<![\/\w-])(?:prefer(?:red)?(?!\s*\/|\s+(?:language|languages|name|pronouns|method|location|tool|platform|stack)s?\b)|nice[- ]to[- ]haves?|(?:is\s+)?a\s+(?:big\s+|huge\s+|strong\s+)?plus|(?<!(?:annual|target|performance|sign[- ]on|signing|quarterly|referral|retention|cash|year[- ]end)\s)bonus(?!\s+(?:program|eligible|plan|potential|structure|opportunit\w*|pay)\b)|ideal(?:ly)?|desired|would\s+be\s+great|familiarity\s+with|exposure\s+to|helpful|advantage(?:ous)?)\b/i;
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
  '(?:minimum|basic|required|preferred|desired|additional|job|position|core)\\s+(?:requirements|qualifications|skills|experience)(?:\\s+(?:and|&)\\s+(?:key\\s+)?competencies)?',
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
function cutInlineHeadings(l) {
  // the heading must start with a capital IN THE TEXT and be followed by a colon or by a capitalised
  // word, a number or a bullet (checked here: the regex is case-insensitive, so its lookahead is too)
  const cut = (m0, pre, head, colon, next) => (/^[A-Z]/.test(head) && (colon || /^[A-Z0-9•("“]/.test(next || '')) ? `${pre}\n${head}\n` : m0);
  // a single word that is only the start of a longer heading ("Preferred Qualifications and …") is not one
  const single = (m0, pre, head, colon, next) => (!colon && /^(?:qualifications?|requirements?|skills?|experience|and|&|competencies|responsibilities|duties|to|points|by)$/i.test(next || '') ? m0 : cut(m0, pre, head, colon, next));
  return l.replace(INLINE_HEADING_RE, cut).replace(SINGLE_HEADING_RE, single);
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
  intermediate detail-oriented effective attention certification certified current valid availability available have hold focus
  design build partner enforce integrate help collaborate lead own run define set maintain prototype coordinate support keep explore
  serve monitor develop create manage drive deliver participate debug write ensure provide contribute implement improve analyze analyse
  conduct perform prepare review report plan execute communicate mentor train identify establish oversee handle assist respond answer
  greet translate produce personally ship test investigate act champion evaluate research optimize scale automate operate configure
  shape influence present draft edit publish launch grow measure engage recruit negotiate organize schedule document resolve
  troubleshoot install repair inspect clean stock load unload pick pack work`.split(/\s+/).filter(Boolean));
const DETERMINER_END_RE = /\b(?:the|a|an|of|to|for|with|in|on|at|our|their|and|or|by|from|as|per|into|all|your|its|via|like|than|is|are|be|past|last|next|over|first|nearly|about|around|almost|within|least|bachelor's|master's|associate's)$/i;
const YEARS_WORD_RE = /^(?:years?|yrs?)\b/i;
function splitRunOn(sent) {
  if (sent.length <= 120) return [sent];
  const words = sent.split(' ');
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur.length ? cur[cur.length - 1] : '';
    const letters = w.replace(/[^A-Za-z'’-]/g, '');
    const bare = letters.toLowerCase().replace(/’/g, "'");
    const startsBullet = /^[A-Z]/.test(w) && (BULLET_STARTERS.has(bare) || /^[A-Z][a-z]{4,}ing$/.test(letters));
    const startsYears = /^\d{1,2}(?:\+|\s*[-–]\s*\d{1,2}\+?)?$/.test(w) && YEARS_WORD_RE.test(words[i + 1] || '');
    // never inside a capitalised name ("the Sr. Lifecycle & CRM Marketing Lead")
    const prevOk = prev && /[a-z0-9)\]%]$/.test(prev) && !/^[A-Z]/.test(prev) && !DETERMINER_END_RE.test(prev);
    if (cur.length >= 3 && prevOk && (startsBullet || startsYears)) { out.push(cur.join(' ')); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur.join(' '));
  return out.map((p) => p.trim()).filter(Boolean);
}

// Sentence splitter for flat and line-broken postings alike. Inline headings ("Job
// Requirements: Previous …", "Key Requirements Portfolio …") start a line of their own;
// sentences come from the ONE shared splitter (lib/text/sentences.js — "e.g." is not an end).
export function splitPostingSentences(text) {
  const src = String(text || '').replace(/\r/g, '\n').replace(/•|▪|◦|‣|·|●/g, '\n• ');
  const out = [];
  for (const line of src.split(/\n+/)) {
    let l = line.replace(/^\s*[•\-*]\s*/, '').replace(/\s+/g, ' ').trim();
    if (!l) continue;
    // LinkedIn tracking tags ("#LI-Hybrid", "#LI-JJ1") end whatever came before them: what
    // follows is usually the benefits block, run into the last requirement with no punctuation
    l = l.replace(/\s*#LI-[\w-]+\s*/gi, '\n');
    // inline Title Case heading followed by a colon ("… Co-Presidents. Position Overview: Customer …")
    l = l.replace(/(?:^|\s)((?:[A-Z][\w&'’/-]*(?:\s+(?:and|&|of|the|to|for|in))?\s+){0,4}[A-Z][\w&'’/-]*\??):\s/g, (m0, head) => `\n${head}: `);
    // an ALL-CAPS heading run inside a flat line ("… off the mat. OBJECTIVE The Seasonal …")
    l = l.replace(/(?:^|\s)((?:[A-Z][A-Z&'/-]{1,}\s+){1,6})(?=[A-Z][a-z])/g, (m0, head) => (/[A-Z]{4,}/.test(head) ? `\n${head.trim()}\n` : m0));
    // known section headings run into the text ("… next quarter. Key Requirements Portfolio …")
    l = cutInlineHeadings(l);
    for (const part of l.split(/\n+/)) {
      for (const sent of splitSentences(part)) {
        // bullet items that lost their line breaks run together with no punctuation
        for (const p of splitRunOn(sent.trim())) out.push(p);
      }
    }
  }
  return out;
}

function headingOf(raw) {
  const sentence = String(raw).replace(/\u2019/g, "'");
  const m = sentence.match(/^((?:[A-Za-z#][\w&'/#-]*\s){0,5}[A-Za-z][\w&'/-]*\??)\s*:\s*(.*)$/s);
  if (m) {
    for (const [kind, re] of HEADINGS) if (re.test(m[1].trim())) return { kind, rest: m[2].trim() };
  }
  // a short line with no sentence punctuation that IS a heading, whatever its case ("What you'll do")
  const bare = sentence.replace(/[:\-–]+$/, '').trim();
  if (bare.split(/\s+/).length <= 7 && !/[.!]$/.test(bare)) {
    const hit = HEADINGS.find(([, re]) => re.test(bare));
    if (hit) return { kind: hit[0], rest: '' };
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
      return { kind, rest: rest.trim() };
    }
  }
  return null;
}

/**
 * Section a posting. Returns [{ kind, sentence, explicit }] — `explicit` is true when the
 * sentence sits under a real heading; otherwise its kind comes from sentence-level cues.
 */
export function sectionPosting(text) {
  const sentences = splitPostingSentences(text);
  const out = [];
  let current = null; // kind under an explicit heading, or null before any heading
  for (const s of sentences) {
    const h = headingOf(s);
    if (h) { current = h.kind; if (h.rest) out.push({ kind: current, sentence: h.rest, explicit: true }); continue; }
    if (EEO_RE.test(s)) { out.push({ kind: 'eeo', sentence: s, explicit: false }); continue; }
    if (current && current !== 'culture' && current !== 'about') {
      if (REQUIREMENT_KINDS.has(current) && PAY_SENTENCE_RE.test(s) && !STRONG_CUE_RE.test(s)) { out.push({ kind: 'benefits', sentence: s, explicit: false }); continue; }
      if (REQUIREMENT_KINDS.has(current) && BENEFITS_RE.test(s) && !REQUIREMENT_CUE_RE.test(s)) { out.push({ kind: 'benefits', sentence: s, explicit: false }); continue; }
      // a flat posting's culture/benefits paragraph after the last requirement has no heading of its
      // own (Kunai: "Our success over the past 20 years is rooted in … a culture of collaboration")
      if (REQUIREMENT_KINDS.has(current) && CULTURE_RE.test(s) && !STRONG_CUE_RE.test(s) && !/\b(?:skills?|experience|ability|knowledge)\b/i.test(s)) { out.push({ kind: 'culture', sentence: s, explicit: false }); continue; }
      out.push({ kind: current, sentence: s, explicit: true }); continue;
    }
    // no heading yet (or inside an About/culture block): classify the sentence on its own
    let kind = 'about';
    if (BENEFITS_RE.test(s)) kind = 'benefits';
    else if (PHYSICAL_RE.test(s) && REQUIREMENT_CUE_RE.test(s)) kind = 'physical';
    else if (SCHEDULE_CUE_RE.test(s) && /\b(?:must|required|able|available|availability|willing|including|flexible|open)\b/i.test(s)) kind = 'schedule';
    else if (CULTURE_RE.test(s) && !REQUIREMENT_CUE_RE.test(s)) kind = 'culture';
    else if (PREFERRED_CUE_RE.test(s) && !/\b(?:required|must)\b/i.test(s)) kind = 'preferred';
    else if (REQUIREMENT_CUE_RE.test(s)) kind = 'requirements';
    else if (RESPONSIBILITY_CUE_RE.test(s) || /\byou(?:'ll| will)\b/i.test(s)) kind = 'responsibilities';
    out.push({ kind, sentence: s, explicit: false });
  }
  // A posting with real Requirements/Responsibilities sections: a sentence we only GUESSED as a
  // requirement (company blurb with "needs" in it) is context unless it carries a strong cue.
  if (out.some((r) => r.explicit && (r.kind === 'requirements' || r.kind === 'responsibilities'))) {
    for (const r of out) if (!r.explicit && (r.kind === 'requirements' || r.kind === 'responsibilities') && !STRONG_CUE_RE.test(r.sentence)) r.kind = 'about';
  }
  return out;
}
// A sentence that states the pay ("Compensation … between 140 - 170k base with an up-to 20% annual bonus").
export const PAY_SENTENCE_RE = /(?:\$\s?\d|\b\d{2,3}(?:,\d{3}|\s?k)\b(?=[^.]{0,40}\b(?:base|salary|year|annual|per|range|compensation|pay|usd)\b)|\b(?:base\s+salary|salary\s+range|pay\s+range|hourly\s+(?:rate|wage|range)|compensation\s+(?:depends|is|range|offered|for\s+this)|annual\s+bonus|target\s+bonus)\b)/i;
const STRONG_CUE_RE = /\b(?:required?|must|years?\s+of|ability\s+to|able\s+to|proficien|experience\s+(?:in|with)|preferred|a\s+plus|degree|licen[sc]e|certif)\b/i;

export const REQUIREMENT_KINDS = new Set(['requirements', 'responsibilities', 'preferred', 'physical', 'schedule']);
/** The sentences a requirement may be read from, with their importance. */
export function requirementSentences(text) {
  const rows = sectionPosting(text);
  const out = [];
  for (const r of rows) {
    if (!REQUIREMENT_KINDS.has(r.kind)) continue;
    const pref = r.kind === 'preferred' || (PREFERRED_CUE_RE.test(r.sentence) && !/\b(?:required|must)\b/i.test(r.sentence));
    const importance = pref ? 'preferred' : r.kind === 'responsibilities' ? 'responsibility' : 'required';
    out.push({ sentence: r.sentence, kind: r.kind, importance, explicit: r.explicit });
  }
  return out;
}

// ── structured constraints ──
const DEGREE_RE = /\b(high\s+school(?:\s+diploma)?|ged|associate'?s?\s+(?:degree|of\s+(?:arts|science|applied\s+science))|a\.a\.|a\.s\.|bachelor'?s?(?:\s+(?:degree|of\s+(?:arts|science)))?|b\.a\.|b\.s\.|master'?s?\s+(?:degree|of\s+\w+)|m\.a\.|m\.s\.|mba|ph\.?d|doctorate)\b/gi;
const GPA_RE = /\b(\d(?:\.\d{1,2})?)\s*(?:\+|or\s+(?:higher|above|better))?\s*gpa\b|\bgpa\s*(?:of|minimum|at\s+least)?\s*(\d(?:\.\d{1,2})?)/i;
// "4+ years of HVAC service experience", "2–4 years in social media", "2+ years of phone and email customer
// support": the figure, and (in extractConstraints) the field it is counted in.
const YEARS_TAIL_RE = /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*\()?(\d{1,2})\)?\s*(?:\+|\s*(?:-|\u2013|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b(?!\s+(?:old|of\s+age|ago|is|are|was|has|have))(?:\s+(of|in|as|doing|working|building|running|managing|leading|selling|supporting|operating|teaching))?\s+([^.;:()]{2,90})/gi;
const YEARS_RE = /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*\()?(\d{1,2})\)?\s*(?:\+|\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:\+\s*)?(?:years?|yrs?)(?:\s+of)?(?:\s+(?:[a-z-]+\s+){0,5}?)?(?:experience|exp\b|background|in\s+a)/i;
const MGMT_RE = /\b(?:manag(?:e|ing|ement)\s+(?:of\s+)?(?:a\s+)?(?:large\s+)?(?:team|teams|staff|people|department|call\s+center|operations)|supervis(?:e|ing|ory|ion)|direct\s+reports|people\s+management|team\s+management|leading\s+(?:a\s+)?team|lead\s+(?:a\s+)?team\s+of|customer\s+service\s+management)\b/i;
const CERT_RE = /\b(food\s+handler'?s?\s+(?:card|permit|certificat\w+)|servsafe|tips\s+certif\w+|alcohol\s+(?:server|seller)\s+(?:training|permit|certif\w+)|title\s+4|forklift\s+(?:certif\w+|licen[sc]e[ds]?)|osha\s+(?:10|30)|cpr(?:\s*\/\s*first\s+aid)?|first\s+aid|guard\s+card|tabc|bls\b|cdl(?:\s+class\s+[abc])?|class\s+[abc]\s+(?:cdl|licen[sc]e)|rn\s+licen[sc]e|cna\b|emt\b|notary|real\s+estate\s+licen[sc]e|cosmetology\s+licen[sc]e|security\s+licen[sc]e|driver'?s?\s+licen[sc]e|acls|pals|nihss|epa\s+(?:section\s+)?608(?:\s+universal)?|nate|cpa|(?:[A-Z][a-z]+\s+){0,2}teaching\s+licen[sc](?:e|ure)|teacher\s+certification|servsafe\s+(?:food\s+handler|manager)(?:\s+card|\s+certification)?)\b/gi;
const AGE_RE = /\b(?:(?:must\s+be\s+|minimum\s+age\s+(?:of\s+)?|at\s+least\s+)(\d{2})\s*(?:\+|years?(?:\s+of\s+age|\s+old)?|or\s+older)|(\d{2})\+\s*(?:years?\s+of\s+age|years\s+old|or\s+older))/i;
const LANGUAGES = 'english|spanish|french|mandarin|cantonese|chinese|vietnamese|tagalog|korean|arabic|portuguese|german|russian|hindi|japanese|italian|polish|somali|amharic|haitian\\s+creole|asl|american\\s+sign\\s+language';
const LANG_RE = new RegExp(`\\b(?:bilingual(?:\\s+(?:in\\s+)?(${LANGUAGES})(?:\\s*\\/\\s*(${LANGUAGES}))?)?|(?:fluent|fluency)\\s+(?:in\\s+)?(${LANGUAGES})|(${LANGUAGES})\\s*\\/\\s*(${LANGUAGES})|(${LANGUAGES})[- ]speaking|(${LANGUAGES})\\s+fluency)\\b`, 'i');
const BACKGROUND_RE = /\b(background\s+check|drug\s+(?:test|screen(?:ing)?)|mvr|motor\s+vehicle\s+record|clean\s+driving\s+record|fingerprint\w*)\b/i;
export const SCHEDULE_CUE_RE = /\b(?:part[- ]time|full[- ]time|seasonal|temporary|weekends?|nights?|evenings?|overnight|early\s+mornings?|mornings?|holidays?|blackout\s+(?:period|dates?)|hours?\s+per\s+week|hours?\s*\/\s*week|shift\s+minimum|minimum\s+(?:of\s+)?\d+[- ]hour\s+shifts?|\d+[- ]hour\s+shifts?|open\s+availability|flexible\s+(?:hours|schedule|availability)|must\s+be\s+available|availability\s+to\s+work|rotating\s+shifts?|on[- ]call|peak\s+(?:season|periods?)|black\s+friday|thanksgiving)\b/i;
const PHYSICAL_RE = /\b(?:lift(?:ing)?[^.;]{0,60}?(?:up\s+to\s+|at\s+least\s+)?(\d{1,3})\s*(?:lbs?\.?|pounds?)|stand(?:ing)?\s+(?:for\s+)?(?:extended|long|prolonged|an\s+entire|the\s+entire|a\s+full|full)\s+(?:periods?|shifts?|hours)|stand\s+and\s+move|on\s+(?:your|their)\s+feet|climb(?:ing)?\s+(?:a\s+)?ladders?|bend(?:ing)?|stoop(?:ing)?|kneel(?:ing)?|crouch(?:ing)?|reach(?:ing)?\s+overhead|repetitive\s+motions?|walk(?:ing)?\s+(?:for\s+)?(?:extended|long)|restrictive\s+spaces|noise\s+levels?|outdoor\s+(?:work|conditions)|all\s+weather|push(?:ing)?\s+and\s+pull(?:ing)?)\b/i;

// The field a years figure is counted in: "4+ years of HVAC service experience" → "HVAC service"; "2–4
// years in social media, with …" → "social media"; "3+ years of experience" → null (no field).
const FIELD_STOP_RE = /\s*(?:\b(?:experience|exp|background|including|ideally|preferably|with|at\s+least|in\s+an?\b|in\s+the\b|within|where|who|that|in\s+production|in\s+a\s+high|and\s+(?:a|an|the)\b|or\s+(?:a|an|the|equivalent)\b|required|preferred|is|are)\b|,|—|–|$)/i;
const FIELD_LEAD_RE = /^(?:(?:professional|relevant|related|hands-on|proven|progressive(?:ly)?|direct|recent|paid|full-time|total|overall|prior|previous|work|working|industry|practical|demonstrated|successful|combined)\s+)+/i;
function yearsField(fromNumber) {
  const m = fromNumber.match(/^(?:\w+\s*\()?\d{1,2}\)?\s*(?:\+|\s*(?:-|\u2013|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b\s*(?:of\s+|in\s+(?!an?\b|the\b)|as\s+(?:an?\s+)?|doing\s+|working\s+(?:in|as|with)\s+|building\s+(?:and\s+\w+\s+)?|running\s+|managing\s+|leading\s+|selling\s+|supporting\s+|operating\s+|teaching\s+)?(.*)$/i);
  if (!m) return null;
  const tail = m[1];
  // a list of fields offered as a choice: "… in email marketing operations, CRM administration, or marketing operations"
  const list = tail.replace(/^experience\s+(?:in|with)\s+/i, '').match(/^([^.;()]{3,90}?,\s*(?:[^.;,()]+,\s*)*or\s+[^.;,()]+?)(?=\s*(?:experience\b|[.;,]|$))/i);
  if (list && list[1].split(/\s+/).length <= 12) return list[1].replace(FIELD_LEAD_RE, '').trim();
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
// A sentence that rules a requirement OUT or belongs to another posting: "Pediatric unit nurses also
// need PALS; this telemetry role does not", "Our sister company … is also hiring CDL-A drivers — see
// their separate postings".
export const RULED_OUT_RE = /\b(?:this|the|our)\s+(?:[\w-]+\s+){0,2}(?:role|position|job|opening)\s+(?:does\s+not|doesn['’]t|will\s+not|won['’]t)\b|\b(?:is|are)\s+not\s+(?:required|needed|necessary)\b|\bnot\s+required\s+for\s+this\b|\bseparate\s+postings?\b|\bsister\s+(?:company|companies|brand|division)\b|\b(?:our|the)\s+\w+\s+division\s+also\s+hires\b/i;

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
    const years = [...s.matchAll(new RegExp(YEARS_RE.source, 'gi'))].map((m) => ({ min: Number(m[1]), max: m[2] ? Number(m[2]) : null, index: m.index, text: m[0], field: yearsField(s.slice(m.index)) }));
    // "N years of <field>" with no "experience" word ("2+ years of phone and email customer support")
    for (const m of s.matchAll(YEARS_TAIL_RE)) {
      if (years.some((y) => Math.abs(y.index - m.index) < 4) || !m[3]) continue;
      const field = yearsField(s.slice(m.index));
      if (field) years.push({ min: Number(m[1]), max: m[2] ? Number(m[2]) : null, index: m.index, text: m[0], field });
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
      if (parts.length > 1 && (degrees.length > 1 || years.length > 1)) {
        let offset = 0;
        for (const part of parts) {
          const pStart = s.indexOf(part, offset); const pEnd = pStart + part.length; offset = pEnd;
          const d = degrees.filter((x) => x.index >= pStart && x.index < pEnd).sort((a, b) => a.rank - b.rank)[0];
          const y = years.filter((x) => x.index >= pStart && x.index < pEnd)[0];
          if (d || y) alts.push({ degree: d ? d.rank : 0, years: y ? y.min : 0, management: mgmt, field: y ? y.field : null });
        }
      }
      const firstYears = years.length ? years.reduce((a, b) => (b.min < a.min ? b : a)) : null;
      if (!alts.length) alts.push({ degree: degrees.length ? Math.min(...degrees.map((d) => d.rank).filter(Boolean)) || 0 : 0, years: firstYears ? firstYears.min : 0, management: mgmt, field: firstYears ? firstYears.field : null });
      const gpa = s.match(GPA_RE);
      const gpaMin = gpa ? Number(gpa[1] || gpa[2]) : null;
      if (alts.some((a) => a.degree) && !equivalent) {
        const altLabel = (a) => `${a.degree ? DEGREE_LABEL[a.degree] : 'experience'}${a.degree && a.years ? ` + ${a.years} years${a.management ? ' of management' : ''}` : ''}`;
        push({ kind: 'degree', label: alts.map(altLabel).join(', or ') + (gpaMin ? ` (GPA ${gpaMin.toFixed(1)}+)` : ''), value: Math.min(...alts.filter((a) => a.degree).map((a) => a.degree)), gpa: gpaMin, alternatives: alts, gate: gateable, importance, sentence: s });
      } else if (alts.some((a) => a.degree)) {
        push({ kind: 'degree', label: `${DEGREE_LABEL[alts.find((a) => a.degree).degree]} or equivalent experience`, value: alts.find((a) => a.degree).degree, gpa: gpaMin, alternatives: alts, gate: false, importance, sentence: s });
      }
      if (alts.some((a) => a.years)) {
        const minY = Math.min(...alts.filter((a) => a.years).map((a) => a.years));
        const field = (alts.find((a) => a.years === minY) || {}).field || null;
        push({ kind: 'years', label: `${minY}+ year${minY === 1 ? '' : 's'} of ${field ? `${field} ` : mgmt ? 'management/supervisory ' : ''}experience`, value: minY, management: mgmt, field, alternatives: alts, gate: gateable && minY >= 2, importance, sentence: s });
      }
    } else if (mgmt && /\b(?:required|must|proven|demonstrated|experience)\b/i.test(s) && r.kind === 'requirements') {
      push({ kind: 'management', label: 'management / supervisory experience', value: 'management', gate: gateable, importance, sentence: s });
    }
    for (const m of s.matchAll(CERT_RE)) push({ kind: 'certification', label: m[1].replace(/\s+/g, ' '), value: m[1].toLowerCase().replace(/\s+/g, ' '), gate: gateable && !/preferred|plus|willing|obtain|within/i.test(s), importance, sentence: s });
    const age = s.match(AGE_RE);
    if (age) push({ kind: 'age', label: `${age[1] || age[2]}+ years old`, value: Number(age[1] || age[2]), gate: true, importance: 'required', sentence: s });
    const lang = s.match(LANG_RE);
    if (lang) {
      const named = lang.slice(1).filter(Boolean).map((x) => x.toLowerCase());
      const other = named.find((x) => x !== 'english') || (/bilingual/i.test(lang[0]) ? 'spanish' : null);
      const lab = other ? `bilingual English/${other.charAt(0).toUpperCase()}${other.slice(1)}` : 'English fluency';
      push({ kind: 'language', label: lab, value: other || 'english', gate: false, importance: PREFERRED_CUE_RE.test(s) ? 'preferred' : importance, sentence: s });
    }
    if (SCHEDULE_CUE_RE.test(s) && (r.kind === 'schedule' || /\b(?:must|required|able|available|availability|willing|including|flexible|open|all\s+employees|expected|hours)\b/i.test(s))) {
      const items = scheduleFacts(s, (rows[rows.indexOf(r) + 1] || {}).sentence || '');
      if (items.length) push({ kind: 'schedule', label: items.join(', '), value: items.join('|'), items, gate: false, importance, sentence: s });
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
  // the title itself: a senior/management role is a seniority constraint
  const t = String(jobTitle || '');
  const rank = /\b(chief|vp|vice president|c-level)\b/i.test(t) ? 6 : /\b(director|head of)\b/i.test(t) ? 5 : /\b(manager|supervisor|principal|staff|lead)\b/i.test(t) && !/\b(assistant\s+manager|shift\s+lead|team\s+lead|lead\s+(?:cashier|associate|barista|teller|server))\b/i.test(t) ? 4 : /\b(senior|sr\.?)\b/i.test(t) ? 3 : 0;
  if (rank >= 4) push({ kind: 'seniority', label: rank >= 5 ? 'director-level role' : 'management-level role', value: rank, gate: true, importance: 'required', sentence: t });
  return out;
}
