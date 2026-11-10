// The paid result is honest (T3, 2026-11-10). Invariants over personas × 60 real postings, plus the director's cases:
//   1. every difference between the person's document and the tailored one is in `changes` (unlistedDifferences = 0);
//   2. never invent: every word of the tailored document is the résumé's, a connective, or a posting label the résumé
//      proves;
//   3. the summary's identity is the current / latest REGULAR role — never an internship, part-time or seasonal job
//      when a later or current regular one exists;
//   4. ONE charge rule: never "charge" when blocked, a different field, or nothing more shows where a recruiter reads;
//   5. a composed summary passes the validator; no sentence a buyer reads has an unbalanced bracket or a dangling
//      separator, and no field-specific canned reason is printed for another field.
// Run: node --test lib/resume/tailor/paid.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPaidOptimize, changeCounts } from '../../server/optimizePackage.js';
import { unlistedDifferences, chargeDecision, lineDiff, fieldMatch, buildTailored, screenStatements, gateSentences, usSpelling } from './paid.js';
import { renderText } from '../render/text.js';
import { termSwap, tenseRewriteOk } from './rewrites.js';
import { qualifiedProof } from './verdict.js';
import { validateSummary, isRegularRole } from './summary.js';
import { parseResume } from '../parse/index.js';
import { tailorResume, composeLineAnswer, composeGapAnswer } from './tailor.js';
import { applyPlan } from './optimizer.js';
import { firstRead } from './firstRead.js';
import { polishLead } from './rewrites.js';
import { bulletFromAnswer, numberSlot, composeDetailAnswer, detailQuestions } from './questions.js';
import { canonicalResumeText } from '../canonical.js';
import { composeApplicationMessage } from '../../optimizer/generateApplicationMessage.js';

const P = (f) => fs.readFileSync(new URL(`../../fixtures/personas/${f}`, import.meta.url), 'utf8');
const MINE = JSON.parse(fs.readFileSync(new URL('./fixtures/t3-resumes.json', import.meta.url), 'utf8'));
const POSTINGS = JSON.parse(fs.readFileSync(new URL('./fixtures/t3-postings.json', import.meta.url), 'utf8'));
const PERSONAS = { warehouse: P('warehouse.txt'), maria: P('maria.txt'), staffacct: MINE.staffacct, chef: MINE.chef, nursepast: MINE.nursepast };

