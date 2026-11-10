// What occupation a job title names, how two occupations relate, and what the job involves — from the
// O*NET 31.0 Database (USDOL/ETA, CC BY 4.0) shipped in lib/occupations/data (rebuild with
// scripts/occupations/build-occupations.mjs). No network, no model: lookups and rules over public data.
//
//   occupationOf(title, { lines?, employer? }) → { code, title, confidence, group, zone, alternatives, via } | null
//   relation(a, b, { lines? })                 → { relation: 'same'|'ladder'|'related'|'different', direction?, why }
//   tasksOf(code) / toolsOf(code)              → O*NET task statements / technology examples
//   impliedDuties(title, lines?)               → the tasks of the person's own occupation
//   militaryOccupation(text)                   → { service, moc, mocTitle, occupations: [{code,title}], via } | null
//   levelOf(title)                             → { marker, rank } by rule from the title's words
//   occupation(code)                           → the stored record for one code
//
// The data is read once per process, on first use (occupations ~1.7 MB, titles ~1.1 MB, military ~1.2 MB).
// What this can and cannot conclude is written down in lib/occupations/README.md. Tests: index.test.mjs.

import { readFileSync } from 'node:fs';
import { normTitle, stripLevel, titleVariants } from './normalize.js';
import { stem, words, isStopWord } from '../text/morph.js';

/** @typedef {{ code: string, title: string, zone: number, related: Array<[number, number]>, tasks: string[], tools: string[], altCount: number }} Occ */
/** @typedef {{ code: string, title: string }} OccRef */
/** @typedef {{ major: string, majorTitle: string, minor: string, broad: string, detailed: string }} Group */
/** @typedef {{ code: string, title: string, confidence: 'exact'|'close'|'guess', group: Group, zone: number, alternatives: OccRef[], via: string, matched?: string, ambiguous?: boolean }} OccupationMatch */

const MAJOR = {
  11: 'Management', 13: 'Business and Financial Operations', 15: 'Computer and Mathematical',
  17: 'Architecture and Engineering', 19: 'Life, Physical, and Social Science', 21: 'Community and Social Service',
  23: 'Legal', 25: 'Educational Instruction and Library', 27: 'Arts, Design, Entertainment, Sports, and Media',
  29: 'Healthcare Practitioners and Technical', 31: 'Healthcare Support', 33: 'Protective Service',
  35: 'Food Preparation and Serving Related', 37: 'Building and Grounds Cleaning and Maintenance',
  39: 'Personal Care and Service', 41: 'Sales and Related', 43: 'Office and Administrative Support',
  45: 'Farming, Fishing, and Forestry', 47: 'Construction and Extraction', 49: 'Installation, Maintenance, and Repair',
  51: 'Production', 53: 'Transportation and Material Moving', 55: 'Military Specific',
};

/** @param {string} name */
function load(name) { return JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8')); }

/** @type {{ list: Occ[], byCode: Map<string, number> } | null} */
let OCC = null;
function occ() {
  if (OCC) return OCC;
  const d = load('occupations.json');
  /** @type {Occ[]} */
  const list = d.o.map((/** @type {any[]} */ r) => {
    /** @type {Array<[number, number]>} */
    const related = [];
    for (let i = 0; i < r[3].length; i += 2) related.push([r[3][i], r[3][i + 1]]);
    return { code: r[0], title: r[1], zone: r[2], related, tasks: r[4], tools: r[5], altCount: r[6] };
  });
  OCC = { list, byCode: new Map(list.map((o, i) => [o.code, i])) };
  return OCC;
}

/** @param {string} code @returns {Occ | null} */
export function occupation(code) {
  const o = occ();
  const i = o.byCode.get(String(code || ''));
  return i == null ? null : o.list[i];
}

/** @param {string} code @returns {Group} */
export function groupOf(code) {
  const c = String(code || '');
  const major = c.slice(0, 2);
  return { major, majorTitle: MAJOR[Number(major)] || '', minor: c.slice(0, 4), broad: c.slice(0, 6), detailed: c.slice(0, 7) };
}

/** @param {number} i @returns {OccRef} */
const ref = (i) => ({ code: occ().list[i].code, title: occ().list[i].title });

// ---------------------------------------------------------------- title index
/** @type {{ t: Record<string, any[]>, heads: Map<string, Map<string, number[]>>, byStem: Map<string, string[]>, idf: Map<string, number>, n: number } | null} */
let TI = null;
function titles() {
  if (TI) return TI;
  const d = load('titles.json');
  /** @type {Map<string, string[]>} */
  const byStem = new Map();
  /** @type {Map<string, number>} */
  const df = new Map();
  let n = 0;
  for (const head of Object.keys(d.t)) {
    const s = stem(head);
    if (!byStem.has(s)) byStem.set(s, []);
    byStem.get(s)?.push(head);
    for (const e of d.t[head]) {
      n++;
      const seen = new Set();
      for (const w of (e[0] ? e[0].split(' ') : [])) { const k = stem(w); if (!seen.has(k)) { seen.add(k); df.set(k, (df.get(k) || 0) + 1); } }
    }
  }
  const idf = new Map([...df].map(([k, v]) => [k, Math.log(1 + n / v)]));
  TI = { t: d.t, heads: new Map(), byStem, idf, n };
  return TI;
}

/** @param {string} head */
function headMap(head) {
  const T = titles();
  let m = T.heads.get(head);
  if (!m) {
    m = new Map();
    for (const e of (Object.hasOwn(T.t, head) ? T.t[head] : [])) m.set(e[0], e.slice(1));
    T.heads.set(head, m);
  }
  return m;
}

/** Exact key lookup → [[occIndex, weight], …] strongest first, or null. @param {string} key */
function exactKey(key) {
  if (!key) return null;
  const toks = key.split(' ');
  const head = toks[toks.length - 1];
  const vals = headMap(head).get(toks.slice(0, -1).join(' '));
  return vals ? vals.map((n) => [Math.floor(n / 8), n % 8]) : null;
}

/**
 * Exact lookup re-ranked by the wider evidence of every O*NET title that ENDS with this one: an exact
 * "account executive" sits under one occupation, but "sales account executive", "insurance account
 * executive" … show where the phrase is mostly used. Exact entries count three times a suffix entry.
 * Returns [[occIndex, weight 0–7], …] or null when there is no exact entry.
 * @param {string} key
 */
function voteKey(key) {
  const exact = exactKey(key);
  if (!exact) return null;
  const toks = key.split(' ');
  const head = toks[toks.length - 1];
  const rest = toks.slice(0, -1).join(' ');
  /** @type {Map<number, number>} */
  const score = new Map();
  for (const [i, w] of exact) score.set(i, (score.get(i) || 0) + 3 * (w + 1));
  let n = 0;
  for (const [r, vals] of headMap(head)) {
    if (r === rest || !(rest === '' || r.endsWith(` ${rest}`))) continue;
    n++;
    for (const v of vals) score.set(Math.floor(v / 8), (score.get(Math.floor(v / 8)) || 0) + 0.5 * ((v % 8) + 1));
  }
  if (!n) return exact;
  const top = Math.max(...score.values());
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8).map(([i, sc]) => [i, (7 * sc) / top]);
}

