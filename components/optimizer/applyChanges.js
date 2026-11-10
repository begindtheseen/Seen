// The paid result's toggles, applied to the finished résumé the server returned (`tailored.doc`, every
// default-applied change already in it). Pure, instant, no network, no credit.
//
// Why here and not lib/resume/tailor/optimizer.js applyPlan: the paid Optimize answer carries the finished
// document and its change list (`tailored.changes`, each with before → after) but not the Tailor plan, so the
// one plan-based apply path cannot run in the browser for it (server request in reports/s-screens-b.md: ship
// `tailored.plan` + `tailored.base`). Until then every toggle moves exactly the text the server listed for that
// change — nothing is re-derived, re-worded or re-ranked here — and a change whose text cannot be found in
// the document is left as the server built it (and reported as not undoable).
//
// Change types (lib/resume/tailor/paid.js, tailor.js buildChanges): format · heading (never toggled: the
// re-typesetting and its headings are the document) · reorder · summary · skills · rewrite · cut.

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
const lines = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean);
const roleWhere = (e) => [e.displayTitle || e.title, e.displayCompany || e.company].filter(Boolean).join(' · ');

/** Changes a person can accept or undo (the re-typesetting is not one of them). */
export const TOGGLEABLE = new Set(['reorder', 'summary', 'skills', 'rewrite', 'cut']);
export const isToggleable = (c) => !!c && TOGGLEABLE.has(c.type);
/** On by default = the server applied it (`default: 'applied'`); a proposal (`needs_ok`) is off until accepted. */
export const defaultOn = (c) => !!c && c.default !== 'needs_ok';

function findBullet(doc, id) {
  for (const e of doc.experience || []) { const b = (e.bullets || []).find((x) => x.id === id); if (b) return { e, b }; }
  return null;
}

/** Undo one applied change in place. Returns false when its text is no longer where the server put it. */
function revert(doc, c) {
  if (c.type === 'summary') { if (!same(doc.basics.summary, c.after)) return false; doc.basics.summary = c.before || ''; return true; }
  if (c.type === 'reorder') {
    const e = (doc.experience || []).find((x) => `reorder:${x.id}` === c.id);
    if (!e) return false;
    const want = lines(c.before);
    const pool = [...e.bullets];
    const out = [];
    for (const t of want) { const i = pool.findIndex((b) => same(b.text, t)); if (i >= 0) out.push(pool.splice(i, 1)[0]); }
    if (out.length < 2) return false;
    e.bullets = [...out, ...pool];
    return true;
  }
  if (c.type === 'skills') {
    const g = (doc.skills || []).find((x) => `skills:${x.id}` === c.id);
    if (!g) return false;
    const added = new Set((c.added || []).map((a) => String(a.term || '').toLowerCase()));
    const kept = g.items.filter((i) => !added.has(String(i).toLowerCase()));
    const before = String(c.before || '').split(/,\s+/).map((x) => x.trim()).filter(Boolean);
    const keptSet = new Set(kept.map((x) => x.toLowerCase()));
    g.items = before.length && before.every((x) => keptSet.has(x.toLowerCase())) && before.length === kept.length ? before : kept;
    return true;
  }
  if (c.type === 'rewrite') {
    const hit = findBullet(doc, String(c.id).replace(/^rewrite:/, ''));
    if (!hit || !same(hit.b.text, c.after)) return false;
    hit.b.text = c.before; return true;
  }
  if (c.type === 'cut') {
    const id = String(c.id).replace(/^cut:/, '');
    if (findBullet(doc, id)) return false;
    const e = (doc.experience || []).find((x) => roleWhere(x) === c.where) || null;
    if (!e) return false;
    e.bullets.push({ id, text: c.before }); return true;
  }
  return false;
}

/** Apply one proposal (`needs_ok`) the person accepted. */
function accept(doc, c) {
  if (c.type === 'rewrite') {
    const hit = findBullet(doc, String(c.id).replace(/^rewrite:/, ''));
    if (!hit || !same(hit.b.text, c.before)) return false;
    hit.b.text = c.after; return true;
  }
  if (c.type === 'summary') { doc.basics.summary = c.after || ''; return true; }
  return false;
}

