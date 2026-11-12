// Run: node --test lib/resume/downloadName.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeFileName } from './downloadName.js';

test('name + Resume + the job, ASCII, hyphenated', () => {
  assert.equal(resumeFileName('Jordan Lee', 'Shift Lead', 'docx'), 'Jordan-Lee-Resume-Shift-Lead.docx');
  assert.equal(resumeFileName('Daniela Ortiz', 'Shift Lead — Copper Kettle Kitchen', 'pdf'), 'Daniela-Ortiz-Resume-Shift-Lead.pdf');
  assert.equal(resumeFileName('José Núñez', 'Barista (Part-time)', 'docx'), 'Jose-Nunez-Resume-Barista.docx');
  assert.equal(resumeFileName("Mary-Kate O'Neil", 'Sales Associate / Cashier', 'docx'), 'Mary-Kate-ONeil-Resume-Sales-Associate-Cashier.docx');
});
test('no person name → no name; no job → no job', () => {
  assert.equal(resumeFileName('EXPERIENCE SUMMARY OF QUALIFICATIONS AND MORE', 'Shift Lead'), 'Resume-Shift-Lead.docx');
  assert.equal(resumeFileName('', ''), 'Resume.docx');
  assert.equal(resumeFileName('Jordan Lee', ''), 'Jordan-Lee-Resume.docx');
  assert.ok(/^[A-Za-z0-9-]+\.docx$/.test(resumeFileName('李 雷', 'Shift Lead')), 'always ASCII');
});
