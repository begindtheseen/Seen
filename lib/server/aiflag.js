// Admin-toggleable Anthropic switch.
//
// The product is designed to work fully WITHOUT Anthropic: company scores come from aggregating
// real reports, job search serves the DB corpus, and the credit-gated AI tools fall back to an
// OpenAI-compatible provider (see llm.js). Anthropic is an OPTIONAL enrichment layer that an admin
// can flip on from the feature-flags panel if it's ever needed again.
//
// Controlled by the `anthropic_enabled` row in the public.feature_flags table. Default = OFF: any
// status other than an explicit on-value (or a missing row) is treated as disabled. Result is
// cached in-process for 60s so this never adds a DB round-trip to a hot path.

let _cache = { val: false, exp: 0 };

export async function anthropicEnabled(SUPABASE_URL, SERVICE_KEY) {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  const now = Date.now();
  if (now < _cache.exp) return _cache.val;

  let val = false;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/feature_flags?flag_name=eq.anthropic_enabled&select=status&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (r.ok) {
      const row = (await r.json())?.[0];
      const status = row?.status;
      val = status === 'fully_on' || status === 'on' || status === 'admin_only';
    }
  } catch { /* default off on any error */ }

  _cache = { val, exp: now + 60000 };
  return val;
}
