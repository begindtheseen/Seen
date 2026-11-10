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
| Titles, 148 of K's résumé-style titles (labelled before any code) | 93.9% classified, 91.4% of classified correct | ≥90% / ≥95% |
| Titles, 143 real posting titles from the corpus | 63.6% classified, 82.4% of classified correct | ≥90% / ≥95% |
| Same corpus titles with the posting text as `lines` | 72.7% classified, 75.0% correct | — |
| The brief's titles (Supply Sergeant, 88M, Assistant Branch Manager, Medical Billing Specialist, Software Engineering Intern, Process Assistant, Licensed Insurance Producer, Principal Elementary School, Phlebotomist, Chef, Lab Technician) | all classified acceptably | all |
| relation, 120 labelled pairs | 71.7% agreement; 2 labelled ladders called "different" (both: a side could not be placed) | ≥90%, 0 |
| sameWord, 150-pair dev set (used to tune) | precision 96.3%, recall 32.5% | ≥95% |
| sameWord, 60-pair holdout (written after tuning) | precision 81.8% (2 false matches, both arguable: shipment~cargo, procedure~process), recall 33.3% | — |
| cold load | occupations 20 ms / 8 MB heap; titles 200 ms / 10 MB; military 206 ms / 21 MB; synonyms 7 ms / 2 MB | — |
| throughput (warm) | occupationOf ≈700 new titles/s (cached repeats free); relation ≈14k/s cached; sameWord ≈170k/s; levelOf ≈90k/s | — |

## How to use it

**Matched jobs.** Place the person's current title with `occupationOf(title, { lines: thatRole'sBullets, employer })`; when it is
null or a `guess`, try the previous role rather than inventing a field. For each job, `relation(personTitle, jobTitle, { lines })`:
`same` and `ladder` (up one rung, `levelOf` gap ≤ ~1.5) are the rail's core; `related` is a side-step to show with its `why`; never
show `different` because a title was unknown — `why` says "could not place". Military roles: `militaryOccupation` first.

**The verdict.** For "does this résumé show requirement R": (1) `impliedDuties(personTitle, lines)` — when R's content words sit in one
of those task statements AND a résumé line shares at least one specific word with R, accept weaker lexical evidence (still cite the
person's line, never the task text). (2) Compare requirement words to résumé words with `sameWord` after your own stop-word removal:
family matches (educate/education, schedule/scheduled, lead/led) are safe; synonym matches are strong but rare. Do not mark a gap
because `sameWord` said false.

**Field match.** `relation(a, b)` gives same / ladder / related / different with a plain `why` you may show; `group.majorTitle` names the
field ("Healthcare Support"). Prefer codes when you already have them (cheaper, no title ambiguity).
