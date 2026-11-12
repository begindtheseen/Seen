// What changed between two versions of the tailored résumé, in one sentence a person can check against the page
// (owner, 2026-11-12: re-optimize must say what is different). Read from the two documents only — the roles each shows
// in full or as a line, the line each job opens with, the summary, the "Relevant Experience" layout — so the sentence can
// never describe a change the page does not carry. Pure; runs in the browser and on the server.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const short = (t, n = 60) => { const x = String(t || '').replace(/^[\s•·*–-]+/, '').replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, ''); return x.length > n ? `${x.slice(0, n).replace(/\s+\S*$/, '')}…` : x; };
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const nameOf = (e) => String(e.displayCompany || e.company || e.displayTitle || e.title || 'one job').trim();

/** Each role on the page: shown in full (its lines) or as one line under Additional Experience. */
function rolesOf(doc) {
  const out = new Map();
  for (const e of (doc && doc.experience) || []) out.set(norm(`${e.title} ${e.company}`), { name: nameOf(e), full: true, lead: ((e.bullets || [])[0] || {}).text || '', n: (e.bullets || []).length });
  for (const x of (doc && doc.extra) || []) {
    if (x.title !== 'Additional Experience') continue;
    for (const it of x.items || []) {
      // "Title — Company (dates)"
      const t = String(it.text || '').replace(/\s*\([^)]*\)\s*$/, '');
      const [title, company = ''] = t.split(' — ');
      const key = norm(`${title} ${company}`);
      if (!out.has(key)) out.set(key, { name: String(company || title).trim(), full: false, lead: '', n: 0 });
    }
  }
  return out;
}

/**
 * @param {object | null} prev the version the person was looking at
 * @param {object | null} next the new version
 * @returns {string} "This one keeps Fry's Food Stores in full and condenses Towne Park to one line." — or a plain fallback
 */
export function describeVersionChange(prev, next) {
  if (!prev || !next) return '';
  const a = rolesOf(prev), b = rolesOf(next);
  const parts = [];
  const condensed = [], expanded = [], gone = [], back = [];
  for (const [k, r] of b) {
    const p = a.get(k);
    if (!p) { back.push(r.name); continue; }
    if (p.full && !r.full) condensed.push(r.name);
    if (!p.full && r.full) expanded.push(r.name);
  }
  for (const [k, p] of a) if (!b.has(k)) gone.push(p.name);
  if (expanded.length) parts.push(`keeps ${listJoin(expanded)} in full`);
  if (condensed.length) parts.push(`condenses ${listJoin(condensed)} to one line`);
  if (back.length) parts.push(`puts ${listJoin(back)} back on the page`);
  if (gone.length) parts.push(`leaves ${listJoin(gone)} off`);
  // which line each job opens with (only jobs shown in full in both)
  for (const [k, r] of b) {
    const p = a.get(k);
    if (!p || !p.full || !r.full || !r.lead || norm(p.lead) === norm(r.lead)) continue;
    parts.push(`opens ${r.name} with “${short(r.lead)}”`);
    if (parts.length >= 3) break;
  }
  const sa = norm(prev.basics && prev.basics.summary), sb = norm(next.basics && next.basics.summary);
  if (sa !== sb) parts.push(!sb ? 'leaves the summary off' : !sa ? 'adds a summary built from your own lines' : 'uses a different summary');
  const relA = !!(prev.meta && prev.meta.sectionTitles && /relevant/i.test(prev.meta.sectionTitles.experience || ''));
  const relB = !!(next.meta && next.meta.sectionTitles && /relevant/i.test(next.meta.sectionTitles.experience || ''));
  if (relA !== relB) parts.push(relB ? 'puts your most relevant jobs first under Relevant Experience' : 'lists your jobs most recent first');
  if (!parts.length) {
    // the same roles, leads and summary: the difference is further down a job's lines
    const moved = [...b].find(([k, r]) => { const p = a.get(k); return p && p.full && r.full && p.n !== r.n; });
    return moved ? `This one shows a different number of lines under ${moved[1].name}.` : 'This one orders a few lines differently.';
  }
  return `This one ${listJoin(parts.slice(0, 3))}.`;
}
