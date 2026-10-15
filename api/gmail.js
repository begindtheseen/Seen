// Gmail auto-capture — OAuth + sync (data-acquisition engine, stage 2). Connects a job-seeker's
// Gmail (read-only, HEADERS ONLY via gmail.metadata scope), pulls likely-hiring mail, runs the
// deterministic classifier (lib/server/emailClassifier.js), and stores SUGGESTIONS in gmail_captures.
// The user confirms suggestions into their tracker (reusing user-sync add_application) — nothing
// touches a company's aggregate score until they do.
//
// GATED: no-ops with a clear error until the owner sets GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
// (+ a token-encryption key: GMAIL_TOKEN_KEY, falling back to SUPABASE_JWT_SECRET). See PR/GMAIL_SETUP.
//
// Actions: connect · callback (Google redirect) · status · sync · sync_all (cron) · captures ·
// confirm · dismiss · disconnect.

import { resolveAuthedUser } from '../lib/server/credits.js';
import { classifyEmail } from '../lib/server/emailClassifier.js';
import {
  encryptToken, decryptToken, signState, verifyState, buildAuthUrl, buildGmailQuery,
  headerValue, gmailCaptureRow, GMAIL_SCOPES,
} from '../lib/server/gmailAuth.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];
const MAX_MESSAGES = 50; // per sync — keep well within function time + Gmail quota

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const env = () => ({
  CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  TOKEN_KEY: process.env.GMAIL_TOKEN_KEY || process.env.SUPABASE_JWT_SECRET,
  STATE_SECRET: process.env.SUPABASE_JWT_SECRET || process.env.GMAIL_TOKEN_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
});

const redirectUri = (req) =>
  process.env.GMAIL_REDIRECT_URI ||
  `${(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}/api/gmail?action=callback`;

