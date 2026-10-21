#!/usr/bin/env node
// Full logical backup of Seen's Supabase project, read-only, over HTTPS (works where Postgres's own port
// is not reachable). Writes a folder:
//   01-schema-pre.sql   extensions, sequences, functions, tables (columns, defaults, identity, generated),
//                       primary keys, unique and check constraints        — run BEFORE the data
//   02-data.sql.gz      every row of every public table + the auth users/identities, storage buckets and
//                       object records, Supabase migration history (INSERT … jsonb_populate_recordset)
//   03-schema-post.sql  sequence positions, foreign keys, indexes, views, triggers, row-level security
//                       policies, grants, comments                          — run AFTER the data
//   storage/<bucket>/…  the files in Storage (résumés)
//   vault-secret-names.txt  the NAMES of Vault secrets (their values cannot leave the project encrypted
//                       with a key a new project would have — recreate them by hand)
//   manifest.json       row counts per table at export time vs rows written, file checksums
//   RESTORE.md          how to load it into a new project or any Postgres
// Skipped on purpose: login sessions, refresh/one-time tokens, MFA challenges, realtime messages
// (short-lived and security-sensitive; restoring them would be wrong).
//
// env: SUPABASE_URL, SUPABASE_ACCESS_TOKEN (Management API: SQL read), SUPABASE_SERVICE_KEY (Storage files).
// usage: node scripts/backup/export-supabase.mjs <out-dir>
import { mkdirSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';

const out = process.argv[2];
if (!out) throw new Error('usage: export-supabase.mjs <out-dir>');
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN) throw new Error('Set SUPABASE_URL and SUPABASE_ACCESS_TOKEN.');
const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
mkdirSync(out, { recursive: true });

// The Management API throttles bursts (429 "Too Many Requests"): one call at a time, a short pause
// between calls, and a long backoff (honouring Retry-After) when throttled.
let lastCall = 0;
async function q(sql, tries = 12) {
  for (let i = 1; ; i++) {
    const wait = lastCall + 700 - Date.now(); if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    lastCall = Date.now();
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql, read_only: true }) });
    if (r.ok) return r.json();
    const t = await r.text();
    if (i >= tries || (r.status < 500 && r.status !== 429)) throw new Error(`SQL failed (${r.status}): ${t.slice(0, 300)}`);
    const ra = Number(r.headers.get('retry-after'));
    await new Promise((res) => setTimeout(res, Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60000, 3000 * 2 ** (i - 1))));
  }
}
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
const qn = (schema, name) => `${ident(schema)}.${ident(name)}`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---- what to export ------------------------------------------------------------------------------
const MANAGED_DATA = { auth: ['users', 'identities', 'mfa_factors', 'sso_providers', 'sso_domains', 'saml_providers', 'oauth_clients', 'custom_oauth_providers', 'webauthn_credentials', 'audit_log_entries'],
  storage: ['buckets', 'objects'], supabase_migrations: ['schema_migrations'] };

const pre = ['-- Seen — schema, part 1 (before data). Generated ' + new Date().toISOString() + ` from project ${ref}.`, 'set check_function_bodies = false;', "set client_min_messages = warning;", ''];
const post = ['-- Seen — schema, part 2 (after data).', "set client_min_messages = warning;", ''];

// Extensions (Supabase installs most in "extensions").
for (const e of await q("select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname not in ('plpgsql') order by 1")) {
  pre.push(`create schema if not exists ${ident(e.nspname)};`, `create extension if not exists ${ident(e.extname)} with schema ${ident(e.nspname)};`);
}
pre.push('');

// Types (enums / domains / composites) in public.
for (const t of await q(`select t.typname, t.typtype, (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid) labels,
  format_type(t.typbasetype, t.typtypmod) base from pg_type t join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' and t.typtype in ('e','d') and not exists (select 1 from pg_depend d where d.objid=t.oid and d.deptype='e') order by 1`)) {
  pre.push(t.typtype === 'e' ? `create type public.${ident(t.typname)} as enum (${t.labels});` : `create domain public.${ident(t.typname)} as ${t.base};`);
}

// Sequences.
const seqs = await q("select schemaname, sequencename, data_type, start_value, min_value, max_value, increment_by, cycle, cache_size, last_value from pg_sequences where schemaname='public' order by 2");
for (const s of seqs) pre.push(`create sequence if not exists ${qn(s.schemaname, s.sequencename)} as ${s.data_type} increment by ${s.increment_by} minvalue ${s.min_value} maxvalue ${s.max_value} start ${s.start_value} cache ${s.cache_size}${s.cycle ? ' cycle' : ''};`);
pre.push('');

