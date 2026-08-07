// Resume Intelligence Engine — TAXONOMY API (Phase 5).
//
// Turns the concept seed (taxonomyData.js) into fast lookups the rest of the engine uses:
//   • resolveConcept(surface)  → canonical concept id via ALIAS match (same concept, diff words)
//   • relatedConcepts(id)      → connected but DIFFERENT concepts (broader/narrower/associated)
//   • aliasSurfaces()          → every alias phrase, longest-first, for phrase extraction
//   • category/domains/display metadata
//   • mergeTaxonomy(extra)     → fold a build-time ESCO/O*NET index over the hand-authored core
//
// The alias vs related distinction is preserved end-to-end: an ALIAS resolves to the SAME id (WMS →
// warehouse_management_system); a RELATED concept is a different id reachable with a weight (WMS ~
// warehouse_operations). Pure + deterministic, no AI, no I/O.

import { CONCEPTS as SEED } from './taxonomyData.js';

// Normalize a raw surface for matching: lowercase, unify quotes, keep +#./ (c++, ci/cd, node.js),
// collapse whitespace. Deterministic.
export function normSurface(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9+#./ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build the runtime indexes from a concept map. Exposed so a merged taxonomy can be rebuilt.
function buildIndexes(concepts) {
  const aliasToId = new Map(); // normalized alias surface → concept id
  const aliasList = [];        // [normalized surface] for longest-first scanning
  for (const [id, c] of Object.entries(concepts)) {
    const aliases = c.aliases && c.aliases.length ? c.aliases : [c.display];
    for (const a of aliases) {
      const n = normSurface(a);
      if (!n) continue;
      if (!aliasToId.has(n)) { aliasToId.set(n, id); aliasList.push(n); }
    }
    // the id itself and the display are always resolvable
    const idNorm = normSurface(id.replace(/_/g, ' '));
    if (!aliasToId.has(idNorm)) { aliasToId.set(idNorm, id); aliasList.push(idNorm); }
  }
  aliasList.sort((a, b) => b.length - a.length || a.localeCompare(b)); // longest phrase wins
  return { aliasToId, aliasList };
}

let _concepts = SEED;
let _idx = buildIndexes(SEED);

// Merge a bigger taxonomy (e.g. a pruned ESCO/O*NET index) OVER the hand-authored core. `extra` is
// a concept map in the same shape; its entries win on id collision, and its aliases/related extend
// the core. Rebuilds the indexes. Returns the active concept map. (Build-time augmentation path —
// the runtime never needs it, but it's how the full ESCO index would load without code changes.)
export function mergeTaxonomy(extra) {
  if (!extra || typeof extra !== 'object') return _concepts;
  const merged = { ..._concepts };
  for (const [id, c] of Object.entries(extra)) {
    if (merged[id]) {
      merged[id] = {
        ...merged[id], ...c,
        aliases: [...new Set([...(merged[id].aliases || []), ...(c.aliases || [])])],
        related: [...(merged[id].related || []), ...(c.related || [])],
      };
    } else merged[id] = c;
  }
  _concepts = merged;
  _idx = buildIndexes(merged);
  return _concepts;
}

export function conceptMap() { return _concepts; }
export function getConcept(id) { return _concepts[id] || null; }
export function conceptCategory(id) { return _concepts[id]?.category || 'skill'; }
export function conceptDomains(id) { return _concepts[id]?.domains || []; }
export function conceptDisplay(id) {
  return _concepts[id]?.display || String(id || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Every alias surface, longest-first — the concept extractor scans text against this list.
export function aliasSurfaces() { return _idx.aliasList; }

// Resolve a raw surface to a canonical concept id via ALIAS match. Tries the exact normalized
// surface, then a light singularization, then null (caller falls back to open-vocabulary). Returns
// { id, display, category, via } or null.
export function resolveConcept(surface) {
  const n = normSurface(surface);
  if (!n) return null;
  let id = _idx.aliasToId.get(n);
  if (!id) {
    // light singularize the last token (associates → associate) and retry
    const sing = n.replace(/(\w{4,})s\b/g, '$1');
    if (sing !== n) id = _idx.aliasToId.get(sing);
  }
  if (!id) return null;
  return { id, display: conceptDisplay(id), category: conceptCategory(id), via: 'alias' };
}

// Related concepts (DIFFERENT ids), both declared and reverse edges, de-duped by strongest weight.
// Returns [{ to, weight, kind }]. `kind` ∈ broader | narrower | associated (reverse of broader is
// narrower and vice-versa, so the graph reads correctly from either node).
export function relatedConcepts(id) {
  const out = new Map();
  const put = (to, w, kind) => {
    if (to === id) return;
    const prev = out.get(to);
    if (!prev || w > prev.weight) out.set(to, { to, weight: w, kind });
  };
  for (const [to, w, kind] of _concepts[id]?.related || []) put(to, w, kind);
  const flip = { broader: 'narrower', narrower: 'broader', associated: 'associated' };
  for (const [from, c] of Object.entries(_concepts)) {
    for (const [to, w, kind] of c.related || []) {
      if (to === id) put(from, w, flip[kind] || 'associated');
    }
  }
  return [...out.values()].sort((a, b) => b.weight - a.weight);
}

// Is concept `id` plausible for a role family? Empty domains = cross-industry (always plausible).
export function conceptPlausibleFor(id, family) {
  const d = conceptDomains(id);
  return d.length === 0 || d.includes(family);
}