const dbFor = (SUPABASE_URL, SERVICE_KEY) => (path, opts = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

// Exchange an authorization code (or refresh token) for tokens at Google's token endpoint.
async function googleToken(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// Pull likely-hiring messages (headers only) and turn fresh ones into capture rows.
async function syncConnection(conn, e, db) {
  const refresh = decryptToken(conn.refresh_token_enc, e.TOKEN_KEY);
  if (!refresh) return { ok: false, reason: 'decrypt_failed' };

  const tok = await googleToken({
    client_id: e.CLIENT_ID, client_secret: e.CLIENT_SECRET,
    refresh_token: refresh, grant_type: 'refresh_token',
  });
  const access = tok?.access_token;
  if (!access) return { ok: false, reason: 'refresh_failed' };
  const gh = { Authorization: `Bearer ${access}` };

  const q = encodeURIComponent(buildGmailQuery(30));
  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${MAX_MESSAGES}`, { headers: gh });
  if (!listRes.ok) return { ok: false, reason: 'list_failed' };
  const ids = ((await listRes.json())?.messages || []).map((m) => m.id).filter(Boolean);

  let captured = 0;
  for (const id of ids) {
    try {
      const mRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: gh });
      if (!mRes.ok) continue;
      const msg = await mRes.json();
      const headers = msg?.payload?.headers || [];
      const cls = classifyEmail({
        from: headerValue(headers, 'From'),
        subject: headerValue(headers, 'Subject'),
        date: headerValue(headers, 'Date'),
        uid: conn.user_id,
      });
      // Require a real hiring email WITH an attributable company — otherwise it's not an actionable
      // tracker suggestion.
      if (!cls.isHiring || !cls.company) continue;
      const receivedMs = Number(msg.internalDate) || Date.parse(headerValue(headers, 'Date')) || Date.now();
      const ins = await db('gmail_captures?on_conflict=user_id,message_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(gmailCaptureRow(conn.user_id, id, cls, receivedMs)),
      });
      if (ins.ok) captured += 1;
    } catch { /* skip a bad message, keep syncing */ }
  }

  await db(`gmail_connections?user_id=eq.${encodeURIComponent(conn.user_id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_sync_at: new Date().toISOString(), last_error: null }),
  });
  return { ok: true, scanned: ids.length, captured };
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const e = env();
  const action = req.query?.action || (req.body && req.body.action);
  if (!e.SUPABASE_URL || !e.SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });
  const db = dbFor(e.SUPABASE_URL, e.SERVICE_KEY);
  const configured = !!(e.CLIENT_ID && e.CLIENT_SECRET && e.TOKEN_KEY);

  // ── Google's OAuth redirect (top-level browser navigation) ───────────────────
  if (action === 'callback') {
    const back = (status) => res.redirect(302, `/tracker?gmail=${status}`);
    if (!configured) return back('unconfigured');
    const code = req.query?.code;
    const uid = verifyState(req.query?.state, e.STATE_SECRET);
    if (!code || !uid) return back('error');
    try {
      const tok = await googleToken({
        code, client_id: e.CLIENT_ID, client_secret: e.CLIENT_SECRET,
        redirect_uri: redirectUri(req), grant_type: 'authorization_code',
      });
      if (!tok?.refresh_token) return back('error'); // no refresh token (user may have pre-consented)
      let email = null;
      if (tok.access_token) {
        const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
        if (ui.ok) email = (await ui.json())?.email || null;
      }
      const up = await db('gmail_connections?on_conflict=user_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: uid, email, scope: GMAIL_SCOPES.join(' '),
          refresh_token_enc: encryptToken(tok.refresh_token, e.TOKEN_KEY),
          connected_at: new Date().toISOString(), last_error: null,
        }),
      });
      return back(up.ok ? 'connected' : 'error');
    } catch { return back('error'); }
  }

  // ── Cron: sync every connected user ──────────────────────────────────────────
  const isCron = req.method === 'GET' && (req.headers['x-vercel-cron'] || req.query?.cron);
  if (action === 'sync_all' && isCron) {
    if (!configured) return res.status(200).json({ ok: true, skipped: 'unconfigured' });
    const r = await db('gmail_connections?select=user_id,refresh_token_enc&limit=1000');
    const conns = r.ok ? await r.json() : [];
    let synced = 0, captured = 0;
    for (const conn of conns) {
      const out = await syncConnection(conn, e, db).catch(() => ({ ok: false }));
      if (out.ok) { synced += 1; captured += out.captured || 0; }
    }
    return res.status(200).json({ ok: true, connections: conns.length, synced, captured });
  }

  // ── Everything else requires an authenticated Seen user ──────────────────────
  const authed = await resolveAuthedUser(req);
  if (!authed?.uid) return res.status(401).json({ error: 'Sign in first' });
  const uid = authed.uid;

  if (action === 'connect') {
    if (!configured) return res.status(503).json({ error: 'Gmail connect is not configured yet', reason: 'unconfigured' });
    return res.status(200).json({ url: buildAuthUrl({ clientId: e.CLIENT_ID, redirectUri: redirectUri(req), state: signState(uid, e.STATE_SECRET) }) });
  }

  if (action === 'status') {
    const cr = await db(`gmail_connections?user_id=eq.${encodeURIComponent(uid)}&select=email,last_sync_at&limit=1`);
    const conn = cr.ok ? (await cr.json())[0] : null;
    const sc = await db(`gmail_captures?user_id=eq.${encodeURIComponent(uid)}&status=eq.suggested&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } });
    const suggested = sc.ok ? Number((sc.headers.get('content-range') || '0/0').split('/')[1]) || 0 : 0;
    return res.status(200).json({ ok: true, configured, connected: !!conn, email: conn?.email || null, last_sync_at: conn?.last_sync_at || null, suggested });
  }

  if (action === 'sync') {
    if (!configured) return res.status(503).json({ error: 'Gmail is not configured yet', reason: 'unconfigured' });
    const cr = await db(`gmail_connections?user_id=eq.${encodeURIComponent(uid)}&select=user_id,refresh_token_enc&limit=1`);
    const conn = cr.ok ? (await cr.json())[0] : null;
    if (!conn) return res.status(400).json({ error: 'Gmail not connected' });
    const out = await syncConnection(conn, e, db);
    if (!out.ok) {
      await db(`gmail_connections?user_id=eq.${encodeURIComponent(uid)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_error: out.reason }) }).catch(() => {});
      return res.status(502).json({ error: 'Sync failed — try reconnecting Gmail', reason: out.reason });
    }
    return res.status(200).json({ ok: true, ...out });
  }

  if (action === 'captures') {
    const r = await db(`gmail_captures?user_id=eq.${encodeURIComponent(uid)}&status=eq.suggested&select=id,message_id,signature,company,event,outcome,confidence,sender_domain,received_at&order=received_at.desc&limit=100`);
    return res.status(200).json({ ok: true, captures: r.ok ? await r.json() : [] });
  }

  if ((action === 'confirm' || action === 'dismiss') && req.method === 'POST') {
    const id = (req.body || {}).id;
    if (!id) return res.status(400).json({ error: 'id required' });
    // Scope the update to the caller's own rows — never trust a client-supplied user.
    const r = await db(`gmail_captures?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(uid)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: action === 'confirm' ? 'confirmed' : 'dismissed' }),
    });
    return res.status(r.ok ? 200 : 400).json({ ok: r.ok });
  }

  if (action === 'disconnect' && req.method === 'POST') {
    await db(`gmail_connections?user_id=eq.${encodeURIComponent(uid)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
