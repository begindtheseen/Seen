// Deterministic, KEYLESS job-insights generator — a STRUCTURAL job-description engine.
//
// v2 (structural): instead of ranking single frequency words across the whole document,
// this parses the JD into labeled sections (responsibilities / requirements / preferred /
// benefits / schedule / pay), then runs a battery of pure structured extractors —
// experience, education, licenses & certifications (\b-anchored dictionary), schedule /
// shift signals, physical demands, screening, availability/equipment — the same keyless,
// dictionary + regex + section-parsing approach as lib/server/resumeAnalysis.js. NO
// external AI, no keys, no rate limits, no new deps. Every field is a pure function of the
// input text.
//
// Produces the exact shape the UI + the job_insights cache expect —
// { what_they_want, hidden_requirements, insider_tip, description_summary }.

import { extractJobFacts } from '../optimizer/extractJobFacts.js';
import { requirementSentences, sectionPosting, RULED_OUT_RE, PAY_SENTENCE_RE } from '../optimizer/postingSections.js';
import { displaySkill } from '../optimizer/explainScore.js';
import { cutAtSentence } from '../text/sentences.js';

// ── Text normalisation ───────────────────────────────────────────────────────
// Full flatten (single-line) — used for whole-text signal extraction + the summary.
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Flatten to LINES — converts block/list boundaries to newlines first so the section
// parser can see headings that HTML/markdown expresses structurally. Collapses inline
// whitespace but preserves line breaks.
function stripToLines(s) {
  return String(s || '')
    .replace(/<\s*(?:br|\/p|\/li|\/div|\/tr|\/h[1-6]|li|p|div|h[1-6]|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

// ── Section parser ───────────────────────────────────────────────────────────
// Recognise common JD section headers (case-insensitive; tolerate leading markdown /
// bullets / bold, a trailing colon, and ALL-CAPS). A line that starts with a header is a
// heading; everything after it (until the next heading) belongs to that section. Text
// before any heading — or when no headings exist — is 'body'.
const HEADER_PATTERNS = [
  ['responsibilities', /^(?:key\s+)?(?:responsibilities|duties|essential\s+(?:duties|functions|job\s+functions)|what\s+you(?:’|')?ll\s+do|what\s+you\s+will\s+do|the\s+role|your\s+role|role\s+overview|job\s+duties|day[- ]to[- ]day|a\s+day\s+in\s+the\s+life)\b/i],
  ['requirements', /^(?:requirements|(?:required|minimum|basic)\s+(?:qualifications|requirements)|qualifications|what\s+you\s+bring|what\s+we(?:’|')?re\s+looking\s+for|what\s+we\s+need|must[- ]haves?|who\s+you\s+are|required\s+skills|skills\s+(?:&|and)\s+qualifications|experience\s+(?:&|and)\s+qualifications|you\s+have|you(?:’|')?ll\s+need)\b/i],
  ['preferred', /^(?:preferred(?:\s+qualifications|\s+skills)?|nice[- ]to[- ]haves?|bonus(?:\s+points)?|(?:it(?:’|')?s\s+a\s+)?pluses?|a\s+plus)\b/i],
  ['benefits', /^(?:benefits|perks(?:\s+(?:&|and)\s+benefits)?|what\s+we\s+offer|we\s+offer|why\s+(?:join|work)|compensation\s+(?:&|and)\s+benefits|our\s+benefits)\b/i],
  ['schedule', /^(?:schedule|shifts?|hours|availability|work\s+schedule|shift\s+details)\b/i],
  ['pay', /^(?:pay(?:\s+range|\s+rate)?|compensation|salary(?:\s+range)?|wage|hourly\s+rate)\b/i],
];

function parseSections(description) {
  const lines = stripToLines(description);
  const sections = {};
  const add = (name, text) => { if (text) (sections[name] = sections[name] || []).push(text); };
  let current = 'body';
  for (const line of lines) {
    // Peel leading markdown/bullet/bold decoration before header-matching.
    const stripped = line.replace(/^[#>\-*•▪◦·\s]+/, '').replace(/\*\*/g, '').trim();
    let matched = null;
    for (const [name, re] of HEADER_PATTERNS) {
      const m = stripped.match(re);
      if (m) {
        matched = name;
        current = name;
        // Content that trails the header on the same line ("Requirements: X, Y") is body
        // of that section.
        const rest = stripped.slice(m[0].length).replace(/^\s*[:\-–—]\s*/, '').trim();
        if (rest) add(name, rest);
        break;
      }
    }
    if (!matched) add(current, stripped);
  }
  const out = {};
  // Lines stay lines: a bullet is its own clause, so "Go, Java, C/C++ etc." on one bullet is never
  // read together with the next bullet.
  for (const k of Object.keys(sections)) out[k] = sections[k].join('\n');
  return out;
}

// ── \b-anchored regex helpers ────────────────────────────────────────────────
function has(text, re) { return re.test(text); }

// ── Structured extractors (each pure over the supplied text) ─────────────────

// Experience: the smallest "N+ years" figure that sits near experience-context. A RANGE counts by
// its lower end: "2–12+ years" asks for 2, and reading only the "12+ years" tail of it inflated a
// Stripe posting to "12+ years experience" (2026-10-25).
function extractExperience(text) {
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b([^.]{0,40})/gi;
  let m, best = null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!(n >= 1 && n <= 40)) continue;
    const ctx = (m[2] || '') + ' ' + text.slice(Math.max(0, m.index - 30), m.index);
    if (!/experien|\bexp\b|background|industry|relevant|working|professional|managing|leading|running|building|developing|designing|selling|supporting|hands-on/i.test(ctx)) continue;
    if (best === null || n < best) best = n;
  }
  return best === null ? [] : [`${best}+ years experience`];
}

// Education: return the single highest degree level the JD actually names.
function extractEducation(text) {
  if (/\bmaster'?s?\b(?:\s+degree|\s+of|\s+in)?|\bmba\b|\bm\.s\.|\bm\.a\.|graduate\s+degree/i.test(text)) return ["Master's degree"];
  if (/\bbachelor'?s?\b|\bb\.s\.|\bb\.a\.|undergraduate\s+degree|4[- ]year\s+degree|college\s+degree/i.test(text)) return ["Bachelor's degree"];
  if (/\bassociate'?s?\s+degree|\bassociate\s+degree|\ba\.a\.|\ba\.s\.\s+degree/i.test(text)) return ["Associate's degree"];
  if (/high[- ]school|\bged\b|\bhs\s+diploma\b|high\s+school\s+diploma/i.test(text)) return ['High school diploma / GED'];
  return [];
}

// Licenses & certifications — a \b-anchored dictionary (extends the résumé engine's
// spirit). Specific variants (CDL class, OSHA level) precede their general form. Each
// entry: [regex, display]. Returned in dictionary order, de-duped, capped.
const CERT_TERMS = [
  [/valid\s+driver'?s?\s+licen[cs]e/i, "Valid driver's license"],
  [/\bdriver'?s?\s+licen[cs]e/i, "Driver's license"],
  [/clean\s+(?:driving\s+record|mvr|motor\s+vehicle\s+record)/i, 'Clean driving record'],
  [/class\s*a\s*cdl|\bcdl\b[^.]{0,20}class\s*a/i, 'CDL Class A'],
  [/class\s*b\s*cdl|\bcdl\b[^.]{0,20}class\s*b/i, 'CDL Class B'],
  [/\bcdl\b/i, 'CDL'],
  [/forklift\s+(?:certif|licen|operat)/i, 'Forklift certification'],
  [/\bosha\s*10\b/i, 'OSHA 10'],
  [/\bosha\s*30\b/i, 'OSHA 30'],
  [/\bosha\b/i, 'OSHA certification'],
  [/servsafe/i, 'ServSafe certification'],
  [/food\s+handler'?s?\s*(?:card|permit|certif)?/i, "Food handler's card"],
  [/\btips\s+certif|\btips\s+certified|tips\s+alcohol/i, 'TIPS certification'],
  [/\bbls\b/i, 'BLS'],
  [/\bacls\b/i, 'ACLS'],
  [/\bpals\b/i, 'PALS'],
  [/\bcpr\b/i, 'CPR certification'],
  [/\brn\s+licen[cs]e|registered\s+nurse\s+licen[cs]e|\brn\b(?=[^.]{0,15}licen)/i, 'RN license'],
  [/\bcna\b/i, 'CNA license'],
  [/\blvn\b|\blpn\b/i, 'LVN/LPN license'],
  [/\btwic\b/i, 'TWIC card'],
  [/security\s+guard\s+(?:card|licen)|\bguard\s+card\b/i, 'Security guard card'],
  [/cosmetology\s+(?:licen|certif)/i, 'Cosmetology license'],
  [/\bepa\s*608\b|epa\s+(?:universal|certif)/i, 'EPA 608 certification'],
  [/\base\s+certif|\base\b(?=[^.]{0,15}certif)/i, 'ASE certification'],
];
function extractCertifications(text) {
  const out = [];
  const seen = new Set();
  for (const [re, display] of CERT_TERMS) {
    if (out.length >= 5) break;
    if (re.test(text) && !seen.has(display)) { out.push(display); seen.add(display); }
  }
  // "Driver's license" is redundant once "Valid driver's license" is present.
  if (seen.has("Valid driver's license")) {
    const i = out.indexOf("Driver's license");
    if (i !== -1) out.splice(i, 1);
  }
  return out;
}

// Schedule / shift signals. Returns display labels; a literal time range in the text is
// appended to the first shift label when present ("2nd shift (2:30pm–11pm)").
const SHIFT_TERMS = [
  [/\b(?:1st|first)\s+shift/i, '1st shift'],
  [/\b(?:2nd|second)\s+shift/i, '2nd shift'],
  [/\b(?:3rd|third)\s+shift/i, '3rd shift'],
  [/\bnight\s+shift/i, 'Night shift'],
  [/\bovernight\b|\bgraveyard\b/i, 'Overnight shift'],
  [/\bswing\s+shift/i, 'Swing shift'],
];
const SCHEDULE_TYPE_TERMS = [
  [/\bpart[\s-]?time\b/i, 'Part-time'],
  [/\bfull[\s-]?time\b/i, 'Full-time'],
  [/\bseasonal\b/i, 'Seasonal'],
  [/\btemp(?:orary)?\b/i, 'Temporary'],
];
function extractSchedule(text) {
  const out = [];
  const timeRange = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  for (const [re, label] of SHIFT_TERMS) {
    if (re.test(text)) {
      out.push(out.length === 0 && timeRange ? `${label} (${timeRange[1].replace(/\s+/g, '')}–${timeRange[2].replace(/\s+/g, '')})` : label);
    }
  }
  if (/\bweekends?\b[^.]{0,25}(?:required|availab|must|mandatory)|(?:available|work|must\s+work)[^.]{0,15}weekends?\b/i.test(text)) {
    out.push('Weekend availability required');
  }
  for (const [re, label] of SCHEDULE_TYPE_TERMS) {
    if (re.test(text) && !out.includes(label)) out.push(label);
  }
  return out;
}
// The schedule labels that are a SHIFT commitment (a named shift or required weekends). Full-time /
// part-time / seasonal say how much you work, not when — "Full-time" on a $70k social-media role
// produced "The schedule is fixed — the shift is non-negotiable" (2026-10-25).
function shiftCommitments(schedule) {
  return schedule.filter(s => !SCHEDULE_TYPE_TERMS.some(([, label]) => label === s));
}
// Does the posting itself talk about shifts or schedules? Every shift/schedule claim needs this.
const SCHEDULE_MENTION_RE = /\b(?:shifts?|schedul(?:e|es|ed|ing)|weekends?|overnights?|graveyard|nights?|on[- ]call|rotating|overtime|(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)))\b/i;
export function postingMentionsSchedule(text) { return SCHEDULE_MENTION_RE.test(String(text || '')); }

// Physical demands.
function extractPhysical(text) {
  const out = [];
  const lift = text.match(/lift(?:ing)?\s*(?:up\s+to\s*)?(\d{2,3})\s*(?:lbs?|pounds)/i);
  if (lift) out.push(`Able to lift ${lift[1]} lbs`);
  if (/stand(?:ing)?\s+for\s+(?:long|extended)|on\s+your\s+feet|prolonged\s+standing/i.test(text)) out.push('Comfortable standing for long periods');
  if (/repetitive\s+(?:motion|movement|task|bending)|bending,?\s+twisting/i.test(text)) out.push('Repetitive physical tasks');
  return out;
}

// Pre-employment screening.
function extractScreening(text) {
  const out = [];
  if (/background\s+(?:check|screen|investigation)/i.test(text)) out.push('Background check');
  if (/drug\s+(?:test|screen)/i.test(text)) out.push('Drug screening');
  const age = text.match(/\b(?:must\s+be\s+(?:at\s+least\s+)?)?(18|21)\s*(?:\+|years?|or\s+older|and\s+over|and\s+older)\b/i);
  if (age) out.push(`Must be ${age[1]}+`);
  return out;
}

// Availability / equipment.
function extractAvailability(text) {
  const out = [];
  if (/reliable\s+transportation/i.test(text)) out.push('Reliable transportation');
  if (/own\s+(?:vehicle|car)|use\s+of\s+(?:a|your)\s+(?:car|vehicle)|provide\s+your\s+own\s+(?:car|vehicle)/i.test(text)) out.push('Own vehicle');
  if (/own\s+tools|provide\s+your\s+own\s+tools|bring\s+your\s+own\s+tools/i.test(text)) out.push('Own tools');
  if (/smartphone\s+(?:required|access)|own\s+(?:a\s+)?smartphone/i.test(text)) out.push('Smartphone required');
  return out;
}

// ── Hidden-requirement pattern heuristics (unchanged from v1) ────────────────
const HIDDEN_PATTERNS = [
  { re: /\b(fast[- ]paced|move fast|rapidly|high[- ]growth|hyper[- ]?growth|startup)\b/i, req: 'Comfort with ambiguity and rapid change — priorities shift fast and you won’t always get full context.' },
  { re: /\b(wear many hats|jack of all|generalist|scrappy|roll up your sleeves|do whatever it takes)\b/i, req: 'You’ll own work well outside your title — they want a generalist who fills gaps, not a narrow specialist.' },
  { re: /\b(self[- ]starter|self[- ]motivated|autonomous|minimal supervision|ownership|proactive|take initiative)\b/i, req: 'Minimal hand-holding — you’re expected to find the work and drive it without being told.' },
  { re: /\b(cross[- ]functional|stakeholder|partner with|liais|collaborat|influence)\b/i, req: 'Heavy coordination — success depends on influencing teams and people you don’t manage.' },
  { re: /\b(deadline|under pressure|tight timeline|high[- ]volume|quota|kpi|target|metric)\b/i, req: 'Performance is measured and visible — expect real pressure to hit numbers and timelines.' },
  { re: /\b(detail[- ]oriented|attention to detail|accuracy|meticulous|precise)\b/i, req: 'Low tolerance for small mistakes — the work is scrutinized for accuracy.' },
  // ("flexible hours" is a perk, not a demand — it used to read as "non-standard hours")
  { re: /\b(on[- ]call|nights|weekends|shift work|rotating shifts?|overtime)\b/i, req: 'Non-standard hours are part of the job — check the schedule the posting describes before you apply.' },
  { re: /\b(\d+\+?\s*years|senior|lead|principal|staff|expert level)\b/i, req: 'They’re hiring for a proven track record, not potential — show you’ve done this exact thing before.' },
  { re: /\b(communicat|written|verbal|present|articulate|stakeholder updates)\b/i, req: 'Communication is graded as much as the core skill — sloppy writing or speaking will cost you.' },
  { re: /\b(bilingual|spanish|mandarin|multilingual)\b/i, req: 'A second language is a real differentiator here even when it’s listed as “preferred.”' },
];

// Build hidden requirements: signal-derived (concrete, most-specific) FIRST, then the
// language-pattern heuristics, then safe fallbacks. Cap 3.
function detectHidden(text, signals) {
  const out = [];
  const push = v => { if (v && out.length < 3 && !out.includes(v)) out.push(v); };

  const shifts = shiftCommitments(signals.schedule);
  if (shifts.length) {
    push(/^weekend/i.test(shifts[0])
      ? 'The posting requires weekend availability — confirm it fits your life before you apply.'
      : (() => { const w = shifts[0].replace(/\s+shift\b/i, '').toLowerCase(); return `The posting names ${/^[aeio]/.test(w) ? 'an' : 'a'} ${w} shift — confirm that schedule fits your life before you apply.`; })());
  }
  if (signals.physical.length) {
    push(`Real physical demands — ${signals.physical.map(p => p.toLowerCase()).join(', ')}. The work is tiring by design, so weigh the stamina expectation honestly.`);
  }
  const checks = signals.screening.filter(s => /check|screen/i.test(s));
  const minAge = signals.screening.find(s => /^must be/i.test(s));
  if (checks.length) {
    push(`Expect a ${checks.map(s => s.toLowerCase()).join(' and ')} — line up your documentation early so it doesn’t stall your start date.`);
  }
  if (minAge) {
    push(`${minAge} is a hard gate — the posting screens on age, so it’s non-negotiable.`);
  }

  for (const p of HIDDEN_PATTERNS) {
    if (out.length >= 3) break;
    if (p.re.test(text)) push(p.req);
  }
  const fallback = [
    'Culture fit weighs as much as skills — show you understand what the company actually does.',
    'You don’t need to match every bullet — the list describes the ideal, not the minimum.',
    'Speed matters — early, tailored applications get reviewed before the pile grows.',
  ];
  for (const f of fallback) { if (out.length >= 3) break; push(f); }
  return out.slice(0, 3);
}

// Words that carry no signal as "what they want" — generic filler adverbs, hiring
// boilerplate, and posting scaffolding.
const INSIGHTS_FILLER = new Set([
  'perhaps', 'various', 'supplemental', 'additionally', 'currently', 'typically',
  'approximately', 'really', 'actually', 'generally', 'usually', 'especially',
  'opportunity', 'opportunities', 'position', 'positions', 'role', 'roles', 'job',
  'jobs', 'candidate', 'candidates', 'applicant', 'applicants', 'ability', 'able',
  'must', 'will', 'including', 'required', 'requirements', 'preferred', 'looking',
  'seeking', 'join', 'apply', 'work', 'working', 'day', 'days', 'week', 'time',
  'member', 'members', 'people', 'person', 'right', 'great', 'good', 'strong',
  'employer', 'employee', 'employees', 'benefits', 'pay', 'wage', 'hour', 'hours',
  'environment', 'location', 'store', 'please',
]);

// Generic franchise/corporate words that are never useful "keywords" when they arrive as
// part of a company name.
const COMPANY_GENERIC = ['franchise', 'inc', 'llc', 'corp', 'group', 'company'];

// ── Phrase-mining stopwords (for requirements-section noun phrases) ──────────
const PHRASE_STOP = new Set([
  'the','and','or','a','an','to','of','in','on','for','with','at','by','from','as','is',
  'are','be','been','being','was','were','will','would','can','could','should','may',
  'might','shall','must','have','has','had','do','does','did','you','your','yours','we',
  'our','they','their','them','this','that','these','those','it','its','if','but','so',
  'not','no','nor','than','then','into','out','up','down','off','over','under','per','via',
  'etc','also','all','any','each','who','what','when','where','which','while','about',
  'across','both','other','such','same','only','own','more','most','some','few','very',
  'plus','strong','excellent','great','good','ideal','ideally','minimum','equivalent',
  'related','field','fields','degree','new','fast','paced','self','driven','detail',
  'oriented','bonus','nice','full','part','please','www','http','https','com',
  // structured-signal words that must never surface as a mined noun phrase — they are
  // captured by dedicated extractors (experience/education) or are pure boilerplate.
  'experience','experienced','years','year','skills','skill','qualifications',
  'responsibilities','duties','team','teams','company','want','need','needs','provide',
  'ensure','support','looking','seeking','join','apply','required','preferred','ability',
  'able','including','various','opportunity','candidate','candidates','role','position',
  // words already captured by dedicated structured extractors (physical / screening /
  // schedule) — dropping them from phrase mining prevents low-value duplicate phrases.
  'periods','period','background','drug','screen','screening','check','pass','older',
  'prior','repeatedly','stand','standing','lift','lifting','shift','shifts',
  ...INSIGHTS_FILLER,
]);

// ── Token helpers (mirror resumeAnalysis crude rules) ────────────────────────
function singularize(s) {
  if (s.length > 4 && s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.length > 3 && s.endsWith('es')) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}
function variantsOf(tok) {
  const sing = singularize(tok);
  const out = new Set([tok, sing]);
  out.add(tok.endsWith('s') ? tok : tok + 's');
  out.add(sing.endsWith('s') ? sing : sing + 's');
  return out;
}
function normalizeCompanyTokens(company) {
  const cleaned = String(company || '')
    .toLowerCase()
    .replace(/[’'`]s\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set();
  for (const tok of cleaned) {
    if (tok.length < 2) continue;
    for (const v of variantsOf(tok)) out.add(v);
  }
  for (const g of COMPANY_GENERIC) for (const v of variantsOf(g)) out.add(v);
  return out;
}
function capitalizeKeyword(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function titleCasePhrase(s) {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Multi-word noun-phrase mining (requirements section ONLY) ────────────────
// Walk runs of consecutive content words (dropping stopwords/filler/company/title tokens)
// and emit the bigrams/trigrams that appear intact. NEVER single frequency words.
function minePhrases(requirementsText, isExcluded) {
  if (!requirementsText) return [];
  const isContent = w => {
    const clean = w.replace(/^[-]+|[-]+$/g, '');
    if (clean.length < 3) return false;
    if (/^\d+$/.test(clean)) return false;
    if (PHRASE_STOP.has(clean) || PHRASE_STOP.has(singularize(clean))) return false;
    if (isExcluded(clean)) return false;
    return true;
  };

  // Split into clauses on sentence / list / bullet punctuation FIRST so a mined phrase
  // can never straddle a boundary ("…long periods. Forklift…" must not yield "periods
  // forklift"). Within a clause, a stopword/filler/excluded word also breaks the run.
  const counts = new Map();
  const clauses = String(requirementsText).toLowerCase().split(/[.,;:!?()\[\]"“”]|\s[-–—/&]\s|\n/);
  for (const clause of clauses) {
    const words = clause.replace(/[^a-z0-9+#\s-]/g, ' ').split(/\s+/).filter(Boolean);
    let run = [];
    const flush = () => {
      for (let i = 0; i < run.length; i++) {
        if (i + 1 < run.length) { const bi = `${run[i]} ${run[i + 1]}`; counts.set(bi, (counts.get(bi) || 0) + 1); }
        if (i + 2 < run.length) { const tri = `${run[i]} ${run[i + 1]} ${run[i + 2]}`; counts.set(tri, (counts.get(tri) || 0) + 1); }
      }
      run = [];
    };
    for (const w of words) {
      if (isContent(w)) run.push(w.replace(/^[-]+|[-]+$/g, ''));
      else flush();
    }
    flush();
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 8)
    .map(([phrase]) => titleCasePhrase(phrase));
}

// ── insider_tip (tiered) ──────────────────────────────────────────────────────
function insiderTip(title, recognizedSkills, certifications, schedule, alternatives = []) {
  const t = (title || '').toLowerCase();
  // Tier 1: ≥2 recognized hard skills → mirror ONLY those exact terms. (unchanged)
  const choiceFirst = alternatives.find(g => g.length >= 2);
  if (recognizedSkills.length >= 2) {
    const also = choiceFirst ? ` For the choice they offer, they accept any of ${choiceFirst.join(', ')} — name the one(s) you actually use.` : '';
    return `Mirror these exact terms — ${recognizedSkills.slice(0, 3).join(', ')} — in your résumé and application; most first-pass filters scan for them verbatim.${also}`;
  }
  // Tier 1b: the posting offers a choice ("Go, Java, C/C++ etc.") → name the one(s) you really use.
  const choice = alternatives.find(g => g.length >= 2);
  if (choice) {
    return `They accept any of ${choice.join(', ')} — name the one(s) you actually use, in the posting's exact spelling, in your résumé and application. You don't need all of them.`;
  }
  // Tier 2: a license/cert was extracted → put it in the résumé headline.
  if (certifications.length >= 1) {
    return `Put your ${certifications[0]} in your résumé headline and the first line of your application — for this kind of role, screeners filter for that credential before anything else.`;
  }
  // Tier 3: a SHIFT commitment was extracted (not just "full-time") → lead with shift availability.
  const shifts = shiftCommitments(schedule);
  if (shifts.length >= 1) {
    return `State your ${shifts[0].replace(/ required$/i, '').toLowerCase()} availability in the very first line of your application — this posting names its schedule, so shift fit is screened early.`;
  }
  if (/\b(senior|lead|principal|manager|director|head)\b/.test(t)) {
    return 'Lead with measurable impact — numbers, scope, outcomes. At this level they screen for proven results, not a list of responsibilities.';
  }
  return 'Tailor your opening line to this exact role and company — generic applications get filtered before a human ever reads them.';
}

// ── description_summary ────────────────────────────────────────────────────────
// What the job is (the posting's own first sentences about the ROLE, never the company blurb), what
// it asks for (the same items as what_they_want) and the pay the posting states, in whole sentences.
// The old summary was the first cue-word sentences sliced at 1,200 characters — "Help define whether
// new da" on Kunai's listing — and it REPLACED "About this role", hiding the requirements and the
// $140–170k pay (2026-10-25). It is never cut mid-word (lib/text/sentences.js cutAtSentence).
const ROLE_SENTENCE_RE = /\b(?:[Yy]ou(?:'|\u2019)?ll|[Yy]ou will|[Tt]his role|in this role|as (?:a|an|the) [A-Z]|[Ww]e(?:'|\u2019)re looking for|[Ww]e are looking for|(?:[Tt]he|[Tt]his|[Oo]ur) [A-Z][\w&-]*(?: (?:&|[A-Z][\w&-]*)){0,5} will)\b/;
function summarize(title, company, description, what = []) {
  if (stripHtml(description).length < 80) return '';
  const rows = sectionPosting(stripToLines(description).join('\n'));
  // a board slug ("kunai") reads as a name
  const co = /^[a-z][a-z0-9]*$/.test(String(company || '')) ? company.charAt(0).toUpperCase() + company.slice(1) : company;
  const role = title ? `${title}${co ? ` at ${co}` : ''}` : 'This role';
  // one sentence that says what the job is, then the first duties
  const ok = (s) => s.length >= 30 && !PAY_SENTENCE_RE.test(s) && !RULED_OUT_RE.test(s);
  const intro = rows.find(r => (r.kind === 'about' || r.kind === 'culture' || r.kind === 'responsibilities') && ok(r.sentence) && ROLE_SENTENCE_RE.test(r.sentence));
  const duties = rows.filter(r => r.kind === 'responsibilities' && r !== intro && ok(r.sentence));
  const roleSents = [intro, ...duties].filter(Boolean).slice(0, 2).map(r => cutAtSentence(r.sentence, 260));
  const pay = rows.find(r => PAY_SENTENCE_RE.test(r.sentence) && /\d/.test(r.sentence));
  const end = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);
  const parts = [`${role}.`, ...roleSents.map(end)];
  if (what.length) parts.push(`What it asks for: ${what.join('; ')}.`);
  if (pay) parts.push(`Pay: ${end(cutAtSentence(pay.sentence, 240).replace(/^(?:compensation|pay|salary)\s*:?\s*/i, ''))}`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ── Recognized hard skills — DOMAIN-GATED dictionaries ───────────────────────
// The old flat dictionary matched a software/data cluster against EVERY job, so a Target
// loss-prevention posting reported "AWS / REST APIs / Go" because `aws` matched the substring
// inside "l·aws", `\brest\b` matched the word "rest", and `\bgo\b` matched the word "go".
// Fix: (1) anchor the ambiguous tokens (aws → \baws\b; REST only near "api"/"restful"; Go only
// as golang/"go programming"); (2) split the dictionary by DOMAIN and only run the software or
// clinical block when the JD's detected role family actually is technical / clinical. A
// retail, security, or warehouse JD never evaluates AWS/Kubernetes/Go. Cross-industry business
// tools (Excel, Salesforce, OSHA, CDL, customer service, …) stay available to every role.
const SKILL_TERMS_TECH = [
  ['python','Python'],['java\\b','Java'],['javascript','JavaScript'],['typescript','TypeScript'],['react','React'],['node\\.?js|node\\b','Node.js'],['\\baws\\b|amazon web services','AWS'],['azure','Azure'],['google cloud|gcp','GCP'],['kubernetes|k8s','Kubernetes'],['docker','Docker'],['terraform','Terraform'],['ci/cd|ci ?cd','CI/CD'],['postgres(ql)?','PostgreSQL'],['mysql','MySQL'],['mongodb','MongoDB'],['\\bsql\\b','SQL'],['graphql','GraphQL'],['rest(?:ful)? api|\\brestful\\b','REST APIs'],['\\bgit\\b','Git'],['linux','Linux'],['c\\+\\+','C++'],['c#|\\.net','C#/.NET'],['\\bgolang\\b|\\bgo\\s+(?:programming|developer|lang)\\b|(?:^|[\\s(:])go(?=\\s*(?:,|/|\\bor\\b|\\band\\b)\\s*(?:java|python|rust|ruby|scala|kotlin|c\\+\\+|c/c\\+\\+|c#|typescript|javascript|node))|(?:java|python|rust|ruby|scala|kotlin|c\\+\\+|c#|typescript|javascript)\\s*(?:,|/|\\bor\\b|\\band\\b)\\s*go\\b(?!\\s+(?:to|out|above|beyond|through))','Go'],['ruby','Ruby'],['\\bphp\\b','PHP'],['swift','Swift'],['kotlin','Kotlin'],['tableau','Tableau'],['power ?bi','Power BI'],['figma','Figma'],['kafka','Kafka'],['spark','Spark'],['machine learning|\\bml\\b','Machine Learning'],
];
const SKILL_TERMS_CLINICAL = [
  ['\\bbls\\b','BLS'],['\\bacls\\b','ACLS'],['\\bpals\\b','PALS'],['\\bcpr\\b','CPR'],['\\behr\\b|electronic health record','EHR'],['\\bepic\\b','Epic (EHR)'],['cerner','Cerner'],['hipaa','HIPAA'],['phlebotomy','Phlebotomy'],['\\bekg\\b|\\becg\\b','EKG'],['\\biv\\b|intravenous','IV therapy'],['patient care','Patient care'],['medication administration','Medication administration'],
];
// Cross-industry business tools & credentials — unambiguous, relevant across many roles, so
// always evaluated. Excel is anchored so "excel at …" can't false-positive; SAP requires ERP
// context so the English word "sap" can't.
const SKILL_TERMS_CROSS = [
  ['salesforce','Salesforce'],['sap erp|sap hana|sap fico|sap ariba|\\bsap\\b(?=\\s+(?:erp|hana|fico|ariba|system|software|s/4))','SAP'],
  ['\\bgaap\\b','GAAP'],['quickbooks','QuickBooks'],['\\bcpa\\b','CPA'],['financial model','Financial modeling'],['forecast','Forecasting'],['reconcil','Reconciliation'],['payroll','Payroll'],['microsoft excel|ms excel|\\bexcel\\b(?!\\s+(?:at|in|as|with)\\b)','Excel'],['microsoft office|ms office','Microsoft Office'],
  ['\\bosha\\b','OSHA'],['\\bhvac\\b','HVAC'],['electrical','Electrical'],['plumbing','Plumbing'],['welding','Welding'],['blueprint','Blueprint reading'],['forklift','Forklift'],['\\bcdl\\b','CDL'],['\\base\\b certif','ASE certification'],
  ['bilingual|spanish','Bilingual (Spanish)'],['project management|\\bpmp\\b','Project management'],['customer service','Customer service'],
];

// Which dictionary blocks may run for a detected role family. The family-specific block first
// (so its hard skills rank ahead of generic cross-tools), then the always-on cross block.
function allowedSkillGroups(family) {
  if (family === 'software_engineering' || family === 'data_analytics') return [SKILL_TERMS_TECH, SKILL_TERMS_CROSS];
  if (family === 'healthcare_support') return [SKILL_TERMS_CLINICAL, SKILL_TERMS_CROSS];
  return [SKILL_TERMS_CROSS];
}

// Every dictionary display → the regex that proves it is in a text (the post-check reuses these).
const SKILL_PATTERNS = new Map(
  [...SKILL_TERMS_TECH, ...SKILL_TERMS_CLINICAL, ...SKILL_TERMS_CROSS].map(([pat, display]) => [display, new RegExp(pat, 'i')]),
);

// A clause that offers CHOICES: "Go, Java, C/C++ etc.", "Python or Ruby", "a language like Java".
// Its skills are alternatives — any one of them — never each a hard requirement (2026-10-25: a
// Stripe posting's "Go, Java, C/C++ etc." came out as hard "Java, C++").
const ALTERNATIVE_CUE_RE = /\b(?:or|etc|e\.g|eg|such as|like|one of|any of|at least one|similar|equivalent|comparable|and\/or)\b/i;
// Slashes that are part of one skill's name, not a choice between two.
const SKILL_SLASH_RE = /\bc\/c\+\+|\bci\/cd\b|\bpl\/sql\b|\btcp\/ip\b|\bui\/ux\b|\bap\/ar\b|and\/or/gi;
function singleSkillHedged(re, lowerClause) {
  if (!re) return false;
  const m = new RegExp(re.source, 'i').exec(lowerClause);
  if (!m) return false;
  const before = lowerClause.slice(Math.max(0, m.index - 30), m.index);
  const after = lowerClause.slice(m.index + m[0].length, m.index + m[0].length + 30);
  return /\b(?:such as|like|e\.g\.?|eg|for example|one of|any of)\s+(?:[a-z0-9+#./-]+\s+){0,2}$/.test(before)
    || /^\s*,?\s*(?:or\s+(?:a\s+)?(?:similar|equivalent|comparable|another|other)|etc\b|and\/or)/.test(after);
}
function splitClauses(text) {
  // Sentence ends ("etc." is not one), semicolons, bullets and line breaks bound a clause.
  return String(text || '').split(/(?<!\betc)(?<!\be\.g)\.(?=\s|$)|[;\n•▪◦]/i).map(c => c.trim()).filter(Boolean);
}

// Recognized hard skills over the requirement text, split into stated skills and alternative
// groups. { skills: [display] (dictionary order, ≤5), alternatives: [[display, …]] (posting order, ≤2) }.
function extractSkills(text, family = 'general') {
  const groups = allowedSkillGroups(family);
  const order = new Map(groups.flat().map(([, display], i) => [display, i]));
  const claimed = new Set();
  const skills = [];
  const alternatives = [];
  for (const clause of splitClauses(text)) {
    const lower = clause.toLowerCase();
    const at = new Map();
    for (const group of groups) {
      for (const [pat, display] of group) {
        const m = new RegExp(pat, 'i').exec(lower);
        if (m && !at.has(display)) at.set(display, m.index);
      }
    }
    // the posting's own order ("Go, Java, C/C++"), not the dictionary's
    let inClause = [...at.keys()].sort((a, b) => at.get(a) - at.get(b));
    // "C/C++" is one entry, not "C++" twice over
    if (/\bc\/c\+\+/i.test(clause) && inClause.includes('C++')) inClause = inClause.map(d => (d === 'C++' ? 'C/C++' : d));
    inClause = inClause.filter(d => !claimed.has(d));
    if (!inClause.length) continue;
    const plain = lower.replace(SKILL_SLASH_RE, ' ').replace(/\b(?:would|'d|’d)\s+like\b/g, ' ');
    // Two or more skills in a clause that offers a choice ("Go, Java, C/C++ etc.", "Python or
    // Ruby", "Java/Kotlin") are alternatives. ONE skill is an alternative only when the hedge sits
    // right next to it ("a language like Java", "Java or similar") — a stray "or" elsewhere in the
    // sentence does not soften a stated skill.
    const choice = inClause.length >= 2
      ? ALTERNATIVE_CUE_RE.test(plain) || /\//.test(plain)
      : singleSkillHedged(SKILL_PATTERNS.get(inClause[0]) || null, lower);
    if (choice) {
      alternatives.push(inClause);
    } else {
      skills.push(...inClause);
    }
    inClause.forEach(d => claimed.add(d));
  }
  // A skill stated outright anywhere is a stated skill; drop it from any choice list.
  const stated = new Set(skills);
  const alts = alternatives.map(g => g.filter(d => !stated.has(d))).filter(g => g.length);
  skills.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  return { skills: skills.slice(0, 5), alternatives: alts.slice(0, 2) };
}

// Display one alternative group: "Any of: Go, Java, C/C++" (or "Python (or similar)").
function alternativeLabel(group) {
  return group.length === 1 ? `${group[0]} (or similar)` : `Any of: ${group.join(', ')}`;
}

// ── Deterministic post-check: nothing the insight claims may be missing from the posting ──────
// Every recognized skill (alone or in an "Any of" list) must match the posting text, every
// "N+ years" figure must be a number the posting puts next to "years", and every shift/schedule
// claim needs the posting to mention a shift or schedule. Anything that fails is dropped.
const SCHEDULE_CLAIM_RE = /\b(?:shifts?|schedules?|weekends?|non-standard hours|availability)\b/i;
function skillInPosting(display, lowerText) {
  if (display === 'C/C++') return /\bc\/c\+\+/i.test(lowerText);
  const re = SKILL_PATTERNS.get(display);
  return re ? re.test(lowerText) : null; // null = not a dictionary skill
}
function yearsInPosting(n, text) {
  return new RegExp(`(?<!\\d)${n}(?!\\d)\\s*\\+?\\s*(?:(?:-|–|—|to)\\s*\\d{1,2}\\s*\\+?\\s*)?(?:years?|yrs?)\\b`, 'i').test(text);
}
// `readNames`: skill names the shared reader found WITH evidence in this posting (buildJobInsights
// passes them) — the regex dictionary alone dropped Go from "Go as your primary/preferred language".
export function verifyInsightAgainstPosting(insight, description, readNames = null) {
  const read = new Set((readNames || []).map(n => String(n).toLowerCase()));
  const text = stripHtml(description);
  const lower = text.toLowerCase();
  const what = [];
  for (const item of insight.what_they_want || []) {
    const any = /^Any of: (.+)$/.exec(item);
    if (any) {
      const kept = any[1].split(', ').filter(d => read.has(d.toLowerCase()) || skillInPosting(d, lower) !== false);
      if (kept.length >= 2) what.push(`Any of: ${kept.join(', ')}`);
      else if (kept.length === 1) what.push(`${kept[0]} (or similar)`);
      continue;
    }
    const similar = /^(.+) \(or similar\)$/.exec(item);
    const years = /^(\d{1,2})\+ years? (?:experience$|of |in |as |managing |leading |building |doing |working |running |selling |supporting |operating |teaching )/.exec(item);
    if (years) { if (yearsInPosting(years[1], text)) what.push(item); continue; }
    const name = (similar ? similar[1] : item).replace(/ \((?:e\.g\. .*|preferred)\)$/, '');
    if (!read.has(name.toLowerCase()) && skillInPosting(name, lower) === false) continue;
    what.push(item);
  }
  const scheduleOk = postingMentionsSchedule(text);
  const hidden = (insight.hidden_requirements || []).filter(h => scheduleOk || !SCHEDULE_CLAIM_RE.test(h));
  let tip = insight.insider_tip || '';
  if (!scheduleOk && SCHEDULE_CLAIM_RE.test(tip)) tip = 'Tailor your opening line to this exact role and company — generic applications get filtered before a human ever reads them.';
  return { ...insight, what_they_want: [...new Set(what)], hidden_requirements: hidden, insider_tip: tip };
}

// ── Main entry — pure + deterministic ─────────────────────────────────────────
// v4 (2026-10-25): ONE requirement reader. "What they want" comes from the same reader the fit
// check, Optimize and the Studio use (lib/optimizer/extractJobFacts.js over
// lib/optimizer/postingSections.js), so every paid tool agrees on what a posting asks for. The old
// line-based section parser saw no headings in a flat stored posting (every Greenhouse row), so it
// read skills from the whole text — "machine learning models" from Stripe's "About the team" — and
// a Groupon posting with a "Key Requirements" section came out as the filler "Relevant experience".
// Choices stay one item ("Any of: Go, Java, C/C++"); examples stay with their skill ("Event-driven
// architecture (e.g. Kafka, change data capture (CDC))"); preferred items are labelled and last;
// a sentence that rules a requirement out ("this role does not [need PALS]") or belongs to another
// posting ("our sister company is hiring CDL-A drivers") is never read. No filler, ever: a posting
// with no stated requirement answers `read: false` and an empty list, which is never charged for
// or cached (api/job-insights.js).
function skillName(f, { lower = false } = {}) {
  if (f.normalizedLabel === 'c++' && (f.postingPhrases || []).includes('c/c++')) return 'C/C++';
  const d = displaySkill(f.normalizedLabel);
  return lower ? d : capitalizeKeyword(d);
}
function requirementText(description) {
  return requirementSentences(stripToLines(description).join('\n'))
    .filter(r => !RULED_OUT_RE.test(r.sentence))
    .map(r => r.sentence).join('\n');
}

export function buildJobInsights({ title, company, description, needsSummary = true } = {}) {
  const text = stripHtml(description);
  const lineText = stripToLines(description).join('\n');
  const facts = extractJobFacts(lineText, { jobTitle: title || '' });
  // Text the structured extractors (certifications, schedule, physical, screening) read: the
  // requirement / duty / schedule sentences only, never the company blurb or another posting.
  const signalText = requirementText(description);

  const skills = facts.filter(f => f.factType === 'skill' && !f.soft);
  const constraints = facts.filter(f => f.factType === 'constraint');
  const byLabel = new Map(skills.map(f => [f.normalizedLabel, f]));

  // One display item per requirement: a choice is one "Any of" item, examples ride with their skill.
  const used = new Set();
  const skillItem = (f) => {
    if (used.has(f.normalizedLabel)) return null;
    if (f.exampleOf && byLabel.has(f.exampleOf)) return null; // shown with the skill it illustrates
    if (f.anyOf && f.anyOfLabels && f.anyOfLabels.length >= 2) {
      const members = f.anyOfLabels.map(l => byLabel.get(l)).filter(Boolean);
      members.forEach(m => used.add(m.normalizedLabel));
      return { text: `Any of: ${members.map(skillName).join(', ')}`, group: members.map(skillName) };
    }
    used.add(f.normalizedLabel);
    const ex = (f.examples || []).map(l => byLabel.get(l)).filter(Boolean);
    ex.forEach(m => used.add(m.normalizedLabel));
    const name = skillName(f);
    const exNames = ex.map((m) => skillName(m, { lower: true }));
    const exList = exNames.length > 1 ? `${exNames.slice(0, -1).join(', ')} or ${exNames[exNames.length - 1]}` : exNames[0];
    return { text: ex.length ? `${name} (e.g. ${exList})` : f.orSimilar ? `${name} (or similar)` : name, single: name };
  };
  const rankSkill = (a, b) => (Number(b.hard) - Number(a.hard)) || (b.weight - a.weight) || ((b.mentions || 0) - (a.mentions || 0));
  const required = skills.filter(f => f.importance === 'required').sort(rankSkill);
  const preferred = skills.filter(f => f.importance !== 'required').sort(rankSkill);

  // a language is shown once, as the reader's language constraint ("Bilingual English/Spanish")
  if (constraints.some(c => c.kind === 'language')) for (const f of skills) if (/^bilingual\b/.test(f.normalizedLabel)) used.add(f.normalizedLabel);
  const hardItems = required.filter(f => f.hard).map(skillItem).filter(Boolean);
  const dutyItems = required.filter(f => !f.hard).map(skillItem).filter(Boolean);
  const prefItems = preferred.map(skillItem).filter(Boolean);

  // Credentials: the display dictionary first ("Valid driver's license", "CPR certification"), then
  // any licence the reader found that the dictionary has no entry for ("EPA 608 Universal").
  // In the posting's order (an RN license before BLS), each with its display name when the
  // dictionary has one.
  const dict = extractCertifications(signalText);
  const certifications = [];
  const coveredDict = new Set();
  // the same credential named two ways ("Food handler's card" / "ServSafe Food Handler card"):
  // the shorter name's words, minus the generic ones, are all in the longer
  const certWords = (t) => t.toLowerCase().replace(/['\u2019]s\b/g, '').split(/[^a-z0-9]+/).filter((w) => w && !/^(?:certification|certified|card|license|licence|permit|valid|current|active|a|an|the)$/.test(w));
  const sameCert = (a, b) => { const [x, y] = [certWords(a), certWords(b)].sort((p, q) => p.length - q.length); return x.length > 0 && x.every((w) => y.includes(w)); };
  for (const c of constraints.filter(x => x.kind === 'certification' && x.importance === 'required')) {
    // one display name for one credential: the dictionary's when exactly one entry is this licence,
    // the posting's own name when it covers several ("ServSafe Food Handler card")
    const hits = dict.filter(d => sameCert(d, c.label));
    const shown = hits.length === 1 ? hits[0] : c.label.replace(/^\w/, ch => ch.toUpperCase());
    hits.forEach(h => coveredDict.add(h));
    if (!certifications.some(x => sameCert(x, shown))) certifications.push(shown);
  }
  for (const d of dict) if (!coveredDict.has(d) && !certifications.some(x => sameCert(x, d))) certifications.push(d);
  const years = constraints.filter(c => c.kind === 'years').map(c => `${c.label}${c.importance === 'preferred' ? ' (preferred)' : ''}`);
  const degree = constraints.filter(c => c.kind === 'degree').map(c => `${c.label.replace(/^an? /, '').replace(/, or an? /g, ', or ')}${c.importance === 'preferred' ? ' (preferred)' : ''}`);
  const language = constraints.filter(c => c.kind === 'language' && c.value !== 'english').map(c => `${c.label}${c.importance === 'preferred' ? ' (preferred)' : ''}`);
  // availability the posting REQUIRES (nights, weekends, open availability) — never just "full-time"
  const schedules = constraints.filter(c => c.kind === 'schedule' && c.importance === 'required')
    .map(c => (c.items || []).filter(i => !/^(?:full|part)-time$|hours per week$/.test(i)))
    .filter(items => items.length).map(items => `Availability: ${items.join(', ')}`);

  // what_they_want — the core first (up to 3 hard skills), then credentials, years, education and
  // required availability, then the rest; preferred items last and labelled. ≤7.
  const what = [];
  const push = (v) => { if (v && what.length < 7 && !what.some(x => x.toLowerCase() === v.toLowerCase())) what.push(capitalizeKeyword(v)); };
  // a licence the job cannot be done without comes first ("RN license"), then the core skills
  const gateCerts = certifications.filter(c => constraints.some(x => x.kind === 'certification' && x.gate && sameCert(x.label, c)));
  gateCerts.slice(0, 2).forEach(push);
  hardItems.slice(0, 3).forEach(i => push(i.text));
  certifications.slice(0, 3).forEach(push);
  years.filter(y => !/preferred/.test(y)).slice(0, 1).forEach(push);
  degree.filter(d => !/preferred/.test(d)).forEach(push);
  schedules.slice(0, 1).forEach(push);
  hardItems.slice(3).forEach(i => push(i.text));
  dutyItems.forEach(i => push(i.text));
  language.forEach(push);
  prefItems.forEach(i => push(`${i.text} (preferred)`));
  years.filter(y => /preferred/.test(y)).forEach(push);
  degree.filter(d => /preferred/.test(d)).forEach(push);

  const schedule = extractSchedule(signalText);
  const physical = extractPhysical(signalText);
  const screening = extractScreening(signalText);
  const availability = extractAvailability(signalText);
  // a posting with no requirement section states its stack in its duties ("You will … using Python")
  const core = hardItems.length ? hardItems : dutyItems;
  const recognizedSkills = core.filter(i => i.single).map(i => i.single);
  const alternatives = core.filter(i => i.group).map(i => i.group);
  const requirementsRead = skills.length + constraints.filter(c => ['degree', 'years', 'certification', 'language', 'management'].includes(c.kind)).length;

  const out = verifyInsightAgainstPosting({
    what_they_want: what,
    hidden_requirements: what.length ? detectHidden(signalText, { schedule, physical, screening, availability }) : [],
    insider_tip: what.length ? insiderTip(title, recognizedSkills, certifications, schedule, alternatives) : "This listing doesn't say what it requires — ask the hiring team for the full job description before you put time into an application.",
    description_summary: needsSummary ? summarize(title, company, description, what) : '',
  }, description, skills.map(f => skillName(f)));
  // `read`: did the posting state anything to read? false → nothing to charge for, nothing to cache.
  return { ...out, read: out.what_they_want.length > 0, requirements_read: requirementsRead };
}
