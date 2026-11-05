// Saved résumés on the client — pure helpers shared by the résumé page, the Optimize sheet and Apply on
// Seen (plain JS so node:test runs them). The server rules live in lib/server/resumes.js.
import { MAX_RESUMES_PRO } from './server/creditRules.js';

/** How the picker shows: nothing (no list / not live), just the name (one résumé), or a choice. */
export function pickerMode(list) {
  if (!list || list.ready !== true || !Array.isArray(list.resumes) || list.resumes.length === 0) return 'hidden';
  return list.resumes.length === 1 ? 'name' : 'select';
}

/** The default résumé (the one every other surface uses). */
export function defaultResume(list) {
  const rows = (list && Array.isArray(list.resumes)) ? list.resumes : [];
  return rows.find((r) => r.is_default) || rows[0] || null;
}

/** May another résumé be added right now? */
export function canAddResume(list) {
  return !!list && list.ready === true && (list.count ?? (list.resumes || []).length) < (list.max || 0);
}

/** "1 of 1 — get more with Pro" / "3 of 5" / "3 saved — only your default works without Pro". */
export function capLine(list) {
  if (!list || list.ready !== true) return '';
  const count = list.count ?? (list.resumes || []).length;
  const max = list.max || 0;
  if (list.pro !== true && count > max) return `${count} saved — only your default can be used without Pro`;
  if (list.pro !== true && count >= max) return `${count} of ${max} — keep up to ${MAX_RESUMES_PRO} with Pro`;
  return `${count} of ${max}`;
}

/** One option in the picker. */
export function optionLabel(r) {
  return `${r.name}${r.is_default ? ' (default)' : ''}${r.usable ? '' : ' · Pro'}`;
}

/** The id to select: the one asked for while it is usable, else the default. */
export function chooseResumeId(list, wanted) {
  const rows = (list && Array.isArray(list.resumes)) ? list.resumes : [];
  const hit = rows.find((r) => r.id === wanted && r.usable);
  return hit ? hit.id : (defaultResume(list)?.id || null);
}
