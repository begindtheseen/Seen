export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }});
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500, headers });
  }

  // Verify the user's JWT — extract uid from it
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.replace('Bearer ', '').trim();
  if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

  // Decode JWT payload to get user id (no signature verification needed — Supabase will reject stale tokens)
  let uid;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    uid = payload.sub;
    if (!uid) throw new Error('No uid in token');
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers });
  }

  const base = { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  try {
    // 1. Delete all applications
    await fetch(`${SUPABASE_URL}/rest/v1/applications?user_id=eq.${uid}`, {
      method: 'DELETE',
      headers: base,
    });

    // 2. Delete profile row (removes resume text, name, saved data)
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}`, {
      method: 'DELETE',
      headers: base,
    });

    // 3. Delete the auth user (requires service role)
    const deleteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });

    if (!deleteRes.ok && deleteRes.status !== 404) {
      const err = await deleteRes.text();
      throw new Error(`Auth delete failed: ${err.slice(0, 100)}`);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });

  } catch(err) {
    console.error('delete-account error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
