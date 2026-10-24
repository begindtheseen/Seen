// English verb inflection for résumé bullets: past tense, base form from a past/gerund token.
//
// Deterministic and dependency-free: an irregular table (the verbs that actually appear on
// résumés) plus the regular rules (-e → -ed, consonant+y → -ied, single-syllable CVC doubling,
// a list of stressed-final-syllable verbs that double in American spelling). Unknown words pass
// through unchanged — the rewrite engine never guesses a form it cannot justify.

export const IRREGULAR_PAST = {
  lead: 'led', build: 'built', write: 'wrote', drive: 'drove', run: 'ran', sell: 'sold', win: 'won', teach: 'taught', bring: 'brought',
  spend: 'spent', deal: 'dealt', meet: 'met', set: 'set', cut: 'cut', put: 'put', hit: 'hit', let: 'let', read: 'read', shut: 'shut',
  split: 'split', spread: 'spread', cast: 'cast', cost: 'cost', quit: 'quit', feed: 'fed', keep: 'kept', leave: 'left', lend: 'lent',
  send: 'sent', bind: 'bound', find: 'found', grind: 'ground', wind: 'wound', hold: 'held', stand: 'stood', understand: 'understood',
  withstand: 'withstood', make: 'made', take: 'took', undertake: 'undertook', overtake: 'overtook', shake: 'shook', mistake: 'mistook',
  give: 'gave', forgive: 'forgave', strive: 'strove', rise: 'rose', arise: 'arose', ride: 'rode', choose: 'chose', freeze: 'froze',
  speak: 'spoke', break: 'broke', steal: 'stole', wake: 'woke', get: 'got', forget: 'forgot', begin: 'began', sing: 'sang', ring: 'rang',
  swim: 'swam', drink: 'drank', sink: 'sank', spring: 'sprang', draw: 'drew', grow: 'grew', know: 'knew', throw: 'threw', fly: 'flew',
  blow: 'blew', do: 'did', go: 'went', come: 'came', become: 'became', overcome: 'overcame', see: 'saw', oversee: 'oversaw', foresee: 'foresaw',
  eat: 'ate', fall: 'fell', feel: 'felt', tell: 'told', buy: 'bought', think: 'thought', seek: 'sought', fight: 'fought', catch: 'caught',
  pay: 'paid', lay: 'laid', say: 'said', hear: 'heard', mean: 'meant', sweep: 'swept', sleep: 'slept', creep: 'crept', light: 'lit',
  slide: 'slid', strike: 'struck', stick: 'stuck', dig: 'dug', hang: 'hung', swing: 'swung', spin: 'spun', sting: 'stung', string: 'strung',
  cling: 'clung', fling: 'flung', wring: 'wrung', lose: 'lost', shoot: 'shot', shed: 'shed', bid: 'bid', rid: 'rid', broadcast: 'broadcast',
  forecast: 'forecast', input: 'input', output: 'output', reset: 'reset', upset: 'upset', offset: 'offset', troubleshoot: 'troubleshot',
  overrun: 'overran', rerun: 'reran', undo: 'undid', redo: 'redid', withdraw: 'withdrew', underwrite: 'underwrote', rewrite: 'rewrote',
  override: 'overrode', uphold: 'upheld', withhold: 'withheld', mislead: 'misled', oversell: 'oversold', resell: 'resold', upsell: 'upsold',
  outsell: 'outsold', rebuild: 'rebuilt', overspend: 'overspent', outgrow: 'outgrew', outrun: 'outran', outdo: 'outdid', have: 'had',
  be: 'was', is: 'was', are: 'were', show: 'showed', sew: 'sewed', bet: 'bet', burst: 'burst', hurt: 'hurt', wed: 'wed', sit: 'sat',
  seat: 'seated', lie: 'lay', bleed: 'bled', breed: 'bred', flee: 'fled', weave: 'wove', tread: 'trod', sweat: 'sweat', beat: 'beat',
  'set up': 'set up', 'follow up': 'followed up', 'carry out': 'carried out', 'turn around': 'turned around', 'de-escalate': 'de-escalated', 'cross-sell': 'cross-sold',
};
const PAST_TO_BASE = new Map(Object.entries(IRREGULAR_PAST).map(([b, p]) => [p, b]));
// A past form that maps to several bases ("found" ← find/found): prefer the résumé-likely one.
PAST_TO_BASE.set('found', 'find'); PAST_TO_BASE.set('left', 'leave'); PAST_TO_BASE.set('lay', 'lie'); PAST_TO_BASE.set('was', 'be'); PAST_TO_BASE.set('were', 'be'); PAST_TO_BASE.set('set', 'set'); PAST_TO_BASE.set('cut', 'cut'); PAST_TO_BASE.set('read', 'read'); PAST_TO_BASE.set('put', 'put'); PAST_TO_BASE.set('hit', 'hit'); PAST_TO_BASE.set('let', 'let'); PAST_TO_BASE.set('shut', 'shut'); PAST_TO_BASE.set('split', 'split'); PAST_TO_BASE.set('spread', 'spread'); PAST_TO_BASE.set('cast', 'cast'); PAST_TO_BASE.set('cost', 'cost'); PAST_TO_BASE.set('quit', 'quit'); PAST_TO_BASE.set('bid', 'bid'); PAST_TO_BASE.set('rid', 'rid'); PAST_TO_BASE.set('shed', 'shed'); PAST_TO_BASE.set('broadcast', 'broadcast'); PAST_TO_BASE.set('forecast', 'forecast'); PAST_TO_BASE.set('input', 'input'); PAST_TO_BASE.set('output', 'output'); PAST_TO_BASE.set('reset', 'reset'); PAST_TO_BASE.set('offset', 'offset'); PAST_TO_BASE.set('upset', 'upset'); PAST_TO_BASE.set('bet', 'bet'); PAST_TO_BASE.set('burst', 'burst'); PAST_TO_BASE.set('hurt', 'hurt'); PAST_TO_BASE.set('wed', 'wed'); PAST_TO_BASE.set('beat', 'beat'); PAST_TO_BASE.set('sweat', 'sweat');

