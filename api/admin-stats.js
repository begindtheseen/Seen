// Internal Admin API — a small router. The work lives in lib/server/admin/*:
//   auth.js (requireAdmin — the one session check), audit.js (a destructive write that cannot be audited does
//   not happen), batch.js (ids in short chunks, counted writes, keyset paging, RPC-or-fallback), respond.js
//   (the contract: components/admin2/contract.ts), and one module per section.
// Every action and its exact answer: lib/server/admin/SHAPES.md. Old action names stay as aliases so
// /admin/legacy and Seen Command keep working.
//
// POST {action, ...} with X-Admin-Token answers AdminOk / AdminList / AdminErr. GET with no action is the
// legacy dashboard read; GET only ever reads.

import { fail, logSafe, AdminError } from '../lib/server/admin/respond.js';
import { requireAdmin } from '../lib/server/admin/auth.js';
import { makeDb } from '../lib/server/admin/batch.js';
import { login, logout } from '../lib/server/admin/session.js';
import { legacyDashboard } from '../lib/server/admin/legacyDashboard.js';
import { actions as overviewActions } from '../lib/server/admin/overview.js';
import { actions as reviewActions } from '../lib/server/admin/review.js';
import { actions as listingActions } from '../lib/server/admin/listings.js';
import { actions as companyActions } from '../lib/server/admin/companies.js';
import { actions as peopleActions } from '../lib/server/admin/people.js';
import { actions as employerActions } from '../lib/server/admin/employers.js';
import { actions as systemActions } from '../lib/server/admin/system.js';

// Budget constants other code and tests read (kept on this module's surface).
export { PURGE_BUDGET_MS, PURGE_BATCH, DEDUPE_SCAN_BUDGET_MS, DEDUPE_BUDGET_MS } from '../lib/server/admin/listings.js';
export { AUTO_MERGE_BUDGET_MS } from '../lib/server/admin/companies.js';
export { REPORT_DUPE_SCAN_BUDGET_MS, REPORT_DUPE_BUDGET_MS } from '../lib/server/admin/review.js';

export const ACTIONS = {
  ...overviewActions,
  ...reviewActions,
  ...listingActions,
  ...companyActions,
  ...peopleActions,
  ...employerActions,
  ...systemActions,
  admin_logout: logout,
};

// Read-only reads also reachable by GET ?action= (the legacy panels call them this way).
const GET_ACTIONS = new Set(['search_opportunities', 'signup_attribution', 'revenue_funnel']);

// The function limit is 60 s (vercel.json); handlers stop starting new work well before it.
const REQUEST_BUDGET_MS = 55_000;

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

function cors(req, res) {
  const o = String(req.headers.origin || '');
  const okOrigin = !o || ALLOWED.includes(o) || LOCAL_ORIGIN.test(o);
  res.setHeader('Access-Control-Allow-Origin', okOrigin ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  try {
    return await route(req, res);
  } catch (e) {
    if (e instanceof AdminError) return fail(res, e.status, e.message, e.extra || {});
    // Never echo internals; log one constant-format line.
    console.error('[admin-stats] unhandled: %s', logSafe(e?.message || e));
    return fail(res, 500, 'Internal server error', { code: 'upstream', retryable: true });
  }
}

async function route(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return fail(res, 500, 'Not configured', { retryable: false });
  const db = makeDb({ url, key });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  if (req.method === 'POST' && body.action === 'admin_login') return login(req, res, { db, url, key, body });

  const sess = await requireAdmin(req, { url, key, body });
  if (!sess) return fail(res, 401, 'Session expired — log in again', { code: 'unauthorized', retryable: false });

  const t0 = Date.now();
  const ctx = { req, res, db, url, key, sess, body, action: null, t0, deadline: t0 + REQUEST_BUDGET_MS };

  if (req.method === 'GET') {
    const action = String((req.query && req.query.action) || '');
    if (!action) return legacyDashboard(ctx);
    if (!GET_ACTIONS.has(action)) return fail(res, 400, `${action} is not a read; POST it.`, { code: 'bad_request' });
    ctx.action = action;
    ctx.body = { ...req.query };
    return ACTIONS[action](ctx);
  }

  const action = String(body.action || '');
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) return fail(res, 400, action ? `Unknown action: ${action.slice(0, 60)}` : 'action required', { code: 'unknown_action', actions: Object.keys(ACTIONS).sort() });
  ctx.action = action;
  return fn(ctx);
}
