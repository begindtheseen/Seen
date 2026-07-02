// Deterministic, KEYLESS job-insights generator. Produces the exact shape the UI + the
// job_insights cache expect — { what_they_want, hidden_requirements, insider_tip,
// description_summary } — from a job's title/company/description using keyword extraction
// (reusing the résumé engine's rankKeywords) + pattern heuristics. NO external AI, no keys,
// no rate limits. This replaces the Anthropic/Haiku calls in api/job-insights.js and the
// refresh-jobs cron so insights keep working with zero API dependencies.

import { rankKeywords } from './resumeAnalysis.js';

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Signal phrase present in the JD → the unstated expectation it implies.
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

function detectHidden(text) {
  const out = [];
  for (const p of HIDDEN_PATTERNS) {
    if (out.length >= 3) break;
    if (p.re.test(text)) out.push(p.req);
  }
  const fallback = [
    'Culture fit weighs as much as skills — show you understand what the company actually does.',
    'You don’t need to match every bullet — the list describes the ideal, not the minimum.',
    'Speed matters — early, tailored applications get reviewed before the pile grows.',
  ];
  for (const f of fallback) { if (out.length >= 3) break; if (!out.includes(f)) out.push(f); }
  return out.slice(0, 3);
}

// Words that carry no signal as "what they want" — generic filler adverbs, hiring
// boilerplate, and posting scaffolding that frequency-ranking otherwise surfaces.
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

// Generic franchise/corporate words that are never useful "keywords to add" when they
// arrive as part of a company name.
const COMPANY_GENERIC = ['franchise', 'inc', 'llc', 'corp', 'group', 'company'];