// Multi-syllable verbs whose final consonant doubles in American English.
const DOUBLING = new Set(['admit', 'commit', 'submit', 'omit', 'permit', 'transmit', 'remit', 'emit', 'prefer', 'refer', 'confer', 'defer', 'infer', 'transfer', 'deter', 'occur', 'incur', 'concur', 'recur', 'control', 'patrol', 'enrol', 'compel', 'propel', 'expel', 'dispel', 'repel', 'rebel', 'excel', 'equip', 'regret', 'format', 'reformat', 'program', 'reprogram', 'kidnap', 'unwrap', 'rewrap', 'begin', 'forbid', 'outfit', 'retrofit', 'babysit', 'abet', 'allot', 'acquit', 'combat']);
// Single-syllable CVC words ending in these letters never double.
const NO_DOUBLE_FINAL = new Set(['w', 'x', 'y']);
const VOWELS = 'aeiou';

function syllables(w) {
  const groups = w.toLowerCase().match(/[aeiouy]+/g) || [];
  let n = groups.length;
  if (w.length > 2 && /[^aeiou]e$/.test(w)) n -= 1; // silent e
  return Math.max(1, n);
}

/** Past tense of a base-form verb (multi-word verbs inflect their first word). */
export function pastTense(base) {
  const b = String(base || '').toLowerCase().trim();
  if (!b) return b;
  if (IRREGULAR_PAST[b]) return IRREGULAR_PAST[b];
  if (b.includes(' ')) { const [first, ...rest] = b.split(' '); return [pastTense(first), ...rest].join(' '); }
  if (b.includes('-') && !IRREGULAR_PAST[b]) { const parts = b.split('-'); return [...parts.slice(0, -1), pastTense(parts[parts.length - 1])].join('-'); }
  if (/e$/.test(b)) return b + 'd';
  if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ied';
  if (/c$/.test(b)) return b + 'ked';
  const last = b[b.length - 1], prev = b[b.length - 2], prev2 = b[b.length - 3];
  // "qu" acts as a consonant cluster (equip → equipped, quit → quit).
  const prev2Consonant = !VOWELS.includes(prev2 || 'a') || (prev2 === 'u' && b[b.length - 4] === 'q');
  const cvc = b.length >= 3 && !VOWELS.includes(last) && VOWELS.includes(prev) && prev2Consonant && !NO_DOUBLE_FINAL.has(last);
  if (cvc && (syllables(b) === 1 || DOUBLING.has(b))) return b + last + 'ed';
  return b + 'ed';
}

