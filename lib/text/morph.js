// Word morphology by rule — no word list shipped for it. Two jobs:
//
//   stem(word)              → the Porter (1980) stem, for matching titles and task statements
//                             ("engineering", "engineer", "engineers" → "engin"; "nursing" → "nurs").
//                             Stems are for COMPARING words, never for printing.
//   lemmaCandidates(word)   → the dictionary forms a word could be an inflection or derivation of,
//                             most likely first ("presented" → present; "presentation" → present;
//                             "educating" → educate; "supplies" → supply; "led" → lead). The caller
//                             keeps the first candidate its lexicon knows (lib/text/synonyms.js).
//
// The irregular verbs below are grammar, not vocabulary: the ~70 English verbs whose past form is
// not built by a rule and that turn up in résumé lines.

const IRREGULAR = {
  led: 'lead', built: 'build', taught: 'teach', wrote: 'write', written: 'write', ran: 'run', made: 'make',
  drove: 'drive', driven: 'drive', kept: 'keep', sold: 'sell', brought: 'bring', bought: 'buy', met: 'meet',
  held: 'hold', grew: 'grow', grown: 'grow', gave: 'give', given: 'give', took: 'take', taken: 'take',
  found: 'find', began: 'begin', begun: 'begin', chose: 'choose', chosen: 'choose', spent: 'spend',
  sent: 'send', oversaw: 'oversee', overseen: 'oversee', understood: 'understand', won: 'win', paid: 'pay',
  told: 'tell', felt: 'feel', spoke: 'speak', spoken: 'speak', rode: 'ride', thought: 'think', caught: 'catch',
  fought: 'fight', sought: 'seek', dealt: 'deal', meant: 'mean', left: 'leave', lost: 'lose', stood: 'stand',
  wore: 'wear', worn: 'wear', drew: 'draw', drawn: 'draw', knew: 'know', known: 'know', saw: 'see', seen: 'see',
  went: 'go', gone: 'go', did: 'do', done: 'do', got: 'get', gotten: 'get', said: 'say', laid: 'lay', lent: 'lend',
  bent: 'bend', fed: 'feed', fled: 'flee', hung: 'hang', hid: 'hide', hidden: 'hide', rose: 'rise', risen: 'rise',
  shot: 'shoot', shook: 'shake', slid: 'slide', split: 'split', spun: 'spin', struck: 'strike', swept: 'sweep',
  swam: 'swim', threw: 'throw', thrown: 'throw', undertook: 'undertake', withdrew: 'withdraw', broke: 'break',
  broken: 'break', froze: 'freeze', frozen: 'freeze', forgave: 'forgive', became: 'become', ate: 'eat',
  eaten: 'eat', flew: 'fly', flown: 'fly', fell: 'fall', fallen: 'fall', woke: 'wake', redid: 'redo',
  rebuilt: 'rebuild', rewrote: 'rewrite', rewritten: 'rewrite',
  people: 'person', children: 'child', men: 'man', women: 'woman', teeth: 'tooth', feet: 'foot', analyses: 'analysis',
  criteria: 'criterion', data: 'data', media: 'media', staff: 'staff',
};

const VOWEL = /[aeiouy]/;

/** @param {string} w */
function undouble(w) {
  // planned → plan, shipped → ship (but not "staff", "mill", "pass", "buzz").
  const m = w.match(/([b-df-hj-np-tv-z])\1$/);
  if (m && !/(ll|ss|ff|zz)$/.test(w)) return w.slice(0, -1);
  return null;
}

/** @param {string} word */
function clean(word) { return String(word || '').toLowerCase().replace(/[^a-z'-]/g, '').replace(/'s$/, ''); }

/**
 * Forms a word could be an INFLECTION of (plural, past, -ing, irregular past), the word itself first.
 * @param {string} word
 * @returns {string[]}
 */
export function inflectionCandidates(word) {
  const w = clean(word);
  if (!w) return [];
  /** @type {string[]} */
  const out = [w];
  const add = (/** @type {string|null|undefined} */ x) => { if (x && x.length >= 2 && !out.includes(x)) out.push(x); };
  if (Object.hasOwn(IRREGULAR, w)) add(IRREGULAR[w]);
  if (/ies$/.test(w) && w.length > 4) add(w.slice(0, -3) + 'y');
  if (/(ches|shes|sses|xes|zes)$/.test(w)) add(w.slice(0, -2));
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) add(w.slice(0, -1));
  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ed$/.test(w) && w.length > 4) {
    const b = w.slice(0, -2);
    add(undouble(b)); add(b + 'e'); add(b); add(w.slice(0, -1));
  }
  if (/ing$/.test(w) && w.length > 5) {
    const b = w.slice(0, -3);
    if (VOWEL.test(b)) { add(undouble(b)); add(b + 'e'); add(b); }
  }
  return out;
}

// Words whose suffix is not a derivation of the shorter word (department ≠ depart, station ≠ state).
const NOT_DERIVED = new Set(['department', 'apartment', 'compartment', 'station', 'nation', 'ration', 'vacation', 'mission',
  'question', 'position', 'session', 'fashion', 'cushion', 'onion', 'region', 'religion', 'opinion', 'union', 'million',
  'sentence', 'experience', 'science', 'audience', 'evidence', 'pension', 'tension', 'passion', 'mention']);

