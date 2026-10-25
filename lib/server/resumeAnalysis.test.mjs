// Pure unit tests for the deterministic résumé analysis logic.
// Run with: node lib/server/resumeAnalysis.test.mjs
// No test framework needed — uses node:assert and exits non-zero on failure.

import assert from 'node:assert';
import {
  runScanner, runOptimize, runAdvantage, buildResumeProfile, classifyRoleFamily,
  extractEmployment, extractCareerSignal, rankKeywords, extractBullets,
  buildResumeDocument, resumeFileName, sameBullet, extractContact, extractEducation,
} from './resumeAnalysis.js';

const resume = `John Doe
Senior Software Engineer

EXPERIENCE
Acme Corp - Senior Software Engineer    Jan 2020 - Present
• Responsible for backend services using Python and AWS
• Worked on data pipelines processing 2 million events daily
• Helped migrate legacy systems to Kubernetes

Globex Inc - Software Engineer    Jun 2017 - Dec 2019
• Built REST APIs in Node.js serving 50k users
• Participated in code review and agile ceremonies

SKILLS: Python, JavaScript, React, AWS, Docker, SQL`;

const jd = `We are hiring a Senior Backend Engineer. You will design scalable data pipelines,
own backend services, and work with Python, Kubernetes, and AWS. Experience with
machine learning and project management is a plus. Strong communication required.`;

let passed = 0;
function ok(cond, msg) { assert(cond, msg); passed++; }

// ── rankKeywords ──
const ranked = rankKeywords(jd, 12);
ok(ranked.length > 0, 'rankKeywords returns terms');
ok(ranked.every(k => !!k.display), 'ranked terms have display');

// ── scanner contract ──
const s = runScanner({ resume, jobDescription: jd, job: 'Backend Engineer', company: 'TestCo', intelNote: '' });
ok(typeof s.match_score === 'number' && s.match_score >= 8 && s.match_score <= 98, 'match_score in band');
ok(typeof s.score_summary === 'string', 'score_summary string');
ok(Array.isArray(s.missing_keywords), 'missing_keywords array');
ok(Array.isArray(s.strong_keywords), 'strong_keywords array');
ok(s.strong_keywords.some(k => /python/i.test(k)), 'python is a strong keyword');
ok(Array.isArray(s.specific_fixes) && s.specific_fixes.length > 0, 'specific_fixes non-empty');
ok(s.specific_fixes.every(f => 'current' in f && 'improved' in f), 'fix keys current/improved');
ok(typeof s.ghost_risk_note === 'string', 'ghost_risk_note string');

// intel folds into ghost note
const s2 = runScanner({ resume, jobDescription: jd, job: 'X', company: 'Y', intelNote: 'SEEN DATA: 60% ghosted.' });
ok(/SEEN DATA/.test(s2.ghost_risk_note), 'intel note appears in ghost_risk_note');

// ── optimize contract ──
const o = runOptimize({ resume, jobDescription: jd, job: 'Backend Engineer', company: 'TestCo', pro: false });
ok(Array.isArray(o.job_priorities) && o.job_priorities.length > 0, 'job_priorities');
ok(Array.isArray(o.optimized_bullets) && o.optimized_bullets.length > 0, 'optimized_bullets');
ok(o.optimized_bullets.every(b => 'original' in b && 'optimized' in b && 'addresses' in b), 'bullet keys');
ok(Array.isArray(o.keywords_added), 'keywords_added');
ok(!('stealth' in o), 'no stealth flag for non-pro');
const op = runOptimize({ resume, jobDescription: jd, job: 'X', company: 'Y', pro: true });
ok(op.stealth === true, 'stealth flag for pro');

// ── advantage contract (coach + proposal keys) ──
const a = runAdvantage({ job: 'Backend Engineer', company: 'TestCo', resume, jobDescription: jd, background: '', intelNote: '', intelStats: null });
for (const k of ['hiring_manager_script', 'timing_note', 'company_intel', 'cover_letter_framework', 'referral_strategy', 'opening_note', 'day_30', 'day_60', 'day_90']) {
  ok(typeof a[k] === 'string' && a[k].length > 10, 'advantage key ' + k);
}

