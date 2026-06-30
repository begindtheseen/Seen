// Tests for the HumanProof engine. Run: npm test  (or: node --test lib/humanizer/humanproof.test.mjs)
//
// The engine is authored in TypeScript with type-only annotations + `.ts` import
// extensions, so Node 22's native type-stripping runs it directly with no build step.
//
// Coverage (per spec):
//   - generic phrase detection
//   - buzzword replacement
//   - repeated rhythm detection
//   - unsupported metric removal (→ confirm_before_using, never the bullet)
//   - unsupported tool warning
//   - unsupported seniority warning
//   - safe vs confirm-before-using separation
//   - no invented claims (humanized text adds no number/tool not in facts)
//   - no external AI API calls (static host scan + runtime fetch trap)
//   - score explanation completeness (score === sum(points); all factors explained)
//   - paid-lock behavior (gate helper)
//   - integration with SeenFit optimizer output
//   - framing: never claims to bypass/beat detectors

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runHumanProof, HUMANPROOF_ENGINE_VERSION } from './index.ts';
import { HUMANPROOF_WEIGHTS } from './types.ts';
import { BUILTIN_PHRASE_RULES, findPhraseMatches, mergeRules } from './phraseRisk.ts';
import { detectAiSlop } from './detectAiSlop.ts';
import { detectBuzzwords } from './detectBuzzwords.ts';
import { detectRepetition } from './detectRepetition.ts';
import { detectOverclaiming } from './detectOverclaiming.ts';
import { detectInterviewRisk } from './detectInterviewRisk.ts';
import { explainHumanProof, computeHumanProofScore } from './explainHumanProof.ts';
import { runOptimizer } from '../optimizer/index.ts';
import { extractResumeFacts } from '../optimizer/extractResumeFacts.ts';

const RULES = mergeRules(null);

const RESTAURANT_RESUME = `
Server at a high-volume restaurant.
Handled point of sale, guest service, and order accuracy during busy shifts.
Trained new hires and managed closing tasks.
`;

const GENERIC_BULLET =
  'Leveraged strong communication and organizational skills to optimize customer-facing workflows in a fast-paced environment.';

test('generic phrase detection — flags AI-slop verbs and filler', () => {
  const out = runHumanProof({ text: GENERIC_BULLET, mode: 'resume', jobTitle: 'Server', resumeText: RESTAURANT_RESUME });
  const phrases = out.flags.map((f) => f.originalPhrase.toLowerCase());
  assert.ok(phrases.includes('leveraged'), 'should flag "leveraged"');
  assert.ok(out.flags.some((f) => f.flagType === 'buzzword'), 'should flag a buzzword');
  // The headline score is the humanized output; humanizing must lift it.
  assert.ok(out.after_score > out.before_score, `humanizing should raise the score (${out.before_score} → ${out.after_score})`);
});

test('buzzword replacement — generic phrasing becomes plainer, grounded wording', () => {
  const out = runHumanProof({ text: GENERIC_BULLET, mode: 'resume', jobTitle: 'Server', resumeText: RESTAURANT_RESUME });
  const t = out.humanized_text.toLowerCase();
  assert.ok(!t.includes('leveraged'), '"leveraged" should be replaced');
  assert.ok(!t.includes('fast-paced environment'), '"fast-paced environment" should be replaced');
  assert.ok(/\bused\b/.test(t), 'replacement uses plain "used"');
  // Role-grounded context for the restaurant family.
  assert.ok(t.includes('busy shift'), 'fast-paced environment → role-grounded "busy shifts"');
  assert.ok(out.changes_made.length > 0, 'changes_made must record the replacements');
});

test('repeated rhythm detection — uniform bullet openers are flagged', () => {
  const repetitive = [
    'Leveraged customer service to help guests.',
    'Leveraged point of sale to ring up orders.',
    'Leveraged teamwork to support the team.',
    'Leveraged communication to update staff.',
  ].join('\n');
  const rep = detectRepetition(repetitive);
  assert.ok(rep.flags.some((f) => f.flagType === 'repetition'), 'should flag repeated openers');
  assert.ok(rep.naturalRhythm < 0.7, `uniform openers → low natural rhythm, got ${rep.naturalRhythm}`);

  const varied = [
    'Handled the register during the dinner rush.',
    'Guests with allergy questions got clear, careful answers.',
    'At close, I counted the drawer and reset the floor.',
  ].join('\n');
  const rep2 = detectRepetition(varied);
  assert.ok(rep2.naturalRhythm > rep.naturalRhythm, 'varied bullets read more natural');
});

