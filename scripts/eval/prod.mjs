// Model-backed tools, called on a live deployment (production by default) as the eval account.
//
//   interview_prep  POST /api/interview-prep {action:'build'} — the model writes questions, answers, intro
//
// Credentials: the account file (columns: name email password user_id) is read at runtime from
// --accounts / EVAL_ACCOUNTS_FILE, row `eval`. The password and the session token are never written to
// disk or printed. Every response is cached under scripts/eval/.cache/ (git-ignored) keyed by the input,
// so a re-run skips finished calls unless --fresh. Rate limits are respected: the run reads
// X-RateLimit-Remaining and stops a tool when it falls to --reserve (default 5), and on a 429 it stops
// (or, with --wait, sleeps to the next hour) — it never tries to reset or bypass a limit.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepItems, prepOutput } from './tools.mjs';
import { realFetch as fetch } from './fakeDb.mjs';

const ROOT = new URL('../../', import.meta.url);
const CACHE = new URL('scripts/eval/.cache/', ROOT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

function supabasePublic() {
  const src = readFileSync(new URL('lib/supabase.ts', ROOT), 'utf8');
  const url = (src.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  const anon = (src.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
  if (!url || !anon) throw new Error('could not read the public Supabase URL / anon key from lib/supabase.ts');
  return { url, anon };
}

function readAccount(file, row = 'eval') {
  if (!file || !existsSync(file)) throw new Error('eval account file not found: pass --accounts <file> or set EVAL_ACCOUNTS_FILE (columns: name email password user_id)');
  const line = readFileSync(file, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).find((c) => c[0] === row);
  if (!line || line.length < 3) throw new Error(`row "${row}" not found in the account file`);
  return { email: line[1], password: line[2], user_id: line[3] || null };
}

export class ProdClient {
  constructor({ base = 'https://seenjobs.io', accounts, fresh = false, reserve = 5, paceMs = 15000, wait = false, log = console.log } = {}) {
    this.base = base.replace(/\/$/, '');
    this.host = new URL(this.base).host;
    this.accountsFile = accounts;
    this.fresh = fresh; this.reserve = reserve; this.paceMs = paceMs; this.wait = wait; this.log = log;
    this.token = null; this.lastCall = 0; this.stopped = {};
  }
  // A protected Vercel preview: EVAL_VERCEL_SHARE_FILE names a file holding a share link (from Vercel's
  // "share" / get_access_to_vercel_url). One visit sets the preview's auth cookie; the link itself is never
  // printed or passed on the command line.
  async previewCookie() {
    if (this.cookie !== undefined) return this.cookie;
    this.cookie = '';
    const f = process.env.EVAL_VERCEL_SHARE_FILE;
    if (!f || this.host === 'seenjobs.io') return this.cookie;
    const share = readFileSync(f, 'utf8').trim();
    const r = await fetch(share, { redirect: 'manual' });
    const set = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
    this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    this.log(`  preview access ${this.cookie ? 'granted' : 'NOT granted'} (${r.status})`);
    return this.cookie;
  }
  async signIn() {
    if (this.token) return;
    const { url, anon } = supabasePublic();
    const acct = readAccount(this.accountsFile);
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: acct.email, password: acct.password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`eval sign-in failed (${r.status}): ${j.error_description || j.msg || j.error || 'no token'}`);
    this.token = j.access_token;
    this.userId = j.user?.id || acct.user_id;
    this.log(`  signed in as the eval account (${acct.email.replace(/^(.).*(@.*)$/, '$1…$2')})`);
  }
  cachePath(tool, fxId) { return new URL(`${this.host}/${tool}/${fxId}.json`, CACHE); }
  readCache(tool, fxId, key) {
    const p = this.cachePath(tool, fxId);
    if (this.fresh || !existsSync(p)) return null;
    try { const c = JSON.parse(readFileSync(p, 'utf8')); return c.key === key ? c : null; } catch { return null; }
  }
  writeCache(tool, fxId, rec) {
    const p = this.cachePath(tool, fxId);
    mkdirSync(new URL('./', p), { recursive: true });
    writeFileSync(p, JSON.stringify(rec, null, 2));
  }
  async post(path, body, { model = false } = {}) {
    await this.signIn();
    if (model) { const gap = Date.now() - this.lastCall; if (gap < this.paceMs) await sleep(this.paceMs - gap); }
    const t0 = Date.now();
    const cookie = await this.previewCookie();
    const r = await fetch(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`, Origin: 'https://seenjobs.io', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const ms = Date.now() - t0;
    if (model) this.lastCall = Date.now();
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, ms, remaining: r.headers.get('x-ratelimit-remaining'), limit: r.headers.get('x-ratelimit-limit'), vercelId: r.headers.get('x-vercel-id'), body: json ?? text.slice(0, 500) };
  }
  async saveResume(text) {
    const r = await this.post('/api/user-sync', { action: 'save_resume', text, fileName: 'eval-fixture.txt', wordCount: text.split(/\s+/).length });
    if (r.status !== 200) throw new Error(`save_resume failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  /** Returns { rec, fromCache } or { rec: null, deferred: reason }. */
  async call(tool, fx, key, fn) {
    const cached = this.readCache(tool, fx.id, key);
    if (cached) return { rec: cached.rec, fromCache: true };
    if (this.stopped[tool]) return { rec: null, deferred: this.stopped[tool] };
    for (;;) {
      const resp = await fn();
      if (resp.status === 429) {
        if (!this.wait) { this.stopped[tool] = 'rate limit reached (429) — re-run later to resume'; return { rec: null, deferred: this.stopped[tool] }; }
        const ms = 3_600_000 - (Date.now() % 3_600_000) + 60_000;
        this.log(`  429 on ${tool}; waiting ${Math.round(ms / 60000)} min for the next hour window`);
        await sleep(ms); continue;
      }
      const remaining = resp.remaining == null ? null : Number(resp.remaining);
      if (remaining != null && remaining <= this.reserve) this.stopped[tool] = `stopped with ${remaining} calls left in this hour (reserve ${this.reserve}) — re-run later to resume`;
      const rec = { resp, at: new Date().toISOString() };
      if (resp.status === 200) this.writeCache(tool, fx.id, { key, rec });
      return { rec, fromCache: false };
    }
  }
}

/** Interview Prep build, exactly as the tracker card sends it (no job_text — see InterviewPrep.tsx). */
export async function prodInterviewPrep(client, fx, { withJobText = false } = {}) {
  const tool = withJobText ? 'interview_prep_jobtext' : 'interview_prep';
  const body = { action: 'build', company: fx.job.company, role: fx.job.title, refresh: true, ...(withJobText ? { job_text: fx.jd } : {}) };
  const key = hash({ v: 1, resume: fx.resumeText, body });
  const res = await client.call(tool, fx, key, async () => { await client.saveResume(fx.resumeText); return client.post('/api/interview-prep', body, { model: true }); });
  return toPrepRecord(tool, res);
}
function toPrepRecord(tool, res) {
  if (!res.rec) return { tool, status: 0, ms: 0, charged: 0, error: null, deferred: res.deferred, ui_reachable: tool === 'interview_prep', output: { deferred: res.deferred }, items: [], meta: {} };
  const r = res.rec.resp;
  const p = r.body?.pack || {};
  const rec = { tool, status: r.status, ms: r.ms, charged: 0, error: r.status >= 400 ? JSON.stringify(r.body).slice(0, 300) : null, ui_reachable: tool === 'interview_prep', from_cache: !!res.fromCache, output: prepOutput(p), items: [], meta: { family: p.family, remaining: r.remaining, at: res.rec.at } };
  prepItems(rec.items, p);
  return rec;
}