/**
 * The document the person will send: the server's finished résumé with their toggles and answered lines.
 * @param {object} doc         tailored.doc (never mutated)
 * @param {Array<Record<string, any>>} changes tailored.changes
 * @param {Record<string, boolean>} on   changeId → on/off (missing = the server's default)
 * @param {Array<{ id: string, itemId?: string, bulletId?: string, kind?: string, answerKind?: string|null, line: string }>} [answered]
 * @returns {{ doc: object, marks: { summary: string|null, bullets: Record<string,string>, skills: Record<string,string>, certs: Record<string,string> }, stuck: string[] }}
 */
export function applyToggles(doc, changes, on = {}, answered = []) {
  const d = clone(doc);
  const stuck = [];
  for (const c of changes || []) {
    if (!isToggleable(c)) continue;
    const want = on[c.id] ?? defaultOn(c);
    if (want === defaultOn(c)) continue;
    const ok = want ? accept(d, c) : revert(d, c);
    if (!ok) stuck.push(c.id);
  }
  const marks = { summary: null, bullets: {}, skills: {}, certs: {} };
  for (const c of changes || []) {
    if (!isToggleable(c) || stuck.includes(c.id)) continue;
    if (!(on[c.id] ?? defaultOn(c))) continue;
    if (c.type === 'summary') marks.summary = c.id;
    if (c.type === 'skills') { const g = d.skills.find((x) => `skills:${x.id}` === c.id); if (g) marks.skills[g.id] = c.id; }
    if (c.type === 'rewrite') marks.bullets[String(c.id).replace(/^rewrite:/, '')] = c.id;
    if (c.type === 'reorder') {
      const e = d.experience.find((x) => `reorder:${x.id}` === c.id);
      const up = (c.moved || []).filter((m) => m.to < m.from).map((m) => m.text);
      if (e) for (const b of e.bullets) if (up.some((t) => same(t, b.text))) marks.bullets[b.id] = c.id;
    }
  }
  // answered questions: a number completes the line it was asked about; a credential is a certification; any
  // other answer is a new line at the top of the role it was asked for
  for (const a of answered || []) {
    if (!a || !String(a.line || '').trim()) continue;
    const mark = `q:${a.id}`;
    if (a.bulletId) {
      const hit = findBullet(d, a.bulletId);
      if (hit) { hit.b.text = a.line; marks.bullets[hit.b.id] = mark; continue; }
    }
    if (a.kind === 'gap' && a.answerKind === 'credential') {
      if (!d.certifications.some((c) => same(c.text || c.name, a.line))) {
        const id = `ans_${a.id}`;
        d.certifications.push({ id, text: a.line, name: a.line, issuer: '', date: '', url: '' });
        if (Array.isArray(d.sectionOrder) && !d.sectionOrder.includes('certifications')) d.sectionOrder.push('certifications');
        marks.certs[id] = mark;
      }
      continue;
    }
    const e = d.experience.find((x) => x.id === a.itemId) || d.experience[0];
    if (!e) continue;
    const id = `ans_${a.id}`;
    e.bullets.unshift({ id, text: a.line });
    marks.bullets[id] = mark;
  }
  return { doc: d, marks, stuck };
}

/** The server's question as the shared answer composer reads it (bulletFromAnswer wants answerKind + label). */
export function promptFor(q) {
  return { ...q, answerKind: q.answerKind || q.answer_kind || null, label: q.label || q.term || q.requirement || '' };
}

/**
 * What kind of field a question gets. A number question shows a numeric field and the exact line it will
 * complete; a tool / duty / credential question shows a text field worded for what it is.
 * @returns {'number'|'credential'|'tool'|'duty'}
 */
export function questionKind(q) {
  if (q.kind === 'metric' || q.unit === 'line' || /\[(?:number|the number)[^\]]*\]/i.test(String(q.template || ''))) return 'number';
  const k = q.answerKind || q.answer_kind;
  if (k === 'credential') return 'credential';
  if (k === 'tool') return 'tool';
  return 'duty';
}

/** The template line with its blank shown as a blank ("Do [number] cycle counts…" → "Do ___ cycle counts…"). */
export function blankLine(template) {
  return String(template || '').replace(/,?\s*\[the number[^\]]*\]/i, ', ___').replace(/\[[^\]]+\]/g, '___');
}