/** @param {string} w */
const idfOf = (w) => titles().idf.get(stem(w)) ?? Math.log(1 + titles().n);

const GENERIC_HEADS = new Set(['member', 'worker', 'associate', 'staff', 'person', 'professional', 'employee', 'crew', 'team', 'intern', 'trainee', 'apprentice', 'helper', 'lead', 'assistant']);

/**
 * Same head word (by stem), best modifier overlap (IDF-weighted Dice). Returns the best entry or null.
 * @param {string} key
 * @returns {{ hits: number[][], score: number, matched: string } | null}
 */
function fuzzyKey(key) {
  const toks = key.split(' ').filter((w) => !isStopWord(w));
  if (!toks.length) return null;
  const head = toks[toks.length - 1];
  const mods = toks.slice(0, -1);
  const heads = titles().byStem.get(stem(head)) || [];
  const qm = new Map(mods.map((w) => [stem(w), idfOf(w)]));
  const qMass = [...qm.values()].reduce((a, b) => a + b, 0);
  /** @type {{ hits: number[][], score: number, matched: string } | null} */
  let best = null;
  for (const h of heads) {
    for (const [rest, vals] of headMap(h)) {
      const em = new Map((rest ? rest.split(' ') : []).filter((w) => !isStopWord(w)).map((w) => [stem(w), idfOf(w)]));
      let shared = 0;
      for (const [k, v] of qm) if (em.has(k)) shared += v;
      const eMass = [...em.values()].reduce((a, b) => a + b, 0);
      // The head word counts as one shared unit so "sergeant" alone still scores against "sergeant".
      const score = (2 * (shared + 1)) / (qMass + eMass + 2);
      const hits = vals.map((n) => [Math.floor(n / 8), n % 8]);
      const strength = hits[0][1];
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && strength > best.hits[0][1])) {
        best = { hits, score, matched: rest ? `${rest} ${h}` : h };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- task vocabulary (for the lines fallback)
const TASK_STOP = new Set(['perform', 'ensur', 'use', 'work', 'other', 'relat', 'activit', 'duti', 'provid', 'maintain',
  'prepar', 'assist', 'record', 'information', 'inform', 'ensure', 'need', 'requir', 'determin', 'specif', 'includ',
  'procedur', 'standard', 'appropri', 'such', 'necessari', 'variou', 'operat', 'equip', 'system', 'servic', 'manag',
  'report', 'review', 'staff', 'employe', 'personnel', 'worker', 'new', 'polici', 'issu', 'problem', 'process',
  'make', 'take', 'keep', 'help', 'support', 'team', 'customer', 'custom', 'task', 'job', 'year', 'day', 'daili', 'week',
  'month', 'time', 'area', 'level', 'high', 'per', 'over', 'plus', 'lead', 'led', 'train', 'trained', 'resolv', 'improv',
  'increas', 'reduc', 'develop', 'coordin', 'plan', 'organ', 'creat', 'handl', 'complet', 'respons', 'responsibl',
  'project', 'program', 'product', 'quality', 'qualiti', 'client', 'compan', 'compani', 'busi', 'business', 'sale',
  'order', 'schedul', 'document', 'data', 'communic', 'meet', 'contact', 'direct', 'supervis', 'monitor', 'conduct',
  'identif', 'identifi', 'establish', 'implement', 'evalu', 'analyz', 'analysi', 'assess', 'test', 'instal', 'repair',
  'inspect', 'clean', 'store', 'deliv', 'deliver', 'ship', 'receiv', 'payment', 'money', 'cost', 'budget']);

/** @type {{ terms: Map<string, number>[], idf: Map<string, number> } | null} */
let TV = null;
function taskVocab() {
  if (TV) return TV;
  const { list } = occ();
  /** @type {Map<string, number>[]} */
  const terms = list.map((o) => {
    /** @type {Map<string, number>} */
    const m = new Map();
    for (const txt of [o.title, ...o.tasks]) for (const w of words(txt)) {
      if (w.length < 3 || isStopWord(w)) continue;
      const s = stem(w);
      if (s.length < 3 || TASK_STOP.has(s)) continue;
      m.set(s, (m.get(s) || 0) + 1);
    }
    return m;
  });
  /** @type {Map<string, number>} */
  const df = new Map();
  for (const m of terms) for (const k of m.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = list.length;
  TV = { terms, idf: new Map([...df].map(([k, v]) => [k, Math.log(N / v)])) };
  return TV;
}

/** @param {string[]} lines */
function lineStems(lines) {
  const s = new Set();
  for (const l of lines || []) for (const w of words(l)) {
    if (w.length < 3 || isStopWord(w)) continue;
    const k = stem(w);
    if (k.length >= 3 && !TASK_STOP.has(k)) s.add(k);
  }
  return s;
}

const SPECIFIC_IDF = Math.log(1016 / 40); // a stem in at most ~40 occupations' task text

/**
 * How much the person's own lines resemble an occupation's task statements.
 * @param {Set<string>} ps @param {number} i
 * @returns {{ score: number, shared: string[] }}
 */
function taskOverlap(ps, i) {
  const { terms, idf } = taskVocab();
  const t = terms[i];
  let score = 0;
  /** @type {string[]} */
  const shared = [];
  for (const s of ps) {
    if (!t.has(s)) continue;
    const w = idf.get(s) || 0;
    if (w < SPECIFIC_IDF) continue;
    score += w;
    shared.push(s);
  }
  return { score, shared };
}

/**
 * Rank every occupation by the lines' overlap with its tasks.
 * @param {string[]} lines @param {number[]} [among]
 */
function rankByLines(lines, among) {
  const ps = lineStems(lines);
  const pool = among || occ().list.map((_, i) => i);
  return pool.map((i) => ({ i, ...taskOverlap(ps, i) })).sort((a, b) => b.score - a.score || a.i - b.i);
}

// ---------------------------------------------------------------- employer jargon O*NET cannot know
// Titles an employer invented. Each is matched only on its own words; `employers` raises it from a guess.
const JARGON = [
  { re: /^process assistant( pa)?$/, employers: /amazon|fulfil+ment|warehouse|distribution/i, code: '53-1042.00', note: 'Amazon\'s fulfillment-centre shift lead' },
  { re: /^(learning ambassador|safety ambassador)$/, employers: /amazon/i, code: '13-1151.00', note: 'Amazon\'s floor trainer' },
  { re: /^(fulfil+ment center associate|fc associate|tier 1 associate|tier one associate)$/, employers: /amazon/i, code: '53-7065.00', note: 'Amazon warehouse associate' },
  { re: /^(customer host|people greeter)$/, employers: /walmart|sam/i, code: '41-2031.00', note: 'Walmart front-door associate' },
  { re: /^(guest advocate|gsa)$/, employers: /target/i, code: '41-2011.00', note: 'Target cashier' },
  { re: /^(sandwich artist)$/, employers: /subway/i, code: '35-3023.00', note: 'Subway crew' },
  { re: /^(genius|apple genius)$/, employers: /apple/i, code: '49-2011.00', note: 'Apple in-store device repair' },
  { re: /^(partner|barista partner)$/, employers: /starbucks/i, code: '35-3023.01', note: 'Starbucks barista' },
];

// ---------------------------------------------------------------- military
// Rows: [service, MOC code, MOC title, personnel category (E/O/W), active(1/0), occIndex…]
/** @type {{ m: any[], byCode: Map<string, any[]>, byTitle: Map<string, any[]>, idf: Map<string, number> } | null} */
let MIL = null;
function military() {
  if (MIL) return MIL;
  const d = load('military.json');
  /** @type {Map<string, any[]>} */
  const byCode = new Map();
  /** @type {Map<string, any[]>} */
  const byTitle = new Map();
  for (const r of d.m) {
    const c = String(r[1]).toUpperCase();
    if (!byCode.has(c)) byCode.set(c, []);
    byCode.get(c)?.push(r);
    const k = normTitle(String(r[2]).replace(/\([^)]*\)/g, ' '));
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k)?.push(r);
  }
  /** @type {Map<string, number>} */
  const df = new Map();
  for (const k of byTitle.keys()) for (const w of new Set(k.split(' ').map(stem))) df.set(w, (df.get(w) || 0) + 1);
  const n = byTitle.size;
  MIL = { m: d.m, byCode, byTitle, idf: new Map([...df].map(([w, v]) => [w, Math.log(1 + n / v)])) };
  return MIL;
}

const BRANCH = [
  { svc: 'A', re: /\b(u\.?s\.? army|army|soldier|national guard|arng|usar)\b/i },
  { svc: 'M', re: /\b(usmc|marine corps|u\.?s\.? marines?|marines?)\b/i },
  { svc: 'N', re: /\b(u\.?s\.? navy|usn|navy|naval|sailor)\b/i },
  { svc: 'F', re: /\b(usaf|air force|airman|air national guard|ang)\b/i },
  { svc: 'C', re: /\b(uscg|coast guard)\b/i },
];
const ENLISTED_RE = /\b(staff sergeant|sergeant first class|master sergeant|first sergeant|sergeant major|gunnery sergeant|sergeant|sgt|ssg|sfc|msg|spc|cpl|corporal|lance corporal|private first class|private|pfc|petty officer(?: (?:first|second|third) class)?|po[123]|chief petty officer|cpo|airman first class|senior airman|airman|seaman|specialist e-?\d|e-?\d|nco|noncommissioned officer)\b/gi;
const OFFICER_RE = /\b(second lieutenant|first lieutenant|lieutenant commander|lieutenant colonel|lieutenant|captain|major|colonel|ensign|commander|o-?\d)\b/gi;
const WARRANT_RE = /\b(chief warrant officer|warrant officer|cw[2-5]|wo1)\b/gi;
const MIL_WORD_RE = /\b(mos|afsc|rating|nec|military|army|navy|usmc|marine corps|air force|coast guard|usaf|usn|uscg|national guard|corpsman|infantry|infantryman|rifleman|squad leader|platoon|battalion|deployed|deployment|sergeant|petty officer|airman|soldier|veteran)\b/i;

/**
 * Is this résumé role military? (a branch, a rank, or an MOS-shaped code next to a title)
 * @param {string} text
 */
export function looksMilitary(text) {
  const s = String(text || '');
  return MIL_WORD_RE.test(s) || /(^|[\s(])\d{2}[A-Z]\d?(\)|\s|$)/.test(s) || /\b\d[A-Z]\d[X\d]\d\b/.test(s);
}

/**
 * Civilian occupations for a military role: an MOS / rating / AFSC code ("88M", "92Y", "HM", "2T1X1",
 * USMC "3531") or a military title ("Hospital Corpsman", "Motor Transport Operator") found in the text.
 * Codes are read only where the text reads as military (a branch, a rank, a code in parentheses or
 * leading the title) — "0311" alone in a date range is not a Marine rifleman. A rank word picks the
 * personnel category (a sergeant is enlisted, so not the Air Force supply OFFICER code).
 * @param {string} text
 * @returns {{ service: string, moc: string, mocTitle: string, occupations: OccRef[], via: 'code'|'title', confidence: 'exact'|'close'|'guess' } | null}
 */
export function militaryOccupation(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  const M = military();
  const branch = BRANCH.find((b) => b.re.test(s))?.svc || null;
  const cat = WARRANT_RE.test(s) ? 'W' : ENLISTED_RE.test(s) ? 'E' : OFFICER_RE.test(s) ? 'O' : null;
  ENLISTED_RE.lastIndex = 0; OFFICER_RE.lastIndex = 0; WARRANT_RE.lastIndex = 0;
  const isMil = looksMilitary(s) || !!branch;
  /** @param {any[]} rows @param {string} via @param {'exact'|'close'|'guess'} conf */
  const pick = (rows, via, conf) => {
    const order = (/** @type {any[]} */ r) => (branch && r[0] !== branch ? 8 : 0) + (cat && r[3] !== cat ? 4 : 0) + (r[4] ? 0 : 2) + (['A', 'M', 'N', 'F', 'C'].includes(r[0]) ? 0 : 1);
    const r = [...rows].sort((a, b) => order(a) - order(b) || String(a[1]).localeCompare(String(b[1])))[0];
    if (!r) return null;
    return { service: r[0], moc: String(r[1]), mocTitle: r[2], occupations: r.slice(5).map((/** @type {number} */ i) => ref(i)), via, confidence: conf };
  };
  // 1. codes
  /** @type {string[]} */
  const codes = [];
  for (const m of s.matchAll(/(?:^|[\s(,/])(\d{2}[A-Z]\d?|\d[A-Z]\d[X\d]\d[A-Z]?|[A-Z]{2,3})(?=[\s),/.:]|$)/g)) codes.push(m[1]);
  if (isMil) for (const m of s.matchAll(/(?:^|[\s(,/])(\d{4})(?=[\s),/.:]|$)/g)) if (!/^(19|20)\d\d$/.test(m[1]) || /\bmos\b|usmc|marine/i.test(s)) codes.push(m[1]);
  for (const c of codes) {
    if (/^[A-Z]{2,3}$/.test(c) && !(branch === 'N' || branch === 'C' || /\brating\b/i.test(s))) continue; // "IT", "HR" are not Navy ratings by themselves
    const rows = (M.byCode.get(c) || []).filter((r) => (/^\d{4}$/.test(c) ? r[0] === 'M' || branch === r[0] : true));
    if (!rows.length) continue;
    if (!isMil && !/^\d{2}[A-Z]\d?$/.test(c)) continue;
    const res = pick(rows, 'code', 'exact');
    if (res) return res;
  }
  // 2. titles (rank words and branch names removed)
  const cleaned = normTitle(s.replace(WARRANT_RE, ' ').replace(ENLISTED_RE, ' ').replace(OFFICER_RE, ' ').replace(/\([^)]*\)/g, ' ')
    .replace(/\b(u\.?s\.?|united states|army|navy|usmc|marine corps|marines|air force|usaf|usn|uscg|coast guard|national guard|military)\b/gi, ' '));
  if (cleaned) {
    const exact = M.byTitle.get(cleaned);
    if (exact && (!cat || exact.some((r) => r[3] === cat))) return pick(exact, 'title', 'exact');
  }
  if (!isMil || !cleaned) return null;
  const q = [...new Set(cleaned.split(' ').filter((w) => !isStopWord(w)).map(stem))];
  if (!q.length) return null;
  const w = (/** @type {string} */ x) => M.idf.get(x) || 1;
  /** @type {{ rows: any[], score: number } | null} */
  let best = null;
  for (const [k, rows] of M.byTitle) {
    if (cat && !rows.some((r) => r[3] === cat)) continue;
    const e = [...new Set(k.split(' ').filter((x) => !isStopWord(x)).map(stem))];
    if (!q.every((x) => e.includes(x))) continue;          // every word the person wrote must be in the title
    const qm = q.reduce((a, x) => a + w(x), 0);
    const em = e.reduce((a, x) => a + w(x), 0);
    const score = (2 * qm) / (qm + em) + (rows.some((r) => r[4]) ? 0.01 : 0) + (branch && rows.some((r) => r[0] === branch) ? 0.02 : 0);
    if (!best || score > best.score + 1e-9) best = { rows, score };
  }
  return best && best.score >= 0.35 ? pick(best.rows, 'title', best.score >= 0.75 ? 'close' : 'guess') : null;
}

