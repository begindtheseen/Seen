import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBullet } from './grammar.js';
import { verifyRewrite, isCosmetic } from './verify.js';

test('grammar: earlier jobs are past tense; the current job keeps its lead verb; joined verbs agree', () => {
  assert.equal(checkBullet('Lead the crew', { current: false }).text, 'Led the crew');
  assert.equal(checkBullet('Manages weekly schedules in Kronos', { current: true }).text, 'Manage weekly schedules in Kronos');
  assert.equal(checkBullet('Grew store sales 9% in 2023', { current: true }).text, 'Grew store sales 9% in 2023', 'a finished result may be past in the current job');
  assert.equal(checkBullet('Communicated reading progress to families through a weekly class newsletter', { current: true }).text, 'Communicate reading progress to families through a weekly class newsletter', 'an ongoing duty in the current job is present');
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
    requirements: [{ label: 'Bilingual Spanish (preferred)', evidence: [], strength: 'none' }, { label: 'P&L', evidence: [], strength: 'none' }],
    questions: [
      { bullet: 'J1.2', ask: 'Did you design the shrink changes yourself? And did the 1.1% hold after?', why: 'ownership' },
      { bullet: 'J1.1', ask: 'About how much of your time is spent on hiring vs. scheduling?', why: 'readiness' },
      { bullet: 'J1.2', ask: 'Can you describe how you rolled out the new process?', why: 'story' },
      { bullet: null, ask: 'Are you willing to work weekends?', why: 'schedule' },
      { bullet: null, ask: 'Have you used Workday?', why: 'preferred tool' },
    ],
    gaps: [
      { label: 'bilingual spanish', advice: 'Say it.' },
      { label: "Bachelor's degree", advice: "The posting prefers a bachelor's degree but does not require it. Your high school diploma + 9.5 years of retail management exceed the baseline." },
      { label: 'Ability to lift 50 lbs (screening constraint)', advice: 'Confirm it.' },
      { label: 'Coaching (required)', advice: 'No coaching evidence. See q5 above.' },
    ],
  }, ctx);
  const asks = d.questions.map((q) => q.ask);
  assert.equal(asks[0], 'Have you worked with P&L?', 'an unshown requirement is asked first');
  for (const q of ['Did you design the shrink changes yourself?', 'Have you used Workday?']) assert.ok(asks.includes(q), JSON.stringify(asks));
  assert.ok(!asks.some((q) => /bachelor/i.test(q)), 'the education section already answers the degree');
  assert.ok(!asks.some((q) => /time|describe/i.test(q)));
  assert.deepEqual(d.questions[0].choices, ['Yes', 'Some', 'No', 'Not sure']);
  assert.equal(d.requirements.find((r) => r.label === 'Bilingual Spanish').strength, 'stated', 'a "(preferred)" note does not hide the résumé evidence');
  assert.equal(d.requirements.find((r) => r.label === 'Bilingual Spanish').importance, 'preferred');
  assert.ok(!d.gaps.some((g) => g.label === 'bilingual spanish'), 'a requirement the résumé states is not a gap');
  assert.equal(d.gaps.find((g) => /bachelor/i.test(g.label)).advice, "The posting prefers a bachelor's degree but does not require it.");
  assert.ok(!/\s\S+$/.test(d.bullets.find((b) => b.id === 'J1.1').why) || /[.!?]$/.test(d.bullets.find((b) => b.id === 'J1.1').why), 'a why ends on a sentence, never mid-word');
  assert.ok(!d.gaps.some((g) => /lift/i.test(g.label)), 'a screening item is for the application, not a résumé gap');
  const coach = d.gaps.find((g) => g.label === 'Coaching');
  assert.ok(coach && !/q5|No coaching evidence/.test(coach.advice), 'a reference to a question that does not exist and advice with nothing to do are replaced');
  assert.equal(adviceOk('Lead with your Associate of Applied Science.', { resumeText, history: ctx.sheet.history, company: fx.job.company, role: fx.job.title, jobDescription: jd }), true);
  assert.equal(clip('One. Two three four five six seven.', 10), 'One.');
});

