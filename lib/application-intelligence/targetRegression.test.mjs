// PERMANENT REGRESSION — the Target "Assets Protection Specialist" job description that
// exposed the optimizer's false-positive class (2026-08). Run:
//   node --test lib/application-intelligence/targetRegression.test.mjs
//
// This fixture is a faithful reconstruction of the real posting the owner pasted, deliberately
// preserving EVERY contamination trigger that produced garbage:
//   • "…all federal, state, and local laws"      → phantom "AWS" (substring of "l·aws")
//   • "…from the get-go" / "on the go"            → phantom "Go"
//   • "…during their shifts and rest breaks"      → phantom "REST APIs" (the word "rest")
//   • "…benefits at tgt.biz/BenefitsForYou_C"     → fake requirements "tgt biz" / "benefitsforyou_c"
//   • "All other duties based on business needs." → a raw sentence promoted to a "requirement"
//   • "Ability to provide service and support…"   → the "provide you" sentence-as-skill
//   • "Ability to operate handheld scanners…"     → "operate handheld scanners" sentence-as-skill
//   • "Maintain any required licensure…"          → the bare "licensure" credential
//
// A retail/security role must NEVER surface AWS / REST APIs / Go, and NONE of the URL/sentence
// fragments may appear as a requirement, in ANY of the three engines that feed the résumé page.
// It MUST still surface the real concepts (loss prevention, asset protection, safety, service).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildJobInsights } from '../server/jobInsights.js';
import { extractJobFacts } from '../optimizer/extractJobFacts.js';
import { parseJobV2 } from './jobParserV2.js';
import { buildApplicationPackage } from './index.js';
import { detectRoleFamily } from './roleOntology.js';

const TARGET_TITLE = 'Assets Protection Specialist';

const TARGET_JD = `Assets Protection Specialist — Target

About us:
Target is one of the world's most recognized brands and one of America's leading retailers. Find
competitive benefits from day one at tgt.biz/BenefitsForYou_C and see why team members love it here.

The role of an Assets Protection Specialist can provide you with the skills and experience of:
- Preventing theft and reducing shortage to keep our store profitable
- Responding to theft and safety incidents from the get-go, on the go across the sales floor
- Conducting surveillance and using CCTV to identify and deter external theft
- Creating a safe and secure environment for our guests and team members

As an Assets Protection Specialist, no two days are ever the same, but a typical day will most
likely include the following responsibilities:
- Support a culture of ethical conduct and compliance with company policy and all federal, state,
  and local laws
- Provide a physical presence at the front of store and respond to safety and theft incidents
- Prevent theft and shortage through apprehension, recovery, and surveillance techniques
- Write accurate and detailed incident reports and maintain evidence
- Support and enable team members to deliver excellent guest service during their shifts and rest breaks
- All other duties based on business needs

Core requirements:
- Must be at least 18 years of age
- High school diploma or equivalent
- Strong customer service and de-escalation skills
- Ability to provide service and support to guests and team members
- Ability to operate handheld scanners and technology
- Maintain any required licensure or certification where applicable
- Ability to remain on your feet for the duration of a shift and lift up to 40 pounds

Benefits:
Target offers comprehensive benefits. Learn more at tgt.biz/BenefitsForYou_C.
Americans with Disabilities Act (ADA): Target will provide reasonable accommodations with the
application process upon your request as required to comply with applicable laws.`;

// The exact tokens that must NEVER appear as a recognized skill / requirement for this role.
const PHANTOM_SKILLS = ['aws', 'rest apis', 'rest api', 'go', 'rest'];
// The exact junk requirement labels that must never surface.
const JUNK_LABELS = ['tgt biz', 'tgt.biz', 'benefitsforyou_c', 'benefitsforyou', 'provide you',
  'provide service', 'operate handheld scanners', 'all other duties', 'licensure', 'business needs'];

// ── Role detection: it's a non-technical family, so the tech dictionary is gated OFF ─────────
// The load-bearing property for the AWS/REST/Go fix is that the role is NOT software/data. (An
// AP posting is security-dominant with heavy guest interaction; the detector currently lands it
// on customer_service because the verb "support" collides with the CSR title token — Phase 5's
// ontology work sharpens that. Either way it must never be a technical family.)
const NON_TECH_EXPECTED = ['security', 'retail', 'customer_service', 'loss_prevention'];
test('Target AP role is detected as a non-technical family (tech dictionary gated off)', () => {
  const rf = detectRoleFamily(TARGET_TITLE, TARGET_JD);
  assert.ok(!['software_engineering', 'data_analytics'].includes(rf.family), `must not be technical, got ${rf.family}`);
  assert.ok(NON_TECH_EXPECTED.includes(rf.family), `expected a service/security family, got ${rf.family}`);
});

