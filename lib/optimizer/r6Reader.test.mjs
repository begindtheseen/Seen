// R6 reader: structure first (who owns a line), and a second complete start inside one unit is a new unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobFacts } from './extractJobFacts.js';
import { splitRunOnStatement } from './statementGate.js';

const all = (text) => extractJobFacts(text, { company: 'Acme', jobTitle: 'Engineer' }).statements;
const shown = (text) => all(text).filter((s) => s.display !== false && s.kind !== 'promise');

test('a lead-in that says not every item is needed makes the list preferred', () => {
  const st = shown("Acme\n\nRequirements\n- 5+ years of infrastructure experience\n- Strong Linux skills\n\nRELEVANT SKILLS\n\nYou don't need to check every box, but the more of these you bring, the better:\n\n- AWS services such as IAM and GuardDuty\n- Terraform and Ansible experience\n- SSO, OIDC, and LDAP\n- Data lakes and high-availability services\n- Documentation and project management\n");
  for (const re of [/AWS services/, /Terraform/, /SSO, OIDC/, /Data lakes/]) assert.equal((st.find((s) => re.test(s.text)) || {}).importance, 'preferred', String(re));
  assert.equal(st.find((s) => /5\+ years/.test(s.text)).importance, 'required');
});

test('a block about the place holds its own list; an outcomes list is read by its items', () => {
  const a = shown('Acme\n\nRequirements\n- Active optometry license\n- 2+ years of clinical experience\n\nThe Setting\n\nThis opportunity operates within a community clinic.\n\n- Clinic staff are on-site full time\n- Organized scheduling and patient flow\n- Coordinated, team-based care environment\n- Value-based model focused on seniors\n');
  assert.ok(!a.some((s) => /Organized scheduling|team-based care|Value-based/.test(s.text)), JSON.stringify(a.map((s) => s.text)));
  const b = shown('Acme\n\nNICE TO HAVE\n\n- Experience building fintech products\n\nOUTCOME\n\n- Clear vertical strategy and legible roadmap\n- Ships fast and clears the gates that block launch\n- Money is correct and users are never misled\n');
  assert.ok(!b.some((s) => /Clear vertical strategy|Ships fast|Money is correct/.test(s.text)));
  const c = shown('Acme\n\nKey Outcomes:\n- Execute motor and durability testing safely and consistently\n- Maintain reliable test capability across dynamometers\n- Perform scheduled inspections and teardowns\n\nRequirements\n- 3+ years of hands-on testing experience\n');
  assert.ok(c.some((s) => /^Execute motor/.test(s.text) && s.kind === 'duty'));
});

test('a second complete start inside one unit is a new unit (shape grammar applied inside the unit)', () => {
  const cases = [
    ['Must be a Licensed Clinical Social Worker (LCSW) or Licensed Social Worker (LSW) At least one year of social work experience in a health care setting', 2],
    ['Communicates clearly, sets boundaries, and makes decisions under pressure Please note that sponsorship is not available for this role', 2],
    ['An advanced degree in a relevant field is a plus Ethics: Commitment to ethical practices and responsible operations', 2],
    ['5+ years of experience selling into the payer market with enterprise sales cycles Concentrated, non-point-solution experience: a track record selling across areas', 2],
    ['Reports routine status and escalates potential costs as appropriate Performs contract management activities in accordance with policies', 2],
  ];
  for (const [t, n] of cases) assert.equal(splitRunOnStatement(t).length, n, t);
  // never after a word that needs its noun ("an experienced | Knowledge Manager", "relevant commercial | Construction …")
  assert.equal(splitRunOnStatement('Requires a bachelor degree and 10-13 years of relevant commercial Construction related experience or 15-17 years of relevant work experience').length, 1);
});

test('a requirement written under a duties heading keeps its own preference cue', () => {
  const st = shown('Acme\n\nWhat you will do\n- Own the deal desk from quote to billing hand-off\n- Build approval workflows and controls from scratch\n- Proficiency with CRM and quoting tools; experience with usage-based billing or CPQ is a strong plus\n');
  assert.equal(st.find((s) => /usage-based billing/.test(s.text)).importance, 'preferred');
});

test('contact lines and remote perks are never requirements', () => {
  const st = shown('Acme\n\nRequirements\n- 3+ years of operations experience\n- Report suspicious activity to recruiting@acme.example\n- Remote-first with no required commute\n');
  assert.equal(st.length, 1, JSON.stringify(st.map((s) => s.text)));
});
