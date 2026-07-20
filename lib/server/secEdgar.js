// SEC EDGAR full-text-search adapter → attributed public-record signals.
//
// SAFETY / ACCURACY (the whole point): we do NOT assert an event happened. Most 8-Ks that mention
// "workforce reduction" are earnings press releases, not layoff announcements. So each signal
// states ONLY the verifiable, fair-report-privileged fact that a public 8-K filing EXISTS and
// references our search phrase, with a link to the filing so the reader judges it. That claim is
// literally true and is exactly what fair-report privilege protects. SEC's EFTS API is built for
// programmatic access (10 req/s with a contact User-Agent) and is reliable from datacenter IPs —
// unlike Reddit RSS, it does not block Vercel.

// Exact phrases we search, each tagged with an internal event_type + the user-visible topic.
// Same event_type + same filing → one row (external_ref dedupe), so phrase synonyms collapse.
export const SEC_PHRASES = [
  { phrase: 'reduction in force', event_type: 'layoff_disclosure', topic: 'workforce reduction' },
  { phrase: 'workforce reduction', event_type: 'layoff_disclosure', topic: 'workforce reduction' },
  { phrase: 'reduction in workforce', event_type: 'layoff_disclosure', topic: 'workforce reduction' },
  { phrase: 'restructuring plan', event_type: 'restructuring_disclosure', topic: 'a restructuring plan' },
];

const EFTS = 'https://efts.sec.gov/LATEST/search-index';

// Build an EFTS URL for an exact-phrase 8-K search within an optional date window.
export function buildEdgarSearchUrl(phrase, { startdt, enddt, forms = '8-K' } = {}) {
  const params = new URLSearchParams();
  params.set('q', `"${phrase}"`);
  if (forms) params.set('forms', forms);
  if (startdt) params.set('startdt', startdt);
  if (enddt) params.set('enddt', enddt);
  return `${EFTS}?${params.toString()}`;
}

// "TrueBlue, Inc.  (TBI)  (CIK 0000768899)" → "TrueBlue, Inc." (display name; parentheticals out).
export function cleanDisplayName(raw) {
  return String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

// Canonical link to the filing document on sec.gov (or the filing folder when no primary doc).
export function edgarFilingUrl(cik, accession, primaryDoc) {
  const cikInt = parseInt(String(cik), 10);
  const noDash = String(accession || '').replace(/-/g, '');
  if (!Number.isFinite(cikInt) || !noDash) return '';
  const base = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${noDash}`;
  return primaryDoc ? `${base}/${primaryDoc}` : `${base}/`;
}

// Pure: map one EFTS hit + its phrase group → a normalized signal record. null if unparseable.
export function edgarHitToSignal(hit, group) {
  const s = hit && hit._source;
  if (!s) return null;
  const company = cleanDisplayName(Array.isArray(s.display_names) ? s.display_names[0] : '');
  if (!company) return null;
  const cik = Array.isArray(s.ciks) ? s.ciks[0] : null;
  const id = typeof hit._id === 'string' ? hit._id : '';
  const accession = s.adsh || (id.includes(':') ? id.split(':')[0] : id);
  const primaryDoc = id.includes(':') ? id.split(':')[1] : '';
  const source_url = edgarFilingUrl(cik, accession, primaryDoc);
  if (!accession || !source_url) return null;
  const location = Array.isArray(s.biz_locations) ? (s.biz_locations[0] || null) : null;
  const topic = (group && group.topic) || 'a workforce topic';
  const event_type = (group && group.event_type) || 'disclosure';
  const fileDate = s.file_date || null;
  return {
    company,
    source: 'sec_8k',
    event_type,
    // The ONLY claim we make: this public filing exists and references the term. Never a verdict.
    title: `SEC 8-K filing references "${topic}"`,
    detail: `${company} filed a Form 8-K with the SEC${fileDate ? ` on ${fileDate}` : ''}. This entry only notes that the public filing references "${topic}" — open the filing to judge what it says.`,
    event_date: fileDate,
    location,
    source_url,
    source_label: 'SEC 8-K filing',
    external_ref: `sec:${accession}:${event_type}`,
  };
}

// Parse a full EFTS JSON response into signal records for a phrase group. Never throws.
export function parseEdgarResponse(json, group) {
  try {
    const hits = json && json.hits && Array.isArray(json.hits.hits) ? json.hits.hits : [];
    const out = [];
    for (const h of hits) {
      const sig = edgarHitToSignal(h, group);
      if (sig) out.push(sig);
    }
    return out;
  } catch { return []; }
}

// Defensive fetch of one phrase group. Returns [] on any failure (never throws). SEC requires a
// descriptive User-Agent with a contact — callers should pass a real one via opts.userAgent.
export async function fetchEdgarGroup(group, opts = {}) {
  const url = buildEdgarSearchUrl(group.phrase, opts);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': opts.userAgent || 'SeenJobs/1.0 job-transparency (contact via seenjobs.io)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(opts.timeoutMs || 10000),
    });
    if (!r.ok) return [];
    return parseEdgarResponse(await r.json(), group);
  } catch { return []; }
}
