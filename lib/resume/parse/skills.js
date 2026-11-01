// Skills parsing: a skills-kind section → groups [{ label, items }]. Supports "Label: a, b, c"
// lines, bulleted lists (one item or a comma list per bullet), bare comma/pipe/bullet lists,
// and the one-skill-per-line sidebar layout.

import { splitSkillList, newId } from '../model.js';
import { BULLET_OPENER_RE } from './lexicon.js';

const wordsOf = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
// "Diagnosed", "Operated", "Rebuilt": a line that opens with a past-tense verb is a bullet.
const PAST_OPENER_RE = /^(?:[A-Za-z]+ed|built|rebuilt|ran|led|drove|wrote|made|grew|took|kept|sold|taught|won|met|set|cut|brought|bought|began|spent|sent|held|found|gave|chose|oversaw|underwent)\b/i;
// A sentence, not a list: splitting it on commas turned "Diagnosed battery, charging, wiring …
// issues" into fragments and lost the words between them (2026-11-01). Conservative on purpose —
// "Python, Java, SQL, Docker" and "public speaking." stay lists.
function isProse(text, bullet, { listOnly = false } = {}) {
  const t = String(text || '').trim();
  const n = wordsOf(t);
  if (n < 6) return false;
  const segs = t.split(/[,;|•·]/).map(wordsOf);
  if (segs.some((w) => w >= 7)) return true;
  if (listOnly) return false; // the items after "Label:" are a list unless one runs as a sentence
  if (BULLET_OPENER_RE.test(t) && PAST_OPENER_RE.test(t) && n >= 8) return true;
  return bullet && n >= 12 && segs.some((w) => w >= 5);
}

const GROUP_RE = /^([A-Za-z&/+ ,'-]{2,40}?)\s*[:：]\s*(.+)$/;
const INLINE_LABEL_SPLIT_RE = /(?<=[a-z0-9)\]][.;])\s+(?=[A-Z][A-Za-z&/+'-]*(?:\s+[A-Za-z&/+'-]+){0,2}\s*[:：]\s)/;

export function parseSkills(lines) {
  const groups = [];
  const seen = new Set();
  let ungrouped = null;
  const add = (label, items) => {
    const clean = [];
    for (const it of items) {
      const k = it.toLowerCase();
      if (!it || seen.has(k)) continue;
      seen.add(k); clean.push(it);
    }
    if (!clean.length) return;
    if (label) { groups.push({ id: newId('s'), label, items: clean }); return; }
    if (!ungrouped) { ungrouped = { id: newId('s'), label: '', items: [] }; groups.push(ungrouped); }
    ungrouped.items.push(...clean);
  };
  // A wrapped paragraph of groups ("Languages: Go, SQL. Data: PostgreSQL, Redis.") carries a
  // second "Label:" after a sentence end; each group is its own piece.
  const pieces = [];
  for (const line of lines) {
    for (const p of String(line.text || '').split(INLINE_LABEL_SPLIT_RE)) if (p.trim()) pieces.push({ text: p.trim(), bullet: !!line.bullet });
  }
  for (const { text, bullet } of pieces) {
    const gm = text.match(GROUP_RE);
    if (gm && gm[1].split(/\s+/).length <= 4 && !isProse(gm[2], false, { listOnly: true })) { add(gm[1].trim(), splitSkillList(gm[2])); continue; }
    // a sentence stays whole — its commas are punctuation, not separators
    if (isProse(text, bullet)) { add('', [text.replace(/\.$/, '')]); continue; }
    const items = splitSkillList(text);
    if (items.length >= 2) { add('', items); continue; }
    // a single phrase: one skill (sidebar layout); never split on "and" ("Hand and power tools")
    add('', [text.replace(/\.$/, '')]);
  }
  return groups;
}
