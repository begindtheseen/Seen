// Inbox Autopilot — the I/O: Supabase (service key, PostgREST) + Resend's Receiving API.
// Used by api/inbox-email.js (webhook + hourly catch-up) and api/user-sync.js (the user's own controls).
//
// Contract facts (verified 2026-10-21 against Resend's docs, not assumed):
//   - webhook `email.received` carries data.email_id and metadata only — never the body;
//   - GET https://api.resend.com/emails/receiving/{id} → { from, to, cc, bcc, received_for, subject, text,
//     html, headers, authentication{spf,dkim,dmarc}, created_at, … };
//   - GET https://api.resend.com/emails/receiving?limit=N → { data:[{ id, to, from, created_at, … }], has_more }
//     (newest first; no received_for — a forwarded email's recipient is only in the detail).
// Seen reads the email by id with its OWN key, so a forged webhook can at most make Seen re-read an email
// Resend really received for seenjobs.io; the one-row-per-email claim makes every replay a no-op.

import { newToken, tokensFromEmail, addressFor } from './address.js';
import { classifyEmail } from './classify.js';
import { planChange } from './apply.js';

const RESEND_API = 'https://api.resend.com';
const ROW_FIELDS = 'id,company_name,role,status,stage,events,applied_at,created_at';
// What the user pastes into Gmail's "Has the words": OR of phrases job emails use. Kept narrow on purpose —
// received mail counts toward the free Resend quota, and anything else is ignored by the rules anyway.
export const GMAIL_FILTER = '{"thank you for applying" "thanks for applying" "received your application" "application received" "your application" "your candidacy" "schedule an interview" "interview invitation" "phone screen" "assessment" "offer letter" "other candidates" "moving forward"}';

export function dbClient(url, key, fetchImpl = fetch) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return (path, opts = {}) => fetchImpl(`${url}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
}

export function resendClient(key, fetchImpl = fetch) {
  const h = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const call = async (path) => {
    let r;
    try { r = await fetchImpl(`${RESEND_API}${path}`, { headers: h, signal: AbortSignal.timeout(15000) }); }
    catch (e) { return { ok: false, status: 0, error: `network: ${e.cause?.code || e.message}` }; }
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: r.status, error: (body && (body.message || body.name)) || `HTTP ${r.status}` };
    return { ok: true, status: r.status, body };
  };
  return {
    get: (id) => call(`/emails/receiving/${encodeURIComponent(id)}`),
    list: (limit = 100) => call(`/emails/receiving?limit=${Math.min(100, Math.max(1, limit))}`),
  };
}

/** Is the migration applied? (Everything answers "not set up yet" until it is.) */
export async function tablesReady(q) {
  const r = await q('inbox_addresses?select=user_id&limit=1').catch(() => null);
  return !!(r && r.ok);
}

/** Resend ids are UUIDs; anything else never reaches a query. */
export const isProviderId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

const rows = async (r) => (r && r.ok ? (await r.json().catch(() => [])) : []);

export async function getAddress(q, uid) {
  return (await rows(await q(`inbox_addresses?user_id=eq.${uid}&select=*&limit=1`)))[0] || null;
}

/** Create (or, with regenerate, replace) the user's address. A token collision just tries again. */
export async function ensureAddress(q, uid, { regenerate = false } = {}) {
  const existing = await getAddress(q, uid);
  if (existing && !regenerate) return existing;
  for (let i = 0; i < 4; i++) {
    const token = newToken();
    const r = existing
      ? await q(`inbox_addresses?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ token, forwarding_confirm: null }), headers: { Prefer: 'return=representation' } })
      : await q('inbox_addresses', { method: 'POST', body: JSON.stringify({ user_id: uid, token }), headers: { Prefer: 'return=representation' } });
    if (r.ok) return (await rows(r))[0] || null;
    if (r.status !== 409) throw new Error(`could not save the address (HTTP ${r.status})`);
  }
  throw new Error('could not find a free address — try again');
}

