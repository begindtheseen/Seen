# lib/occupations + lib/text/synonyms — general occupation and word knowledge, no model

Two public, rule-based resources shipped with the site, read once per process, no network:

| file | source | licence | size |
|---|---|---|---|
| `lib/occupations/data/occupations.json` | O*NET 31.0 Database (USDOL/ETA): 1,016 occupations — title, job zone, related occupations with tier, ≤15 task statements (Core first, by importance), ≤10 specific tools, alternate-title count | CC BY 4.0, attribution on `/methods` (required wherever the data is used) | 1.7 MB |
| `lib/occupations/data/titles.json` | O*NET Alternate Titles + Sample of Reported Titles + the occupations' own names: 46.7k normalised title keys grouped by head word | CC BY 4.0 | 1.1 MB |
| `lib/occupations/data/military.json` | O*NET military crosswalk (DMDC MOC, Aug 2024): 19.7k MOS / rating / AFSC codes and titles, all branches, enlisted/officer/warrant | CC BY 4.0 | 1.3 MB |
| `lib/text/data/synonyms.json` | WordNet 3.1 (Princeton), distilled to 11.7k work words and 1,049 kept synonym sets | WordNet licence (notice on `/methods`) | 0.2 MB |

Rebuild: `node scripts/occupations/build-occupations.mjs --work <scratch dir outside the repo>` (or `--from <dir with the unzipped CSVs>`),
then `node scripts/text/build-synonyms.mjs --corpus <postings.json> --onet <dir>/db_31_0_csv` (it reads the built `titles.json`).
Both builds are deterministic (same inputs → same bytes); `wordnet-db` is a devDependency used only by the synonym build — nothing
under `lib/` may import it (pinned by a test).

## API

```js
import { occupationOf, relation, levelOf, tasksOf, toolsOf, impliedDuties, militaryOccupation } from '../occupations/index.js';
import { sameWord, relateWords, synonymsOf, lemmaOf } from '../text/synonyms.js';

occupationOf('Principal, Elementary School')
// → { code: '11-9032.00', title: 'Education Administrators, Kindergarten through Secondary', confidence: 'exact',
//     group: { major: '11', majorTitle: 'Management', minor: '11-9', broad: '11-903', detailed: '11-9032' },
//     zone: 5, alternatives: [], via: 'title', matched: 'elementary school principal', ambiguous: false }
occupationOf('88M Motor Transport Operator')        // → Heavy and Tractor-Trailer Truck Drivers (via 'military:A:88M')
occupationOf('Process Assistant (PA)', { employer: 'Amazon' })   // → First-Line Supervisors of Helpers, Laborers… ('close'; 'guess' without the employer)
occupationOf('Director')                            // → null (a role noun with no field)
occupationOf('Medical Billing Specialist', { lines })   // lines break a tie among the 3 occupations O*NET files it under

relation('Plumbing Apprentice', 'Journeyman Plumber')   // → { relation: 'ladder', direction: 'up', why: 'Helpers--Pipelayers… assist in Plumbers… work' }
relation('Phlebotomist', 'Medical Laboratory Technician') // → { relation: 'related', why: 'O*NET lists … as related …' }
relation('Chef', 'Food Safety QA Technician', { lines: chefLines })  // → 'related' when the chef's lines name "food safety"; 'different' without
relation('Chef', 'Food Safety QA Technician', { credentials: ['HACCP'] }) // → 'related': a named credential of the target's field (HACCP, ServSafe, PCQI, CDL …)
relation('29-1141.00', '15-1252.00')                    // codes work too

levelOf('Assistant Branch Manager')   // → { marker: 'assistant', rank: 6.5 }   ('Branch Manager' → manager 7)
levelOf('Master Plumber')             // → { marker: 'senior', rank: 4 }       ('Journeyman Plumber' 3, 'Plumbing Apprentice' 0)

impliedDuties('Registered Nurse')     // → { code, title, confidence, tasks: [...15 O*NET task statements] } | null (unknown or only guessed)
militaryOccupation('Unit Supply Specialist (92Y), U.S. Army')  // → { service: 'A', moc: '92Y', occupations: [{ code: '53-7065.00', … }], via: 'code' }

sameWord('presented', 'presentation') // true  (one word family, by rule)
sameWord('teach', 'instruct')         // true  (kept synonym set)
sameWord('coach', 'manager')          // false (person nouns are kept only as O*NET titles of one occupation)
relateWords('repair', 'fix', 'v')     // { same: true, how: 'synonym', via: 'fix repair' }
synonymsOf('help', 'v')               // ['aid', 'assist']
```

