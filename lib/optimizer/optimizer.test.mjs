// Tests for the SeenFit Engine. Run: npm test   (or: node --test lib/optimizer/optimizer.test.mjs)
//
// The engine is authored in TypeScript using type-only annotations + `.ts` import
// extensions, so Node 22's native type-stripping runs it directly with no build step.
//
// Coverage (per spec):
//   - no hallucinated skills (output skills ⊆ résumé evidence)
//   - missing hard-requirement penalty applied
//   - required vs preferred weighting correct
//   - safe_bullets vs confirm_before_using separation
//   - score explanation completeness (all required output keys present)
//   - cached job_facts reuse
//   - no external AI API calls (no fetch to anthropic/openai/google/huggingface)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runOptimizer, SEENFIT_WEIGHTS, ENGINE_VERSION } from './index.ts';
import { extractResumeFacts, resumeSkillLabels } from './extractResumeFacts.ts';
import { extractJobFacts } from './extractJobFacts.ts';
import { generateSafeBullets, bulletSkillsSubsetOf } from './generateSafeBullets.ts';
import { scoreFit } from './scoreFit.ts';

const RESUME = `
Jane Doe — Senior Customer Service Representative
Handled customer support and point of sale at a high-volume retail store, serving 200 customers per day.
Responsible for cash handling, scheduling shifts, and team management.
Bachelor's degree. Trained 8 new hires.
`;

const JOB = `
Customer Service Associate
Required: customer service experience. Must have point of sale and cash handling.
Preferred: scheduling and Excel. Familiarity with Salesforce is a plus.
`;

test('no hallucinated skills — every bullet is backed by résumé evidence', () => {
  const resumeFacts = extractResumeFacts(RESUME);
  const jobFacts = extractJobFacts(JOB, { jobTitle: 'Customer Service Associate' });
  const fit = scoreFit(jobFacts, resumeFacts);
  const bullets = generateSafeBullets(resumeFacts, fit.matches);

  // The evidence span of every safe bullet must come from the résumé facts.
  assert.equal(bulletSkillsSubsetOf(bullets, resumeFacts), true);

  // Stronger: no safe bullet may reference a skill the résumé doesn't contain.
  const resumeSkills = new Set(resumeSkillLabels(resumeFacts));
  for (const b of bullets.safe_bullets) {
    // Each bullet was generated from a matched requirement whose skill is in the résumé.
    const referenced = fit.matches
      .filter((m) => m.matched && b.text.toLowerCase().includes(m.surface.toLowerCase()))
      .map((m) => m.requirement);
    for (const skill of referenced) {
      assert.ok(
        resumeSkills.has(skill) || [...resumeSkills].some((rs) => rs.includes(skill) || skill.includes(rs)),
        `bullet references "${skill}" not present in résumé skills`
      );
    }
  }
});

test('missing hard-requirement penalty applied', () => {
  const job = `Senior Engineer. Required: python and kubernetes and aws. Must have docker.`;
  const weakResume = `I worked in customer service and point of sale.`;
  const out = runOptimizer({ resumeText: weakResume, jobTitle: 'Senior Engineer', jobDescription: job });

  // Required match should be low and a missing-required risk flag must be present.
  assert.ok(out.required_match < 0.34, `expected low required_match, got ${out.required_match}`);
  const codes = out.risk_flags.map((f) => f.code);
  assert.ok(codes.includes('missing_required_skills'), 'missing_required_skills flag expected');
  // The risk penalty must have pulled the breakdown below full credit.
  assert.ok(out.breakdown.risk_penalty < 1, 'risk penalty should be < 1');

  // A résumé that has the required skills scores strictly higher than one that doesn't.
  const strongResume = `Senior Engineer. Built systems with python, kubernetes, aws and docker.`;
  const strong = runOptimizer({ resumeText: strongResume, jobTitle: 'Senior Engineer', jobDescription: job });
  assert.ok(strong.fit_score > out.fit_score, 'matching résumé should outscore non-matching');
});

test('required vs preferred weighting correct — required misses hurt more', () => {
  // Résumé has customer service but genuinely lacks the second skill; one job marks
  // that missing skill required, the other preferred.
  const resume = `Customer service experience helping shoppers and answering questions.`;
  const reqJob = `Required: inventory management. Customer service needed.`;
  const prefJob = `Customer service needed. Preferred: inventory management.`;

  const reqOut = runOptimizer({ resumeText: resume, jobDescription: reqJob });
  const prefOut = runOptimizer({ resumeText: resume, jobDescription: prefJob });

  // Missing a REQUIRED skill must lower the fit score more than missing a PREFERRED one.
  assert.ok(reqOut.fit_score < prefOut.fit_score, `required miss (${reqOut.fit_score}) should be < preferred miss (${prefOut.fit_score})`);

  // And the weights are exactly the spec weights, summing to 1.
  const sum = Object.values(SEENFIT_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);
  assert.equal(SEENFIT_WEIGHTS.required_match, 0.3);
  assert.equal(SEENFIT_WEIGHTS.preferred_match, 0.15);
});

