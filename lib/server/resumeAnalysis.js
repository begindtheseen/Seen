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

const STRONG_VERBS = [
  'Led','Built','Drove','Launched','Owned','Delivered','Scaled','Designed',
  'Reduced','Increased','Grew','Shipped','Created','Managed','Improved',
];

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

// ── Keyword ranking ──────────────────────────────────────────────────────────
// Rank the most important keywords/phrases in a job description by frequency,
// dropping stopwords. Returns [{ term, display, count, isPhrase }] sorted by
// importance (count desc, longer terms first as tiebreak).
export function rankKeywords(jobDescription, limit = 24) {
  const text = String(jobDescription || '');
  const lower = text.toLowerCase();

  const scores = new Map(); // term -> { count, display, isPhrase }

  // 1) Known multi-word phrases
  for (const phrase of KNOWN_PHRASES) {
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
    const norm = normalizeToken(raw);
    if (norm.length < 3) continue;
    if (STOPWORDS.has(norm) || STOPWORDS.has(raw)) continue;
    if (phraseWords.has(norm)) continue;
    if (/^\d+$/.test(norm)) continue;
    const prev = scores.get(norm);
    if (prev) prev.count += 1;
    else scores.set(norm, { count: 1, display: raw, isPhrase: false });
  }

  return [...scores.entries()]
    .map(([term, v]) => ({ term, ...v }))
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

// Pick a deterministic strong verb for a bullet (stable across runs).
function pickVerb(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return STRONG_VERBS[h % STRONG_VERBS.length];
}

// ── Tool: scanner (ATS fit) ──────────────────────────────────────────────────
export function runScanner({ resume, jobDescription, job, company, intelNote }) {
  const ranked = rankKeywords(jobDescription, 24);
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

  // Specific fixes: find résumé bullets that lack the top missing keywords and
  // rewrite them to weave the term in (deterministic templated rewrite).
  const bullets = extractBullets(resume);
  const fixes = [];
  const topMissing = missing.slice(0, 6);
  const usedBullets = new Set();

  for (const kw of topMissing) {
    if (fixes.length >= 4) break;
    // Find the best bullet to attach this keyword to: one not already used,
    // ideally one that shares some context but is missing this term.
    let target = null;
    for (let i = 0; i < bullets.length; i++) {
      if (usedBullets.has(i)) continue;
      target = { i, text: bullets[i] };
      break;
    }
    if (!target) break;
    usedBullets.add(target.i);
    fixes.push({
      current: target.text,
      improved: weaveKeyword(target.text, kw.display),
    });
  }

  // If there were no usable bullets but keywords are missing, give a concrete
  // additive suggestion instead of leaving fixes empty.
  if (fixes.length === 0 && topMissing.length) {
    fixes.push({
      current: '(No bullet directly references the role’s core requirements.)',
      improved: `Add a bullet that demonstrates "${topMissing[0].display}" — e.g. "${pickVerb(topMissing[0].term)} ${topMissing[0].display} initiatives that delivered a measurable result (add the number)."`,
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

// Weave a keyword into an existing bullet deterministically without fabricating
// outcomes — appends a clarifying clause that names the JD term.
function weaveKeyword(bullet, keyword) {
  let b = bullet.trim().replace(/[.;]+$/, '');
  const weak = startsWithWeakVerb(b);
  if (weak) {
    b = cap(WEAK_VERBS[weak]) + b.slice(weak.length);
  } else {
    b = cap(b);
  }
  const lower = b.toLowerCase();
  if (lower.includes(keyword.toLowerCase())) {
    // Already present after verb swap — just ensure quantification prompt.
    return hasQuantification(b) ? b + '.' : b + ' (quantify the impact — add a number).';
  }
  const connector = hasQuantification(b)
    ? `, applying ${keyword}`
    : `, applying ${keyword} (add a metric)`;
  return b + connector + '.';
}

// ── Tool: optimize ───────────────────────────────────────────────────────────
export function runOptimize({ resume, jobDescription, job, company, pro }) {
  const ranked = rankKeywords(jobDescription, 18);
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
    return { text, i, weakness };
  }).sort((a, b) => b.weakness - a.weakness || a.i - b.i);

  const optimized = [];
  const targets = scored.slice(0, Math.max(4, Math.min(6, scored.length)));
  for (let n = 0; n < targets.length; n++) {
    const t = targets[n];
    const priority = priorities[n % (priorities.length || 1)] || (ranked[0]?.display ?? 'the core requirement');
    const rewrite = optimizeBullet(t.text, priority, pro);
    optimized.push({
      original: t.text,
      optimized: rewrite,
      addresses: priority,
    });
  }

  // If résumé has no parseable bullets, emit additive templates per priority.
  if (optimized.length === 0) {
    for (const p of priorities.slice(0, 4)) {
      optimized.push({
        original: '(Add a bullet for this requirement.)',
        optimized: `${pickVerb(p)} ${p.toLowerCase()} work that produced a measurable outcome — add the number (%, $, count, or timeframe).`,
        addresses: p,
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

function optimizeBullet(bullet, priority, pro) {
  let b = bullet.trim().replace(/[.;]+$/, '');
  const weak = startsWithWeakVerb(b);
  if (weak) {
    b = WEAK_VERBS[weak] + b.slice(weak.length);
  } else {
    // Ensure it leads with a strong action verb.
    const firstWord = b.split(/\s+/)[0]?.toLowerCase() || '';
    const startsStrong = STRONG_VERBS.some(v => v.toLowerCase() === firstWord);
    if (!startsStrong) b = pickVerb(b) + ' ' + b.charAt(0).toLowerCase() + b.slice(1);
  }
  b = cap(b);

  const lower = b.toLowerCase();
  let result = b;
  if (!lower.includes(priority.toLowerCase())) {
    result += hasQuantification(b)
      ? `, directly supporting ${priority.toLowerCase()}`
      : `, directly supporting ${priority.toLowerCase()} (quantify the result)`;
  } else if (!hasQuantification(b)) {
    result += ' (add a metric to quantify the impact)';
  }
  result = result.replace(/[.]+$/, '') + '.';

  // Pro "stealth" pass: vary phrasing slightly so output isn't templated-looking.
  if (pro && /, directly supporting /.test(result)) {
    result = result.replace(', directly supporting ', ' — mapped to ');
  }
  return result;
}

// ── Tool: advantage / coach / proposal ───────────────────────────────────────
// Rule-based application playbook + 30/60/90 plan. Deterministic structured
// guidance — no model prose. Uses the top JD keywords + company intel.
export function runAdvantage({ job, company, jobDescription, background, intelNote, intelStats }) {
  const ranked = rankKeywords(jobDescription, 12);
  const topReqs = ranked.slice(0, 5).map(k => k.display);
  const r1 = topReqs[0] || 'the core requirement';
  const r2 = topReqs[1] || r1;
  const r3 = topReqs[2] || r2;

  const coach = buildCoach({ job, company, topReqs, background, intelNote, intelStats });
  const plan = buildProposal({ job, company, r1, r2, r3 });

  return { ...coach, ...plan };
}

function buildCoach({ job, company, topReqs, background, intelNote, intelStats }) {
  const r1 = topReqs[0] || 'the core requirement';
  const r2 = topReqs[1] || r1;
  const reqList = topReqs.slice(0, 3).join(', ') || 'the role’s core priorities';

  const hiring_manager_script =
`Hi [First name] — I'm applying for the ${job} role on your team at ${company}. ` +
`I've spent the last few years focused on ${r1.toLowerCase()}${topReqs[1] ? ' and ' + r2.toLowerCase() : ''}, ` +
`which looks central to what you're hiring for. ` +
`Before I submit, I'd love 10 minutes to hear what "great" looks like in this role in the first 90 days. ` +
`Would a short call this week work? Either way, thank you — I'm genuinely excited about ${company}.`;

  const timing_note = intelStats
    ? `This company responds to roughly ${Math.round((intelStats.response_rate || 0) * 100)}% of applicants and ghosts about ${Math.round((intelStats.ghost_rate || 0) * 100)}%, with an average wait near ${Math.round(intelStats.avg_wait_days || 0)} days. Apply within the first 48 hours while the req is fresh and the pile is small — early applicants get read before fatigue sets in.`
    : `Apply within the first 48 hours of the posting going live. Most applications arrive in week one, and recruiters review the earliest batch most carefully — being early is a real, free edge.`;

  let company_intel;
  if (intelNote) {
    company_intel = `${intelNote} Lead your outreach by acknowledging you know how they treat applicants — reference that you'll be proactive with follow-up. Tie your pitch to ${reqList}, the priorities their posting emphasises most.`;
  } else {
    company_intel = `Research three things before you apply to ${company}: (1) a recent product launch, funding round, or announcement you can reference; (2) who the hiring manager likely is (search "${job} ${company}" on LinkedIn); (3) the priorities their posting repeats — here, ${reqList}. Mirror that exact language in your application.`;
  }

  const cover_letter_framework =
`Paragraph 1 — Hook: Name the ${job} role and one specific reason ${company} stands out to you (a product, value, or recent move). State that your focus on ${r1.toLowerCase()} maps directly to what they need.\n\n` +
`Paragraph 2 — Proof: Give one concrete story where you delivered on ${r1.toLowerCase()}${topReqs[1] ? ' or ' + r2.toLowerCase() : ''}. Use a real metric (%, $, time saved, scale). Show, don't claim.\n\n` +
`Paragraph 3 — Close: Connect that result to the impact you'd have at ${company} in this role, and ask for the conversation. Keep the whole letter under 250 words.`;

  const referral_strategy = intelNote
    ? `Because this company ghosts a meaningful share of applicants, a referral is your single biggest lever — referred candidates skip the cold pile. Find 1–2 people at ${company} (alumni, past colleagues, 2nd-degree LinkedIn). Send a short, specific note: mention the ${job} role, why you're a fit on ${r1.toLowerCase()}, and ask if they'd be comfortable referring you. Make it easy — attach your résumé and a 2-line blurb they can paste.`
    : `Find 1–2 people at ${company} through LinkedIn (filter by company + your school or past employers). Send a specific note referencing the ${job} role and your fit on ${r1.toLowerCase()}, and ask if they'd refer you. Give them a ready-to-paste 2-line blurb and your résumé so it costs them 30 seconds. A referral can multiply your odds of a first look.`;

  return { hiring_manager_script, timing_note, company_intel, cover_letter_framework, referral_strategy };
}

// ── Employment history extraction (regex/heuristics, keyless) ────────────────
const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_TOKEN = `(?:${MONTHS}\\.?\\s*\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
// A date range like "Jan 2020 – Present" or "2019 - 2021"
const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:[-–—]|to)\\s*(${DATE_TOKEN}|present|current|now)`,
  'i'
);

const COMMON_TITLE_WORDS = /(engineer|developer|manager|director|designer|analyst|consultant|lead|architect|specialist|coordinator|associate|officer|administrator|scientist|intern|president|founder|head|chief|vp|vice president|supervisor|representative|recruiter|accountant|nurse|teacher|technician|strategist|marketer|writer|editor|producer|owner|partner|advisor|principal|fellow|assistant|agent|clerk|operator|planner|buyer|controller|auditor|paralegal|attorney|counsel|surgeon|physician|therapist|pharmacist|professor|instructor|chef|stylist)/i;

function looksLikeTitle(line) {
  return COMMON_TITLE_WORDS.test(line) && line.split(/\s+/).length <= 8;
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

    // The line carrying the date often also carries the title or company.
    const carrier = lines[i].replace(DATE_RANGE_RE, '').replace(/[•|,;–—-]\s*$/, '').trim();

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

function buildProposal({ job, company, r1, r2, r3 }) {
  return {
    opening_note: `A 30/60/90 plan you can attach or bring to the interview — it signals you already think like a ${job} at ${company}.`,
    day_30:
`First 30 days — Learn and earn trust:\n` +
`• Meet your manager, peers, and the teams you'll depend on; document how success is measured for this ${job}.\n` +
`• Get hands-on with the tools, codebase, or accounts tied to ${r1.toLowerCase()}.\n` +
`• Ship one small, visible win that shows initiative without disrupting anything.`,
    day_60:
`Days 31–60 — Contribute independently:\n` +
`• Take ownership of a project centred on ${r1.toLowerCase()}${r2 !== r1 ? ' and ' + r2.toLowerCase() : ''}.\n` +
`• Identify one process or metric you can measurably improve, and propose it to your manager.\n` +
`• Build relationships across functions so you're not working in a silo.`,
    day_90:
`Days 61–90 — Drive measurable impact:\n` +
`• Deliver a result tied to ${r1.toLowerCase()} with a number attached (efficiency, revenue, quality, or speed).\n` +
`• Bring a point of view on ${r3.toLowerCase()} — a recommendation backed by what you've learned.\n` +
`• Set goals with your manager for the next quarter so you're seen as someone who compounds.`,
  };
}
