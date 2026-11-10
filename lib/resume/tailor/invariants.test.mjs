// Invariants of the v6 Tailor (director's package T1, 2026-11-10), run over EVERY persona résumé × EVERY posting of the
// shared sample (lib/fixtures/personas/*.txt × postings-sample.json) and the judges' worst cases (studio.md,
// optimize.md). Each one is a promise the paid "tailored résumé" makes:
//   1. the fit never drops;
//   2. nothing is cut inside the page budget, and a line that proves a requirement is never cut while a line that
//      proves nothing is still on the page;
//   3. "most recently at X" names the latest-ending role (never a gap note, never "<Title> at <Title> at");
//   4. every content word of every default-applied change is grounded (ADDENDUM rule 2);
//   5. every answer template renders without doubled words or brackets, or refuses;
//   6. the plan re-applied in the browser (JSON round trip) is the server's document;
//   7. charged ⇒ a substantive default-applied change and no lower fit.
// Run: node --test lib/resume/tailor/invariants.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseResume } from '../parse/index.js';
import { serializeToText } from '../model.js';
import { tailorResume, applyPlan } from './tailor.js';
import { passesFirewall } from '../rewrite/rules.js';
import { rewriteBullet } from '../rewrite/rules.js';
import { bulletFromAnswer, ANSWER_TEMPLATES, answerPreview, askableGap } from './questions.js';
import { latestRole, JOB_SEARCH_RE } from './summary.js';
import { postingFormRewrite, polishLead, NEUTRAL_VERBS } from './rewrites.js';
import { stemsCovered, isGapNote } from './verdict.js';
import { tailorCharge } from '../../../api/resume.js';
import { buildTailored } from './paid.js';
import { renderText } from '../render/text.js';
import { pastTense } from '../rewrite/inflect.js';

const DIR = new URL('../../fixtures/personas/', import.meta.url);
const PERSONAS = fs.readdirSync(DIR).filter((f) => f.endsWith('.txt') && !f.includes('-jd'));
const POSTINGS = JSON.parse(fs.readFileSync(new URL('postings-sample.json', DIR), 'utf8'));
const NOW = new Date('2026-11-10T00:00:00Z');
const RUNS = [];
for (const f of PERSONAS) {
  const doc = parseResume({ text: fs.readFileSync(new URL(f, DIR), 'utf8'), source: 'text' });
  for (const p of POSTINGS) {
    const { plan, variant, fit } = tailorResume(doc, { jobTitle: p.title, company: p.company, jobDescription: p.description, now: NOW });
    RUNS.push({ name: `${f} × ${p.id}`, doc, p, plan, variant, fit });
  }
}
const NEUTRAL = NEUTRAL_VERBS.flatMap((v) => [v, pastTense(v)]).concat(['serve', 'served', 'as', 'in']);

test(`1. the fit never drops (${RUNS.length} runs)`, () => {
  for (const r of RUNS) if (r.plan.score.before != null && r.plan.score.after != null) assert.ok(r.plan.score.after >= r.plan.score.before, `${r.name}: ${r.plan.score.before} → ${r.plan.score.after}`);
});

test('2. inside the budget nothing is cut; an evidence line is never cut while a non-evidence line stays', () => {
  for (const r of RUNS) {
    const cutIds = new Set((r.plan.cuts || []).map((c) => c.bulletId));
    for (const e of r.doc.experience) {
      const ve = r.variant.experience.find((x) => x.id === e.id);
      assert.ok(ve, `${r.name}: role "${e.title}" left the page`);
      for (const b of e.bullets) if (!ve.bullets.some((x) => x.id === b.id)) assert.ok(cutIds.has(b.id), `${r.name}: "${b.text}" vanished without a cut entry`);
    }
    if ((r.plan.cuts || []).some((c) => c.evidence)) {
      const keptPlain = r.plan.decisions.flatMap((d) => (d.keptBullets.length > 1 ? d.keptBullets : [])).filter((id) => !((r.plan.decisions.find((d) => d.keptBullets.includes(id)) || {}).ranked || []).find((x) => x.bulletId === id)?.proves?.length);
      assert.equal(keptPlain.length, 0, `${r.name}: an evidence line was cut while ${keptPlain.length} plain lines stayed`);
    }
  }
});

