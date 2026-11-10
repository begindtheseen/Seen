// G4 (2026-11-10): a credential is a gate only when the posting requires HOLDING it; tenure with the employer is never
// a years requirement; years with a gerund subject and "or higher" state certifications are judged. Wordings are real
// corpus lines (matched-jobs round 5). Run: node --test lib/optimizer/g4.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimizer } from './index.js';
import { evaluateConstraints } from './constraints.js';
import { extractResumeFacts } from './extractResumeFacts.js';
import { resumeText } from '../fixtures/calibration/load.mjs';

const NOW = '2026-11-10';
const posting = (line) => `Requirements:\n• ${line}\n• Experience with Excel\n• Strong communication skills\n• Bachelor's degree in a related field`;
const run = (who, line, title = 'Associate') => runOptimizer({ resumeText: resumeText(who), jobTitle: title, jobDescription: posting(line), now: NOW });
const cert = (o) => o.constraints.find((c) => c.kind === 'certification');

// optional or prospective → never a not-met gate (for someone without it)
const NOT_A_GATE = [
  'CPA candidacy desirable but not required',
  'CPA eligible',
  'CPA or working toward CPA',
  'CPA preferred',
  'MBA, CPA, CFA, or similar advanced credential preferred',
  'CPA designation or public accounting experience strongly preferred',
  'CDL is a plus',
  'SAP TM certification is highly desirable',
  'CIH certification preferred, or active progress toward it',
  'NICET certification (Water-Based Systems) or equivalent preferred',
];
// required to HOLD → a gate
const A_GATE = ['CPA required', 'Active CPA license', 'A valid real estate license for AZ is required', 'Current BLS certification is required', 'Active RBT certification required'];

test('G4 item 1: optional or prospective credential wordings are never a not-met gate', () => {
  for (const line of NOT_A_GATE) {
    const o = run('dev', line);
    assert.ok(!o.hard_gates.some((g) => g.kind === 'certification'), `${line}: ${JSON.stringify(o.hard_gates.map((g) => g.message))}`);
    const c = cert(o);
    if (c) assert.notEqual(c.status, 'unmet', `${line}: ${c.message}`);
  }
});

test('G4 item 1: a credential the posting requires holding stays a gate', () => {
  for (const line of A_GATE) {
    const c = cert(run('dev', line));
    assert.ok(c && c.status === 'unmet', `${line}: ${c && c.message}`);
  }
});

test('G4 item 1: a CPA candidate meets "CPA eligible" and "CPA candidacy desirable"; not "CPA required"', () => {
  for (const line of ['CPA eligible', 'CPA candidacy desirable but not required']) assert.equal(cert(run('staff-accountant', line)).status, 'met', line);
  const req = cert(run('staff-accountant', 'CPA required'));
  assert.equal(req.grade, 'partly');
  assert.match(req.message, /CPA Candidate/);
});

const TENURE = [
  '401k match after one year of service',
  '4 weeks of sabbatical after 4 years of service at the company',
  'Eligibility for 401(k) plan after 90 days of employment',
  'Paid Time Off (PTO) granted after 90 days of employment',
  '$1.50 raise after 90 days of continuous employment',
  '16 week paid parental leave after one year of employment',
  'Paid Sabbatical after 5 years of continuous service',
  'Tuition reimbursement after 6 months of service',
];
test('G4 item 2: tenure with the employer is never a years requirement', () => {
  for (const line of TENURE) {
    const o = run('cashier', line);
    assert.ok(!o.constraints.some((c) => c.kind === 'years'), `${line}: ${JSON.stringify(o.constraints.filter((c) => c.kind === 'years').map((c) => c.message))}`);
  }
});

// item 3: the reader does not raise these lines yet (routed to R3); fed as facts, the gates judge them
const fact = (value, ev, extra = {}) => ({ factType: 'constraint', kind: 'years', label: `${value}+ years`, importance: 'required', gate: true, value, evidence: ev, sentence: ev, management: /supervis|manag|lead/i.test(ev), ...extra });
const judge = (who, f, jobTitle) => { const t = resumeText(who); return evaluateConstraints([f], extractResumeFacts(t), t, { jobTitle, now: new Date(NOW) })[0]; };

test('G4 item 3: "2+ years supervising warehouse teams" checks the managing AND the area', () => {
  const m = judge('maria', fact(2, '2+ years supervising warehouse teams'), 'Warehouse Supervisor');
  assert.notEqual(m.grade, 'met');
  assert.match(m.message, /in retail; they ask for 2\+ years of it in warehouse teams/);
  const w = judge('warehouse', fact(2, '2+ years supervising warehouse teams'), 'Warehouse Supervisor');
  assert.notEqual(w.grade, 'met');
  assert.match(w.message, /lead duties/);
});

test('G4 item 3: "5+ years closing complex Enterprise deals" after a lead-in label counts the roles that close deals', () => {
  const a = judge('account-executive', fact(5, 'Proven SaaS quota-carrying success: 5+ years closing complex Enterprise deals'), 'Enterprise Account Executive');
  assert.equal(a.grade, 'partly');
  assert.match(a.message, /closing complex Enterprise deals \(Account Executive/);
});

test('G4 item 3: "California Residential Electrician Certification or higher" — a journeyman holds the class, the state differs', () => {
  const f = { factType: 'constraint', kind: 'certification', label: 'California Residential Electrician Certification', value: 'California Residential Electrician Certification', state: 'California', importance: 'required', gate: true, evidence: 'Current California Residential Electrician Certification or higher electrical certification' };
  const c = judge('electrician', f, 'Electrical Lead Installer');
  assert.equal(c.grade, 'partly');
  assert.match(c.message, /Arizona Journeyman/);
});