/**
 * Verbs a noun of action could name, by suffix rule (presentation → present; supervision → supervise;
 * management → manage; performance → perform). Agent nouns (-er/-or) and -al are left out on purpose:
 * counter ≠ count, number ≠ numb, signal ≠ sign. The caller keeps only candidates its lexicon lists as verbs.
 * @param {string} word
 * @returns {string[]}
 */
export function derivationCandidates(word) {
  const w = clean(word).replace(/s$/, '');
  if (!w || NOT_DERIVED.has(w)) return [];
  /** @type {string[]} */
  const out = [];
  const add = (/** @type {string} */ x) => { if (x.length >= 3 && x !== w && !out.includes(x)) out.push(x); };
  let m;
  if ((m = w.match(/^(.{3,})ication$/))) add(`${m[1]}y`);                         // verification → verify
  if ((m = w.match(/^(.{3,})ation$/))) { add(`${m[1]}ate`); add(m[1]); add(`${m[1]}e`); } // educate, present, organize
  else if ((m = w.match(/^(.{3,}[st])ion$/))) { if (!/ssion$/.test(w)) { add(m[1]); add(`${m[1]}e`); } else add(w.replace(/ssion$/, 't')); }
  if ((m = w.match(/^(.{4,})ment$/))) add(m[1]);                                    // management → manage
  if ((m = w.match(/^(.{4,})[ae]nce$/))) { add(m[1]); add(`${m[1]}e`); }           // performance → perform
  return out;
}

/**
 * Dictionary forms a word could come from, most likely first: inflections, then derivations.
 * @param {string} word
 * @returns {string[]}
 */
export function lemmaCandidates(word) {
  const out = inflectionCandidates(word);
  for (const d of derivationCandidates(word)) if (!out.includes(d)) out.push(d);
  return out;
}

// Porter (1980) stemmer, plus the irregular forms above. Stems are for comparing words, never for printing.
const STEP2 = { ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al', entli: 'ent',
  eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful',
  ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log' };
const STEP3 = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' };
const C = '[^aeiou]';
const V = '[aeiouy]';
const CS = `${C}[^aeiouy]*`;
const VS = `${V}[aeiou]*`;
const MGR0 = new RegExp(`^(${CS})?${VS}${CS}`);
const MEQ1 = new RegExp(`^(${CS})?${VS}${CS}(${VS})?$`);
const MGR1 = new RegExp(`^(${CS})?${VS}${CS}${VS}${CS}`);
const SV = new RegExp(`^(${CS})?${V}`);

/**
 * A stem for comparison only (Porter 1980): "engineering", "engineer" → "engin"; "operations", "operator" → "oper".
 * @param {string} word
 */
export function stem(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (Object.hasOwn(IRREGULAR, w)) w = IRREGULAR[w];
  if (w.length < 3 || /\d/.test(w)) return w;
  const firstY = w[0] === 'y';
  if (firstY) w = `Y${w.slice(1)}`;
  // 1a
  if (/sses$|ies$/.test(w)) w = w.slice(0, -2);
  else if (/[^s]s$/.test(w)) w = w.slice(0, -1);
  // 1b
  let m;
  if ((m = w.match(/^(.+?)eed$/))) { if (MGR0.test(m[1])) w = w.slice(0, -1); }
  else if ((m = w.match(/^(.+?)(ed|ing)$/)) && SV.test(m[1])) {
    w = m[1];
    if (/(at|bl|iz)$/.test(w)) w += 'e';
    else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
    else if (new RegExp(`^${CS}${V}[^aeiouwxy]$`).test(w)) w += 'e';
  }
  // 1c
  if ((m = w.match(/^(.+?)y$/)) && SV.test(m[1])) w = `${m[1]}i`;
  // 2
  if ((m = w.match(/^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/)) && MGR0.test(m[1])) w = m[1] + STEP2[m[2]];
  // 3
  if ((m = w.match(/^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/)) && MGR0.test(m[1])) w = m[1] + STEP3[m[2]];
  // 4
  if ((m = w.match(/^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/))) { if (MGR1.test(m[1])) w = m[1]; }
  else if ((m = w.match(/^(.+?)(s|t)(ion)$/)) && MGR1.test(m[1] + m[2])) w = m[1] + m[2];
  // 5
  if ((m = w.match(/^(.+?)e$/))) {
    const b = m[1];
    if (MGR1.test(b) || (MEQ1.test(b) && !new RegExp(`^${CS}${V}[^aeiouwxy]$`).test(b))) w = b;
  }
  if (/ll$/.test(w) && MGR1.test(w)) w = w.slice(0, -1);
  if (firstY) w = `y${w.slice(1)}`;
  return w;
}

const STOP = new Set(('a an the and or of to in on at for with by from as into per via is are be been being was were ' +
  'this that these those it its their your our my his her them they we you i me us all any each other such ' +
  'than then so not no nor but if when while where who whom which what how up out over under about after before ' +
  'during through within without across between among both either neither more most less least many much ' +
  'etc e g ie eg also may might can could would should will shall must have has had do does did done').split(' '));

/** @param {string} w */
export function isStopWord(w) { return STOP.has(String(w || '').toLowerCase()); }

/**
 * Lowercase word tokens (letters/digits, inner apostrophes and hyphens split).
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean);
}