test('safe_bullets vs confirm_before_using are separated; numbers never in safe', () => {
  // A résumé with NO metrics → quantified suggestions must go to confirm_before_using.
  const noMetrics = `Customer service and point of sale and cash handling experience.`;
  const out = runOptimizer({ resumeText: noMetrics, jobDescription: 'Required: customer service, point of sale, cash handling.' });

  // No safe bullet may contain an invented number/placeholder.
  for (const b of out.safe_bullets) {
    assert.ok(!/\[X\]/.test(b.text), 'safe bullets must not contain placeholders');
    assert.ok(!/\bper day\b|\bper week\b/.test(b.text), 'safe bullets must not invent volume');
  }
  // The quantified variants live under confirm_before_using with a placeholder + reason.
  assert.ok(out.confirm_before_using.length > 0, 'expected confirm_before_using suggestions');
  for (const c of out.confirm_before_using) {
    assert.ok(c.reason && c.placeholder, 'confirm items must carry a reason + placeholder');
  }
});

test('score explanation completeness — all required output keys present + self-explaining', () => {
  const out = runOptimizer({ resumeText: RESUME, jobTitle: 'Customer Service Associate', jobDescription: JOB, company: 'Acme' });

  const requiredKeys = [
    'fit_score', 'confidence', 'required_match', 'preferred_match', 'ats_coverage',
    'evidence_strength', 'seniority_alignment', 'company_process_score', 'risk_flags',
    'missing_keywords', 'matched_requirements', 'unsupported_requirements', 'safe_bullets',
    'confirm_before_using', 'application_message', 'explanation',
  ];
  for (const k of requiredKeys) {
    assert.ok(k in out, `output missing required key: ${k}`);
  }

  // Every score explains itself: one contribution per weighted factor, with a reason.
  const contribFactors = out.explanation.contributions.map((c) => c.factor).sort();
  assert.deepEqual(contribFactors, Object.keys(SEENFIT_WEIGHTS).sort());
  for (const c of out.explanation.contributions) {
    assert.ok(typeof c.reason === 'string' && c.reason.length > 0, `factor ${c.factor} must explain itself`);
    assert.ok(typeof c.points === 'number');
  }
  // The fit score equals the sum of the contribution points (no hidden term).
  const summed = Math.round(out.explanation.contributions.reduce((s, c) => s + c.points, 0));
  assert.equal(out.fit_score, summed);
  assert.equal(out.engine_version, ENGINE_VERSION);
});

test('cached job_facts reuse — passing jobFacts skips re-extraction and matches', () => {
  const jobFacts = extractJobFacts(JOB, { jobTitle: 'Customer Service Associate' });
  assert.ok(jobFacts.length > 0);

  // Run once extracting from the description, once from the cached facts (no description).
  const fromDesc = runOptimizer({ resumeText: RESUME, jobTitle: 'Customer Service Associate', jobDescription: JOB });
  const fromCache = runOptimizer({ resumeText: RESUME, jobTitle: 'Customer Service Associate', jobFacts });

  // Identical job facts → identical fit score and required match (deterministic reuse).
  assert.equal(fromCache.fit_score, fromDesc.fit_score);
  assert.equal(fromCache.required_match, fromDesc.required_match);
  // And it works with NO jobDescription at all (proves the cache path is used).
  assert.ok(fromCache.matched_requirements.length > 0);
});

test('engine is deterministic — same inputs produce identical output', () => {
  const a = runOptimizer({ resumeText: RESUME, jobTitle: 'CS Associate', jobDescription: JOB, company: 'Acme' });
  const b = runOptimizer({ resumeText: RESUME, jobTitle: 'CS Associate', jobDescription: JOB, company: 'Acme' });
  assert.deepEqual(a, b);
});

test('no external AI API calls anywhere in the engine source', async () => {
  // Static guarantee: scan every engine source file for any fetch/URL to a hosted AI
  // provider. The deterministic engine must never reach out to one.
  const { readFileSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));

  const banned = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api-inference\.huggingface\.co|huggingface\.co\/models|x\.ai\/v1|api\.cohere/i;
  const files = readdirSync(here).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 9, 'expected the full engine module set');
  for (const f of files) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.ok(!banned.test(src), `engine file ${f} must not reference a hosted AI API`);
  }

  // Runtime guarantee: trap global fetch and assert the engine never calls it.
  const realFetch = globalThis.fetch;
  let called = null;
  globalThis.fetch = (url) => { called = String(url); throw new Error('fetch must not be called'); };
  try {
    runOptimizer({ resumeText: RESUME, jobTitle: 'CS Associate', jobDescription: JOB, company: 'Acme', companyProcessScore: 30 });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, null, `engine called fetch(${called}) — it must be fully offline`);
});

test('company process risk flag lowers the score when company has a poor record', () => {
  const good = runOptimizer({ resumeText: RESUME, jobDescription: JOB, company: 'Acme', companyProcessScore: 85, companyProcessConfidence: 0.8 });
  const bad = runOptimizer({ resumeText: RESUME, jobDescription: JOB, company: 'Acme', companyProcessScore: 20, companyProcessConfidence: 0.8 });
  assert.ok(bad.fit_score < good.fit_score, 'poor company process must lower the score');
  assert.ok(bad.risk_flags.some((f) => f.code === 'company_process_risk'));
});
