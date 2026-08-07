// Resume Intelligence Engine — cross-industry fixture suite (Phase 15).
// Run: node --test lib/resume-intelligence/engine.test.mjs
//
// Ten fixtures across industries prove the non-negotiables: no phantom tech on non-tech roles, no
// URL/sentence junk, alias + taxonomy + transferable + semantic matching, generic-word suppression,
// phrase preservation, honest gaps, and — most important — the fabrication firewall (a required
// credential is NEVER inferred from similar work). Plus determinism and a no-AI static guarantee.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { analyzeApplication } from './engine.js';
import { buildJobProfile } from './jobProfile.js';
import { buildResumeProfile } from './resumeProfile.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const labels = (list) => list.map((m) => m.requirement.toLowerCase());
const hasLike = (list, re) => list.some((m) => re.test(m.requirement.toLowerCase()));

// ── No external AI anywhere in the engine (static guarantee) ─────────────────────────────────
test('the engine makes NO external AI/API calls (static scan)', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 8, 'engine module set present');
  const forbidden = /\bfetch\s*\(|anthropic|openai|api\.cohere|generativelanguage|x-api-key|https?:\/\/api\./i;
  for (const f of files) assert.doesNotMatch(readFileSync(join(HERE, f), 'utf8'), forbidden, `${f} must not call a hosted AI API`);
});

// ── TEST 1 — Target Asset Protection: no phantom tech, no URL/sentence junk, real concepts ────
test('TEST 1 — Target Asset Protection produces clean, on-domain requirements', () => {
  const jd = `Assets Protection Specialist — Target
Requirements:
- Must be at least 18 years of age
- High school diploma or equivalent
- Strong customer service and de-escalation skills
Responsibilities:
- Conduct surveillance and prevent theft from the get-go
- Support team members during their shifts and rest breaks
- All other duties based on business needs
Benefits at tgt.biz/BenefitsForYou_C. Equal Opportunity Employer.`;
  const p = buildJobProfile(jd, { jobTitle: 'Assets Protection Specialist' });
  const all = p.requirements.map((r) => r.displayName.toLowerCase());
  for (const bad of ['aws', 'rest apis', 'rest', 'go', 'tgt biz', 'benefitsforyou_c', 'all other duties', 'provide you', 'licensure', 'business needs']) {
    assert.ok(!all.some((l) => l.includes(bad)), `junk "${bad}" present: ${JSON.stringify(all)}`);
  }
  assert.ok(all.some((l) => /customer service|de-escalation|surveillance|asset protection|safety|18/.test(l)), `no real concept: ${JSON.stringify(all)}`);
  assert.ok(p.roleFamily !== 'software_engineering' && p.roleFamily !== 'data_analytics');
});

// ── TEST 2 — Warehouse: WMS alias, transferable leadership, no generic garbage ────────────────
test('TEST 2 — Warehouse: WMS alias resolves, supervisor experience is transferable leadership', () => {
  const jd = `Warehouse Team Lead
Required: warehouse operations, WMS, OSHA safety, shipping and receiving, team leadership.`;
  const resume = `Sam Rivera
Experience
Warehouse Associate, Metro Distribution  2020 - Present
- Supervised and trained 12 warehouse associates across two shifts
- Processed incoming and outgoing shipments and tracked stock counts
Skills
warehouse operations, shipping, receiving, inventory`;
  const a = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Warehouse Team Lead' });
  const strong = labels(a.strongMatches);
  assert.ok(strong.some((l) => /warehouse operations/.test(l)), `warehouse ops not matched: ${JSON.stringify(strong)}`);
  // WMS requirement exists (alias resolved) and is a real gap here (résumé never names it).
  const allReq = [...a.strongMatches, ...a.transferableMatches, ...a.missingRequirements, ...a.missingRecoverable, ...a.weakEvidence];
  assert.ok(hasLike(allReq, /warehouse management system/), `WMS alias not resolved into a requirement: ${JSON.stringify(labels(allReq))}`);
  // team leadership recognized as TRANSFERABLE from "supervised and trained associates".
  const lead = [...a.transferableMatches, ...a.strongMatches].find((m) => /team leadership/i.test(m.requirement));
  assert.ok(lead, `team leadership not recognized: ${JSON.stringify(labels(a.transferableMatches))}`);
  assert.ok(['TRANSFERABLE_MATCH', 'EXACT_MATCH', 'TAXONOMY_MATCH'].includes(lead.matchType));
});

