// Automatic checks over every tool output. Each check returns findings:
//   { check, severity, field, text, detail }
// Severity order (worst first): invented_fact, wrong_field, trap, requirement_misread, charge, broken_text,
// round_trip, parse, error, latency.
//
// Precision rules (to keep false positives out):
//   • invented numbers / orgs / tools / degrees are judged only on `claim` items — words that stand as the
//     candidate's own facts. Advice may quote the posting; that is not a claim.
//   • a number is invented when it is in neither the résumé nor the posting (claims may not use posting
//     numbers either: "12+ years" lifted from a posting into a summary is an invented claim).
//   • a "N+ years" claim is allowed when the résumé's own dates span at least N years (derived, not
//     invented) — the expert review judges whether it misleads.
//   • an org-like span is invented only when it is ≥2 capitalised words, not in the résumé / target
//     company / target title, and not a generic phrase.

export const SEVERITY = ['invented_fact', 'wrong_field', 'trap', 'requirement_misread', 'charge', 'broken_text', 'round_trip', 'parse', 'error', 'latency'];
export const CHECKS = {
  invented_number: 'invented_fact', invented_org: 'invented_fact', invented_tool: 'invented_fact', invented_degree: 'invented_fact', invented_years: 'invented_fact',
  wrong_family: 'wrong_field', other_field_vocab: 'wrong_field',
  trap: 'trap',
  must_skill_missing: 'requirement_misread', alternative_as_hard: 'requirement_misread', years_misread: 'requirement_misread', invented_requirement: 'requirement_misread',
  charge_for_nothing: 'charge', no_requirements_contract: 'charge',
  broken_text: 'broken_text', meaning_changed: 'broken_text',
  round_trip_missing: 'round_trip', pro_branded: 'round_trip', export_failed: 'round_trip',
  parse_employer_missing: 'parse', parse_fake_role: 'parse', parse_title_fragment: 'parse', parse_bullet_fragment: 'parse',
  error: 'error', latency: 'latency',
};

const lc = (s) => String(s || '').toLowerCase();
const squash = (s) => lc(s).replace(/[‐-―]/g, '-').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();

// ── numbers ───────────────────────────────────────────────────────────────────────────────────────
// "4,000" → "4000", "$4.2M" → "4.2", "41%" → "41"; phone/zip-like and year-like (1990–2039) kept too.
export function numbersIn(text) {
  return (String(text || '').match(/\$?\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/[$,]/g, '').replace(/\.0+$/, '')).filter((n) => n !== '');
}
function numberAllowed(n, haveSet) {
  if (haveSet.has(n)) return true;
  const v = Number(n);
  if (Number.isFinite(v) && haveSet.has(String(v))) return true;
  return false;
}

// Number words → digits so "sixty to seventy calls" and "almost four years" are checked like digits.
const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function wordsToDigits(text) {
  return String(text || '')
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b/gi, (_, a, b) => String(NUM_WORDS[a.toLowerCase()] + NUM_WORDS[b.toLowerCase()]))
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+and\s+a\s+half\b/gi, (_, a) => `${NUM_WORDS[a.toLowerCase()]}.5`)
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b(?=[\s-]+(?:years?|months?|weeks?|days?|calls?|patients?|associates?|reps?|people|new|percent|accounts?|entities|shifts?|trailers?|transactions?|stores?|students?|families|carriers?|hires?|crew|macros?|members?))/gi, (w) => String(NUM_WORDS[w.toLowerCase()]))
    .replace(/(\d+) percent\b/gi, '$1%');
}

/** Tenure in years at each résumé employer: the first date range after the employer's name. */
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function employerTenure(resume, employers = [], now = new Date('2026-10-25')) {
  const out = {};
  const text = String(resume || '');
  const re = /(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d\d)\s*(?:–|-|—|to)\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d\d|present|current)/i;
  for (const emp of employers) {
    const i = text.toLowerCase().indexOf(String(emp).toLowerCase());
    if (i < 0) continue;
    const window = text.slice(Math.max(0, i - 120), i + 220);
    const m = window.match(re);
    if (!m) continue;
    const s = Number(m[2]) + (m[1] ? MON[m[1].toLowerCase()] / 12 : 0);
    const e = /present|current/i.test(m[4]) ? now.getFullYear() + now.getMonth() / 12 : Number(m[4]) + (m[3] ? MON[m[3].toLowerCase()] / 12 : 0.5);
    out[emp] = Math.round((e - s) * 10) / 10;
  }
  return out;
}

