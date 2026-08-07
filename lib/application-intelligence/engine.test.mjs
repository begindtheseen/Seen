// Tests for Application Intelligence V2 — the local, keyless résumé strategist.
// Run: node --test lib/application-intelligence/engine.test.mjs
//
// Locks the non-negotiables: no external AI/API in the core, determinism, evidence-grounded
// output, transferable-experience intelligence, ATS coverage detection, structured parsing,
// no generic bullets, and interview-defense overclaim warnings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildApplicationPackage } from './index.js';
import { parseResumeV2 } from './resumeParserV2.js';
import { parseJobV2 } from './jobParserV2.js';
import { checkInterviewDefense } from './interviewDefense.js';
import { skillRelation, openRelation, hasWord } from './skillGraph.js';
import { detectRoleFamily } from './roleOntology.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const VALET = `Jane Doe
Summary
Reliable, guest-focused worker.
Experience
Valet Attendant, Grand Hotel  01/2022 - Present
- Parked and retrieved 60+ guest vehicles during busy arrival windows
- Greeted guests and handled key control and ticketing
- Coordinated with the front desk during peak rushes
Skills
guest service, vehicle handling, cash handling`;

const DELIVERY = `Mike Ruiz
Experience
Delivery Driver, QuickShip  03/2021 - Present
- Completed 120+ stops per shift with a 98% on-time rate
- Planned daily routes and scanned every package
Skills
route planning, time management, customer delivery`;

const FASTFOOD = `Ana Cruz
Experience
Crew Member, BurgerCo  2020 - 2022
- Served 200+ customers during lunch rushes on the register
- Followed food safety and sanitation standards
Skills
customer service, pos, food safety, teamwork`;

const INTAKE = `Dana Lee
Experience
Intake Specialist, City Clinic  2019 - Present
- Processed 50+ patient intake forms per day
- Documented records accurately in the EHR
Skills
data entry, customer intake, scheduling, documentation`;

const CS_JOB = `Customer Service Representative. Required: strong customer service and communication. Must handle high volume. Point of sale experience preferred. Reliability is essential.`;

// ── Non-negotiable #1: no external AI / API anywhere in the engine ────────────────────────
test('core engine has NO external AI/API calls (static guarantee)', () => {
  const files = readdirSync(HERE).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 8, 'engine has its modules');
  const forbidden = /\bfetch\s*\(|anthropic|openai|https?:\/\/api\.|x-api-key|require\(['"]https?/i;
  for (const f of files) {
    const src = readFileSync(join(HERE, f), 'utf8');
    assert.doesNotMatch(src, forbidden, `${f} must not call any external AI/API`);
  }
});

// ── Determinism ───────────────────────────────────────────────────────────────────────────
test('same input returns the same output (deterministic)', () => {
  const a = buildApplicationPackage({ resumeText: VALET, jobDescription: CS_JOB, jobTitle: 'Customer Service Representative' });
  const b = buildApplicationPackage({ resumeText: VALET, jobDescription: CS_JOB, jobTitle: 'Customer Service Representative' });
  assert.deepEqual(a, b);
});

// ── Regression: match evidence is ALWAYS an array of non-empty strings ─────────────────────
// A match built from an evidence node with a missing evidenceText once produced evidence:[undefined],
// which the Deep Dive UI rendered with .slice() and crashed the whole page ("Application error").
// Lock evidence to clean strings at the engine so the UI can never receive a non-string here.
test('every match evidence entry is a non-empty string (no undefined/objects)', () => {
  const cases = [
    { resumeText: VALET, jobTitle: 'Customer Service Representative' },
    { resumeText: DELIVERY, jobTitle: 'Logistics Associate' },
    { resumeText: FASTFOOD, jobTitle: 'Cashier' },
    { resumeText: INTAKE, jobTitle: 'Front Desk' },
  ];
  for (const { resumeText, jobTitle } of cases) {
    const p = buildApplicationPackage({ resumeText, jobDescription: CS_JOB, jobTitle });
    const allMatches = [
      ...p.why_you_match, ...p.transferable_proof, ...p.weak_matches,
      ...p.missing_recoverable, ...p.missing_risky,
    ];
    for (const m of allMatches) {
      assert.ok(Array.isArray(m.evidence), `evidence is an array for "${m.requirement}"`);
      for (const e of m.evidence) {
        assert.equal(typeof e, 'string', `evidence entry is a string for "${m.requirement}"`);
        assert.ok(e.length > 0, `evidence entry is non-empty for "${m.requirement}"`);
      }
    }
  }
});

// ── Regression: bullet warnings reach the client as strings, never {code,severity,message} objects ──
// checkInterviewDefense returns warning OBJECTS; if pubBullet forwarded them raw, the Deep Dive panel
// rendered {warning} directly and threw "Objects are not valid as a React child", crashing the section.
test('bullet warnings are flattened to human-readable strings (Deep Dive render-safety)', () => {
  // The raw engine shape IS objects with a string .message — which is exactly why pubBullet must flatten.
  const icResume = parseResumeV2(FASTFOOD);
  const raw = checkInterviewDefense('Managed a team of 20 associates and owned the strategy roadmap', { resume: icResume, family: 'customer_service' });
  assert.ok(raw.length > 0, 'checkInterviewDefense produced at least one warning');
  assert.equal(typeof raw[0], 'object', 'raw warnings are objects');
  assert.equal(typeof raw[0].message, 'string', 'raw warning carries a string message');
  // The PUBLIC package must never expose a non-string warning on ANY bullet bucket.
  for (const resumeText of [VALET, DELIVERY, FASTFOOD, INTAKE]) {
    const p = buildApplicationPackage({ resumeText, jobDescription: CS_JOB, jobTitle: 'Customer Service Representative' });
    for (const bucket of ['safe_bullets', 'needs_confirmation', 'not_recommended', 'unsupported']) {
      for (const b of (p[bucket] || [])) {
        for (const w of (b.warnings || [])) {
          assert.equal(typeof w, 'string', `${bucket} warning must be a string, not an object`);
        }
      }
    }
  }
});

// ── Transferable-experience intelligence (the marquee feature) ────────────────────────────
test('valet → customer service / hospitality / logistics transferable proof', () => {
  const p = buildApplicationPackage({ resumeText: VALET, jobDescription: CS_JOB, jobTitle: 'Customer Service Representative' });
  const matches = Object.fromEntries([...p.why_you_match, ...p.transferable_proof].map(m => [m.requirement, m.matchType]));
  assert.equal(p.resume_summary.roles[0].family, 'valet_parking', 'valet role family detected');
  assert.equal(matches['customer service'], 'exact');
  // reliability comes from valet family transferable proof
  const rel = p.transferable_proof.find(m => m.requirement === 'reliability');
  assert.ok(rel, 'reliability surfaced as transferable');
  assert.match(rel.explanation, /valet/i, 'explanation names the transferable source');
});

test('delivery → logistics / time management / customer delivery', () => {
  const p = buildApplicationPackage({ resumeText: DELIVERY, jobDescription: 'Logistics Associate. Required: logistics, route planning, time management. Safety essential.', jobTitle: 'Logistics Associate' });
  const m = Object.fromEntries([...p.why_you_match, ...p.transferable_proof].map(x => [x.requirement, x.matchType]));
  assert.ok(['exact', 'adjacent', 'transferable'].includes(m['logistics']));
  assert.equal(m['time management'], 'exact');
  assert.equal(m['route planning'], 'exact');
});

test('fast food → customer service / POS / food safety / teamwork', () => {
  const p = buildApplicationPackage({ resumeText: FASTFOOD, jobDescription: 'Cashier. Required: customer service, point of sale, cash handling. Food safety a plus.', jobTitle: 'Cashier' });
  const m = Object.fromEntries([...p.why_you_match, ...p.transferable_proof].map(x => [x.requirement, x.matchType]));
  assert.equal(m['customer service'], 'exact');
  assert.equal(m['point of sale'], 'exact');
  assert.ok(['exact', 'adjacent'].includes(m['cash handling']));
});

test('intake specialist → data entry / customer intake / documentation', () => {
  const p = buildApplicationPackage({ resumeText: INTAKE, jobDescription: 'Administrative Assistant. Required: data entry, scheduling, documentation. Customer intake preferred.', jobTitle: 'Administrative Assistant' });
  const m = Object.fromEntries([...p.why_you_match, ...p.transferable_proof].map(x => [x.requirement, x.matchType]));
  assert.equal(m['data entry'], 'exact');
  assert.equal(m['documentation'], 'exact');
  assert.ok(['exact', 'transferable', 'adjacent'].includes(m['customer intake']));
});

test('skill graph knows guest service == customer service and cash handling ~ point of sale', () => {
  assert.equal(skillRelation('guest service', 'customer service').relation, 'exact');
  assert.equal(skillRelation('cash handling', 'point of sale').relation, 'adjacent');
});

// ── Structured parsing ────────────────────────────────────────────────────────────────────
test('résumé parser associates bullets with their role', () => {
  const r = parseResumeV2(VALET);
  assert.equal(r.roles.length, 1);
  const role = r.roles[0];
  assert.equal(role.family, 'valet_parking');
  assert.ok(role.bullets.length >= 3, 'bullets attached to the role');
  assert.equal(role.current, true, 'detected current role from "Present"');
  // a metric node with a "+"-style number is captured
  assert.ok(role.nodes.some(n => n.type === 'metric' && /60/.test(n.value)), 'captures "60+ ... vehicles" metric');
});

test('job parser separates required vs preferred vs responsibility', () => {
  const j = parseJobV2('Required: customer service. Point of sale preferred. You will greet customers and answer phones.', { jobTitle: 'CSR' });
  const byImp = {};
  for (const req of j.requirements) (byImp[req.importance] ||= []).push(req.normalizedLabel);
  assert.ok((byImp.required || []).includes('customer service'), 'required detected');
  assert.ok((byImp.preferred || []).includes('point of sale'), 'preferred detected');
  assert.ok(j.requirements.some(r => r.importance === 'responsibility'), 'responsibility detected');
});

// ── ATS simulation ────────────────────────────────────────────────────────────────────────
test('ATS simulator detects a missing hard keyword', () => {
  const resumeNoForklift = `Warehouse Associate, Acme  2021-2023\n- Picked and packed 100+ orders per shift\nSkills\ninventory, shipping`;
  const p = buildApplicationPackage({ resumeText: resumeNoForklift, jobDescription: 'Required: forklift certification. Required: inventory. Required: shipping.', jobTitle: 'Warehouse Associate' });
  assert.ok(p.ats.missing_exact_keywords.includes('forklift'), 'forklift flagged missing');
  assert.match(p.ats.disclaimer, /does not predict/i, 'honest about not predicting real ATS');
});

// ── Bullet compiler quality + safety ──────────────────────────────────────────────────────
test('bullet compiler never emits generic "deliver results" templates', () => {
  for (const r of [VALET, DELIVERY, FASTFOOD, INTAKE]) {
    const p = buildApplicationPackage({ resumeText: r, jobDescription: CS_JOB, jobTitle: 'Customer Service Representative' });
    for (const b of [...p.safe_bullets, ...p.needs_confirmation]) {
      assert.doesNotMatch(b.text, /deliver results|leveraged|utilized|proven track record|results-driven/i, `generic phrase in: ${b.text}`);
    }
  }
});

test('safe bullets are grounded — rewrites use a real résumé span; none carry an unproven metric', () => {
  const p = buildApplicationPackage({ resumeText: VALET, jobDescription: CS_JOB, jobTitle: 'Customer Service Representative' });
  for (const b of p.safe_bullets) {
    assert.notEqual(b.classification, 'unsupported');
    assert.ok(!b.warnings.some(w => w.code === 'unconfirmed_metric'), 'no unproven metric in a safe bullet');
    if (b.type === 'rewrite_existing') {
      // its evidence span shares wording with the résumé
      const ev = (b.evidenceUsed[0] || '').slice(0, 20).toLowerCase();
      assert.ok(ev && VALET.toLowerCase().includes(ev), 'rewrite grounded in a real résumé span');
    }
  }
});

test('a résumé with NO numbers routes transferable bullets to needs_confirmation (never invents a metric)', () => {
  const noMetrics = `Server, Cafe  2021-2022\n- Served customers and handled the register\n- Kept the area clean\nSkills\ncustomer service, pos`;
  const p = buildApplicationPackage({ resumeText: noMetrics, jobDescription: 'Cashier. Required: customer service, point of sale, cash handling.', jobTitle: 'Cashier' });
  assert.ok(p.needs_confirmation.length >= 1, 'weak-on-numbers bullets ask for confirmation');
  for (const b of p.needs_confirmation) {
    assert.ok(b.confirmBeforeUsing.length >= 1, 'confirm-before-using guidance present');
    assert.doesNotMatch(b.text, /\d/, 'no fabricated number appears in the copy');
  }
});

// ── Interview defense ─────────────────────────────────────────────────────────────────────
test('interview defense flags implied management with no leadership evidence', () => {
  const resume = parseResumeV2(FASTFOOD);
  const w = checkInterviewDefense('Managed a team of 10 employees and owned the schedule', { resume, family: 'food_service' });
  assert.ok(w.some(x => x.code === 'implies_management'), 'management overclaim flagged');
});

test('interview defense flags a tool not in the résumé', () => {
  const resume = parseResumeV2(FASTFOOD);
  const w = checkInterviewDefense('Used Salesforce to manage the pipeline', { resume, family: 'food_service' });
  assert.ok(w.some(x => x.code === 'unlisted_tool'), 'unlisted tool flagged');
});

test('interview defense flags an unconfirmed metric', () => {
  const resume = parseResumeV2(FASTFOOD);
  const w = checkInterviewDefense('Increased sales by 300% single-handedly', { resume, family: 'food_service' });
  assert.ok(w.some(x => x.code === 'unconfirmed_metric'), 'unconfirmed metric flagged');
});

test('confirmed answers become usable evidence (no fabrication, but now proven)', () => {
  const noMetrics = `Server, Cafe  2021-2022\n- Served customers on the register\nSkills\ncustomer service`;
  const confirmed = buildApplicationPackage({
    resumeText: noMetrics, jobDescription: 'Cashier. Required: customer service.', jobTitle: 'Cashier',
    confirmedAnswers: [{ id: 'q1', forRequirement: 'customer service', unit: 'customers per shift', answer: '80 customers per shift' }],
  });
  assert.equal(confirmed.resume_summary.metric_count >= 1, true, 'confirmed answer counts as a metric');
});

// ── Industry-agnostic: works just as well for ANY field, not just service roles ───────────
const INDUSTRY_CASES = {
  marketing: { r: `Marketing Manager, BrandCo  2020 - Present\n- Grew organic traffic 140% through SEO and content strategy\n- Ran paid campaigns on Google Ads with a 3.2x ROAS\nSkills\nSEO, content marketing, Google Analytics, HubSpot, paid media`, j: 'Digital Marketing Manager. Required: SEO, paid media, Google Analytics, content strategy. HubSpot preferred.', t: 'Digital Marketing Manager', fam: 'marketing', want: ['seo', 'paid media', 'google analytics'] },
  teacher: { r: `High School Teacher, Lincoln HS  2018 - Present\n- Designed curriculum for 120 students across 5 sections\n- Improved test scores by 18%\nSkills\ncurriculum design, classroom management, lesson planning`, j: 'Teacher. Required: curriculum design, classroom management, lesson planning.', t: 'Teacher', fam: 'education', want: ['curriculum design', 'classroom management', 'lesson planning'] },
  electrician: { r: `Journeyman Electrician, Volt  2016 - Present\n- Installed commercial electrical systems to NEC code on 40+ job sites\n- Trained 3 apprentices on blueprint reading\nSkills\nelectrical installation, NEC code, blueprint reading, conduit bending`, j: 'Commercial Electrician. Required: electrical installation, NEC code, blueprint reading.', t: 'Commercial Electrician', fam: 'skilled_trades', want: ['electrical installation', 'nec code', 'blueprint reading'] },
  swe: { r: `Software Engineer, TechCo  2020 - Present\n- Built React and Node.js services handling 2M requests/day\n- Reduced API latency 40%\nSkills\nJavaScript, TypeScript, React, Node.js, AWS`, j: 'Frontend Engineer. Required: JavaScript, React, TypeScript.', t: 'Frontend Engineer', fam: 'software_engineering', want: ['javascript', 'react', 'typescript'] },
};

test('works across ANY industry — right family + exact matches for marketing, teaching, trades, engineering', () => {
  for (const [name, c] of Object.entries(INDUSTRY_CASES)) {
    const p = buildApplicationPackage({ resumeText: c.r, jobDescription: c.j, jobTitle: c.t });
    assert.equal(p.role_family, c.fam, `${name}: role family`);
    const matched = new Set([...p.why_you_match, ...p.transferable_proof].filter(m => m.matchType === 'exact').map(m => m.requirement));
    for (const w of c.want) assert.ok(matched.has(w), `${name}: "${w}" matched exact (got ${[...matched].join(', ')})`);
    assert.ok(p.fit_score >= 55, `${name}: real fit score (${p.fit_score})`);
    assert.ok(p.safe_bullets.length >= 1, `${name}: produced usable bullets`);
  }
});

test('open-vocabulary: a skill the ontology has never seen still matches when it is on both sides', () => {
  // "NEC code" and "curriculum design" are not in any dictionary — they must still match exact.
  assert.equal(openRelation('NEC code', 'nec code').relation, 'exact');
  assert.equal(openRelation('curriculum design', 'curriculum design').relation, 'exact');
  // near-neighbors: "content strategy" vs "content marketing" are adjacent, not identical.
  assert.equal(openRelation('content strategy', 'content marketing').relation, 'adjacent');
  // unrelated skills do not falsely match.
  assert.equal(openRelation('phlebotomy', 'javascript').relation, 'none');
});

test('word-boundary safety: "Registered Nurse" never produces a phantom point-of-sale requirement', () => {
  const p = buildApplicationPackage({ resumeText: `Registered Nurse, Mercy  2017 - Present\n- Managed care for 8 patients per shift\nSkills\npatient care, care coordination`, jobDescription: 'Registered Nurse. Required: patient care, care coordination. RN license required.', jobTitle: 'Registered Nurse' });
  const reqs = [...p.why_you_match, ...p.transferable_proof, ...p.missing_risky, ...p.missing_recoverable, ...p.weak_matches].map(m => m.requirement);
  assert.ok(!reqs.includes('point of sale'), '"register" in "Registered" must not become a POS requirement');
  assert.ok(!p.ats.missing_exact_keywords.includes('point of sale'));
  // hasWord itself
  assert.equal(hasWord('registered nurse', 'register'), false);
  assert.equal(hasWord('worked the register', 'register'), true);
});

test('unknown industry: GENERAL fallback for a no-signal role, and open-vocab still matches domain skills', () => {
  // detectRoleFamily returns 'general' when nothing scores — never a mislabel.
  assert.equal(detectRoleFamily('Marine Biologist', 'specimen collection and field research').family, 'general');
  // And the full package still matches the obscure domain skills exactly via open vocabulary.
  const p = buildApplicationPackage({ resumeText: `Marine Biologist, Ocean Institute  2019 - Present\n- Collected 200+ specimens and logged field data\nSkills\nspecimen collection, field research, data logging`, jobDescription: 'Field Researcher. Required: specimen collection, field research, data logging.', jobTitle: 'Field Researcher' });
  const matched = new Set([...p.why_you_match, ...p.transferable_proof].filter(m => m.matchType === 'exact').map(m => m.requirement));
  assert.ok(matched.has('specimen collection'), 'domain skill matched via open vocabulary');
  assert.ok(matched.has('field research'), 'domain skill matched via open vocabulary');
  assert.ok(p.fit_score >= 55, `real fit for an unmodeled field (${p.fit_score})`);
});

test('metric capture is industry-agnostic (job sites, students, patients, apprentices)', () => {
  const r = parseResumeV2(`Teacher, HS  2018-2020\n- Taught 120 students across 5 sections\n- Trained 3 apprentices on 40+ job sites`);
  const vals = r.metrics.map(m => m.value).join(' | ');
  assert.match(vals, /120/, 'captures "120 students"');
  assert.match(vals, /40/, 'captures "40+ job sites"');
});

// ── Package shape / compatibility flag ────────────────────────────────────────────────────
test('package carries the V2 engine version and the legacy-compatible flag', () => {
  const p = buildApplicationPackage({ resumeText: VALET, jobDescription: CS_JOB, jobTitle: 'CSR' });
  assert.equal(p.engine_version, 'application_intelligence_v2');
  assert.equal(p.legacy_seenfit_compatible, true);
  assert.ok(typeof p.fit_score === 'number' && p.fit_score > 0);
});
