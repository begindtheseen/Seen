// Deterministic, keyless résumé analysis.
//
// This module replaces every LLM call in api/resume.js with pure, free,
// CPU-only logic. No external API keys, no network calls, fully deterministic
// so it scales to thousands of concurrent users with zero marginal cost.
//
// It produces the EXACT response shapes the frontend (app/resume/page.tsx)
// expects for each tool: scanner, optimize, advantage, coach, proposal.

// ── Stopwords ──────────────────────────────────────────────────────────────
// Common English words plus generic job-posting boilerplate that should never
// count as a "keyword" worth matching on.
const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','being','but','by','for','from',
  'had','has','have','he','her','his','if','in','into','is','it','its','of',
  'on','or','our','she','so','than','that','the','their','them','then','there',
  'these','they','this','to','was','we','were','what','when','where','which',
  'while','who','will','with','would','you','your','yours','about','above',
  'after','again','all','also','any','because','before','below','between',
  'both','can','could','did','do','does','doing','down','during','each','few',
  'further','here','how','i','just','me','more','most','my','no','nor','not',
  'now','off','once','only','other','out','over','own','same','should','some',
  'such','too','under','until','up','very','via','per','etc','using','use',
  'used','within','across','able','well','must','may','might','shall',
  // job-posting boilerplate
  'role','job','work','working','team','teams','company','companies','position',
  'candidate','candidates','applicant','applicants','responsibilities',
  'requirements','required','require','requires','qualifications','qualified',
  'preferred','plus','strong','excellent','great','good','ability','skills',
  'skill','experience','experienced','years','year','including','include',
  'includes','etc','looking','seeking','join','help','helping','ensure',
  'ensuring','support','supporting','provide','providing','new','various',
  'related','field','fields','degree','equivalent','minimum','ideal','ideally',
  'opportunity','opportunities','environment','fast','paced','self','driven',
  'detail','oriented','plus','bonus','nice','etc','day','days','time','full',
  'part','please','apply','www','http','https','com','one','two','three',
  'across','best','high','highly','key','make','making','many','need','needs',
  'every','get','got','give','take','want','like','set','sets','end','ends',
  // generic JD section-label / boilerplate heading words — never real keywords
  'description','descriptions','responsibility','overview','summary','duties',
  'benefit','benefits','incentive','incentives','perk','perks','employer',
  'employers','employee','employees','employment','compensation','offer',
  'offers','offered','posting','postings','location','locations','schedule',
  'shift','shifts','status','department','reports','reporting','title','titles',
  'note','notes','overview','about','eeo','equal','opportunity','disability',
  'veteran','accommodation','accommodations','summary',
]);

// Multi-word phrases worth detecting as single keywords. Order matters: longer
// / more specific phrases first so they win when scanning.
const KNOWN_PHRASES = [
  'project management','product management','program management','account management',
  'stakeholder management','team management','pipeline management','change management',
  'machine learning','deep learning','data analysis','data science','data engineering',
  'business development','customer success','customer service','user experience',
  'user research','market research','quality assurance','supply chain','social media',
  'continuous integration','continuous delivery','version control','unit testing',
  'cross functional','go to market','public speaking','problem solving','time management',
  'financial modeling','financial analysis','revenue growth','cost reduction',
  'agile methodologies','scrum master','software development','full stack','front end',
  'back end','cloud computing','test automation','content strategy','demand generation',
  'lead generation','people management','process improvement','risk management',
  'vendor management','contract negotiation','technical writing','code review',
  'a b testing','conversion optimization','search engine optimization','paid media',
];

// Weak / passive verbs and résumé clichés that we flag and replace.
const WEAK_VERBS = {
  'responsible for': 'Owned',
  'worked on': 'Built',
  'helped': 'Drove',
  'helped with': 'Drove',
  'assisted': 'Supported and delivered',
  'assisted with': 'Supported and delivered',
  'participated in': 'Contributed to',
  'involved in': 'Drove',
  'tasked with': 'Owned',
  'in charge of': 'Led',
  'duties included': 'Delivered',
  'handled': 'Managed',
  'dealt with': 'Resolved',
  'utilized': 'Used',
  'leveraged': 'Used',
  'spearheaded': 'Led',
  'was part of': 'Drove',
  'familiar with': 'Skilled in',
};

