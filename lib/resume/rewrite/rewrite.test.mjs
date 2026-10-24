// Tests: deterministic bullet rewriting + the fabrication firewall.
// Run: node --test lib/resume/rewrite/rewrite.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteBullet, passesFirewall, rewriteDoc, suggestVerbs } from './rules.js';
import { pastTense, baseFromPast, baseFromGerund } from './inflect.js';
import { normalizeDoc } from '../model.js';

const rw = (t, tense = 'past') => rewriteBullet(t, { tense });

test('inflection: irregulars, doubling, silent e, -y', () => {
  assert.deepEqual(['lead', 'run', 'sell', 'plan', 'ship', 'refer', 'equip', 'manage', 'apply', 'panic', 'set up', 'cross-sell', 'travel', 'format'].map(pastTense),
    ['led', 'ran', 'sold', 'planned', 'shipped', 'referred', 'equipped', 'managed', 'applied', 'panicked', 'set up', 'cross-sold', 'traveled', 'formatted']);
  assert.equal(baseFromPast('managed'), 'manage'); assert.equal(baseFromPast('planned'), 'plan'); assert.equal(baseFromPast('led'), 'lead'); assert.equal(baseFromPast('entered'), 'enter');
  assert.equal(baseFromGerund('managing'), 'manage'); assert.equal(baseFromGerund('running'), 'run'); assert.equal(baseFromGerund('seeing'), 'see');
  assert.equal(baseFromPast('customer'), null, 'not a past form');
});

test('weak leads are replaced by the verb they were hiding', () => {
  assert.equal(rw('Responsible for managing a team of 5 cashiers').text, 'Managed a team of 5 cashiers.');
  assert.equal(rw('Was responsible for the implementation of SSO').text, 'Implemented SSO.');
  assert.equal(rw('Tasked with the coordination of vendor deliveries', 'present').text, 'Coordinate vendor deliveries.');
  assert.equal(rw('Responsible for greeting customers and selling memberships').text, 'Greeted customers and sold memberships.');
  assert.equal(rw('Duties included cash drawer reconciliation and restocking').text, 'Reconciled cash drawer and restocked.');
  assert.equal(rw('Responsible for inventory management and vendor negotiation').text, 'Managed inventory and vendor negotiation.');
  assert.equal(rw('In charge of scheduling 12 part-time staff').text, 'Scheduled 12 part-time staff.');
});

test('hidden verbs, passives, pronouns, doublets, fillers, numbers', () => {
  assert.equal(rw('Conducted an analysis of churn data').text, 'Analyzed churn data.');
  assert.equal(rw('Provided training to 40 new hires').text, 'Trained 40 new hires.');
  assert.equal(rw('Weekly reports were generated for leadership').text, 'Generated weekly reports for leadership.');
  assert.equal(rw('Was promoted to lead after 6 months').text, 'Promoted to lead after 6 months.');
  assert.equal(rw('I managed a team of 6 engineers').text, 'Managed a team of 6 engineers.');
  assert.equal(rw('Managed and oversaw the nightly close').text, 'Managed the nightly close.');
  assert.equal(rw('Successfully utilized various tools in order to improve reporting').text, 'Used various tools to improve reporting.');
  assert.equal(rw('Cut costs by twelve percent ($1,200,000)').text, 'Cut costs by 12% ($1.2M).');
  assert.ok(rw('Successfully utilized various tools in order to improve reporting').notes.includes('quantify'), 'vague words become a note, never a deletion');
});

test('tense follows the role: past roles get past tense, current roles keep present', () => {
  assert.equal(rw('Manage a 12-person support desk', 'past').text, 'Managed a 12-person support desk.');
  assert.equal(rw('Managed a 12-person support desk', 'present').text, 'Manage a 12-person support desk.');
  assert.equal(rw('Manage a 12-person support desk', 'keep').text, 'Manage a 12-person support desk.');
  assert.equal(rw('Selected as one of 230 participants', 'present').text, 'Selected as one of 230 participants.', 'recognition leads are never re-tensed');
});

test('shared-credit leads ("helped", "assisted") are not upgraded into ownership', () => {
  const r = rw('Helped to increase sales by 12 percent');
  assert.equal(r.text, 'Helped to increase sales by 12%.');
  assert.ok(r.notes.includes('shared_credit'));
  assert.equal(rw('Assisted with onboarding new hires').text, 'Assisted with onboarding new hires.');
});

test('a good bullet is left alone, a hopeless one gets an honest note instead of an invention', () => {
  const good = rw('Led a team of 5 engineers to ship a platform used by 40,000 users.');
  assert.equal(good.text, 'Led a team of 5 engineers to ship a platform used by 40,000 users.');
  assert.equal(good.unchanged, true);
  assert.equal(rw('Worked on detailing vehicles and restocking supplies').text, 'Detailed vehicles and restocked supplies.');
  const noun = rw('Worked on marketing campaigns and brand stuff');
  assert.ok(noun.changes.every((c) => c.rule === 'hygiene'), `field gerund must not become a verb: ${noun.text}`);
  assert.ok(noun.notes.includes('needs_action_verb'));
  const mats = rw('Responsible for training materials and shipping labels');
  assert.ok(mats.changes.every((c) => c.rule === 'hygiene'), `training materials is a thing, not an act: ${mats.text}`);
  assert.equal(rw('Responsible for training new hires on the POS').text, 'Trained new hires on the POS.');
});