/** Base form from a token that may be past tense ("managed" → "manage") or null if not a past form. */
export function baseFromPast(token, known) {
  const t = String(token || '').toLowerCase();
  if (PAST_TO_BASE.has(t)) return PAST_TO_BASE.get(t);
  if (!/ed$/.test(t) || t.length < 4) return null;
  const stem = t.slice(0, -2);
  const candidates = [];
  if (/i$/.test(stem)) candidates.push(stem.slice(0, -1) + 'y');       // tried → try
  candidates.push(stem + 'e');                                         // managed → manage
  candidates.push(stem);                                               // trained → train
  if (/([^aeiou])\1$/.test(stem)) candidates.push(stem.slice(0, -1));  // planned → plan
  if (/ck$/.test(stem)) candidates.push(stem.slice(0, -1));            // picnicked → picnic
  if (known) { for (const c of candidates) if (known.has(c)) return c; return null; }
  return guessBase(stem);
}

// Best guess at a base form from a stem with no dictionary: doubled consonant → undouble;
// clusters like -ck/-sh/-ck, two vowels + consonant, and unstressed -er/-or/-en/-it endings keep
// the stem; a vowel + single consonant (or consonant + l/r, or a final v/u) wants its silent e.
function guessBase(stem) {
  if (/([^aeiou])\1$/.test(stem) && !/(ll|ss|ff|zz)$/.test(stem)) return stem.slice(0, -1);
  if (/(ck|sh|ch|th|x|w|y|ss|ll|ff|zz|ng|nk)$/.test(stem)) return stem;
  if (/[vu]$/.test(stem)) return stem + 'e'; // retriev → retrieve, achiev → achieve (no English verb ends in v)
  if (/[aeiou]{2}[^aeiou]$/.test(stem)) return stem;
  if (/[^aeiou][lr]$/.test(stem)) return stem + 'e';
  if (syllables(stem) >= 2 && /(er|or|en|on|it|et|el|al|ow|ish|ect|ist|ast|ent|ant|ard|ert|ort|ain|ign|ess|ess|ket|get|bit|mit|sit|ect|ult)$/.test(stem)) return stem;
  if (/[aeiou][^aeiouwxy]$/.test(stem)) return stem + 'e';
  return stem;
}

/** Base form from a gerund ("managing" → "manage"), null if not a gerund. */
export function baseFromGerund(token, known) {
  const t = String(token || '').toLowerCase();
  if (!/ing$/.test(t) || t.length < 5) return null;
  const stem = t.slice(0, -3);
  const candidates = [stem + 'e', stem];
  if (/([^aeiou])\1$/.test(stem)) candidates.push(stem.slice(0, -1));
  if (/y$/.test(stem) && stem.length > 2) candidates.push(stem.slice(0, -1) + 'ie'); // dying → die
  if (known) { for (const c of candidates) if (known.has(c)) return c; return null; }
  if (/e$/.test(stem)) return stem; // seeing → see, agreeing → agree
  return guessBase(stem);
}

/** Third-person singular is never used for résumé leads; base form IS the present form. */
export function presentTense(base) { return String(base || '').toLowerCase().trim(); }

/** Keep the capitalization pattern of `like` (first-letter or ALL CAPS) on `word`. */
export function matchCase(word, like) {
  if (!like) return word;
  if (like === like.toUpperCase() && like.length > 1) return word.toUpperCase();
  if (/^[A-Z]/.test(like)) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}
