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

import { detectRoleFamily } from '../application-intelligence/roleOntology.js';

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
  ['requirements', /^(?:requirements|(?:required|minimum|basic)\s+qualifications|qualifications|what\s+you\s+bring|what\s+we(?:’|')?re\s+looking\s+for|what\s+we\s+need|must[- ]haves?|who\s+you\s+are|required\s+skills|skills\s+(?:&|and)\s+qualifications|experience\s+(?:&|and)\s+qualifications|you\s+have|you(?:’|')?ll\s+need)\b/i],
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
  for (const k of Object.keys(sections)) out[k] = sections[k].join(' ');
  return out;
}

// ── \b-anchored regex helpers ────────────────────────────────────────────────
function has(text, re) { return re.test(text); }

// ── Structured extractors (each pure over the supplied text) ─────────────────

// Experience: the smallest "N+ years" figure that sits near experience-context.
function extractExperience(text) {
  const re = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b([^.]{0,40})/gi;
  let m, best = null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!(n >= 1 && n <= 40)) continue;
    const ctx = (m[2] || '') + ' ' + text.slice(Math.max(0, m.index - 30), m.index);
    if (!/experien|\bexp\b|background|industry|relevant|working|professional/i.test(ctx)) continue;
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
  { re: /\b(on[- ]call|nights|weekends|shift work|rotating|overtime|flexible hours)\b/i, req: 'Non-standard hours are part of the job, even if the posting downplays it.' },
  { re: /\b(\d+\+?\s*years|senior|lead|principal|staff|expert level)\b/i, req: 'They’re hiring for a proven track record, not potential — show you’ve done this exact thing before.' },
  { re: /\b(communicat|written|verbal|present|articulate|stakeholder updates)\b/i, req: 'Communication is graded as much as the core skill — sloppy writing or speaking will cost you.' },
  { re: /\b(bilingual|spanish|mandarin|multilingual)\b/i, req: 'A second language is a real differentiator here even when it’s listed as “preferred.”' },
];