// Singularise a lowercase token (mirrors resumeAnalysis.normalizeToken's crude rules).
function singularize(s) {
  if (s.length > 4 && s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.length > 3 && s.endsWith('es')) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

// Return a token plus its singular and plural variants so "domino's" excludes
// "domino" AND "dominos", and a title of "Driver" also excludes "drivers".
function variantsOf(tok) {
  const sing = singularize(tok);
  const out = new Set([tok, sing]);
  out.add(tok.endsWith('s') ? tok : tok + 's');
  out.add(sing.endsWith('s') ? sing : sing + 's');
  return out;
}

// Normalise a company name into the set of tokens (with variants) to exclude:
// lowercase, strip possessive 's, strip punctuation, split on whitespace.
function normalizeCompanyTokens(company) {
  const cleaned = String(company || '')
    .toLowerCase()
    .replace(/[’'`]s\b/g, '')      // possessive: "domino's" → "domino"
    .replace(/[^a-z0-9\s]/g, ' ')  // strip remaining punctuation
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

// Capitalise the first letter for display, leaving the rest (and internal chars
// like c++ / node.js) untouched.
function capitalizeKeyword(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function insiderTip(title, recognizedSkills) {
  const t = (title || '').toLowerCase();
  // Only ever tell a user to "mirror" terms when they are RECOGNIZED hard skills —
  // never frequency-ranked filler. Needs at least 2 to be worth the instruction.
  if (recognizedSkills.length >= 2) {
    return `Mirror these exact terms — ${recognizedSkills.slice(0, 3).join(', ')} — in your résumé and application; most first-pass filters scan for them verbatim.`;
  }
  if (/\b(senior|lead|principal|manager|director|head)\b/.test(t)) {
    return 'Lead with measurable impact — numbers, scope, outcomes. At this level they screen for proven results, not a list of responsibilities.';
  }
  return 'Tailor your opening line to this exact role and company — generic applications get filtered before a human ever reads them.';
}

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

// Hard/recognized skills across industries — these are surfaced FIRST in "what they want"
// (a real skill beats a generic frequent word). Stored as {regex, display}; multi-word and
// acronym forms handled. Not exhaustive — anything missed falls back to keyword ranking.
const SKILL_TERMS = [
  // software / data
  ['python','Python'],['java\\b','Java'],['javascript','JavaScript'],['typescript','TypeScript'],['react','React'],['node\\.?js|node\\b','Node.js'],['aws|amazon web services','AWS'],['azure','Azure'],['google cloud|gcp','GCP'],['kubernetes|k8s','Kubernetes'],['docker','Docker'],['terraform','Terraform'],['ci/cd|ci ?cd','CI/CD'],['postgres(ql)?','PostgreSQL'],['mysql','MySQL'],['mongodb','MongoDB'],['\\bsql\\b','SQL'],['graphql','GraphQL'],['rest(ful)? api|\\brest\\b','REST APIs'],['\\bgit\\b','Git'],['linux','Linux'],['c\\+\\+','C++'],['c#|\\.net','C#/.NET'],['\\bgo(lang)?\\b','Go'],['ruby','Ruby'],['\\bphp\\b','PHP'],['swift','Swift'],['kotlin','Kotlin'],['tableau','Tableau'],['power ?bi','Power BI'],['salesforce','Salesforce'],['\\bsap\\b','SAP'],['figma','Figma'],['kafka','Kafka'],['spark','Spark'],['machine learning|\\bml\\b','Machine Learning'],
  // healthcare
  ['\\bbls\\b','BLS'],['\\bacls\\b','ACLS'],['\\bpals\\b','PALS'],['\\bcpr\\b','CPR'],['\\behr\\b|electronic health record','EHR'],['\\bepic\\b','Epic (EHR)'],['cerner','Cerner'],['hipaa','HIPAA'],['phlebotomy','Phlebotomy'],['\\bekg\\b|\\becg\\b','EKG'],['\\biv\\b|intravenous','IV therapy'],['patient care','Patient care'],['medication administration','Medication administration'],
  // finance / office
  ['\\bgaap\\b','GAAP'],['quickbooks','QuickBooks'],['\\bcpa\\b','CPA'],['financial model','Financial modeling'],['forecast','Forecasting'],['reconcil','Reconciliation'],['payroll','Payroll'],['\\bexcel\\b','Excel'],['microsoft office|ms office','Microsoft Office'],
  // trades / logistics
  ['\\bosha\\b','OSHA'],['\\bhvac\\b','HVAC'],['electrical','Electrical'],['plumbing','Plumbing'],['welding','Welding'],['blueprint','Blueprint reading'],['forklift','Forklift'],['\\bcdl\\b','CDL'],['\\base\\b certif','ASE certification'],
  // cross-industry
  ['bilingual|spanish','Bilingual (Spanish)'],['project management|\\bpmp\\b','Project management'],['customer service','Customer service'],
];

function extractSkills(text) {
  const lower = text.toLowerCase();
  const found = [];
  const seen = new Set();
  for (const [pat, display] of SKILL_TERMS) {
    if (found.length >= 5) break;
    if (new RegExp(pat, 'i').test(lower) && !seen.has(display)) { found.push(display); seen.add(display); }
  }
  return found;
}

// Main entry. Returns the standard insights object. Pure + deterministic.
export function buildJobInsights({ title, company, description, needsSummary = true } = {}) {
  const text = stripHtml(description);
  // Exclusion set: the job title's own words AND the company name (with singular/
  // plural variants) + generic franchise/corp words — so neither "engineer"/"senior"
  // nor "domino"/"dominos" ever pose as "what they want". Feeds both the ranker and
  // the post-filter below.
  const exclude = new Set();
  for (const raw of String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (raw.length >= 3) for (const v of variantsOf(raw)) exclude.add(v);
  }
  for (const v of normalizeCompanyTokens(company)) exclude.add(v);

  const isExcluded = disp => {
    const n = disp.toLowerCase();
    return exclude.has(n) || exclude.has(singularize(n));
  };

  const recognizedSkills = extractSkills(text); // recognized hard skills, display-cased
  const ranked = rankKeywords(text, 20, exclude);

  // Recognized hard skills first, then post-filtered + capitalized top keywords,
  // then safe defaults — to 5.
  const what_they_want = [];
  const push = v => { if (v && what_they_want.length < 5 && !what_they_want.some(x => x.toLowerCase() === v.toLowerCase())) what_they_want.push(v); };

  recognizedSkills.forEach(push);

  for (const k of ranked) {
    const disp = k.display || '';
    const norm = disp.toLowerCase();
    if (disp.length < 4) continue;                              // too short to be a signal
    if (INSIGHTS_FILLER.has(norm) || INSIGHTS_FILLER.has(singularize(norm))) continue;
    if (isExcluded(disp)) continue;                            // company/title noise
    push(capitalizeKeyword(disp));
  }

  ['Relevant experience', 'Reliability', 'Clear communication', 'Problem-solving', 'Team fit'].forEach(push);

  return {
    what_they_want: what_they_want.slice(0, 5),
    hidden_requirements: detectHidden(text),
    insider_tip: insiderTip(title, recognizedSkills),
    description_summary: needsSummary ? summarize(title, company, text) : '',
  };
}