// ---------------------------------------------------------------- levels
const LEVEL_RANK = { apprentice: 0, trainee: 0, intern: 0, assistant: 1, junior: 1.5, associate: 2, none: 3, senior: 4, lead: 5, supervisor: 6, manager: 7, director: 8, executive: 9 };

/**
 * The seniority a title states, by rule from its own words (no ladder list). The marker is the strongest
 * level word; the rank orders titles within one line of work ("Plumbing Apprentice" 0 < "Journeyman Plumber"
 * 3 < "Master Plumber" 4; "Assistant Branch Manager" 6.5 < "Branch Manager" 7).
 * A role noun that is itself the job ("Medical Assistant", "Sales Associate") is the job, not a level.
 * @param {string} title
 * @returns {{ marker: 'apprentice'|'trainee'|'intern'|'assistant'|'junior'|'associate'|null|'senior'|'lead'|'supervisor'|'manager'|'director'|'executive', rank: number }}
 */
export function levelOf(title) {
  const raw = String(title || '').replace(/\([^)]*\)/g, ' ');
  const t = normTitle(raw.split(/\s+[-–—|]\s+/)[0]).split(' ').filter(Boolean);
  const has = (/** @type {string} */ w) => t.includes(w);
  const phrase = (/** @type {RegExp} */ re) => re.test(t.join(' '));
  /** @type {any} */
  let marker = null;
  let rank = LEVEL_RANK.none;
  const set = (/** @type {string|null} */ m, /** @type {number} */ r = LEVEL_RANK[m ?? 'none']) => { marker = m; rank = r; };
  // "principal" is a level in front of a role noun ("Principal Engineer"); otherwise it is the school's head.
  const pi = t.indexOf('principal');
  const principalLevel = pi >= 0 && /^(engineer|scientist|consultant|analyst|architect|designer|developer|researcher|software|data|product|program|investigator|accountant|auditor|associate|solutions|systems|security|machine|research|technical|ux|user|clinical|statistician|economist|attorney|counsel)$/.test(t[pi + 1] || '');
  const last = t[t.length - 1] || '';
  if (phrase(/\bchief\b.*\bofficer\b|\b(president|ceo|cfo|coo|cto|owner|founder|cofounder|partner|principal owner)\b/) && !phrase(/\b(sales|business|loan|insurance|retail|store|team|crew) (associate|partner)\b/)) set('executive');
  else if (phrase(/\bvice president\b/)) set('executive', 8.5);
  else if (phrase(/\b(director|head of|dean|superintendent of schools)\b/) || (pi >= 0 && !principalLevel)) set('director');
  else if (phrase(/\b(manager|management|superintendent|administrator of|commander|officer in charge)\b/) && !phrase(/\b(account|case|property|program|project|product|social media|community|content)\s+manager\b/) ) set('manager');
  else if (phrase(/\b(account|case|property|program|project|product|social media|community|content)\s+manager\b/)) set('manager', 6);
  else if (phrase(/\b(supervisor|foreman|forewoman|forelady|chief|crew chief|sergeant|petty officer|charge nurse|head)\b/)) set('supervisor');
  else if (phrase(/\b(lead|leader|team lead|shift lead|keyholder|key holder)\b/) && !phrase(/\blead (generation|paint|abatement)\b/)) set('lead');
  else if ((phrase(/\b(senior|master|staff engineer|staff scientist|expert|specialist iii|iii|iv)\b/) || principalLevel) && !phrase(/\bsenior (care|living|center)\b/)) set('senior', principalLevel ? 4.5 : LEVEL_RANK.senior);
  else if (phrase(/\b(apprentice|apprenticeship|helper)\b/)) set('apprentice');
  else if (phrase(/\b(trainee|in training|cadet)\b/)) set('trainee');
  else if (phrase(/\b(intern|internship|co op|coop|extern|student)\b/)) set('intern');
  else if (phrase(/\b(junior|entry level|entry|i)\b/) && !phrase(/\bi\b.*\bii\b/)) set('junior');
  else if (last === 'assistant' || last === 'aide' || phrase(/\b(assistant|aide)\b/)) set('assistant');
  else if (last === 'associate' && t.length > 1) set(null);  // "Sales Associate": the job
  else if (has('associate')) set('associate');
  // A lowering modifier in front of a management word: assistant / associate / deputy / sub.
  if (['manager', 'director', 'supervisor', 'executive'].includes(marker || '') || (marker === null && rank === LEVEL_RANK.none)) {
    if (phrase(/\b(assistant|asst|associate|deputy|sub|vice|under)\s+(\w+\s+){0,2}(manager|director|principal|superintendent|supervisor|store manager|general manager|controller|chief)\b/) && !phrase(/\bvice president\b/)) {
      if (marker === null) set('assistant', LEVEL_RANK.assistant);
      else { rank -= 0.5; marker = phrase(/\bassociate\b/) ? marker : 'assistant'; }
    }
    if (phrase(/\b(general|regional|district|area|senior|group|national)\s+(\w+\s+)?(manager|director)\b/)) rank += 0.5;
  }
  if (marker === null && rank === LEVEL_RANK.none) {
    if (phrase(/\b(journeyman|journeyperson|journey worker|journey level)\b/)) rank = LEVEL_RANK.none;
    const num = t.find((w) => /^(ii|iii|iv|2|3|4)$/.test(w));
    if (num) rank += ({ ii: 0.3, 2: 0.3, iii: 0.6, 3: 0.6, iv: 0.9, 4: 0.9 })[num] || 0;
  }
  return { marker, rank };
}

