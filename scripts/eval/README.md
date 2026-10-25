# Pro-tools evaluation harness

This harness measures whether Seen's paid ("Pro") tools are actually right. It runs every credit-spending
tool against 15 fictional résumé + posting pairs, applies automatic checks to every output, and merges in
an expert grade for each tool × fixture. It only measures; it changes no product code.

## Run it

```bash
npm run eval:pro                         # deterministic tools, in-process (~20 s, no network)
node scripts/eval/run.mjs --prod \
  --accounts /path/to/accounts.txt       # also call the model-backed tools on seenjobs.io
```

| Option | Meaning |
|---|---|
| `--only=01-retail-manager,06-backend-engineer` | run only some fixtures |
| `--tools=fit,optimize,tailor` | run only some tools (ids below) |
| `--prod` | make live calls for `interview_prep` and `tailor_polish` (needs the account file) |
| `--jobtext` | also run `interview_prep_jobtext`: Interview Prep with the posting text (the API accepts it; the tracker never sends it) |
| `--base=https://<preview>.vercel.app` | live calls against a preview instead of production |
| `--fresh` | ignore the live-response cache |
| `--reserve=5` | stop a live tool when `X-RateLimit-Remaining` falls to this |
| `--pace=15` | seconds between live model calls |
| `--wait` | after a 429, sleep until the next hour window instead of stopping |
| `--label=after-fix` | output file label (default `run`) |
| `--grades=<file>` | expert grades to merge (default `scripts/eval/grades/baseline.json`) |
| `--no-write` | print only |

Output goes to `scripts/eval/results/<date>-<label>.md` (the scorecard), `.json` (every record and every
finding) and `.outputs.json` (the full tool outputs, for reading and grading). The process exits 1 while
any tool fails the bar.

**Live calls.** The account file has one row per account, `name email password user_id`, and the harness
uses the `eval` row. Pass it with `--accounts` or set `EVAL_ACCOUNTS_FILE`. The password and the session
token are never written to disk or printed.

Before each Interview Prep call, the harness saves the fixture résumé to the eval account
(`/api/user-sync save_resume`), because the build reads the résumé from `profiles`. That account is the
only production write the harness makes.

Responses are cached under `scripts/eval/.cache/` (git-ignored), keyed by the input. A re-run without
`--prod` reuses the last live outputs. A re-run with `--prod` skips the calls that already finished
unless you pass `--fresh`.

