// Modern-title rule families (lib/occupations/modern.js), each pinned by ≥10 real-style titles, end to end
// through occupationOf (a strong O*NET filing may answer first; both must land in the accepted codes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occupationOf, levelOf } from './index.js';
import { modernOccupation } from './modern.js';

/** @param {string} title @param {string[]} codes */
const ok = (title, codes) => {
  const m = occupationOf(title);
  assert.ok(m, `${title} → null`);
  assert.ok(codes.includes(m.code.slice(0, 7)), `${title} → ${m.code} ${m.title}`);
  assert.notEqual(m.confidence, 'guess', `${title} is only a guess`);
};

const FAMILIES = {
  'software / data / ML / DevOps / SRE / security engineering': [['15-1252', '15-1254', '15-1244', '15-1212', '15-1299', '15-1241', '15-1253', '15-2051', '15-1243'], [
    'Senior Backend Engineer', 'Staff Fullstack Engineer', 'Sr .NET Development Lead', 'Android Developer Intern, 2027', 'Senior Forward Deployed Engineer',
    'Member of Technical Staff — Compute Cluster', 'DevOps Engineer', 'Site Reliability Engineer II', 'Senior Platform Engineer', 'Machine Learning Engineer',
    'Sr Software Engineer, MLE - AV Labs', 'Data Engineer III', 'Application Security Engineer', 'Cybersecurity Engineer', 'Sr. IP Network Engineer',
    'SDET', 'QA Automation Engineer', 'iOS Developer', 'React Developer', 'AI Infrastructure Engineer']],
  'product and program management': [['11-2021', '11-3021', '15-1299', '13-1082', '11-9199', '11-9021'], [
    'Senior Product Manager I/II, Revenue Growth', 'Staff Product Manager, Care Coordination', 'Product Owner', 'Group Product Manager', 'Head of Product',
    'Technical Program Manager', 'AI Operations Program Manager, Benefits', 'Program Manager', 'Implementation Manager', 'Technical Project Manager, Technology Integration']],
  'design / UX': [['15-1255', '27-1021', '27-1024', '27-1014'], [
    'Senior UX Designer', 'Product Designer', 'UI Designer', 'UX Researcher', 'Interaction Designer', 'Motion Designer, Paid Social (Contract)',
    'Brand Designer', 'Design Lead', 'Visual Designer', 'Content Designer']],
  'customer success / support / solutions': [['41-3091', '43-4051', '13-1199', '15-1232', '41-9031', '15-1299', '15-1211', '15-1241'], [
    'Customer Success Manager', 'Senior Customer Success Manager', 'Client Success Associate', 'Customer Support Specialist', 'Technical Support Engineer',
    'Customer Experience Associate', 'Member Services Representative', 'Solutions Engineer (NorCal)', 'Sales Engineer', 'Solutions Architect',
    'Customer Onboarding Specialist']],
  'sales development / account executive / account management / revenue operations': [['41-3091', '41-4011', '41-4012', '11-2022', '41-1012', '13-1199', '13-1111', '13-1161', '41-3011', '11-2011'], [
    'Sales Development Representative', 'Business Development Representative', 'SDR', 'Account Executive, Enterprise', 'Senior Account Executive',
    'Territory Account Executive, Retail - South Texas', 'Key Account Manager', 'Business Development Manager', 'Partner Sales Director (Public Sector)',
    'Revenue Operations Manager', 'Sales Operations Analyst', 'Deal Desk Specialist', 'Outside Sales Representative - Security Services']],
  'marketing operations / growth / content': [['13-1161', '11-2021', '27-3043', '27-3042'], [
    'Marketing Operations Specialist', 'Growth Marketing Manager', 'Lifecycle Marketing Manager', 'Content Marketing Manager', 'Demand Generation Manager',
    'Campaign Coordinator', 'Social Media Specialist', 'SEO Strategist', 'Performance Marketing Analyst', 'Content Writer', 'Copywriter']],
  'people ops / talent': [['13-1071', '11-3121', '43-4161', '13-1141', '11-3111'], [
    'People & Culture Specialist (f/m/d)', 'Senior HR Business Partner, Global Commercial Center', 'People Operations Associate', 'HR Generalist',
    'Talent Acquisition Partner', 'Senior Talent Sourcer', 'Technical Recruiter', 'Recruiting Coordinator', 'Compensation Lead', 'Total Rewards Analyst']],
  'finance ops / FP&A': [['13-2051', '11-3031', '43-3051', '13-2011', '43-3031', '43-3021', '43-3011'], [
    'FP&A Analyst', 'Senior Financial Analyst', 'Strategic Finance Manager', 'Treasury Analyst', 'Treasury Officer', 'Senior Payroll Analyst',
    'Revenue Accountant', 'Senior Tax Accountant - CPA', 'Accounts Payable Specialist', 'Billing Specialist', 'Collections Specialist']],
  'clinical and allied health with unit names': [['29-1141', '11-9111', '29-2061', '29-2031', '29-2034', '29-2032', '29-2035', '29-2072', '29-9021', '43-3021', '21-1022', '43-6013', '29-2099', '11-9121', '21-1093', '31-1122', '39-9041', '29-1131', '29-2056'], [
    'RN Registered Nurse - PRN Weekends', 'ICU RN', 'Med Surg Nurse', 'Charge Nurse - Telemetry', 'ADON/MDS Nurse Coordinator', 'LPN - Infant Trach/Vent Nurse',
    'Cardiac Cath Lab Interventional Radiology Technologist', 'CT Technologist', 'Surgical Coder - PHYS', 'Coding Auditor Senior', 'Medical Biller',
    'Care Coordinator - Chronic Management', 'Direct Support Professional (DSP) - Baltimore County', 'Clinical Research Coordinator I - RN',
    'Veterinary Surgeon - Small Animal', 'Veterinary Technician - Overnight']],
  'skilled-trade rungs': [['49-9021', '47-2111', '47-3013', '47-2152', '47-3015', '47-2031', '47-3012', '51-4121', '49-9041', '49-2094', '49-9071', '47-1011', '49-1011'], [
    'Journeyman HVAC Team Lead', 'HVAC Apprentice', 'Lead HVAC Technician', 'Journeyman Electrician', 'Electrician Apprentice', 'Master Plumber',
    'Apprentice Pipefitter', 'Journeyman Carpenter', 'Structural Welder', 'Senior Field Service Technician', 'Building Maintenance Technician', 'Framing Crew Lead']],
};