// ---------------------------------------------------------------- occupationOf
/**
 * @param {number[][]} hits [[occIndex, weight], …]
 * @param {string[] | undefined} lines
 * @param {'exact'|'close'|'guess'} confidence
 * @param {string} via
 * @param {string} matched
 * @returns {OccupationMatch}
 */
function result(hits, lines, confidence, via, matched) {
  let ranked = hits.map(([i, w]) => ({ i, w, s: 0 }));
  if (lines && lines.length && ranked.length > 1) {
    const ps = lineStems(lines);
    for (const r of ranked) r.s = taskOverlap(ps, r.i).score;
    const top = Math.max(...ranked.map((r) => r.s));
    ranked = ranked.map((r) => ({ ...r, w: r.w + (top > 0 ? (4 * r.s) / top : 0) }));
  }
  // "All Other" catch-alls and occupations with no task data rank below a named occupation.
  for (const r of ranked) {
    const o = occ().list[r.i];
    if (/All Other/.test(o.title)) r.w -= 1.5;
    if (!o.tasks.length) r.w -= 0.5;
  }
  // Near-ties go to the occupation needing less preparation (more people hold it): "host" is the restaurant one.
  const zoneOf = (/** @type {number} */ i) => occ().list[i].zone || 3;
  ranked.sort((a, b) => (Math.abs(b.w - a.w) > 0.5 ? b.w - a.w : zoneOf(a.i) - zoneOf(b.i) || b.w - a.w || a.i - b.i));
  const top = ranked[0];
  const o = occ().list[top.i];
  const alternatives = ranked.slice(1).filter((r) => r.w >= top.w - 1.01).slice(0, 3).map((r) => ref(r.i));
  // Two or more occupations claim the title equally and nothing (lines) broke the tie: say so.
  const tied = ranked.length > 1 && ranked[1].w >= top.w - 0.01;
  const conf = tied && confidence === 'exact' ? 'close' : confidence;
  return { code: o.code, title: o.title, confidence: conf, group: groupOf(o.code), zone: o.zone, alternatives, via, matched, ambiguous: tied };
}