test('firewall: numbers never change, no new proper nouns, no new content words', () => {
  assert.equal(passesFirewall('Served 85 customers per day', 'Served 85 customers per day').ok, true);
  assert.equal(passesFirewall('Served 85 customers per day', 'Served 185 customers per day').ok, false);
  assert.equal(passesFirewall('Served customers per day', 'Served 85 customers per day').ok, false);
  assert.equal(passesFirewall('Built dashboards for the team', 'Built Tableau dashboards for the team').ok, false);
  assert.equal(passesFirewall('Built dashboards for the team', 'Built dashboards for the finance team').ok, false);
  assert.equal(passesFirewall('Responsible for managing vendors', 'Managed vendors', ['managed']).ok, true);
  assert.equal(passesFirewall('Cut costs by twelve percent', 'Cut costs by 12%').ok, true, 'number words may become digits');
  // every rewrite in the suite passes its own firewall
  for (const t of ['Responsible for managing a team of 5 cashiers', 'Conducted an analysis of churn data', 'Weekly reports were generated for leadership', 'Cut costs by twelve percent ($1,200,000)', 'Responsible for greeting customers and selling memberships']) {
    const r = rw(t); assert.equal(r.firewall.ok, true, `${t} → ${r.text}: ${r.firewall.reason}`);
  }
});

test('rewriteDoc applies per-role tense and records provenance per bullet', () => {
  const doc = normalizeDoc({
    experience: [
      { title: 'Lead', company: 'Now Co', start: '2023-01', end: 'present', bullets: ['Responsible for managing 4 reps', 'Led the launch'] },
      { title: 'Rep', company: 'Then Co', start: '2020-01', end: '2022-12', bullets: ['Manage inbound tickets', 'Handled escalations for 2 regions'] },
    ],
  });
  const { doc: out, log } = rewriteDoc(doc);
  assert.equal(out.experience[0].bullets[0].text, 'Manage 4 reps.', 'current role → present tense after weak-lead removal');
  assert.equal(out.experience[1].bullets[0].text, 'Managed inbound tickets.', 'past role → past tense');
  assert.equal(out.experience[1].bullets[1].text, 'Handled escalations for 2 regions.');
  assert.ok(log.some((l) => l.bulletId === doc.experience[0].bullets[0].id && l.changes.some((c) => c.rule === 'weak_lead')));
  assert.ok(out.meta.provenance.length >= 2 && out.meta.provenance.every((p) => p.kind === 'rewrite' && p.from && p.to));
  assert.equal(doc.experience[0].bullets[0].text, 'Responsible for managing 4 reps', 'input doc untouched');
});

test('verb suggestions are drawn from the bullet\'s own context', () => {
  assert.deepEqual(suggestVerbs('handle', 'Handled customer complaints and returns'), ['served', 'resolved', 'advised']);
  assert.ok(suggestVerbs('work', 'Worked with the data team on dashboards').includes('built'));
});

test('firewall: a hyphenated compound in the original licenses its parts (and the compound itself)', () => {
  assert.equal(passesFirewall('Install 480V three-phase systems.', 'Install three phase systems.').ok, true);
  assert.equal(passesFirewall('Install 480V three-phase systems.', 'Install 480V three-phase systems across sites.', ['across', 'sites']).ok, true);
  assert.equal(passesFirewall('Install 480V systems.', 'Install three-phase systems.').ok, false);
});

// ── 2026-10-24 audits: the four real bullets the engine broke and shipped ──
test('audit bullets: "Handled" is a lead verb, a noun modifier is never unpacked, coordinated verbs change together or not at all', () => {
  // "Handled billing questions" → was "Bill questions" (hidden_verb on "billing" + handle as a linking verb)
  assert.equal(rw('Handled billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score', 'past').text,
    'Handled billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score.');
  assert.equal(rw('Handled billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score', 'present').text,
    'Handle billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score.');
  // "Sold and renewed" → was "Sell and renewed": every coordinated verb follows the lead
  assert.equal(rw('Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor for 6 straight months', 'present').text,
    'Sell and renew 40+ memberships per month; rank top 3 of 12 on the sales floor for 6 straight months.');
  assert.equal(rw('Greeted guests, managed keys and tickets, and resolved wait-time complaints on the spot', 'present').text,
    'Greet guests, manage keys and tickets, and resolve wait-time complaints on the spot.');
  assert.equal(rw('Parked and retrieved 150+ vehicles per shift at a resort with zero damage claims in 20 months', 'present').text,
    'Park and retrieve 150+ vehicles per shift at a resort with zero damage claims in 20 months.');
  // the present-tense form of a current-role bullet is grammatical ("Train 4 new…") — whether to
  // apply it is the person's call (a proposal), which the tailor and the Studio preview enforce
  assert.equal(rw('Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist', 'present').text,
    'Train 4 new front-desk hires on the POS system and the daily opening and closing checklist.');
  assert.equal(rw('Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist', 'keep').text,
    'Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist.');
  // a nominalization still unpacks when it carries its own object or closes the clause
  assert.equal(rw('Performed repairs on vehicles').text, 'Repaired vehicles.');
  assert.equal(rw('Provided training to 40 new hires').text, 'Trained 40 new hires.');
  // …but never when it modifies the next noun
  assert.equal(rw('Performed billing reconciliation daily').text, 'Performed billing reconciliation daily.');
  assert.equal(rw('Provided training materials to new hires').text, 'Provided training materials to new hires.');
  // past direction: coordinated present verbs follow too
  assert.equal(rw('Manage the floor and train new hires', 'past').text, 'Managed the floor and trained new hires.');
});
