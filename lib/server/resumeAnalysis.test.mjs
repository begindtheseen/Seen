// Pure unit tests for the deterministic résumé analysis logic.
// Run with: node lib/server/resumeAnalysis.test.mjs
// No test framework needed — uses node:assert and exits non-zero on failure.

import assert from 'node:assert';
import {
  runScanner, runOptimize, runAdvantage,
  extractEmployment, extractCareerSignal, rankKeywords, extractBullets,
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
const a = runAdvantage({ job: 'Backend Engineer', company: 'TestCo', jobDescription: jd, background: '', intelNote: '', intelStats: null });
for (const k of ['hiring_manager_script', 'timing_note', 'company_intel', 'cover_letter_framework', 'referral_strategy', 'opening_note', 'day_30', 'day_60', 'day_90']) {
  ok(typeof a[k] === 'string' && a[k].length > 10, 'advantage key ' + k);
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

console.log(`All ${passed} resumeAnalysis assertions passed.`);
