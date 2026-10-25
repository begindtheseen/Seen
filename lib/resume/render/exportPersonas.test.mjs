// Export + parser regressions from the 2026-10-25 test users and the Pro-tools harness: what the
// Studio exports must be what the plan showed, and Seen's own file must pass Seen's own parser check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseResume } from '../parse/index.js';
import { serializeToText } from '../model.js';
import { atsCheck } from './atsCheck.js';
import { renderPdf } from './pdf.js';
import { extractResumeFile } from '../extract/index.js';
import { tailorResume } from '../tailor/tailor.js';
import { downloadName } from '../../downloadName.js';

const F = (n) => readFileSync(new URL(`../../fixtures/personas/${n}`, import.meta.url), 'utf8');
const doc = (t) => parseResume({ text: t, source: 'text' });
const roles = (d) => d.experience.map((e) => [e.title, e.company]);

test('Tasha: her Classic PDF passes Seen\'s parser check (was 67 · D, "Campus Ambassador" not found)', async () => {
  const r = await atsCheck(doc(F('tasha.txt')), { format: 'pdf', template: 'classic' });
  assert.deepEqual(r.failed, [], JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.score, 100);
  assert.equal(r.pages, 1, 'no orphan page 2 holding one certification line');
});

test('Tasha: GPA prints once', async () => {
  const d = doc(F('tasha.txt'));
  assert.equal((serializeToText(d).match(/GPA 3\.4/g) || []).length, 1);
  const pdf = await renderPdf(d, { template: 'classic', pro: true });
  const ex = await extractResumeFile({ buffer: pdf.buffer, fileName: 'r.pdf' });
  assert.equal((ex.text.match(/GPA 3\.4/g) || []).length, 1, ex.text);
});

test('Maria: "Cox Communications (contract via Kelly Services)" reads back as her employer, not "?"', async () => {
  const r = await atsCheck(doc(F('maria.txt')), { format: 'pdf', template: 'classic' });
  const cox = r.recovered.roles.find((x) => /Customer Service Representative/.test(x.title));
  assert.ok(cox.ok, JSON.stringify(cox));
  assert.equal(cox.readAs.company, 'Cox Communications');
});

test('Dev: the tailored export carries every bullet the plan keeps (Stripe/Adyen + mentoring)', async () => {
  const { plan, variant } = tailorResume(doc(F('dev.txt')), { jobTitle: 'Backend Engineer, Core Technology', company: 'Stripe', jobDescription: F('dev-stripe-jd.txt') });
  const pdf = await renderPdf(variant, { template: 'classic', pro: true });
  const ex = await extractResumeFile({ buffer: pdf.buffer, fileName: 'r.pdf' });
  const text = ex.text.replace(/\s+/g, ' ');
  for (const d of plan.decisions.filter((x) => x.decision === 'keep' || x.decision === 'trim')) {
    const e = variant.experience.find((x) => x.id === d.itemId);
    assert.equal(e.bullets.length, d.keptBullets.length, `${d.title}: the page has what the plan says`);
  }
  assert.ok(text.includes('Stripe, Adyen'), 'the payment-API bullet is in the PDF');
  assert.ok(text.includes('Mentored 3 engineers'), 'the mentoring bullet is in the PDF');
});

test('parser: "Title, Employer — City" one-liners, an employer line above the title, "Volunteer", bare product domains', () => {
  const d1 = doc('Dana Okafor\ndana@example.com\nEXPERIENCE\nSoftware Engineer II, Fieldline — Austin, TX  Mar 2021 – Present\n• Built the shipment-tracking event service in Go.\n4th Grade Teacher, Oak Grove Elementary School (Wake County Public Schools) — Raleigh, NC  Aug 2019 – Present\n• Taught 26 students.');
  assert.deepEqual(roles(d1), [['Software Engineer II', 'Fieldline'], ['4th Grade Teacher', 'Oak Grove Elementary School (Wake County Public Schools)']]);
  const d2 = doc('Kevin Tran\nkevin@example.com\nEXPERIENCE\nBayou Industrial Supply — Houston, TX\nStaff Accountant, Apr 2021 – Present\n• Own month-end close for 3 entities.\n\nGulf Coast Marine Services — Houston, TX\nAccounts Payable Specialist, Jun 2018 – Mar 2021\n• Processed 900+ invoices a month in NetSuite and Bill.com');
  assert.deepEqual(roles(d2), [['Staff Accountant', 'Bayou Industrial Supply'], ['Accounts Payable Specialist', 'Gulf Coast Marine Services']], 'no fake fourth role');
  assert.ok(!(d2.basics.links || []).some((l) => /bill\.com/i.test(l.url)), 'Bill.com is a tool, not his website');
  const d3 = doc('Ana Ruiz\nana@example.com\nEXPERIENCE\nCashier\nQuickFuel Market, Charlotte, NC | June 2024 - Present\n- Ring up 200+ transactions a shift\n\nVolunteer\nHope Street Food Pantry | 2022 - 2023\n- Sorted donations and helped families check in');
  assert.deepEqual(roles(d3).at(-1), ['Volunteer', 'Hope Street Food Pantry']);
  // a registered-nurse specialty after a comma with no location stays in the title
  const d4 = doc('Rebecca Thornton\nrt@example.com\nEXPERIENCE\nRegistered Nurse, Telemetry\nSt. Aurelia Medical Center | Aug 2020 – Present\n• Care for 5 patients a shift.');
  assert.equal(d4.experience[0].title, 'Registered Nurse, Telemetry');
});

test('a download name always has its extension', () => {
  assert.equal(downloadName("attachment; filename=\"Tasha Green - Resume.pdf\"; filename*=UTF-8''Tasha%20Green%20%E2%80%94%20Resume.pdf", { ext: 'pdf' }), 'Tasha Green - Resume.pdf');
  assert.equal(downloadName('', { ext: 'pdf', fallback: 'Tasha Green Resume' }), 'Tasha Green Resume.pdf');
  assert.equal(downloadName('attachment; filename="download"', { ext: 'docx' }), 'download.docx');
});
