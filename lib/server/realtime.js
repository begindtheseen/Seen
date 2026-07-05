// Instant-notification transport for Seen Live. Server handlers call broadcastActivity() the
// moment an event happens; the admin dashboard is subscribed to the same Supabase Realtime
// channel and reacts in <1s (then fetches the authenticated details via recent_events). This is
// what makes notifications INSTANT instead of poll-delayed.
//
// SECURITY: the channel is public (broadcast), so the payload carries only a non-sensitive event
// KIND ("report"/"purchase"/…) — never company names, emails, or amounts. The admin client uses
// the broadcast purely as a "poll now" trigger and reads the real data over its own token-authed
// endpoint. Fire-and-forget + fail-safe: if Realtime is unreachable the admin's fallback poll
// still delivers the event within the poll interval, so nothing is ever lost.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const LIVE_TOPIC = 'seen-live';

export async function broadcastActivity(kind) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ topic: LIVE_TOPIC, event: 'activity', payload: { kind: String(kind || 'event'), t: Date.now() } }],
      }),
      // Never let a slow Realtime call hold up the user's request.
      signal: AbortSignal.timeout(2500),
    });
  } catch { /* fall back to the admin's cursor poll */ }
}
