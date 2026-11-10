// A tailored version bought with a credit is exported WITHOUT the "Optimized with Seen · seenjobs.io" footer (director's
// decision, round 3: nobody should send an employer a résumé carrying our advert after paying for it). The paid optimize
// answer carries `tailored.export_token` — an HMAC over (user, posting key, expiry) signed with a server secret; the
// export action verifies it against the signed-in user. Free results carry none, so free exports keep the current rule.
import { createHmac, timingSafeEqual, createHash } from 'crypto';

const TTL_MS = 7 * 24 * 3600 * 1000; // the paid result is cached 7 days; so is its unbranded export
const secret = () => process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

/** The token for one paid result (null without a server secret or a user). */
export function paidExportToken(uid, postingKey, now = Date.now()) {
  if (!uid || !secret()) return null;
  const key = createHash('sha256').update(String(postingKey || '')).digest('base64url').slice(0, 16);
  const exp = now + TTL_MS;
  const payload = `${uid}.${key}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

/** Is this token a paid result of THIS user, unexpired? */
export function verifyPaidExport(uid, token, now = Date.now()) {
  if (!uid || !token || typeof token !== 'string' || !secret()) return false;
  const [b64, mac] = token.split('.');
  if (!b64 || !mac) return false;
  let payload = '';
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return false; }
  const [u, , exp] = payload.split('.');
  if (u !== uid || !(Number(exp) > now)) return false;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
