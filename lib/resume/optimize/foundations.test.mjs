import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBullet } from './grammar.js';
import { verifyRewrite, isCosmetic } from './verify.js';

test('grammar: earlier jobs are past tense; the current job keeps its lead verb; joined verbs agree', () => {
  assert.equal(checkBullet('Lead the crew', { current: false }).text, 'Led the crew');
  assert.equal(checkBullet('Manages weekly schedules in Kronos', { current: true }).text, 'Manage weekly schedules in Kronos');
  assert.equal(checkBullet('Grew store sales 9% in 2023', { current: true }).text, 'Grew store sales 9% in 2023', 'a finished result may be past in the current job');
  assert.equal(checkBullet('Lead a crew of 14 and trained 9 new hires', { current: true }).text, 'Lead a crew of 14 and train 9 new hires');
  assert.equal(checkBullet('Built schedules and train 9 new hires', { current: false }).text, 'Built schedules and trained 9 new hires');
  assert.equal(checkBullet('Handled returns, cash handling and closing', { current: false }).text, 'Handled returns, cash handling and closing', 'a noun phrase is never conjugated');
  assert.equal(checkBullet('Cut shrink 54% and trained the team', { current: true }).text, 'Cut shrink 54% and trained the team', '"Cut" is past or present, so the joined verb is left as written');
  assert.equal(checkBullet('Cut shrink 54% and train the team', { current: false }).text, 'Cut shrink 54% and trained the team');
});

test('grammar: what cannot be fixed is refused', () => {
  for (const [t, code] of [['Responsible for weekly schedules', 'weak_lead'], ['I managed the floor', 'pronoun'], ['Results-driven leader who grew sales 9%', 'buzzword'], ['Customer service and cash handling', 'no_verb'], ['Managing the store', 'gerund_lead']]) {
    const r = checkBullet(t, { current: false });
    assert.equal(r.ok, false, t);
    assert.ok(r.issues.some((i) => i.code === code), `${t}: ${r.issues.map((i) => i.code)}`);
  }
});

test('verify: new numbers, new tools, new claims, lost numbers and synonym swaps are refused', () => {
  const R = 'Build weekly schedules in Kronos for 900+ labor hours and run the cash office\nCut shrink from 2.4% to 1.1% in 12 months';
  const v = (before, after) => verifyRewrite({ before, after, resumeText: R });
  assert.ok(v('Build weekly schedules in Kronos for 900+ labor hours', 'Built Workday schedules for 900+ labor hours, cutting overtime 15%').reasons.includes('new_number'));
  assert.ok(v('Build weekly schedules in Kronos for 900+ labor hours', 'Built Workday schedules for 900+ labor hours').reasons.includes('new_term'));
  assert.ok(v('Build weekly schedules in Kronos for 900+ labor hours and run the cash office', 'Run a 900+ hour weekly labor budget in Kronos and own the cash office').reasons.includes('new_claims'));
  assert.ok(v('Cut shrink from 2.4% to 1.1% in 12 months', 'Cut shrink in 12 months').reasons.includes('lost_number'));
  assert.ok(isCosmetic('Cut shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room process', 'Reduced shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room process'));
  assert.equal(v('Responsible for weekly schedules in Kronos', 'Build weekly schedules in Kronos').ok, true);
});

test('diagnosis guard: one short question each, no time-split asks, evidence found anywhere, honest gap advice', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildContext, guardDiagnosis, adviceOk, clip } = await import('./engine.js');
  const fx = JSON.parse(readFileSync(new URL('../../../scripts/eval/fixtures/01-retail-manager.json', import.meta.url), 'utf8'));
  const resumeText = fx.resume.join('\n');
  const jd = fx.job.description.join('\n');
  const ctx = buildContext({ resumeText, jobTitle: fx.job.title, company: fx.job.company, jobDescription: jd });
  const d = guardDiagnosis({
    bullets: [{ id: 'J1.1', level: 2, action: 'keep', why: 'Clear scope signal for a larger team. It also shows supervisors reporting to her, which matters a great deal for a store manager role that runs three shifts and many departments.' }],
    requirements: [{ label: 'bilingual spanish', evidence: [], strength: 'none' }, { label: 'P&L', evidence: [], strength: 'none' }],
    questions: [
      { bullet: 'J1.2', ask: 'Did you design the shrink changes yourself? And did the 1.1% hold after?', why: 'ownership' },
      { bullet: 'J1.1', ask: 'About how much of your time is spent on hiring vs. scheduling?', why: 'readiness' },
    ],
    gaps: [
      { label: 'bilingual spanish', advice: 'Say it.' },
      { label: "Bachelor's degree", advice: "The posting prefers a bachelor's degree but does not require it. Your high school diploma + 9.5 years of retail management exceed the baseline." },
    ],
  }, ctx);
  assert.deepEqual(d.questions.map((q) => q.ask), ['Did you design the shrink changes yourself?']);
  assert.equal(d.requirements.find((r) => r.label === 'bilingual spanish').strength, 'stated');
  assert.ok(!d.gaps.some((g) => g.label === 'bilingual spanish'), 'a requirement the résumé states is not a gap');
  assert.equal(d.gaps.find((g) => /bachelor/i.test(g.label)).advice, "The posting prefers a bachelor's degree but does not require it.");
  assert.ok(!/\s\S+$/.test(d.bullets.find((b) => b.id === 'J1.1').why) || /[.!?]$/.test(d.bullets.find((b) => b.id === 'J1.1').why), 'a why ends on a sentence, never mid-word');
  assert.equal(adviceOk('Lead with your Associate of Applied Science.', { resumeText, history: ctx.sheet.history, company: fx.job.company, role: fx.job.title, jobDescription: jd }), true);
  assert.equal(clip('One. Two three four five six seven.', 10), 'One.');
});
