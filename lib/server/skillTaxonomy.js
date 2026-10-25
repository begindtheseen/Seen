// The DB skill taxonomy overlay (skill_aliases / skill_relationships), loaded the SAME way for every
// scoring path: the free fit check (api/optimizer.js), the paid Optimize and the Studio tailor
// (api/resume.js). Only the free check used to read it, so the same résumé and posting scored 46 on
// the Fit tab and 45 in the paid package (Tasha, 2026-10-25). Cached per warm instance for 5
// minutes; any failure answers null and every path falls back to the built-in taxonomy together.

let cache = { ts: 0, tax: null, ok: false };

/** @returns {Promise<{ aliases: object, relationships: object } | null>} */
export async function loadSkillTaxonomy({ fetchImpl = globalThis.fetch } = {}) {
  if (Date.now() - cache.ts < 5 * 60_000 && cache.ok) return cache.tax;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || typeof fetchImpl !== 'function') return null;
  const db = (path) => fetchImpl(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const tax = { aliases: {}, relationships: {} };
  try {
    const [aRes, rRes] = await Promise.all([
      db('skill_aliases?select=skill,alias&limit=2000'),
      db('skill_relationships?select=from_skill,to_skill,weight&limit=2000'),
    ]);
    if (aRes && aRes.ok) for (const row of await aRes.json()) {
      if (row.alias && row.skill) tax.aliases[String(row.alias).toLowerCase()] = String(row.skill).toLowerCase();
    }
    if (rRes && rRes.ok) for (const row of await rRes.json()) {
      const from = String(row.from_skill || '').toLowerCase();
      if (!from || !row.to_skill) continue;
      (tax.relationships[from] ||= []).push({ to: String(row.to_skill).toLowerCase(), weight: Number(row.weight) || 0.5 });
    }
  } catch { /* built-in taxonomy */ }
  cache = { ts: Date.now(), tax, ok: true };
  return tax;
}

/** Test hook. */
export function _resetSkillTaxonomyCache() { cache = { ts: 0, tax: null, ok: false }; }
