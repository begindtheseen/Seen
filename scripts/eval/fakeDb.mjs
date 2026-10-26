// A fake Supabase (PostgREST + auth) for running the real api/*.js handlers in-process.
// It records every credit charge, so the harness can prove which calls spent a credit.
// No request leaves the process: any host other than the fake DB is answered 503 and logged.
import { createHmac } from 'node:crypto';

/** The platform fetch, kept before the fake replaces it — only prod.mjs (live calls) uses it. */
export const realFetch = globalThis.fetch.bind(globalThis);
export const DB_HOST = 'db.eval.local';
export const JWT_SECRET = 'eval-secret';
export const UID = 'e7a1e7a1-0000-4000-8000-000000000001';

export function installEnv() {
  process.env.SUPABASE_URL = `https://${DB_HOST}`;
  process.env.SUPABASE_SERVICE_KEY = 'eval-service-key';
  process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
  delete process.env.SEENFIT_ENGINE_ENABLED;
  delete process.env.HUMANPROOF_ENABLED;
  delete process.env.HUMANPROOF_PAID_ONLY;
}

export function token(sub = UID, email = 'eval@example.test') {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

/** state.pro decides what consume_credit / ai_credits answer; state.resume feeds profiles. */
export function installFetch(state) {
  state.charges = state.charges || [];
  state.unexpected = state.unexpected || [];
  state.runs = state.runs || [];
  globalThis.fetch = async (url, opts = {}) => {
    let u;
    try { u = new URL(String(url)); } catch { return json({ error: 'bad url' }, 400); }
    const method = (opts.method || 'GET').toUpperCase();
    if (u.hostname !== DB_HOST) { state.unexpected.push(`${method} ${u.hostname}${u.pathname}`); return json({ error: 'offline' }, 503); }
    const path = u.pathname;
    if (path === '/auth/v1/user') return json({ id: UID, email: 'eval@example.test' });
    if (path === '/rest/v1/rpc/increment_rate_limit') return json(1);
    if (path === '/rest/v1/rpc/consume_credit') {
      const b = JSON.parse(opts.body || '{}');
      if (b.p_pro_only && !state.pro) return json([{ status: 'pro_required', balance: 3, pro: false }]);
      state.charges.push({ reason: b.p_reason, tool: state.currentTool || '?' });
      return json([{ status: 'ok', balance: state.pro ? 999 : 3, pro: !!state.pro }]);
    }
    if (path === '/rest/v1/feature_flags') {
      const q = u.searchParams.get('flag_name') || '';
      const names = q.startsWith('in.(') ? q.slice(4, -1).split(',') : [q.replace(/^eq\./, '')];
      return json(names.map((n) => ({ flag_name: n, status: n === 'local_humanizer_model_enabled' ? 'off' : 'fully_on' })));
    }
    if (path === '/rest/v1/ai_credits') {
      if (method !== 'GET') return new Response(null, { status: 204 });
      return json([{ user_id: UID, balance: 3, purchased_credits: 0, daily_earned: 0, last_reset: '2099-01-01', pro: !!state.pro, pro_until: null }]);
    }
    if (path === '/rest/v1/optimizer_runs') {
      if (method === 'POST') { const row = JSON.parse(opts.body || '{}'); state.runs.push({ ...row, created_at: new Date().toISOString() }); return json([{ id: `run-${state.runs.length}` }], 201); }
      const uid = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
      const jobId = (u.searchParams.get('job_id') || '').replace(/^eq\./, '');
      return json(state.runs.filter((r) => r.user_id === uid && r.job_id === jobId).slice(-1));
    }
    if (path === '/rest/v1/profiles') return json(method === 'GET' ? [{ resume_text: state.resume || '', name: 'eval.pro.1025' }] : []);
    if (method === 'GET') return json([]);
    return json([], 201);
  };
}

export function mockRes() {
  return {
    code: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
    send(b) { this.body = b; return this; },
    end(b) { if (b !== undefined) this.body = b; return this; },
  };
}

let ipSeq = 1;
export async function callHandler(handler, body, { auth = true } = {}) {
  const res = mockRes();
  const req = {
    method: 'POST', body, query: {},
    headers: { origin: 'https://seenjobs.io', ...(auth ? { authorization: `Bearer ${token()}` } : {}) },
    socket: { remoteAddress: `10.9.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}` },
  };
  const t0 = performance.now();
  let error = null;
  try { await handler(req, res); } catch (e) { error = String(e && e.stack || e); res.code = 599; }
  return { status: res.code, body: res.body, headers: res.headers, ms: Math.round(performance.now() - t0), error };
}