// ── TEST 3 — Software: tech enabled, Next.js→React, GitHub Actions→CI/CD, REST≠"rest" ─────────
test('TEST 3 — Software role enables tech taxonomy and resolves tech relationships', () => {
  const jd = `Frontend Engineer
Required: JavaScript, React, TypeScript, REST APIs, Git, CI/CD.`;
  const resume = `Alex Kim
Experience
Software Engineer, TechCo  2020 - Present
- Built Next.js apps and shipped features with GitHub Actions
- Wrote REST API endpoints in TypeScript
Skills
JavaScript, TypeScript, Next.js, GitHub Actions`;
  const a = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Frontend Engineer' });
  assert.equal(a.job.roleFamily, 'software_engineering');
  const covered = [...a.strongMatches, ...a.transferableMatches];
  assert.ok(hasLike(covered, /javascript/), 'JavaScript not matched');
  assert.ok(hasLike(covered, /typescript/), 'TypeScript not matched');
  assert.ok(hasLike(covered, /react/), `React not matched via Next.js: ${JSON.stringify(labels(covered))}`); // Next.js → React (taxonomy)
  assert.ok(hasLike(covered, /rest apis?/), `REST APIs not matched: ${JSON.stringify(labels(covered))}`);
  assert.ok(hasLike(covered, /ci\/cd/), `CI/CD not matched via GitHub Actions: ${JSON.stringify(labels(covered))}`); // GitHub Actions → CI/CD alias
});

// ── TEST 4 — Sales: Salesforce→CRM, cold outreach, pipeline transferable ──────────────────────
test('TEST 4 — Sales: CRM via Salesforce, pipeline recognized from evidence', () => {
  const jd = `Sales Development Rep
Required: CRM, sales pipeline, cold outreach, quota attainment.`;
  const resume = `Pat Lee
Experience
Sales Associate, ShopCo  2021 - Present
- Used Salesforce to track prospects from initial contact through closed sale
- Made cold calls and qualified inbound leads
Skills
Salesforce, cold calling, lead qualification`;
  const a = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Sales Development Rep' });
  const covered = [...a.strongMatches, ...a.transferableMatches];
  assert.ok(hasLike(covered, /crm/), `CRM not matched via Salesforce: ${JSON.stringify(labels(covered))}`); // Salesforce → CRM alias
  assert.ok(hasLike(covered, /sales pipeline|prospecting/), `pipeline/prospecting not recognized: ${JSON.stringify(labels(covered))}`);
});

// ── TEST 5 — Healthcare: HIPAA/EMR/patient intake, no tech pollution ──────────────────────────
test('TEST 5 — Healthcare concepts extracted, no unrelated tech', () => {
  const jd = `Medical Front Office Assistant
Required: HIPAA, patient intake, EMR, scheduling.`;
  const p = buildJobProfile(jd, { jobTitle: 'Medical Front Office Assistant' });
  const req = p.requirements.map((r) => r.displayName.toLowerCase());
  assert.ok(req.some((l) => /hipaa/.test(l)), `HIPAA missing: ${JSON.stringify(req)}`);
  assert.ok(req.some((l) => /patient intake/.test(l)), 'patient intake missing');
  assert.ok(req.some((l) => /emr/.test(l)), 'EMR missing');
  for (const bad of ['aws', 'rest', 'go', 'react', 'kubernetes', 'docker']) assert.ok(!req.some((l) => l === bad), `tech pollution "${bad}"`);
});

// ── TEST 6 — Missing certification: CDL required, none on résumé → MISSING, never fabricated ───
test('TEST 6 — a required CDL absent from the résumé is MISSING and must-not-invent', () => {
  const jd = `Delivery Driver. Required: Valid Class A CDL. Clean driving record required.`;
  const resume = `Jamie Fox
Experience
Delivery Driver, QuickShip  2021 - Present
- Completed 120+ stops per shift with a 98% on-time rate
Skills
route planning, time management`;
  const a = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Delivery Driver' });
  const cdl = a.missingRequirements.find((m) => /cdl/i.test(m.requirement));
  assert.ok(cdl, `CDL not flagged missing: ${JSON.stringify(labels(a.missingRequirements))}`);
  assert.equal(cdl.mustNotInvent, true, 'CDL must be must-not-invent');
  assert.equal(cdl.missSeverity, 'fatal');
  assert.ok(!hasLike([...a.strongMatches, ...a.transferableMatches], /cdl/), 'CDL must never appear as a match');
});