for (const [name, [codes, titles]] of Object.entries(FAMILIES)) {
  test(`modern titles: ${name} (${titles.length})`, () => {
    assert.ok(titles.length >= 10);
    for (const t of titles) ok(t, codes);
  });
}

test('the rung comes from levelOf, the field from the title', () => {
  assert.ok(levelOf('HVAC Apprentice').rank < levelOf('Journeyman HVAC Team Lead').rank);
  assert.equal(levelOf('Lead HVAC Technician').marker, 'lead');
  assert.equal(occupationOf('Journeyman HVAC Team Lead')?.code, '49-9021.00');
});

test('paid AI-training tasks and survey panels are not occupations', () => {
  for (const t of ['Polish - Fluent Speakers - AI Training - Sosnowiec, Poland', 'France Residents - Survey Participants - Besançon, France',
    'US Finance Data Contributor – AI Research (Remote, Task-Based) - Baltimore', 'Mental Health Professionals - AI Training - Canterbury, UK']) {
    assert.equal(occupationOf(t), null, t);
  }
  assert.deepEqual(modernOccupation('ai training')?.codes, []);
});

test('rule exclusions hold (a look-alike does not take the rule)', () => {
  assert.notEqual(occupationOf('Security Guard')?.code, '15-1212.00');
  assert.notEqual(occupationOf('Civil Engineer')?.code, '15-1252.00');
  assert.equal(occupationOf('Amazon DSP Delivery Driver')?.code.slice(0, 7), '53-3033');
});
