import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = (name) => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)), 'utf8');

test('brain integrity migration materializes the recovered note before enforcing referential integrity', () => {
  const sql = migration('20260901011716_brain_note_integrity.sql');
  const noteInsert = sql.indexOf('insert into public.brain_notes');
  const fk = sql.indexOf('foreign key (note) references public.brain_notes(path)');

  assert.ok(noteInsert >= 0);
  assert.ok(fk > noteInsert, 'the orphan note must exist before the FK is validated');
  assert.match(sql, /where f\.note = 'knowledge\/4am-routine-observations\.md'/);
  assert.match(sql, /on conflict \(path\) do nothing/);
  assert.match(sql, /validate constraint brain_facts_note_fkey/);
  assert.match(sql, /where path = 'timeline\/2026-08-15\.md'[\s\S]*content not like/);
});

test('job dedupe trigger function is not executable by public API roles', () => {
  const sql = migration('20260901011717_restrict_jobs_dedupe_execute.sql');
  assert.match(sql, /revoke all on function public\.jobs_dedupe_refresh\(\) from public/);
  assert.match(sql, /from anon/);
  assert.match(sql, /from authenticated/);
  assert.match(sql, /grant execute on function public\.jobs_dedupe_refresh\(\) to service_role/);
});

test('pg_trgm is moved out of the API-exposed public schema', () => {
  const sql = migration('20260901012413_move_pg_trgm_out_of_public.sql');
  assert.match(sql, /create schema if not exists extensions/);
  assert.match(sql, /alter extension pg_trgm set schema extensions/);
});

test('note replacement RPC serializes and atomically replaces the derived fact mirror', () => {
  const sql = migration('20260903014240_atomic_brain_note_replace.sql');
  assert.match(sql, /security invoker/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /insert into public\.brain_notes/);
  assert.match(sql, /delete from public\.brain_facts/);
  assert.match(sql, /jsonb_populate_recordset/);
  assert.match(sql, /revoke all on function public\.brain_replace_note[\s\S]*from public/i);
  assert.match(sql, /grant execute on function public\.brain_replace_note[\s\S]*to service_role/i);
});