/**
 * The O*NET occupation a job title names.
 *  exact — the title (or the title without level words) is an O*NET title for it;
 *  close — same head word and the modifiers mostly agree, or a military code/title;
 *  guess — weaker title evidence, employer jargon without the employer, or the person's own lines alone.
 * Returns null rather than a wild guess.
 * @param {string} title
 * @param {{ lines?: string[], employer?: string }} [opts]
 * @returns {OccupationMatch | null}
 */
export function occupationOf(title, opts = {}) {
  const lines = (opts.lines || []).filter(Boolean);
  const raw = String(title || '').trim();
  if (raw) {
    // 1. military roles
    if (looksMilitary(raw)) {
      const m = militaryOccupation(raw);
      if (m && m.occupations.length) {
        const hits = m.occupations.map((o, k) => [occ().byCode.get(o.code) ?? 0, 7 - k]);
        return { ...result(hits, lines, m.confidence === 'exact' ? 'exact' : 'close', `military:${m.service}:${m.moc}`, m.mocTitle) };
      }
    }
    const { keys, full, partial } = titleVariants(raw);
    // 2. employer jargon (the whole title, level words aside)
    for (const k of full.slice(0, 2)) {
      const j = JARGON.find((x) => x.re.test(stripLevel(k)));
      if (j && occ().byCode.has(j.code)) {
        const sure = (opts.employer && j.employers.test(opts.employer)) || lines.some((l) => j.employers.test(l));
        return result([[occ().byCode.get(j.code) || 0, 7]], lines, sure ? 'close' : 'guess', 'jargon', j.note);
      }
    }
    // 3. exact title → without level words → same head, closest modifiers; the full reading first, then partial ones
    /** @type {{ hits: number[][], score: number, matched: string, key: string } | null} */
    let best = null;
    for (const [tier, tierKeys] of /** @type {Array<[string, string[]]>} */ ([['full', full], ['partial', partial]])) {
      for (const k of tierKeys) { const h = voteKey(k); if (h) return result(h, lines, 'exact', tier === 'full' ? 'title' : 'title-part', k); }
      for (const k of tierKeys) { const s = stripLevel(k); if (s !== k) { const h = voteKey(s); if (h) return result(h, lines, 'exact', tier === 'full' ? 'title-level' : 'title-part-level', s); } }
      for (const k of tierKeys.slice(0, 6)) {
        for (const cand of [k, stripLevel(k)]) {
          let toks = cand.split(' ');
          // a generic head ("intern", "member") says nothing: try the field words as a worker, then alone
          if (toks.length > 1 && GENERIC_HEADS.has(toks[toks.length - 1]) && !exactKey(toks.join(' '))) {
            while (toks.length > 1 && GENERIC_HEADS.has(toks[toks.length - 1])) toks = toks.slice(0, -1);
            const asWorker = `${toks.join(' ')} worker`;
            const hw = !GENERIC_HEADS.has(toks[toks.length - 1]) && voteKey(asWorker);
            if (hw) return result(hw, lines, 'close', 'title-generic', asWorker);
            continue;   // "operations" left after dropping "lead" is not a job title: no fuzzy match on it
          }
          const f = fuzzyKey(toks.join(' '));
          if (f && (!best || f.score > best.score)) best = { ...f, key: cand };
        }
      }
      if (best && best.score >= 0.8) return result(best.hits, lines, 'close', 'title-fuzzy', best.matched);
    }
    // 5. the person's own lines decide among weak title candidates, or alone
    if (lines.length) {
      const ranked = rankByLines(lines);
      const [a, b] = ranked;
      const titleTok = new Set(keys.flatMap((k) => k.split(' ')).map(stem));
      const agreesWithTitle = (/** @type {number} */ i) => words(occ().list[i].title).some((w) => titleTok.has(stem(w)));
      if (a && a.shared.length >= 3 && a.score >= 1.25 * (b?.score || 0)) return result([[a.i, 3]], lines, agreesWithTitle(a.i) ? 'close' : 'guess', 'lines', a.shared.join(' '));
      // a weak title match is kept only when the person's lines do that occupation's specific tasks
      if (best && best.score >= 0.5) {
        const backed = rankByLines(lines, best.hits.map((h) => h[0])).find((r) => r.shared.length >= 2);
        if (backed) return result([[backed.i, 3]], lines, 'guess', 'title-fuzzy+lines', best.matched);
      }
    }
    // A weak title match alone was wrong 9 times in 14 on real postings: say nothing rather than guess.
    return null;
  }
  if (lines.length) {
    const [a, b] = rankByLines(lines);
    if (a && a.shared.length >= 4 && a.score >= 1.3 * (b?.score || 0)) return result([[a.i, 3]], lines, 'guess', 'lines', a.shared.join(' '));
  }
  return null;
}

