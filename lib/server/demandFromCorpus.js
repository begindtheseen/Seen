// Pure demand-generation core: turn OUR live jobs corpus into demand_data rows for ANY city.
//
// This is what makes /demand a living tool instead of 13 hardcoded cities: when a searched
// city has no cached rows (or they're stale), the API geocodes it, radius-matches the corpus,
// and this module computes the rows — deterministic, keyless, testable. Every number is a
// literally-true statement about OUR data ("N live listings on Seen, X% seen active in the
// last 7 days"), labeled `Seen live listings` — never dressed up as BLS.
//
// Same convention as lib/server/listingFreshness.js: pure functions of (rows, nowMs).

const DAY = 86400000;

// ── Role buckets ──────────────────────────────────────────────────────────────
// First match wins — specific before broad. `niche` aligns with the /demand filter options
// (plus a few honest extras that simply aren't filterable yet).
export const ROLE_BUCKETS = [
  { re: /(customer (service|support|success)|call center|\bcsr\b)/i,                              title: 'Customer Service / Support', niche: 'Service / Retail' },
  { re: /(software|full.?stack|back.?end|front.?end|web develop|mobile develop|\bswe\b|develope?r)/i, title: 'Software Engineer',      niche: 'Tech / Software' },
  { re: /(data scien|machine learning|\bml\b|\bai\b)/i,                                           title: 'Data Scientist / ML',        niche: 'Tech / Software' },
  { re: /(data analyst|business analyst|analytics)/i,                                             title: 'Data Analyst',               niche: 'Tech / Software' },
  { re: /(devops|cloud engineer|site reliability|\bsre\b|platform engineer|infrastructure engineer)/i, title: 'Cloud / DevOps Engineer', niche: 'Tech / Software' },
  { re: /(security (analyst|engineer)|cybersecurity|\binfosec\b)/i,                               title: 'Cybersecurity Analyst',      niche: 'Tech / Software' },
  { re: /(it support|help ?desk|desktop support|technical support|systems? admin)/i,              title: 'IT Support',                 niche: 'Tech / Software' },
  { re: /(registered nurse|\brn\b|\blpn\b|\blvn\b|nurse)/i,                                       title: 'Nursing',                    niche: 'Healthcare' },
  { re: /(home health|care ?giver|\bcna\b|personal care|home care)/i,                             title: 'Home Health / Caregiving',   niche: 'Healthcare' },
  { re: /(medical assistant|medical office|patient care|phlebotom|medical tech)/i,                title: 'Medical Assistant / Tech',   niche: 'Healthcare' },
  { re: /(warehouse|package handler|order (picker|selector)|forklift|material handler|fulfillment)/i, title: 'Warehouse Associate',    niche: 'Logistics / Warehouse' },
  { re: /(\bcdl\b|truck driver|driver|delivery|courier)/i,                                        title: 'Driver / Delivery',          niche: 'Logistics / Warehouse' },
  { re: /(retail|sales associate|store associate|cashier|merchandis)/i,                           title: 'Retail / Sales Associate',   niche: 'Service / Retail' },
  { re: /(sales (rep|executive|manager|development)|account (executive|manager)|\bsdr\b|\bbdr\b)/i, title: 'Sales',                    niche: 'Sales' },
  { re: /(accountant|accounting|\bcpa\b|bookkeep|financial analyst|finance|payroll)/i,             title: 'Accounting / Finance',       niche: 'Finance' },
  { re: /(electrician|plumb|hvac|carpent|welder|maintenance tech|mechanic)/i,                     title: 'Skilled Trades',             niche: 'Trades / Construction' },
  { re: /(administrative|admin assistant|office (assistant|manager)|receptionist|clerk)/i,         title: 'Admin / Office',             niche: 'Service / Retail' },
];

export function bucketForTitle(title) {
  const t = String(title || '');
  if (!t) return null;
  for (const b of ROLE_BUCKETS) if (b.re.test(t)) return b;
  return null;
}