// ─────────────────────────────────────────────────────────────────────────────
// Advantage personalisation: output is built from the candidate's REAL résumé,
// so two different résumés (or two different jobs) yield clearly different,
// résumé-specific output — and nothing is ever fabricated.
// ─────────────────────────────────────────────────────────────────────────────

// Two distinct candidates applying to the SAME job.
const swDevResume = `Alex Rivera
Senior Software Engineer

EXPERIENCE
Nimbus Cloud - Senior Software Engineer    Mar 2019 - Present
• Built backend services in Python on AWS handling 5 million requests daily
• Led migration of legacy services to Kubernetes, cutting deploy time 40%

SKILLS: Python, AWS, Kubernetes, Docker, SQL`;

const baristaResume = `Jordan Lee
Barista

EXPERIENCE
Bean Scene Coffee - Barista    Feb 2021 - Present
• Responsible for serving 150 customers per shift and handling the register
• Trained 3 new baristas on espresso machine and point of sale

SKILLS: Customer Service, Cash Handling, Point of Sale`;

const sameJob = { job: 'Backend Engineer', company: 'Cloudbase', jobDescription: jd, background: '', intelNote: '', intelStats: null };

const advSw = runAdvantage({ ...sameJob, resume: swDevResume });
const advBarista = runAdvantage({ ...sameJob, resume: baristaResume });

// (a) two DIFFERENT résumés, same job → DIFFERENT output across every field.
for (const k of ['hiring_manager_script', 'company_intel', 'cover_letter_framework', 'referral_strategy']) {
  ok(advSw[k] !== advBarista[k], `different résumés produce different ${k}`);
}
ok(JSON.stringify(advSw) !== JSON.stringify(advBarista), 'two résumés → different advantage output overall');

// (c) output references ACTUAL content from the résumé (a real title/skill),
//     not merely the JD keyword.
const swBlob = [advSw.hiring_manager_script, advSw.company_intel, advSw.cover_letter_framework, advSw.day_30, advSw.day_90].join(' ').toLowerCase();
ok(/python|aws|kubernetes/.test(swBlob), 'software résumé surfaces its real skills (python/aws/kubernetes)');
ok(/nimbus cloud|software engineer/.test(swBlob), 'software résumé surfaces its real employer/title');
// The software candidate's quantified proof bullet should be reused verbatim.
ok(/5 million requests|deploy time/.test(swBlob), 'software résumé reuses a real quantified bullet');

const baristaBlob = [advBarista.hiring_manager_script, advBarista.company_intel, advBarista.cover_letter_framework].join(' ').toLowerCase();
ok(/barista|bean scene|customer service|point of sale|cash handling/.test(baristaBlob), 'barista résumé surfaces its real title/skills');

// (d) NOTHING fabricated: the barista résumé has no Python/Kubernetes/AWS, so the
//     playbook must never claim the candidate HAS those skills.
const baristaFull = Object.values(advBarista).join(' ').toLowerCase();
ok(!/experience with python|experience with kubernetes|experience with aws|strength in python|strength in kubernetes/.test(baristaFull),
   'barista playbook never claims python/kubernetes/aws experience the résumé lacks');
// The software résumé legitimately HAS python — claiming it is fine.
ok(/python/.test(advSw.hiring_manager_script.toLowerCase()) || /python/.test(advSw.company_intel.toLowerCase()),
   'software playbook does claim python (a real matched skill)');

// (b) SAME résumé, two DIFFERENT jobs → different output (role-family + reqs vary).
const baristaJD = `We are hiring a friendly Barista. Make espresso drinks, greet guests, run the point of sale, handle cash, keep the bar clean. Customer service and food safety required.`;
const warehouseJD = `Warehouse Associate needed. Pick and pack orders, operate a forklift, scan inventory, load trucks, meet shipping deadlines. Reliability and safety required.`;

