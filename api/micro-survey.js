// api/micro-survey.js
//
// Records ONE micro-survey response (see components/MicroSurveyModal.tsx + MicroSurveyHost.tsx).
// POST-only, write-only. Auth is OPTIONAL: when a Supabase Bearer token is present it attaches
// user_id; otherwise the response is stored anonymously. Every response is validated against the
// fixed question pool server-side (lib/server/microSurvey.js) — unknown keys / choices that are
// not in the fixed enum are rejected, never stored (junk in, nothing out).
//
// ANTI-GAMING: these are low-trust CLAIMS. They land in their own table (micro_survey_responses,
// migration 064) and are DELIBERATELY NOT fed into company scoring in this PR. Wiring them into
// scoring is a separate, explicit follow-up so we never half-wire the scoring path.

import { applyRateLimit, resolveRateBucket } from '../lib/server/ratelimit.js';
import { validateSubmission } from '../lib/server/microSurvey.js';

// Resolve the optional Supabase user id from a Bearer token via the auth server (service key).
// Best-effort and never throws: a missing/expired/invalid token just means an anonymous response.
async function resolveUid(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (r.ok) return (await r.json())?.id || null;
  } catch { /* fall through to anonymous */ }
  return null;
}

export default async function handler(req, res) {
  // CORS + preflight + a light abuse cap (per-user bucket when signed in, else per-IP). Fail-open:
  // an infra blip never blocks a no-incentive poll write. Returns true on OPTIONS or 429.
  if (await applyRateLimit(req, res, 'micro-survey', { bucketKey: resolveRateBucket(req).key })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const v = validateSubmission(body);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });

    const uid = await resolveUid(req);

    const r = await fetch(`${SUPABASE_URL}/rest/v1/micro_survey_responses`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: uid,                       // null when anonymous
        question_key: v.record.question_key,
        company: v.record.company,          // null for general questions
        choice: v.record.choice,
      }),
    });

    if (!r.ok) {
      console.error('[micro-survey] insert failed:', r.status, (await r.text()).slice(0, 200));
      return res.status(500).json({ error: 'insert failed' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[micro-survey] Unhandled error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