// Build hidden requirements: signal-derived (concrete, most-specific) FIRST, then the
// language-pattern heuristics, then safe fallbacks. Cap 3.
function detectHidden(text, signals) {
  const out = [];
  const push = v => { if (v && out.length < 3 && !out.includes(v)) out.push(v); };

  if (signals.schedule.length) {
    push(`The schedule is fixed — this is ${signals.schedule[0].toLowerCase().startsWith('weekend') ? 'weekend' : 'a ' + signals.schedule[0].toLowerCase()} commitment, and the shift is non-negotiable. Confirm it fits your life before you apply.`);
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
function insiderTip(title, recognizedSkills, certifications, schedule) {
  const t = (title || '').toLowerCase();
  // Tier 1: ≥2 recognized hard skills → mirror ONLY those exact terms. (unchanged)
  if (recognizedSkills.length >= 2) {
    return `Mirror these exact terms — ${recognizedSkills.slice(0, 3).join(', ')} — in your résumé and application; most first-pass filters scan for them verbatim.`;
  }
  // Tier 2: a license/cert was extracted → put it in the résumé headline.
  if (certifications.length >= 1) {
    return `Put your ${certifications[0]} in your résumé headline and the first line of your application — for this kind of role, screeners filter for that credential before anything else.`;
  }
  // Tier 3: a schedule signal was extracted → lead with shift availability.
  if (schedule.length >= 1) {
    return `State your ${schedule[0].toLowerCase()} availability in the very first line of your application — shift fit is the first thing they screen for here.`;
  }
  if (/\b(senior|lead|principal|manager|director|head)\b/.test(t)) {
    return 'Lead with measurable impact — numbers, scope, outcomes. At this level they screen for proven results, not a list of responsibilities.';
  }
  return 'Tailor your opening line to this exact role and company — generic applications get filtered before a human ever reads them.';
}

// ── description_summary (unchanged) ──────────────────────────────────────────
function summarize(title, company, text) {
  const clean = stripHtml(text);
  if (clean.length < 80) return '';
  const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 25);
  const cue = /\b(responsib|require|you(’|')?ll|you will|experience|skills?|manage|develop|build|lead|support|ensure|must|ability|looking for|seeking|join|provide|deliver)\b/i;
  const picked = [];
  for (const s of sentences) { if (picked.length >= 6) break; if (cue.test(s)) picked.push(s); }
  const body = (picked.length ? picked : sentences.slice(0, 5)).join(' ');
  const role = title ? `${title}${company ? ` at ${company}` : ''}` : 'This role';
  return `${role}. ${body}`.replace(/\s+/g, ' ').trim().slice(0, 1200);
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
  ['python','Python'],['java\\b','Java'],['javascript','JavaScript'],['typescript','TypeScript'],['react','React'],['node\\.?js|node\\b','Node.js'],['\\baws\\b|amazon web services','AWS'],['azure','Azure'],['google cloud|gcp','GCP'],['kubernetes|k8s','Kubernetes'],['docker','Docker'],['terraform','Terraform'],['ci/cd|ci ?cd','CI/CD'],['postgres(ql)?','PostgreSQL'],['mysql','MySQL'],['mongodb','MongoDB'],['\\bsql\\b','SQL'],['graphql','GraphQL'],['rest(?:ful)? api|\\brestful\\b','REST APIs'],['\\bgit\\b','Git'],['linux','Linux'],['c\\+\\+','C++'],['c#|\\.net','C#/.NET'],['\\bgolang\\b|\\bgo\\s+(?:programming|developer|lang)\\b','Go'],['ruby','Ruby'],['\\bphp\\b','PHP'],['swift','Swift'],['kotlin','Kotlin'],['tableau','Tableau'],['power ?bi','Power BI'],['figma','Figma'],['kafka','Kafka'],['spark','Spark'],['machine learning|\\bml\\b','Machine Learning'],
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

function extractSkills(text, family = 'general') {
  const lower = text.toLowerCase();
  const found = [];
  const seen = new Set();
  for (const group of allowedSkillGroups(family)) {
    for (const [pat, display] of group) {
      if (found.length >= 5) break;
      if (new RegExp(pat, 'i').test(lower) && !seen.has(display)) { found.push(display); seen.add(display); }
    }
    if (found.length >= 5) break;
  }
  return found;
}

// ── Main entry — pure + deterministic ─────────────────────────────────────────
export function buildJobInsights({ title, company, description, needsSummary = true } = {}) {
  const text = stripHtml(description);
  const sections = parseSections(description);
  // Text over which structured extractors run: everything except the benefits/perks
  // section (which lists what the EMPLOYER offers, not what they require).
  const signalText = [
    sections.requirements, sections.preferred, sections.responsibilities,
    sections.schedule, sections.pay, sections.body,
  ].filter(Boolean).join(' ') || text;

  // Exclusion set: the job title's own words AND the company name (with singular/plural
  // variants) + generic franchise/corp words — so neither "engineer"/"senior" nor
  // "domino"/"dominos" ever pose as "what they want".
  const exclude = new Set();
  for (const raw of String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (raw.length >= 3) for (const v of variantsOf(raw)) exclude.add(v);
  }
  for (const v of normalizeCompanyTokens(company)) exclude.add(v);
  const isExcluded = disp => {
    const n = String(disp).toLowerCase();
    return exclude.has(n) || exclude.has(singularize(n));
  };

  // ── Structured signals ──
  // Detect the role family FIRST so the skill dictionary is domain-gated: a non-technical JD
  // never runs the software/clinical blocks (kills the AWS/REST/Go-on-a-retail-job class of bug).
  const roleFam = detectRoleFamily(title || '', text);
  const recognizedSkills = extractSkills(text, roleFam.family);
  const certifications = extractCertifications(signalText);
  const experience = extractExperience(signalText);
  const education = extractEducation(signalText);
  const schedule = extractSchedule(signalText);
  const physical = extractPhysical(signalText);
  const screening = extractScreening(signalText);
  const availability = extractAvailability(signalText);
  const minedPhrases = minePhrases(sections.requirements || '', isExcluded);

  // ── what_they_want — strict priority, capitalized, filtered, ≤5 ──
  const what_they_want = [];
  const containsBadToken = disp => {
    for (const w of String(disp).toLowerCase().replace(/[^a-z0-9+#/\s]/g, ' ').split(/\s+/).filter(Boolean)) {
      if (INSIGHTS_FILLER.has(w) || INSIGHTS_FILLER.has(singularize(w))) return true;
      if (isExcluded(w)) return true;
    }
    return false;
  };
  const push = (v, { checkTokens = false } = {}) => {
    if (!v) return;
    if (what_they_want.length >= 5) return;
    if (checkTokens && containsBadToken(v)) return;
    const cap = capitalizeKeyword(v);
    if (!what_they_want.some(x => x.toLowerCase() === cap.toLowerCase())) what_they_want.push(cap);
  };

  recognizedSkills.forEach(v => push(v));          // (1) recognized hard skills
  certifications.forEach(v => push(v));            // (2) licenses / certifications
  experience.forEach(v => push(v));                // (3) experience …
  education.forEach(v => push(v));                 //     … + education
  minedPhrases.forEach(v => push(v, { checkTokens: true })); // (4) requirements-section noun phrases

  // Top up from safe defaults ONLY when fewer than 3 real items were extracted.
  if (what_they_want.length < 3) {
    ['Relevant experience', 'Reliability', 'Clear communication', 'Problem-solving', 'Team fit'].forEach(v => push(v));
  }

  return {
    what_they_want: what_they_want.slice(0, 5),
    hidden_requirements: detectHidden(text, { schedule, physical, screening, availability }),
    insider_tip: insiderTip(title, recognizedSkills, certifications, schedule),
    description_summary: needsSummary ? summarize(title, company, text) : '',
  };
}