const sameResume = baristaResume;
const advForCoffee = runAdvantage({ job: 'Barista', company: 'Bean Scene', resume: sameResume, jobDescription: baristaJD, background: '', intelNote: '', intelStats: null });
const advForWarehouse = runAdvantage({ job: 'Warehouse Associate', company: 'ShipFast', resume: sameResume, jobDescription: warehouseJD, background: '', intelNote: '', intelStats: null });

ok(JSON.stringify(advForCoffee) !== JSON.stringify(advForWarehouse), 'same résumé, two jobs → different advantage output');
// The 30/60/90 plan must vary by role family (service ramp ≠ logistics ramp).
ok(advForCoffee.day_30 !== advForWarehouse.day_30, 'day_30 differs across role families');
ok(/pos|menu|recipe|shift|guest/i.test(advForCoffee.day_30), 'service plan uses service ramp language');
ok(/scanner|wms|pick|safety|dock|rate/i.test(advForWarehouse.day_30), 'logistics plan uses logistics ramp language');

// Role-family classifier is deterministic and family-specific.
ok(classifyRoleFamily({ job: 'Barista', jobDescription: baristaJD, ranked: [] }) === 'service', 'barista classified as service');
ok(classifyRoleFamily({ job: 'Warehouse Associate', jobDescription: warehouseJD, ranked: [] }) === 'logistics', 'warehouse classified as logistics');
ok(classifyRoleFamily({ job: 'Backend Engineer', jobDescription: jd, ranked: [] }) === 'technical', 'backend engineer classified as technical');

// buildResumeProfile grounds matched/missing in the résumé and never fabricates.
const swProfile = buildResumeProfile({ resume: swDevResume, ranked: rankKeywords(jd, 12) });
ok(swProfile.recentTitle && /Software Engineer/.test(swProfile.recentTitle), 'profile pulls real recent title');
ok(swProfile.matched.length > 0, 'profile matches real JD requirements');
ok(swProfile.skills.some(s => /python/i.test(s)), 'profile lists real résumé skills');
const baristaProfile = buildResumeProfile({ resume: baristaResume, ranked: rankKeywords(jd, 12) });
ok(!baristaProfile.matched.some(m => /python|kubernetes/i.test(m)), 'barista profile does not match python/kubernetes for a backend JD');

// Advantage remains deterministic.
ok(JSON.stringify(runAdvantage({ ...sameJob, resume: swDevResume })) === JSON.stringify(advSw),
   'runAdvantage is deterministic for the same inputs');

// Gracefully handles an empty / missing résumé (falls back, never throws).
const advNoResume = runAdvantage({ job: 'Backend Engineer', company: 'TestCo', resume: '', jobDescription: jd, background: '', intelNote: '', intelStats: null });
for (const k of ['hiring_manager_script', 'cover_letter_framework', 'day_30', 'day_90']) {
  ok(typeof advNoResume[k] === 'string' && advNoResume[k].length > 10, 'no-résumé advantage still returns ' + k);
}

// ── employment extraction ──
const emp = extractEmployment(resume);
ok(emp.length >= 2, 'two employment entries');
ok(emp[0].company === 'Acme Corp' && /Engineer/.test(emp[0].title), 'first entry company+title');
ok(emp.some(e => e.end_date === 'Present'), 'Present detected');

// ── career signal ──
const sig = extractCareerSignal(resume, emp);
ok(sig.skills.includes('python'), 'python skill');
ok(sig.seniority === 'senior', 'seniority senior');
ok(sig.function === 'engineering', 'function engineering');
ok(sig.years_exp > 0, 'years_exp positive');

// ── bullets ──
ok(extractBullets(resume).length >= 4, 'bullets extracted');

// ── determinism ──
ok(JSON.stringify(runScanner({ resume, jobDescription: jd, job: 'X', company: 'Y', intelNote: '' }))
   === JSON.stringify(runScanner({ resume, jobDescription: jd, job: 'X', company: 'Y', intelNote: '' })),
   'scanner is deterministic');