`occupationOf` order: military code/title → employer jargon (a tiny list: Amazon "Process Assistant", Walmart "Customer Host"…;
single-word jargon needs the employer) → the full title exactly → without level words → same head word with closely matching
modifiers (Dice ≥ 0.8) → the partial readings (one side of a comma/slash, a later dash segment) the same way → with `lines`, the
occupation whose task statements the lines share ≥4 specific words with. A weak title match alone returns **null** (on real postings
such guesses were wrong 9 times in 14). Title-only answers are cached (5k).

## Round 4: trade talk (`lib/text/tradeTalk.js`)

742 reviewed groups in 16 fields (≥ 40 each): food, retail, warehouse, healthcare, nursing, trades, office, support,
sales, k12, itsupport, software, accounting, construction, security, military. Source `scripts/text/trade-talk.txt`
(human-readable) → `scripts/text/build-trade-talk.mjs` → `lib/text/data/tradeTalk.json` (52 KB).

```js
import { sameThing, expand, fieldsOf } from '../text/tradeTalk.js';
sameThing('vitals', 'vital signs', { field: 'healthcare' })
// → { same: true, via: 'vital signs', kind: 'abbreviation or trade term', confidence: 'exact' }
sameThing('ServSafe', 'food safety certification', { field: 'food' })           // → same: true (instance ⇒ class)
sameThing('food safety certification', 'ServSafe Manager', { field: 'food' })   // → same: false (a class does not show an instance)
sameThing('IM injections', 'intramuscular medications', { field: 'office' })    // → same: null (not this field's IM)
fieldsOf('29-1141.00')   // → ['healthcare', 'nursing']
```

**Contract.**
- `true` + `exact`: use as fact.
- `true` + `close`: the term contains a listed term; use it, but a contradicting reading wins.
- `false`: both terms are known in this field and name different things, or the class is asked to show the instance.
- `null`: unknown, or not this field. It says nothing.
- The longest listed term wins: "EPA 608 Universal" is the instance, not the "EPA 608" inside it.
- A single ordinary English word ("pick", "stow", "rest") counts only as the whole term.

**Measured.**
- Own 330 pairs, written before the table: precision 100%, recall 97.9%. I wrote both the table and these pairs, so this number is optimistic.
- Fresh 101-pair holdout, written after the table from the corpora's phrasing: precision 95.7%, recall 89.3%.

## Round 3: the activity index (`lib/occupations/activities.js`)

O*NET maps every task statement (24k mappings) to one of 2,087 Detailed Work Activities (DWA), each under an Intermediate
(IWA, 332) and a Generalized (GWA, 41) activity. `data/activities.json` (0.9 MB: stems + ids, plain-words titles) turns
that hierarchy into a retrieval index; `scripts/occupations/build-activities.mjs` builds it.

```js
import { activitiesOf, relateActivities, activityTitle } from '../occupations/activities.js';
activitiesOf('Drew blood from patients')
// → [{ dwa: '4.A.3.a.2.al.1', iwa: '4.A.3.a.2.al', gwa: '4.A.3.a.2', title: 'collecting biological specimens from patients', score: 0.8, via: [...] }, …]
relateActivities('Ran the register and handled cash', 'Operate cash registers')
// → { relation: 'same', via: { dwa, iwa, title: 'operating cash registers' }, confidence: 'exact' }
relateActivities('Manage inventory', 'Manage a sales pipeline')   // → { relation: null, … }
```

**Contract.**
- `same` — one DWA among both phrases' top three. `exact` (top for both, score ≥ 0.7): may be said as "the same kind of
  work". `close`: use it, but a contradicting reading wins.