// ---------------------------------------------------------------- relation
const CODE_RE = /^\d\d-\d{4}\.\d\d$/;
const GENERIC_TITLE_WORDS = new Set(['and', 'except', 'all', 'other', 'including', 'workers', 'worker', 'operators', 'operator', 'helpers', 'helper', 'general', 'specialists', 'specialist', 'technicians', 'technician', 'assistants', 'aides', 'clerks', 'machine', 'tenders', 'setters', 'occupations']);

/** @param {Occ} o */
const isSupervisorOcc = (o) => /^First-Line Supervisors\b|^Chefs and Head Cooks|^Supervisors? of\b/.test(o.title) || (Number(o.code.slice(0, 2)) >= 31 && o.code[3] === '1');
/** @param {Occ} o */
const isAssistingOcc = (o) => /^Helpers--|\bHelpers\b|\bAides?\b|\bAssistants\b|\bTechnicians\b/.test(o.title) && !/Technologists/.test(o.title);
/** @param {string} t */
const titleStems = (t) => new Set(words(t.replace(/^Helpers--/, '')).filter((w) => !GENERIC_TITLE_WORDS.has(w) && !isStopWord(w)).map(stem));
/** @param {Occ} o */
const firstWordStem = (o) => stem(words(o.title.replace(/^Helpers--/, ''))[0] || '');

