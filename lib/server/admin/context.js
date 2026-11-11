// What every admin handler receives, and the small checks they share.

import { AdminError } from './respond.js';
import { isModerator } from './auth.js';

/** Moderators read and moderate reports; everything that can destroy or grant is for full admins. */
export function adminOnly(ctx) {
  if (isModerator(ctx.sess)) throw new AdminError(403, 'That needs a full admin account.', { code: 'forbidden' });
}

export const svcHeaders = (ctx) => ({ apikey: ctx.key, Authorization: `Bearer ${ctx.key}`, 'Content-Type': 'application/json' });

/** Time left before this request should stop starting new work (the function limit is 60 s). */
export const timeLeft = (ctx) => ctx.deadline - Date.now();

export function str(v, max = 500) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function bad(message) { return new AdminError(400, message, { code: 'bad_request' }); }
export function notFound(message) { return new AdminError(404, message, { code: 'not_found' }); }
export function upstream(message, extra = {}) { return new AdminError(502, message, { code: 'upstream', ...extra }); }
export function conflict(message, extra = {}) { return new AdminError(409, message, { code: 'conflict', ...extra }); }
