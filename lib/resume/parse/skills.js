// Skills parsing: a skills-kind section → groups [{ label, items }]. Supports "Label: a, b, c"
// lines, bulleted lists (one item or a comma list per bullet), bare comma/pipe/bullet lists,
// and the one-skill-per-line sidebar layout.

import { splitSkillList, newId } from '../model.js';

const GROUP_RE = /^([A-Za-z&/+ ,'-]{2,40}?)\s*[:：]\s*(.+)$/;

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
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const gm = text.match(GROUP_RE);
    if (gm && gm[1].split(/\s+/).length <= 4) { add(gm[1].trim(), splitSkillList(gm[2])); continue; }
    const items = splitSkillList(text);
    if (items.length >= 2) { add('', items); continue; }
    // A single phrase: one skill (sidebar layout), unless it is a long sentence.
    if (text.split(/\s+/).length <= 7) add('', [text.replace(/\.$/, '')]);
    else add('', splitSkillList(text.replace(/\b(?:and|&)\b/g, ',')));
  }
  return groups;
}
