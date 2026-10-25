// Deterministic, keyless résumé analysis.
//
// This module replaces every LLM call in api/resume.js with pure, free,
// CPU-only logic. No external API keys, no network calls, fully deterministic
// so it scales to thousands of concurrent users with zero marginal cost.
//
// It produces the EXACT response shapes the frontend (app/resume/page.tsx)
// expects for each tool: scanner, optimize, advantage, coach, proposal.

import { parseResume } from '../resume/parse/index.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { docToLegacyEmployment, docToLegacyDocument } from '../resume/model.js';
import { extractJobFacts } from '../optimizer/extractJobFacts.js';
import { extractResumeFacts } from '../optimizer/extractResumeFacts.js';
import { scoreFit } from '../optimizer/scoreFit.js';
import { displaySkill } from '../optimizer/explainScore.js';
import { hasStemmed } from '../optimizer/lemma.js';

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
export function runAdvantage({ job, company, resume, jobDescription, background, intelNote, intelStats, postedAt = null, now = null }) {
  // The posting's requirements, read by the SAME reader as the fit check (requirement and duty
  // sections only, real skills only). rankKeywords counted single words over the whole posting —
  // About-us blurb included — so plans said "work centred on machine learning and assistant",
  // "experience with data and system", "leans on core and applications", "associates and
  // performance" (paid-tool test + harness, 2026-10-25).
  if (/^[a-z][a-z0-9]*$/.test(String(company || ''))) company = company.charAt(0).toUpperCase() + company.slice(1); // a board slug ("kunai")
  const { facts, ranked } = rankRequirements(jobDescription, job);
  // names for the plan's sentences; the posting's own examples only where the plan quotes the posting
  const topReqs = ranked.slice(0, 5).map(k => k.name || k.display);
  const postingReqs = ranked.slice(0, 3).map(k => k.display);
  const r1 = topReqs[0] || 'the core requirement';
  const r2 = topReqs[1] || r1;
  const r3 = topReqs[2] || r2;

  // Build the candidate's REAL profile from their résumé (or `background` as a
  // fallback when no résumé text was supplied). This is what makes the output
  // specific rather than boilerplate.
  const profile = buildResumeProfile({ resume: resume || background || '', ranked, facts });
  const family = classifyRoleFamily({ job, jobDescription, ranked });
  const industry = detectIndustry(jobDescription);
  const level = jobLevel(job);
  const listing = listingAge(postedAt, now);

  const coach = buildCoach({ job, company, topReqs, postingReqs, profile, intelNote, intelStats, family, industry, listing });
  const plan = buildProposal({ job, company, r1, r2, r3, profile, family, industry, level });

  return { ...coach, ...plan };
}

// ── The posting's requirements for the strategy plan ───────────────────────────────────────────
// [{ term, display, count, isPhrase, importance, hard, members? }] — required hard skills first, then
// duties, then preferred. A choice ("Go, Java, or C/C++") is ONE entry; an example ("Kafka" in
// "event-driven architectures like Kafka") rides with the skill it illustrates. Never a fragment:
// every entry is a skill in the shared vocabulary (lib/optimizer/*Vocabulary.js).
export function rankRequirements(jobDescription, job) {
  const facts = extractJobFacts(String(jobDescription || ''), { jobTitle: job || '' });
  const skills = facts.filter(f => f.factType === 'skill' && !f.soft && !PITCH_NOISE.test(f.normalizedLabel));
  const byLabel = new Map(skills.map(f => [f.normalizedLabel, f]));
  const tier = (f) => (f.importance === 'required' ? (f.hard ? 0 : 1) : 2);
  const sorted = skills.slice().sort((a, b) => (tier(a) - tier(b)) || (b.weight - a.weight) || ((b.mentions || 0) - (a.mentions || 0)));
  const used = new Set();
  const ranked = [];
  for (const f of sorted) {
    if (used.has(f.normalizedLabel)) continue;
    if (f.exampleOf && byLabel.has(f.exampleOf)) continue;
    let members = [f];
    if (f.anyOf && f.anyOfLabels && f.anyOfLabels.length >= 2) members = f.anyOfLabels.map(l => byLabel.get(l)).filter(Boolean);
    members.forEach(m => used.add(m.normalizedLabel));
    const names = members.map(m => displaySkill(m.normalizedLabel));
    const ex = (f.examples || []).map(l => byLabel.get(l)).filter(Boolean).slice(0, 2);
    ex.forEach(m => used.add(m.normalizedLabel));
    const display = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
      : ex.length ? `${names[0]} such as ${ex.map(m => displaySkill(m.normalizedLabel)).join(' or ')}` : names[0];
    const name = names.length > 1 ? display : names[0];
    ranked.push({ term: f.normalizedLabel, display, name, count: f.mentions || 1, isPhrase: display.includes(' '), importance: f.importance, hard: !!f.hard, members: members.map(m => m.normalizedLabel) });
  }
  return { facts, ranked };
}

/** Does the posting state anything to build on (a skill, years, a credential or a degree)? */
export function requirementsStated(jobDescription, job) {
  const facts = extractJobFacts(String(jobDescription || ''), { jobTitle: job || '' });
  return facts.some(f => (f.factType === 'skill' && !f.soft) || (f.factType === 'constraint' && ['years', 'certification', 'degree', 'management', 'language'].includes(f.kind)));
}

// The job's level from its title: a manager/supervisor/leader role gets a plan for running a team,
// not the cashier's "master the register" plan (an "Assistant Store Leader" got exactly that).
function jobLevel(job) {
  const t = String(job || '');
  if (/\b(?:manager|supervisor|leader|director|head\s+of|superintendent|foreman|general\s+manager)\b/i.test(t)) return 'manager';
  if (/\b(?:team|shift|crew)\s+lead\b|\blead\s+(?:associate|cashier|barista|teller|server|technician|cook)\b|\bkey\s*holder\b/i.test(t)) return 'lead';
  return 'staff';
}