test('unsupported metric removal — invented numbers go to confirm_before_using, not the bullet', () => {
  const facts = extractResumeFacts(RESTAURANT_RESUME); // no metrics in this résumé
  const text = 'Increased sales by 250% and served 5000 customers using strong communication skills.';
  const out = runHumanProof({ text, mode: 'resume', jobTitle: 'Server', resumeFacts: facts });

  // The unsupported numbers must NOT silently remain as asserted fact in a safe bullet's
  // confirm list — they must be surfaced as confirm-before-using.
  const confirmText = out.confirm_before_using.map((c) => c.placeholder).join(' ');
  assert.ok(/250|5000/.test(confirmText), 'unsupported numbers must be surfaced for confirmation');
  for (const c of out.confirm_before_using) {
    assert.ok(c.reason && c.placeholder, 'confirm items carry a reason + placeholder');
  }
  // A flag must mark the unsupported metric.
  assert.ok(out.flags.some((f) => f.flagType === 'unsupported_metric'), 'unsupported_metric flag expected');
});

test('unsupported tool warning — naming a tool not in the résumé is flagged', () => {
  const facts = extractResumeFacts(RESTAURANT_RESUME); // no Salesforce
  const text = 'Managed customer pipeline in Salesforce and Tableau dashboards.';
  const over = detectOverclaiming(text, facts);
  assert.ok(over.unsupportedTools.includes('salesforce'), 'salesforce should be unsupported');
  assert.ok(over.flags.some((f) => f.flagType === 'unsupported_tool'), 'unsupported_tool flag expected');

  const out = runHumanProof({ text, mode: 'resume', resumeFacts: facts });
  assert.ok(out.confirm_before_using.some((c) => /salesforce/i.test(c.placeholder)), 'tool surfaced for confirmation');
});

test('unsupported seniority warning — exec language above résumé level is flagged', () => {
  const facts = extractResumeFacts('Entry-level cashier. Handled point of sale and customer service.');
  const text = 'Director-level leader who spearheaded executive strategy.';
  const over = detectOverclaiming(text, facts);
  assert.ok(over.flags.some((f) => f.flagType === 'unsupported_seniority'), 'unsupported_seniority flag expected');
});

test('safe vs confirm-before-using separation — no number ever enters a safe bullet', () => {
  const facts = extractResumeFacts(RESTAURANT_RESUME);
  const text = 'Served 9999 guests and boosted revenue 80% with proven excellence.';
  const out = runHumanProof({ text, mode: 'resume', resumeFacts: facts });
  for (const b of out.safe_bullets) {
    assert.ok(!/9999|80%/.test(b.text), `safe bullet must not assert an unsupported number: "${b.text}"`);
  }
  assert.ok(out.confirm_before_using.length > 0, 'unsupported numbers must appear under confirm_before_using');
});

test('no invented claims — humanized text introduces no tool/number absent from facts', () => {
  const facts = extractResumeFacts(RESTAURANT_RESUME);
  const out = runHumanProof({ text: GENERIC_BULLET, mode: 'resume', jobTitle: 'Server', resumeFacts: facts });
  // The humanized text must not contain any digit that wasn't in the input.
  const inputDigits = new Set((GENERIC_BULLET.match(/\d+/g) || []));
  for (const d of out.humanized_text.match(/\d+/g) || []) {
    assert.ok(inputDigits.has(d), `humanizer introduced a number "${d}" not present in the input`);
  }
  // And it must not name a known tool the résumé lacks.
  assert.ok(!/salesforce|tableau|kubernetes/i.test(out.humanized_text), 'must not invent a tool');
});

test('framing — engine never claims to bypass/beat/trick detectors or employers', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const files = readdirSync(here).filter((f) => f.endsWith('.ts'));
  // Affirmative detector-beating framing only — exclude disclaimers ("never claims to
  // bypass…", "does NOT bypass…", "no bypassing…") which are explicitly allowed.
  const banned = /\b(bypass|evade|evading|trick|fool|defeat|outsmart)\b[^.\n]{0,40}\b(detector|detection|ats|employer|scanner)/i;
  const negation = /\b(never|not|no|don'?t|doesn'?t|without|avoid|isn'?t)\b/i;
  for (const f of files) {
    const src = readFileSync(here + f, 'utf8');
    for (const line of src.split('\n')) {
      if (banned.test(line) && !negation.test(line)) {
        assert.fail(`${f} must not frame the feature as beating detectors/ATS/employers: "${line.trim()}"`);
      }
    }
  }
  // The output copy must not promise detector-beating either.
  const out = runHumanProof({ text: GENERIC_BULLET, mode: 'resume', resumeText: RESTAURANT_RESUME });
  const allCopy = JSON.stringify(out).toLowerCase();
  assert.ok(!/bypass|evade|beat the detector|fool the/.test(allCopy), 'output copy must not promise to beat detectors');
});