test('a skill the person\'s own title implies is not a gap; a named tool or credential always can be', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildContext, impliedByTitles } = await import('./engine.js');
  const load = (id) => { const f = JSON.parse(readFileSync(new URL(`../../../scripts/eval/fixtures/${id}.json`, import.meta.url), 'utf8')); return buildContext({ resumeText: f.resume.join('\n'), jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') }); };
  const cook = load('13-line-cook');
  const teacher = load('14-teacher');
  const acct = load('11-accountant');
  assert.equal(impliedByTitles('cooking techniques', cook), true);
  assert.equal(impliedByTitles('lesson planning', teacher), true);
  assert.equal(impliedByTitles('SOX compliance', acct), false);
  assert.equal(impliedByTitles('ESL', teacher), false);
  assert.equal(impliedByTitles('Power BI', acct), false);
});

test('answer choices do not lead the witness', async () => {
  const { fairChoices } = await import('./engine.js');
  assert.deepEqual(fairChoices(['Yes, regularly', 'Yes, occasionally', "No, but I'm comfortable with the tool"], 'Have you prepared PowerPoint decks for the attorneys?'),
    ['Yes, regularly', 'Yes, occasionally', 'No', 'Not sure']);
  assert.deepEqual(fairChoices(['10–15 per week', '15–25 per week', '25–40 per week'], 'About how many meetings do you schedule per week?'), [], 'no invented number buckets');
  assert.deepEqual(fairChoices(['Prevented or resolved a production outage (scope: how many services were affected)'], 'What did the runbook resolve?'), []);
});

test('verify: tense changes are not new words; a capital at a clause start is not a name', async () => {
  const { stem } = await import('./verify.js');
  assert.equal(stem('passed'), stem('pass'));
  assert.equal(stem('dated'), stem('date'));
  assert.equal(stem('hiring'), stem('hire'));
  const v = verifyRewrite({ before: 'Prep my station, label and date everything, and pass every health inspection', after: 'Labeled and dated everything; passed every health inspection. Previously prepped my station', facts: [] });
  assert.ok(!v.reasons.includes('new_term'), JSON.stringify(v));
});

test('rewrite guard: a merge carries all of the other line, a matching length of time is allowed, the answer may replace a figure', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildContext, guardRewrites, applyProposals } = await import('./engine.js');
  const f = JSON.parse(readFileSync(new URL('../../../scripts/eval/fixtures/04-customer-service.json', import.meta.url), 'utf8'));
  const resumeText = f.resume.join('\n');
  const ctx = buildContext({ resumeText, jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') });
  const id = (re) => ctx.sheet.jobs.flatMap((j) => j.bullets).find((b) => re.test(b.text)).id;
  const calls = id(/60–70 inbound/);
  const aht = id(/handle time/);
  const g = guardRewrites(ctx, {}, { rewrites: [
    { id: aht, text: 'Answer 60–70 inbound calls a day in Salesforce Service Cloud with a 6:10 average handle time against a 7:30 target', uses: [aht, calls] },
  ] }, null, []);
  assert.equal(g.proposals.length, 0, 'a merge that drops the other line\'s 30,000+ is refused');
  assert.match(g.rejected[0].reason, /leaves out its 30000/);
  const ok = guardRewrites(ctx, {}, { rewrites: [
    { id: aht, text: 'Handle 60–70 inbound calls a day for 30,000+ policyholders at a 6:10 average handle time against a 7:30 target, with complete notes in Salesforce Service Cloud', uses: [aht, calls] },
  ] }, null, []);
  assert.equal(ok.proposals.length, 1, JSON.stringify(ok.rejected));
  const out = applyProposals(resumeText, ok.proposals);
  assert.equal(out.split('\n').filter((l) => /60–70 inbound/.test(l)).length, 1, 'the merged line leaves the résumé');
});

test('Seen asks about every requirement the résumé does not show', async () => {
  const { requirementQuestion } = await import('./engine.js');
  assert.equal(requirementQuestion('Seafood experience'), 'Have you worked with seafood?');
  assert.equal(requirementQuestion('ServSafe Manager certification'), 'Do you hold a ServSafe Manager certification?');
  assert.equal(requirementQuestion('Power BI'), 'Have you used Power BI?');
  assert.equal(requirementQuestion('excel advanced'), 'Have you used Excel?');
  assert.equal(requirementQuestion('Explaining findings to non-technical audiences'), 'Does your work include explaining findings to non-technical audiences?');
});

test('a new bullet comes only from a yes-answer, says only what it says, and lands under its job', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildContext, guardRewrites, applyProposals } = await import('./engine.js');
  const f = JSON.parse(readFileSync(new URL('../../../scripts/eval/fixtures/01-retail-manager.json', import.meta.url), 'utf8'));
  const resumeText = f.resume.join('\n');
  const ctx = buildContext({ resumeText, jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') });
  const answers = [
    { id: 'q1', bullet: null, ask: 'Have you run the store without the Store Manager there?', answer: "Yes, I run the store on the Store Manager's 2 days off every week" },
    { id: 'q2', bullet: null, ask: 'Have you owned the store P&L?', answer: 'No, never' },
  ];
  const g = guardRewrites(ctx, {}, { rewrites: [], additions: [
    { job: 'J1', text: "Run the store on the Store Manager's 2 days off every week", uses: ['a:q1'] },
    { job: 'J1', text: 'Own the store P&L', uses: ['a:q2'] },
    { job: 'J1', text: "Run the store on the Store Manager's 2 days off every week and hit every sales target", uses: ['a:q1'] },
  ] }, null, answers);
  assert.deepEqual(g.proposals.map((p) => p.after), ["Run the store on the Store Manager's 2 days off every week"], JSON.stringify(g.rejected));
  assert.equal(g.rejected.length, 2);
  const out = applyProposals(resumeText, g.proposals).split('\n');
  const at = out.findIndex((l) => /2 days off/.test(l));
  assert.match(out[at - 1], /Hired and trained 22 associates/, 'placed after the job\'s last bullet');
  assert.match(out[at], /^• /);
});

test('diagnosis, from the round-3 graders: one evidence map, conservative cuts, one question, honest advice', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildContext, guardDiagnosis } = await import('./engine.js');
  const load = (id) => { const f = JSON.parse(readFileSync(new URL(`../../../scripts/eval/fixtures/${id}.json`, import.meta.url), 'utf8')); return buildContext({ resumeText: f.resume.join('\n'), jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') }); };
  const cook = load('13-line-cook');
  const bullets = cook.sheet.jobs.flatMap((j) => j.bullets);
  const d = guardDiagnosis({
    bullets: bullets.map((b) => ({ id: b.id, level: 2, action: 'cut', why: 'not relevant' })),
    requirements: [{ label: 'ServSafe Food Handler card (required)', evidence: [], strength: 'none' }, { label: 'facebook', evidence: [], strength: 'none' }],
    questions: [
      { bullet: bullets[0].id, ask: 'About how many covers do you cook on a Saturday, and do you work the fry station too?', why: 'volume' },
      { bullet: bullets[1].id, ask: 'Can you lift 50 pounds comfortably during your shifts, or do you need accommodation?', why: 'physical' },
    ],
    gaps: [{ label: 'Seafood experience', advice: 'Say in the cover letter that you currently use [your station].' }],
  }, cook);
  assert.equal(d.requirements.find((r) => /Food Handler/.test(r.label)).strength, 'stated', 'a met constraint is not a missing requirement');
  assert.notEqual(d.requirements.find((r) => r.label === 'facebook').strength, 'implied', 'a product is never implied by a title');
  assert.ok(d.bullets.filter((b) => /\d/.test(b.text)).every((b) => b.action !== 'cut'), 'a line with a number is never cut');
  for (const j of cook.sheet.jobs) assert.ok(j.bullets.filter((b) => d.bullets.find((x) => x.id === b.id).action !== 'cut').length >= Math.min(2, j.bullets.length), 'a job keeps two lines');
  const asks = d.questions.map((q) => q.ask);
  assert.ok(asks.includes('About how many covers do you cook on a Saturday?'), JSON.stringify(asks));
  assert.ok(!asks.some((q) => /lift|accommodat/i.test(q)));
  assert.ok(!/\[your/.test(d.gaps.map((g) => g.advice).join(' ')), 'no unfilled placeholder');
});

test('a tool on the résumé is evidence even when the posting adds a modifier ("excel advanced")', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildContext, guardDiagnosis } = await import('./engine.js');
  const f = JSON.parse(readFileSync(new URL('../../../scripts/eval/fixtures/11-accountant.json', import.meta.url), 'utf8'));
  const ctx = buildContext({ resumeText: f.resume.join('\n'), jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') });
  const d = guardDiagnosis({ requirements: [{ label: 'excel advanced', evidence: [], strength: 'none' }] }, ctx);
  assert.notEqual(d.requirements[0].strength, 'none');
  assert.ok(!d.questions.some((q) => /excel/i.test(q.ask)), 'not asked about a tool the résumé already lists');
});

test('no template question for a soft skill; no choice list of only "None" and "Not sure"', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildContext, guardDiagnosis, fairChoices } = await import('./engine.js');
  const f = JSON.parse(readFileSync(new URL('../../../scripts/eval/fixtures/10-admin-assistant.json', import.meta.url), 'utf8'));
  const ctx = buildContext({ resumeText: f.resume.join('\n'), jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') });
  const d = guardDiagnosis({ requirements: [{ label: 'attention to detail', evidence: [], strength: 'none' }, { label: 'Concur', evidence: [], strength: 'none' }] }, ctx);
  assert.ok(!d.questions.some((q) => /attention to detail/i.test(q.ask)));
  assert.ok(d.questions.some((q) => /Concur/.test(q.ask)), JSON.stringify(d.questions.map((q) => q.ask)));
  assert.deepEqual(fairChoices(['None', 'Not sure'], 'How many trips do you book a month?'), []);
});