// ─────────────────────────────────────────────────────────────────────────────
// Quality-bug regression tests (BUG 1, 2, 3)
// ─────────────────────────────────────────────────────────────────────────────

// A realistic low-skill posting that reproduced the embarrassing output:
// company "Bliss Car Wash", lots of JD label words and a token with trailing
// punctuation ("incentives.").
const blissResume = `Jane Smith
Car Wash Attendant

EXPERIENCE
Sparkle Auto - Attendant   Jan 2021 - Present
• Responsible for greeting customers and processing payments
• Worked on detailing vehicles and restocking supplies
• Quick to pick up new systems and laid off during seasonal slowdown
• Handled cash drawer reconciliation at end of each shift`;

const blissJD = `Company: Bliss Car Wash
Job Description
Responsibilities: Greet customers, sell memberships, operate the wash tunnel.
Qualifications: hourly availability, reliable, customer service.
Requirements: must lift 25 lbs. Benefits and incentives.
Employer offers hourly pay plus monthly incentives.
We are looking for a friendly Car Wash Representative with insurance benefits.`;

const blissScan = runScanner({ resume: blissResume, jobDescription: blissJD, job: 'Car Wash Representative', company: 'Bliss Car Wash', intelNote: '' });
const blissOpt = runOptimize({ resume: blissResume, jobDescription: blissJD, job: 'Car Wash Representative', company: 'Bliss Car Wash', pro: false });

// helper: gather every bullet-text string the engine emits (improved/optimized)
function emittedBulletTexts() {
  const out = [];
  for (const f of blissScan.specific_fixes) out.push(String(f.improved || ''));
  for (const f of s.specific_fixes) out.push(String(f.improved || ''));
  for (const b of blissOpt.optimized_bullets) out.push(String(b.optimized || ''));
  for (const b of o.optimized_bullets) out.push(String(b.optimized || ''));
  return out;
}