test('3. "most recently" is the latest-ending role; never "<Title> at <Title> at"; no job-hunting line; no pasted bullet', () => {
  for (const r of RUNS) {
    const s = r.variant.basics.summary || '';
    assert.ok(!/\bStrengths in\b/.test(s), `${r.name}: ${s}`);
    assert.ok(!s.split(/(?<=[.!?])\s+/).some((x) => JOB_SEARCH_RE.test(x)), `${r.name}: ${s}`);
    assert.ok(!/\bat [^.,]+ at [^.,]+ at\b/.test(s), `${r.name}: ${s}`);
    if (r.plan.summaryDecision.mode === 'replace' || r.plan.summaryDecision.mode === 'add') {
      for (const e of r.doc.experience) for (const b of e.bullets) assert.ok(!s.includes(b.text.replace(/[.]$/, '')), `${r.name}: pasted "${b.text}"`);
      const m = s.match(/most recently (?:([^.]+?) )?at ([^.,]+)/);
      if (m) {
        const latest = latestRole(r.doc, { roleWeight: new Map() });
        const ends = (e) => (e.end === 'present' || (!e.end && e.start) ? '9999' : String(e.end || ''));
        const named = r.doc.experience.find((e) => !isGapNote(e) && e.company && m[2].startsWith(e.company.replace(/\s*\([^)]*\)/g, '').replace(/,.*$/, '').trim()));
        assert.ok(named, `${r.name}: "${m[2]}" is no employer`);
        assert.equal(ends(named).slice(0, 4), ends(latest).slice(0, 4), `${r.name}: most recently ${m[2]} but the latest-ending role is ${latest.company}`);
      }
    }
  }
});

test('4. every content word of every default-applied change is grounded (rule 2)', () => {
  for (const r of RUNS) {
    const baseText = serializeToText(r.doc);
    for (const rw of r.plan.rewrites || []) {
      const allowed = [...NEUTRAL, ...String(rw.requirement || '').toLowerCase().split(/\s+/)];
      assert.ok(passesFirewall(rw.from, rw.to, allowed).ok, `${r.name}: "${rw.from}" → "${rw.to}"`);
      if (rw.rules.includes('posting_form')) assert.ok(stemsCovered(rw.requirement, rw.from), `${r.name}: the line never proved "${rw.requirement}"`);
    }
    for (const a of r.plan.skills.additions || []) assert.ok(new RegExp(a.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(baseText), `${r.name}: skill "${a.term}" is not in the résumé`);
    if (['replace', 'add'].includes(r.plan.summaryDecision.mode)) {
      const vocab = [baseText, ...r.plan.summaryDecision.named].join('\n');
      assert.ok(passesFirewall(vocab, r.variant.basics.summary, ['with', 'years', 'of', 'experience', 'most', 'recently', 'at', 'experienced', 'in', 'and', 'credentials', 'currently', 'since', 'until', 'holds', 'skilled', 'work', 'includes', 'brings', 'student', 'graduating']).ok, `${r.name}: ${r.variant.basics.summary}`);
    }
    // a number in the tailored document is a number in the base
    const nums = (t) => new Set((t.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]$/, '')));
    const have = nums(baseText);
    // (the summary's "N+ years" is computed from the dated roles — lib/resume/years.js — not a new fact)
    const yearsFig = ((r.variant.basics.summary || '').match(/\b(\d+)\+ years\b/) || [])[1];
    for (const n of nums(serializeToText(r.variant))) if (n !== yearsFig) assert.ok(have.has(n), `${r.name}: new number ${n}`);
  }
});