// ── Engine 1: jobInsights (WHAT THEY REALLY WANT + the "Mirror these exact terms" tip) ──────
test('jobInsights: no phantom AWS / REST / Go in what_they_want, and no tech mirror tip', () => {
  const out = buildJobInsights({ title: TARGET_TITLE, company: 'Target', description: TARGET_JD, needsSummary: false });
  const wants = out.what_they_want.map(w => w.toLowerCase());
  for (const bad of ['aws', 'rest apis', 'go', 'rest']) {
    assert.ok(!wants.includes(bad), `phantom tech skill "${bad}" leaked into what_they_want: ${JSON.stringify(out.what_they_want)}`);
  }
  // The insider tip must not tell the user to mirror cloud-engineering terms on a Target job.
  assert.ok(!/\bAWS\b|REST API|Kubernetes|Docker|\bGo\b/.test(out.insider_tip),
    `tech mirror tip on a retail job: "${out.insider_tip}"`);
  // Positive: it should still recognize a real, relevant concept.
  const blob = [...wants, out.insider_tip.toLowerCase()].join(' ');
  assert.ok(/customer service|loss prevention|asset protection|safety|surveillance|diploma|18/.test(blob),
    `no real concept surfaced: ${JSON.stringify(out.what_they_want)} / ${out.insider_tip}`);
});

// ── Engine 2: legacy optimizer facts (MISSING REQUIREMENTS chips) ───────────────────────────
test('extractJobFacts: no go/rest/aws skill facts for the Target AP role', () => {
  const facts = extractJobFacts(TARGET_JD, { jobTitle: TARGET_TITLE });
  const skillLabels = facts.filter(f => f.factType === 'skill').map(f => f.normalizedLabel.toLowerCase());
  for (const bad of ['go', 'rest', 'aws']) {
    assert.ok(!skillLabels.includes(bad), `phantom tech skill "${bad}" in job facts: ${JSON.stringify(skillLabels)}`);
  }
  // Positive: a real skill was still extracted (customer service / de-escalation / safety).
  assert.ok(skillLabels.length > 0, 'no skill facts extracted at all');
});

// ── Engine 3: V2 parser + full package (MISSING AND RISKY / RECOVERABLE) ─────────────────────
test('parseJobV2: requirements contain no URL/sentence/credential junk, but do contain real ones', () => {
  const job = parseJobV2(TARGET_JD, { jobTitle: TARGET_TITLE });
  // The chips a user actually sees are the SCORED requirements. Responsibilities are context
  // sentences (their label is a raw JD line) and are never rendered as a skill gap — so junk that
  // only ever lives inside a responsibility ("…can provide you", "all other duties…") is out of
  // scope for the chip check, but is verified absent from the public buckets in the next test.
  const scored = job.requirements.filter(r => r.importance !== 'responsibility');
  const labels = scored.map(r => String(r.normalizedLabel).toLowerCase());
  for (const junk of JUNK_LABELS) {
    assert.ok(!labels.some(l => l.includes(junk)), `junk requirement "${junk}" present: ${JSON.stringify(labels)}`);
  }
  // URL fragments must be gone from EVERY requirement, even responsibilities (stripped at source).
  const allLabels = job.requirements.map(r => String(r.normalizedLabel).toLowerCase());
  for (const url of ['tgt biz', 'tgt.biz', 'benefitsforyou_c', 'benefitsforyou']) {
    assert.ok(!allLabels.some(l => l.includes(url)), `URL fragment "${url}" present: ${JSON.stringify(allLabels)}`);
  }
  // No phantom tech surfaces either.
  for (const bad of PHANTOM_SKILLS) {
    assert.ok(!labels.includes(bad), `phantom tech skill "${bad}" as a requirement: ${JSON.stringify(labels)}`);
  }
  // Positive: it recognizes genuine, role-appropriate concepts.
  const joined = labels.join(' | ');
  assert.ok(/customer service|de-escalation|safety|surveillance|diploma|incident/.test(joined),
    `no real requirement surfaced: ${JSON.stringify(labels)}`);
});

test('buildApplicationPackage: no junk in any missing bucket for a real applicant', () => {
  const resume = `Jordan Blake
Experience
Loss Prevention Officer, MegaMart  2021 - Present
- Conducted surveillance and responded to 200+ theft incidents with a 95% recovery rate
- Wrote detailed incident reports and de-escalated confrontations with guests
- Kept a safe environment across the sales floor during peak hours
Skills
loss prevention, surveillance, de-escalation, customer service, incident reports, safety`;

  const p = buildApplicationPackage({ resumeText: resume, jobDescription: TARGET_JD, jobTitle: TARGET_TITLE });
  const missing = [...p.missing_risky, ...p.missing_recoverable, ...p.weak_matches].map(m => String(m.requirement).toLowerCase());
  for (const junk of JUNK_LABELS) {
    assert.ok(!missing.some(l => l.includes(junk)), `junk "${junk}" surfaced as a gap: ${JSON.stringify(missing)}`);
  }
  // ATS missing keywords must also be clean of the junk + phantom tech.
  const atsMissing = (p.ats.missing_exact_keywords || []).map(s => String(s).toLowerCase());
  for (const bad of [...JUNK_LABELS, ...PHANTOM_SKILLS]) {
    assert.ok(!atsMissing.some(l => l.includes(bad)), `junk/phantom "${bad}" in ATS missing keywords: ${JSON.stringify(atsMissing)}`);
  }
  // Positive: the loss-prevention résumé genuinely matches this role.
  const matched = [...p.why_you_match, ...p.transferable_proof].map(m => String(m.requirement).toLowerCase());
  assert.ok(matched.some(l => /customer service|surveillance|de-escalation|safety|loss prevention/.test(l)),
    `real match missing for an on-target résumé: ${JSON.stringify(matched)}`);
});