// ── TEST 7 — Generic words never become standalone concepts ───────────────────────────────────
test('TEST 7 — repeated generic words are not promoted to requirements', () => {
  const jd = `Team Member. Required: experience, ability, team, work, strong communication, responsible, preferred.`;
  const p = buildJobProfile(jd, { jobTitle: 'Team Member' });
  const req = p.requirements.map((r) => r.displayName.toLowerCase());
  for (const g of ['experience', 'ability', 'team', 'work', 'responsible', 'preferred', 'strong']) {
    assert.ok(!req.includes(g), `generic word "${g}" became a requirement: ${JSON.stringify(req)}`);
  }
  // communication (real) still survives.
  assert.ok(req.some((l) => /communication/.test(l)), 'communication should survive');
});

// ── TEST 8 — Phrase preservation: "project management" stays one concept ──────────────────────
test('TEST 8 — multi-word concepts are preserved, not split into words', () => {
  const jd = `Coordinator. Required: project management and inventory management.`;
  const p = buildJobProfile(jd, { jobTitle: 'Coordinator' });
  const req = p.requirements.map((r) => r.displayName.toLowerCase());
  assert.ok(req.some((l) => /project management/.test(l)) || p.requirements.some((r) => r.canonicalConcept === 'operations'), `project management lost: ${JSON.stringify(req)}`);
  assert.ok(req.some((l) => /inventory management/.test(l)), 'inventory management lost');
  assert.ok(!req.includes('management'), '"management" alone must not be a requirement');
});

// ── TEST 9 — Transferable leadership from real duties ─────────────────────────────────────────
test('TEST 9 — "trained new hires, led shift meetings" is transferable evidence of team leadership', () => {
  const jd = `Shift Supervisor. Required: team leadership.`;
  const resume = `Dana Cole
Experience
Crew Member, CafeCo  2020 - 2023
- Trained new hires, assigned daily responsibilities, and led shift meetings
Skills
customer service, teamwork`;
  const a = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Shift Supervisor' });
  const lead = [...a.transferableMatches, ...a.strongMatches].find((m) => /team leadership/i.test(m.requirement));
  assert.ok(lead, `team leadership not recognized: strong=${JSON.stringify(labels(a.strongMatches))} transferable=${JSON.stringify(labels(a.transferableMatches))}`);
  assert.ok(['TRANSFERABLE_MATCH', 'TAXONOMY_MATCH'].includes(lead.matchType), `expected transferable, got ${lead.matchType}`);
  assert.ok(lead.evidence.length > 0 && /trained|led|hires/i.test(lead.evidence.join(' ')), 'evidence must cite the real bullet');
});

// ── TEST 10 — Fabrication protection: warehouse ≠ forklift certification ───────────────────────
test('TEST 10 — warehouse experience must NOT imply a required forklift certification', () => {
  const jd = `Warehouse Associate. Required: forklift certification, inventory, shipping.`;
  const resume = `Robin Vale
Experience
Warehouse Associate, Acme  2021 - 2023
- Picked and packed 100+ orders per shift and tracked inventory
Skills
inventory, shipping, receiving`;
  const a = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Warehouse Associate' });
  const fork = a.missingRequirements.find((m) => /forklift/i.test(m.requirement));
  assert.ok(fork, `forklift not flagged missing: ${JSON.stringify(labels(a.missingRequirements))}`);
  assert.equal(fork.mustNotInvent, true);
  assert.ok(!hasLike([...a.strongMatches, ...a.transferableMatches, ...a.partialMatches], /forklift/), 'forklift must never be matched from warehouse similarity');
  // but the real skills DO match, so the résumé still scores as a genuine warehouse fit.
  assert.ok(hasLike([...a.strongMatches, ...a.transferableMatches], /inventory|shipping/), 'real warehouse skills should match');
});

// ── Determinism ───────────────────────────────────────────────────────────────────────────────
test('deterministic — same input yields deep-equal analysis', () => {
  const jd = `Cashier. Required: customer service, point of sale, cash handling.`;
  const resume = `Server, Cafe 2021-2022\n- Served customers and ran the register\nSkills\ncustomer service, pos`;
  const a = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Cashier' });
  const b = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Cashier' });
  assert.deepEqual(a, b);
});