/** Years spanned by the résumé's own date ranges (earliest start → latest end / present). */
export function resumeYearsSpan(text, now = new Date('2026-10-25')) {
  const years = [];
  const re = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d\d)\s*(?:–|-|—|to)\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d\d|present|current|now)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const s = Number(m[2]);
    const e = /present|current|now/i.test(m[4]) ? now.getFullYear() + now.getMonth() / 12 : Number(m[4]);
    years.push([s, e]);
  }
  if (!years.length) return 0;
  return Math.max(...years.map((y) => y[1])) - Math.min(...years.map((y) => y[0]));
}

// ── tools / credentials dictionary (for invented-tool claims) ────────────────────────────────────
const TOOLS = ['salesforce', 'hubspot', 'zendesk', 'freshdesk', 'servicenow', 'five9', 'python', 'java', 'javascript', 'typescript', 'golang', 'rust', 'ruby', 'c\\+\\+', 'sql', 'tableau', 'power ?bi', 'excel', 'powerpoint', 'autocad', 'civil 3d', 'concur', 'sap', 'oracle', 'netsuite', 'quickbooks', 'bill\\.com', 'epic', 'cerner', 'workday', 'kronos', 'mailchimp', 'canva', 'adobe', 'photoshop', 'illustrator', 'kubernetes', 'docker', 'aws', 'azure', 'gcp', 'terraform', 'kafka', 'rabbitmq', 'redis', 'postgres(?:ql)?', 'django', 'react', 'node\\.js', 'servsafe manager', 'cpa', 'pmp', 'cdl', 'pals', 'acls', 'bls', 'nate', 'epa (?:section )?608', 'outreach', 'salesloft', 'zoominfo', 'gong', 'clio', 'manhattan', 'blue yonder', 'servicetitan', 'i-ready', 'google classroom', 'snowflake', 'pandas', 'meta business suite', 'google analytics', 'machine learning', 'pci', 'sox', 'gaap', 'hipaa', 'osha', 'forklift', 'telemetry'];
const TOOL_RES = TOOLS.map((t) => [t, new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9])`, 'i')]);

const DEGREE_RE = /\b(bachelor'?s?(?=\s+(?:degree|of|in)|'s)|master's|masters? (?:degree|of|in)|associate'?s? degree|mba|ph\.?d|b\.s\.|b\.a\.|m\.s\.|m\.a\.|m\.ed|bsn|msn|doctorate)\b/gi;

// Capitalised spans that are generic, not organisations
const GENERIC_CAPS = new Set(['relevant experience', 'additional experience', 'professional summary', 'work experience', 'first name', 'last name', 'human voice', 'seen pro', 'thank you', 'dear hiring', 'hiring manager', 'hiring team', 'linkedin', 'microsoft office', 'google workspace', 'united states']);
const STOP_CAPS = new Set(['I', "I'm", 'But', 'So', 'Yes', 'Now', 'Our', 'We', 'It', "It's", 'They', "I've", "I'd", "I'll", 'When', 'While', 'After', 'Since', 'Last', 'Every', 'Over', 'Then', 'A', 'An', 'The', 'My', 'As', 'In', 'At', 'On', 'For', 'With', 'And', 'Or', 'To', 'Of', 'By', 'From', 'Led', 'Built', 'Hi', 'Dear', 'Before', 'Either', 'Would', 'Use', 'Paragraph', 'First', 'Days', 'Tell', 'Say', 'Then', 'If', 'This', 'That', 'Mon', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
function orgSpans(text) {
  const out = [];
  for (const sentence of String(text || '').split(/(?<=[.!?;:])\s+|\s+[—–-]\s+|\n/)) out.push(...orgSpansIn(sentence));
  return out;
}
function orgSpansIn(text) {
  const out = [];
  const re = /(?:[A-Z][A-Za-z0-9&'’\-]*\.?(?:\s+(?:of|and|&|the|de|la)\s+|\s+)){1,5}[A-Z][A-Za-z0-9&'’\-]*/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    let words = m[0].split(/\s+/);
    while (words.length && (STOP_CAPS.has(words[0].replace(/[.,]$/, '')) || /^[a-z&]/.test(words[0]))) words = words.slice(1);
    while (words.length && (STOP_CAPS.has(words[words.length - 1].replace(/[.,]$/, '')) || /^[a-z&]/.test(words[words.length - 1]))) words = words.slice(0, -1);
    if (words.filter((w) => /^[A-Z]/.test(w) && !STOP_CAPS.has(w.replace(/[.,]$/, ''))).length < 2) continue;
    out.push(words.join(' ').replace(/[.,;:]+$/, ''));
  }
  return out;
}

// ── field vocabulary: words that belong to one field and must not appear in another's output ──────
export const FIELD_VOCAB = {
  clinical: ['charge nurse', 'charting', 'patient throughput', 'chart accuracy', 'bedside', 'physicians', 'nursing', 'med-surg', 'telemetry', 'ehr', 'medication administration', 'care plan', 'patient assignments'],
  healthcare_support: ['vitals', 'patient intake', 'hipaa', 'ehr', 'medical records'],
  software_engineering: ['code review', 'pull request', 'deploy', 'codebase', 'on-call', 'ci/cd', 'unit tests', 'sprint', 'production incidents', 'repository'],
  data_analytics: ['dashboards', 'sql queries', 'data warehouse', 'kpi definitions', 'data quality'],
  retail: ['planogram', 'register', 'shrink', 'floor set', 'sales floor', 'units per transaction', 'units-per-transaction', 'store standards'],
  warehouse: ['pick rate', 'pallet', 'forklift', 'putaway', 'units per hour', 'dock', 'wms'],
  food_service: ['ticket times', 'line check', 'mise en place', 'covers', 'food cost', 'expo', 'station'],
  sales: ['quota', 'sales pipeline', 'pipeline created', 'prospects', 'discovery calls', 'closed-won', 'crm hygiene', 'meetings booked'],
  marketing: ['campaign calendar', 'open rates', 'click rates', 'brand guidelines', 'content calendar', 'engagement rate', 'roas'],
  customer_service: ['csat', 'handle time', 'tickets', 'first-contact resolution', 'call queue', 'escalations'],
  administrative: ['calendar management', 'expense reports', 'filing system', 'meeting minutes'],
  finance_accounting: ['month-end close', 'reconciliations', 'journal entries', 'gaap', 'accruals', 'audit'],
  skilled_trades: ['service calls', 'job sites', 'callbacks', 'code compliance', 'refrigerant', 'wiring', 'permits'],
  education: ['lesson plans', 'classroom management', 'students', 'parents', 'iep', 'curriculum', 'grading'],
};
// families that legitimately share vocabulary
const FAMILY_ALIASES = {
  clinical: ['healthcare_support'], healthcare_support: ['clinical'],
  retail: ['customer_service', 'food_service'], food_service: ['retail', 'customer_service'], customer_service: ['retail', 'administrative'],
  warehouse: ['delivery_logistics', 'operations'], operations: ['warehouse', 'retail', 'administrative'],
  administrative: ['customer_service', 'finance_accounting'], data_analytics: ['software_engineering', 'finance_accounting'],
  software_engineering: ['data_analytics'], finance_accounting: ['administrative', 'data_analytics'],
};

/** The match sits in a negated or contrastive phrase ("It's not Adobe-level", "I haven't used SAP"). */
function negated(text, re) {
  const m = new RegExp(re.source, re.flags.replace('g', '')).exec(String(text));
  if (!m) return false;
  const before = String(text).slice(Math.max(0, m.index - 40), m.index);
  return /\b(?:not|never|no|haven't|hasn't|don't|didn't|without|isn't|wasn't|lack|new to|learn|eager to|ready to|pick up|could|would)\b[^.;]*$/i.test(before);
}
// A sentence about what the person WANTS ("…is exactly where I want to take my skills") claims nothing.
function aspiration(text, re) {
  const m = new RegExp(re.source, re.flags.replace('g', '')).exec(String(text));
  if (!m) return false;
  const sents = String(text).split(/(?<=[.!?])\s+/);
  let pos = 0;
  for (const s of sents) { if (m.index >= pos && m.index < pos + s.length + 1) return /\b(want(?:ed)? to|where I want|looking to|hope to|interested in|excited (?:about|to)|eager to|ready to|move into|learn(?:ing)?|grow into)\b/i.test(s); pos += s.length + 1; }
  return false;
}
// The same degree written two ways ("bachelor's" for "B.A.").
const DEGREE_SAME = [
  [/^bachelor/i, /\b(bachelor|b\.?a\.?|b\.?s\.?|bsn|b\.?b\.?a\.?)\b/i],
  [/^master|^masters/i, /\b(master|m\.?a\.?|m\.?s\.?|m\.?ed|mba|msn)\b/i],
  [/^associate/i, /\b(associate|a\.?a\.?|a\.?s\.?|aas|adn)\b/i],
];
function degreeInResume(term, resume) {
  if (new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(resume)) return true;
  return DEGREE_SAME.some(([is, any]) => is.test(term) && any.test(resume));
}
function trapRe(t) { return new RegExp(t.match, t.caseSensitive ? '' : 'i'); }

// ── broken text ───────────────────────────────────────────────────────────────────────────────────
export function brokenTextIssues(text, kind) {
  const s = String(text || '');
  const issues = [];
  if (!s.trim()) return ['empty text'];
  if (/\b(undefined|null|NaN)\b|\[object Object\]/.test(s)) issues.push('template leak (undefined/null/NaN/[object Object])');
  const dup = s.match(/\b([A-Za-z]{2,})\s+\1\b/i);
  if (dup && !/^(that|had|is|very|bye|no|so|knock)$/i.test(dup[1])) issues.push(`duplicated word "${dup[0]}"`);
  if (/\.\.(?!\.)|\s,|,,|\s\.(?!\d|net|js)/.test(s)) issues.push('stray punctuation');
  if ((kind === 'claim' || kind === 'advice' || kind === 'question') && /[a-z,]\s+·\s+[a-z]/.test(s)) issues.push('"·" inside a sentence');
  const gram = s.match(/\b(?:your|my|their|a|an|the) (?:a|an|the)\b|\b(\w{3,}) \1ing\b/i);
  if (gram) issues.push(`ungrammatical "${gram[0]}"`);
  if (kind === 'claim' && /(?:^|\s)[b-hj-z](?=\s|[.,;]|$)/.test(s.replace(/\b[A-Z]\.\s?/g, ''))) issues.push(`stray single letter: "${(s.match(/\S*\s[b-hj-z](?=\s|[.,;]|$)\S*/) || [''])[0].trim()}"`);
  const opens = (s.match(/\(/g) || []).length, closes = (s.match(/\)/g) || []).length;
  if (opens !== closes) issues.push('unbalanced parentheses');
  const q = (s.match(/"/g) || []).length;
  if (q % 2) issues.push('unbalanced quotes');
  if (kind === 'claim' && /^[a-z(]/.test(s.trim())) issues.push('claim starts lowercase or with "("');
  if (kind === 'question' && /^(who|what|why|how|when|where|do|did|does|can|could|would|have|has|is|are)\b/i.test(s.trim()) && !/\?\s*$/.test(s.trim())) issues.push('question does not end with "?"');
  return issues;
}

/** Did a "humanized"/polished rewrite drop a meaning word? (e.g. "calls for" → "calls") */
export function droppedWords(from, to) {
  const words = (x) => (lc(x).match(/[a-z0-9'%$.]+/g) || []).map((w) => w.replace(/\.+$/, '')).filter(Boolean);
  const keep = new Set(words(to));
  const STOP = new Set(['a', 'an', 'the', 'very', 'really', 'just', 'that', 'successfully', 'effectively', 'various', 'and', 'also']);
  // a verb whose stem survives ("grew"→"grow", "trained"→"train") is a tense change, not a lost word
  const stems = [...keep].map((w) => w.slice(0, 4));
  // multiset: "applying for … calls for" → "applying for … calls" loses one "for"
  const left = new Map();
  for (const w of words(to)) left.set(w, (left.get(w) || 0) + 1);
  const lostOnce = [];
  for (const w of words(from)) { const n = left.get(w) || 0; if (n > 0) left.set(w, n - 1); else lostOnce.push(w); }
  return lostOnce.filter((w) => !STOP.has(w) && !(w.length > 3 && stems.includes(w.slice(0, 4)) && !keep.has(w)) && !/^(grew|ran|built|sold|kept|led|wrote|made|took|won|cut|held|began|drove|gave|met|paid|set|spent|taught|thought|brought|bought|caught|found|got|had|did)$/.test(w));
}
/** A completed, dated result rewritten into the present tense ("Grew sales 9% in 2023" → "Grow sales 9% in 2023"). */
export function tenseOnPastResult(from, to) {
  const f = String(from || '').trim().split(/\s+/)[0] || '', t = String(to || '').trim().split(/\s+/)[0] || '';
  return /(?:ed|grew|built|sold|led|ran|wrote|cut|won|kept|made|drove|taught)$/i.test(f) && !/(?:ed)$/i.test(t) && f.toLowerCase() !== t.toLowerCase() && /\b(?:19|20)\d\d\b|\bin \d+ (?:months|weeks|years)\b|\bthrough their\b/i.test(from);
}

// ── per-record checks ─────────────────────────────────────────────────────────────────────────────
export function checkRecord(rec, fx, opts = {}) {
  const F = [];
  const add = (check, field, text, detail) => F.push({ check, severity: CHECKS[check], field, text: String(text ?? '').slice(0, 400), detail });
  const g = fx.gold || {};
  const resume = fx.resumeText, posting = fx.jd;
  const resumeL = squash(resume), postingL = squash(posting);
  const companyL = squash(fx.job.company), titleL = squash(fx.job.title);
  const haveResume = new Set([...numbersIn(resume)]);
  const haveBoth = new Set([...numbersIn(resume), ...numbersIn(posting)]);
  const span = resumeYearsSpan(resume);
  // the résumé's own statement of its years ("Retail leader with 9 years…") — a claim must not contradict it
  const statedYears = [...String(resume).matchAll(/(\d+)\+?\s+years?\s+(?:of\s+(?:experience|work)|experience|in|on|across|supporting|turning|installing|as|leading|working)\b/gi)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 40);
  const items = rec.items || [];

  if (rec.error) add('error', 'status', rec.error, `status ${rec.status}`);
  if (rec.status >= 500 || rec.status === 599) add('error', 'status', JSON.stringify(rec.output || '').slice(0, 200), `HTTP ${rec.status}`);
  const budget = opts.latencyBudgetMs || (/interview_prep(?!_fallback)|tailor_polish/.test(rec.tool) ? 30000 : 3000);
  if (rec.ms > budget) add('latency', 'ms', `${rec.ms} ms`, `over ${budget} ms`);

  for (const it of items) {
    const t = it.text || '';
    const tl = squash(t);
    if (it.kind === 'claim') {
      // tenure claims about one employer ("almost four years at St. Aurelia") must match the résumé's dates
      const tw = wordsToDigits(t);
      const tenure = employerTenure(resume, g.resume_employers || []);
      for (const sentence of tw.split(/(?<!\b(?:St|Dr|Mr|Mrs|Ms|Inc|Co|Jr|Sr|Ft|Mt)\.)(?<=[.!?])\s+/)) {
        for (const [emp, yrs] of Object.entries(tenure)) {
          const short = emp.split(/\s+/).slice(0, 2).join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const em = new RegExp(`\\b${short}`, 'i').exec(sentence);
          if (!em) continue;
          // the duration nearest before the employer's name ("the last 3.5 as … at Desert Sun", "4 years at St. Aurelia")
          const before = sentence.slice(0, em.index);
          const cands = [...before.matchAll(/(?:(\d+(?:\.5)?)\s+years?\b|\bthe last (\d+(?:\.5)?)\b)/gi)];
          const last = cands[cands.length - 1];
          if (!last || em.index - last.index > 90) continue;
          const n = Number(last[1] || last[2]);
          if (Math.abs(n - yrs) > 1) add('invented_years', it.field, sentence, `says ${n} years at ${emp}; the résumé's dates give ${yrs} years there`);
        }
      }
      // numbers: only the résumé's own numbers (years claims may be derived from its dates)
      const yearClaims = [...wordsToDigits(t).matchAll(/(\d+(?:\.5)?)\+?\s+(?:years?|yrs)\b/gi)].map((m) => m[1]);
      const timePhrase = new Set(it.message ? [...t.matchAll(/\b(\d+)[\s-]*(?:minutes?|days?|hours?|weeks?|seconds?)\b/gi)].map((m) => m[1]) : []);
      for (const n of numbersIn(wordsToDigits(t))) {
        if (yearClaims.includes(n) && statedYears.length && Number(n) > Math.max(...statedYears) && /experience|candidate|professional|leader/i.test(t)) { add('invented_years', it.field, t, `"${n}+ years" contradicts the résumé's own "${Math.max(...statedYears)} years"`); continue; }
        if (numberAllowed(n, haveResume)) continue;
        if (timePhrase.has(n)) continue;
        if (it.confirm && numberAllowed(n, haveBoth)) continue; // a proposal built from the posting, flagged "confirm before using"
        if (yearClaims.includes(n)) {
          if (Number(n) > Math.floor(span + 0.25)) add('invented_years', it.field, t, `"${n}+ years" but the résumé's dates span ${span.toFixed(1)} years`);
          continue;
        }
        add('invented_number', it.field, t, `"${n}" is not in the résumé${numberAllowed(n, haveBoth) ? ' (it is the posting\'s number)' : ''}${it.confirm ? ' [flagged confirm-before-using]' : ''}`);
      }
      for (const span2 of orgSpans(t)) {
        const sl = squash(span2.replace(/['’]s$/i, ''));
        if (GENERIC_CAPS.has(sl)) continue;
        if (resumeL.includes(sl) || postingL.includes(sl) || companyL.includes(sl) || titleL.includes(sl) || sl.includes(companyL) && companyL.length > 3) continue;
        // every word of the span is in the résumé or the target title → not a new organisation
        const words = sl.split(' ').filter((w) => w.length > 2);
        if (words.every((w) => resumeL.includes(w) || titleL.includes(w))) continue;
        add('invented_org', it.field, t, `"${span2}" is not in the résumé`);
      }
      for (const [name, re] of TOOL_RES) if (re.test(t) && !re.test(resume) && !negated(t, re)) add('invented_tool', it.field, t, `"${name.replace(/\\/g, '')}" is not in the résumé`);
      for (const m of t.matchAll(DEGREE_RE)) if (!degreeInResume(m[0], resume)) add('invented_degree', it.field, t, `"${m[0]}" is not in the résumé`);
    }
    // traps
    for (const trap of g.traps || []) {
      const scopes = trap.scope === 'any' ? ['claim', 'requirement', 'advice', 'question'] : trap.scope === 'candidate' ? ['claim'] : trap.scope === 'requirements' ? ['requirement'] : [trap.scope];
      if (!scopes.includes(it.kind)) continue;
      if (trapRe(trap).test(t) && !(it.kind === 'claim' && (negated(t, trapRe(trap)) || aspiration(t, trapRe(trap))))) add('trap', it.field, t, `${trap.term}: ${trap.why}${it.confirm ? ' (flagged "confirm before using")' : ''}`);
    }
    // broken text
    if (['claim', 'advice', 'question', 'requirement'].includes(it.kind) && rec.tool !== 'ats_check' && it.field !== 'availability') for (const issue of brokenTextIssues(t, it.kind)) add('broken_text', it.field, t, issue);
    if (it.kind === 'excerpt' && it.isFact && /(?:19|20)\d\d\s*(?:–|-|—|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+)?(?:(?:19|20)\d\d|present|current)/i.test(t)) add('broken_text', it.field, t, 'a "story" built on a role header line, not an accomplishment');
    // requirement lists: years and alternatives
    if (it.kind === 'requirement') {
      const allowedYears = new Set([g.years_min, ...(g.years_allowed || [])].filter((x) => x != null).map(String));
      for (const m of t.matchAll(/(\d+)\s*\+?\s*(?:-|–|to)?\s*\d*\s*\+?\s*years?\b(?!\s+(?:old|of age))/gi)) if (!allowedYears.has(m[1])) add('years_misread', it.field, t, `posting asks for ${g.years_min ?? 'no stated'} years`);
      if (!it.anyOf && !/^any of|\(or similar\)|\bor\b/i.test(t)) {
        for (const group of g.alternatives || []) {
          const hit = group.filter((a) => new RegExp(`(?<![a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i').test(t));
          if (hit.length && !it.matched && !['matched_requirements', 'strong_keywords', 'keywords.matched'].includes(it.field)) add('alternative_as_hard', it.field, t, `the posting offers a choice (${group.join(' or ')}); "${hit.join(', ')}" is listed as required on its own`);
        }
      }
      if (g.expect_no_requirements) add('invented_requirement', it.field, t, 'the posting states no requirements');
    }
  }

  // must-skills: tools that list requirements must surface each core requirement once
  if (['fit', 'optimize', 'insights', 'scanner', 'tailor'].includes(rec.tool) && rec.status === 200) {
    const reqText = items.filter((i) => i.kind === 'requirement').map((i) => i.text).join(' | ');
    for (const ms of g.must_skills || []) if (!new RegExp(ms.match, 'i').test(reqText)) add('must_skill_missing', 'requirements', reqText || '(no requirements listed)', `"${ms.label}" is a core requirement of the posting`);
  }

  // role family: prep family field + other-field vocabulary in plans and questions
  if (rec.meta?.family && g.family && !g.family.includes(rec.meta.family)) add('wrong_family', 'family', rec.meta.family, `expected ${g.family.join(' / ')}`);
  if (['advantage', 'interview_prep', 'interview_prep_fallback', 'optimize', 'tailor', 'tailor_polish'].includes(rec.tool) && g.family) {
    const mine = new Set([...g.family, ...g.family.flatMap((f) => FAMILY_ALIASES[f] || [])]);
    const text = items.filter((i) => ['advice', 'question', 'claim'].includes(i.kind) && !i.perRole).map((i) => i.text).join('\n');
    const tl = squash(text);
    for (const [fam, words] of Object.entries(FIELD_VOCAB)) {
      if (mine.has(fam)) continue;
      for (const w of words) {
        const re = new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![a-z])`, 'i');
        if (re.test(tl) && !re.test(resumeL) && !re.test(postingL)) add('other_field_vocab', 'text', (tl.match(new RegExp(`.{0,60}${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}.{0,60}`, 'i')) || [w])[0], `"${w}" is ${fam} vocabulary; this is a ${g.family[0]} job`);
      }
    }
  }

  // HumanProof / polish: a rewrite must not drop meaning words
  for (const [from, to] of rec.meta?.pairs || []) {
    const lost0 = droppedWords(from, to);
    // content words and numbers always count; a function word counts only when it ended a clause ("calls for." → "calls.")
    // what matters: a number, a proper noun / tool (capitalised mid-sentence in the original), or a clause-final
    // function word ("calls for." → "calls."). Ordinary restating ("each month" → "monthly") is not a defect.
    const proper = new Set([...from.matchAll(/(?<=\S\s+)\(?([A-Z][A-Za-z0-9.+#-]*)/g)].map((m) => m[1].toLowerCase().replace(/[.,;:]+$/, '')));
    const lost = lost0.filter((w) => w !== "i" && (/\d/.test(w) || proper.has(w))
      || /^(?:for|to|with|of|on|in|at|by)$/.test(w) && new RegExp(`\\b${w}[.,;:]`, 'i').test(from));
    if (lost.length) add('meaning_changed', 'rewrite', to, `dropped ${lost.map((w) => `"${w}"`).join(', ')} from: ${from.slice(0, 160)}`);
    if (tenseOnPastResult(from, to)) add('broken_text', 'rewrite', to, `a completed, dated result rewritten in the present tense (was: "${from.slice(0, 120)}")`);
  }

  // charging
  if (g.expect_no_requirements) {
    if (rec.tool === 'optimize') {
      const ok = rec.status === 422 && rec.meta?.body?.error === 'no_requirements';
      const probeOk = rec.meta?.probe?.status === 422 && rec.meta?.probe?.body?.error === 'no_requirements';
      if (!ok || !probeOk || rec.charged) add('no_requirements_contract', 'optimize', JSON.stringify({ status: rec.status, probe: rec.meta?.probe?.status, charged: rec.charged }), 'must answer no_requirements (probe and run) and charge nothing');
    } else if (rec.charged) {
      add('charge_for_nothing', rec.tool, JSON.stringify(rec.output || '').slice(0, 300), `charged ${rec.charged} credit for a posting that states no requirements`);
    }
  } else if (rec.charged) {
    if (rec.tool === 'optimize' && !rec.meta?.paid_content) add('charge_for_nothing', 'optimize', JSON.stringify(rec.output || '').slice(0, 300), 'charged a credit; the paid package has no rewrite, reorder, question, availability line or summary');
    if (rec.tool === 'insights' && !(rec.output?.what_they_want || []).length) add('charge_for_nothing', 'insights', '', 'charged a credit for an empty insight');
    if (rec.tool === 'scanner' && rec.output?.match_score == null) add('charge_for_nothing', 'scanner', String(rec.output?.score_summary || ''), 'charged a credit for a scan with no score');
  }

  // export round-trip
  if (rec.tool === 'export') {
    for (const c of rec.meta?.checks || []) {
      const label = `${c.doc} ${c.format} ${c.pro ? 'pro' : 'free'}`;
      if (c.status !== 200 || c.extracted_ok === false) { add('export_failed', label, c.error || '', `export failed (${c.status})`); continue; }
      for (const m of c.missing || []) add('round_trip_missing', label, m, 'bullet not found in the re-extracted file');
      if (c.pro && c.branded) add('pro_branded', label, '', 'Pro export contains "Seen"');
    }
    const lg = rec.meta?.legacy;
    if (lg && lg.status === 200) for (const m of lg.missing || []) add('round_trip_missing', 'download_resume pdf', m, 'bullet not found in the legacy download');
    if (lg && lg.status !== 200) add('export_failed', 'download_resume', JSON.stringify(lg), 'legacy download failed');
  }

  // parse structure vs gold
  if ((rec.tool === 'parse' || rec.tool === 'parse_pdf') && rec.meta?.doc && g.resume_employers) {
    const exp = rec.meta.doc.experience || [];
    const blob = squash(exp.map((e) => `${e.title} | ${e.company}`).join(' || '));
    for (const emp of g.resume_employers) if (!exp.some((e) => squash(e.company).includes(squash(emp)) || squash(emp).includes(squash(e.company)) && e.company)) add('parse_employer_missing', 'experience.company', blob, `employer "${emp}" not parsed as a company${blob.includes(squash(emp)) ? ' (it is inside the title)' : ''}`);
    const titles = g.resume_titles.map(squash);
    for (const e of exp) {
      const tl = squash(e.title);
      if (!titles.some((t) => tl === t || tl.startsWith(t) || t.startsWith(tl) && tl.length > 3)) add('parse_title_fragment', 'experience.title', `${e.title} | ${e.company}`, 'parsed title is not one of the résumé\'s job titles');
      for (const b of e.bullets || []) if (b.text.length < 25 || /^[a-z(]/.test(b.text) || /^\W*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\)?$/i.test(b.text)) add('parse_bullet_fragment', 'experience.bullets', b.text, 'a wrapped fragment parsed as its own bullet');
    }
    if (exp.length > g.resume_titles.length) add('parse_fake_role', 'experience', blob, `${exp.length} roles parsed; the résumé has ${g.resume_titles.length}`);
  }
  return F;
}
