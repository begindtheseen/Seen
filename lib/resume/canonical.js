// ONE résumé text for every score. The free fit check (/api/optimizer), the paid Optimize
// (/api/resume tool:optimize) and the Studio tailor (which scores serializeToText(doc)) used to read
// three different texts for the same résumé — the upload's raw wrapped lines on two of them, the
// structured document on the third — and Tasha saw 46 / 45 / 43 for one résumé and one posting
// (2026-10-25). Every path now scores the canonical text the Studio edits: parsed once, serialized
// once, wrapped bullets joined, headings normalised.
//
// Guard: if the parse would lose words (a layout the parser cannot read), the raw text is used —
// a score must never drop evidence the person wrote.
import { parseResume } from './parse/index.js';
import { serializeToText } from './model.js';

const words = (s) => (String(s || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.%$-]*/g) || []).map((w) => w.replace(/[.]+$/, ''));

/** The canonical text for scoring, or the input itself when canonicalising would lose content. */
export function canonicalResumeText(text) {
  const raw = String(text || '');
  if (raw.trim().length < 40) return raw;
  let out = '';
  try { out = serializeToText(parseResume({ text: raw, source: 'text' })); } catch { return raw; }
  if (!out || !out.trim()) return raw;
  const have = new Map();
  for (const w of words(out)) have.set(w, (have.get(w) || 0) + 1);
  const src = words(raw);
  let kept = 0;
  for (const w of src) { const c = have.get(w) || 0; if (c > 0) { kept++; have.set(w, c - 1); } }
  return src.length && kept / src.length >= 0.97 ? out : raw;
}