// How long the listing has been up, from the day Seen first saw it (the only date Seen has).
function listingAge(postedAt, now) {
  const t = postedAt ? Date.parse(postedAt) : NaN;
  if (!Number.isFinite(t)) return null;
  const ms = (now ? Date.parse(now) : Date.now()) - t;
  if (!(ms >= 0)) return null;
  return { days: Math.floor(ms / 86400000) };
}

// ── Candidate profile from their own résumé ──────────────────────────────────
// Extracts the real, résumé-grounded facts the playbook references:
//   recentTitle / recentCompany  — their latest role (extractEmployment)
//   skills                       — dictionary skills present in the résumé
//   matched / missing            — JD ranked keywords they DO / DON'T have
//   proofBullet                  — their strongest (quantified) real bullet
//   transferable                 — a real skill/role to pivot from when missing
// Every field is grounded in résumé text; absent data is left empty, never faked.
export function buildResumeProfile({ resume, ranked, facts = null }) {
  const text = String(resume || '');
  let employment = [];
  try { employment = extractEmployment(text); } catch (_) { employment = []; }
  let signal = { skills: [], seniority: 'mid', function: 'other', years_exp: null };
  try { signal = extractCareerSignal(text, employment); } catch (_) {}

  // The latest role whose parsed title reads as a job title. A broken parse is never
  // interpolated: "As a (1,800 subscribers)., I'd bring…" shipped in the LinkedIn template when a
  // channel's follower count came out as the most recent "title" (willingness-to-pay test,
  // 2026-10-25). With no plausible title the templates omit the phrase.
  const recent = employment.find(e => plausibleJobTitle(e && e.title)) || null;
  const recentTitle = recent ? cleanTitleValue(recent.title) : '';
  const recentCompany = recent && plausibleCompanyName(recent.company) ? cleanTitleValue(recent.company) : '';

  // Display-friendly real skills from the dictionary (title-cased acronyms).
  const skills = (signal.skills || []).map(s => titleCaseSkill(s));

  // Intersect the JD's ranked requirements with what the résumé actually proves.
  const resumeLower = text.toLowerCase();
  const resumeTokens = tokenSet(text);
  const matched = [];
  const missing = [];
  if (facts) {
    // The fit check's own match (aliases, examples, choices): a strength is a requirement the
    // résumé states (exact or alias, never a "related" inference); a gap is a REQUIRED one it does
    // not. Starbucks "partners" (coworkers) can never become a skill: only vocabulary skills are read.
    const fit = scoreFit(facts, text.trim() ? extractResumeFacts(text) : []);
    const byReq = new Map(fit.matches.map(m => [m.requirement, m]));
    for (const kw of (ranked || [])) {
      const ms = (kw.members || [kw.term]).map(x => byReq.get(x)).filter(Boolean);
      const hit = ms.find(m => m.matched && m.via !== 'related');
      // the candidate's strength is what THEIR résumé shows: "Go" from "Go, Java or C/C++", "email
      // marketing (Mailchimp)" — never the posting's other examples ("…such as HubSpot")
      if (hit) {
        const head = (kw.members || []).length > 1 ? displaySkill(hit.requirement) : (kw.name || kw.display);
        matched.push(hit.relatedTo && (kw.members || []).length <= 1 ? `${head} (${displaySkill(hit.relatedTo)})` : head);
      } else if (!ms.some(m => m.matched) && kw.importance === 'required' && kw.hard) missing.push(kw.name || kw.display);
    }
  } else {
    for (const kw of (ranked || [])) {
      if (resumeHasKeyword(kw, resumeLower, resumeTokens)) matched.push(kw.display);
      else missing.push(kw.display);
    }
  }

  // `matchedStrengths`: the matched terms minus generic seniority / role-family
  // noise (e.g. "senior", "engineer", "services") that read as filler in a pitch.
  // We lead the script/cover-letter with these REAL, differentiating skills. The
  // full `matched`/`missing` lists stay intact for honest gap analysis.
  const matchedStrengths = matched.filter(m => !PITCH_NOISE.test(m));

  // The single strongest proof bullet: a quantified real bullet, longest wins.
  let proofBullet = '';
  try {
    // An EXPERIENCE bullet from the parsed résumé (wrapped lines rejoined — "…sign-up goals 3 quarters
    // in" was a line cut by the PDF wrap; a summary line is not a result), quantified, the one that
    // shows a requirement the posting names first; else the longest quantified bullet.
    let pool = [];
    if (facts) {
      try {
        const doc = parseResume({ text, source: 'text' });
        pool = (doc.experience || []).flatMap(r => (r.bullets || []).map(bl => String(bl.text || bl || '').trim())).filter(Boolean);
      } catch (_) { pool = []; }
    }
    if (!pool.length) pool = extractBullets(text);
    const quantified = pool.filter(hasQuantification);
    const relevant = (bl) => matched.filter(m => hasStemmed(bl, m.toLowerCase())).length;
    quantified.sort((a, b) => (relevant(b) - relevant(a)) || (b.length - a.length));
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

// ── Is a parsed value safe to put in a sentence as a job title / employer? ──────────────────
// Every template that says "As a <title>" or "your experience as a <title>" reads the title
// through this gate. It rejects what a mis-parse produces (counts, dates, sentences, URLs,
// parenthesised asides, bullet text) and accepts short noun phrases that name a job.
function cleanTitleValue(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().replace(/[\s.,;:–—-]+$/, '');
}
const TITLE_JUNK_RE = /@|https?:|www\.|\d{3,}|\d[\d,]*\s*(?:subscribers|followers|views|members|users|customers|people|clients|employees|%)|[%$#|•()[\]{}"“”]/i;
export function plausibleJobTitle(value) {
  const t = cleanTitleValue(value);
  if (t.length < 2 || t.length > 70) return false;
  if (!/^[A-Za-z]/.test(t)) return false;                 // "(1,800 subscribers)." / "• led…"
  if (TITLE_JUNK_RE.test(t)) return false;
  if (DATE_RANGE_RE.test(t) || /\b(?:19|20)\d{2}\b/.test(t)) return false;
  if (/[a-z]{3,}[.!?]\s+\S/.test(t)) return false;         // a sentence, not a title ("Sr. Engineer" is fine)
  const words = t.split(/\s+/);
  if (words.length > 8) return false;
  if (COMMON_TITLE_WORDS.test(t)) return true;
  // An unlisted title ("Barback", "Membership Specialist"): a short phrase of capitalised words.
  return words.length <= 5 && words.every(w => /^[A-Z&]/.test(w) || /^(?:of|and|the|for|to|in|at|&|-|–|—|\/)$/i.test(w));
}
function plausibleCompanyName(value) {
  const t = cleanTitleValue(value);
  if (t.length < 2 || t.length > 70) return false;
  if (!/^[A-Za-z0-9]/.test(t)) return false;
  if (/@|https?:|[•()[\]{}"“”]/.test(t) || /\d[\d,]*\s*(?:subscribers|followers|views)/i.test(t)) return false;
  return t.split(/\s+/).length <= 8 && !/[.!?]\s+\S/.test(t);
}

// Generic seniority / role-title / role-family words that are technically JD
// keywords but read as filler when used as a candidate "strength" ("experience
// with senior"). We strip them from the pitch headline, never from gap analysis.
const PITCH_NOISE = /^(senior|junior|lead|staff|principal|entry|mid|engineer|developer|programmer|manager|director|analyst|specialist|coordinator|representative|associate|assistant|technician|clerk|cashier|driver|nurse|designer|consultant|administrator|agent|officer|services?|backend|frontend|fullstack|full stack)$/i;

// ── Role-family classifier (varies the 30/60/90 plan) ────────────────────────
// The plan follows the TARGET JOB's field. The job TITLE decides; the posting's text only when
// the title names no field. The old classifier took the first of six regexes that matched
// anywhere in title + posting, healthcare first, so a CRM Marketing Coordinator posting from a
// hospital ("patient experience", "healthcare brand") got a nursing plan — "charge nurses,
// physicians… EHR/charting… patient throughput, chart accuracy" (willingness-to-pay test,
// 2026-10-25). Families come from lib/application-intelligence/roleOntology.js; a job the
// ontology cannot place gets the 'general' plan, which names the job and company and invents
// nothing about the field.
//
// Clinical (licensed bedside) titles are not an ontology family (it models healthcare SUPPORT),
// so they are recognised from the TITLE only — never from posting words like "patient".
const CLINICAL_TITLE_RE = /\b(?:nurse|nursing|rn|lpn|lvn|np|physician|doctor|surgeon|therapist|pharmacist|paramedic|emt|dental hygienist|hygienist|dentist|respiratory|sonographer|radiolog\w*|clinician|midwife)\b/i;
// Posting text alone may pick a field only when it does so clearly: the top family must lead the
// runner-up by a wide margin (confidence ≥ 0.6 ⇔ top ≥ 1.5·(second + 1.5)).
const TEXT_ONLY_MIN_CONFIDENCE = 0.6;
export function classifyRoleFamily({ job, jobDescription, ranked }) {
  const title = String(job || '').trim();
  if (CLINICAL_TITLE_RE.test(title)) return 'clinical';
  const byTitle = detectRoleFamily(title, '');
  if (byTitle.family !== 'general' && FAMILY_PLAYBOOK[byTitle.family]) return byTitle.family;
  const text = `${(ranked || []).map(k => k.display).join(' ')} ${jobDescription || ''}`;
  const byText = detectRoleFamily('', text);
  if (byText.family !== 'general' && byText.confidence >= TEXT_ONLY_MIN_CONFIDENCE && FAMILY_PLAYBOOK[byText.family]) return byText.family;
  return 'general';
}

// The industry the employer is in, when the posting says so clearly (two different signal words).
// Used only to tell the person to learn that context — it never adds facts about the industry.
const INDUSTRY_SIGNALS = [
  ['healthcare', /\b(?:hospitals?|health ?care|patients?|clinics?|clinical|medical|health system|care team)\b/gi],
  ['financial services', /\b(?:bank|banking|credit union|lending|insurance|fintech|wealth management|payments)\b/gi],
  ['retail', /\b(?:retail|retailer|stores?|e-?commerce|merchandise|shoppers?)\b/gi],
  ['software', /\b(?:saas|software|platform|apis?|cloud)\b/gi],
  ['education', /\b(?:schools?|district|students?|university|universities|college|classroom)\b/gi],
  ['hospitality', /\b(?:hotels?|resorts?|guests?|hospitality|casino)\b/gi],
  ['logistics', /\b(?:warehouses?|distribution center|fulfillment|freight|shipping|supply chain)\b/gi],
  ['manufacturing', /\b(?:manufacturing|manufacturer|plant|production line|assembly)\b/gi],
  ['government', /\b(?:federal|county|municipal|public sector|government agency)\b/gi],
  ['nonprofit', /\b(?:non-?profit|donors?|fundraising|mission-driven)\b/gi],
];
// The industry a family's own plan already speaks to — no extra line for a nurse at a hospital.
const FAMILY_HOME_INDUSTRY = {
  clinical: 'healthcare', healthcare_support: 'healthcare', retail: 'retail', software_engineering: 'software',
  education: 'education', hospitality: 'hospitality', warehouse: 'logistics', delivery_logistics: 'logistics',
};
export function detectIndustry(jobDescription) {
  const text = String(jobDescription || '');
  let best = null;
  for (const [industry, re] of INDUSTRY_SIGNALS) {
    const distinct = new Set((text.match(re) || []).map(w => w.toLowerCase().replace(/s$/, '')));
    if (distinct.size >= 2 && (!best || distinct.size > best.n)) best = { industry, n: distinct.size };
  }
  return best ? best.industry : null;
}

// What to look up about the employer, by the kind of employer it is: a grocery chain has store
// openings and local news, not a "funding round" (test user Maria, Fry's, 2026-10-25).
function employerNews(family, industry) {
  if (industry === 'software' || ['software_engineering', 'data_analytics'].includes(family)) return 'a recent product launch, funding round, or announcement you can reference';
  if (industry === 'healthcare' || ['clinical', 'healthcare_support'].includes(family)) return 'a recent expansion, new service, or quality recognition you can reference';
  if (industry === 'education' || family === 'education') return "the school's programs, results, or recent news you can reference";
  if (industry === 'government') return 'the agency\'s current priorities or recent news you can reference';
  if (['retail', 'food_service', 'hospitality', 'warehouse', 'delivery_logistics', 'valet_parking', 'security', 'customer_service'].includes(family) || ['retail', 'hospitality', 'logistics'].includes(industry))
    return 'a recent store or site opening, local news, or a community program you can reference';
  return 'a recent announcement or news item about the company you can reference';
}

// A skill as it reads inside a sentence: a proper name keeps its casing ("Go", "HubSpot", "generative
// AI"); an ordinary skill is lower case ("payments"). Plain .toLowerCase() wrote "experience with go
// and hubspot". Choices are cased part by part ("Go, Java or C/C++").
function low(s) {
  // the plan's skills come from displaySkill, already cased for a sentence; only a Title Case
  // keyword ("Customer Service") is lowered
  const t = String(s || '');
  return /^(?:[A-Z][a-z]+)(?: [A-Z][a-z]+)*$/.test(t) && displaySkill(t.toLowerCase()) === t.toLowerCase() ? t.toLowerCase() : t;
}

// Prefix the correct indefinite article for a noun phrase ("a Barista", "an
// Engineer"). Keeps the phrase's own casing.
function prefixArticle(phrase) {
  const p = String(phrase || '').trim();
  if (!p) return p;
  return /^[aeiou]/i.test(p) ? `an ${p}` : `a ${p}`;
}

function buildCoach({ job, company, topReqs, postingReqs = null, profile, intelNote, intelStats, family = 'general', industry = null, listing = null }) {
  const r1 = topReqs[0] || 'the core requirement';
  const reqList = (postingReqs || topReqs).slice(0, 3).join(', ') || 'the role’s core priorities';

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
    scriptStrength = `my hands-on experience with ${low(s1)} and ${low(s2)}`;
  } else if (hasStrength) {
    scriptStrength = `my hands-on experience with ${low(s1)}`;
  } else if (profile.recentTitle) {
    scriptStrength = `my background as ${prefixArticle(profile.recentTitle)}, which maps closely to what this role needs`;
  } else {
    scriptStrength = `my background, which lines up with what you're hiring for`;
  }
  const hiring_manager_script =
`Hi [First name] — I'm applying for the ${job} role at ${company}. ` +
expPhrase +
`I'd bring ${scriptStrength}` +
(hasStrength ? ` — ${s2 ? 'two of the skills' : 'a skill'} your posting calls for.` : `, especially around ${low(r1)}.`) +
` ` +
`Before I submit, I'd value 10 minutes to hear what "great" looks like here in the first 90 days. ` +
`Would a short call this week work? Either way, thank you — I'm genuinely excited about ${company}.`;

  // Timing from the listing's REAL age (the day Seen first saw it). "Apply within the first 48
  // hours" was said about a listing that had been up 5 days (2026-10-25); with no date, no claim.
  const when = !listing
    ? 'Apply as soon as your materials are ready — early applicants are read before the pile grows.'
    : listing.days <= 1
      ? 'Seen first saw this listing within the last day — apply today, while the pile is small.'
      : listing.days <= 7
        ? `This listing has been up about ${listing.days} days — the first wave of applicants is already in, so apply today and follow up directly with a person rather than waiting.`
        : `This listing has been up about ${listing.days} days. It may still be open, but check it is live on the employer's site, then apply and reach a person directly — late applications rarely win on timing alone.`;
  const timing_note = intelStats
    ? `This company responds to roughly ${Math.round((intelStats.response_rate || 0) * 100)}% of applicants and ghosts about ${Math.round((intelStats.ghost_rate || 0) * 100)}%, with an average wait near ${Math.round(intelStats.avg_wait_days || 0)} days. ${when}`
    : `${when} If you have no response after 7 days, follow up once.`;

  // Honest gap-coaching sentence: only when there's a real top requirement the
  // résumé doesn't show. Coaches transferable positioning — never claims it.
  const gapCoach = gapList
    ? ` The posting also leans on ${gapList}, which your résumé doesn't yet show — if you have adjacent experience, name it honestly as transferable rather than claiming the keyword.`
    : '';

  let company_intel;
  if (intelNote) {
    company_intel = `${intelNote} Lead your outreach by acknowledging you know how they treat applicants — say you'll be proactive with follow-up. ` +
      (hasStrength
        ? `Anchor your pitch on your real strength in ${strengths.slice(0, 2).map(low).join(' and ')} — ${s2 ? 'requirements' : 'a requirement'} the posting names directly.`
        : `Tie your pitch to ${reqList}, the priorities their posting emphasises most, and frame your ${profile.transferable ? profile.transferable + ' background' : 'closest experience'} as transferable.`) + gapCoach;
  } else {
    company_intel = `Research three things before you apply to ${company}: (1) ${employerNews(family, industry)}; (2) who the hiring manager likely is (search "${job} ${company}" on LinkedIn); (3) the priorities their posting repeats — here, ${reqList}. ` +
      (hasStrength
        ? `Then mirror that language and foreground your real experience in ${low(s1)}.`
        : `Mirror that exact language and position your ${profile.transferable ? profile.transferable + ' experience' : 'closest experience'} as the bridge.`) + gapCoach;
  }

  // ── cover_letter_framework — the "proof" paragraph references the candidate's
  //    REAL strongest bullet / matched strength, not a generic placeholder. ──
  const proofLine = profile.proofBullet
    ? `Use your real result: "${profile.proofBullet}". Lead with that number.`
    : hasStrength
      ? `Tell one concrete story where you used ${low(s1)}${s2 ? ' or ' + low(s2) : ''}, and attach a real metric (%, $, time saved, scale).`
      : `Tell one concrete story from your ${profile.transferable ? profile.transferable + ' experience' : 'background'} that shows the same underlying skill, and attach a real metric. Be honest that it's adjacent — show the transfer, don't overclaim.`;
  const hookStrength = hasStrength
    ? `your real experience with ${low(s1)} maps directly to what they need`
    : `${profile.recentTitle ? 'your background as ' + prefixArticle(profile.recentTitle) : 'your experience'} gives you transferable footing for ${low(r1)}`;
  const cover_letter_framework =
`Paragraph 1 — Hook: Name the ${job} role and one specific reason ${company} stands out to you (a product, value, or recent move). State that ${hookStrength}.\n\n` +
`Paragraph 2 — Proof: ${proofLine} Show, don't claim.\n\n` +
`Paragraph 3 — Close: Connect that result to the impact you'd have at ${company} in this role, and ask for the conversation. Keep the whole letter under 250 words.`;

  const referralFit = hasStrength
    ? `why you're a fit (your experience in ${low(s1)})`
    : `why you're a fit (${profile.transferable ? 'your ' + profile.transferable + ' background, framed as transferable to ' + low(r1) : 'your closest relevant experience for ' + low(r1)})`;
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

// NOTE: the alternation MUST be \b-anchored — without boundaries, company names that
// merely CONTAIN a title word ("Salesforce" ⊃ sales, "Initech"/"Fintech Labs" ⊃ tech)
// classify as titles, the real title gets rejected as a company, and the whole entry is
// silently dropped from résumé surveys / tenure data.
const COMMON_TITLE_WORDS = /\b(engineer|developer|manager|director|designer|analyst|consultant|lead|architect|specialist|coordinator|associate|officer|administrator|scientist|intern|president|founder|head|chief|vp|vice president|supervisor|representative|recruiter|accountant|nurse|teacher|technician|strategist|marketer|writer|editor|producer|owner|partner|advisor|principal|fellow|assistant|agent|clerk|operator|planner|buyer|controller|auditor|paralegal|attorney|counsel|surgeon|physician|therapist|pharmacist|professor|instructor|chef|stylist|handler|driver|courier|packer|picker|stocker|cashier|warehouse|welder|mechanic|laborer|labourer|janitor|custodian|cook|server|bartender|barista|dishwasher|forklift|loader|sorter|installer|electrician|plumber|carpenter|painter|roofer|machinist|fabricator|assembler|inspector|dispatcher|foreman|receptionist|teller|waiter|waitress|groundskeeper|landscaper|mover|cleaner|attendant|greeter|bagger|busser|caregiver|orderly|phlebotomist|paramedic|firefighter|worker|crew|technologist|dietitian|hygienist|machine operator|line cook|sales|assembly|production|fabrication|maintenance|packaging|sanitation|host|hostess|tech)\b/i;

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

// Employment type / arrangement tokens that résumés append after a company.
const EMPLOYMENT_TYPE_RE = /\b(temp(?:orary)?|contract(?:or)?|full[\s-]?time|part[\s-]?time|seasonal|intern(?:ship)?|freelance|per[\s-]?diem|remote|hybrid|on-?site|w2|1099|c2h|contract\s+to\s+hire)\b/i;

// A segment that is a work LOCATION or employment-type/date META, not a company name —
// so it never gets mistaken for the employer (which fragments the company page).
function isLocationOrMeta(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/,\s*[A-Z]{2}\b/.test(t)) return true;                          // "La Jolla, CA"
  if (EMPLOYMENT_TYPE_RE.test(t) && t.split(/\s+/).length <= 3) return true; // "Temp contract"
  if (DATE_RANGE_RE.test(t) || /^\W*(19|20)\d\d\b/.test(t)) return true;     // dates
  return false;
}

// Reduce an extracted company field to just the employer name — strip an appended
// location, employment type, dates, and separators. "Aptera — La Jolla, CA · Temp
// contract" → "Aptera". Keeps intel routed to the real company when people search it.
function cleanCompany(raw) {
  let c = String(raw || '').trim();
  // Company is the part before a bullet/pipe separator.
  c = c.split(/\s*[·•|]\s*/)[0].trim();
  // Drop a trailing "— City, ST" / "- City, ST" location.
  c = c.replace(/\s*[—–-]\s*[A-Z][A-Za-z.'’ ]*,\s*[A-Z]{2}\b.*$/, '').trim();
  // Drop a trailing ", City, ST" / ", City" / ", ST".
  c = c.replace(/,\s*[A-Z][A-Za-z.'’]*(?:\s+[A-Z][A-Za-z.'’]*){0,2}(?:,\s*[A-Z]{2})?\s*$/, '').trim();
  // Drop trailing employment-type words + any dangling separators/punctuation.
  c = c.replace(/[\s,·•|–—-]*\b(temp(?:orary)?|contract(?:or)?|full[\s-]?time|part[\s-]?time|seasonal|intern(?:ship)?|freelance|per[\s-]?diem)\b\.?\s*$/i, '').trim();
  c = c.replace(/[·•|,\-–—\s]+$/, '').trim();
  return c;
}

// Extract up to 15 employment entries.
//
// 2026-10-19: now backed by the structured résumé parser (lib/resume/parse) — section-aware role
// segmentation with dates, locations and employment types, instead of the old "find a date range,
// then fuzzy-match the company name" pass that dropped dateless roles and swallowed section
// headers as employers (the 2026-08-13 production mangle). Same return shape as always.
export function extractEmployment(resumeText) {
  try {
    const doc = parseResume({ text: String(resumeText || ''), source: 'text' });
    const entries = docToLegacyEmployment(doc);
    if (entries.length) return entries.filter((e) => e.company || e.title).slice(0, 15);
  } catch (_) { /* fall through to the legacy heuristics */ }
  return extractEmploymentLegacy(resumeText);
}

// The pre-2026-10-19 heuristic extractor, kept as the fallback when the structured parser finds
// nothing (and so its 300+ regression assertions keep guarding the date/title/company regexes).
export function extractEmploymentLegacy(resumeText) {
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
      // Break the carrier into segments on the usual separators. Each real field
      // (title, company, location, dates, type) is its own segment — so the company is a
      // SINGLE segment, never the concatenation of company+location+type (which is what
      // fragmented "Aptera" into "Aptera La Jolla, CA · Temp").
      const segs = carrier
        .split(/\s+(?:at|@|[—–|·•,])\s+|\s+-\s+/i)
        .map(s => s.trim().replace(/^[•\-*]\s*/, ''))
        .filter(Boolean);
      if (segs.length >= 2) {
        const titleIdx = segs.findIndex(s => looksLikeTitle(s));
        if (titleIdx !== -1) {
          title = segs[titleIdx].slice(0, 100);
          // Company = the nearest OTHER segment that looks like a company and is not a
          // location / employment-type / date.
          const coSeg = segs.find((s, i) => i !== titleIdx && isProbablyCompany(s) && !looksLikeTitle(s) && !isLocationOrMeta(s));
          if (coSeg) company = coSeg.slice(0, 100);
        } else {
          // No recognizable title — assume "Company <sep> …": first segment is the company.
          company = segs[0].slice(0, 100);
          title = segs.slice(1).find(s => !isLocationOrMeta(s))?.slice(0, 100) || '';
        }
      } else if (looksLikeTitle(carrier)) {
        title = carrier.replace(/^[•\-*]\s*/, '').slice(0, 100);
      } else if (isProbablyCompany(carrier)) {
        company = carrier.replace(/^[•\-*]\s*/, '').slice(0, 100);
      }
    }

    // Final safety: reduce the company to just the employer name (strip any appended
    // location / employment type / dates) so intel routes to the real company.
    if (company) company = cleanCompany(company);

    // Fall back to the surrounding lines for whichever field is still missing.
    const ctx = [lines[i - 1] || '', lines[i + 1] || ''].filter(Boolean);
    if (!title) for (const c of ctx) { if (looksLikeTitle(c)) { title = c.replace(/^[•\-*]\s*/, '').slice(0, 100); break; } }
    // Company can sit two lines up in a "Company / Title / Dates" stack, so scan one line
    // higher too — otherwise a correctly-identified title leaves the company empty and the
    // whole entry gets dropped.
    const coCtx = [lines[i - 2] || '', lines[i - 1] || '', lines[i + 1] || ''].filter(Boolean);
    if (!company) for (const c of coCtx) { const cc = c.replace(/^[•\-*]\s*/, '').trim(); if (cc !== title && isProbablyCompany(cc) && !looksLikeTitle(cc) && !isLocationOrMeta(cc)) { company = cleanCompany(cc).slice(0, 100); break; } }

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

// Per-family ramp language for the 30/60/90 plan. Keyed by the roleOntology family (plus
// 'clinical' for licensed bedside roles). Each entry gives the concrete nouns/actions that make a
// barista plan ≠ a software plan ≠ a warehouse plan:
//   tools   — what you "get hands-on with" in month 1
//   metric  — the kind of number you'd move in month 3
//   peers   — the people/functions you build relationships with
//   win30   — a small, real first-month win specific to the family
// A family's words must be true of EVERY job in that family — nothing from another field, and
// nothing a posting in the family might not have (no "on-call rotation" for every engineer).
const FAMILY_PLAYBOOK = {
  software_engineering: {
    tools: 'the codebase, the deploy pipeline, and the ticketing system',
    metric: 'latency, defect rate, or delivery speed',
    peers: 'product, design, and the engineers who review your code',
    win30: 'close a starter ticket and merge a small, reviewed pull request',
  },
  data_analytics: {
    tools: 'the data sources, the dashboards the team already uses, and how each metric is defined',
    metric: 'report turnaround, data accuracy, or a decision your analysis changed',
    peers: 'the teams who use your analysis and the people who own the data',
    win30: 'answer one real question for a stakeholder with a short, checked analysis',
  },
  marketing: {
    tools: 'the marketing tools, the brand guidelines, and the campaign calendar',
    metric: 'engagement, open or click rates, leads, or conversion',
    peers: 'sales, the creative team, and the owners of each channel you touch',
    win30: 'ship one small campaign or piece of content end-to-end and report how it performed',
  },
  sales: {
    tools: 'the CRM, the product, and the sales process',
    metric: 'pipeline created, conversion rate, or revenue closed',
    peers: 'your sales manager, the top reps, and the people who support your accounts',
    win30: 'learn the pitch cold, shadow the top reps, and book your first meetings',
  },
  customer_service: {
    tools: 'the ticketing or phone system, the knowledge base, and the escalation paths',
    metric: 'resolution time, first-contact resolution, or customer satisfaction',
    peers: 'your team lead, the senior agents, and the teams you escalate to',
    win30: 'work a full queue on your own and know exactly when and where to escalate',
  },
  clinical: {
    tools: 'the EHR/charting system, unit protocols, and safety checklists',
    metric: 'patient throughput, chart accuracy, or response time',
    peers: 'charge nurses, physicians, and the care team on your unit',
    win30: 'complete onboarding/competency checks and shadow a full shift end-to-end',
  },
  healthcare_support: {
    tools: 'the scheduling and records system, the office protocols, and the patient-privacy rules',
    metric: 'patient wait time, intake accuracy, or rooms turned over',
    peers: 'the nurses, providers, and front-office staff you support',
    win30: 'complete onboarding and competency checks and work a full day end-to-end',
  },
  food_service: {
    tools: 'the POS, menu/recipes, and opening/closing routines',
    metric: 'ticket time, order accuracy, or guest satisfaction',
    peers: 'your shift lead, kitchen/bar, and front-of-house teammates',
    win30: 'run a full shift solo and learn the regulars and the rush flow',
  },
  hospitality: {
    tools: 'the reservations or property system, the service standards, and the shift routines',
    metric: 'check-in time, guest satisfaction, or review scores',
    peers: 'your shift lead, the front desk, housekeeping, and maintenance',
    win30: 'run a full shift solo and learn the property and its busiest hours',
  },
  retail: {
    tools: 'the register/POS, floor layout, and inventory system',
    metric: 'conversion, units-per-transaction, or membership sign-ups',
    peers: 'your shift lead, stockroom, and the rest of the floor team',
    win30: 'hit your daily target and master the open/close and restock routine',
  },
  warehouse: {
    tools: 'the scanner/WMS, pick paths, and safety procedures',
    metric: 'picks/hour, on-time dispatch, or error rate',
    peers: 'your lead, dispatch, and the dock/loading crew',
    win30: 'hit the standard rate cleanly and log zero safety incidents',
  },
  delivery_logistics: {
    tools: 'the routing or dispatch app, the vehicle checks, and the delivery procedures',
    metric: 'on-time deliveries, stops per route, or delivery errors',
    peers: 'dispatch, your lead, and the loading crew',
    win30: 'run your routes on time with zero safety incidents',
  },
  valet_parking: {
    tools: 'the ticket and key system, the lot layout, and the vehicle-handling procedures',
    metric: 'retrieval time, damage-free handling, or guest feedback',
    peers: 'your shift lead, the door/front-desk team, and the other attendants',
    win30: 'work a full rush shift with every car parked and returned damage-free',
  },
  administrative: {
    tools: 'the calendar/scheduling system, CRM/files, and SOPs',
    metric: 'turnaround time, scheduling accuracy, or backlog cleared',
    peers: 'the people you support, IT, and adjacent departments',
    win30: 'take one recurring task fully off your manager\'s plate',
  },
  operations: {
    tools: 'the systems, SOPs, and reports the operation runs on',
    metric: 'cycle time, cost, error rate, or throughput',
    peers: 'the teams whose work flows through yours',
    win30: 'map one process end-to-end and fix one bottleneck you find',
  },
  security: {
    tools: 'the post orders, the access-control and camera systems, and the incident-report procedure',
    metric: 'incident response time, report quality, or patrol coverage',
    peers: 'your supervisor, the site manager, and the staff at your post',
    win30: 'learn every post and procedure and file a clean report on every shift',
  },
  finance_accounting: {
    tools: 'the accounting system, the close calendar, and the chart of accounts',
    metric: 'close time, reconciliation accuracy, or invoices processed',
    peers: 'the controller, AP/AR, and the budget owners you support',
    win30: 'complete your first month-end tasks accurately and on time',
  },
  education: {
    tools: 'the curriculum, the school\'s systems, and your classroom routines',
    metric: 'student progress, attendance, or assessment results',
    peers: 'the other teachers, your department lead, and families',
    win30: 'set your classroom routines and learn every student\'s name and needs',
  },
  project_management: {
    tools: 'the project tools, the plan, and the status-reporting rhythm',
    metric: 'on-time milestones, budget variance, or risks closed',
    peers: 'the sponsors, the delivery team, and the stakeholders on each project',
    win30: 'take over one project\'s status and deliver a clean, accurate update',
  },
  skilled_trades: {
    tools: 'the tools and equipment, the safety procedures, and the work-order system',
    metric: 'jobs completed, rework or callbacks, or safety record',
    peers: 'your foreman or lead, the other techs, and the sites or customers you serve',
    win30: 'complete your assigned work orders to standard with zero safety incidents',
  },
};
// The families whose staff plan is the floor work itself; their MANAGER roles get these instead.
const HOURLY_TEAM_FAMILIES = new Set(['retail', 'food_service', 'hospitality', 'warehouse', 'delivery_logistics', 'customer_service', 'valet_parking', 'security']);
const MANAGER_PLAYBOOK = {
  retail: {
    tools: "the store's sales, labor and shrink reports, the schedule, and the inventory system",
    metric: 'sales against plan, labor to budget, shrink, or customer-experience scores',
    peers: 'your store or district manager, the department leads, and the associates you schedule and coach',
    win30: "learn every department and the store's numbers, and hold a one-on-one with each lead",
    findMetric: 'Pick the store number furthest from plan — sales, labor, shrink or customer scores — and bring your manager a plan to move it',
  },
  food_service: {
    tools: 'the labor and food-cost reports, the schedule, and the opening/closing and safety checklists',
    metric: 'labor and food cost, ticket times, or guest scores',
    peers: 'your general manager, the kitchen and front-of-house leads, and the crew you schedule',
    win30: 'work every station and shift once, and learn the numbers the restaurant is measured on',
    findMetric: 'Pick the number furthest from target — labor, food cost, ticket times or guest scores — and bring your manager a plan to move it',
  },
  warehouse: {
    tools: 'the WMS productivity reports, the labor plan, and the safety program',
    metric: 'units per hour, accuracy, on-time dispatch, or safety incidents',
    peers: 'your operations manager, the shift leads, and the associates you assign and train',
    win30: 'run each area of the floor with its lead and learn the shift plan and its numbers',
    findMetric: 'Pick the shift number furthest from plan — rate, accuracy, on-time dispatch or safety — and bring your manager a plan to move it',
  },
  default: {
    tools: "the team's schedule, the shift reports, and the numbers the operation is measured on",
    metric: "the team's results against plan — productivity, quality, safety or service scores",
    peers: 'your manager, the leads under you, and the team you coach',
    win30: 'meet everyone on the team one-on-one and learn the numbers you will be measured on',
    findMetric: "Pick the team number furthest from plan and bring your manager a plan to move it",
  },
};
// A job the ontology cannot place: name the actual job and company, say nothing about the field.
function generalPlaybook(job, company) {
  const role = job ? `the ${job} role` : 'the role';
  const at = company ? ` at ${company}` : '';
  return {
    tools: `the tools and systems ${role}${at} uses day to day`,
    metric: 'the number your manager named',
    findMetric: `Ask your manager which number matters most for ${role}${at}, and find one place you can measurably improve it — then propose the change`,
    peers: `the people ${role} works with most`,
    win30: `agree with your manager on what a good first month in ${role} looks like, and deliver it`,
  };
}

function buildProposal({ job, company, r1, r2, r3, profile, family, industry, level = 'staff' }) {
  const base = FAMILY_PLAYBOOK[family] || generalPlaybook(job, company);
  // a manager / supervisor role runs the team: its plan is the team's numbers, not the register
  const fam = level === 'manager' && HOURLY_TEAM_FAMILIES.has(family) ? { ...base, ...(MANAGER_PLAYBOOK[family] || MANAGER_PLAYBOOK.default) } : base;
  // The employer's industry, when the posting names one the family's own plan does not already
  // speak to (a marketing coordinator at a hospital): learn its context — no facts about it added.
  const industryLine = industry && FAMILY_HOME_INDUSTRY[family] !== industry
    ? `\n• Learn the ${industry} context the work sits in at ${company}: who the customers are, the rules that apply, and the vocabulary the team uses.`
    : '';
  const strengths = (profile && profile.matchedStrengths) || [];

  // Reference the candidate's REAL relevant strength when ramping — a matched JD
  // skill if they have one, else their real recent title — so the plan reads as
  // theirs, not a template. Never claims a strength the résumé doesn't show.
  // Phrase the anchor differently depending on whether the real strength is a
  // skill (matchedStrengths) or just the recent job title, so it reads naturally
  // ("strength in customer service" vs "experience as a Barista").
  const skillStrength = strengths[0] || '';
  const anchorPhrase = skillStrength
    ? `your existing strength in ${low(skillStrength)}`
    : (profile && profile.recentTitle) ? `your experience as ${prefixArticle(profile.recentTitle)}` : '';
  const rampAnchor = anchorPhrase
    ? ` Lean on ${anchorPhrase} to ramp faster than expected.`
    : '';
  const proofHint = profile && profile.proofBullet
    ? ` Aim for a result on the scale of your past work (e.g. "${profile.proofBullet}").`
    : '';

  return {
    opening_note: `A 30/60/90 plan you can attach or bring to the interview — it signals you already think like ${prefixArticle(job)} at ${company}${anchorPhrase ? `, and it puts ${anchorPhrase} front and centre` : ''}.`,
    day_30:
`First 30 days — Learn and earn trust:\n` +
`• Meet your manager, peers, and ${fam.peers}; document how success is measured for this ${job}.\n` +
`• Get hands-on with ${fam.tools} tied to ${low(r1)}.\n` +
`• ${cap(fam.win30)}.${rampAnchor}` + industryLine,
    day_60:
`Days 31–60 — Contribute independently:\n` +
`• Take ownership of work centred on ${low(r1)}${r2 !== r1 ? ' and ' + low(r2) : ''}.\n` +
`• ${fam.findMetric || `Find one ${fam.metric} number you can measurably improve, and propose the change to your manager`}.\n` +
`• Build relationships across ${fam.peers} so you're not working in a silo.`,
    day_90:
`Days 61–90 — Drive measurable impact:\n` +
`• Deliver a result tied to ${low(r1)} with a number attached (${fam.metric}).${proofHint}\n` +
`• Bring a point of view on ${low(r3)} — a recommendation backed by what you've learned.\n` +
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
  // Structured parse first (lib/resume/parse): roles own their bullets, dateless roles survive,
  // education keeps credential + school as separate lines. Falls back to the legacy pass only
  // when the parser recognises no structure at all.
  try {
    const doc = parseResume({ text, source: 'text' });
    if (doc.experience.length || doc.education.length || doc.basics.name) {
      const legacy = docToLegacyDocument(doc, { role: job || '', company: company || '' });
      legacy.experience = legacy.experience.map((e) => ({
        ...e,
        bullets: e.bullets.map((b) => cleanBullet(b)).map((b) => String(b || '').trim()).filter((b) => b && /[a-z0-9]/i.test(b)),
      }));
      if (!legacy.skills.length) {
        const employment = docToLegacyEmployment(doc);
        legacy.skills = buildSkillsLine(text, jobDescription, employment);
      }
      if (!legacy.summary) legacy.summary = extractSummary(text);
      return legacy;
    }
  } catch (_) { /* legacy path below */ }
  return buildResumeDocumentLegacy({ resume, jobDescription, job, company });
}

export function buildResumeDocumentLegacy({ resume, jobDescription, job, company }) {
  const text = String(resume || '');
  const contact = extractContact(text);
  const summary = extractSummary(text);

  let employment = [];
  try { employment = extractEmploymentLegacy(text); } catch (_) { employment = []; }

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
