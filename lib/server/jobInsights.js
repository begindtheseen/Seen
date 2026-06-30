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

function insiderTip(title, topSkills) {
  const t = (title || '').toLowerCase();
  if (topSkills.length >= 3) {
    return `Mirror these exact terms — ${topSkills.slice(0, 3).join(', ')} — in your résumé and application; most first-pass filters scan for them verbatim.`;
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
  // Exclude the job title's own words so "engineer"/"senior"/"manager" don't pose as skills.
  const exclude = new Set(String(title || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3));
  const ranked = rankKeywords(text, 14, exclude);
  // Recognized hard skills first, then top-ranked keywords, then safe defaults — to 5.
  const what_they_want = [];
  const push = v => { if (v && what_they_want.length < 5 && !what_they_want.some(x => x.toLowerCase() === v.toLowerCase())) what_they_want.push(v); };
  extractSkills(text).forEach(push);
  ranked.map(k => k.display).forEach(push);
  ['Relevant experience', 'Reliability', 'Clear communication', 'Problem-solving', 'Team fit'].forEach(push);
  const topSkills = what_they_want.slice(0, 3);
  return {
    what_they_want: what_they_want.slice(0, 5),
    hidden_requirements: detectHidden(text),
    insider_tip: insiderTip(title, topSkills),
    description_summary: needsSummary ? summarize(title, company, text) : '',
  };
}
