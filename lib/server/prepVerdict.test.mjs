// Interview Prep consumes the fit check's verdict, and never says what the résumé or the posting does not (judge's
// prep-insights report, 2026-11-10: usefulness 4.2/10, 41 truth problems in 18 cases). Invariants run over every
// committed posting × persona résumé (lib/fixtures/personas), plus the judge's own cases quoted sentence for sentence.
// Run: node --test lib/server/prepVerdict.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localPack, moveQuestion, postingPay, frameFor, isLogistics, plainTitle, PREP_ENGINE } from './prepLocal.js';
import { realStatement } from './prepCompose.js';
import { buildContext, SOFT_SKILL_RE, SCREENING_RE } from '../resume/optimize/engine.js';
import { NOT_A_REQUIREMENT_RE } from '../resume/optimize/local.js';
import { PAY_SENTENCE_RE, splitPostingSentences } from '../optimizer/postingSections.js';
import { cleanPostingText, PREP_POSTING_MAX } from './prepPosting.js';
import { spokenEmployer } from './prepFacts.js';
import { prepFamilyFor } from './interviewPrep.js';
import { guideFor } from './interviewGuides.js';

const FIX = new URL('../fixtures/personas/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, FIX), 'utf8');
const SAMPLE = JSON.parse(read('postings-sample.json'));
const FILES = [
  { id: 'dev-stripe', persona: 'dev', title: 'Backend Engineer, Payments', company: 'Stripe', description: read('dev-stripe-jd.txt') },
  { id: 'maria-frys', persona: 'maria', title: 'Assistant Store Manager', company: "Fry's Food Stores", description: read('maria-frys-jd.txt') },
  { id: 'tasha-groupon', persona: 'tasha', title: 'Social Media Coordinator', company: 'Groupon', description: read('tasha-groupon-jd.txt') },
  { id: 'tasha-topstep', persona: 'tasha', title: 'Marketing Coordinator', company: 'Topstep', description: read('tasha-topstep-jd.txt') },
];
const CASES = [...SAMPLE, ...FILES];
const NOW = Date.parse('2026-11-10T18:00:00Z');
const built = new Map();
function run(c, stage = 'Interview') {
  const k = `${c.id}|${stage}`;
  if (!built.has(k)) {
    const resumeText = read(`${c.persona}.txt`);
    const pack = localPack({ company: c.company, role: c.title, resumeText, jobText: c.description, stage, nowMs: NOW });
    const ctx = buildContext({ resumeText, jobTitle: c.title, company: spokenEmployer(c.company), jobDescription: cleanPostingText(c.description), nowMs: NOW });
    built.set(k, { pack, ctx, resumeText });
  }
  return built.get(k);
}
const lc = (t) => String(t || '').toLowerCase();
const strings = (o, acc = []) => { if (o == null) return acc; if (typeof o === 'string') acc.push(o); else if (Array.isArray(o)) o.forEach((x) => strings(x, acc)); else if (typeof o === 'object') Object.values(o).forEach((x) => strings(x, acc)); return acc; };
const isRequirementRow = (r) => !/\b\d+\s*\+?\s*(?:years?|yrs?)\b/i.test(r.label) && !r.soft && !SOFT_SKILL_RE.test(r.label) && !SCREENING_RE.test(r.label) && !NOT_A_REQUIREMENT_RE.test(r.label) && !/\b(?:bilingual|fluent|spanish|french)\b/i.test(r.label);

test('the sample spans the fields Seen serves and every pack is from the current engine', () => {
  assert.ok(new Set(SAMPLE.map((c) => c.field)).size >= 6);
  for (const c of CASES) assert.equal(run(c).pack.engine, PREP_ENGINE, c.id);
});

test('the verdict is the floor: every non-inferred match has a row that is not a gap; every "shown" row is a match', () => {
  for (const c of CASES) {
    const { pack, ctx } = run(c);
    // P2 (2026-11-10): the rows are the reader's statements (one per posting line), each with the reader's own status
    if ((ctx.fit?.statements || []).length) {
      const st = new Map(ctx.fit.statements.map((x) => [lc(x.text), x]));
      for (const row of pack.job_match.filter((r) => r.source === 'statement')) {
        const s = st.get(lc(row.label)) || [...st.values()].find((x) => lc(row.label).length > 10 && lc(x.text).includes(lc(row.label).slice(0, 30)));
        if (!s) continue; // a label the posting's own heading line stood for (labelToDuty)
        if (s.status === 'shown') assert.notEqual(row.status, 'gap', `${c.id}: "${row.label}" is shown by the reader but a gap here`);
        if (s.status === 'not_shown') assert.ok(!['shown', 'stated'].includes(row.status), `${c.id}: "${row.label}" is not shown by the reader but ${row.status} here`);
      }
      // every requirement the fit check matched sits in a row that is not a gap
      for (const r of ctx.requirements.filter((x) => x.matched && !x.inferred && isRequirementRow(x) && x.posting)) {
        const row = pack.job_match.find((x) => x.source === 'statement' && (lc(r.posting).startsWith(lc(x.label).slice(0, 25)) || lc(x.label).includes(lc(r.label))));
        if (row) assert.notEqual(row.status, 'gap', `${c.id}: matched "${r.label}" sits in a gap row "${row.label}"`);
      }
      continue;
    }
    const rows = pack.job_match.filter((r) => r.source === 'verdict');
    for (const r of ctx.requirements.filter((x) => x.matched && !x.inferred && isRequirementRow(x))) {
      const row = rows.find((x) => lc(x.label) === lc(r.label));
      assert.ok(row, `${c.id}: matched "${r.label}" has no row`);
      assert.notEqual(row.status, 'gap', `${c.id}: matched "${r.label}" shown as a gap`);
    }
  }
});

test('the judge\'s D2 cases: shipping (warehouse), ERP (accountant), customer service (receptionist) and CHF are never gaps', () => {
  const by = (id) => run(CASES.find((c) => c.id === id)).pack.job_match;
  // (rows are the reader's statements: the line that names each one)
  for (const ship of by('warehouse-associate-integrity').filter((r) => /\bshipping\b/i.test(r.label))) assert.notEqual(ship.status, 'gap', JSON.stringify(ship));
  const chf = by('rn-home-health-bayada').find((r) => /\bCHF\b/.test(r.label));
  assert.ok(chf && chf.status !== 'gap', JSON.stringify(chf));
  if (chf.proof) assert.match(chf.proof, /CHF patients/, JSON.stringify(chf));
  for (const r of by('rn-home-health-bayada')) assert.ok(!/haven't .*CHF|CHF\b.*new to me/.test(r.say || ''), r.say);
  for (const cs of by('medical-receptionist-convenientmd').filter((r) => /^customer service$/i.test(r.label))) assert.notEqual(cs.status, 'gap', JSON.stringify(cs));
  for (const r of by('staff-accountant-rent-the-runway')) assert.ok(!/haven't worked on ERP/i.test(r.say || ''), r.say);
});

test('no "$" figure is spoken outside a pay sentence; the posting\'s pay keeps its unit and "up to"', () => {
  for (const c of CASES) {
    const { pack, resumeText } = run(c);
    const paySentences = splitPostingSentences(c.description).filter((s) => PAY_SENTENCE_RE.test(s)).join(' ');
    if (pack.posting_pay) {
      const first = (pack.posting_pay.match(/\$[\d,.]+/) || [''])[0];
      assert.ok(paySentences.replace(/\s+/g, '').includes(first.replace(/\s+/g, '')), `${c.id}: ${pack.posting_pay} not from a pay sentence`);
    }
    for (const a of pack.answers) {
      for (const m of String(a.answer || '').matchAll(/\$\s?\d(?:[\d,.]*\d)?/g)) {
        const fig = m[0].replace(/\s+/g, '');
        assert.ok(resumeText.includes(fig) || String(pack.posting_pay || '').includes(fig), `${c.id}: "${fig}" in «${a.q}» is not pay and not on the résumé`);
      }
    }
  }
  // the judge's pay cases, word for word
  assert.equal(postingPay('Samsara is growing 30%+ at ~$2B ARR, and the platform runs on a single data model.'), null);
  assert.equal(postingPay('Perks include gym membership reimbursement (up to $75/month) and commuter benefits.'), null);
  assert.equal(postingPay('Join us as we reinvent the $2.4 trillion fashion industry.\nThe salary range for this position is $64,397 - $80,496.'), '$64,397 – $80,496');
  assert.equal(postingPay('New grads are eligible for a $10,000 sign-on bonus.'), null);
  assert.equal(postingPay('Night shift differential: $1.50 per hour.'), null);
  assert.equal(postingPay('The salary range for this position is $36.50 - $58.40 (Hourly Rate)'), '$36.50 – $58.40 an hour');
  assert.equal(postingPay('Salary: up to $90,000+ per year, depending on experience.'), 'up to $90,000+ a year');
  const rtr = run(CASES.find((c) => c.id === 'staff-accountant-rent-the-runway')).pack;
  assert.equal(rtr.posting_pay, '$64,397 – $80,496');
  assert.equal(run(CASES.find((c) => c.id === 'senior-swe-ii-samsara')).pack.posting_pay === '$2', false);
  // the $75 gym allowance is never pay; the posting's own "Base Pay: $20.60 — $20.60 USD" line is (the shared pay reader,
  // lib/jobs/postingPay.js, now reads it — its owner's change, 2026-11-10)
  assert.doesNotMatch(String(run(CASES.find((c) => c.id === 'shift-lead-doordash')).pack.posting_pay || ''), /\$75\b/, 'the $75 gym allowance is not pay');
});

test('rows and scripts only for real requirements, scripted by kind', () => {
  for (const c of CASES) {
    for (const r of run(c).pack.job_match) {
      // a requirement label is never a non-requirement; a statement row (a whole posting line) is a real statement
      if (r.source === 'statement') assert.ok(realStatement(r.label.replace(/\s*\([^)]*\)$/, '')), `${c.id}: a row for "${r.label}"`);
      else assert.ok(!NOT_A_REQUIREMENT_RE.test(r.label), `${c.id}: a row for "${r.label}"`);
      assert.ok(!/I don't hold it yet/.test(r.say || ''), `${c.id}: "${r.label}" asserts a missing credential`);
      if (r.status === 'gap' && /\b(?:diploma|GED|degree|bachelor)/i.test(r.label)) assert.match(r.say, /If you have it, add it/, `${c.id}: a diploma is asked`);
      if (/I haven't (?:used|worked|done)/.test(r.say || '')) assert.ok(!/\b(?:licen[cs]e|certif\w*|diploma|degree)\b/i.test(r.label), `${c.id}: "${r.label}" scripted as a skill`);
    }
  }
  // upgrade 3: the Texas licence asked of an Arizona journeyman names the licence he holds
  const tx = run(CASES.find((c) => c.id === 'journeyman-service-driver-enterprise')).pack.job_match.find((r) => /Texas Journeyman/i.test(r.label));
  assert.ok(tx && tx.status === 'gap', JSON.stringify(tx));
  assert.match(tx.say, /I hold an Arizona Journeyman Electrician license\. \[Whether you have started on the Texas/);
});

test('no two answers say the same thing, and logistics questions never take a résumé story', () => {
  for (const c of CASES) for (const stage of ['Interview', 'Phone Screen']) {
    const { pack } = run(c, stage);
    // (a frame is the same three blanks for different questions; a told answer is never repeated)
    const texts = pack.answers.filter((a) => a.answer && !a.frame).map((a) => a.answer);
    assert.equal(new Set(texts).size, texts.length, `${c.id} ${stage}: duplicate answers`);
    for (const a of pack.answers) if (isLogistics(a.q)) assert.ok(!a.resume_fact, `${c.id}: «${a.q}» answered with «${a.resume_fact}»`);
  }
  // case 15 (Robert Half), the question and the line that used to answer it
  assert.ok(isLogistics('How soon can you start, and how far will you commute?'));
  assert.match(frameFor('How soon can you start, and how far will you commute?'), /^\[The first day you could start.*\[How you would get here/);
  assert.match(frameFor('What pay range are you looking for, and what is the lowest you would accept?'), /^\[A range you would accept/);
  assert.match(frameFor('Are you interviewing anywhere else, and what would make you turn a role down?'), /^\[Whether you are interviewing elsewhere/);
  assert.match(frameFor('Walk me through your résumé and why you left each job.'), /^\[Your current or latest role in two sentences/);
});

test('the move question names a field or a step up — never a list of title words, a place or a schedule (D6)', () => {
  const cases = [
    [{ title: 'Registered Nurse, Telemetry' }, 'Registered Nurse - Home Health', [{ title: 'Registered Nurse, Telemetry' }], 'Why home health now?'],
    [{ title: 'Guest Experience Team Lead' }, 'Shift Lead - Laurel', [{ title: 'Guest Experience Team Lead' }], null],
    [{ title: 'Journeyman Electrician' }, 'Journeyman Service Driver (commercial electrical)', [{ title: 'Journeyman Electrician' }, { title: 'Apprentice Electrician' }], null],
    [{ title: 'Journeyman Electrician' }, 'Maintenance Team Member', [{ title: 'Journeyman Electrician' }], null],
    [{ title: 'Office Manager' }, 'Administrative Coordinator', [{ title: 'Office Manager' }, { title: 'Receptionist' }], null],
    [{ title: 'Operations Manager' }, 'Vice President of Operations', [{ title: 'Operations Manager' }], 'What makes you ready to step up from Operations Manager to Vice President of Operations?'],
    [{ title: 'Registered Nurse, Telemetry' }, 'Occupational Therapist (OT)', [{ title: 'Registered Nurse, Telemetry' }], 'Why occupational therapy now?'],
  ];
  for (const [cur, role, jobs, want] of cases) assert.equal(moveQuestion(cur, role, jobs)?.q ?? null, want, role);
  assert.equal(plainTitle('Material Handler 1 - 1st Shift'), 'Material Handler');
  for (const c of CASES) for (const q of run(c).pack.questions) assert.ok(!/^Why (?:\w+ and )+\w+ now\?$/.test(q.q), `${c.id}: ${q.q}`);
});

test('one posting text: the whole posting, lines kept, on every path (D3)', () => {
  const sam = CASES.find((c) => c.id === 'senior-swe-ii-samsara');
  assert.ok(sam.description.length > 6000 && PREP_POSTING_MAX >= 20000);
  assert.equal(cleanPostingText(sam.description), sam.description.replace(/\r\n?/g, '\n').trim());
  // the requirement list past character 6,000 is read: the languages are rows
  const labels = run(sam).pack.job_match.map((r) => lc(r.label)).join(' | ');
  assert.match(labels, /\bgo\b|python|typescript/, labels);
  const nw = CASES.find((c) => c.id === 'rn-urology-nights-northwestern');
  assert.ok(run(nw).pack.job_match.length >= 5, 'the nights RN posting is read');
});

test('a lead role on an hourly track gets the lead questions first; the family reads the posting (D13)', () => {
  const dd = CASES.find((c) => c.id === 'shift-lead-doordash');
  assert.equal(prepFamilyFor(dd.title, dd.description), 'warehouse');
  const g = guideFor(dd.company, dd.title, { family: 'warehouse' });
  if (g) assert.equal(g.audience, 'hourly');
  const qs = run(dd).pack.questions.map((q) => q.q);
  assert.ok(!qs.some((q) => /case|market's delivery times/i.test(q)), qs.join(' | '));
  const lead = qs.findIndex((q) => /behind the plan|missing rate|start-of-shift/i.test(q));
  const company = run(dd).pack.questions.findIndex((q) => q.company);
  assert.ok(lead >= 0 && (company < 0 || lead < company), qs.join(' | '));
});

test('the step-up answer is the person\'s own lines; scenario questions carry a hint, never a story (upgrades 2, 5)', () => {
  const frys = run(CASES.find((c) => c.id === 'maria-frys'));
  const step = frys.pack.answers.find((a) => /^What makes you ready to step up/.test(a.q));
  assert.ok(step, frys.pack.questions.map((q) => q.q).join(' | '));
  const said = step.answer.replace(/\[[^\]]*\]/g, '');
  for (const n of said.match(/\d+%?/g) || []) assert.ok(frys.resumeText.includes(n), `${n} not on the résumé`);
  assert.match(step.answer, /\[What you would take on first as an Assistant Store Manager/);
  const nw = run(CASES.find((c) => c.id === 'rn-urology-nights-northwestern')).pack;
  const sc = nw.answers.filter((a) => a.scenario);
  // P2: a scenario is a draft with one blank; a résumé line in it is offered as the closest, never as the procedure itself
  assert.ok(sc.length >= 1 && sc.every((a) => (a.answer.match(/\[/g) || []).length === 1 && (!a.resume_fact || /closest|At /.test(a.answer))), JSON.stringify(sc));
  assert.ok(sc.some((a) => /bladder irrigation|wound therapy|chest tube|doppler/i.test(a.q)));
});

test('one years figure per pack, and the small things a person would notice', () => {
  for (const c of CASES) {
    const { pack } = run(c, 'Phone Screen');
    const said = strings({ a: pack.answers, i: pack.intro, j: pack.job_match.map((r) => r.say) }).flatMap((s) => [...s.matchAll(/\b(?:show|have)\s+(\d+)(?:\.\d+)?\+?\s+years?\b/gi)].map((m) => Number(m[1])));
    assert.ok(new Set(said).size <= 1, `${c.id}: years ${[...new Set(said)].join(' / ')}`);
    const all = strings(pack).join('\n');
    assert.ok(!/\bI hold the [A-Z]{2,5}\./.test(all), `${c.id}: "I hold the BLS."`);
    assert.ok(!/\b(\w{4,}) \1\b/i.test(all.replace(/\b(\d+) \1\b/g, '')), `${c.id}: doubled word`);
    assert.ok(!/\bat [A-Z][\w &'.-]+, [A-Z][a-z]+ [A-Z]{2}\b/.test(all), `${c.id}: a city glued to an employer`);
  }
  assert.equal(spokenEmployer('shinola'), 'Shinola');
  assert.equal(spokenEmployer('Midwest Distribution Partners, Joliet IL'), 'Midwest Distribution Partners');
  const bay = run(CASES.find((c) => c.id === 'rn-home-health-bayada')).pack;
  assert.ok(!strings(bay.answers).some((s) => /\d-\d\s+[a-z]/.test(s.replace(/\[[^\]]*\]/g, ''))), 'ranges are said out loud');
});
