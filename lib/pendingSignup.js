// The verify screen's memory of the signup it is waiting on (app/login/page.tsx), so a reload, a
// back-navigation or a repeat signup does not strand the person on the account form (audit
// 2026-10-24 H3: the tab that waited 116 s had been reloaded, re-signed-up inside the email throttle
// window, and was sitting on "Set a password" with "For security purposes…" — never on the verify
// screen it was supposed to be watching).
//
// sessionStorage (this tab only, gone when it closes). Holds the address and the user id supabase-js
// returned from signUp — NEVER the password. Expires after the confirmation link's own lifetime.
// Plain JS so node --test can exercise it.

export const PENDING_SIGNUP_KEY = 'seen_pending_verify';
export const PENDING_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function store(s) {
  if (s) return s;
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

/** Remember the signup this tab is waiting on. A missing/invalid id keeps the one already stored
 *  for the SAME address (a throttled repeat signup returns no user). */
export function savePendingSignup({ email, uid, type = 'seeker' }, s, now = Date.now()) {
  const st = store(s); if (!st) return;
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return;
  const prev = readPendingSignup(st, now);
  const id = UUID_RE.test(String(uid || '')) ? String(uid) : (prev && prev.email === addr ? prev.uid : null);
  try { st.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ email: addr, uid: id, type: type === 'employer' ? 'employer' : 'seeker', at: now })); } catch { /* storage full / blocked */ }
}

/** The pending signup, or null (none, malformed, or older than the link's lifetime). */
export function readPendingSignup(s, now = Date.now()) {
  const st = store(s); if (!st) return null;
  try {
    const v = JSON.parse(st.getItem(PENDING_SIGNUP_KEY) || 'null');
    if (!v || typeof v.email !== 'string' || !v.email.includes('@') || typeof v.at !== 'number') return null;
    if (now - v.at > PENDING_SIGNUP_TTL_MS) { st.removeItem(PENDING_SIGNUP_KEY); return null; }
    return { email: v.email, uid: UUID_RE.test(String(v.uid || '')) ? v.uid : null, type: v.type === 'employer' ? 'employer' : 'seeker', at: v.at };
  } catch { return null; }
}

export function clearPendingSignup(s) {
  const st = store(s); if (!st) return;
  try { st.removeItem(PENDING_SIGNUP_KEY); } catch { /* ignore */ }
}

/** Supabase's email throttle ("For security purposes, you can only request this after N seconds",
 *  429 over_email_send_rate_limit). On a REPEAT signup it means a link was sent moments ago. */
export function isEmailThrottle(err) {
  if (!err) return false;
  return err.status === 429 || err.code === 'over_email_send_rate_limit' || /security purposes|rate limit/i.test(String(err.message || ''));
}

/** Ask the server whether the pending account is confirmed (api/signup-status.js). true / false, or
 *  null when the answer could not be had (offline, 429, 5xx) — the caller keeps polling. */
export async function signupConfirmed(uid, fetchImpl = fetch) {
  if (!UUID_RE.test(String(uid || ''))) return null;
  try {
    const r = await fetchImpl('/api/signup-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uid }) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j && typeof j.confirmed === 'boolean' ? j.confirmed : null;
  } catch { return null; }
}
