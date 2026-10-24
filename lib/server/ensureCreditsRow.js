// One place that creates a user's ai_credits row (api/user-sync.js earn_credit, submit_answer and
// the résumé-survey award). It inserts the welcome row with ON CONFLICT DO NOTHING — never
// merge-duplicates, which would overwrite a row a concurrent request just created and reset its
// balance — logs the welcome bonus only when this call created the row, and returns the current row.
import { WELCOME_CREDITS, firstCreditsRow } from './creditRules.js';

/**
 * @param {(path: string, opts?: object) => Promise<Response>} db  PostgREST fetcher (service role)
 * @returns {Promise<object|null>} the user's ai_credits row, or null when it could not be read or created
 */
export async function ensureCreditsRow(db, uid, today) {
  const ins = await db('ai_credits?on_conflict=user_id', {
    method: 'POST',
    body: JSON.stringify({ user_id: uid, ...firstCreditsRow(today) }),
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
  }).catch(() => null);
  const created = ins && ins.ok ? (await ins.json().catch(() => []))?.[0] || null : null;
  if (created) {
    await db('credit_transactions', {
      method: 'POST',
      body: JSON.stringify({ user_id: uid, delta: WELCOME_CREDITS, reason: 'welcome_bonus' }),
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
    return created;
  }
  const r = await db(`ai_credits?user_id=eq.${uid}&limit=1`).catch(() => null);
  return r && r.ok ? (await r.json().catch(() => []))?.[0] || null : null;
}