- `related` — one IWA, the same family of work but not the same duty. It is never proof; at most PARTLY.
- `guess` — never a reason. It is only a tie-break.
- `null` — says nothing either way.
- `activitiesOf` returns `[]` below the floor. It never offers a weak nearest neighbour.
- In a browser `relateActivities` → null and `activitiesOf` → [].
- Copy: `via.title` is a lower-case gerund phrase ("loading or unloading materials").

**Measured.**
- Labelled set: 203 pairs, written before any code; it was looked at while choosing rules.
  - same-or-related precision 97.6%, recall 32%.
  - unrelated pairs kept unrelated: 74 of 75. The one miss is a `guess`.
  - `exact`/`close` only: 100% precision, 24% recall.
- Fresh holdout: 79 pairs.
  - precision 100%, recall 14%.
  - unrelated kept: 22 of 22.
- Recall by field (labelled set):
  - office 8/13, healthcare 7/14, trades 6/15, retail 5/11
  - food 3/13, education 3/9, tech 3/15
  - warehouse 1/14, sales 1/11
- **Recall is low.** Use a `null` as "not known", never as "different".
- Speed: cold load ≈ 130 ms, then about 1.1 ms per uncached `relateActivities`.

## Round 2 (2026-11-10)

- **Browser-safe.** No module here imports a Node built-in; data loads lazily through `process.getBuiltinModule`
  (`lib/text/knowledgeData.js`). In a browser bundle every function answers "no knowledge": `occupationOf`, `impliedDuties`,
  `militaryOccupation` → null; **`relation` → null**; `relatePhrases` → `{ same: false, how: 'no knowledge' }`;
  `sameWorkWord` → null; `sameWord` → false (identical strings excepted). `levelOf` needs no data and works everywhere.
  `hasOccupationData()` says whether the data is loaded. On the server a failed load logs one `console.error` per file.
- **Modern titles** (`lib/occupations/modern.js`): rules over role noun + modifiers for software / data / ML / DevOps / SRE /
  security, product and program management, design / UX, customer success / support / solutions, SDR / account executive /
  revenue operations, marketing operations / growth / content, people ops / talent, finance ops / FP&A, clinical titles with
  unit names, skilled-trade rungs, retail / warehouse / production floors; each family pinned by ≥10 titles
  (`modern.test.mjs`). A strong O*NET filing of the whole title still answers first; a rule hit is `close`. Paid AI-training
  tasks and survey panels ("… - AI Training - …", "Survey Participants") return null.
- **relation** first compares the titles' own core words with level words set aside ("Plumbing Apprentice" / "Journeyman
  Plumber"; "Assistant Store Manager" / "Store Manager") and takes the rung from `levelOf`; then any shared occupation among
  the readings (same / ladder by level); then O*NET supervisor / helper / related tiers / groups. It never answers
  "different" for two titles that share an occupation or differ only by a level word.
- **Shipping guard** (`shipping.test.mjs`): walks the import graph from every `api/*.js` and fails when a function that
  reaches this data lacks `lib/occupations/data/**` and `lib/text/data/**` in its `includeFiles`.

## When to trust it (the contract)

