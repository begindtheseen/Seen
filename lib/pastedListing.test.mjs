import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePastedListing } from './pastedListing.js';

test('parses a real Indeed mobile copy into fields', () => {
  const blob = `Porter
Bowlero Corp
Norwalk, CA
$17 an hour
Apply now
Save
Full job description
Bowlero Corp is hiring a Porter to keep our bowling center clean and guest-ready.
Responsibilities include bussing lanes, restocking supplies, and light maintenance.
Benefits: 401k, PTO, flexible hours. Two interview rounds.`;
  const f = parsePastedListing(blob);
  assert.equal(f.title, 'Porter');
  assert.equal(f.company, 'Bowlero Corp');
  assert.equal(f.location, 'Norwalk, CA');
  assert.ok(f.salary && f.salary.includes('$17'));
  assert.ok(f.description.includes('bowling center'));
  assert.ok(!f.description.includes('Apply now'), 'chrome stripped');
  assert.ok(!f.description.includes('Full job description'), 'marker consumed');
});

test('drops a leading/trailing share URL and star ratings', () => {
  const blob = `Senior Data Analyst
Acme Corp
3.9 out of 5 stars
Austin, TX
Job description
Build dashboards and own the analytics stack. SQL, Python, dbt. Remote-friendly team.
https://www.indeed.com/viewjob?jk=abc123`;
  const f = parsePastedListing(blob);
  assert.equal(f.title, 'Senior Data Analyst');
  assert.equal(f.company, 'Acme Corp');
  assert.equal(f.location, 'Austin, TX');
  assert.ok(f.description.includes('dashboards'));
  assert.ok(!/indeed\.com/.test(f.description), 'url line dropped');
  assert.ok(!/out of 5 stars/.test(f.company), 'rating not mistaken for company');
});

test('handles no marker — first lines are the header, rest is the body', () => {
  const blob = `Line Cook
Joe's Diner
Remote
We need a line cook for the dinner shift. Prep, plate, and keep the line moving.
Must have 2 years experience. $18/hr.`;
  const f = parsePastedListing(blob);
  assert.equal(f.title, 'Line Cook');
  assert.equal(f.company, "Joe's Diner");
  assert.equal(f.location, 'Remote');
  assert.ok(f.description.includes('dinner shift'));
});

test('pulls location/salary out of a run-together Indeed header line', () => {
  const blob = `Warehouse Associate
Amazon · Bellflower, CA · $19 an hour
Full job description
Pick, pack, and ship customer orders in a fast-paced fulfillment center.`;
  const f = parsePastedListing(blob);
  assert.equal(f.title, 'Warehouse Associate');
  assert.ok(/Amazon/.test(f.company));
  assert.ok(/Bellflower, CA/.test(f.location));
  assert.ok(f.salary && f.salary.includes('$19'));
  assert.ok(f.description.includes('fulfillment center'));
});

test('empty / whitespace input yields empty fields, never throws', () => {
  assert.deepEqual(parsePastedListing(''), { title: '', company: '', location: '', salary: null, description: '' });
  assert.deepEqual(parsePastedListing('   \n  \n'), { title: '', company: '', location: '', salary: null, description: '' });
});

test('caps description length', () => {
  const f = parsePastedListing('Role\nCo\nJob description\n' + 'x'.repeat(20000));
  assert.ok(f.description.length <= 12000);
});