const STRENGTH = { same: 3, ladder: 2, related: 1, different: 0 };

/**
 * @param {Occ} oa @param {Occ} ob
 * @param {{ rank: number } | null} la @param {{ rank: number } | null} lb
 * @param {string[] | undefined} lines
 * @returns {{ relation: 'same'|'ladder'|'related'|'different', direction?: 'up'|'down', why: string }}
 */
function relateOcc(oa, ob, la, lb, lines) {
  const dir = (/** @type {number} */ d) => (d > 0 ? 'up' : 'down');
  const levelGap = la && lb ? lb.rank - la.rank : 0;
  if (oa.code.slice(0, 7) === ob.code.slice(0, 7)) {
    if (Math.abs(levelGap) >= 0.5) return { relation: 'ladder', direction: dir(levelGap), why: `both are ${ob.title}; the titles state different levels` };
    return { relation: 'same', why: oa.code === ob.code ? `both are ${oa.title}` : `${oa.title} and ${ob.title} are one occupation` };
  }
  const sameMajor = oa.code.slice(0, 2) === ob.code.slice(0, 2);
  const find = (/** @type {Occ} */ x, /** @type {Occ} */ y) => x.related.find(([i]) => occ().list[i].code === y.code);
  const rel = find(oa, ob) || find(ob, oa);
  const shareName = [...titleStems(oa.title)].some((s) => titleStems(ob.title).has(s));
  // a supervisor of the same line of work
  const supA = isSupervisorOcc(oa);
  const supB = isSupervisorOcc(ob);
  if (supA !== supB && sameMajor && (rel || shareName || oa.code.slice(0, 4).slice(3) === '1' || ob.code.slice(3, 4) === '1')) {
    const [hi, lo] = supB ? [ob, oa] : [oa, ob];
    return { relation: 'ladder', direction: supB ? 'up' : 'down', why: `${hi.title} supervises work like ${lo.title}` };
  }
  // a manager over related work at a higher preparation level
  if (rel && rel[1] <= 2 && oa.code.startsWith('11-') !== ob.code.startsWith('11-')) {
    const mgrB = ob.code.startsWith('11-');
    const [hi, lo] = mgrB ? [ob, oa] : [oa, ob];
    if (hi.zone >= lo.zone) return { relation: 'ladder', direction: mgrB ? 'up' : 'down', why: `${hi.title} manages work like ${lo.title}` };
  }
  // the helper / aide / assistant / technician role of a named trade or practice
  const asA = isAssistingOcc(oa);
  const asB = isAssistingOcc(ob);
  if (asA !== asB) {
    const [as, main] = asA ? [oa, ob] : [ob, oa];
    const named = /^Helpers--/.test(as.title) ? shareName : firstWordStem(as) === firstWordStem(main) && shareName;
    if (named && (rel || sameMajor || as.code.startsWith('31-'))) {
      return { relation: 'ladder', direction: asA ? 'up' : 'down', why: `${as.title} assist in ${main.title} work` };
    }
  }
  if (oa.code.slice(0, 6) === ob.code.slice(0, 6) && oa.zone && ob.zone && oa.zone !== ob.zone) {
    return { relation: 'ladder', direction: dir(ob.zone - oa.zone), why: `one occupation group; ${ob.zone > oa.zone ? ob.title : oa.title} needs more preparation` };
  }
  if (rel) return { relation: 'related', why: `O*NET lists ${ob.title} as related to ${oa.title}` };
  if (oa.code.slice(0, 6) === ob.code.slice(0, 6)) return { relation: 'related', why: `${oa.title} and ${ob.title} are one occupation group` };
  if (oa.code.slice(0, 4) === ob.code.slice(0, 4) && Math.abs((oa.zone || 0) - (ob.zone || 0)) <= 1) {
    return { relation: 'related', why: `same field (${MAJOR[Number(oa.code.slice(0, 2))] || oa.code.slice(0, 2)}) at a similar preparation level` };
  }
  // the person's own lines already do B's specific tasks (a side-step: chef with HACCP → food safety technician)
  if (lines && lines.length) {
    const { score, shared } = taskOverlap(lineStems(lines), occ().byCode.get(ob.code) ?? -1);
    if (shared.length >= 3 && score >= 3 * SPECIFIC_IDF) return { relation: 'related', why: `the person's own lines already do ${ob.title} work (${shared.slice(0, 4).join(', ')})` };
  }
  return { relation: 'different', why: `${oa.title} and ${ob.title} are different lines of work` };
}

