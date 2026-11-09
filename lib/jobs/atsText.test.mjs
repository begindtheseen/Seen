// The whole posting from an ATS API answer (atsText.js). Shapes are real: a Lever posting from
// api.eu.lever.co (Cirrus Logic, 2026-11-08) keeps its requirements in `lists`, which ingest dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leverPostingHtml, smartRecruitersHtml } from './atsText.js';
import { cleanDescription } from '../server/jobSources.js';
import { mapAtsJson } from '../server/listingImport.js';
import { atsApiPlan } from '../server/listingImport.js';

const LEVER = {
  text: 'Senior Network Engineer',
  descriptionPlain: 'For over four decades, Cirrus Logic has been propelled by the top engineers in mixed-signal processing.',
  description: '<div>For over four decades, Cirrus Logic has been propelled by the top engineers in mixed-signal processing.</div>',
  lists: [
    { text: 'Responsibilities', content: '<li>Lead advanced troubleshooting across LAN/WAN/WLAN/cloud environments.&nbsp;</li><li>Monitor and diagnose network health.</li>' },
    { text: 'Required Skills and Qualifications', content: '<li>8+ years of enterprise network engineering experience.</li><li>Expert knowledge of BGP, OSPF and SD-WAN.</li>' },
  ],
  additional: '<div>Cirrus Logic is an equal opportunity employer.</div>',
  categories: { location: 'Austin, TX', commitment: 'Full-time' },
};

test('a Lever posting keeps every section: intro, each list under its heading, the closing part', () => {
  const text = cleanDescription(leverPostingHtml(LEVER));
  assert.match(text, /^For over four decades/);
  assert.match(text, /\nResponsibilities\n+• Lead advanced troubleshooting/);
  assert.match(text, /\nRequired Skills and Qualifications\n+• 8\+ years/);
  assert.match(text, /BGP, OSPF and SD-WAN/);
  assert.match(text, /equal opportunity employer/);
  assert.ok(!/&nbsp;/.test(text));
});

test('the listing importer reads a Lever posting with its lists too, from an EU-hosted board', () => {
  const plan = atsApiPlan('https://jobs.eu.lever.co/cirrus/49018156-fb14-4e3c-a874-b3d8677785b3/apply');
  assert.equal(plan.apiUrl, 'https://api.eu.lever.co/v0/postings/cirrus/49018156-fb14-4e3c-a874-b3d8677785b3');
  const f = mapAtsJson(plan, LEVER);
  assert.match(cleanDescription(f.description), /Required Skills and Qualifications/);
});

test('SmartRecruiters sections keep their titles as their own blocks', () => {
  const text = cleanDescription(smartRecruitersHtml({ jobDescription: { title: 'Job Description', text: '<p>Run the line.</p>' }, qualifications: { title: 'Qualifications', text: '<ul><li>Forklift certified</li></ul>' } }));
  assert.match(text, /Job Description\n+Run the line\.\n+Qualifications\n+• Forklift certified/);
});
