// Instance ⇒ class (coordinator 2026-11-10): a résumé that names the product shows the category the posting asks for,
// and the evidence names the product. Every pair is listed; a common word that is also a product never proves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aliasProof } from './lineProof.js';

const PAIRS = [
  ['CRM', ['Salesforce', 'HubSpot', 'Zendesk', 'Zoho', 'Pipedrive', 'Microsoft Dynamics']],
  ['EHR', ['Epic', 'Cerner', 'athenaOne', 'eClinicalWorks', 'HCHB', 'PointClickCare']],
  ['WMS', ['Manhattan', 'SAP EWM', 'Blue Yonder', 'HighJump']],
  ['ERP', ['SAP', 'Oracle ERP', 'NetSuite', 'Microsoft Dynamics', 'Sage Intacct', 'QuickBooks Enterprise']],
  ['POS', ['Square POS', 'Toast POS', 'Clover', 'Aloha', 'Micros']],
  ['ticketing system', ['Zendesk', 'Jira', 'ServiceNow', 'Freshdesk']],
  ['ATS', ['Greenhouse ATS', 'iCIMS', 'Taleo', 'Workday Recruiting']],
  ['LMS', ['Canvas LMS', 'Moodle', 'Blackboard', 'Docebo']],
  ['CAD', ['AutoCAD', 'SolidWorks', 'Revit']],
  ['cloud platforms', ['AWS', 'Azure', 'GCP']],
  ['version control', ['Git', 'GitHub', 'GitLab']],
  ['spreadsheets', ['Excel', 'Google Sheets']],
  ['presentation tools', ['PowerPoint', 'Google Slides', 'Keynote']],
  ['agent performance improvement', ['Ran weekly 1:1s and call reviews with 12 agents']],
  ['live call monitoring', ['Did call reviews for the team']],
];
for (const [cls, instances] of PAIRS) {
  test(`${cls} ⇐ ${instances.join(' / ')}`, () => {
    for (const inst of instances) {
      const resume = `Jane Doe\n\nEXPERIENCE\nSupport Lead — Acme, Austin TX    2020 - Present\n- Worked daily in ${inst} for the whole team\n`;
      const p = aliasProof(resume, { labels: [cls] });
      assert.ok(p && p.line, `${inst} should prove ${cls}`);
      assert.ok(p.line.text.includes(inst.split(' ')[0]), `the evidence names ${inst}: ${p.line.text}`);
    }
  });
}
test('a support lead with "Zendesk, Salesforce Service Cloud" shows CRM (hidden-set case)', () => {
  const p = aliasProof('Kim\n\nSKILLS\nZendesk, Salesforce Service Cloud, Excel\n', { labels: ['CRM'] });
  assert.ok(p && /Zendesk|Salesforce/.test(p.line.text));
});
test('a common word is not a product: "square feet", "sales numbers", "Athena" (AWS) prove nothing', () => {
  assert.equal(aliasProof('X\n\nEXPERIENCE\nLead — Co    2020 - 2022\n- Stocked a 40,000 square foot store\n', { labels: ['POS'] }), null);
  assert.equal(aliasProof('X\n\nEXPERIENCE\nLead — Co    2020 - 2022\n- Hit sales numbers every month\n', { labels: ['spreadsheets'] }), null);
  assert.equal(aliasProof('X\n\nEXPERIENCE\nEngineer — Co    2020 - 2022\n- Built a pipeline from S3 to Athena\n', { labels: ['EHR'] }), null);
});
