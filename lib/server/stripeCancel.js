// Cancel every live Stripe subscription of a customer, immediately (DELETE /v1/subscriptions/:id —
// no proration, no final invoice). Used by account deletion (api/user-sync.js delete_account): a
// deleted Seen account must never keep billing. Any failure is reported, never swallowed, so the
// caller can refuse to delete the account while billing may still be live.
export const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

/**
 * @returns {Promise<{ok: boolean, cancelled: string[], error?: string}>}
 */
export async function cancelLiveSubscriptions({ customerId, stripeKey, fetchImpl = fetch }) {
  if (!customerId) return { ok: true, cancelled: [] };
  if (!stripeKey) return { ok: false, cancelled: [], error: 'no_stripe_key' };
  const headers = { Authorization: `Bearer ${stripeKey}` };
  let list;
  try {
    list = await fetchImpl(`https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`, { headers });
  } catch (e) {
    return { ok: false, cancelled: [], error: `list_failed: ${e?.message || e}` };
  }
  if (!list.ok) return { ok: false, cancelled: [], error: `list_${list.status}` };
  const data = (await list.json().catch(() => null))?.data;
  if (!Array.isArray(data)) return { ok: false, cancelled: [], error: 'list_bad_payload' };
  const cancelled = [];
  for (const sub of data.filter((s) => s && LIVE_SUBSCRIPTION_STATUSES.has(s.status))) {
    let r;
    try {
      r = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(sub.id)}`, { method: 'DELETE', headers });
    } catch (e) {
      return { ok: false, cancelled, error: `cancel_failed: ${e?.message || e}` };
    }
    if (!r.ok) return { ok: false, cancelled, error: `cancel_${r.status}` };
    cancelled.push(sub.id);
  }
  return { ok: true, cancelled };
}
