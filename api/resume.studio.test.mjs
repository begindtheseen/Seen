// Contract tests for the Résumé Studio actions on /api/resume (lib/server/resumeStudio.js behind
// the handler): structure / health / rewrite / ats_check / templates are free, export carries the
// free-tier brand line (no token → not Pro) with the right headers, tailor is credit-gated, and
// the legacy download_resume now renders through the structured renderer.
// Run: node --test api/resume.studio.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.LLM_API_KEY; delete process.env.ANTHROPIC_KEY;
globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
const { default: handler } = await import('./resume.js');
const { extractResumeFile } = await import('../lib/resume/extract/index.js');

const RESUME = fs.readFileSync(new URL('../lib/resume/fixtures/text/john_doe_legacy.txt', import.meta.url), 'utf8');
function mockRes() {
  return { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
}
const call = async (body, headers = {}) => { const res = mockRes(); await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io', ...headers }, socket: { remoteAddress: '10.0.0.9' }, body }, res); return res; };

test('structure: text → doc + health + coverage (free, no token)', async () => {
  const res = await call({ action: 'structure', text: RESUME });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.ok(res.body.doc.basics.name && res.body.doc.experience.length >= 2);
  assert.ok(res.body.health.score > 0 && res.body.health.findings);
  assert.ok(res.body.coverage > 0.9);
  const short = await call({ action: 'structure', text: 'too short' });
  assert.equal(short.code, 422);
  const bad = await call({ action: 'health', doc: 'nope' });
  assert.equal(bad.code, 400);
});

test('rewrite: whole document and a single bullet, with provenance', async () => {
  const s = await call({ action: 'structure', text: RESUME });
  const res = await call({ action: 'rewrite', doc: s.body.doc });
  assert.equal(res.code, 200);
  assert.ok(res.body.changed >= 1, 'legacy résumé has weak bullets to rewrite');
  assert.ok(res.body.doc.meta.provenance.some((p) => p.kind === 'rewrite'));
  const one = await call({ action: 'rewrite', text: 'Responsible for managing a team of 5 associates.' });
  assert.equal(one.code, 200);
  assert.ok(!/^Responsible for/.test(one.body.result.text));
});

test('ats_check + templates', async () => {
  const s = await call({ action: 'structure', text: RESUME });
  const res = await call({ action: 'ats_check', doc: s.body.doc, format: 'pdf', template: 'engineering' });
  assert.equal(res.code, 200);
  assert.ok(res.body.check.score >= 85, JSON.stringify(res.body.check.checks.filter((c) => !c.ok)));
  const t = await call({ action: 'templates' });
  assert.equal(t.body.templates.length, 3);
  assert.equal(t.body.formats.length, 5);
});

test('export: PDF for a signed-out caller is branded; DOCX/TXT/JSON carry the right headers', async () => {
  const s = await call({ action: 'structure', text: RESUME });
  const pdf = await call({ action: 'export', doc: s.body.doc, format: 'pdf', template: 'modern' });
  assert.equal(pdf.code, 200);
  assert.equal(pdf.headers['Content-Type'], 'application/pdf');
  assert.match(pdf.headers['Content-Disposition'], /attachment; filename=".* - Resume\.pdf"; filename\*=UTF-8''/);
  assert.equal(pdf.headers['X-Seen-Branded'], '1');
  const ex = await extractResumeFile({ buffer: pdf.body, fileName: 'r.pdf' });
  assert.ok(ex.text.includes('Optimized with Seen'));
  const docx = await call({ action: 'export', doc: s.body.doc, format: 'docx' });
  assert.equal(docx.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const txt = await call({ action: 'export', doc: s.body.doc, format: 'txt' });
  assert.match(txt.body.toString('utf8'), /^JOHN DOE\n/i);
  const json = await call({ action: 'export', doc: s.body.doc, format: 'json' });
  assert.ok(JSON.parse(json.body.toString('utf8')).basics);
});

test('tailor: credit-gated (401 without a token)', async () => {
  const s = await call({ action: 'structure', text: RESUME });
  const res = await call({ action: 'tailor', doc: s.body.doc, jobTitle: 'Store Manager', jobDescription: 'Retail store manager. Scheduling, inventory, POS, customer service.' });
  assert.equal(res.code, 401);
  assert.equal(res.body.credits_required, true);
});

test('download_resume (legacy action) renders through the structured renderer with whole-word headings', async () => {
  const res = await call({ action: 'download_resume', resume: RESUME, job: 'Store Manager', company: 'Acme' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  const ex = await extractResumeFile({ buffer: res.body, fileName: 'r.pdf' });
  assert.ok(ex.text.includes('\nEXPERIENCE\n') && !/E X P E R I E N C E/.test(ex.text));
  assert.ok(ex.text.includes('Optimized with Seen'), 'signed-out → branded');
  const none = await call({ action: 'download_resume', resume: 'x'.repeat(40) });
  assert.ok(none.code === 400 || none.code === 422);
});