export async function setPaused(q, uid, paused) {
  const r = await q(`inbox_addresses?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ paused: !!paused }), headers: { Prefer: 'return=minimal' } });
  return r.ok;
}

/** Turn it off: the address stops working and every stored detail goes. Tracker cards stay. */
export async function disable(q, uid) {
  const a = await q(`inbox_events?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  const b = await q(`inbox_addresses?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  return a.ok && b.ok;
}

const EVENT_FIELDS = 'id,received_at,state,kind,company,role,vendor,sender_name,sender_domain,confidence,application_id,share_state';

export async function status(q, uid) {
  if (!(await tablesReady(q))) return { ready: false };
  const addr = await getAddress(q, uid);
  if (!addr) return { ready: true, enabled: false };
  const events = await rows(await q(`inbox_events?user_id=eq.${uid}&state=in.(applied,unplaced)&select=${EVENT_FIELDS}&order=received_at.desc&limit=30`));
  return {
    ready: true, enabled: true, address: addressFor(addr.token), paused: !!addr.paused,
    received_count: addr.received_count || 0, last_received_at: addr.last_received_at || null,
    forwarding_confirm: addr.forwarding_confirm || null, gmail_filter: GMAIL_FILTER, events,
  };
}

async function userApps(q, uid) {
  return rows(await q(`applications?user_id=eq.${uid}&select=${ROW_FIELDS}&order=created_at.desc&limit=500`));
}

/** Apply a plan to the tracker. Returns the application id it touched, or null. */
export async function applyPlan(q, uid, plan) {
  if (plan.action === 'create') {
    const r = await q('applications', { method: 'POST', body: JSON.stringify({ ...plan.row, user_id: uid }), headers: { Prefer: 'return=representation' } });
    if (!r.ok) throw new Error(`tracker insert failed (HTTP ${r.status})`);
    return (await rows(r))[0]?.id || null;
  }
  if (plan.action === 'update') {
    const r = await q(`applications?id=eq.${plan.appId}&user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ ...plan.patch, updated_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
    if (!r.ok) throw new Error(`tracker update failed (HTTP ${r.status})`);
    return plan.appId;
  }
  return plan.appId || null;
}

/** Claim one email (one row per provider id). false = someone already has it. */
async function claim(q, id) {
  const r = await q('inbox_events?on_conflict=provider_email_id', { method: 'POST', body: JSON.stringify({ provider_email_id: String(id), state: 'processing' }), headers: { Prefer: 'resolution=ignore-duplicates,return=representation' } });
  if (!r.ok) throw new Error(`claim failed (HTTP ${r.status})`);
  const got = await rows(r);
  return got.length ? got[0].id : null;
}

const mark = (q, eventId, fields) => q(`inbox_events?id=eq.${eventId}`, { method: 'PATCH', body: JSON.stringify(fields), headers: { Prefer: 'return=minimal' } });

/**
 * Process one received email end to end. Returns { state, … } — never throws for an expected outcome.
 * A transient read failure releases the claim so the hourly catch-up retries it.
 */
export async function processEmail({ q, resend, id }) {
  if (!isProviderId(id)) return { state: 'bad_id' };
  const eventId = await claim(q, id);
  if (!eventId) return { state: 'duplicate' };
  const got = await resend.get(id);
  if (!got.ok) {
    if (got.status === 401 || got.status === 403) {
      await q(`inbox_events?id=eq.${eventId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return { state: 'resend_forbidden', error: got.error };
    }
    // An id Resend never received (a forged or stale webhook) leaves nothing behind.
    if (got.status === 404) { await q(`inbox_events?id=eq.${eventId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); return { state: 'unknown_email' }; }
    await q(`inbox_events?id=eq.${eventId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return { state: 'retry', error: got.error };
  }
  const email = got.body || {};
  const receivedAt = Date.parse(email.created_at || '') || Date.now();
  const tokens = tokensFromEmail(email);
  const addr = tokens.length ? (await rows(await q(`inbox_addresses?token=in.(${tokens.join(',')})&select=*&limit=1`)))[0] : null;
  if (!addr) { await mark(q, eventId, { state: 'not_ours', received_at: new Date(receivedAt).toISOString() }); return { state: 'not_ours' }; }
  const uid = addr.user_id;
  if (addr.paused) { await mark(q, eventId, { state: 'paused', user_id: uid, received_at: new Date(receivedAt).toISOString() }); return { state: 'paused' }; }

  const cls = classifyEmail(email);
  const facts = {
    user_id: uid, received_at: new Date(receivedAt).toISOString(), kind: cls.kind,
    company: cls.company || null, role: cls.role || null, vendor: cls.vendor || null,
    sender_name: cls.senderName || null, sender_domain: cls.senderDomain || null, confidence: cls.confidence,
  };
  const counted = { received_count: (addr.received_count || 0) + 1, last_received_at: facts.received_at };

  if (cls.kind === 'forwarding_confirm') {
    await q(`inbox_addresses?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ ...counted, forwarding_confirm: { ...cls.forwardingConfirm, at: facts.received_at } }), headers: { Prefer: 'return=minimal' } });
    await mark(q, eventId, { ...facts, state: 'ignored' });
    return { state: 'forwarding_confirm' };
  }

  const plan = planChange(cls, await userApps(q, uid), { at: receivedAt });
  let applicationId = null;
  try { applicationId = await applyPlan(q, uid, plan); }
  catch (e) { await mark(q, eventId, { ...facts, state: 'failed' }); return { state: 'failed', error: e.message }; }
  const state = plan.action === 'unplaced' ? 'unplaced' : plan.action === 'ignore' ? 'ignored' : 'applied';
  await mark(q, eventId, { ...facts, state, application_id: applicationId, share_state: plan.share && (plan.action === 'create' || plan.action === 'update') ? 'ask' : null });
  // A real job email means forwarding works: the confirmation code is no longer needed on screen.
  const clearConfirm = state === 'applied' && addr.forwarding_confirm ? { forwarding_confirm: null } : {};
  await q(`inbox_addresses?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ ...counted, ...clearConfirm }), headers: { Prefer: 'return=minimal' } });
  return { state, action: plan.action, kind: cls.kind, reason: plan.reason };
}

/** Hourly safety net: read the newest received emails and process the ones no webhook delivered. */
export async function catchUp({ q, resend, budgetMs = 45000, max = 60, now = Date.now }) {
  const started = now();
  const listed = await resend.list(100);
  if (!listed.ok) return { ok: false, error: listed.error, status: listed.status };
  const ids = (listed.body?.data || []).map((e) => e && e.id).filter(isProviderId);
  if (!ids.length) return { ok: true, listed: 0, processed: 0, results: {} };
  const known = new Set((await rows(await q(`inbox_events?provider_email_id=in.(${ids.map((i) => `"${i}"`).join(',')})&select=provider_email_id`))).map((r) => r.provider_email_id));
  const todo = ids.filter((i) => !known.has(i)).reverse().slice(0, max); // oldest first
  const results = {};
  for (const id of todo) {
    if (now() - started > budgetMs) { results.out_of_time = (results.out_of_time || 0) + 1; continue; }
    const r = await processEmail({ q, resend, id });
    results[r.state] = (results[r.state] || 0) + 1;
    if (r.state === 'resend_forbidden') return { ok: false, error: 'the Resend key cannot read received email (it needs Full access)', listed: ids.length, results };
  }
  // Rows that only exist so an email is never read twice (mail for other seenjobs.io addresses, paused,
  // unreadable) are dropped after 30 days — Resend keeps received mail far shorter than that.
  const cutoff = new Date(now() - 30 * 86400e3).toISOString();
  await q(`inbox_events?state=in.(not_ours,paused,failed,ignored)&created_at=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
  return { ok: true, listed: ids.length, processed: todo.length, results };
}