const RUNS = [];
for (const [name, text] of Object.entries(PERSONAS)) for (const j of POSTINGS) {
  const r = buildPaidOptimize({ resume: text, original: text, jobDescription: j.description, job: j.title, company: j.company });
  RUNS.push({ name: `${name} × ${j.title}`, text, j, r });
}
const words = (t) => String(t || '').toLowerCase().replace(/[‘’]/g, "'").split(/[^a-z0-9+#']+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const CONNECTIVES = new Set(['with', 'years', 'experience', 'most', 'recently', 'experienced', 'and', 'credentials', 'currently', 'since', 'until', 'holds', 'skilled', 'work', 'includes', 'brings', 'student', 'graduating', 'the', 'perform', 'performed', 'handle', 'handled', 'provide', 'provided', 'complete', 'completed']);
const SEAM = /[|]\s*[.]|[\s,;:—–-]+\.(?:\s|$)|\(\s*\)|\bundefined\b|\bnull\b|term:/;

test(`1. every difference from the person's document is listed (${RUNS.length} runs)`, () => {
  for (const { name, text, r } of RUNS) {
    if (!r.tailored) continue;
    const u = unlistedDifferences(text, r.tailored.text, r.tailored.changes);
    assert.deepEqual(u, [], `${name}: ${JSON.stringify(u.slice(0, 3))}`);
  }
});

test('2. never invent: every word of the tailored document is the résumé\'s, a connective, or a proven posting label', () => {
  for (const { name, text, r } of RUNS) {
    if (!r.tailored) continue;
    // + section headings the re-typesetting adds (listed in the format item)
    const headings = r.tailored.changes.flatMap((c) => [c.heading || '', ...(c.items || []).flatMap((d) => [d.to || '', d.to_section || ''])]);
    const allowed = new Set([...words(text), ...words((r.matched_requirements || []).map((m) => m.surface || m.requirement).join(' ')), ...words(headings.join(' ')), ...CONNECTIVES]);
    // a gerund of the person's own verb ("caring" ← "Care for 5 patients") is their word in the summary's form
    const gerundOk = (w) => /ing$/.test(w) && [w.slice(0, -3), `${w.slice(0, -3)}e`, w.slice(0, -4)].some((b) => allowed.has(b) || allowed.has(`${b}s`));
    const extra = words(r.tailored.text).filter((w) => !allowed.has(w) && !allowed.has(w.replace(/s$/, '')) && !allowed.has(`${w}s`) && !gerundOk(w));
    assert.deepEqual([...new Set(extra)], [], `${name}`);
  }
});

test('3. the summary identity is the current / latest regular role, never an internship or seasonal job', () => {
  for (const { name, text, r } of RUNS) {
    if (!r.summary || r.summary.kept) continue;
    const doc = parseResume({ text: canonicalResumeText(text), source: 'text' });
    const regular = doc.experience.filter((e) => isRegularRole(e));
    if (!regular.length) continue;
    for (const e of doc.experience.filter((x) => !isRegularRole(x))) {
      const t = (e.displayTitle || e.title || '').replace(/\s*\([^)]*\)/g, '');
      if (t && regular.every((g) => (g.displayTitle || g.title) !== (e.displayTitle || e.title))) assert.ok(!r.summary.text.toLowerCase().startsWith(t.toLowerCase()), `${name}: ${r.summary.text}`);
    }
    assert.ok(validateSummary(r.summary.text).ok, `${name}: ${r.summary.text} ${JSON.stringify(validateSummary(r.summary.text).problems)}`);
  }
});

test('4. ONE charge rule: never charged when blocked, a different field, or with no visible gain', () => {
  let charged = 0, free = 0;
  for (const { name, r } of RUNS) {
    const c = r.charge;
    assert.ok(c && typeof c.sentence === 'string' && c.sentence.length > 30, name);
    if (!c.charge) { free++; continue; }
    charged++;
    assert.equal(r.blocked, null, name);
    assert.notEqual(r.field_match && r.field_match.level, 'different', name);
    const v = r.tailored.visibility;
    // strict (director 2026-11-10): charged only when more displayed statements sit up front
    assert.ok(v.after > v.before, `${name}: ${JSON.stringify(v)}`);
    assert.ok(r.tailored.changes.some((x) => x.default === 'applied' && x.substantive && x.type !== 'format'), name);
    assert.ok(r.tailored.score_after >= r.tailored.score_before, name);
  }
  assert.ok(charged > 0 && free > 0, `charged ${charged}, free ${free}`);
});

test('5. what a buyer reads: no seam, balanced brackets; blocked ⇒ no questions, no message, no changes for a different field', () => {
  for (const { name, r, text } of RUNS) {
    r.text = text;
    const texts = [...(r.tailored ? r.tailored.changes.map((c) => c.why) : []), r.application_message, r.charge.sentence, ...(r.questions || []).flatMap((q) => [q.question, q.why]), r.availability && r.availability.why, r.blocked && r.blocked.sentence].filter(Boolean);
    for (const t of texts) {
      assert.ok(!SEAM.test(t), `${name}: ${t}`);
      assert.equal(t.split('(').length, t.split(')').length, `${name}: ${t}`);
      assert.ok(!/Store managers screen on availability/i.test(t), `${name}: canned availability reason`);
      assert.ok(!/strong match|Performed .{2,40} for \[|anywhere else\? If so, for what or whom/.test(t), `${name}: ${t}`);
    }
    if (r.blocked) {
      assert.deepEqual(r.questions, [], name);
      assert.equal(r.application_message, '', name);
      // no tailored version at all: the person's document, untouched
      assert.deepEqual(r.tailored.changes, [], name);
      assert.equal(r.tailored.untouched, true, name);
      assert.equal(r.tailored.text, r.text !== undefined ? r.text : r.tailored.text, name);
    }
    assert.ok((r.questions || []).filter((q) => q.kind === 'gap').length <= 3, name);
    for (const q of r.questions || []) assert.ok(q.kind === 'gap' ? /doesn't show/.test(q.heading) : q.kind === 'detail' ? /detail they list/.test(q.heading) : /number/.test(q.heading), `${name}: ${q.heading}`);
    if (r.application_message) {
      const n = r.application_message.split(/\s+/).length;
      assert.ok(n <= 130, `${name}: ${n} words`);
    }
  }
});

// ── the director's cases (rebuilt from the descriptions, on résumés written for this test) ──
test('the staff accountant is never summarised as her 2020 internship', () => {
  const doc = parseResume({ text: MINE.staffacct, source: 'text' });
  const j = POSTINGS.find((p) => /accountant|accounting/i.test(p.title)) || { title: 'Senior Accountant', company: 'Acme', description: 'Requirements: month-end close, account reconciliation, journal entries, NetSuite, GAAP. 3+ years of accounting experience.' };
  const { plan, variant } = tailorResume(doc, { jobTitle: 'Senior Accountant', company: 'Acme Health', jobDescription: `${j.description}\nRequirements: month-end close, account reconciliation, journal entries, NetSuite, GAAP, accruals.` });
  if (plan.summaryDecision.mode === 'replace' || plan.summaryDecision.mode === 'add') {
    assert.ok(!/intern/i.test(variant.basics.summary), variant.basics.summary);
    assert.match(variant.basics.summary, /^Staff Accountant\b/, variant.basics.summary);
  }
  assert.equal(plan.summaryDecision.identity, 'Staff Accountant');
});

test('the chef is "Kitchen Manager", never "SOUS CHEF", and a parse fragment never opens a summary', () => {
  const r = buildPaidOptimize({ resume: MINE.chef, original: MINE.chef, job: 'Kitchen Manager', company: 'Acme Grill', jobDescription: 'Kitchen Manager\nRequirements:\n- 3+ years of kitchen leadership\n- Food safety and ServSafe Manager certification\n- Inventory, ordering and food cost control\n- Scheduling and training line cooks\nResponsibilities:\n- Run the kitchen on busy nights' });
  assert.ok(!/SOUS CHEF|Southpark location\.\s/.test(r.summary.text) || r.summary.kept, r.summary.text);
  if (!r.summary.kept) { assert.match(r.summary.text, /^Kitchen Manager\b/); assert.ok(validateSummary(r.summary.text).ok, r.summary.text); }
});

test('a past "Charge nurse 2 nights per week…" line is left alone — no "Serve as" put in her mouth', () => {
  assert.equal(polishLead('Charge nurse 2 nights per week on a 32-bed unit', 'past'), null);
  const r = buildPaidOptimize({ resume: MINE.nursepast, original: MINE.nursepast, job: 'Charge Nurse', company: 'Acme Hospital', jobDescription: 'Charge Nurse, Med-Surg\nRequirements:\n- Active RN license\n- 2+ years of charge nurse experience\n- BLS and ACLS\n- Epic charting\nResponsibilities:\n- Lead the unit on night shift and precept new graduates' });
  for (const c of r.tailored.changes) assert.ok(!/^Serve as|^Served as/.test(c.after), c.after);
  // any added verb waits for the OK and says so
  for (const rw of r.rewrite_plan) if (rw.added) { assert.equal(rw.default, 'needs_ok'); assert.match(rw.why, /adds the word/); }
});

test('"Responsible for …" is left as written — no added verb', () => {
  const doc = parseResume({ text: P('accountant.txt'), source: 'text' });
  const { plan } = tailorResume(doc, { jobTitle: 'Senior Accountant', company: 'Acme', jobDescription: 'Requirements:\n- month-end close\n- account reconciliation\n- journal entries\n- NetSuite' });
  assert.ok(!plan.rewrites.some((x) => /^Responsible for/.test(x.from) && /^Handle/.test(x.to)));
});

test('a reorder never puts a line with a number below a line without one, and lists every moved line', () => {
  for (const { name, r } of RUNS) {
    if (!r.tailored) continue;
    for (const c of r.tailored.changes.filter((x) => x.type === 'reorder')) {
      assert.ok(c.moved.length >= 1, name);
      const after = c.after.split('\n');
      for (let i = 0; i < after.length; i++) for (let k = i + 1; k < after.length; k++) {
        const num = (t) => /\d/.test(String(t).replace(/\b(?:19|20)\d{2}\b/g, ''));
        const wasAbove = c.before.split('\n').indexOf(after[k]) < c.before.split('\n').indexOf(after[i]);
        // round 5: a numbered line may sit below a line that is the evidence for a displayed statement (a buried proof line
        // is the cheapest real gain); never below a line that proves nothing
        const upperProves = (c.moved || []).some((m) => m.text === after[i] && (m.statement || m.requirement));
        if (wasAbove && num(after[k]) && !num(after[i]) && !upperProves) assert.fail(`${name}: "${after[k]}" (a number) was put below "${after[i]}"`);
      }
    }
  }
});

test('electrician × a frontend engineering job: blocked, no gap questions, no changes sold, no message', () => {
  const j = { title: 'Senior Frontend Engineer', company: 'Acme Software', description: 'Senior Frontend Engineer\nRequirements:\n- 5+ years building web applications with React and TypeScript\n- Frontend architecture for large single-page apps\n- Experience with GraphQL APIs and design systems\n- Strong CSS and accessibility (WCAG)\nResponsibilities:\n- Lead frontend architecture decisions\n- Mentor engineers on code review' };
  const t = P('electrician.txt');
  const r = buildPaidOptimize({ resume: t, original: t, jobDescription: j.description, job: j.title, company: j.company });
  assert.equal(r.charge.charge, false);
  assert.ok(r.blocked, JSON.stringify(r.field_match));
  assert.deepEqual(r.questions, []);
  assert.equal(r.application_message, '');
  assert.ok(Array.isArray(r.blocked.what_would_change_it) && r.blocked.what_would_change_it.length > 0);
  assert.equal(changeCounts(r).summary, 0);
});

test('gap answers become the person\'s own line — never "Performed <requirement> for […]"', () => {
  const tool = { kind: 'gap', answerKind: 'tool', label: 'Sage Intacct', requirement: 'Sage Intacct' };
  assert.equal(bulletFromAnswer(tool, 'reconciled AP for two clinics in it'), 'Reconciled AP for two clinics in it.');
  assert.equal(bulletFromAnswer(tool, 'for month-end close at Northshore'), 'Used Sage Intacct for month-end close at Northshore.');
  const duty = { kind: 'gap', answerKind: 'activity', label: 'cash handling', requirement: 'cash handling' };
  assert.equal(bulletFromAnswer(duty, 'a $5K drawer every shift at Target'), 'Handled cash: a $5K drawer every shift at Target.');
  assert.equal(bulletFromAnswer({ kind: 'gap', answerKind: 'activity', label: 'care coordination' }, 'with case managers'), '', 'no verb, no "Performed care coordination for…" — asked again');
  assert.equal(bulletFromAnswer({ kind: 'gap', answerKind: 'credential', label: 'CDL Class A' }, 'yes'), 'CDL Class A');
});

test('the summary validator refuses seams, fragments, first person, shouting and debris', () => {
  assert.ok(validateSummary('Kitchen Manager with 8+ years of experience, currently at Hearth & Ember Grill. Experienced in food safety and ordering.').ok);
  for (const bad of ['Southpark location. Experienced in scheduling and inventory.', 'Account Executive with 4+ years. I run full-cycle deals from first call to contract.', 'SOUS CHEF with 3+ years of experience in kitchens.', 'Warehouse lead with 5+ years. Credentials: Forklift certified — renewed |.', 'Nurse with experience (med-surg and step-down units.']) assert.equal(validateSummary(bad).ok, false, bad);
});

test('the charge rule, case by case', () => {
  const ch = (o) => chargeDecision({ jobTitle: 'Staff Accountant', company: 'Acme', ...o });
  const subst = [{ type: 'reorder', default: 'applied', substantive: true }];
  assert.equal(ch({ blocked: { reason: 'hard_gate', sentence: 'They require a CPA licence and your résumé does not show one, so no credit is used.' }, changes: subst }).charge, false);
  assert.equal(ch({ changes: [{ type: 'format', default: 'applied', substantive: false }] }).reason, 'no_change');
  assert.equal(ch({ changes: subst, visibility: { before: { shown: 3, of: 6, labels: ['a', 'b', 'c'] }, after: { shown: 3, of: 6, labels: ['a', 'b', 'c'] } } }).reason, 'no_visible_gain');
  const gain = ch({ changes: subst, visibility: { before: { shown: 2, of: 6, labels: ['month-end close', 'GAAP'] }, after: { shown: 4, of: 6, labels: ['month-end close', 'GAAP', 'journal entries', 'NetSuite'] } } });
  assert.equal(gain.charge, true); assert.match(gain.sentence, /journal entries and NetSuite moved up/);
  // strict: a rewritten summary with nothing more up front is free and says why
  const sum = ch({ changes: [{ type: 'summary', default: 'applied', substantive: true }], visibility: { before: { shown: 2, of: 9, labels: [] }, after: { shown: 2, of: 9, labels: [] } }, summaryDecision: { mode: 'replace', named: ['food safety', 'ordering'], namedBefore: [] } });
  assert.equal(sum.charge, false); assert.equal(sum.reason, 'no_visible_gain');
  assert.match(sum.sentence, /^Your rewritten summary names food safety and ordering, but the same 2 of the 9 things this Staff Accountant posting at Acme lists sit in your first lines as before, so no credit is used\.$/);
});

test('the format item: structured sub-items, the person\'s own headings kept, the contact line in their order', () => {
  const orig = 'Jo Doe\njo@example.com | 555-123-4567 | Joliet, IL\n\nWhat I\'ve done\nPicker — Acme | 2020 – Present\n- Picked 200 orders a shift\n\nSKILLS\nForklift, RF scanner';
  const doc = parseResume({ text: orig, source: 'text' });
  const { plan, variant, fit } = tailorResume(doc, { jobTitle: 'Warehouse Associate', company: 'Acme', jobDescription: 'Warehouse Associate\nRequirements:\n- Forklift experience\n- RF scanner\n- Order picking' });
  const { tailored } = buildTailored({ base: doc, plan, variant, out: fit, original: orig, jobTitle: 'Warehouse Associate', employer: 'Acme', renderText });
  assert.match(tailored.text, /WHAT I'VE DONE/i, tailored.text);
  assert.match(tailored.text, /jo@example\.com \| 555-123-4567 \| Joliet, IL/, 'the contact line keeps the person\'s order');
  const h = tailored.changes.find((c) => c.type === 'heading');
  if (h) { assert.equal(h.default, 'needs_ok'); assert.match(h.why, /Rename "What I've done" to "Experience" — some applicant systems only recognise standard headings/); }
  const f = tailored.changes.find((c) => c.type === 'format');
  if (f) { assert.equal(f.before, ''); assert.equal(f.after, ''); for (const it of f.items) assert.ok(['heading_renamed', 'line_moved', 'lines_joined', 'line_split', 'line_restyled', 'unplaced'].includes(it.kind), it.kind); }
  assert.deepEqual(unlistedDifferences(orig, tailored.text, tailored.changes), []);
  assert.deepEqual(lineDiff('Alpha beta\nGamma delta', 'Gamma delta\nAlpha beta').moved.length, 1);
});

test('round 2: no "Perform/Handle + noun" rewrite; the term swap keeps the person\'s verb and sentence', () => {
  assert.deepEqual(termSwap("Own month-end close for two of the company's four entities: accruals, prepaids", { label: 'month-end close', postingPhrases: ['monthly close'] }), { text: "Own monthly close for two of the company's four entities: accruals, prepaids", from: 'month-end close', to: 'monthly close' });
  assert.equal(termSwap('Prepare balance sheet reconciliations', { label: 'account reconciliation', postingPhrases: ['reconciliations'] }), null, 'already in their words');
  for (const { name, r } of RUNS) for (const rw of r.rewrite_plan || []) {
    assert.ok(!/^(?:Perform|Performed|Handle|Handled|Provide|Provided|Complete|Completed)\b/.test(rw.to) || /^(?:Perform|Handle|Provide|Complete)/i.test(rw.from), `${name}: ${rw.from} → ${rw.to}`);
    if (rw.rules.includes('terminology')) { assert.equal(rw.default, 'needs_ok'); assert.match(rw.why, /^Your line says "[^"]+"; the posting says "[^"]+"/); }
  }
});

test('round 2: a number question aims at one line of the current or most relevant role and places the number in it', () => {
  for (const { name, r } of RUNS) for (const q of (r.questions || []).filter((x) => x.kind === 'metric')) {
    assert.equal(q.unit, 'line', name);
    assert.equal([q.before, q.nounWords, q.after].filter(Boolean).join(' '), q.line, `${name}: the slot splits the person's own line`);
    assert.ok(!/\d/.test(q.line.replace(/\b(?:19|20)\d{2}\b/g, '')), `${name}: the line already has a number: ${q.line}`);
    assert.ok(q.why.includes(q.line.slice(0, 30)), `${name}: the why names the line`);
  }
  const p = { unit: 'line', slot: 'insert', ...numberSlot('Reconcile balance sheet accounts monthly in NetSuite') };
  assert.equal(bulletFromAnswer(p, 'about 14'), 'Reconcile about 14 balance sheet accounts monthly in NetSuite.');
  assert.equal(bulletFromAnswer(p, 'a lot'), '', 'no number, asked again');
});

test('round 2: no availability line for a salaried professional job', () => {
  const r = buildPaidOptimize({ resume: MINE.staffacct, original: MINE.staffacct, job: 'Senior Accountant', company: 'Acme', jobDescription: 'Senior Accountant\nRequirements:\n- 3+ years of accounting experience\n- Month-end close and account reconciliation\n- NetSuite\n- Be available for an occasional, flexible work schedule for after-hours or weekend assignments' });
  assert.equal(r.availability, null);
});

test('round 2: a credential in progress is never shown as held', () => {
  assert.equal(qualifiedProof('CPA', 'CPA EXAM: passed 2 of 4 parts'), true);
  assert.equal(qualifiedProof('CPA', 'Staff Accountant | CPA Candidate'), true);
  assert.equal(qualifiedProof('Excel', 'Excel (advanced: pivot tables, INDEX/MATCH, Power Query)'), false);
  // the verdict reads a credential in progress as not held; the screen keeps the verdict's status and evidence as given (round 6)
  const st = screenStatements({ statements: [{ id: 's1', text: 'CPA required', status: 'not_shown', evidence: [], candidate: { line: 'CPA Candidate (exam 2 of 4)', why: 'in progress' }, importance: 'required', kind: 'requirement' }] });
  assert.equal(st[0].status, 'not_shown');
  assert.deepEqual(st[0].evidence, []);
  assert.deepEqual(st[0].candidate, { line: 'CPA Candidate (exam 2 of 4)', why: 'in progress' });
  const r = buildPaidOptimize({ resume: 'Sample Applicant\nPhoenix, AZ | 480-555-0100 | applicant@example.com\n\nEXPERIENCE\nStaff Accountant, Acme Co - Phoenix, AZ  2021 - present\n- Close the books monthly and reconcile 40 accounts\n\nCERTIFICATIONS\nCPA Candidate (exam 2 of 4)\n', job: 'Senior Accountant', company: 'X', jobDescription: 'Senior Accountant\nRequirements:\n- CPA required\n- 3+ years of accounting experience\n- Month-end close' });
  const cpa = r.statements.find((x) => /CPA/.test(x.text));
  assert.notEqual(cpa.status, 'shown', JSON.stringify(cpa));
});

test('the employer message: built from this posting and résumé, no "match" claim, nothing when blocked', () => {
  for (const { name, r } of RUNS.slice(0, 120)) {
    if (!r.application_message) continue;
    assert.ok(!/match/i.test(r.application_message), `${name}: ${r.application_message}`);
    assert.ok(/\bI\b/.test(r.application_message), name);
  }
  assert.equal(composeApplicationMessage({ out: { matched_requirements: [] }, doc: { experience: [] }, blocked: { reason: 'different_field' } }), '');
});

test('fieldMatch: a title that names the person\'s work is never a different field', () => {
  const doc = parseResume({ text: P('admin.txt'), source: 'text' });
  const out = { verdict: { field_match: { level: 'different', sentence: 'This is a marketing role.' } }, matched_requirements: [], unsupported_requirements: [], fit_score: 20 };
  const fm = fieldMatch(out, { job: { family: 'marketing' }, decisions: doc.experience.map((e) => ({ itemId: e.id, family: 'administrative' })) }, doc, 'Executive Assistant to the Communications and Enterprise Services Executives');
  assert.equal(fm.level, 'adjacent');
});

// ── round 3 ──
test('round 3: a line proving a required tool never lifts above the line proving the core required duty', () => {
  const doc = parseResume({ text: MINE.staffacct, source: 'text' });
  const jd = 'Senior Accountant\nRequirements:\n- Own the month-end close process for multiple entities\n- 3+ years of accounting experience\n- Advanced Excel skills required (pivot tables, lookups)\n- Account reconciliation and journal entries\nPreferred:\n- NetSuite experience';
  const { variant } = tailorResume(doc, { jobTitle: 'Senior Accountant', company: 'Acme', jobDescription: jd });
  const role = variant.experience.find((e) => /Northshore/.test(e.company));
  assert.match(role.bullets[0].text, /^Own month-end close/, role.bullets.map((b) => b.text).join(' | '));
});

test('round 3: a number is asked only where a known measure fits the line\'s object', () => {
  assert.equal(numberSlot('Administered medications including IV push, PCA and heparin drips; monitored response'), null);
  assert.equal(numberSlot('Answered multi-line phones, greeted visitors, sorted mail'), null);
  assert.equal(numberSlot('Reconcile balance sheet accounts monthly in NetSuite').template, 'Reconcile [number] balance sheet accounts monthly in NetSuite');
  assert.equal(numberSlot('Trained new hires on POS').template, 'Trained [number] new hires on POS', 'a count of people is a size, not a rate');
  assert.equal(numberSlot('Do cycle counts and help with the yearly physical inventory').template, 'Do [number] cycle counts [a shift / a week / a month] and help with the yearly physical inventory');
});

test('round 3: an objective sentence that names what this posting offers stays', () => {
  const rn = 'Dana Reyes, RN\nTucson, AZ | dana.reyes@example.com | 520-555-0110\n\nSUMMARY\nRegistered Nurse with 5 years of med-surg and telemetry experience. Looking for a night-shift role where clinical judgment is trusted.\n\nEXPERIENCE\nRegistered Nurse, Telemetry — Banner Health, Tucson, AZ | Jun 2021 – Present\n- Care for 5 telemetry patients per shift on a 30-bed unit\n- Precept new graduate nurses\n\nRegistered Nurse, Med-Surg — Tucson Medical Center | Jun 2019 – May 2021\n- Cared for 6 post-surgical patients per shift\n\nLICENSES\nRN License, Arizona\nBLS, ACLS';
  const r = buildPaidOptimize({ resume: rn, original: rn, job: 'Registered Nurse - Telemetry - Nights', company: 'Acme Hospital', jobDescription: 'Registered Nurse - Telemetry - Nights\nSchedule: Night shift, 7p-7a\nRequirements:\n- Active RN license\n- 2+ years of telemetry experience\n- BLS and ACLS\n- Epic charting' });
  assert.match(r.summary.text, /night-shift role/, r.summary.text);
});

test('strict charge: a summary for a person who had none is free unless more of the posting moves up front', () => {
  const c = chargeDecision({ jobTitle: 'Senior Accountant', changes: [{ type: 'summary', default: 'applied', substantive: true }], visibility: { before: { shown: 1, of: 8, labels: [] }, after: { shown: 1, of: 8, labels: [] } }, summaryDecision: { mode: 'add', named: ['month-end close', 'GAAP'], namedBefore: [] } });
  assert.equal(c.charge, false);
  assert.match(c.sentence, /^The summary this adds names month-end close and GAAP, but the same 1 of the 8 things/);
});

test('round 3: plan + base ship with the result; an answered number completes its own line in place', () => {
  const t = P('warehouse.txt');
  const r = buildPaidOptimize({ resume: t, original: t, job: 'Warehouse Associate', company: 'Acme', jobDescription: 'Warehouse Associate\nRequirements:\n- Cycle counts and inventory control (required)\n- Forklift certification\n- RF scanner and WMS\n- Shipping and receiving' });
  assert.ok(r.tailored.plan && r.tailored.base, 'the screen re-applies through the one apply path');
  const again = applyPlan(JSON.parse(JSON.stringify(r.tailored.base)), JSON.parse(JSON.stringify(r.tailored.plan)), { transferable: true });
  assert.equal(renderText(again), renderText(r.tailored.doc));
  const q = (r.tailored.plan.prompts || []).find((p) => p.unit === 'line');
  if (q) {
    const before = again.experience.find((e) => e.id === q.itemId).bullets.length;
    const ans = q.needsPeriod ? '25 a week' : '25';
    const v = applyPlan(r.tailored.base, r.tailored.plan, { transferable: true, prompts: r.tailored.plan.prompts, answers: { [q.id]: ans } });
    const role = v.experience.find((e) => e.id === q.itemId);
    assert.equal(role.bullets.length, before, 'completed in place, never added twice');
    assert.ok(role.bullets.some((b) => /\b25\b/.test(b.text)));
    if (q.needsPeriod) assert.match(composeLineAnswer(q, '25').problem, /how often/);
  }
});

test('round 3: the screen gets a short headline and a detail line', () => {
  for (const { r } of RUNS.slice(0, 60)) { assert.ok(r.charge.headline && r.charge.headline.length <= 90, r.charge.headline); assert.ok(r.charge.detail); }
});

test('round 3: the visible measure never drops in the default document', () => {
  for (const { name, r } of RUNS) if (r.tailored && !r.tailored.untouched) assert.ok(r.tailored.visibility.after >= r.tailored.visibility.before, `${name}: ${JSON.stringify(r.tailored.visibility)}`);
});

// ── round 4 ──
test('round 4: every question the package emits is answerable — a plain answer yields a line, nonsense yields a reason', () => {
  let asked = 0;
  for (const { name, r } of RUNS) for (const q of r.questions || []) {
    asked++;
    if (q.kind === 'metric') {
      const good = q.needsPeriod ? ['25 a week', 'about 25 a week', '20-30 a shift', '25 per month', '25 weekly'] : ['25', 'about 25', '20-30'];
      for (const g of good) {
        for (const shape of [q, { template: q.template }, { unit: 'line', line: q.line }]) {
          const { line, problem } = composeLineAnswer(shape, g);
          assert.ok(line && !problem, `${name}: "${g}" for ${q.template} (${Object.keys(shape).join(',')}) → ${problem}`);
          assert.ok(/\b(?:25|20-30)\b/.test(line) && /\.$/.test(line), line);
        }
      }
      const bad = composeLineAnswer(q, 'banana');
      assert.equal(bad.line, ''); assert.ok(bad.problem && bad.problem.length > 10);
      if (q.needsPeriod) assert.match(composeLineAnswer(q, '25').problem, /how often/);
    } else if (q.kind === 'gap') {
      const good = q.answerKind === 'credential' ? 'yes' : 'Managed it for 3 clients at my last job';
      const g = composeGapAnswer({ ...q, answerKind: q.answerKind || q.answer_kind }, good);
      assert.ok(g.line && !g.problem, `${name}: gap "${q.question}" → ${g.problem}`);
      const b = composeGapAnswer({ ...q, answerKind: q.answerKind || q.answer_kind }, 'no');
      assert.equal(b.line, ''); assert.ok(b.problem);
    }
  }
  assert.ok(asked > 20, `only ${asked} questions in the run set`);
});

test('round 4: an objective is never the tail of a composed summary (5 real openers)', () => {
  for (const opener of ['Looking for a lead or supervisor role with room to grow.', 'Seeking a warehouse lead position in Joliet.', 'To obtain a full-time warehouse position with a growing company.', 'Hoping to join a team where I can grow into a supervisor.', 'Objective: a stable warehouse job with benefits.']) {
    const t = P('warehouse.txt').replace(/Hard working and dependable warehouse professional looking for a lead or supervisor role with room to grow\./, `Hard worker. ${opener}`);
    const r = buildPaidOptimize({ resume: t, original: t, job: 'Warehouse Associate', company: 'Acme', jobDescription: 'Warehouse Associate\nRequirements:\n- Forklift and pallet jack experience\n- RF scanner and WMS\n- Inventory control and cycle counts\n- Shipping and receiving' });
    if (r.summary && !r.summary.kept) assert.ok(!r.summary.text.split(/(?<=[.!?])\s+/).some((x) => /looking for|seeking|to obtain|hoping to join|objective:/i.test(x)), `${opener} → ${r.summary.text}`);
  }
});

test('round 4: what would change a block is one to three whole sentences, US spelling', () => {
  for (const { name, r } of RUNS) if (r.blocked) {
    const w = r.blocked.what_would_change_it;
    assert.ok(w.length >= 1 && w.length <= 3, name);
    for (const x of w) { assert.match(x, /^[A-Z"].*[.!?"]$/, `${name}: ${x}`); assert.ok(x.split(/\s+/).length >= 4, x); assert.ok(!/licence/i.test(x), x); }
    assert.ok(!/licence/i.test(r.blocked.sentence), r.blocked.sentence);
  }
  assert.deepEqual(gateSentences({ kind: 'license', label: 'Texas journeyman or master electrical license' }, { certifications: [{ text: 'Arizona Journeyman Electrician License (ROC), 2019' }], skills: [] }, {}), ['This posting requires a Texas journeyman or master electrical license.', 'Your résumé lists "Arizona Journeyman Electrician License (ROC), 2019".']);
  assert.equal(usSpelling('a valid state licence'), 'a valid state license');
});

// ── round 5: the first-read planner ──
test('round 5: a buried proof line in the first role moves into the first read; the charge is the measured gain', () => {
  const t = P('nurse.txt');
  const jd = 'Registered Nurse - Telemetry\nResponsibilities:\n- Provide direct patient care for telemetry patients\n- Document care accurately and timely in the EMR\n- Educate patients and families on discharge instructions\nRequirements:\n- Active RN license\n- BLS and ACLS\n- 1+ years of acute care experience';
  const r = buildPaidOptimize({ resume: t, original: t, job: 'Registered Nurse - Telemetry', company: 'Acme Hospital', jobDescription: jd });
  const v = r.tailored.visibility;
  assert.ok(v.after >= v.before, JSON.stringify(v));
  if (r.charge.charge) { assert.ok(v.after > v.before); assert.match(r.charge.headline, /^\d+ of the \d+ things this posting lists are now in your first lines; before, \d+ (?:was|were)\.$/); }
  const top = firstRead(r.tailored.doc);
  assert.ok(top.some((l) => /Epic|Educate patients/.test(l)), top.join(' | '));
  for (const c of r.tailored.changes.filter((x) => x.type === 'reorder' && /^Moved up/.test(x.why))) assert.match(c.why, /^Moved up: ".+" — it shows ".+", which this posting lists/);
});

test('round 5: the planner never makes the first read worse and never moves a line across roles', () => {
  for (const { name, r } of RUNS) {
    if (!r.tailored || r.tailored.untouched) continue;
    assert.ok(r.tailored.visibility.after >= r.tailored.visibility.before, name);
    for (const c of r.tailored.changes.filter((x) => x.type === 'reorder')) assert.deepEqual(c.before.split('\n').sort(), c.after.split('\n').sort(), `${name}: same lines, same role`);
  }
});

// ── round 6 (director's worked pair: a shift supervisor × a fast-casual Shift Lead posting) ──
const SHIFT_RESUME = `Sample Applicant
Mesa AZ | 480-555-0100 | applicant@example.com

EXPERIENCE

Shift Supervisor, Dutch Bros Coffee - Mesa, AZ   2022 - present
- Run the afternoon shift, 6 to 8 broistas, on a double drive thru doing 900+ cars on a busy day
- Count the drawers and do the nightly deposit, usually under $3 variance
- Train every new hire on bar, window and the POS (Toast)
- Weekly order for milk, cups and syrups, cut waste about 15% by changing pars
- handle customer complaints and remakes

Barista, Dutch Bros Coffee   2020 - 2022
- Window and bar, memorized 60+ drink recipes
- Promoted to trainer after 8 months

Cashier, Fry's Food Stores, Mesa   2018-2020
- Register and self checkout, WIC and EBT transactions
- Front end employee of the month twice

EDUCATION
Mesa Community College - some coursework toward A.A. Business, 2019-2020
Dobson High School 2018

SKILLS
Toast POS, cash handling, scheduling (HotSchedules), inventory, Spanish (fluent), food handlers card (Maricopa County)`;
const SHIFT_POSTING = `Shift Lead — Copper Kettle Kitchen (fast casual), Tempe, AZ
$19–$22/hour plus tips

About the role
Our Shift Leads run the restaurant when a manager is not in the building. You will lead a crew of 5–10 through lunch or dinner service, keep the line moving and make sure every guest leaves happy.

What you'll do
- Run the shift: assign stations, call breaks and keep ticket times under 6 minutes
- Train new team members on each station and coach the crew during service
- Open or close the restaurant using our checklists, including counting the safe and drawers and making the bank deposit
- Place the daily food and paper order and keep pars up to date to control waste
- Help with weekly inventory counts
- Resolve guest complaints on the spot and remake orders when we get it wrong
- Follow county health code and our food safety standards; keep the line inspection-ready
- Operate the POS and troubleshoot online and delivery orders
- Step in on any station (grill, line, register) when the crew needs it

What you bring
- 1+ year of experience leading a shift or crew in a restaurant, coffee shop or other food service setting
- Food handler card (or ability to get one within 30 days); ServSafe Manager certification a plus
- Cash handling experience
- Comfortable with a POS system; Toast experience preferred
- Able to work nights, weekends and holidays
- Able to stand for a full shift and lift 40 pounds
- Bilingual English/Spanish is a plus
- High school diploma or GED
- Strong communication skills and a calm head when it gets busy`;
let _shift = null;
const shiftPkg = () => (_shift ||= buildPaidOptimize({ resume: SHIFT_RESUME, jobDescription: SHIFT_POSTING, job: 'Shift Lead', company: 'Copper Kettle Kitchen' }));

test('round 6: a tense rewrite changes ONE verb, and only a word used as a verb (object test)', () => {
  assert.equal(tenseRewriteOk('Register and self checkout, WIC and EBT transactions', 'Registered and self checkout, WIC and EBT transactions'), false);
  assert.equal(tenseRewriteOk('Front end employee of the month twice', 'Fronted end employee of the month twice'), false);
  assert.equal(tenseRewriteOk('Window and bar, memorized 60+ drink recipes', 'Windowed and bar, memorized 60+ drink recipes'), false);
  assert.equal(tenseRewriteOk('Train every new hire on bar', 'Trained every new hire on bar'), true);
  assert.equal(tenseRewriteOk('Train every new hire on bar', 'Trained each new hire on bar'), false, 'a second word changed');
  // no proposed change on the worked pair turns a noun into a verb
  for (const c of shiftPkg().tailored.changes) {
    const b = String(c.before || ''), a = String(c.after || '');
    const bw = b.split(/\s+/), aw = a.split(/\s+/);
    if (b && a && bw.length === aw.length && bw[0] !== aw[0] && bw.slice(1).join(' ') === aw.slice(1).join(' ')) assert.ok(tenseRewriteOk(b, a), `${b} → ${a}`);
  }
});

test('round 6: the summary is built from the person\'s strongest lines — no "skilled in", their casing, a why that counts', () => {
  const r = shiftPkg();
  const s = r.summary && r.summary.text;
  assert.ok(s, 'a summary over no summary');
  assert.doesNotMatch(s, /\b(?:skilled in|experienced in|proven|dependable|results-driven|hard-working)\b/i);
  assert.match(s, /Toast/); assert.doesNotMatch(s, /\btoast\b/);
  assert.match(s, /^Shift Supervisor at Dutch Bros Coffee/);
  assert.match(r.summary.why, /built from your own lines/);
  assert.match(r.summary.why, /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) of the first \w+ things they list/);
});

test('round 6: unfinished study is one phrase, and a location is never copied to another role', () => {
  const r = shiftPkg();
  assert.match(r.tailored.text, /Coursework toward A\.A\. Business/);
  assert.doesNotMatch(r.tailored.text, /A\.A\.,\s*Business/);
  const barista = r.tailored.doc.experience.find((e) => /Barista/.test(e.title));
  assert.ok(barista && !barista.location, 'the Barista line named no place');
});

test('round 6: a heading is never joined into a line, and only real changes are listed', () => {
  const r = shiftPkg();
  const fmt = r.tailored.changes.find((c) => c.type === 'format');
  for (const it of (fmt && fmt.items) || []) {
    assert.notEqual(it.kind, 'lines_joined', JSON.stringify(it));
    if (it.before !== undefined && it.after !== undefined) assert.notEqual(it.before, it.after);
  }
  assert.equal(unlistedDifferences(r.tailored).length, 0);
});

test('round 6: a strong fit hears what is already right and is asked about the true gaps; each answer becomes a line', () => {
  const r = shiftPkg();
  assert.ok(r.already_right && r.already_right.count === r.tailored.visibility.before && r.already_right.items.length >= 3);
  assert.match(r.already_right.sentence, /^Already right: /);
  for (const it of r.already_right.items) assert.doesNotMatch(it.line, /^[•\-*]/);
  const byFacet = Object.fromEntries(r.questions.filter((q) => q.kind === 'detail').map((q) => [q.facet, q]));
  assert.match(byFacet.service_time.question, /ticket or wait times at Dutch Bros Coffee/);
  assert.equal(byFacet.open_close.question, 'Do you open as well as close?');
  assert.equal(byFacet.inventory_count.question, 'Do you count inventory, or only place the order? How often?');
  const line = (q, a) => bulletFromAnswer({ ...q, label: q.label }, a);
  assert.equal(line(byFacet.service_time, 'under 4 minutes'), 'Keep ticket times under 4 minutes.');
  assert.equal(line(byFacet.service_time, 'yes'), '', 'no time, no line');
  assert.equal(composeDetailAnswer(byFacet.service_time, 'yes').problem.startsWith('Type the time'), true);
  assert.equal(line(byFacet.open_close, 'yes'), 'Run both opening and closing shifts.');
  assert.equal(line(byFacet.open_close, 'no, only close'), '');
  assert.equal(line(byFacet.inventory_count, 'yes'), '', 'how often is theirs to say — never the posting\'s "weekly"');
  assert.equal(line(byFacet.inventory_count, 'yes, weekly'), 'Count inventory weekly.');
  assert.equal(line(byFacet.inventory_count, 'only the order'), '');
  // a detail question is never also asked as a generic gap question on the same statement
  const ids = r.questions.map((q) => q.statementId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  // nothing asked about a detail a line already shows
  const already = detailQuestions(parseResume({ text: SHIFT_RESUME.replace('handle customer complaints and remakes', 'Open the store and close it, keep ticket times near 3 minutes, count inventory weekly'), source: 'text' }), r.statements, { company: 'x' });
  assert.ok(!already.some((q) => ['service_time', 'open_close', 'inventory_count'].includes(q.facet)), JSON.stringify(already.map((q) => q.facet)));
});
