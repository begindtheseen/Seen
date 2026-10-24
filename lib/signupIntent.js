// Why someone opened the sign-up screen, and where they go once their email is confirmed.
//
// A guest who taps "Track it", "Start the free trial" or follows a friend's invite reaches /login with
//   ?mode=signup&intent=track|trial|alert|invite&company=<name>&next=<path>
// The screen opens in sign-up mode with a headline about what they were doing, and the confirmation
// link (Supabase emailRedirectTo) returns them to `next` instead of a fixed /dashboard (conversion
// audit 2026-10-24: every email link landed on /dashboard, so a trial click or a tracked company was lost).
//
// `next` comes from the URL, so it is an open-redirect input: it is reduced to ONE same-origin path
// (pathname + query, no hash) through lib/safeHref.js internalPath, then decoded once and re-checked so
// an encoded `//` or `\` cannot become a protocol-relative URL later. Pure, no I/O — shared by the
// login page, the track flows and the tests (lib/signupIntent.test.mjs).

import { internalPath } from './safeHref.js';
import { PRO_TRIAL_DAYS, REFERRAL_REWARD_PRO_DAYS, proDaysLabel } from './server/creditRules.js';

export const INTENTS = ['track', 'trial', 'alert', 'invite'];

/** Pages a confirmation link must never return to (a loop back into auth). */
const AUTH_PATHS = ['/login', '/reset', '/signup'];

/**
 * The same-origin path (pathname + query) a sign-up may return to, or null.
 * Refuses `//host`, `/\host`, full URLs, schemes, control characters and their percent-encoded forms.
 */
export function safeNextPath(v) {
  const p = internalPath(v);
  if (!p) return null;
  let u;
  try { u = new URL(p, 'https://seen.invalid'); } catch { return null; }
  if (u.origin !== 'https://seen.invalid') return null;
  const path = u.pathname;
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  // An encoded slash or backslash at the start ("/%2F%2Fevil", "/%5Cevil") would be a protocol-relative
  // URL to anything that decodes before navigating. Backslashes anywhere are never a Seen path.
  if (decoded.startsWith('//') || decoded.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (AUTH_PATHS.some((a) => path === a || path.startsWith(`${a}/`) || path.startsWith(`${a}?`))) return null;
  return `${path}${u.search}`;
}

/** A company name as the headline may show it: plain text, one line, at most 80 characters. */
export function cleanCompany(v) {
  // eslint-disable-next-line no-control-regex
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 80);
}

/**
 * The sign-up screen's state from its query string.
 * @param {URLSearchParams | { get(k: string): string | null }} params
 * @param {{ pendingRef?: boolean, employerSignup?: boolean }} [opts]
 */
export function parseSignupParams(params, { pendingRef = false, employerSignup = true } = {}) {
  const get = (k) => {
    try { return params && typeof params.get === 'function' ? params.get(k) : null; } catch { return null; }
  };
  const rawIntent = String(get('intent') || '').toLowerCase();
  let intent = INTENTS.includes(rawIntent) ? rawIntent : null;
  const employer = employerSignup && get('type') === 'employer';
  const asked = get('mode') === 'signup' || get('signup') === '1' || !!intent || employer;
  // A friend's invite waiting on this device: the sign-up headline says so when nothing else does.
  if (!intent && pendingRef && !employer) intent = 'invite';
  const next = safeNextPath(get('next')) || safeNextPath(get('return')) || safeNextPath(get('returnTo'));
  return { mode: asked ? 'signup' : 'signin', intent, company: cleanCompany(get('company')), next, employer };
}

/**
 * The /login URL that opens sign-up for this intent and comes back to `next`.
 * @param {{ intent?: string | null, next?: string | null, company?: string | null }} [o]
 */
export function signupHref({ intent = null, next = null, company = null } = {}) {
  const q = new URLSearchParams({ mode: 'signup' });
  if (intent && INTENTS.includes(intent)) q.set('intent', intent);
  const c = cleanCompany(company);
  if (c) q.set('company', c);
  const n = safeNextPath(next);
  if (n) q.set('next', n);
  return `/login?${q.toString()}`;
}

/** Where a confirmed trial sign-up continues: the page that starts the trial checkout for `plan`. */
export function trialPath(plan = 'monthly') {
  return `/trial?plan=${plan === 'yearly' ? 'yearly' : 'monthly'}`;
}

/** The sign-up link behind every guest "Start free trial" button. */
export function trialSignupHref(plan = 'monthly') {
  return signupHref({ intent: 'trial', next: trialPath(plan) });
}

/**
 * The sign-up screen's headline for an intent. Numbers come from lib/server/creditRules.js.
 * @param {{ intent?: string | null, company?: string | null }} [o]
 * @returns {{ title: string, sub: string }}
 */
export function intentCopy({ intent = null, company = null } = {}) {
  const co = cleanCompany(company);
  if (intent === 'trial') {
    return {
      title: `Start your ${PRO_TRIAL_DAYS}-day free trial`,
      sub: 'No card needed. Create your free account and the trial starts right after.',
    };
  }
  if (intent === 'track') {
    return {
      title: co ? `Track your ${co} application` : 'Track your applications',
      sub: `We'll email you on day 7, 14 and 30 to ask what happened. Free for job seekers.`,
    };
  }
  if (intent === 'invite') {
    return {
      title: 'Your friend invited you',
      sub: `Sign up and track your first application, and you both get ${proDaysLabel(REFERRAL_REWARD_PRO_DAYS)}.`,
    };
  }
  if (intent === 'alert') {
    return {
      title: co ? `Keep an eye on ${co}` : 'Keep an eye on a company',
      sub: `Create your free account first. Ghost alerts come with Seen Pro, which you can try free for ${PRO_TRIAL_DAYS} days.`,
    };
  }
  return { title: 'Create your account', sub: 'Free for job seekers.' };
}

/**
 * How the confirmation email's destination is named on the "check your email" screen.
 * @param {string | null} next
 * @param {string | null} [company]
 */
export function nextLabel(next, company = null) {
  const n = safeNextPath(next) || '/dashboard';
  const path = n.split('?')[0];
  const co = cleanCompany(company);
  if (path === '/trial') return 'your free trial';
  if (path === '/tracker') return 'your tracker';
  if (path.startsWith('/company/')) return co ? `the ${co} page` : 'the company page';
  if (path.startsWith('/jobs')) return 'the job you were on';
  if (path === '/pricing') return 'the pricing page';
  if (path === '/dashboard' || path === '/') return 'your dashboard';
  return 'the page you were on';
}