// ── Tokenisation ─────────────────────────────────────────────────────────────
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Normalise a token for matching (singular/plural, trailing punctuation).
function normalizeToken(t) {
  let s = t.replace(/^[-./]+|[-./]+$/g, '');
  // crude singularisation
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 3 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

// Build a normalised set of single-word tokens present in some text.
function tokenSet(text) {
  const set = new Set();
  for (const t of tokenize(text)) set.add(normalizeToken(t));
  return set;
}

// Strip leading/trailing punctuation from a display token so "incentives." →
// "incentives" and "—lead" → "lead". Keeps internal chars like c++ / node.js.
function cleanDisplay(raw) {
  return String(raw || '').replace(/^[^a-z0-9+#]+/i, '').replace(/[^a-z0-9+#]+$/i, '');
}

// Build a set of normalised tokens to exclude from keyword ranking — used to
// drop the hiring company's name and the job title itself, which are never
// useful "keywords to add" to a résumé and pollute the missing/strong lists.
export function buildExcludeSet(...sources) {
  const set = new Set();
  for (const src of sources) {
    for (const raw of tokenize(src)) {
      const norm = normalizeToken(raw);
      if (norm.length >= 2) { set.add(norm); set.add(raw); }
    }
  }
  return set;
}

// ── Keyword ranking ──────────────────────────────────────────────────────────
// Rank the most important keywords/phrases in a job description by frequency,
// dropping stopwords. `exclude` is an optional Set of normalised tokens (e.g.
// the company name + job title) to never surface as keywords. Returns
// [{ term, display, count, isPhrase }] sorted by importance (count desc, longer
// terms first as tiebreak).
export function rankKeywords(jobDescription, limit = 24, exclude = null) {
  const text = String(jobDescription || '');
  const lower = text.toLowerCase();
  const excluded = exclude instanceof Set ? exclude : new Set();

  const scores = new Map(); // term -> { count, display, isPhrase }

  // 1) Known multi-word phrases
  for (const phrase of KNOWN_PHRASES) {
    // Skip a phrase if every one of its words is excluded (company/title noise).
    if (phrase.split(' ').every(w => excluded.has(normalizeToken(w)))) continue;
    const re = new RegExp('\\b' + phrase.replace(/ /g, '\\s+') + '\\b', 'g');
    const m = lower.match(re);
    if (m && m.length) {
      scores.set(phrase, {
        count: m.length * 3, // phrases weigh more — they're specific
        display: phrase.replace(/\b\w/g, c => c.toUpperCase()),
        isPhrase: true,
      });
    }
  }

  // 2) Single-word tokens (skip ones already covered by a phrase)
  const phraseWords = new Set();
  for (const p of scores.keys()) for (const w of p.split(' ')) phraseWords.add(w);

  for (const raw of tokenize(text)) {
    // Strip edge punctuation up front so "incentives." is filtered like
    // "incentives" (both as a stopword and in its singular form).
    const clean = cleanDisplay(raw).toLowerCase();
    if (clean.length < 3) continue;
    const norm = normalizeToken(clean);
    if (norm.length < 3) continue;
    // Check stopwords/excludes against the cleaned word AND its normalised form,
    // since crude singularisation ("incentives"→"incentiv") can dodge a match.
    if (STOPWORDS.has(norm) || STOPWORDS.has(clean) || STOPWORDS.has(raw)) continue;
    if (excluded.has(norm) || excluded.has(clean) || excluded.has(raw)) continue; // company/title noise
    if (phraseWords.has(norm)) continue;
    if (/^\d+$/.test(norm)) continue;
    const prev = scores.get(norm);
    if (prev) prev.count += 1;
    else scores.set(norm, { count: 1, display: clean, isPhrase: false });
  }

  return [...scores.entries()]
    .map(([term, v]) => ({ term, ...v }))
    .filter(k => k.display && k.display.length >= 3)
    .sort((a, b) => b.count - a.count || b.term.length - a.term.length)
    .slice(0, limit);
}

// Does the résumé contain a keyword/phrase? Phrase match is loose (all words
// present), single-word match is on the normalised token set.
function resumeHasKeyword(kw, resumeLower, resumeTokens) {
  if (kw.isPhrase) {
    return kw.term.split(' ').every(w => resumeTokens.has(normalizeToken(w)));
  }
  return resumeTokens.has(kw.term) || resumeLower.includes(kw.term);
}

// ── Bullet extraction ────────────────────────────────────────────────────────
// Pull résumé "bullets" — lines that look like accomplishment statements.
export function extractBullets(resume) {
  const lines = String(resume || '')
    .split(/\r?\n/)
    .map(l => l.replace(/^[\s•\-*–·●▪◦>]+/, '').trim())
    .filter(Boolean);

  const bullets = [];
  for (const line of lines) {
    const words = line.split(/\s+/);
    if (words.length < 4) continue;          // too short to be a real bullet
    if (words.length > 60) continue;         // probably a paragraph/section blob
    if (/@|https?:\/\//.test(line)) continue; // contact line
    // Skip lines that are mostly a section header (all caps, few words)
    if (words.length <= 4 && line === line.toUpperCase()) continue;
    bullets.push(line);
  }
  return bullets;
}

const QUANT_RE = /\d|\b(percent|million|thousand|billion|hundred|dozens?)\b|[$%]/i;

function hasQuantification(text) {
  return QUANT_RE.test(text);
}

function startsWithWeakVerb(text) {
  const lower = text.toLowerCase();
  for (const weak of Object.keys(WEAK_VERBS)) {
    if (lower.startsWith(weak)) return weak;
  }
  return null;
}

// Capitalise first letter of a sentence.
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ── Tool: scanner (ATS fit) ──────────────────────────────────────────────────
export function runScanner({ resume, jobDescription, job, company, intelNote }) {
  const exclude = buildExcludeSet(company, job);
  const ranked = rankKeywords(jobDescription, 24, exclude);
  const resumeLower = String(resume || '').toLowerCase();
  const resumeTokens = tokenSet(resume);

  const strong = [];
  const missing = [];
  for (const kw of ranked) {
    if (resumeHasKeyword(kw, resumeLower, resumeTokens)) strong.push(kw);
    else missing.push(kw);
  }

  // Weighted match score: keyword weight = its importance count.
  const totalWeight = ranked.reduce((s, k) => s + k.count, 0) || 1;
  const matchedWeight = strong.reduce((s, k) => s + k.count, 0);
  let score = Math.round((matchedWeight / totalWeight) * 100);
  // Clamp to a believable, non-zero band.
  score = Math.max(8, Math.min(98, score));

  const strongDisplay = strong.map(k => k.display).slice(0, 12);
  const missingDisplay = missing.map(k => k.display).slice(0, 12);

  // Specific fixes: surface bullets that genuinely need work (weak lead verb or
  // no quantification). The "improved" version applies ONLY safe, truthful
  // deterministic cleanups (verb swap, capitalisation, punctuation) — we never
  // fabricate outcomes or jam JD keywords into the bullet text. Any keyword/
  // metric guidance goes in a separate `note` field so the rewrite stays
  // interview-defensible (HumanProof principle: never invent claims).
  const bullets = extractBullets(resume);
  const topMissing = missing.slice(0, 6);

  // Prefer bullets that actually differ after cleanup or lack a number, so the
  // "improved" version is meaningfully different and the fix is worth showing.
  const candidates = bullets.map((text, i) => {
    const weak = startsWithWeakVerb(text);
    const quantified = hasQuantification(text);
    let priority = 0;
    if (weak) priority += 2;          // weak verb → real, safe improvement
    if (!quantified) priority += 1;   // missing metric → actionable note
    return { i, text, weak, quantified, priority };
  }).filter(c => c.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.i - b.i);

  const fixes = [];
  for (const c of candidates) {
    if (fixes.length >= 4) break;
    const improved = cleanBullet(c.text);
    const note = bulletNote(c, topMissing);
    // When the safe cleanup produces no real change (already strong lead verb,
    // already clean), don't pretend it's a "rewrite" — mark it so the UI can
    // label it "Already strong" instead of showing two identical boxes.
    const unchanged = sameBullet(c.text, improved);
    const fix = { current: c.text, improved };
    if (unchanged) fix.unchanged = true;
    if (note) fix.note = note;
    fixes.push(fix);
  }

  // If there were no improvable bullets but keywords are missing, give a concrete
  // additive suggestion as guidance — clearly a recommendation, not a fake rewrite.
  if (fixes.length === 0 && topMissing.length) {
    fixes.push({
      current: '(No bullet directly demonstrates the role’s core requirements.)',
      improved: '(No safe automatic rewrite — add a new bullet below.)',
      note: `Add a bullet describing real work that maps to "${topMissing[0].display}", and attach a number (%, $, count, or timeframe) to it. Only include the term if it reflects something you actually did.`,
    });
  }

  const matchPct = Math.round((strong.length / (ranked.length || 1)) * 100);
  const summary = score >= 75
    ? `Strong fit — your résumé already hits ${strong.length} of the ${ranked.length} keywords this ${job || 'role'} posting emphasises (${matchPct}%). Close the remaining gaps below and you'll clear most ATS filters.`
    : score >= 50
      ? `Partial fit — you match ${strong.length} of ${ranked.length} key terms (${matchPct}%). An ATS may rank you mid-pack; add the missing keywords below where they're truthful to move up.`
      : `Low keyword overlap — you only match ${strong.length} of ${ranked.length} terms (${matchPct}%) the posting emphasises. Re-tailor your résumé with the missing keywords below before applying, or an ATS is likely to filter you out.`;

  const ghost = intelNote
    ? `${intelNote} To avoid being ghosted here, apply in the first 48 hours and secure a referral or a direct note to the hiring manager — referred candidates skip the cold pile this company tends to ghost.`
    : 'Apply within the first 48 hours, then follow up once after 7 days. If you have no response by day 14, treat it as a likely ghost and prioritise other applications rather than waiting.';

  return {
    match_score: score,
    score_summary: summary,
    missing_keywords: missingDisplay,
    strong_keywords: strongDisplay,
    specific_fixes: fixes,
    ghost_risk_note: ghost,
  };
}

// Apply ONLY safe, truthful deterministic cleanups to a bullet:
//   1) swap a weak/passive lead verb → a strong action verb (WEAK_VERBS map)
//   2) capitalise the first letter
//   3) normalise trailing punctuation to a single period
// It NEVER appends a clause, a keyword, or a "(add a metric)" hint into the
// bullet text — those belong in a separate `note` field. The returned string is
// the same claim the candidate already made, just tightened. A deterministic
// engine cannot truthfully rewrite a bullet's substance, so it doesn't pretend to.
export function cleanBullet(bullet) {
  let b = String(bullet || '').trim().replace(/[.;,\s]+$/, '');
  const weak = startsWithWeakVerb(b);
  if (weak) {
    b = WEAK_VERBS[weak] + b.slice(weak.length);
  }
  b = cap(b);
  return b ? b + '.' : b;
}

// True when a "cleaned" bullet is effectively identical to the original — i.e.
// the only differences are trailing punctuation / surrounding whitespace, so no
// real rewrite happened. Used to avoid presenting an unchanged bullet as a
// "Rewrite" (two identical boxes look broken and dishonest).
export function sameBullet(original, improved) {
  const norm = s => String(s || '').trim().replace(/[.;,\s]+$/, '').replace(/\s+/g, ' ');
  return norm(original) === norm(improved);
}

// Build the guidance note for a bullet — the place where JD-keyword and metric
// suggestions live (NEVER inside the bullet text). Returns '' if nothing to add.
function bulletNote(candidate, topMissing) {
  const parts = [];
  if (!candidate.quantified) {
    parts.push('Add a concrete number (%, $, count, or timeframe) so this lands.');
  }
  // Suggest the single most relevant missing keyword the bullet doesn't already
  // contain — as advice, gated on it reflecting real work.
  const bulletLower = candidate.text.toLowerCase();
  const kw = (topMissing || []).find(k => !bulletLower.includes(k.term) && !bulletLower.includes(k.display.toLowerCase()));
  if (kw) {
    parts.push(`If it reflects real work, weave in "${kw.display}" — a keyword this posting emphasises.`);
  }
  return parts.join(' ');
}

// ── Tool: optimize ───────────────────────────────────────────────────────────
export function runOptimize({ resume, jobDescription, job, company, pro }) {
  const exclude = buildExcludeSet(company, job);
  const ranked = rankKeywords(jobDescription, 18, exclude);
  const resumeLower = String(resume || '').toLowerCase();
  const resumeTokens = tokenSet(resume);

  const priorities = ranked.slice(0, 6).map(k => k.display);

  const missing = ranked.filter(k => !resumeHasKeyword(k, resumeLower, resumeTokens));
  const keywordsAdded = missing.slice(0, 8).map(k => k.display);

  const bullets = extractBullets(resume);

  // Rank bullets by how "improvable" they are: weak verb, no quantification.
  const scored = bullets.map((text, i) => {
    let weakness = 0;
    if (startsWithWeakVerb(text)) weakness += 2;
    if (!hasQuantification(text)) weakness += 1;
    return { text, i, weakness, quantified: hasQuantification(text) };
  }).sort((a, b) => b.weakness - a.weakness || a.i - b.i);

  const optimized = [];
  const targets = scored.slice(0, Math.max(4, Math.min(6, scored.length)));
  for (let n = 0; n < targets.length; n++) {
    const t = targets[n];
    const priority = priorities[n % (priorities.length || 1)] || (ranked[0]?.display ?? 'the core requirement');
    // SAFE deterministic cleanup only — verb swap, capitalisation, punctuation.
    // Never append "directly supporting X" or "(quantify…)" into the bullet.
    const rewrite = cleanBullet(t.text);
    const note = bulletNote({ text: t.text, quantified: t.quantified }, missing.slice(0, 6));
    const entry = { original: t.text, optimized: rewrite, addresses: priority };
    if (sameBullet(t.text, rewrite)) entry.unchanged = true;
    if (note) entry.note = note;
    optimized.push(entry);
  }

  // If résumé has no parseable bullets, emit additive templates per priority —
  // clearly labelled guidance, not a fake rewrite of existing content.
  if (optimized.length === 0) {
    for (const p of priorities.slice(0, 4)) {
      optimized.push({
        original: '(Add a bullet for this requirement.)',
        optimized: '(No existing bullet to rewrite — write a new one below.)',
        addresses: p,
        note: `Describe real work that maps to "${p}" and attach a number (%, $, count, or timeframe). Only include the term if it reflects something you actually did.`,
      });
    }
  }

  const out = {
    job_priorities: priorities,
    optimized_bullets: optimized,
    keywords_added: keywordsAdded,
  };
  if (pro) out.stealth = true;
  return out;
}

// ── Tool: advantage / coach / proposal ───────────────────────────────────────
// Rule-based application playbook + 30/60/90 plan. Deterministic structured
// guidance — no model prose. Personalised to the CANDIDATE'S OWN résumé: their
// real most-recent title/employer, their actual skills, and their strongest
// quantified bullet, intersected with the JD's ranked requirements. Two
// different résumés (or two different jobs) therefore produce clearly different,
// tailored output. Nothing is fabricated — every claim about the candidate is
// sourced from text that appears in their résumé.
export function runAdvantage({ job, company, resume, jobDescription, background, intelNote, intelStats }) {
  const ranked = rankKeywords(jobDescription, 12, buildExcludeSet(company, job));
  const topReqs = ranked.slice(0, 5).map(k => k.display);
  const r1 = topReqs[0] || 'the core requirement';
  const r2 = topReqs[1] || r1;
  const r3 = topReqs[2] || r2;

  // Build the candidate's REAL profile from their résumé (or `background` as a
  // fallback when no résumé text was supplied). This is what makes the output
  // specific rather than boilerplate.
  const profile = buildResumeProfile({ resume: resume || background || '', ranked });
  const family = classifyRoleFamily({ job, jobDescription, ranked });

  const coach = buildCoach({ job, company, topReqs, profile, intelNote, intelStats });
  const plan = buildProposal({ job, company, r1, r2, r3, profile, family });

  return { ...coach, ...plan };
}

// ── Candidate profile from their own résumé ──────────────────────────────────
// Extracts the real, résumé-grounded facts the playbook references:
//   recentTitle / recentCompany  — their latest role (extractEmployment)
//   skills                       — dictionary skills present in the résumé
//   matched / missing            — JD ranked keywords they DO / DON'T have
//   proofBullet                  — their strongest (quantified) real bullet
//   transferable                 — a real skill/role to pivot from when missing
// Every field is grounded in résumé text; absent data is left empty, never faked.
export function buildResumeProfile({ resume, ranked }) {
  const text = String(resume || '');
  let employment = [];
  try { employment = extractEmployment(text); } catch (_) { employment = []; }
  let signal = { skills: [], seniority: 'mid', function: 'other', years_exp: null };
  try { signal = extractCareerSignal(text, employment); } catch (_) {}

  const recent = employment[0] || null;
  const recentTitle = recent && recent.title ? recent.title.trim() : '';
  const recentCompany = recent && recent.company ? recent.company.trim() : '';

  // Display-friendly real skills from the dictionary (title-cased acronyms).
  const skills = (signal.skills || []).map(s => titleCaseSkill(s));

  // Intersect the JD's ranked requirements with what the résumé actually proves.
  const resumeLower = text.toLowerCase();
  const resumeTokens = tokenSet(text);
  const matched = [];
  const missing = [];
  for (const kw of (ranked || [])) {
    if (resumeHasKeyword(kw, resumeLower, resumeTokens)) matched.push(kw.display);
    else missing.push(kw.display);
  }

  // `matchedStrengths`: the matched terms minus generic seniority / role-family
  // noise (e.g. "senior", "engineer", "services") that read as filler in a pitch.
  // We lead the script/cover-letter with these REAL, differentiating skills. The
  // full `matched`/`missing` lists stay intact for honest gap analysis.
  const matchedStrengths = matched.filter(m => !PITCH_NOISE.test(m));

  // The single strongest proof bullet: a quantified real bullet, longest wins.
  let proofBullet = '';
  try {
    const quantified = extractBullets(text).filter(hasQuantification);
    quantified.sort((a, b) => b.length - a.length);
    if (quantified[0]) proofBullet = cleanBullet(quantified[0]).replace(/\.$/, '');
  } catch (_) {}

  // A transferable anchor to pivot from when the candidate is MISSING the top
  // requirement — their real most-relevant strength (real matched skill > recent
  // title > first résumé skill). Never invents the missing requirement itself.
  const transferable = matchedStrengths[0] || recentTitle || skills[0] || '';

  return {
    hasResume: !!text.trim(),
    recentTitle, recentCompany,
    skills,
    matched, missing, matchedStrengths,
    proofBullet,
    transferable,
    seniority: signal.seniority,
    years_exp: signal.years_exp,
  };
}

// Generic seniority / role-title / role-family words that are technically JD
// keywords but read as filler when used as a candidate "strength" ("experience
// with senior"). We strip them from the pitch headline, never from gap analysis.
const PITCH_NOISE = /^(senior|junior|lead|staff|principal|entry|mid|engineer|developer|programmer|manager|director|analyst|specialist|coordinator|representative|associate|assistant|technician|clerk|cashier|driver|nurse|designer|consultant|administrator|agent|officer|services?|backend|frontend|fullstack|full stack)$/i;

// ── Role-family classifier (varies the 30/60/90 plan) ────────────────────────
// Maps the job title + JD language to a role family so a barista plan ≠ a
// software plan ≠ a warehouse plan. Deterministic keyword voting.
const ROLE_FAMILY_SIGNALS = [
  ['healthcare', /\b(nurse|rn|lpn|cna|patient|clinical|medical|caregiver|phlebot|pharmac|therapist|dental|emt|healthcare)\b/i],
  ['technical', /\b(engineer|developer|software|programmer|devops|sre|architect|machine learning|frontend|backend|full stack|\bapi\b|cloud|kubernetes|python|java(?:script)?)\b/i],
  ['logistics', /\b(warehouse|driver|delivery|forklift|logistics|shipping|receiving|inventory|supply chain|fulfillment|picker|packer|loader|route)\b/i],
  ['service', /\b(barista|server|waiter|waitress|bartender|hospitality|restaurant|food|kitchen|cook|chef|host(?:ess)?|guest)\b/i],
  ['retail', /\b(retail|sales associate|store|merchandis|membership|cashier|stock|register|point of sale|\bpos\b)\b/i],
  ['office', /\b(administrative|\badmin\b|coordinator|receptionist|scheduling|data entry|\boffice\b|bookkeep|accounting|clerk)\b/i],
];
export function classifyRoleFamily({ job, jobDescription, ranked }) {
  const hay = `${job || ''} ${(ranked || []).map(k => k.display).join(' ')} ${jobDescription || ''}`;
  for (const [family, re] of ROLE_FAMILY_SIGNALS) {
    if (re.test(hay)) return family;
  }
  return 'general';
}

// Prefix the correct indefinite article for a noun phrase ("a Barista", "an
// Engineer"). Keeps the phrase's own casing.
function prefixArticle(phrase) {
  const p = String(phrase || '').trim();
  if (!p) return p;
  return /^[aeiou]/i.test(p) ? `an ${p}` : `a ${p}`;
}

function buildCoach({ job, company, topReqs, profile, intelNote, intelStats }) {
  const r1 = topReqs[0] || 'the core requirement';
  const reqList = topReqs.slice(0, 3).join(', ') || 'the role’s core priorities';

  // The candidate's headline credential, drawn from their real résumé. We lead
  // with REAL differentiating skills they actually match (matchedStrengths),
  // never the seniority/role-title noise. `strengths` is what we pitch; `gaps`
  // is the honest list of top requirements the résumé does NOT show, used to
  // coach transferable positioning without ever claiming the gap is filled.
  const strengths = profile.matchedStrengths || [];
  const hasStrength = strengths.length > 0;
  const s1 = strengths[0];
  const s2 = strengths[1];
  // The top JD requirements the candidate is MISSING — honest gap coaching.
  const gaps = (profile.missing || []).filter(m => !PITCH_NOISE.test(m)).slice(0, 2);
  const gapList = gaps.join(' and ');

  const expPhrase = profile.recentTitle && profile.recentCompany
    ? `As ${prefixArticle(profile.recentTitle)} at ${profile.recentCompany}, `
    : profile.recentTitle ? `As ${prefixArticle(profile.recentTitle)}, ` : '';

  // ── hiring_manager_script — built around a REAL matched strength when present,
  //    otherwise an honest transferable-experience pitch anchored on the real
  //    recent title. Never claims a skill the résumé doesn't show. ──
  let scriptStrength;
  if (hasStrength && s2) {
    scriptStrength = `my hands-on experience with ${s1.toLowerCase()} and ${s2.toLowerCase()}`;
  } else if (hasStrength) {
    scriptStrength = `my hands-on experience with ${s1.toLowerCase()}`;
  } else if (profile.recentTitle) {
    scriptStrength = `my background as ${prefixArticle(profile.recentTitle)}, which maps closely to what this role needs`;
  } else {
    scriptStrength = `my background, which lines up with what you're hiring for`;
  }
  const hiring_manager_script =
`Hi [First name] — I'm applying for the ${job} role at ${company}. ` +
expPhrase +
`I'd bring ${scriptStrength}` +
(hasStrength ? ` — ${s2 ? 'two of the skills' : 'a skill'} your posting calls for.` : `, especially around ${r1.toLowerCase()}.`) +
` ` +
`Before I submit, I'd value 10 minutes to hear what "great" looks like here in the first 90 days. ` +
`Would a short call this week work? Either way, thank you — I'm genuinely excited about ${company}.`;

  const timing_note = intelStats
    ? `This company responds to roughly ${Math.round((intelStats.response_rate || 0) * 100)}% of applicants and ghosts about ${Math.round((intelStats.ghost_rate || 0) * 100)}%, with an average wait near ${Math.round(intelStats.avg_wait_days || 0)} days. Apply within the first 48 hours while the req is fresh and the pile is small — early applicants get read before fatigue sets in.`
    : `Apply within the first 48 hours of the posting going live. Most applications arrive in week one, and recruiters review the earliest batch most carefully — being early is a real, free edge.`;

  // Honest gap-coaching sentence: only when there's a real top requirement the
  // résumé doesn't show. Coaches transferable positioning — never claims it.
  const gapCoach = gapList
    ? ` The posting also leans on ${gapList}, which your résumé doesn't yet show — if you have adjacent experience, name it honestly as transferable rather than claiming the keyword.`
    : '';

  let company_intel;
  if (intelNote) {
    company_intel = `${intelNote} Lead your outreach by acknowledging you know how they treat applicants — say you'll be proactive with follow-up. ` +
      (hasStrength
        ? `Anchor your pitch on your real strength in ${strengths.slice(0, 2).join(' and ').toLowerCase()} — ${s2 ? 'requirements' : 'a requirement'} the posting names directly.`
        : `Tie your pitch to ${reqList}, the priorities their posting emphasises most, and frame your ${profile.transferable ? profile.transferable + ' background' : 'closest experience'} as transferable.`) + gapCoach;
  } else {
    company_intel = `Research three things before you apply to ${company}: (1) a recent launch, funding round, or announcement you can reference; (2) who the hiring manager likely is (search "${job} ${company}" on LinkedIn); (3) the priorities their posting repeats — here, ${reqList}. ` +
      (hasStrength
        ? `Then mirror that language and foreground your real experience in ${s1.toLowerCase()}.`
        : `Mirror that exact language and position your ${profile.transferable ? profile.transferable + ' experience' : 'closest experience'} as the bridge.`) + gapCoach;
  }

  // ── cover_letter_framework — the "proof" paragraph references the candidate's
  //    REAL strongest bullet / matched strength, not a generic placeholder. ──
  const proofLine = profile.proofBullet
    ? `Use your real result: "${profile.proofBullet}". Lead with that number.`
    : hasStrength
      ? `Tell one concrete story where you used ${s1.toLowerCase()}${s2 ? ' or ' + s2.toLowerCase() : ''}, and attach a real metric (%, $, time saved, scale).`
      : `Tell one concrete story from your ${profile.transferable ? profile.transferable + ' experience' : 'background'} that shows the same underlying skill, and attach a real metric. Be honest that it's adjacent — show the transfer, don't overclaim.`;
  const hookStrength = hasStrength
    ? `your real experience with ${s1.toLowerCase()} maps directly to what they need`
    : `${profile.recentTitle ? 'your background as ' + prefixArticle(profile.recentTitle) : 'your experience'} gives you transferable footing for ${r1.toLowerCase()}`;
  const cover_letter_framework =
`Paragraph 1 — Hook: Name the ${job} role and one specific reason ${company} stands out to you (a product, value, or recent move). State that ${hookStrength}.\n\n` +
`Paragraph 2 — Proof: ${proofLine} Show, don't claim.\n\n` +
`Paragraph 3 — Close: Connect that result to the impact you'd have at ${company} in this role, and ask for the conversation. Keep the whole letter under 250 words.`;

  const referralFit = hasStrength
    ? `why you're a fit (your experience in ${s1.toLowerCase()})`
    : `why you're a fit (${profile.transferable ? 'your ' + profile.transferable + ' background, framed as transferable to ' + r1.toLowerCase() : 'your closest relevant experience for ' + r1.toLowerCase()})`;
  const referral_strategy = intelNote
    ? `Because this company ghosts a meaningful share of applicants, a referral is your single biggest lever — referred candidates skip the cold pile. Find 1–2 people at ${company} (alumni, past colleagues, 2nd-degree LinkedIn). Send a short, specific note: mention the ${job} role, ${referralFit}, and ask if they'd be comfortable referring you. Make it easy — attach your résumé and a 2-line blurb they can paste.`
    : `Find 1–2 people at ${company} through LinkedIn (filter by company + your school or past employers). Send a specific note referencing the ${job} role and ${referralFit}, and ask if they'd refer you. Give them a ready-to-paste 2-line blurb and your résumé so it costs them 30 seconds. A referral can multiply your odds of a first look.`;

  return { hiring_manager_script, timing_note, company_intel, cover_letter_framework, referral_strategy };
}

// ── Employment history extraction (regex/heuristics, keyless) ────────────────
const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
// A single date token, tolerant of the common real-world formats:
//   "January 2020", "Jan. 2020"   — month name + year
//   "1/2020", "01/2020"           — numeric month/year
//   "2020-01", "2020/01"          — ISO-ish year-first
//   "Q1 2020"                     — fiscal quarter + year
//   "2020"                        — bare year
const DATE_TOKEN = `(?:${MONTHS}\\.?\\s*\\d{4}|q[1-4]\\s*\\d{4}|\\d{1,2}[/-]\\d{4}|\\d{4}[/-]\\d{1,2}|\\d{4})`;
// A date range like "Jan 2020 – Present", "2019 - 2021", "1/2020 to 3/2022".
const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:[-–—]|to)\\s*(${DATE_TOKEN}|present|current|now)`,
  'i'
);

const COMMON_TITLE_WORDS = /(engineer|developer|manager|director|designer|analyst|consultant|lead|architect|specialist|coordinator|associate|officer|administrator|scientist|intern|president|founder|head|chief|vp|vice president|supervisor|representative|recruiter|accountant|nurse|teacher|technician|strategist|marketer|writer|editor|producer|owner|partner|advisor|principal|fellow|assistant|agent|clerk|operator|planner|buyer|controller|auditor|paralegal|attorney|counsel|surgeon|physician|therapist|pharmacist|professor|instructor|chef|stylist|handler|driver|courier|packer|picker|stocker|cashier|warehouse|welder|mechanic|laborer|labourer|janitor|custodian|cook|server|bartender|barista|dishwasher|forklift|loader|sorter|installer|electrician|plumber|carpenter|painter|roofer|machinist|fabricator|assembler|inspector|dispatcher|foreman|receptionist|teller|waiter|waitress|groundskeeper|landscaper|mover|cleaner|attendant|greeter|bagger|busser|caregiver|orderly|phlebotomist|paramedic|firefighter|worker|crew|technologist|dietitian|hygienist|machine operator|line cook|sales)/i;

function looksLikeTitle(line) {
  if (!COMMON_TITLE_WORDS.test(line)) return false;
  const wc = line.split(/\s+/).length;
  if (wc <= 8) return true;
  // Allow a longer title when it's a compound joined with "and" or "/" — e.g.
  // "Senior Software Architect and Technical Lead", "Host / Server". Cap at 12
  // words so a full sentence still can't masquerade as a title.
  if (wc <= 12 && /\b(and)\b|\//i.test(line)) return true;
  return false;
}

function isProbablyCompany(line) {
  if (!line) return false;
  const words = line.split(/\s+/);
  if (words.length > 7) return false;
  if (/@|https?:\/\/|\bphone\b|\bemail\b/i.test(line)) return false;
  // Companies often have a capitalised first letter and few lowercase function words.
  return /[A-Z]/.test(line[0] || '');
}

// Extract up to 15 employment entries. Best-effort — pairs a date range on (or
// near) a line with the nearest title-looking and company-looking lines.
export function extractEmployment(resumeText) {
  const lines = String(resumeText || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const entries = [];
  for (let i = 0; i < lines.length && entries.length < 15; i++) {
    const m = lines[i].match(DATE_RANGE_RE);
    if (!m) continue;

    const start_date = m[1];
    let end_date = m[2];
    if (/present|current|now/i.test(end_date)) end_date = 'Present';

    // The line carrying the date often also carries the title or company. But the most
    // common résumé layout puts the header ("Company, City — Title") on its OWN line with
    // the date on the next line — so when the date line has no other text, fall back to the
    // header line just above it (skipping bullets / another date line).
    // A standalone location line — "Rialto, CA", "Remote", "Los Angeles, California" —
    // that résumés commonly place between the header and the date. We must skip it when
    // hunting for the header, else the city gets mistaken for the company.
    const isLocationLine = (s) => !!s && (
      /^[A-Z][A-Za-z.'\s]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+)\s*$/.test(s) ||
      /^(remote|hybrid|on-?site)$/i.test(s.trim())
    );
    let carrier = lines[i].replace(DATE_RANGE_RE, '').replace(/[•|,;–—-]\s*$/, '').trim();
    if (!carrier) {
      let above = lines[i - 1] || '';
      // Skip a bullet, another date, or a bare location line and reach the real header above it.
      if (isLocationLine(above)) {
        const higher = lines[i - 2] || '';
        if (higher && !/^[•\-*]/.test(higher) && !DATE_RANGE_RE.test(higher)) above = higher;
      }
      if (above && !/^[•\-*]/.test(above) && !DATE_RANGE_RE.test(above) && !isLocationLine(above)) carrier = above;
    }

    // Look at the carrier line and the two surrounding lines for title/company.
    let title = '';
    let company = '';

    // Most reliable signal: the carrier line itself with a "A <sep> B" pattern.
    // Assign sides by which one matches title-words (handles both
    // "Title at Company" and "Company — Title" orderings).
    if (carrier) {
      const split = carrier.split(/\s+(?:at|@|[—–|,])\s+|\s+-\s+/i);
      if (split.length >= 2) {
        const left = split[0].trim().replace(/^[•\-*]\s*/, '').slice(0, 100);
        const right = split.slice(1).join(' ').trim().slice(0, 100);
        const leftIsTitle = looksLikeTitle(left);
        const rightIsTitle = looksLikeTitle(right);
        if (rightIsTitle && !leftIsTitle) { title = right; company = left; }
        else if (leftIsTitle && !rightIsTitle) { title = left; company = right; }
        else { company = left; title = right; }
      } else if (looksLikeTitle(carrier)) {
        title = carrier.replace(/^[•\-*]\s*/, '').slice(0, 100);
      } else if (isProbablyCompany(carrier)) {
        company = carrier.replace(/^[•\-*]\s*/, '').slice(0, 100);
      }
    }

    // Résumés commonly append the work location: "Company, City — Title". Strip a trailing
    // ", City" (1–3 Capitalized words after a comma) so intel routes to the real company.
    if (company) company = company.replace(/,\s*[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,2}\s*$/, '').trim();

    // Fall back to the surrounding lines for whichever field is still missing.
    const ctx = [lines[i - 1] || '', lines[i + 1] || ''].filter(Boolean);
    if (!title) for (const c of ctx) { if (looksLikeTitle(c)) { title = c.replace(/^[•\-*]\s*/, '').slice(0, 100); break; } }
    if (!company) for (const c of ctx) { if (c !== title && isProbablyCompany(c) && !looksLikeTitle(c)) { company = c.replace(/^[•\-*]\s*/, '').slice(0, 100); break; } }

    if (!company && !title) continue;

    entries.push({ company: company || '', title: title || '', start_date, end_date });
  }

  // De-dupe on company+title.
  const seen = new Set();
  return entries.filter(e => {
    const k = (e.company + '|' + e.title).toLowerCase();
    if (seen.has(k) || (!e.company && !e.title)) return false;
    seen.add(k);
    return true;
  }).filter(e => e.company);
}

// ── Career signal extraction (skills/seniority/function/years) ───────────────
const SKILL_DICTIONARY = [
  'javascript','typescript','python','java','c++','c#','go','golang','rust','ruby',
  'php','swift','kotlin','scala','sql','nosql','react','angular','vue','node','nodejs',
  'django','flask','rails','spring','express','graphql','rest','aws','azure','gcp',
  'docker','kubernetes','terraform','jenkins','git','linux','postgresql','mysql',
  'mongodb','redis','kafka','spark','hadoop','tensorflow','pytorch','pandas','numpy',
  'tableau','powerbi','excel','salesforce','hubspot','jira','figma','sketch','photoshop',
  'illustrator','seo','sem','ppc','analytics','marketing','sales','accounting','finance',
  'budgeting','forecasting','recruiting','onboarding','agile','scrum','kanban','devops',
  'cicd','machine learning','data analysis','project management','product management',
  'leadership','negotiation','communication','figma','wireframing','prototyping',
  // modern stack / tooling
  'nextjs','svelte','tailwind','fastapi','dotnet','elasticsearch','snowflake',
  'databricks','airflow','dbt','grafana','prometheus','ansible','helm','rabbitmq',
  'bigquery','redshift','supabase','firebase','vercel','netlify','cloudflare',
  'playwright','cypress','jest','pytest','webpack','vite','rollup','storybook',
  // AI / data
  'llm','langchain','openai','huggingface','genai','prompt engineering','rag',
  'computer vision','nlp','data visualization','etl','data warehousing',
  // security / infra
  'cybersecurity','penetration testing','soc2','oauth','jwt','iam','vpc',
  'microservices','grpc','websockets','observability','ci/cd',
  // product / ops
  'roadmapping','okrs','stakeholder management','customer success','asana',
  'notion','confluence','servicenow','zendesk','quickbooks',
];

const SENIORITY_MAP = [
  [/\b(chief|cto|ceo|cfo|coo|vp|vice president|executive|head of)\b/i, 'executive'],
  [/\b(principal|staff|distinguished|fellow)\b/i, 'principal'],
  [/\b(senior|sr\.?|lead|director|manager)\b/i, 'senior'],
  [/\b(junior|jr\.?|intern|entry|associate|assistant|trainee)\b/i, 'junior'],
];

const FUNCTION_MAP = [
  [/\b(engineer|developer|programmer|software|devops|sre|architect)\b/i, 'engineering'],
  [/\b(designer|ux|ui|design)\b/i, 'design'],
  [/\b(product manager|product owner|product)\b/i, 'product'],
  [/\b(marketing|growth|seo|content|brand|demand)\b/i, 'marketing'],
  [/\b(sales|account executive|business development|bdr|sdr)\b/i, 'sales'],
  [/\b(data|analytics|scientist|analyst|ml|machine learning)\b/i, 'data'],
  [/\b(finance|accounting|financial|controller|auditor)\b/i, 'finance'],
  [/\b(legal|attorney|counsel|paralegal|compliance)\b/i, 'legal'],
  [/\b(operations|ops|logistics|supply chain|program manager)\b/i, 'ops'],
];

export function extractCareerSignal(resumeText, employment = []) {
  const text = String(resumeText || '');
  const lower = text.toLowerCase();

  // Skills: dictionary hits, ranked by frequency, top 8.
  const skillCounts = new Map();
  for (const skill of SKILL_DICTIONARY) {
    const re = new RegExp('\\b' + skill.replace(/[+#]/g, '\\$&').replace(/ /g, '\\s+') + '\\b', 'gi');
    const m = lower.match(re);
    if (m) skillCounts.set(skill, m.length);
  }
  const skills = [...skillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([s]) => s);

  // Seniority/function: derive from titles first, then whole text.
  const titleText = (employment.map(e => e.title).join(' ') + ' ' + text).slice(0, 4000);
  let seniority = 'mid';
  for (const [re, val] of SENIORITY_MAP) { if (re.test(titleText)) { seniority = val; break; } }

  let func = 'other';
  for (const [re, val] of FUNCTION_MAP) { if (re.test(titleText)) { func = val; break; } }

  // Years of experience: span between earliest and latest 4-digit year, capped.
  const years = (text.match(/\b(19|20)\d{2}\b/g) || []).map(Number).filter(y => y >= 1970 && y <= 2035);
  let years_exp = null;
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    if (span > 0 && span <= 50) years_exp = span;
  }

  return { skills, seniority, function: func, years_exp };
}

// Per-family ramp language for the 30/60/90 plan. Each entry gives the concrete
// nouns/actions that make a barista plan ≠ a software plan ≠ a warehouse plan:
//   tools   — what you "get hands-on with" in month 1
//   metric  — the kind of number you'd move in month 3
//   peers   — the people/functions you build relationships with
//   win30   — a small, real first-month win specific to the family
const FAMILY_PLAYBOOK = {
  technical: {
    tools: 'the codebase, deploy pipeline, and ticketing system',
    metric: 'latency, defect rate, or delivery speed',
    peers: 'product, design, and the on-call rotation',
    win30: 'close a starter ticket and merge a small, reviewed pull request',
  },
  healthcare: {
    tools: 'the EHR/charting system, unit protocols, and safety checklists',
    metric: 'patient throughput, chart accuracy, or response time',
    peers: 'charge nurses, physicians, and the care team on your unit',
    win30: 'complete onboarding/competency checks and shadow a full shift end-to-end',
  },
  service: {
    tools: 'the POS, menu/recipes, and opening/closing routines',
    metric: 'ticket time, order accuracy, or guest satisfaction',
    peers: 'your shift lead, kitchen/bar, and front-of-house teammates',
    win30: 'run a full shift solo and learn the regulars and the rush flow',
  },
  retail: {
    tools: 'the register/POS, floor layout, and inventory system',
    metric: 'conversion, units-per-transaction, or membership sign-ups',
    peers: 'your shift lead, stockroom, and the rest of the floor team',
    win30: 'hit your daily target and master the open/close and restock routine',
  },
  logistics: {
    tools: 'the scanner/WMS, pick paths, and safety procedures',
    metric: 'picks/hour, on-time dispatch, or error rate',
    peers: 'your lead, dispatch, and the dock/loading crew',
    win30: 'hit the standard rate cleanly and log zero safety incidents',
  },
  office: {
    tools: 'the calendar/scheduling system, CRM/files, and SOPs',
    metric: 'turnaround time, scheduling accuracy, or backlog cleared',
    peers: 'the people you support, IT, and adjacent departments',
    win30: 'take one recurring task fully off your manager\'s plate',
  },
  general: {
    tools: 'the tools, systems, and accounts',
    metric: 'efficiency, revenue, quality, or speed',
    peers: 'your manager, peers, and the teams you depend on',
    win30: 'ship one small, visible win that shows initiative without disrupting anything',
  },
};

function buildProposal({ job, company, r1, r2, r3, profile, family }) {
  const fam = FAMILY_PLAYBOOK[family] || FAMILY_PLAYBOOK.general;
  const strengths = (profile && profile.matchedStrengths) || [];

  // Reference the candidate's REAL relevant strength when ramping — a matched JD
  // skill if they have one, else their real recent title — so the plan reads as
  // theirs, not a template. Never claims a strength the résumé doesn't show.
  // Phrase the anchor differently depending on whether the real strength is a
  // skill (matchedStrengths) or just the recent job title, so it reads naturally
  // ("strength in customer service" vs "experience as a Barista").
  const skillStrength = strengths[0] || '';
  const anchorPhrase = skillStrength
    ? `your existing strength in ${skillStrength.toLowerCase()}`
    : (profile && profile.recentTitle) ? `your experience as ${prefixArticle(profile.recentTitle)}` : '';
  const rampAnchor = anchorPhrase
    ? ` Lean on ${anchorPhrase} to ramp faster than expected.`
    : '';
  const proofHint = profile && profile.proofBullet
    ? ` Aim for a result on the scale of your past work (e.g. "${profile.proofBullet}").`
    : '';

  return {
    opening_note: `A 30/60/90 plan you can attach or bring to the interview — it signals you already think like a ${job} at ${company}${anchorPhrase ? `, and it puts ${anchorPhrase} front and centre` : ''}.`,
    day_30:
`First 30 days — Learn and earn trust:\n` +
`• Meet your manager, peers, and ${fam.peers}; document how success is measured for this ${job}.\n` +
`• Get hands-on with ${fam.tools} tied to ${r1.toLowerCase()}.\n` +
`• ${cap(fam.win30)}.${rampAnchor}`,
    day_60:
`Days 31–60 — Contribute independently:\n` +
`• Take ownership of work centred on ${r1.toLowerCase()}${r2 !== r1 ? ' and ' + r2.toLowerCase() : ''}.\n` +
`• Find one ${fam.metric} number you can measurably improve, and propose the change to your manager.\n` +
`• Build relationships across ${fam.peers} so you're not working in a silo.`,
    day_90:
`Days 61–90 — Drive measurable impact:\n` +
`• Deliver a result tied to ${r1.toLowerCase()} with a number attached (${fam.metric}).${proofHint}\n` +
`• Bring a point of view on ${r3.toLowerCase()} — a recommendation backed by what you've learned.\n` +
`• Set goals with your manager for the next quarter so you're seen as someone who compounds.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Complete résumé document builder (keyless, never fabricates)
//
// Assembles a structured, submittable one-page résumé from the user's OWN
// parsed résumé text — header/contact, summary, experience grouped by role,
// skills, education. Every field is sourced from the résumé (or the cleaned
// versions of the user's own bullets). When a section's data is missing we omit
// it rather than inventing anything. This is the data the PDF renderer consumes.
// ═══════════════════════════════════════════════════════════════════════════

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
// Phone: optional country code, then 10+ digits with common separators
// (spaces, dashes, dots, parens) between groups. Tolerant of "(619) 555-0142".
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const LINKEDIN_RE = /((?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|,)]+)/i;

// Section headers that should never be treated as a name, bullet, or role.
const SECTION_HEADER_RE = /^(experience|work experience|professional experience|employment|employment history|education|skills|technical skills|core competencies|certifications?|summary|professional summary|profile|objective|projects|awards|languages|references|contact|volunteer|activities|interests)\b/i;

function isSectionHeader(line) {
  // Strip decoration that résumé exporters wrap around headers: leading/trailing
  // runs of = - * _ ~ # • and surrounding whitespace, plus a trailing colon. This
  // makes "=== EXPERIENCE ===", "* Skills *", "--- Education ---", "## Summary"
  // all reduce to the bare header word for matching.
  const s = String(line || '')
    .replace(/^[\s=\-*_~#•·–—]+/, '')
    .replace(/[\s=\-*_~#•·–—:]+$/, '')
    .trim();
  if (!s) return false;
  // A short standalone header line ("EXPERIENCE", "Education").
  if (SECTION_HEADER_RE.test(s) && s.split(/\s+/).length <= 4) return true;
  // An inline "SKILLS: a, b, c" / "EDUCATION: ..." line — the prefix before the
  // colon is a section name, so the whole line is a section, not a bullet.
  const colonIdx = String(line || '').indexOf(':');
  if (colonIdx > 0 && colonIdx <= 30) {
    const prefix = String(line).slice(0, colonIdx);
    if (SECTION_HEADER_RE.test(prefix.trim()) && prefix.trim().split(/\s+/).length <= 4) return true;
  }
  return false;
}

// Looks like a contact line — email / phone / linkedin.
function isContactLine(line) {
  return EMAIL_RE.test(line) || PHONE_RE.test(line) || /linkedin\.com/i.test(line);
}

// Pull the candidate's name + contact details from the résumé header. We treat
// the first non-empty, non-section, non-contact line as the name ONLY when it
// reads like a person's name (1–4 words, capitalised, no digits) — otherwise we
// omit it rather than guess. Every contact field is omitted when not found.
export function extractContact(resumeText) {
  const lines = String(resumeText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = { name: '', email: '', phone: '', location: '', linkedin: '' };

  const em = String(resumeText || '').match(EMAIL_RE);
  if (em) out.email = em[0];

  // Phone — only a real 10–13 digit number from the top of the résumé.
  for (const l of lines.slice(0, 8)) {
    const pm = l.match(PHONE_RE);
    if (pm) {
      const digits = pm[0].replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 13) { out.phone = pm[0].trim(); break; }
    }
  }

  const lm = String(resumeText || '').match(LINKEDIN_RE);
  if (lm) out.linkedin = lm[1].replace(/^https?:\/\//, '').replace(/\/$/, '');

  // Name: first line that reads like a person's NAME, not a sentence. Each word
  // must be capitalised (allowing lowercase particles like de/van/von/der) and
  // the line must contain no sentence/verb function words. Otherwise we omit the
  // name rather than print a stray sentence as a header.
  const NAME_STOP = /\b(at|the|and|with|for|of|in|on|to|a|an|was|is|were|are|worked|seeking|resume|cv|curriculum|profile|experienced|skilled)\b/i;
  const PARTICLE = new Set(['de', 'van', 'von', 'der', 'da', 'di', 'la', 'le', 'del', 'bin', 'al']);
  for (const l of lines.slice(0, 5)) {
    if (isSectionHeader(l) || isContactLine(l)) continue;
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue; // names are 2–4 tokens
    if (/[\d@\/:]/.test(l)) continue;
    if (NAME_STOP.test(l)) continue;                    // looks like a sentence
    const looksLikeName = words.every(w => {
      const bare = w.replace(/[^A-Za-z.'-]/g, '');
      if (!bare) return false;
      if (PARTICLE.has(bare.toLowerCase())) return true;
      return /^[A-Z]/.test(bare);                       // each word capitalised
    });
    if (!looksLikeName) continue;
    out.name = l.replace(/[•|]+/g, '').trim();
    break;
  }

  // Location: a "City, ST" / "City, Country" fragment in the top lines. We allow
  // a line that also carries an email (contact lines often pack everything on one
  // row) — we only extract the city fragment, never the email. Skip the name line.
  const CITY_RE = /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2}),\s*([A-Z]{2}\b|[A-Z][a-zA-Z]+)\b/;
  for (const l of lines.slice(0, 8)) {
    if (out.name && l === out.name) continue;
    const cm = l.match(CITY_RE);
    if (cm && !/linkedin|github|@|\.com/i.test(cm[0])) { out.location = cm[0].trim(); break; }
  }

  return out;
}

// Extract a professional summary block: the paragraph under a Summary/Profile/
// Objective header. Returns '' when nothing clean is found — we never invent one.
export function extractSummary(resumeText) {
  const lines = String(resumeText || '').split(/\r?\n/).map(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (/^(summary|professional summary|profile|objective|about)\b/i.test(lines[i]) && lines[i].split(/\s+/).length <= 3) {
      const collected = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l) { if (collected.length) break; else continue; }
        if (isSectionHeader(l)) break;
        if (DATE_RANGE_RE.test(l)) break;
        if (isContactLine(l)) continue;
        collected.push(l.replace(/^[•\-*–·]\s*/, ''));
        if (collected.join(' ').length > 600) break;
      }
      const text = collected.join(' ').trim();
      if (text.split(/\s+/).length >= 6) return text.slice(0, 700);
    }
  }
  return '';
}

// Group the résumé's bullet lines under their employment entries. Walks the
// résumé text once: finds the line where each role header appears, then attaches
// the bullet-looking lines between consecutive role headers. Bullets are the
// user's REAL lines — never fabricated.
function groupBulletsByRole(resumeText, employment) {
  const rawLines = String(resumeText || '').split(/\r?\n/);
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const roleKeys = employment.map(e => ({
    entry: e,
    co: norm(e.company),
    title: norm(e.title),
    bullets: [],
    startLine: -1,
  }));

  for (let i = 0; i < rawLines.length; i++) {
    const ln = norm(rawLines[i]);
    if (!ln) continue;
    for (const rk of roleKeys) {
      if (rk.startLine !== -1) continue;
      if (rk.co && ln.includes(rk.co)) { rk.startLine = i; break; }
    }
  }

  const ordered = roleKeys.filter(r => r.startLine !== -1).sort((a, b) => a.startLine - b.startLine);
  for (let r = 0; r < ordered.length; r++) {
    const start = ordered[r].startLine;
    const end = r + 1 < ordered.length ? ordered[r + 1].startLine : rawLines.length;
    for (let i = start + 1; i < end; i++) {
      const line = rawLines[i].replace(/^[\s•\-*–·●▪◦>]+/, '').trim();
      if (!line) continue;
      if (isSectionHeader(line)) break;          // hit Education/Skills etc.
      if (DATE_RANGE_RE.test(line)) continue;    // another role's date line
      const words = line.split(/\s+/);
      if (words.length < 3 || words.length > 60) continue;
      if (isContactLine(line)) continue;
      ordered[r].bullets.push(line);
    }
  }
  return roleKeys;
}

// Format a role's date range for display, e.g. "Jan 2020 – Present".
function formatDates(entry) {
  const s = (entry.start_date || '').trim();
  let e = (entry.end_date || '').trim();
  if (!s && !e) return '';
  if (/present|current|now/i.test(e)) e = 'Present';
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

// Title-case a dictionary skill for display (keeps known acronyms uppercase).
function titleCaseSkill(s) {
  const ACR = new Set(['aws','gcp','sql','nosql','seo','sem','ppc','cicd','php','css','html','api','ui','ux','crm','sap']);
  return String(s || '').split(/\s+/).map(w => {
    const lw = w.toLowerCase();
    if (ACR.has(lw)) return w.toUpperCase();
    if (lw === 'javascript') return 'JavaScript';
    if (lw === 'typescript') return 'TypeScript';
    if (lw === 'nodejs' || lw === 'node') return 'Node.js';
    if (lw === 'powerbi') return 'Power BI';
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// Build the skills line from the user's REAL résumé: dictionary skills found in
// the text (extractCareerSignal) plus any JD keywords the résumé already
// contains (strong matches). Nothing invented — only terms present in the
// résumé. Returns [] when none found.
function buildSkillsLine(resumeText, jobDescription, employment) {
  const present = [];
  const seen = new Set();
  const add = (label) => {
    const k = String(label || '').toLowerCase().trim();
    if (!k || seen.has(k)) return;
    seen.add(k); present.push(label);
  };

  // 1) Dictionary skills/tools the résumé actually contains — the strongest,
  //    most recruiter-legible signals.
  let sig = { skills: [] };
  try { sig = extractCareerSignal(resumeText, employment); } catch (_) {}
  for (const s of sig.skills || []) add(titleCaseSkill(s));

  // 2) Multi-word JD phrases the résumé already matches (e.g. "Customer Service",
  //    "Project Management"). We add ONLY phrase keywords — single bare verbs
  //    ("greet", "sell", "handle") read as noise on a skills line, so we skip
  //    them. Everything here is still grounded in the résumé text.
  if (jobDescription) {
    const ranked = rankKeywords(jobDescription, 40);
    const resumeLower = String(resumeText || '').toLowerCase();
    const resumeTokens = tokenSet(resumeText);
    for (const kw of ranked) {
      if (!kw.isPhrase) continue;
      if (resumeHasKeyword(kw, resumeLower, resumeTokens)) add(kw.display);
      if (present.length >= 14) break;
    }
  }

  // 3) An explicit "Skills:" line in the résumé is the user's own curated list —
  //    pull those verbatim so we honour what they already wrote.
  for (const raw of String(resumeText || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:technical\s+|core\s+)?skills\s*[:\-]\s*(.+)$/i);
    if (m) {
      for (const part of m[1].split(/[,;·|]/)) {
        const t = part.trim();
        if (t && t.length <= 40 && /[a-z]/i.test(t)) add(t.replace(/\s+/g, ' '));
        if (present.length >= 18) break;
      }
    }
  }

  return present.slice(0, 18);
}

// Extract education lines: lines containing a degree keyword (or institution
// lines inside an Education section), de-duped. Returns [] when none found — we
// never invent education.
// Real-degree matcher. "associate" is the trap: it's both a degree (Associate of
// Arts) AND a job-level word ("Sales Floor Associate"). We only count "associate"
// as a degree when it's immediately followed by degree grammar — "of", "degree",
// "in", "'s in", or an "(A.A.)"-style parenthetical — never as a bare role word.
// Every other branch is an unambiguous real degree (PhD, MBA, Bachelor's, BS/BA,
// MS, AA/AAS, diploma, GED, certificate).
const ASSOCIATE_DEGREE_RE = /\bassociate'?s?\b\s*(?:of\b|degree\b|in\b|'?s\s+in\b|\()/i;
const DEGREE_RE = /\b(ph\.?d|doctorate|master'?s?|m\.?b\.?a|bachelor'?s?|b\.?s\.?|b\.?a\.?|m\.?s\.?|a\.?a\.?s?\b|diploma|ged|certificate|high school diploma)\b/i;

// True when a line carries a real degree credential. Handles the "associate"
// special case separately so role titles like "Customer Service Associate" do
// NOT count as education, while real "Associate of Arts" lines still do.
function hasDegree(line) {
  return DEGREE_RE.test(line) || ASSOCIATE_DEGREE_RE.test(line);
}

// True when a line is really an EMPLOYMENT entry, not a degree line: it carries a
// date RANGE (e.g. "Jan 2021 - Present") and/or matches an extracted employment
// entry by company+title. Real degree lines carry a single graduation year, not a
// range, so this cleanly separates "Target — Sales Floor Associate  2021-Present"
// (a job) from "Associate of Arts — City College, 2018" (a degree).
function isEmploymentLine(line, employment) {
  if (DATE_RANGE_RE.test(line)) return true;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ln = norm(line);
  for (const e of employment || []) {
    const co = norm(e.company), ti = norm(e.title);
    if (co && ti && ln.includes(co) && ln.includes(ti)) return true;
  }
  return false;
}

export function extractEducation(resumeText, employment = []) {
  const lines = String(resumeText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  let inEduSection = false;
  for (const l of lines) {
    if (/^education\b/i.test(l) && l.split(/\s+/).length <= 3) { inEduSection = true; continue; }
    if (inEduSection && isSectionHeader(l) && !/^education/i.test(l)) inEduSection = false;
    const hit = hasDegree(l);
    if (hit || (inEduSection && /\b(university|college|institute|school|academy)\b/i.test(l))) {
      // Never let an employment entry (date range / matched company+title) leak
      // into Education — it's a role header, not a degree line.
      if (isEmploymentLine(l, employment)) continue;
      const clean = l.replace(/^[•\-*–·]\s*/, '').trim().slice(0, 160);
      const key = clean.toLowerCase();
      if (clean.split(/\s+/).length >= 2 && !seen.has(key)) { seen.add(key); out.push(clean); }
      if (out.length >= 5) break;
    }
  }
  return out;
}

// Build the complete, structured résumé document. Reuses the user's parsed
// employment + their OWN bullets (cleaned via the same safe cleanBullet pass),
// grouped under each role. Returns a plain object the PDF renderer consumes.
// NEVER fabricates: sections with no data are simply absent from the result.
export function buildResumeDocument({ resume, jobDescription, job, company }) {
  const text = String(resume || '');
  const contact = extractContact(text);
  const summary = extractSummary(text);

  let employment = [];
  try { employment = extractEmployment(text); } catch (_) { employment = []; }

  const grouped = groupBulletsByRole(text, employment);
  const experience = [];
  for (const rk of grouped) {
    const e = rk.entry;
    if (!e.company && !e.title) continue;
    // Drop empty/whitespace bullets at the source — a blank bullet would render
    // as a lone "•" glyph with no text, which looks broken. cleanBullet can
    // return '' or a bare "." for trivial input, so we trim and require an
    // actual alphanumeric character before keeping a bullet.
    const bullets = rk.bullets
      .map(b => cleanBullet(b))
      .map(b => String(b || '').trim())
      .filter(b => b && /[a-z0-9]/i.test(b));
    experience.push({
      title: e.title || '',
      company: e.company || '',
      location: '',
      dates: formatDates(e),
      bullets,
    });
  }

  const skills = buildSkillsLine(text, jobDescription, employment);
  const education = extractEducation(text, employment);

  return {
    name: contact.name || '',
    contact: {
      email: contact.email || '',
      phone: contact.phone || '',
      location: contact.location || '',
      linkedin: contact.linkedin || '',
    },
    role: job || '',
    targetCompany: company || '',
    summary,
    experience,
    skills,
    education,
  };
}

// Build a clean, professional download filename for the résumé PDF:
//   "First Last — Role Resume.pdf" → "Role Resume.pdf" → "Seen Resume.pdf".
// Returns the human-facing filename (spaces/em-dash kept); callers ASCII-encode
// for Content-Disposition as needed.
export function resumeFileName({ name, role }) {
  const cleanName = String(name || '').replace(/[^\w .'-]/g, '').replace(/\s+/g, ' ').trim();
  const cleanRole = String(role || '').replace(/[^\w .,'/&-]/g, '').replace(/\s+/g, ' ').trim();
  if (cleanName && cleanRole) return `${cleanName} — ${cleanRole} Resume.pdf`;
  if (cleanName) return `${cleanName} — Resume.pdf`;
  if (cleanRole) return `${cleanRole} Resume.pdf`;
  return 'Seen Resume.pdf';
}
