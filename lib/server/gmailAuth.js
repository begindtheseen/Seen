// Server-side Gmail OAuth + sync helpers (auto-capture, stage 2). Pure/deterministic where possible
// so the security-sensitive bits (token encryption, CSRF state, the Gmail query) are unit-testable.
//
// SECURITY:
//  - Refresh tokens grant ongoing inbox access → encrypted at rest with AES-256-GCM (app-layer, on
//    top of Supabase's at-rest encryption) and stored in a server-only (RLS deny-all) table.
//  - The OAuth `state` is an HMAC-signed uid, so the callback can trust which user it's binding
//    without a session cookie, and a forged state is rejected (CSRF defense).
//  - Scope is gmail.metadata (headers only) — NOT restricted gmail.readonly — matching the
//    headers-only classifier and dodging Google's CASA security assessment.

import { createCipheriv, createDecipheriv, randomBytes, createHmac, createHash, timingSafeEqual } from 'crypto';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/userinfo.email',
];

const keyFrom = (secret) => createHash('sha256').update(String(secret || '')).digest(); // 32 bytes

// AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext). Returns null on empty input.
export function encryptToken(plaintext, secret) {
  if (!plaintext || !secret) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptToken(blob, secret) {
  if (!blob || !secret) return null;
  try {
    const [ivB, tagB, ctB] = String(blob).split('.');
    if (!ivB || !tagB || !ctB) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

// HMAC-signed state: "<uid>.<sig>". uid must be base64url-safe (Supabase UUIDs are).
export function signState(uid, secret) {
  const sig = createHmac('sha256', String(secret || '')).update(String(uid)).digest('base64url');
  return `${uid}.${sig}`;
}

export function verifyState(state, secret) {
  const s = String(state || '');
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return null;
  const uid = s.slice(0, dot);
  const sig = s.slice(dot + 1);
  const expected = createHmac('sha256', String(secret || '')).update(uid).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return uid;
}

export function buildAuthUrl({ clientId, redirectUri, state }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',      // request a refresh token
    prompt: 'consent',           // ensure a refresh token even on re-consent
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

// Narrow the Gmail search to likely-hiring mail so sync pulls tens, not thousands, of messages.
// Combines ATS/recruiting senders with hiring subject phrases, bounded by recency.
export function buildGmailQuery(sinceDays = 30) {
  const n = Number(sinceDays);
  const days = Math.max(1, Math.floor(Number.isFinite(n) ? n : 30));
  const senders = [
    'greenhouse.io', 'greenhouse-mail.io', 'hire.lever.co', 'lever.co', 'ashbyhq.com',
    'smartrecruiters.com', 'myworkday.com', 'icims.com', 'workable.com', 'jobvite.com',
    'bamboohr.com', 'taleo.net', 'recruitee.com', 'teamtailor.com', 'breezy.hr',
  ].map((d) => `from:${d}`);
  const phrases = [
    '"application received"', '"thank you for applying"', '"we received your application"',
    '"invite you to interview"', '"next steps"', '"unfortunately"', '"pleased to offer"',
    '"coding challenge"', '"schedule"',
  ];
  return `newer_than:${days}d {${senders.join(' ')} ${phrases.join(' ')}}`;
}

// Extract a header value (case-insensitive) from a Gmail metadata payload's headers array.
export function headerValue(headers, name) {
  const target = String(name).toLowerCase();
  for (const h of Array.isArray(headers) ? headers : []) {
    if (h && String(h.name).toLowerCase() === target) return h.value || '';
  }
  return '';
}

// Shape a gmail_captures row from a classified message. `cls` is classifyEmail()'s output.
export function gmailCaptureRow(uid, messageId, cls, receivedAtMs) {
  return {
    user_id: uid,
    message_id: String(messageId),
    signature: cls.signature,
    company: cls.company,
    event: cls.event,
    outcome: cls.outcome,
    confidence: cls.confidence,
    sender_domain: cls.senderDomain,
    received_at: new Date(Number.isFinite(receivedAtMs) ? receivedAtMs : Date.now()).toISOString(),
    status: 'suggested',
  };
}