test('5. every answer template renders grammatical text or refuses — never doubled words, brackets or "Delivered yes"', () => {
  const answers = ['5', '5 a day', 'about 50', '12 residents', '150 orders per shift', 'yes', 'yes, 98%', '98%', '4.6/5', '$40K', '3 years', 'no', 'Cut close time from 10 days to 6'];
  for (const unit of Object.keys(ANSWER_TEMPLATES)) {
    assert.ok(answerPreview({ unit }), unit);
    for (const a of answers) {
      const line = bulletFromAnswer({ unit }, a);
      if (!line) continue;
      assert.ok(!/\b(\w+)\s+\1\b/i.test(line), `${unit} × "${a}" → "${line}"`);
      assert.ok(!/[[\]]/.test(line), `${unit} × "${a}" → "${line}"`);
      assert.ok(!/\b(?:yes|no)\b/i.test(line), `${unit} × "${a}" → "${line}"`);
      assert.match(line, /^[A-Z].*\.$/);
    }
  }
  // the judges' exact broken outputs
  assert.equal(bulletFromAnswer({ unit: 'patients per shift' }, '5-6 patients on a 36-bed med-surg unit'), 'Cared for 5-6 patients per shift on a 36-bed med-surg unit.');
  assert.equal(bulletFromAnswer({ unit: 'orders per shift' }, '150 orders'), 'Picked and packed 150 orders per shift.');
  assert.equal(bulletFromAnswer({ unit: 'customers per shift' }, '70 calls'), 'Handled 70 calls per shift.');
  assert.equal(bulletFromAnswer({ unit: 'safety record' }, '200'), '', 'no duration → asked again, never "Maintained 200."');
  assert.equal(bulletFromAnswer({ unit: 'scan accuracy' }, 'yes, 98%'), 'Maintained 98% scan accuracy.');
  for (const kind of ['tool', 'activity', 'knowledge']) for (const a of ['yes', 'for a 6-dentist practice', 'tracking patient appointments']) {
    const line = bulletFromAnswer({ kind: 'gap', answerKind: kind, label: kind === 'tool' ? 'Dentrix' : kind === 'activity' ? 'insurance billing' : 'medical terminology' }, a);
    if (line) assert.ok(!/\b(\w+)\s+\1\b|\bto for\b|\bfor for\b|\bin for\b/i.test(line), line);
  }
  // questions are only asked about real gaps: never a reader fragment, a shouted word or the company's initials
  for (const label of ['NOW', 'CMD', 'NMH', 'OBE', 'less than 1', 'Trauma unit gain incredible', 'senior individual', 'programs used', 'education reflecting', 'up keyword targeting', 'confidentiality', 'within cross-functional marketing']) assert.equal(askableGap({ label, importance: 'required' }), false, label);
  assert.equal(askableGap({ label: 'HIPAA', importance: 'required' }), true);
  assert.equal(askableGap({ label: 'insurance billing', importance: 'required' }, 'Handled insurance billing for 3 clinics'), false, 'the résumé shows it — never asked');
});

test('6. server plan == client apply: the JSON plan re-applied gives the same document', () => {
  for (const r of RUNS) {
    const wire = JSON.parse(JSON.stringify({ ...r.plan, rankedById: undefined }));
    const again = applyPlan(r.doc, wire, { transferable: true });
    assert.equal(serializeToText(again), serializeToText(r.variant), r.name);
  }
});

test('7. charged ⇒ a substantive default-applied change and no lower fit; kept-as-is ⇒ free', () => {
  for (const r of RUNS) {
    const { tailored } = buildTailored({ base: r.doc, plan: r.plan, variant: r.variant, out: r.fit, jobTitle: r.p.title, employer: r.p.company, renderText });
    const rule = tailorCharge(tailored);
    if (rule.charge) {
      assert.ok(tailored.changes.some((c) => c.default === 'applied' && c.substantive), r.name);
      assert.ok(r.plan.score.after == null || r.plan.score.after >= r.plan.score.before, r.name);
      assert.equal(tailored.kept_as_is, null);
    } else assert.match(rule.note, /no credit (?:was|is) used/i, r.name);
    for (const c of r.plan.changes) assert.ok(c.why && !/\bterm:|_v\d|undefined|null/.test(c.why), `${r.name}: ${c.why}`);
  }
});

test('judges\' cases: noun-led and participle lines are never re-tensed; polish never inflates', () => {
  assert.equal(rewriteBullet('Wound care for 20+ patients a day across 2 units', { tense: 'present' }).text, 'Wound care for 20+ patients a day across 2 units.');
  assert.match(rewriteBullet('Completed medication reconciliation for new admits, documented in HCHB', { tense: 'present' }).text, /, documented in HCHB\.$/);
  // round 2: "Responsible for …" is left as written (an added "Handle" is not clearly better)
  assert.equal(polishLead('Responsible for month-end close for 3 entities', 'present'), null);
  // a role named without a verb is a fine line as written: no "Served as" put in the person's mouth (T3)
  assert.equal(polishLead('Charge nurse 1-2 shifts per month', 'present'), null);
  assert.equal(polishLead('Use Epic for charting', 'present').text, 'Chart in Epic.');
  assert.equal(polishLead('Worked with clients to resolve audit adjustments', 'past'), null, 'never "Audited clients…"');
  // the posting's form only from the line's own stems — never a new object ("idempotent webhook")
  assert.equal(postingFormRewrite('Scheduled patients and handled insurance verification', 'patient scheduling'), 'Performed patient scheduling and handled insurance verification.');
  assert.equal(postingFormRewrite('Managed complex calendar and travel for CFO and 2 VPs', 'calendar management'), null, '"calendar and travel" is one coordinated object');
  assert.equal(postingFormRewrite('Built idempotent payment-orchestration APIs (gRPC/REST) across Stripe', 'idempotent webhook'), null);
  assert.equal(postingFormRewrite('Read blueprints and schematics to lay out panel schedules', 'blueprint reading'), null, 'a coordinated object is never split');
});
