// The paid-export token end to end: the server signs it for one user's paid result, the export action accepts only
// that user's unexpired token for that result — and the screens that download a paid version SEND it. The last part
// is the seam that failed (2026-11-10): the server issued the token, neither download button sent it, and a résumé
// bought with a credit still carried the "Optimized with Seen" footer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paidExportToken, verifyPaidExport, paidExportAllowed } from './paidExport.js';

const withSecret = (fn) => async () => {
  const before = process.env.EXPORT_TOKEN_SECRET;
  process.env.EXPORT_TOKEN_SECRET = 'test-only-secret';
  try { await fn(); } finally { if (before === undefined) delete process.env.EXPORT_TOKEN_SECRET; else process.env.EXPORT_TOKEN_SECRET = before; }
};

test('a token is this user\'s, for this result, until it expires', withSecret(() => {
  const now = 1_800_000_000_000;
  const t = paidExportToken('user-a', 'result-1', now);
  assert.ok(t);
  assert.equal(verifyPaidExport('user-a', t, 'result-1', now + 1000), true);
  assert.equal(verifyPaidExport('user-b', t, 'result-1', now + 1000), false, 'another user');
  assert.equal(verifyPaidExport('user-a', t, 'result-2', now + 1000), false, 'another result');
  assert.equal(verifyPaidExport('user-a', t, 'result-1', now + 8 * 24 * 3600 * 1000), false, 'expired');
  assert.equal(verifyPaidExport('user-a', t.slice(0, -2) + 'xx', 'result-1', now + 1000), false, 'altered');
  assert.equal(verifyPaidExport('user-a', '', 'result-1', now), false);
}));

test('the export decision needs both fields and the signed-in user', withSecret(async () => {
  const t = paidExportToken('user-a', 'result-1');
  const as = (uid) => async () => (uid ? { uid } : null);
  assert.equal(await paidExportAllowed({}, { exportToken: t, exportKey: 'result-1' }, as('user-a')), true);
  assert.equal(await paidExportAllowed({}, { exportToken: t }, as('user-a')), false);
  assert.equal(await paidExportAllowed({}, { exportToken: t, exportKey: 'result-1' }, as(null)), false);
  assert.equal(await paidExportAllowed({}, {}, as('user-a')), false);
}));

test('without a server secret no token is issued and none verifies', () => {
  const keep = {};
  for (const k of ['EXPORT_TOKEN_SECRET', 'SUPABASE_JWT_SECRET', 'SUPABASE_SERVICE_KEY']) { keep[k] = process.env[k]; delete process.env[k]; }
  try {
    assert.equal(paidExportToken('user-a', 'result-1'), null);
    assert.equal(verifyPaidExport('user-a', 'x.y', 'result-1'), false);
  } finally { for (const k of Object.keys(keep)) if (keep[k] !== undefined) process.env[k] = keep[k]; }
});

test('every screen that downloads a paid version sends the token the server gave it', () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const exportCalls = (src) => src.split('\n').filter((l) => /action:\s*'export'/.test(l));
  for (const p of ['components/optimizer/PaidResult.tsx', 'components/ApplyOptimizeModal.tsx']) {
    const calls = exportCalls(read(p));
    assert.ok(calls.length >= 1, `${p}: an export call`);
    for (const l of calls) assert.match(l, /paidExportFields\(/, `${p}: the export call carries the paid token`);
  }
  const page = read('app/resume/page.tsx');
  assert.match(page, /<DownloadVersion doc=\{version\.doc\} paid=\{tailored\} \/>/, '/resume passes the paid result to its download');
  const api = read('api/resume.js');
  assert.match(api, /paidExportAllowed\(req, body, resolveAuthedUser\)/, 'the export action reads the token');
  // Résumé Studio (round 4): the charged tailor issues the token; the Tailor panel carries it with the version it bought;
  // the Studio page hands it to the export panel ONLY for that version; the export call sends it
  assert.match(api, /out\.tailored\.export_token = paidExportToken\(who\.uid, studioKey\)/, 'the charged Studio tailor issues a token');
  assert.match(read('components/resume/TailorPanel.tsx'), /\.\.\.paidTokenOf\(extra\)/, 'the Tailor panel passes the token with the version');
  const studio = read('app/resume/studio/page.tsx');
  assert.match(studio, /paid=\{active \? paidOf\(active\) : null\}/, 'the token goes to the export of the bought version only (the base keeps the free rule)');
  const exp = exportCalls(read('components/resume/ExportPanel.tsx'));
  assert.ok(exp.length >= 1 && exp.every((l) => /exportToken: paid\.exportToken, exportKey: paid\.exportKey/.test(l)), 'the Studio export call carries the token');
});
