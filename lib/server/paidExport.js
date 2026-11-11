// A tailored version bought with a credit is exported WITHOUT the "Optimized with Seen · seenjobs.io" footer (director's
// decision, round 3: nobody should send an employer a résumé carrying our advert after paying for it). The paid optimize
// answer carries `tailored.export_token` — an HMAC over (user, posting key, expiry) signed with a server secret; the
// export action verifies it against the signed-in user. Free results carry none, so free exports keep the current rule.
import { createHmac, timingSafeEqual, createHash } from 'crypto';

const TTL_MS = 7 * 24 * 3600 * 1000; // the paid result is cached 7 days; so is its unbranded export
// key material: a dedicated EXPORT_TOKEN_SECRET when set, else the JWT secret; the service key only as the last fallback
const secret = () => process.env.EXPORT_TOKEN_SECRET || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
const keyHash = (k) => createHash('sha256').update(String(k || '')).digest('base64url').slice(0, 16);
const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

/** The token for one paid result (null without a server secret or a user). */
export function paidExportToken(uid, postingKey, now = Date.now()) {
  if (!uid || !secret()) return null;
  const key = keyHash(postingKey);
  const exp = now + TTL_MS;
  const payload = `${uid}.${key}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

/** Is this token a paid result of THIS user, for THIS result (its key), unexpired? */
export function verifyPaidExport(uid, token, exportKey, now = Date.now()) {
  if (!uid || !token || typeof token !== 'string' || !exportKey || !secret()) return false;
  const [b64, mac] = token.split('.');
  if (!b64 || !mac) return false;
  let payload = '';
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return false; }
  const [u, k, exp] = payload.split('.');
  if (u !== uid || k !== keyHash(exportKey) || !(Number(exp) > now)) return false;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** ONE decision for the export handler: the signed-in user carries a valid token for the result being exported. */
export async function paidExportAllowed(req, body, resolveUser) {
  if (!body || !body.exportToken || !body.exportKey) return false;
  const who = await resolveUser(req);
  return verifyPaidExport(who && who.uid, body.exportToken, body.exportKey);
}