/**
 * How two occupations (codes) or two titles relate. With titles, every occupation the title can
 * equally name is tried and the closest relation wins ("Lab Technician" may be the medical one).
 *  same      — one occupation (same O*NET-SOC detailed code) at the same stated level
 *  ladder    — one line of work at a different level: the same occupation with a different stated level,
 *              a supervisor / manager / helper / assistant occupation of the other, or the same broad
 *              group at a different job zone. `direction` is 'up' when B is the higher rung.
 *  related   — O*NET lists them as related, or the same broad group, or the same minor group within one
 *              job zone — or (with `lines`, the person's own résumé lines) those lines already do B's
 *              specific tasks.
 *  different — none of the above (or a side could not be placed: `why` says which).
 * @param {string} a code or title (the person's)
 * @param {string} b code or title (the target)
 * @param {{ lines?: string[] }} [opts]
 * @returns {{ relation: 'same'|'ladder'|'related'|'different', direction?: 'up'|'down', why: string, a: OccRef|null, b: OccRef|null }}
 */
export function relation(a, b, opts = {}) {
  const resolve = (/** @type {string} */ x, /** @type {string[]|undefined} */ lines) => {
    const s = String(x || '').trim();
    if (CODE_RE.test(s)) { const o = occupation(s); return { cands: o ? [o] : [], lvl: null }; }
    const m = occupationOf(s, { lines });
    if (!m) return { cands: [], lvl: levelOf(s) };
    const cands = [m.code, ...(m.ambiguous ? m.alternatives.map((r) => r.code) : [])].map((c) => occupation(c)).filter((o) => !!o);
    return { cands: /** @type {Occ[]} */ (cands), lvl: levelOf(s) };
  };
  const A = resolve(a, opts.lines);
  const B = resolve(b, undefined);
  if (!A.cands.length || !B.cands.length) {
    return { relation: 'different', why: `could not place ${!A.cands.length ? `"${a}"` : `"${b}"`} in an occupation`, a: A.cands[0] ? ref(occ().byCode.get(A.cands[0].code) ?? 0) : null, b: B.cands[0] ? ref(occ().byCode.get(B.cands[0].code) ?? 0) : null };
  }
  /** @type {any} */
  let best = null;
  for (const oa of A.cands) for (const ob of B.cands) {
    const r = relateOcc(oa, ob, A.lvl, B.lvl, opts.lines);
    if (!best || STRENGTH[r.relation] > STRENGTH[best.relation]) best = { ...r, a: { code: oa.code, title: oa.title }, b: { code: ob.code, title: ob.title } };
  }
  // A side-step the person's own lines already name: the target title's field words are in their lines
  // ("Food Safety & QA Technician" for a chef whose lines say "food safety audits").
  if (best.relation === 'different' && opts.lines && opts.lines.length && !CODE_RE.test(String(b))) {
    const field = [...new Set(normTitle(String(b).replace(/\([^)]*\)/g, ' ')).split(' ')
      .filter((w) => w.length > 2 && !isStopWord(w) && !ROLE_NOUNS.has(w)).map(stem))];
    const ps = new Set((opts.lines || []).flatMap((l) => words(l)).map(stem));
    const hit = field.filter((w) => ps.has(w));
    if (field.length && hit.length >= 2 && hit.length * 2 >= field.length) {
      return { ...best, relation: 'related', why: `the person's own lines already name this field (${hit.join(', ')})` };
    }
  }
  return best;
}
const ROLE_NOUNS = new Set(['technician', 'technologist', 'specialist', 'assistant', 'associate', 'worker', 'manager', 'analyst',
  'coordinator', 'representative', 'officer', 'clerk', 'agent', 'lead', 'supervisor', 'director', 'senior', 'junior', 'staff',
  'intern', 'trainee', 'apprentice', 'helper', 'aide', 'operator', 'engineer', 'administrator', 'consultant', 'advisor',
  'member', 'team', 'professional', 'expert', 'head', 'chief', 'principal', 'level', 'entry']);

// ---------------------------------------------------------------- tasks
/** @param {string} code @returns {string[]} */
export function tasksOf(code) { return occupation(code)?.tasks.slice() || []; }
/** @param {string} code @returns {string[]} */
export function toolsOf(code) { return occupation(code)?.tools.slice() || []; }

/**
 * The tasks of the person's own occupation — what their title implies they did, for a judge that wants
 * less lexical evidence for a core duty of the person's occupation. Empty when the title is unknown or
 * only guessed.
 * @param {string} title
 * @param {string[]} [lines]
 * @returns {{ code: string, title: string, confidence: string, tasks: string[] } | null}
 */
export function impliedDuties(title, lines) {
  const m = occupationOf(title, { lines });
  if (!m || m.confidence === 'guess') return null;
  return { code: m.code, title: m.title, confidence: m.confidence, tasks: tasksOf(m.code) };
}

/** Internal hooks for tests and measurement scripts. */
export const _internal = { exactKey, fuzzyKey, rankByLines, taskOverlap, lineStems, titles, occ, military };
