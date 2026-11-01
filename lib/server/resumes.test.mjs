// Saved-résumé rules (lib/server/resumes.js). Run: node --test lib/server/resumes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resumeCap, canAddResume, isUsableResume, sortResumes, nextDefault, cleanResumeName, nameFromFile,
  checkResumeText, resumeListItem, capMessage, isMissingTable, mirrorPatch, isResumeId, RESUME_TEXT_MAX,
} from './resumes.js';
import { MAX_RESUMES_FREE, MAX_RESUMES_PRO } from './creditRules.js';

const TEXT = 'Jordan Avery\nWarehouse Lead at Ross Stores 2019 - Present\n- Led a team of twelve associates through peak season receiving and shipping.\n- Cut mispicks by a third with a daily cycle count and a clear handoff board for every shift.\n';

test('the cap: free keeps MAX_RESUMES_FREE, Pro keeps MAX_RESUMES_PRO', () => {
  assert.equal(MAX_RESUMES_FREE, 1);
  assert.equal(MAX_RESUMES_PRO, 5);
  assert.equal(resumeCap(false), MAX_RESUMES_FREE);
  assert.equal(resumeCap(true), MAX_RESUMES_PRO);
  assert.equal(canAddResume(0, false), true);
  assert.equal(canAddResume(1, false), false);
  assert.equal(canAddResume(4, true), true);
  assert.equal(canAddResume(5, true), false);
  assert.equal(canAddResume(3, false), false, 'a lapsed Pro account with 3 saved cannot add a 4th');
});

test('usable: the default always, the others only with Pro', () => {
  assert.equal(isUsableResume({ is_default: true }, false), true);
  assert.equal(isUsableResume({ is_default: false }, false), false);
  assert.equal(isUsableResume({ is_default: false }, true), true);
  assert.equal(isUsableResume(null, true), false);
});

test('order and promotion: default first; a deleted default hands over to the most recently updated other', () => {
  const rows = [
    { id: 'a', is_default: false, updated_at: '2026-10-01T00:00:00Z' },
    { id: 'b', is_default: true, updated_at: '2026-09-01T00:00:00Z' },
    { id: 'c', is_default: false, updated_at: '2026-10-20T00:00:00Z' },
  ];
  assert.deepEqual(sortResumes(rows).map((r) => r.id), ['b', 'c', 'a']);
  assert.equal(nextDefault(rows, 'b').id, 'c');
  assert.equal(nextDefault([rows[1]], 'b'), null);
});

test('names: cleaned, clipped to 60, from the file name when none is typed', () => {
  assert.equal(cleanResumeName('  Warehouse \n\t roles  '), 'Warehouse roles');
  assert.equal(cleanResumeName('x'.repeat(80)).length, 60);
  assert.equal(cleanResumeName(42), '');
  assert.equal(nameFromFile('Jordan_Avery_Resume.pdf'), 'Jordan Avery Resume');
  assert.equal(nameFromFile(''), '');
});

test('text: too short, too long and unreadable are refused; NULs dropped', () => {
  assert.equal(checkResumeText('short').ok, false);
  assert.equal(checkResumeText('a b '.repeat(RESUME_TEXT_MAX)).code, 'RESUME_TOO_LONG');
  assert.equal(checkResumeText('#$% ^&* 12 '.repeat(60)).code, 'RESUME_UNREADABLE');
  const ok = checkResumeText(`  ${TEXT}\u0000 `);
  assert.equal(ok.ok, true);
  assert.equal(ok.text.includes('\u0000'), false);
});

test('list item, cap message, missing table, mirror', () => {
  const item = resumeListItem({ id: 'x', name: 'Retail', file_name: null, word_count: 300, is_default: false, updated_at: 't' }, false);
  assert.equal(item.usable, false);
  assert.equal('resume_text' in item, false, 'the list never carries text');
  assert.match(capMessage(1, false), /keeps 1 résumé\. Pro keeps up to 5/);
  assert.match(capMessage(5, true), /5 of 5/);
  assert.match(capMessage(3, false), /stay saved/);
  assert.equal(isMissingTable(404, null), true);
  assert.equal(isMissingTable(400, { code: 'PGRST205' }), true);
  assert.equal(isMissingTable(400, { code: '42P01' }), true);
  assert.equal(isMissingTable(400, { code: '42703' }), false);
  assert.deepEqual(mirrorPatch(null, 'now'), { resume_text: null, resume_file_name: null, resume_word_count: null, resume_updated_at: 'now' });
  assert.deepEqual(mirrorPatch({ resume_text: TEXT, file_name: 'a.pdf', word_count: 20 }, 'now'), { resume_text: TEXT, resume_file_name: 'a.pdf', resume_word_count: 20, resume_updated_at: 'now' });
  assert.equal(isResumeId('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isResumeId('1; drop table'), false);
});

test('Apply on Seen: a chosen résumé must be the caller’s, and a non-default one needs Pro', async () => {
  const { resumeForApply } = await import('./resumes.js');
  const UID = '11111111-1111-4111-8111-111111111111';
  const rows = [
    { id: '22222222-2222-4222-8222-222222222222', user_id: UID, name: 'Main', resume_text: TEXT, file_name: 'main.pdf', is_default: true },
    { id: '33333333-3333-4333-8333-333333333333', user_id: UID, name: 'Retail', resume_text: TEXT, file_name: null, is_default: false },
    { id: '44444444-4444-4444-8444-444444444444', user_id: 'someone-else', name: 'Theirs', resume_text: TEXT, is_default: true },
  ];
  const fakeDb = (pro) => async (path) => {
    const u = new URL(`https://x/${path}`);
    if (u.pathname.endsWith('ai_credits')) return Response.json(pro ? [{ pro: true }] : []);
    const id = (u.searchParams.get('id') || '').slice(3), uid = (u.searchParams.get('user_id') || '').slice(3);
    return Response.json(rows.filter((r) => r.id === id && r.user_id === uid));
  };
  assert.deepEqual(await resumeForApply(fakeDb(false), UID, rows[0].id), { text: TEXT, fileName: 'main.pdf' });
  assert.equal((await resumeForApply(fakeDb(false), UID, rows[1].id)).status, 403);
  assert.equal((await resumeForApply(fakeDb(true), UID, rows[1].id)).fileName, 'Retail');
  assert.equal((await resumeForApply(fakeDb(true), UID, rows[2].id)).status, 404);
  assert.equal((await resumeForApply(fakeDb(true), UID, 'nope')).status, 400);
});
