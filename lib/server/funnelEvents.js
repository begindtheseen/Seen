// Funnel counters — the ONE list of step names and the ONE writer for public.funnel_events.
//
// Steps (owner, 2026-10-25: "measure every step"):
//   guest_email_shown / guest_email_given   the guest check-in email ask (components/track/CheckinEmailAsk.tsx)
//   pricing_view                            /pricing opened (once per browser session)
//   offer_shown / offer_clicked             a paid offer seen / pressed, with the `surface` it sat on
//   prep_preview_shown                      the free Interview Prep preview rendered on a tracker card
//   checkout_started {sku}                  api/stripe.js opened a Stripe Checkout (server-side)
//   checkout_completed {sku}                a one-time purchase was fulfilled (lib/server/stripeFulfillment.js)
//   prep_built                              api/interview-prep.js built a pack (server-side)
//   prep_offer_shown / prep_offer_clicked   the tracker card's offer before migration 20261025160000
//                                           (still written as a fallback while the old CHECK is in place)
//
// The table's CHECK constraint lists the event names, and the `surface` / `sku` columns arrive with
// migration 20261025160000_funnel_steps.sql. Before it is applied a new step is silently not recorded
// (the insert is refused), while the tracker card's offer still records under its old name — the code
// never fails a page because a counter could not be written.

export const LEGACY_EVENTS = ['prep_offer_shown', 'prep_offer_clicked', 'prep_built', 'guest_email_shown', 'guest_email_given'];
export const FUNNEL_EVENTS = [
  ...LEGACY_EVENTS,
  'pricing_view', 'offer_shown', 'offer_clicked', 'prep_preview_shown', 'checkout_started', 'checkout_completed',
];
/** What a browser may send. Checkout and build steps are written by the server only, so they cannot be forged. */
export const CLIENT_EVENTS = FUNNEL_EVENTS.filter((e) => !['prep_built', 'checkout_started', 'checkout_completed'].includes(e));
/** Where a paid offer can sit. One offer per page. */
export const OFFER_SURFACES = ['tracker_prep', 'company_page', 'pricing', 'upgrade_modal', 'lock_card', 'homepage'];
/** Every SKU a funnel row may name (the sellable ones plus the retired Credit Pack, for old sessions). */
export const FUNNEL_SKUS = ['interview', 'pass30', 'credits20'];

// The tracker card's offer as it was counted before the new steps existed.
const LEGACY_ALIAS = { offer_shown: 'prep_offer_shown', offer_clicked: 'prep_offer_clicked' };

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/**
 * The row to store, or null when the event is not one Seen counts. Unknown surfaces and SKUs are dropped
 * (stored as null), never passed through.
 * @param {{ event: string, user_id?: string|null, company?: string|null, surface?: string|null, sku?: string|null }} input
 * @param {{ client?: boolean }} [opts] client: true limits the event to CLIENT_EVENTS
 */
export function funnelRow({ event, user_id = null, company = null, surface = null, sku = null }, { client = false } = {}) {
  const e = String(event || '');
  if (!(client ? CLIENT_EVENTS : FUNNEL_EVENTS).includes(e)) return null;
  return {
    user_id: user_id || null,
    event: e,
    company: clean(company, 120) || null,
    surface: OFFER_SURFACES.includes(surface) ? surface : null,
    sku: FUNNEL_SKUS.includes(sku) ? sku : null,
  };
}

/**
 * Insert one funnel row. Never throws; resolves true when a row was stored.
 * Before migration 20261025160000 a row with surface/sku is refused (no such column, or the old CHECK);
 * the tracker card's offer then falls back to its old event name without the new columns.
 * @param {(path: string, opts?: object) => Promise<Response>} db  PostgREST fetcher with the service key
 * @param {ReturnType<typeof funnelRow>} row
 */
export async function recordFunnelEvent(db, row) {
  if (!row) return false;
  const post = (body) => db('funnel_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) })
    .then((r) => !!(r && r.ok)).catch(() => false);
  const body = { user_id: row.user_id, event: row.event, company: row.company };
  if (row.surface) body.surface = row.surface;
  if (row.sku) body.sku = row.sku;
  if (await post(body)) return true;
  // Old schema: no surface/sku columns, CHECK allows only the legacy names.
  const legacy = LEGACY_EVENTS.includes(row.event) ? row.event
    : row.surface === 'tracker_prep' ? LEGACY_ALIAS[row.event] : null;
  if (!legacy || (legacy === row.event && !row.surface && !row.sku)) return false;
  return post({ user_id: row.user_id, event: legacy, company: row.company });
}