test('score explanation completeness — score === sum(points), every factor explained', () => {
  const out = runHumanProof({ text: GENERIC_BULLET, mode: 'resume', jobTitle: 'Server', resumeText: RESTAURANT_RESUME });
  const requiredKeys = [
    'engine_version', 'humanproof_score', 'ai_slop_risk', 'before_score', 'after_score',
    'flags', 'humanized_text', 'safe_bullets', 'confirm_before_using',
    'interview_risk_warnings', 'changes_made', 'explanation',
  ];
  for (const k of requiredKeys) assert.ok(k in out, `output missing required key: ${k}`);

  const factors = out.explanation.contributions.map((c) => c.factor).sort();
  assert.deepEqual(factors, Object.keys(HUMANPROOF_WEIGHTS).sort(), 'one contribution per weighted factor');
  for (const c of out.explanation.contributions) {
    assert.ok(typeof c.reason === 'string' && c.reason.length > 0, `factor ${c.factor} must explain itself`);
    assert.ok(typeof c.points === 'number' && typeof c.weight === 'number' && typeof c.raw === 'number');
  }
  const summed = Math.round(out.explanation.contributions.reduce((s, c) => s + c.points, 0));
  assert.equal(out.after_score, summed, 'after_score must equal the sum of contribution points');
  assert.equal(out.engine_version, HUMANPROOF_ENGINE_VERSION);

  // Weights sum to exactly 1.0.
  const sum = Object.values(HUMANPROOF_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);
});

test('engine is deterministic — same inputs produce identical output', () => {
  const a = runHumanProof({ text: GENERIC_BULLET, mode: 'resume', jobTitle: 'Server', resumeText: RESTAURANT_RESUME });
  const b = runHumanProof({ text: GENERIC_BULLET, mode: 'resume', jobTitle: 'Server', resumeText: RESTAURANT_RESUME });
  assert.deepEqual(a, b);
});

test('integration with SeenFit optimizer output — consumes optimizer facts/types', () => {
  const job = 'Server. Required: customer service, point of sale. Preferred: cash handling.';
  const optimizerOutput = runOptimizer({ resumeText: RESTAURANT_RESUME, jobTitle: 'Server', jobDescription: job, company: 'Acme' });
  assert.ok(optimizerOutput.fit_score >= 0);

  // HumanProof runs AFTER SeenFit, reusing the same résumé facts the optimizer used.
  const facts = extractResumeFacts(RESTAURANT_RESUME);
  const out = runHumanProof({
    text: GENERIC_BULLET,
    mode: 'resume',
    jobTitle: 'Server',
    company: 'Acme',
    resumeFacts: facts,
    optimizerOutput,
  });
  assert.ok(out.humanproof_score >= 0 && out.humanproof_score <= 100);
  assert.ok(out.humanized_text.length > 0);
  // Useful output with local polish disabled (engine never depends on a local model).
  assert.ok(out.after_score >= out.before_score, 'humanized output is at least as human as the input');
});

test('no external AI API calls anywhere in the engine source (static + runtime trap)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));

  const banned = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api-inference\.huggingface\.co|huggingface\.co\/models|x\.ai\/v1|api\.cohere/i;
  const files = readdirSync(here).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 12, 'expected the full humanizer module set');
  for (const f of files) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.ok(!banned.test(src), `humanizer file ${f} must not reference a hosted AI API`);
  }

  // Runtime guarantee: trap global fetch and assert the engine never calls it.
  const realFetch = globalThis.fetch;
  let called = null;
  globalThis.fetch = (url) => { called = String(url); throw new Error('fetch must not be called'); };
  try {
    runHumanProof({ text: GENERIC_BULLET, mode: 'resume', jobTitle: 'Server', resumeText: RESTAURANT_RESUME });
    runHumanProof({ text: 'I am writing to express my keen interest in this position.', mode: 'message' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, null, `engine called fetch(${called}) — it must be fully offline`);
});

test('application message mode — stiff clichés become plain, sincere wording', () => {
  const msg = 'I am writing to express my keen interest in this position. I am a results-driven professional with a proven track record.';
  const out = runHumanProof({ text: msg, mode: 'message', jobTitle: 'Server' });
  const t = out.humanized_text.toLowerCase();
  assert.ok(!/i am writing to express/.test(t), 'stiff opener replaced');
  assert.ok(!/proven track record/.test(t), 'buzzword removed');
  assert.ok(out.changes_made.length > 0);
});

test('paid-lock behavior — gate helper returns locked CTA copy when not Pro', async () => {
  // The endpoint guards the full feature behind Pro when HUMANPROOF_PAID_ONLY is on.
  // We test the pure copy/gate decision here (no DB) — see api for the live gateAI wiring.
  const { humanProofLockCopy } = await import('./paywall.ts');
  const copy = humanProofLockCopy();
  assert.ok(/optimized/i.test(copy.headline), 'locked headline present');
  assert.ok(/interview-ready/i.test(copy.body) || /truthful/i.test(copy.body), 'locked body present');
  // The locked copy must NOT promise to beat detectors.
  assert.ok(!/bypass|evade|beat the detector|fool/i.test(`${copy.headline} ${copy.body}`), 'locked copy stays on-message');
});
