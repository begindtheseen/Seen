// Invite links — pure helpers shared by the server (lib/server/growthRewards.js) and the browser.
// A link is https://seenjobs.io/<path>?ref=<code>. The code is random (referral_codes.code), never a
// user id. No I/O, no storage: lib/referralClient.ts keeps the pending code and claims it.

export const SITE_ORIGIN = 'https://seenjobs.io';
export const REF_PARAM = 'ref';
export const REFERRAL_CODE_LENGTH = 8;
const CODE_RE = /^[a-z2-9]{8}$/;

/** True for a well-formed invite code. */
export function isReferralCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

/**
 * The invite link for `code`, optionally to a page on the site ('/company/acme').
 * A missing or malformed code gives the plain link, so a guest's share still works.
 * Only an internal path is accepted; anything else falls back to the home page.
 * @param {string|null|undefined} code
 * @param {string} [path]
 */
export function referralUrl(code, path = '/') {
  let u;
  try { u = new URL(String(path || '/'), SITE_ORIGIN); } catch { u = new URL('/', SITE_ORIGIN); }
  if (u.origin !== SITE_ORIGIN) u = new URL('/', SITE_ORIGIN);
  u.hash = '';
  u.searchParams.delete(REF_PARAM);
  if (isReferralCode(code)) u.searchParams.set(REF_PARAM, code);
  return u.href;
}

/** The invite code carried by a URL's query string, or null. */
export function refFromSearch(search) {
  try {
    const v = new URLSearchParams(String(search || '')).get(REF_PARAM);
    const c = v ? v.trim().toLowerCase() : '';
    return isReferralCode(c) ? c : null;
  } catch {
    return null;
  }
}