// "austin, tx" / "AUSTIN TX" → "Austin, TX"; "san francisco" → "San Francisco".
export function normalizeCityLabel(raw) {
  const cleaned = String(raw || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map(w => {
      const bare = w.replace(/,$/, '');
      // 2-letter state codes go upper ("Tx" → "TX"), everything else title-case.
      if (/^[a-z]{2}$/i.test(bare) && w !== cleaned.split(' ')[0]) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function share(part, whole) { return whole > 0 ? part / whole : 0; }

/**
 * Compute demand_data-shaped rows for one city from corpus job rows already filtered to that
 * city's radius. Pure. Rows: { title, level, salary, created_at, last_seen_at }.
 * Returns { rows, totalListings } — rows [] when the corpus is too thin to say anything
 * honest (never fabricates a market out of one stray listing).
 */
export function computeCityDemand({ city, jobs = [], nowMs = Date.now() } = {}) {
  const label = normalizeCityLabel(city);
  if (!label || !Array.isArray(jobs) || !jobs.length) return { rows: [], totalListings: 0 };

  // Bucket
  const buckets = new Map();
  for (const j of jobs) {
    const b = bucketForTitle(j.title);
    if (!b) continue;
    if (!buckets.has(b.title)) buckets.set(b.title, { ...b, items: [] });
    buckets.get(b.title).items.push(j);
  }

  const isFresh = j => {
    const t = Date.parse(j.last_seen_at || j.created_at || '');
    return Number.isFinite(t) && nowMs - t <= 7 * DAY;
  };
  const isNew = j => {
    const t = Date.parse(j.created_at || '');
    return Number.isFinite(t) && nowMs - t <= 14 * DAY;
  };

  const all = [...buckets.values()].filter(b => b.items.length >= 2); // 1 listing ≠ a market
  all.sort((a, b) => b.items.length - a.items.length);
  const top = all.slice(0, 6);

  const totalListings = top.reduce((s, b) => s + b.items.length, 0);
  if (!top.length) return { rows: [], totalListings: 0 };

  const cityFresh = share(top.reduce((s, b) => s + b.items.filter(isFresh).length, 0), totalListings);
  const urg = cityFresh >= 0.5 && totalListings >= 25 ? 'hot' : 'warm';
  const src = `Seen live listings · ${totalListings} tracked`;
  const nowIso = new Date(nowMs).toISOString();

  const rows = top.map(b => {
    const n = b.items.length;
    const freshShare = share(b.items.filter(isFresh).length, n);
    const newShare = share(b.items.filter(isNew).length, n);
    const salaryShare = share(b.items.filter(j => j.salary != null && String(j.salary).trim() !== '' && String(j.salary) !== '—').length, n);
    const volumeNorm = Math.min(1, n / 40);
    // Demand index from OUR corpus: activity-weighted, bounded, explained in the note.
    const di = Math.min(95, Math.max(30, Math.round(35 * freshShare + 25 * newShare + 25 * volumeNorm + 15 * salaryShare)));

    // Majority level among the bucket's listings (honest default when levels are mixed/absent).
    const levelCounts = new Map();
    for (const j of b.items) {
      const l = String(j.level || '').trim();
      if (l) levelCounts.set(l, (levelCounts.get(l) || 0) + 1);
    }
    const level = [...levelCounts.entries()].sort((a, z) => z[1] - a[1])[0]?.[0] || 'Mid level';

    return {
      city: label,
      urg,
      src,
      role_title: b.title,
      niche: b.niche,
      level,
      count: n,
      di,
      note: `Computed from ${n} live listing${n === 1 ? '' : 's'} on Seen · ${Math.round(freshShare * 100)}% seen active in the last 7 days`,
      bls_series_id: null,
      bls_period: null,
      bls_raw_value: null,
      data_version: 'corpus-v1',
      updated_at: nowIso,
    };
  });

  return { rows, totalListings };
}
