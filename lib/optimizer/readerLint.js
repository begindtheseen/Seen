// Label-free shape checks on a reading (R8, director): defects a person can see in a displayed statement WITHOUT a gold
// label. Used twice — by the display gate (a statement that fails is repaired when the repair is certain, else hidden) and
// by scripts/reader-lint.mjs (the steering number: defects per 100 displayed lines, by stratum, over the whole corpus).
//
// Every pattern here is bounded and linear: each runs once over one statement's text (≤ ~60 words).

const FUNCTION_END_RE = /(?:^|\s)(?:a|an|the|of|in|on|at|to|for|with|by|from|into|onto|via|and|or|nor|but|as|than|that|which|who|whose|including|such|e\.g|i\.e|like|our|your|their|its|this|these|those|is|are|be|will|can|may|must|should|has|have)$/i;
const OPEN_END_RE = /[(\[{“"‘'—–\-/:,;&]$/;
const NAMED_CREDENTIAL_RE = /^(?:(?:active|current|valid)\s+)?(?:[A-Z][\w&/+.-]*(?:\s+[A-Z0-9][\w&/+.-]*){0,4}|[A-Z]{2,6}(?:[\s-]?\d{1,4})?)(?:\s+(?:license|licence|certification|certificate|clearance|card|endorsement|degree|diploma))?(?:\s+(?:preferred|required))?$/;
const CONTENT_STOP = new Set('a an the of in on at to for with by from into via and or nor but as than that which who is are be will can may must should has have it its this these those our your their you we they i me my per any all each every some such not no yes'.split(' '));
const HEADING_WORD_RE = /^(?:qualifications?|requirements?|responsibilities|duties|benefits|perks|skills|education|experience|overview|summary|about(?:\s+(?:us|you|the\s+role))?|compensation|salary|pay|location|schedule|legal|disclaimer|eeo)\b[:\s]+(?=[A-Z0-9])/i;
const CUE_RE = /\b(?:\d{1,2}\s*\+?\s*(?:years?|yrs?)|experience\s+(?:with|in|as|of)|must|required|requires|preferred|a\s+plus|degree|diploma|bachelor|master|licen[sc]e|certif\w*|ability\s+to|knowledge\s+of|proficien\w*)\b/i;
const JUNK_RE = new RegExp([
  // pay / benefits / perks
  String.raw`\b(?:salary|compensation|pay)\s+(?:range|is|of|between|will|may)\b`, String.raw`\$\s?\d`, String.raw`\b(?:401\s?\(?k\)?|pto|paid\s+time\s+off|health\s+(?:insurance|benefits)|dental|vision\s+(?:insurance|coverage|plan)|tuition\s+(?:assistance|reimbursement)|employee\s+discount|stock\s+options|equity\s+package|parental\s+leave|wellness\s+program|free\s+(?:meals|lunch|snacks))\b`,
  // equal opportunity / legal
  String.raw`\b(?:equal\s+(?:employment\s+)?opportunity|eeo\b|affirmative\s+action|without\s+regard\s+to|protected\s+(?:veteran|class|status)|reasonable\s+accommodation|e-verify|background\s+check\s+policy|fair\s+chance|at[- ]will\s+employment|privacy\s+(?:notice|policy))`,
  // application mechanics
  String.raw`^(?:apply|click|submit|send|email|please\s+(?:apply|submit|send|email))\b`, String.raw`\b(?:apply\s+(?:now|today|online|here)|click\s+(?:here|apply)|submit\s+(?:your\s+)?(?:resume|résumé|application)|(?:resume|résumé)\s+to\b|cover\s+letter\s+to\b)`,
  // company self-description
  String.raw`^(?:we\s+are|we['’]re|our\s+(?:mission|company|team|culture|values|story|vision|clients?)\b|founded\s+in|since\s+\d{4})`, String.raw`\bwas\s+founded\b`,
  // URL / email / phone
  String.raw`https?:\/\/|www\.`, String.raw`[\w.+-]+@[\w-]+\.[\w.]+`, String.raw`\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}`,
  // requisition id
  String.raw`\b(?:req(?:uisition)?\.?\s*(?:id|#|number)|job\s+(?:id|code|number)\s*[:#])`,
].join('|'), 'i');
const QUESTION_RE = /\?\s*["”’]?\s*$/;
const DATE_ONLY_RE = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\.?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/i;
const LOCATION_ONLY_RE = /^(?:(?:remote|hybrid|on-?site)\s*[-–—,:(]?\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3},\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s*\d{5})?\)?\.?$/;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stems = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !CONTENT_STOP.has(w)).map((w) => w.replace(/(?:ing|ed|es|s)$/, '')));

/** The defect kinds of one displayed statement text (empty = clean). */
export function lintText(text) {
  const t = String(text || '').trim();
  const out = [];
  const words = t.split(/\s+/).filter(Boolean);
  const content = words.filter((w) => !CONTENT_STOP.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')) && /[A-Za-z0-9]/.test(w));
  // (a) clipped
  const bare = t.replace(/[.!]+$/, '');
  if (FUNCTION_END_RE.test(bare) || OPEN_END_RE.test(bare) || /^[a-z]/.test(t) || (content.length < 3 && !NAMED_CREDENTIAL_RE.test(t) && !/\b(?:license|licence|certification|clearance|degree|diploma)\b/i.test(t))) out.push('clipped');
  // (b) run-on
  if (/[a-z0-9)%][.!?]\s+[A-Z][a-z]/.test(t) && !/\b(?:e\.g|i\.e|etc|vs|inc|ltd|u\.s|no)\.\s/i.test(t) || HEADING_WORD_RE.test(t) || words.length > 45 || /\.\s+[^.]*\b(?:required|preferred|must|years?\s+of|experience\s+(?:with|in))\b/i.test(t.replace(/\b(?:e\.g|i\.e|etc|inc|u\.s)\./gi, ''))) out.push('run_on');
  // (c) junk-shaped
  if (JUNK_RE.test(t) || QUESTION_RE.test(t) || DATE_ONLY_RE.test(t) || LOCATION_ONLY_RE.test(t)) out.push('junk');
  return [...new Set(out)];
}

/** The defects of a whole reading's displayed statements: per statement (by id) and the counts, incl. (d) duplicates and
 * (e) one sentence under two importances. */
export function lintReading(statements) {
  const shown = (statements || []).filter((s) => s && s.display !== false && s.kind !== 'promise');
  const per = new Map();
  const add = (s, k) => { if (!per.has(s.id)) per.set(s.id, new Set()); per.get(s.id).add(k); };
  for (const s of shown) for (const k of lintText(s.text)) add(s, k);
  for (let i = 0; i < shown.length; i++) {
    const a = shown[i];
    const sa = stems(a.text);
    for (let j = Math.max(0, i - 80); j < i; j++) {
      const b = shown[j];
      if (norm(a.text) === norm(b.text)) { add(a, a.importance !== b.importance ? 'two_importances' : 'duplicate'); continue; }
      const sb = stems(b.text);
      if (sa.size < 3 || sb.size < 3) continue;
      let inter = 0; for (const x of sa) if (sb.has(x)) inter++;
      if (inter / Math.min(sa.size, sb.size) >= 0.9 && inter / Math.max(sa.size, sb.size) >= 0.75) add(a, a.importance !== b.importance ? 'two_importances' : 'duplicate');
    }
  }
  const counts = { shown: shown.length, defective: per.size, clipped: 0, run_on: 0, junk: 0, duplicate: 0, two_importances: 0 };
  for (const ks of per.values()) for (const k of ks) counts[k]++;
  return { per, counts };
}

/** Does a sentence carry its own requirement or duty cue (for postings that arrive as one block)? */
export function hasOwnCue(text, { dutyHead } = {}) {
  const t = String(text || '').trim();
  if (CUE_RE.test(t)) return true;
  if (dutyHead && /^[A-Z][a-z]+/.test(t) && dutyHead(t.split(/\s+/)[0])) return true;
  // a named tool or credential acronym ("SQL", "AWS", "CDL", "PMP")
  return /\b[A-Z]{2,6}\b/.test(t) && !/^[A-Z\s&/-]+$/.test(t);
}

/** The structure a posting text arrived with: 'flat' when it is one block (no line breaks, bullets or headings). */
export function postingStructure(text) {
  const t = String(text || '');
  const lines = t.split(/\n/).filter((l) => l.trim());
  if (lines.length >= 4) return 'structured';
  if (/(?:^|\n)\s*(?:[•▪◦·‣*-]|\d{1,2}[.)])\s+\S/.test(t)) return 'structured';
  return t.length >= 600 ? 'flat' : 'structured';
}

export const POSTING_NOTE_FLAT = 'This posting arrived as one block of text, so we show only the requirements we could read with confidence. Paste it with its line breaks for a fuller read.';

/** A posting's stratum for the lint table (the director's gold strata, by the same tests). */
export function postingStratum(p) {
  const d = String(p.description || '');
  const nl = (d.match(/\n/g) || []).length;
  if (p.source === 'Adzuna' && d.length <= 520) return 'teaser';
  if (nl <= 1 && d.length >= 1600) return 'flat';
  if (d.length >= 6500) return 'long';
  const boil = new Set((d.match(/(equal opportunity|eeo|reasonable accommodation|benefits|401\(k\)|pay range|salary range|e-verify|background check)/gi) || []).map((x) => x.toLowerCase())).size;
  if (boil >= 3) return 'heavy_boilerplate';
  if (nl >= 12 && /(^|\n)\s*(•|·|▪|◦|-|\*|–|\d+[.)])\s+\S/.test(d)) return 'headed_bulleted';
  if (d.length < 1200) return 'short';
  return 'other';
}
