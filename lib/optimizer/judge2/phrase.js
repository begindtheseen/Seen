// judge2: the sentences a person reads beside a verdict, written from the LINE's own words (why) and the STATEMENT's
// own whole words (missing). Never a stem, never a slice across punctuation, never a bare function word.
import { surfaceTokens } from './reading.js';
import { inflectionCandidates } from '../../text/morph.js';

const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'our', 'your', 'their', 'its', 'all', 'any', 'each', 'every', 'this', 'that', 'into', 'per', 'via', 'is', 'are', 'be']);
// words that open a line with a doing word in the first person ("Run the afternoon shift", "Built …", "handle …")
const NOT_A_VERB_START = /^(?:[A-Z][a-z]+\s*[,:]|\d|[A-Z]{2,}\b|(?:[Tt]he|[Aa]n?|[Mm]y|[Oo]ur|[Aa]ll|[Ee]very|[Ee]ach|[Dd]aily|[Ww]eekly|[Ff]ront|[Bb]ack|[Cc]afe|[Hh]ot|[Cc]old)\b)/;

/** Cut a line to a readable clause: up to the first "; ", " - " / " — " aside, or ~90 characters at a word break. @param {string} line */
export function lineClause(line) {
  let t = String(line || '').replace(/\s+/g, ' ').trim();
  t = t.split(/\s*;\s*|\s+[-–—]\s+(?=[a-z])/)[0];
  if (t.length > 95) { const cut = t.slice(0, 95); t = cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)); }
  return t.replace(/[\s,:(–—-]+$/, '').replace(/\($/, '').trim();
}

/**
 * Why a line proves a statement, in the line's own words:
 *  - a doing line that opens on its verb: "you <the line>" ("you count the drawers and do the nightly deposit");
 *  - a list line: "your skills line lists <the words it shares>";
 *  - a job header: "you work as <title> at <employer>" / "you worked as …";
 *  - any other line: "your line names <the words it shares>".
 * @param {{ text: string, kind: string }} line
 * @param {string[]} shared surface words of the line that matched
 * @param {{ verbStart: boolean, role?: { title: string, employer: string, current: boolean } | null }} info
 */
export function whyOf(line, shared, info) {
  const words = [...new Set(shared.filter(Boolean))].slice(0, 3);
  const list = words.length === 2 ? words.join(' and ') : words.join(', ');
  if (line.kind === 'role' && info.role) return `you ${info.role.current ? 'work' : 'worked'} as ${info.role.title}${info.role.employer ? ` at ${info.role.employer}` : ''}`;
  if (line.kind === 'skills' || line.kind === 'cert') return words.length ? `your ${line.kind === 'cert' ? 'certifications line' : 'skills line'} lists ${list}` : 'it is on your skills line';
  if (line.kind === 'education') return words.length ? `your education line names ${list}` : 'it is on your education line';
  if (line.kind === 'doing' && info.verbStart) {
    const c = lineClause(line.text);
    return `you ${c.charAt(0).toLowerCase()}${c.slice(1)}`;
  }
  return words.length ? `your line names ${list}` : `your line says ${lineClause(line.text)}`;
}

/** Does a line open on a doing word? @param {string} text @param {boolean} actionFirst the line's first unit is an action */
export function verbStart(text, actionFirst) {
  const t = String(text || '').trim();
  if (NOT_A_VERB_START.test(t)) return false;
  // a word followed straight away by a determiner is a verb ("Run the …", "Train every …", "Built a …")
  if (/^[A-Za-z]+(?:\s+(?:up|out|down|in|off|over|back))?\s+(?:the|a|an|every|each|all|our|my|new|daily|weekly|monthly)\b/i.test(t) && !/^(?:in|on|at|for|with|from|of|to|by|as|and|or|after|before)\b/i.test(t)) return true;
  return actionFirst || /^[A-Za-z]+ed\b/.test(t);
}

/**
 * A missing phrase in the statement's own whole words: the span from the first to the last of `want` (lower-case
 * tokens) inside one punctuation-free stretch of the statement, trimmed of function words at both ends.
 * @param {string} statement @param {string[]} want tokens of the units that are missing
 */
export function spanOf(statement, want) {
  if (!want.length) return '';
  const toks = surfaceTokens(statement);
  const idx = toks.map((t, i) => (want.includes(t.w) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return '';
  let a = idx[0];
  let b = idx[0];
  // grow to the following wanted tokens while no punctuation separates them and the span stays short
  for (const i of idx.slice(1)) {
    const gap = statement.slice(toks[b].end, toks[i].at);
    if (/[,;:()/]|\s[-–—]\s/.test(gap) || i - a > 6) break;
    b = i;
  }
  while (a < b && FUNCTION_WORDS.has(toks[a].w)) a++;
  while (b > a && FUNCTION_WORDS.has(toks[b].w)) b--;
  return statement.slice(toks[a].at, toks[b].end).trim();
}

/** Are all words of a phrase somewhere on the résumé (then it is not "missing" in those words)? @param {string} phrase @param {Set<string>} resumeWords */
export function allOnResume(phrase, resumeWords) {
  const ws = surfaceTokens(phrase).map((t) => t.w).filter((w) => !FUNCTION_WORDS.has(w) && w.length > 2);
  return ws.length >= 2 && ws.every((w) => inflectionCandidates(w).some((f) => resumeWords.has(f)));
}