| `confidence` | meaning | how to use |
|---|---|---|
| `exact` | the whole normalised title IS an O*NET title of the occupation, with strong evidence (reported by incumbents and shown in My Next Move, several sources plus a report, or the occupation's own name), not contested by the titles that end with it, not tied — or a reviewed usage correction (back-end / platform engineer → Software Developers). Measured 74 of 74 correct on 351 labelled titles. | use as fact |
| `close` | a weaker or contested filing, a partial reading (one side of a comma, a dash segment), a function + role-noun title, a head-word fuzzy match (Dice ≥ 0.8) or a military crosswalk mapping. `ambiguous: true` + `alternatives` when several occupations claim it equally (Account Executive, Medical Billing Specialist). ≈85–90% right. | use, but a contradicting résumé line or the employer wins; when `ambiguous`, pass `lines` / `employer` or show the alternatives |
| `guess` | employer jargon without the employer, or the person's / posting's lines alone. ≈75% right. | never the basis for an emailed match or a "shown" verdict; a tie-break only |
| `null` | unknown | say "unknown"; never fall back to another role's occupation as if it were this one |

`relation` inherits the weaker side's confidence: treat `ladder`/`same` built on a `guess` title as a guess. `sameWord` → `true` is
evidence, `false` is not a gap.

**Stable exports** (names, arguments and return fields will not change; new fields may be added): `occupationOf`, `relation`,
`levelOf`, `tasksOf`, `toolsOf`, `impliedDuties`, `militaryOccupation`, `occupation`, `groupOf`, `looksMilitary` from
`lib/occupations/index.js`; `sameWord`, `relateWords`, `synonymsOf`, `lemmaOf`, `relatePhrases` from `lib/text/synonyms.js`;
`relatePhrases`, `sameWorkWord`, `unitsOf`, `familiesOf` from `lib/text/workFamilies.js`; `stem`,
`inflectionCandidates`, `derivationCandidates`, `lemmaCandidates`, `words`, `isStopWord` from `lib/text/morph.js`. Not stable:
`_internal`, `normalize.js` helpers, `parseGroupIds`, the data file formats (read them only through the API).

## What each function is safe to conclude — and what it is not

- **occupationOf** — safe: "this title is an O*NET title of occupation X" (`exact`), with `alternatives` / `ambiguous` when O*NET
  files the same title under several occupations. NOT safe: that `close` answers are right (≈80–90%), that a `guess` is right
  (lines-backed guesses on posting text were right ~75%), or that null means "no occupation". O*NET titles skew formal and older:
  tech titles ("Forward Deployed Engineer", "GTM Strategist", "AI Trainer"), employer jargon and "Associate"/"Team Member"-style titles
  are often unknown; some O*NET filings are surprising and are reproduced faithfully ("Account Executive" → Advertising and Promotions
  Managers, "Back End Engineer" → Web Developers, "Data Analyst" → Survey Researchers, "Station Manager" → Media Programming Directors).
- **relation** — safe: `different` for unrelated fields; `ladder` direction within one occupation or a supervisor/helper/assistant
  pair. NOT safe: `same` vs `related` at O*NET's granularity (Systems Administrator and Network Administrator are one occupation;
  Home Health Aide and Personal Care Aide are two); a side-step needs the person's `lines` (O*NET's task text alone does not connect a
  chef to food-safety QA).
- **levelOf** — a rule over the title's own words; safe for ordering titles within one line of work. It does not know that a
  "Staff Accountant" is junior while a "Staff Engineer" is senior beyond the role-noun rule it applies, nor employer level codes (L5, IC4).
- **tasksOf / impliedDuties** — O*NET's task statements for the occupation: the duties the occupation USUALLY involves. Use them as a
  prior that lowers how much lexical evidence a core duty needs — never as proof the person did them, and never as text to print as
  the person's (they are formal, third-person, generic).
- **militaryOccupation** — the crosswalk's civilian matches, verbatim (some are coarse: Army 25U → Broadcast Technicians).
- **sameWord** — high-precision, low-recall: a `true` is good evidence two words mean the same thing; a `false` means nothing
  (inspect/examine, verify/confirm, problem/issue are NOT linked). Use it to add proof, never to deny it.

## Measured (2026-11-10, scripts and gold sets in the director's scratchpad `director/k/`)

| measure | result | target |
|---|---|---|
| `exact` precision over all 351 labelled titles | **74 / 74 (100%)** | ≥99% |
| Titles, 148 of K's résumé-style titles (labelled before any code) | 95.3% classified, 90.8% of classified correct | ≥90% / ≥95% |
| Titles, 143 real posting titles from the corpus | 67.8% classified, 86.6% of classified correct | ≥90% / ≥95% |
| Titles, 60 "<function> + lead/supervisor/manager/coordinator/specialist/associate" | 100% classified, 76.7% correct | — |
| Same corpus titles with the posting text as `lines` | 75.5% classified, 74.1% correct | — |
| The brief's titles (Supply Sergeant, 88M, Assistant Branch Manager, Medical Billing Specialist, Software Engineering Intern, Process Assistant, Licensed Insurance Producer, Principal Elementary School, Phlebotomist, Chef, Lab Technician) | all classified acceptably | all |
| relation, 120 labelled pairs | 71.7% agreement; 2 labelled ladders called "different" (a side could not be placed) | ≥90%, 0 |
| work thesaurus `relatePhrases`, 400 pairs written after the TABLE was frozen (then used to fix the matching code) | precision 95.7%, recall 90.0% | P ≥93%, R ≥70% |
| work thesaurus `relatePhrases`, 100-pair holdout written after the CODE was frozen | **precision 91.3%, recall 84.0%** | P ≥93%, R ≥70% |
| `sameWord` (work families first, WordNet for unknown words), 150-pair dev / 60-pair WordNet holdout | 95.3% / 76.2%; 65.0% / 48.1% (most holdout "false" matches are label calls: vehicle~car, cash~money, procedure~process) | — |
| cold load | occupations 20 ms / 8 MB heap; titles 200 ms / 10 MB; military 206 ms / 21 MB; synonyms 7 ms / 2 MB; workFamilies < 10 ms | — |
| throughput (warm) | occupationOf ≈700 new titles/s (cached repeats free); relation ≈14k/s cached; sameWord ≈170k/s; levelOf ≈90k/s | — |

