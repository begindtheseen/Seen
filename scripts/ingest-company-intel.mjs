#!/usr/bin/env node
// Sends raw, source-attributed excerpts collected locally (e.g. via OpenCLI Reddit) to Seen.
const endpoint = process.env.SEEN_COMPANY_INTEL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-company-intel';
const token = process.env.SEEN_COMPANY_INTEL_INGEST_TOKEN;
if (!token) throw new Error('Set SEEN_COMPANY_INTEL_INGEST_TOKEN to LOCAL_COMPANY_INTEL_INGEST_SECRET.');
let items; try { items = JSON.parse(process.env.COMPANY_INTEL_ITEMS_JSON || ''); } catch { throw new Error('COMPANY_INTEL_ITEMS_JSON must be valid JSON.'); }
if (!Array.isArray(items) || !items.length) throw new Error('COMPANY_INTEL_ITEMS_JSON must be a non-empty JSON array.');
const total = { ok: true, received: 0, accepted: 0, imported_reports: 0, commentary: 0, duplicates: 0, rejected: 0, errors: [] };
for (let i = 0; i < items.length; i += 50) {
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.slice(i, i + 50) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Company-intel ingest failed (${response.status}): ${data.error || 'unknown error'}`);
  for (const key of ['received', 'accepted', 'imported_reports', 'commentary', 'duplicates', 'rejected']) total[key] += Number(data[key] || 0);
  total.errors.push(...(data.errors || []));
}
console.log(JSON.stringify(total, null, 2));
