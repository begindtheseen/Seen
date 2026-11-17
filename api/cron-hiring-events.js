// The external hiring-events refresh (2026-11-17): state workforce job-fair calendars and the New York State
// Department of Labor's apprenticeship announcements → public.external_hiring_events, which the start guides'
// "Hiring events" strip reads (GET /api/jobs?action=hiring_events). Sources and parsers: lib/server/externalEvents.js
// and lib/jobs/externalEvents.js. The curated apprenticeship windows are a checked-in file and are not written here.
//
// GET (Vercel cron, `Authorization: Bearer $CRON_SECRET`) or a manual run with the secret (Bearer, x-cron-secret or
// ?secret=). `?dry=1` fetches and answers the summary without writing. Each source has its own timeout; the whole
// run stays inside RUN_MS (the function may run 60 s). One source failing never stops the others, and a source
// that failed this run keeps its rows from the last good run (only a source that answered replaces its rows).
//
// Writes are service-role only (RLS on, no policies). Before the table exists the run still fetches and answers
// `table: 'missing'` — the read falls back to the checked-in snapshot (lib/jobs/data/externalEventsSnapshot.json).
import { isVercelCron, hasCronSecret } from '../lib/server/cronAuth.js';
import { withCronRecord } from '../lib/server/cronRecord.js';
import { refreshExternalEvents, tableRecord, TABLE } from '../lib/server/externalEvents.js';
import { pacificDate } from '../lib/time/pacific.js';

const RUN_MS = 45_000;
const PER_SOURCE_MS = 15_000;
const BATCH = 200;
const KEEP_PAST_DAYS = 7;

const missing = (status, text) => status === 404 || /PGRST205|42P01|does not exist|Could not find the table/i.test(text || '');

/** Write the rows: upsert by id, then drop each answering source's rows this run did not see, then old rows. */
export async function writeRows(rows, summary, { supabaseUrl, serviceKey, fetchImpl = fetch, now = new Date(), runStart }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const base = `${supabaseUrl}/rest/v1/${TABLE}`;
  const stamp = runStart.toISOString();
  const records = rows.map((r) => tableRecord(r, stamp));
  let written = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const r = await fetchImpl(`${base}?on_conflict=id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(records.slice(i, i + BATCH)), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      if (missing(r.status, text)) return { table: 'missing', written: 0, removed: 0 };
      throw new Error(`upsert ${r.status} ${text.slice(0, 160)}`);
    }
    written += Math.min(BATCH, records.length - i);
  }
  let removed = 0;
  for (const [source, s] of Object.entries(summary)) {
    if (!s.ok) continue;
    const r = await fetchImpl(`${base}?source=eq.${encodeURIComponent(source)}&fetched_at=lt.${encodeURIComponent(stamp)}`, { method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' }, signal: AbortSignal.timeout(10_000) });
    if (r.ok) removed += (await r.json().catch(() => [])).length || 0;
  }
  const [y, m, d] = pacificDate(now).split('-').map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d - KEEP_PAST_DAYS)).toISOString().slice(0, 10);
  await fetchImpl(`${base}?ends_on=lt.${cutoff}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return { table: 'ok', written, removed };
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
  if (!isVercelCron(req) && !hasCronSecret(req)) return res.status(401).json({ error: 'cron only' });
  const dry = String(req.query?.dry || '') === '1';
  const runStart = new Date();
  const { rows, summary } = await refreshExternalEvents({ budgetMs: RUN_MS, perSourceMs: PER_SOURCE_MS, now: runStart });
  const fairs = rows.filter((r) => r.external.type === 'fair').length;
  const windows = rows.length - fairs;
  const answered = Object.values(summary).filter((s) => s.ok).length;
  const out = { ok: answered > 0, partial: answered < Object.keys(summary).length, events: rows.length, fairs, windows, sources_ok: answered, sources: Object.keys(summary).length, ms: Date.now() - runStart.getTime(), summary };
  if (dry) return res.status(200).json({ ...out, dry: true });
  const supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ ...out, ok: false, error: 'DB unavailable' });
  try {
    const w = await writeRows(rows, summary, { supabaseUrl, serviceKey, now: runStart, runStart });
    return res.status(200).json({ ...out, ...w });
  } catch (e) {
    return res.status(502).json({ ...out, ok: false, error: String(e.message || e).slice(0, 200) });
  }
}

export default withCronRecord('cron-hiring-events', handler);