## The work thesaurus (`lib/text/workFamilies.js`, `lib/text/data/workFamilies.json`)

169 action families and 188 object families, written and reviewed by hand in `scripts/text/work-families.txt` from the
most frequent verbs / nouns of O*NET task statements and the posting corpus (160 of the top 200 task verbs and 175 of the top 300
nouns sit in a family; 426 / 800 verbs, 565 / 1,500 nouns). Members that only hold in a context carry a condition:
`coach?staff|learners` (people development, not sports), `drive?vehicles|trucks|forklifts` (not "drive revenue"), `client?care`.

```js
import { relatePhrases, sameWorkWord, unitsOf, familiesOf } from '../text/workFamilies.js';
relatePhrases('Develop and maintain delivery schedules', 'Build and update 3-week delivery look-aheads')
// → { same: true, how: 'action and object', action: { a: 'develop', b: 'build', family: 'create' }, object: { a: 'delivery schedules', b: 'look aheads', family: 'look_ahead' } }
relatePhrases('drive a truck', 'drive revenue')        // → { same: false, how: 'different objects' }
relatePhrases('age-restricted sales', 'B2B sales')     // → false;  'logistic regression' vs 'logistics' → false;  'PT' vs 'PTA' → false
sameWorkWord('manage', 'supervise')                   // → { same: false } — managing what?
sameWorkWord('manage', 'supervise', { context: ['staff'] })   // → { same: true, family: 'supervise', conditional: true }
```

Rules: actions agree on the same verb or a shared family whose conditions the objects of either phrase meet; objects agree on
the same word or a shared family; when both phrases name objects and none agree, the phrases differ; light verbs (perform,
conduct, provide …) are transparent. **Use `relatePhrases` for requirement-vs-line decisions** — it sees the objects; `sameWord`
on bare words cannot.

## How to use it

**Matched jobs.** Place the person's current title with `occupationOf(title, { lines: thatRole'sBullets, employer })`; when it is
null or a `guess`, try the previous role rather than inventing a field. For each job, `relation(personTitle, jobTitle, { lines })`:
pass the person's certifications as `credentials` too. `same` and `ladder` (up one rung, `levelOf` gap ≤ ~1.5) are the rail's core; `related` is a side-step to show with its `why`; never
show `different` because a title was unknown — `why` says "could not place". Military roles: `militaryOccupation` first.

**The verdict.** For "does this résumé show requirement R": (0) `relatePhrases(R, line)` for each résumé line — a `same` with
`how: 'action and object'` is a paraphrase you may show as proof (cite the person's line); `how: 'action'` or `'object'` alone is
partial evidence. (1) `impliedDuties(personTitle, lines)` — when R's content words sit in one
of those task statements AND a résumé line shares at least one specific word with R, accept weaker lexical evidence (still cite the
person's line, never the task text). (2) Compare requirement words to résumé words with `sameWord` after your own stop-word removal:
family matches (educate/education, schedule/scheduled, lead/led) are safe; synonym matches are strong but rare. Do not mark a gap
because `sameWord` said false.

**Field match.** `relation(a, b)` gives same / ladder / related / different with a plain `why` you may show; `group.majorTitle` names the
field ("Healthcare Support"). Prefer codes when you already have them (cheaper, no title ambiguity).