// Functions (not extension-owned) — bodies are not checked at create time (check_function_bodies = false).
const fns = await q(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1`);
for (const f of fns) pre.push(`${f.def.trim()};`, '');

// Tables.
const cols = await q(`select c.relname tbl, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def, a.attidentity ident, a.attgenerated gen
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind in ('r','p') order by 1, 2`);
const tables = [...new Set(cols.map((c) => c.tbl))];
const colsOf = Object.fromEntries(tables.map((t) => [t, cols.filter((c) => c.tbl === t)]));
for (const t of tables) {
  const lines = colsOf[t].map((c) => {
    let s = `  ${ident(c.attname)} ${c.typ}`;
    if (c.gen === 's') s += ` generated always as (${c.def}) stored`;
    else if (c.ident === 'a') s += ' generated always as identity';
    else if (c.ident === 'd') s += ' generated by default as identity';
    else if (c.def != null) s += ` default ${c.def}`;
    if (c.nn) s += ' not null';
    return s;
  });
  pre.push(`create table if not exists public.${ident(t)} (\n${lines.join(',\n')}\n);`);
}
pre.push('');

// Constraints: keys and checks before the data, foreign keys after.
const cons = await q(`select c.relname tbl, k.conname, k.contype, pg_get_constraintdef(k.oid) def from pg_constraint k join pg_class c on c.oid=k.conrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and k.contype in ('p','u','c','x','f') order by case k.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 when 'x' then 3 else 4 end, 1, 2`);
for (const k of cons) (k.contype === 'f' ? post : pre).push(`alter table public.${ident(k.tbl)} add constraint ${ident(k.conname)} ${k.def};`);
pre.push('');

// Sequence positions + ownership.
for (const s of seqs) if (s.last_value != null) post.push(`select setval(${lit(`${s.schemaname}.${s.sequencename}`)}, ${s.last_value}, true);`);
for (const o of await q(`select s.relname seq, t.relname tbl, a.attname col from pg_depend d join pg_class s on s.oid=d.objid and s.relkind='S' join pg_class t on t.oid=d.refobjid
  join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid join pg_namespace n on n.oid=s.relnamespace where n.nspname='public' and d.deptype='a'`)) post.push(`alter sequence public.${ident(o.seq)} owned by public.${ident(o.tbl)}.${ident(o.col)};`);
post.push('');

// Indexes not backing a constraint.
for (const i of await q(`select pg_get_indexdef(i.indexrelid) def from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not exists (select 1 from pg_constraint k where k.conindid=i.indexrelid) order by 1`)) post.push(`${i.def.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ')};`);
post.push('');

// Views.
for (const v of await q("select viewname, definition from pg_views where schemaname='public' order by 1")) post.push(`create or replace view public.${ident(v.viewname)} as\n${v.definition.trim().replace(/;$/, '')};`);
post.push('');

// Triggers on public, auth and storage tables (e.g. auth.users → a public handler).
for (const t of await q(`select pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','auth','storage') and exists (select 1 from pg_proc p join pg_namespace pn on pn.oid=p.pronamespace where p.oid=t.tgfoid and pn.nspname='public') order by 1`)) post.push(`${t.def};`);
post.push('');

// Row-level security + policies (public and storage).
for (const r of await q("select n.nspname s, c.relname t, c.relrowsecurity rls, c.relforcerowsecurity f from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by 2")) {
  if (r.rls) post.push(`alter table ${qn(r.s, r.t)} enable row level security;`);
  if (r.f) post.push(`alter table ${qn(r.s, r.t)} force row level security;`);
}
for (const p of await q("select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1, 2, 3")) {
  const roles = (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, '').split(',')).map((r) => (r === 'public' ? 'public' : ident(r))).join(', ');
  post.push(`drop policy if exists ${ident(p.policyname)} on ${qn(p.schemaname, p.tablename)};`,
    `create policy ${ident(p.policyname)} on ${qn(p.schemaname, p.tablename)} as ${p.permissive} for ${p.cmd} to ${roles}${p.qual ? ` using (${p.qual})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''};`);
}
post.push('');

// Grants for Supabase's API roles (some were revoked by hand in prod — this keeps exactly what is there).
post.push('revoke all on all tables in schema public from anon, authenticated;', 'revoke all on all functions in schema public from anon, authenticated;');
for (const g of await q("select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) privs from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') group by 1, 2 order by 2, 1")) post.push(`grant ${g.privs} on public.${ident(g.table_name)} to ${ident(g.grantee)};`);
for (const g of await q(`select r.grantee, p.oid::regprocedure::text sig from information_schema.routine_privileges r join pg_proc p on p.proname=r.routine_name join pg_namespace n on n.oid=p.pronamespace and n.nspname=r.routine_schema
  where r.routine_schema='public' and r.grantee in ('anon','authenticated','service_role') and r.privilege_type='EXECUTE' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') group by 1, 2 order by 2, 1`)) post.push(`grant execute on function ${g.sig} to ${ident(g.grantee)};`);
for (const g of await q("select grantee, object_name, string_agg(privilege_type, ', ') privs from information_schema.usage_privileges where object_schema='public' and object_type='SEQUENCE' and grantee in ('anon','authenticated','service_role') group by 1, 2")) post.push(`grant ${g.privs} on sequence public.${ident(g.object_name)} to ${ident(g.grantee)};`);
post.push('');

// Comments.
for (const c of await q(`select c.relname t, a.attname col, d.description txt from pg_description d join pg_class c on c.oid=d.objoid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attribute a on a.attrelid=c.oid and a.attnum=d.objsubid where n.nspname='public' and c.relkind in ('r','p','v') order by 1, 2`)) post.push(c.col ? `comment on column public.${ident(c.t)}.${ident(c.col)} is ${lit(c.txt)};` : `comment on table public.${ident(c.t)} is ${lit(c.txt)};`);

writeFileSync(join(out, '01-schema-pre.sql'), pre.join('\n') + '\n');
writeFileSync(join(out, '03-schema-post.sql'), post.join('\n') + '\n');
console.log(`[schema] ${tables.length} tables, ${fns.length} functions, ${cons.length} constraints`);

// ---- data -----------------------------------------------------------------------------------------
const manifest = { project: ref, exported_at: new Date().toISOString(), tables: {}, files: {}, skipped: ['auth.sessions', 'auth.refresh_tokens', 'auth.one_time_tokens', 'auth.flow_state', 'auth.mfa_challenges', 'auth.mfa_amr_claims', 'auth.mfa_recovery_codes', 'auth.webauthn_challenges', 'auth.oauth_*', 'auth.saml_relay_states', 'realtime.*', 'vault.secrets (names only)'] };
const gz = createGzip({ level: 9 }); const dataPath = join(out, '02-data.sql.gz'); const ws = createWriteStream(dataPath); gz.pipe(ws);
const w = (s) => new Promise((res) => { if (!gz.write(s)) gz.once('drain', res); else res(); });
await w(`-- Seen — data. Generated ${manifest.exported_at} from project ${ref}.\nset client_min_messages = warning;\n`);
const TAG = '$seen_backup$';
const targets = tables.map((t) => ['public', t]).concat(Object.entries(MANAGED_DATA).flatMap(([s, ts]) => ts.map((t) => [s, t])));
// Columns, primary keys and row counts for every table in three calls (not three per table).
const inList = targets.map(([sc, t]) => lit(`${sc}.${t}`)).join(', ');
const metaRows = await q(`select (n.nspname||'.'||c.relname) t, a.attname, a.attgenerated gen, a.attidentity ident from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum > 0 and not a.attisdropped where (n.nspname||'.'||c.relname) in (${inList}) order by 1, a.attnum`);
const pkRows = await q(`select (n.nspname||'.'||c.relname) t, a.attname from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indisprimary and (n.nspname||'.'||c.relname) in (${inList}) order by 1, array_position(i.indkey, a.attnum)`);
const present = new Set(metaRows.map((m) => m.t));
const counts = {};
const have = targets.filter(([sc, t]) => present.has(`${sc}.${t}`));
for (let i = 0; i < have.length; i += 40) {
  const part = have.slice(i, i + 40).map(([sc, t]) => `select ${lit(`${sc}.${t}`)} t, count(*)::bigint n from ${qn(sc, t)}`).join(' union all ');
  for (const r of await q(part)) counts[r.t] = Number(r.n);
}
// Keyset pages (primary key > the last row written) — OFFSET re-reads every earlier row and timed out deep in
// the jobs table. Rows can be large (job descriptions), so a page that hits the statement timeout is retried
// at half the size (down to 25 rows) and the size creeps back up after successes.
const isTimeout = (e) => /57014|statement timeout/.test(String(e?.message || e));
for (const [schema, table] of targets) {
  const key = `${schema}.${table}`;
  const meta = metaRows.filter((m) => m.t === key);
  if (!meta.length) { manifest.tables[key] = { error: 'not found' }; continue; }
  const insertable = meta.filter((m) => m.gen !== 's').map((m) => ident(m.attname));
  const override = meta.some((m) => m.ident === 'a') ? ' overriding system value' : '';
  const pk = pkRows.filter((p) => p.t === key).map((p) => p.attname);
  const pkCols = pk.map(ident).join(', ');
  const expected = counts[key] ?? null;
  let written = 0, batch = 1000, last = null, offset = 0;
  for (;;) {
    let where = '';
    if (pk.length && last) where = ` where (${pk.map((c) => `t.${ident(c)}`).join(', ')}) > (select ${pkCols} from jsonb_populate_record(null::${qn(schema, table)}, ${lit(JSON.stringify(last))}::jsonb))`;
    const sql = `select to_jsonb(t) r from ${qn(schema, table)} t${where} order by ${pk.length ? pk.map((c) => `t.${ident(c)}`).join(', ') : 'ctid'} limit ${batch}${pk.length ? '' : ` offset ${offset}`}`;
    let rows;
    try { rows = await q(sql); } catch (e) {
      if (isTimeout(e) && batch > 25) { batch = Math.max(25, Math.floor(batch / 2)); continue; }
      throw e;
    }
    if (!rows.length) break;
    const json = JSON.stringify(rows.map((x) => x.r));
    if (json.includes(TAG)) throw new Error(`${key}: data contains the quote tag`);
    await w(`insert into ${qn(schema, table)} (${insertable.join(', ')})${override} select ${insertable.join(', ')} from jsonb_populate_recordset(null::${qn(schema, table)}, ${TAG}${json}${TAG}::jsonb) on conflict do nothing;\n`);
    written += rows.length; offset += rows.length;
    const lr = rows[rows.length - 1].r; last = Object.fromEntries(pk.map((c) => [c, lr[c]]));
    if (rows.length < batch) break;
    if (batch < 1000) batch = Math.min(1000, Math.ceil(batch * 1.25));
    if (expected > 20000 && written % 10000 < batch) console.log(`[data] ${key}: ${written}/${expected} …`);
  }
  manifest.tables[key] = { expected, written };
  console.log(`[data] ${key}: ${written}/${expected}`);
}
await new Promise((res) => { ws.on('finish', res); gz.end(); });

// ---- storage files + vault names ------------------------------------------------------------------
if (SUPABASE_SERVICE_KEY) {
  for (const o of await q("select bucket_id, name from storage.objects order by 1, 2")) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(o.bucket_id)}/${o.name.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
    const key = `${o.bucket_id}/${o.name}`;
    if (!r.ok) { manifest.files[key] = { error: `HTTP ${r.status}` }; continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const p = join(out, 'storage', o.bucket_id, ...o.name.split('/'));
    mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf);
    manifest.files[key] = { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  }
} else manifest.files = { note: 'SUPABASE_SERVICE_KEY not set — files not downloaded' };
const names = await q('select name, description, created_at from vault.secrets order by name').catch(() => []);
writeFileSync(join(out, 'vault-secret-names.txt'), names.map((s) => `${s.name}\t${s.description || ''}\t${s.created_at}`).join('\n') + '\n');

for (const f of ['01-schema-pre.sql', '02-data.sql.gz', '03-schema-post.sql']) manifest.files[f] = { sha256: createHash('sha256').update(readFileSync(join(out, f))).digest('hex') };
const short = Object.entries(manifest.tables).filter(([, v]) => v.error || v.written < v.expected);
manifest.complete = short.length === 0;
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(out, 'RESTORE.md'), `# Restoring this Seen backup

Made ${manifest.exported_at} from Supabase project \`${ref}\`. Load the three SQL files IN ORDER:

\`\`\`
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01-schema-pre.sql
gunzip -c 02-data.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 03-schema-post.sql
\`\`\`

- **New Supabase project:** DATABASE_URL is in the dashboard → Connect → "Session pooler" (or Direct) connection string.
  The \`auth\`, \`storage\` and \`extensions\` schemas already exist there; this backup adds the rows.
- **Plain Postgres:** create the roles \`anon\`, \`authenticated\`, \`service_role\` and an \`auth\` schema with
  \`auth.uid()\`/\`auth.jwt()\` first (the security policies refer to them).
- **Files:** upload \`storage/<bucket>/…\` back into the same buckets (dashboard → Storage, or the Storage API).
- **Vault secrets:** recreate by hand — names are in vault-secret-names.txt (values never leave a project).
- **Users keep their passwords:** auth.users carries the password hashes, so accounts sign in as before.

manifest.json has the row count of every table at export time and what was written (complete: ${manifest.complete}).
`);
console.log(JSON.stringify({ ok: true, complete: manifest.complete, short: short.map(([k, v]) => ({ table: k, ...v })), out }, null, 2));
