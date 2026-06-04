// Diagnostic endpoint — call GET /api/jobs-diag to see exactly why job caching is broken.
// Returns a full report: env vars, table access, column presence, read/write test.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  const report = { ts: new Date().toISOString(), steps: [] };
  const pass = (name, detail) => { report.steps.push({ name, ok: true,  ...detail }); };
  const fail = (name, detail) => { report.steps.push({ name, ok: false, ...detail }); };

  // ── 1. Env vars ───────────────────────────────────────────────────────────
  if (!SUPABASE_URL)  fail('env_SUPABASE_URL',      { hint: 'Add SUPABASE_URL to Vercel env vars' });
  else                pass('env_SUPABASE_URL');
  if (!SERVICE_KEY)   fail('env_SUPABASE_SERVICE_KEY', { hint: 'Add SUPABASE_SERVICE_KEY to Vercel env vars' });
  else                pass('env_SUPABASE_SERVICE_KEY');

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(200).json(report);
  }

  const h = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── 2. Can we SELECT from jobs at all? ────────────────────────────────────
  const readRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs?limit=1`, { headers: h }).catch(e => ({ ok: false, _err: e.message }));
  if (!readRes.ok) {
    const body = readRes._err || await readRes.text().catch(() => '');
    fail('read_jobs', { status: readRes.status, body, hint: 'Table may not exist or service_role lacks SELECT grant' });
    return res.status(200).json(report);
  }
  const readRows = await readRes.json().catch(() => null);
  pass('read_jobs', { row_count: Array.isArray(readRows) ? readRows.length : '?' });

  // ── 3. Does search_query column exist? ────────────────────────────────────
  const sqRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.__diag__&limit=1`, { headers: h });
  if (sqRes.ok) pass('col_search_query');
  else {
    const body = await sqRes.text().catch(() => '');
    fail('col_search_query', { status: sqRes.status, body, hint: 'Run: ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS search_query text;' });
  }

  // ── 4. Does expires_at column exist? ─────────────────────────────────────
  const expRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs?expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, { headers: h });
  if (expRes.ok) pass('col_expires_at');
  else {
    const body = await expRes.text().catch(() => '');
    fail('col_expires_at', { status: expRes.status, body, hint: "Run: ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '7 days');" });
  }

  // ── 5. Plain INSERT test ──────────────────────────────────────────────────
  const testRow = {
    title:        '__diag_test__',
    company:      '__diag_test__',
    location:     'Test',
    search_query: '__diag_test__',
    expires_at:   new Date(Date.now() + 60000).toISOString(),
  };
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify(testRow),
  });
  if (!insRes.ok) {
    const body = await insRes.text().catch(() => '');
    fail('insert_jobs', { status: insRes.status, body, hint: 'Run: GRANT INSERT ON public.jobs TO service_role;' });
    return res.status(200).json(report);
  }
  const insRows = await insRes.json().catch(() => []);
  const testId = insRows?.[0]?.id;
  pass('insert_jobs', { id: testId });

  // ── 6. Upsert test (merge-duplicates) ────────────────────────────────────
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...testRow, title: '__diag_upsert__' }),
  });
  if (upsertRes.ok) pass('upsert_merge_duplicates');
  else {
    const body = await upsertRes.text().catch(() => '');
    fail('upsert_merge_duplicates', {
      status: upsertRes.status, body,
      hint: 'No unique constraint — run the SQL migration at /api/jobs-diag?action=sql to fix',
    });
  }

  // ── 7. Read-back the test row ─────────────────────────────────────────────
  if (testId) {
    const rbRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.__diag_test__&limit=1`, { headers: h });
    if (rbRes.ok) {
      const rows = await rbRes.json().catch(() => []);
      if (rows?.length > 0) pass('readback_after_insert', { found: rows.length });
      else fail('readback_after_insert', { hint: 'Insert appeared to succeed but the row is not queryable via search_query filter' });
    } else {
      fail('readback_after_insert', { status: rbRes.status });
    }

    // Cleanup test rows
    await fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.__diag_test__`, {
      method: 'DELETE',
      headers: { ...h, Prefer: 'return=minimal' },
    });
    await fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.__diag_upsert__`, {
      method: 'DELETE',
      headers: { ...h, Prefer: 'return=minimal' },
    });
    pass('cleanup');
  }

  // ── 8. Count cached rows currently in DB ─────────────────────────────────
  const cntRes = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id`,
    { headers: { ...h, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }
  );
  const total = cntRes.headers?.get('content-range')?.split('/')[1];
  pass('live_cache_count', { count: total ?? 'unknown' });

  report.overall = report.steps.every(s => s.ok) ? 'ALL_PASS' : 'NEEDS_FIX';
  return res.status(200).json(report);
}