// ── BUG 1: no keyword-stuffed bullet rewrites ──
for (const txt of emittedBulletTexts()) {
  ok(!/\bapplying\s+\S/i.test(txt), `no "applying <kw>" in bullet: ${txt}`);
  ok(!/directly supporting/i.test(txt), `no "directly supporting" in bullet: ${txt}`);
  ok(!/\(add a metric\)|\(quantify/i.test(txt), `no inline metric hint in bullet: ${txt}`);
}
// The exact garbage strings from the bug report must never appear.
for (const txt of emittedBulletTexts()) {
  ok(!/applying bliss/i.test(txt) && !/applying wash/i.test(txt), `no garbage company-name weave: ${txt}`);
}

// ── BUG 1: improved bullet differs only by SAFE cleanups (no appended clauses) ──
// For each fix where current is a real bullet (not a "(…)" placeholder), the
// improved version must be a substring-preserving cleanup: same word count or
// fewer (verb swap can change one word), and contain no clause the original
// lacked beyond verb/cap/punct.
// Known weak lead phrases + their strong replacements (mirrors WEAK_VERBS).
const WEAK_TO_STRONG = {
  'responsible for': 'owned', 'worked on': 'built', 'helped with': 'drove',
  'helped': 'drove', 'assisted with': 'supported and delivered',
  'assisted': 'supported and delivered', 'participated in': 'contributed to',
  'involved in': 'drove', 'tasked with': 'owned', 'in charge of': 'led',
  'duties included': 'delivered', 'handled': 'managed', 'dealt with': 'resolved',
  'utilized': 'used', 'leveraged': 'used', 'spearheaded': 'led',
  'was part of': 'drove', 'familiar with': 'skilled in',
};
// Reduce a bullet to its invariant "content tail": drop a leading weak phrase
// or its strong replacement, drop trailing punctuation, lowercase.
function contentTail(str) {
  let s = str.trim().replace(/[.;,]+$/, '').toLowerCase();
  // strip a leading weak phrase OR the strong word it maps to
  for (const [weak, strong] of Object.entries(WEAK_TO_STRONG)) {
    if (s.startsWith(weak)) { return s.slice(weak.length).trim(); }
    if (s.startsWith(strong + ' ')) { return s.slice(strong.length).trim(); }
  }
  return s;
}
for (const f of blissScan.specific_fixes) {
  if (/^\(/.test(f.current.trim())) continue;
  ok(contentTail(f.improved) === contentTail(f.current),
     `improved bullet only changes lead verb/cap (no appended clause): "${f.current}" -> "${f.improved}"`);
  // Guidance must live in note, never the bullet.
  if (f.note) ok(typeof f.note === 'string' && f.note.length > 0, 'note is a string');
}

// ── BUG 2: keyword cleanliness ──
const allKw = [...(blissScan.missing_keywords || []), ...(blissScan.strong_keywords || []),
               ...(blissOpt.keywords_added || []), ...blissOpt.job_priorities];
ok(allKw.length > 0, 'bliss posting yields some keywords');
for (const k of allKw) {
  // (a) no company-name tokens
  ok(!/^bliss$/i.test(k) && !/^wash$/i.test(k), `keyword excludes company-name token: ${k}`);
  // (b) no trailing/leading punctuation
  ok(!/^[^a-z0-9]|[^a-z0-9+#]$/i.test(k), `keyword has no edge punctuation: ${JSON.stringify(k)}`);
  // (c) no generic JD label words
  ok(!/^(description|responsibilities?|qualifications?|requirements?|benefits?|incentives?|employer)$/i.test(k),
     `keyword excludes JD label word: ${k}`);
}
// Legitimately useful terms survive the filtering.
ok(allKw.some(k => /insurance|hourly|representative|membership|customer/i.test(k)),
   'useful terms (insurance/hourly/representative/customer) are kept');

// ── BUG 3: export bullet mapping is never blank for a real scan ──
// Re-implement the page's specific_fixes -> {original,optimized} mapping and
// assert it produces non-empty before/after pairs.
const exportBullets = blissScan.specific_fixes
  .filter(f => f.current && !/^\(/.test(f.current.trim()))
  .map(f => ({ original: f.current, optimized: f.improved }));
ok(exportBullets.length > 0, 'export maps scanner fixes to non-empty bullets');
ok(exportBullets.every(b => b.original.length > 0 && b.optimized.length > 0), 'export bullets have real before/after text');

// ─────────────────────────────────────────────────────────────────────────────
// Complete-résumé builder + filename + no-op rewrite tests
// ─────────────────────────────────────────────────────────────────────────────

// A realistic résumé with header, summary, two roles, skills, education.
const fullResume = `Jane Q. Smith
San Diego, CA · (619) 555-0142 · jane.smith@email.com · linkedin.com/in/janesmith

SUMMARY
Customer-focused service professional with 6 years in high-volume retail and front-desk operations, cash handling, and team training.

EXPERIENCE
Bliss Car Wash — Customer Service Representative    Jan 2022 - Present
• Responsible for greeting customers and selling memberships
• Handled cash drawer reconciliation at end of each shift serving 200 customers daily
• Trained 4 new hires on point of sale systems

Sparkle Auto Detailing — Service Attendant    Jun 2018 - Dec 2021
• Worked on detailing vehicles and restocking supplies
• Resolved customer complaints quickly

SKILLS: Customer Service, Cash Handling, Point of Sale, Scheduling

EDUCATION
Associate of Arts, Business Administration — San Diego City College, 2018`;

const fullJD = `We are hiring a Customer Service Representative. Greet customers, sell memberships, handle cash, customer service, scheduling.`;
const doc = buildResumeDocument({ resume: fullResume, jobDescription: fullJD, job: 'Customer Service Representative', company: 'Bliss Car Wash' });

// ── Contact extraction (no fabrication of missing fields) ──
ok(doc.name === 'Jane Q. Smith', 'name extracted from header');
ok(doc.contact.email === 'jane.smith@email.com', 'email extracted');
ok(/619/.test(doc.contact.phone), 'phone extracted');
ok(/San Diego/.test(doc.contact.location), 'location extracted');
ok(/linkedin\.com/.test(doc.contact.linkedin), 'linkedin extracted');

// ── Summary is the user's real summary (not invented) ──
ok(doc.summary.includes('Customer-focused'), 'summary is the résumé summary');

// ── Experience grouped under the right role, bullets are the user's own ──
ok(doc.experience.length === 2, 'two experience entries');
ok(doc.experience[0].company === 'Bliss Car Wash', 'first role company');
ok(/Customer Service Representative/.test(doc.experience[0].title), 'first role title');
ok(/Jan 2022/.test(doc.experience[0].dates) && /Present/.test(doc.experience[0].dates), 'first role dates');
ok(doc.experience[0].bullets.length === 3, 'first role has its 3 bullets grouped');
ok(doc.experience[1].bullets.length === 2, 'second role has its 2 bullets grouped');
// The "SKILLS:" line must NOT leak into a role's bullets.
for (const e of doc.experience) for (const b of e.bullets) {
  ok(!/^skills\s*:/i.test(b), `no SKILLS line leaked into bullets: ${b}`);
}
// Bullets are cleaned versions of the user's real lines (weak verb swapped) but
// every bullet's substance is a line that existed in the résumé.
const resumeLower = fullResume.toLowerCase();
for (const e of doc.experience) for (const b of e.bullets) {
  // strip the leading (possibly swapped) verb and trailing period, then a few
  // distinctive words from the bullet must appear in the original résumé text.
  const tail = b.toLowerCase().replace(/[.]+$/, '').split(/\s+/).slice(1).join(' ');
  const probe = tail.split(/\s+/).filter(w => w.length > 4)[0];
  if (probe) ok(resumeLower.includes(probe), `bullet grounded in résumé text (word "${probe}"): ${b}`);
}

// ── Skills are present in the résumé (no invented skills) ──
ok(doc.skills.length > 0, 'skills line built');
for (const s of doc.skills) {
  ok(resumeLower.includes(s.toLowerCase().split(' ')[0]) || resumeLower.includes(s.toLowerCase()),
     `skill is present in résumé (no fabrication): ${s}`);
}

// ── Education extracted, not invented ──
ok(doc.education.length >= 1, 'education extracted');
ok(/San Diego City College/.test(doc.education.join(' ')), 'education line is the real one');

// ── Determinism ──
ok(JSON.stringify(doc) === JSON.stringify(buildResumeDocument({ resume: fullResume, jobDescription: fullJD, job: 'Customer Service Representative', company: 'Bliss Car Wash' })),
   'buildResumeDocument is deterministic');

// ── NEVER fabricate sections with no data: a structureless résumé yields empty
//    sections, never invented content ──
const sparse = buildResumeDocument({ resume: 'just a few words of plain text with no structure whatsoever here', job: 'X', company: 'Y' });
ok(sparse.name === '', 'no name fabricated when none present');
ok(sparse.summary === '', 'no summary fabricated');
ok(sparse.experience.length === 0, 'no experience fabricated');
ok(sparse.education.length === 0, 'no education fabricated');
ok(sparse.contact.email === '' && sparse.contact.phone === '' && sparse.contact.linkedin === '', 'no contact fabricated');

// A line that is a sentence (not a name) must never be used as the name.
ok(extractContact('Worked at a shop downtown\nEXPERIENCE').name === '', 'a sentence is not used as a name');
ok(extractContact('Experienced operations leader and manager\nfoo').name === '', 'a title phrase is not used as a name');

// ── Filename is clean and professional ──
ok(resumeFileName({ name: 'Jane Q. Smith', role: 'Customer Service Representative' }) === 'Jane Q. Smith — Customer Service Representative Resume.pdf', 'full clean filename');
ok(resumeFileName({ name: '', role: 'Customer Service Representative' }) === 'Customer Service Representative Resume.pdf', 'role-only filename');
ok(resumeFileName({ name: '', role: '' }) === 'Seen Resume.pdf', 'fallback filename');
// The old garbage name must never be produced.
const fn = resumeFileName({ name: 'Jane Q. Smith', role: 'Customer Service Representative' });
ok(!/blisscarwashcustomerservice/i.test(fn.replace(/\s/g, '')), 'filename is not the old run-on garbage');
ok(/\.pdf$/.test(fn) && fn.includes(' '), 'filename has spaces and .pdf extension (human-readable)');

// ── No-op rewrites are flagged, not shown as a fake change ──
ok(sameBullet('Led the team', 'Led the team.') === true, 'sameBullet ignores trailing punctuation');
ok(sameBullet('worked on X', 'Built X') === false, 'sameBullet detects a real change');
// An already-strong bullet (strong lead verb, has a metric) must be marked unchanged.
const strongResume = `John Doe
EXPERIENCE
Acme - Engineer   2020 - Present
• Led a team of 8 engineers to ship 3 products
• Built a pipeline processing 2 million events daily`;
const strongScan = runScanner({ resume: strongResume, jobDescription: jd, job: 'Engineer', company: 'Acme', intelNote: '' });
// Any fix whose improved text equals the current (after cleanup) must carry unchanged:true.
for (const f of strongScan.specific_fixes) {
  if (/^\(/.test(f.current.trim())) continue;
  if (sameBullet(f.current, f.improved)) ok(f.unchanged === true, `identical rewrite is flagged unchanged: ${f.current}`);
  else ok(!f.unchanged, `changed rewrite is not flagged unchanged: ${f.current}`);
}
// The optimize tool flags unchanged bullets too.
const strongOpt = runOptimize({ resume: strongResume, jobDescription: jd, job: 'Engineer', company: 'Acme', pro: false });
for (const b of strongOpt.optimized_bullets) {
  if (/^\(/.test(b.original.trim())) continue;
  if (sameBullet(b.original, b.optimized)) ok(b.unchanged === true, `optimize flags identical bullet unchanged: ${b.original}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser-hardening regression tests
//   1. "Associate" job titles must NOT leak into Education.
//   2. Education must never contain an employment entry (date-range / job header).
//   3. Non-standard date formats parse. 4. Long / "and" / "/" titles recognised.
//   5. Decorated / ALL-CAPS section headers detected.
// ─────────────────────────────────────────────────────────────────────────────

// ── BUG: "Associate" job titles leaked into Education ──
const assocResume = `Maria Lopez
San Diego, CA · maria.lopez@email.com

EXPERIENCE
Target — Sales Floor Associate    Jan 2021 - Present
• Greeted customers and restocked shelves on a busy retail floor
• Processed 100 transactions per shift accurately

Walmart — Customer Service Associate    Jun 2019 - Dec 2020
• Handled returns and answered product questions for shoppers

EDUCATION
Bachelor of Science, Marketing — UCLA, 2019
Associate of Arts, Business Administration — San Diego City College, 2017`;

const assocJD = `We are hiring a Retail Associate. Greet customers, run the register, restock shelves, customer service.`;
const assocDoc = buildResumeDocument({ resume: assocResume, jobDescription: assocJD, job: 'Retail Associate', company: 'ShopCo' });

// (1a) The "Associate" job titles stay in EXPERIENCE, not Education.
ok(assocDoc.experience.length === 2, 'two associate roles in experience');
ok(assocDoc.experience.some(e => /Sales Floor Associate/.test(e.title)), 'Sales Floor Associate kept as a role');
ok(assocDoc.experience.some(e => /Customer Service Associate/.test(e.title)), 'Customer Service Associate kept as a role');

// (1b) Education contains ONLY real degrees — the job-title "Associate" lines are
//      gone, while the legitimate "Associate of Arts" degree survives.
ok(assocDoc.education.length === 2, 'education has exactly the two real degrees');
ok(assocDoc.education.some(e => /Bachelor of Science/.test(e)), 'Bachelor of Science degree present');
ok(assocDoc.education.some(e => /Associate of Arts/.test(e)), 'real "Associate of Arts" degree present');
for (const e of assocDoc.education) {
  ok(!/Sales Floor Associate|Customer Service Associate/.test(e), `no job-title "Associate" leaked into education: ${e}`);
}

// (2) Education never contains an entry that is actually a job (carries a date
//     range). extractEducation must reject employment-line shaped degrees.
const empForEdu = extractEmployment(assocResume);
const eduOnly = extractEducation(assocResume, empForEdu);
for (const e of eduOnly) {
  ok(!/\b\d{4}\s*[-–—]\s*(?:present|current|now|\d{4})\b/i.test(e),
     `education entry has no employment date range: ${e}`);
  ok(!/Sales Floor Associate|Customer Service Associate/i.test(e),
     `education entry is not an employment role: ${e}`);
}
ok(eduOnly.length === 2, 'extractEducation returns only the two real degrees');

// (2b) A bare role-level "associate" word never reads as a degree on its own.
ok(extractEducation('Customer Service Associate at FooMart').length === 0,
   'a bare "associate" role word is not a degree');
// But real associate-degree grammar still counts.
ok(extractEducation('Associate of Science in Nursing, 2018').length === 1, 'Associate of Science counts as a degree');
ok(extractEducation("Associate's in Accounting, Community College").length === 1, "Associate's in X counts as a degree");

// (3) Non-standard date formats parse into role headers (not misread as bullets).
ok(extractEmployment('Acme Corp — Engineer    1/2020 - 3/2022\n• shipped features').length === 1, 'numeric M/YYYY date range parses');
ok(extractEmployment('Beta LLC — Analyst    January 2020 - Present\n• analyzed data').length === 1, 'full month name date range parses');
ok(extractEmployment('Gamma Inc — Designer    2020-01 - 2022-06\n• designed flows').length === 1, 'ISO year-first date range parses');
ok(extractEmployment('Delta Co — Lead    Q1 2019 - Q4 2021\n• led the team').length === 1, 'fiscal-quarter date range parses');

// (4) Long titles and titles joined with "and" / "/" are recognised.
const longTitleEmp = extractEmployment('Initech — Senior Software Architect and Technical Lead    2018 - 2022\n• architected systems');
ok(longTitleEmp.length === 1 && /Senior Software Architect and Technical Lead/.test(longTitleEmp[0].title),
   'long "and"-joined title recognised');
const slashTitleEmp = extractEmployment('Café Roma — Host / Server    2019 - 2021\n• seated and served guests');
ok(slashTitleEmp.length === 1 && /Host\s*\/\s*Server/.test(slashTitleEmp[0].title), 'slash-joined title recognised');

// (5) Decorated / ALL-CAPS section headers are detected, so they break sections
//     correctly and never leak into bullets/education.
const decoratedResume = `Sam Park
sam.park@email.com

=== EXPERIENCE ===
Nimbus — Engineer    2019 - Present
• Built backend services in Python handling heavy traffic

* SKILLS *
Python, AWS, Docker

--- EDUCATION ---
Bachelor of Arts, Computer Science — State University, 2019`;
const decoratedDoc = buildResumeDocument({ resume: decoratedResume, jobDescription: assocJD, job: 'Engineer', company: 'Nimbus' });
ok(decoratedDoc.experience.length === 1, 'decorated EXPERIENCE header parsed as section');
// The "* SKILLS *" decorated header must break the experience bullets (not leak).
for (const e of decoratedDoc.experience) for (const b of e.bullets) {
  ok(!/skills|python, aws, docker/i.test(b) || /built backend/i.test(b),
     `decorated SKILLS header did not leak into bullets: ${b}`);
}
ok(decoratedDoc.education.some(e => /Bachelor of Arts/.test(e)), 'decorated EDUCATION header parsed, degree extracted');

console.log(`All ${passed} resumeAnalysis assertions passed.`);
