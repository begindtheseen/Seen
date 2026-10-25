// The posting's own vocabulary, as stems with weights — and how much of it a résumé line uses.
//
// 2026-10-25 (Dev, Stripe backend posting): the competency vectors that rank roles and bullets are
// built from an hourly-work lexicon, so for a software posting they saw "customer service" in
// "900 customer orgs" and nothing at all in "payment-orchestration APIs … p99 latency". Dev's
// senior Go/payments role ranked last ("Supporting · 42%"). For Tasha, "Trained 4 new partners on
// drink standards" was the bullet to "move to the top" for a social-media AND a CRM posting.
//
// This is the industry-agnostic signal underneath: the words the posting itself uses (stemmed,
// minus stopwords and job-ad boilerplate, minus the company's own name), weighted by how often
// the posting uses them and whether the title or a named skill carries them; and, for any résumé
// text, the posting words it shares. A role or bullet that talks about what the posting talks
// about ranks higher — whatever the field. Deterministic, no I/O.
import { tokenize, stemWord } from '../../optimizer/lemma.js';
import { KNOWN_SKILLS } from '../../optimizer/extractJobFacts.js';
import { GENERIC } from './keywords.js';

const STOP = new Set(('a an and are as at be been being but by for from had has have he her his if in into is it its of on or our '
  + 'she so than that the their them then there these they this to was we were what when where which while who will with would you '
  + 'your yours about above after again all also any because before below between both can could did do does doing down during each '
  + 'few further here how i just me more most my no nor not now off once only other out over own same should some such too under until '
  + 'up very via per etc using use used within across able well must may might shall role job jobs work working team teams company '
  + 'companies position candidate candidates applicant applicants responsibilities requirements required require requires '
  + 'qualifications qualified preferred plus strong excellent great good ability skills skill experience experienced years year '
  + 'including include includes looking seeking join help helping ensure ensuring support supporting provide providing new various '
  + 'related field fields degree equivalent minimum ideal ideally opportunity opportunities environment fast paced self driven detail '
  + 'oriented bonus nice day days time full part please apply www http https com one two three four five us our ours we\'re you\'ll '
  + 'you\'re who\'s what\'s everyone everything anything someone people person thing things way ways lot lots make makes making '
  + 'get gets getting take takes taking keep keeps every each many much high highly level levels like etc benefits benefit pay paid '
  + 'salary hourly hour hours equal employer employment applicants regard race color religion sex sexual orientation gender identity '
  + 'national origin disability veteran status protected law laws accommodation accommodations reasonable eligible location '
  + 'remote hybrid onsite office offices based world global mission values culture passion passionate love proud').split(/\s+/).map(stemWord));

// job-ad generic words ("standards", "systems", "quality", "team") say nothing about the field
for (const w of GENERIC) STOP.add(stemWord(w));

const SKILL_WORDS = new Set(KNOWN_SKILLS.filter((s) => !/\s/.test(s)).map(stemWord));
// spellings of one skill
const ALIAS = { golang: 'go', postgr: 'postgresql', postgresql: 'postgresql', postgres: 'postgresql', k8: 'kubernetes', js: 'javascript', ts: 'typescript' };

/** Stems of the posting title — role/level words a bullet ranking should not count. */
export function titleStems(jobTitle = '') {
  return new Set(tokenize(jobTitle).map((t) => ALIAS[t.stem] || t.stem));
}

/**
 * Stem → weight for the posting's content words.
 * @param {string} jobDescription
 * @param {{ jobTitle?: string, company?: string }} opts
 */
export function postingTermWeights(jobDescription, { jobTitle = '', company = '' } = {}) {
  const counts = new Map();
  const companyStems = new Set(tokenize(company).map((t) => t.stem));
  for (const t of tokenize(`${jobDescription}`)) {
    const stem = ALIAS[t.stem] || t.stem;
    if ((stem.length < 3 && !SKILL_WORDS.has(stem)) || /^\d/.test(stem) || STOP.has(stem) || companyStems.has(stem)) continue;
    counts.set(stem, (counts.get(stem) || 0) + 1);
  }
  const titleStems = new Set(tokenize(jobTitle).map((t) => t.stem).filter((s) => !STOP.has(s) && !companyStems.has(s)));
  for (const s of titleStems) if (s.length >= 2) counts.set(s, Math.max(counts.get(s) || 0, 1));
  const weights = new Map();
  for (const [s, n] of counts) {
    let w = Math.min(2.2, 1 + Math.log2(n) * 0.5);
    if (titleStems.has(s)) w *= 1.6;
    if (SKILL_WORDS.has(s)) w *= 1.5;
    weights.set(s, Number(w.toFixed(3)));
  }
  return weights;
}

/**
 * The posting words a text uses (distinct stems), their summed weight, and a 0–1 score saturating
 * at `saturation` weight units.
 */
export function termOverlap(text, weights, saturation = 6, exclude = null) {
  const hits = new Set();
  let sum = 0;
  if (weights && weights.size) {
    for (const t of tokenize(text)) {
      const stem = ALIAS[t.stem] || t.stem;
      if (hits.has(stem) || !weights.has(stem) || (exclude && exclude.has(stem))) continue;
      // a two-letter skill ("Go") counts only as written with its capital, never the verb "go"
      if (stem === 'go' && !/^Go$/.test(String(text).slice(t.start, t.end))) continue;
      hits.add(stem);
      sum += weights.get(stem);
    }
  }
  return { hits: [...hits], weight: Number(sum.toFixed(3)), score: Number(Math.min(1, sum / saturation).toFixed(3)) };
}