/** The user points an email Seen couldn't place at one of their applications. */
export async function assign(q, uid, eventId, applicationId) {
  const ev = (await rows(await q(`inbox_events?id=eq.${eventId}&user_id=eq.${uid}&select=${EVENT_FIELDS}&limit=1`)))[0];
  if (!ev) return { ok: false, error: 'not found' };
  if (ev.state !== 'unplaced') return { ok: false, error: 'already placed' };
  const app = (await rows(await q(`applications?id=eq.${applicationId}&user_id=eq.${uid}&select=${ROW_FIELDS}&limit=1`)))[0];
  if (!app) return { ok: false, error: 'application not found' };
  const at = Date.parse(ev.received_at) || Date.now();
  const plan = planChange({ kind: ev.kind, company: app.company_name, role: app.role, vendor: ev.vendor, stage: ev.kind === 'interview' ? 'Interview' : null }, [app], { at });
  const touched = await applyPlan(q, uid, plan);
  await mark(q, ev.id, { state: 'applied', application_id: touched, company: app.company_name, share_state: plan.share && plan.action === 'update' ? 'ask' : null });
  return { ok: true, action: plan.action };
}

export async function setShare(q, uid, eventId, choice) {
  if (!['shared', 'declined'].includes(choice)) return false;
  const r = await q(`inbox_events?id=eq.${eventId}&user_id=eq.${uid}&share_state=eq.ask`, { method: 'PATCH', body: JSON.stringify({ share_state: choice }), headers: { Prefer: 'return=minimal' } });
  return r.ok;
}