The eval account must be Pro in `consume_credit`. A comped account is not (see defect #12), so give it
`pro_until` until that is fixed.

## What it runs

| Tool id | Model? | Code path |
|---|---|---|
| `parse` | no | upload → `api/resume.js` action `parse` → `lib/resume/parse` (`parseResume`) |
| `parse_pdf` | no | the same, from a first-line-indent ("hanging") PDF rendered with pdfkit (fixtures with `"pdf": true`) |
| `fit` | no | free SeenFit: `api/optimizer.js` action `optimize` → `lib/optimizer` `runOptimizer` |
| `optimize` | no | paid Optimize, 1 credit: `api/resume.js` tool `optimize` → `lib/server/optimizePackage.js` (probe + run) |
| `scanner` | no | legacy ATS scanner, 1 credit, no UI caller: `api/resume.js` tool `scanner` |
| `ats_check` | no | Studio ATS check (PDF + DOCX): `api/resume.js` action `ats_check` |
| `tailor` | no | Studio tailor, 1 credit: `api/resume.js` action `tailor` → `lib/resume/tailor` |
| `tailor_polish` | **yes** | Studio tailor with the Pro polish → `lib/resume/tailor/polish.js` → `lib/server/llm.js` |
| `export` | no | Studio export, PDF/DOCX × Pro/free × base/tailored, re-extracted with `lib/resume/extract`; plus the legacy `download_resume` |
| `insights` | no | AI job insights, 1 credit on a cache miss: `api/job-insights.js` → `lib/server/jobInsights.js` |
| `advantage` | no | strategy plan (playbook + 30/60/90 + LinkedIn script), 1 credit: `api/resume.js` tool `advantage` → `lib/server/resumeAnalysis.js` |
| `humanproof` | no | HumanProof / Human Voice (Pro) on the paid package: `api/optimizer.js` action `humanize` |
| `interview_prep` | **yes** | Interview Prep build exactly as the tracker sends it: `api/interview-prep.js` → `chat` + `guardPack` |
| `interview_prep_fallback` | no | the coached pack users get when no model is configured or the model call fails (`fallbackPack`) |
| `interview_prep_jobtext` | **yes** | Interview Prep with `job_text` (`--jobtext`) |

The in-process handlers use a fake Supabase (`fakeDb.mjs`). It records every credit the gate would
spend and answers 503 to any other host, so nothing leaves the process. Pro is on by default; the export
check also runs with Pro off.

## Fixtures (`fixtures/*.json`)

There are 14 fields: retail manager, warehouse lead, cashier, customer service, RN, backend engineer, data
analyst, marketing coordinator, SDR, admin assistant, accountant, HVAC tech, line cook and teacher. Fixture
15 is a posting that states no requirements, used for the charging check.

Text is stored as line arrays. Each `gold` block holds:

- `family`: acceptable role families
- `must_skills`: regexes the requirement list must hit
- `alternatives`: choice groups that must stay "any of"
- `years_min` (and an optional `years_allowed`)
- `traps`: `match` regex plus `scope`: `candidate` means it must never be claimed for the person,
  `requirements` means it must never be listed as required, `any` means it must not appear in any output
- `resume_numbers`, `resume_employers`, `resume_titles`, `resume_degrees`

## Automatic checks (`checks.mjs`)

| Check | What fails |
|---|---|
| `invented_number` | a number in a claim (bullet, summary, intro, answer, message) that is not in the résumé; number words count |
| `invented_years` | an "N+ years" claim that contradicts the résumé's own stated years, exceeds its date span, or misstates tenure at a named employer |
| `invented_org` / `invented_tool` / `invented_degree` | a capitalised organisation, a tool or credential, or a degree in a claim that is not in the résumé |
| `trap` | a gold trap in the scope it is banned from |
| `must_skill_missing` | a core requirement absent from the tool's requirement list |
| `alternative_as_hard` | one member of an "A or B" group listed as required on its own |
| `years_misread` | a requirement list naming a years figure the posting does not ask for |
| `wrong_family` / `other_field_vocab` | the pack's family is outside `gold.family`, or another field's vocabulary appears that is in neither the résumé nor the posting |
| `broken_text` | duplicated words, template leaks, stray letters ("e shift"), bad grammar ("Your an …"), unbalanced brackets, "·" mid-sentence, a header line used as a story, a dated result rewritten in present tense |
| `meaning_changed` | a rewrite that drops a number, a tool or proper noun, or a clause-final preposition ("calls for." → "calls.") |
| `round_trip_missing` / `pro_branded` / `export_failed` | an exported bullet not found on re-extraction, or a Pro export containing "Seen" |
| `parse_*` | an employer not parsed as a company, a fake role, a title fragment, a fragment parsed as a bullet |
| `no_requirements_contract` / `charge_for_nothing` | the no-requirements posting must get `no_requirements` with no charge; any credit spent on an empty result fails |
| `error` / `latency` | HTTP ≥ 500 or an exception; over 3 s (in-process) or 30 s (model) |

## Expert review (`grades/baseline.json`)

Each tool × fixture gets a grade from a senior recruiter / hiring-manager read of the output, stored with
the output's hash:

- 5: a job seeker would pay for this alone
- 3: usable, but no better than free ChatGPT
- 1: harmful

When a fix changes an output, the scorecard marks that grade **stale** (⚠). Re-grade it, write a new grades
file, and pass it with `--grades`. The same file holds the ranked defect list, with the exact wrong text,
the root cause (file:line) and a one-line fix.

## Pass bar

A tool passes only when all of these hold:

- 0 invented facts, 0 traps, 0 wrong-field outputs, 0 broken-text outputs (meaning changes count) and
  0 charges for nothing;
- export round-trip 100%, with no Pro export carrying "Seen";
- 0 parse defects (for `parse` and `parse_pdf`) and 0 errors;
- a mean expert grade ≥ 4.0, with no single grade below 3, and no stale grades.

`must_skill_missing`, `alternative_as_hard` and `years_misread` are reported per check. They feed the
expert grade rather than failing a tool on their own.
