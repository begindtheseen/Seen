# Seen Resume Intelligence Engine — build report

_Deterministic, evidence-grounded, no paid AI. Built 2026-08-07._

## 1. Root cause — what was fundamentally wrong

The résumé optimizer was **three independent deterministic engines stapled into one UI**, each parsing the same job description with its own dictionary and none aware of the job's domain:

| Engine | File | Fed the UI section |
|---|---|---|
| Job insights | `lib/server/jobInsights.js` | "WHAT THEY REALLY WANT" + "Mirror these exact terms" |
| Legacy optimizer | `lib/optimizer/*` | "Missing requirements" chips + "Why you match" |
| Application Intelligence V2 | `lib/application-intelligence/*` | "Missing and risky/recoverable" + ATS |

Concrete failures (Target "Assets Protection Specialist", a retail loss‑prevention role):
- **AWS** matched the substring inside "l·**aws**" (unanchored regex).
- **REST APIs** / **Go** matched the ordinary words "rest" / "go".
- **tgt.biz/BenefitsForYou_C** (a benefit URL) split into fake requirements "tgt biz" / "benefitsforyou_c".
- Raw sentences ("All other duties based on business needs") were promoted to requirements.
- A **tech dictionary ran against a retail job** even though the codebase already had a role/domain detector — the extractors just never called it.

There was **no shared sanitization**, **no shared concept of a legitimate requirement**, and **three competing sources of truth**.

## 2. Immediate fixes (Phase 0 — shipped first, independently)

Repaired the three live engines and locked the failure class with a permanent regression (`lib/application-intelligence/targetRegression.test.mjs`, the real Target JD through all three engines):
- **Domain-gated** the tech/clinical dictionaries behind `detectRoleFamily` in `jobInsights.js` and `extractJobFacts.js` — a retail/security/warehouse role never evaluates AWS/Kubernetes/Go.
- **Anchored** `aws`→`\baws\b`; REST now needs "api"/"restful"; Go needs golang/"go programming"; Excel/SAP anchored.
- **`jobParserV2`**: strip URLs/domains/emails before parsing; reject URL/underscore/id fragments, bare credential words, generic prose nouns, and generic‑verb‑led sentence tails.
- **Responsibilities excluded from "missing" buckets** (they're context sentences, not skill gaps).

Result: 717/717 tests, tsc clean, deployed green. Nothing ships broken while the rebuild lands.

## 3. Architecture — the Resume Intelligence Engine

One pipeline, one source of truth, under `lib/resume-intelligence/` (every layer pure + deterministic, no runtime fetch):

```
RAW JD ─▶ sanitize ─▶ sections ─▶ role/occupation ─▶ concept + open-vocab + structured
         extraction ─▶ taxonomy normalize ─▶ importance ─▶ JobProfile
RAW RÉSUMÉ ─▶ parse ─▶ sections/roles/bullets ─▶ evidence nodes ─▶ taxonomy ─▶ ResumeProfile
JobProfile + ResumeProfile ─▶ progressive match ─▶ evidence ─▶ gap analysis ─▶ score
                              ─▶ recommendations ─▶ MatchAnalysis  (the UI consumes this)
```

| Module | Responsibility |
|---|---|
| `sanitize.js` | ONE shared sanitizer: URLs, domains+paths, emails, EEO/legal/recruiting boilerplate, application CTAs, unicode, HTML, dedup. Records what it removed. |
| `taxonomyData.js` / `taxonomy.js` | Local occupational concept layer. **Aliases** (same concept) kept distinct from **related concepts** (broader/narrower/associated). `mergeTaxonomy()` folds a build‑time ESCO/O*NET index over the core with no code change. |
| `concepts.js` | Phrase‑first extraction (longest‑alias, span‑consuming) + a precise cue‑list open‑vocab extractor with generic‑word suppression. Ambiguous tokens (rest/react/go/aws) domain‑gated. |
| `structured.js` | The good deterministic extractors preserved: education, years, licenses/certs, physical, schedule, screening gates. |
| `jobProfile.js` | Canonical **JobProfile** with typed requirements. |
| `resumeProfile.js` | Canonical **ResumeProfile** (structured experiences + evidence + resolved concepts). |
| `semantic.js` | Local transferable‑evidence layer (indicator lexicon) + pluggable neural backend interface. |
| `match.js` | Progressive matcher + evidence engine + **fabrication firewall**. |
| `score.js` | Explainable composite score (7 named dimensions, point attribution). |
| `recommend.js` | Evidence‑bound recommendations. |
| `engine.js` (+ `engine.d.ts`) | Orchestrator → **MatchAnalysis** + debug mode. |

## 4. Canonical source of truth

`analyzeApplication()` returns **one `MatchAnalysis`**. The UI (`app/resume/page.tsx` Deep Dive → `MatchAnalysisPanel.tsx`) consumes that single object instead of three keyword arrays. The three legacy engines still run behind it (Phase 0 de‑garbaged them) and are attached for backward compatibility; retiring them fully is the remaining migration step (§19).

## 5. Files

**Added:** `lib/resume-intelligence/{sanitize,taxonomy,taxonomyData,concepts,structured,jobProfile,resumeProfile,semantic,match,score,recommend,engine}.js`, `engine.d.ts`, `engine.test.mjs`; `components/optimizer/MatchAnalysisPanel.tsx`; `lib/application-intelligence/targetRegression.test.mjs`; this report.
**Modified (Phase 0):** `lib/server/jobInsights.js`, `lib/optimizer/extractJobFacts.js`, `lib/application-intelligence/jobParserV2.js`, `lib/application-intelligence/transferabilityEngine.js`.
**Modified (wiring):** `api/optimizer.js`, `app/resume/page.tsx`.
**Removed:** none yet (legacy engines retired after full UI migration).

## 6/7. Open source — inspected, used, licensing

See the **Decision Table** below. Every project's source was read (not just its README); nothing GPL/AGPL was copied.

## 8. Taxonomy (ESCO / O*NET / Seen)

The concept layer is **ESCO‑structured** (preferredLabel + altLabels as aliases; broader/narrower/associated as related). The shipped core is hand‑authored covering the tested domains, sourced structurally from ESCO and O*NET (both **CC BY 4.0**). `mergeTaxonomy()` is the documented hook to fold a **build‑time pruned ESCO/O*NET index** (~5 MB raw / <1 MB gzipped: skill labels + altLabels + broader relations from ESCO; the O*NET 55k alternate‑titles crosswalk + technology‑skills for title→occupation) over the core without touching runtime. That bulk import is a data‑pipeline step, not run this session (the datasets are egress‑blocked here and the pyresparser/EMSI data are non‑redistributable — see table).

## 9. Local semantic model — decision

**No neural model is bundled.** Research verdict: `onnxruntime-node` alone unpacks to 210–258 MB and **blows Vercel's 250 MB function limit before the model loads**. For short skill‑phrase ↔ evidence‑sentence matching, a curated **indicator lexicon** handles the cited transferable cases at 0 KB / 0 cold‑start and is fully explainable ("matched on: supervised, trained"). The neural path is designed behind `setSemanticBackend()` for an **optional** upgrade that must run **off the Vercel function** — Supabase Edge's built‑in `gte-small` (free, MIT, `Supabase.ai.Session`) or browser Transformers.js `all-MiniLM-L6-v2` q8 (~23 MB, IndexedDB‑cached). It adds long‑tail recall; it is not required for correctness.

## 10. Semantic status

**Transferable matching is fully operational, deterministically** (indicator lexicon in `semantic.js`, exercised by fixtures 2 and 9). The **neural embedding tier is interface‑complete but not wired to a backend** this session (deliberate — it belongs on Supabase Edge / the browser, not the Vercel function). `MatchAnalysis.semantic_backend` reports `deterministic` until a backend registers.

## 11. Evidence engine

Every match carries the résumé span that proves it and a plain‑English explanation, tagged with a tier: `EXACT_MATCH · ALIAS_MATCH · TAXONOMY_MATCH · TRANSFERABLE_MATCH · SEMANTIC_MATCH · PARTIAL_MATCH · WEAK_EVIDENCE · MISSING`. Nothing is asserted without a span behind it.

## 12. Fabrication protection

The **fabrication firewall** in `match.js`: a credential, license, degree, or hard eligibility gate can be satisfied **only** by an exact/alias match — taxonomy/transferable/semantic evidence is refused. Warehouse work never implies a forklift cert; similar duties never imply a CDL. Missing ones stay `MISSING`, flagged `mustNotInvent`, and recommendations never suggest claiming them. Basic gates (18+, HS diploma, work auth) are recoverable, not fatal. Years are `PARTIAL` when under the bar — never inflated. (Fixtures 6 and 10 lock this.)

## 13. Scoring

Explainable composite (weights sum to 1): critical‑requirement coverage (0.30), requirement coverage (0.20), skill alignment (0.15), experience relevance (0.12), evidence strength (0.10), terminology alignment (0.08), ATS parseability (0.05). Each dimension self‑explains with point attribution. It never claims to guarantee any employer's real ATS outcome.

## 14. Target regression — what the problem JD produces now

Requirements: **Customer Service, De‑escalation, Surveillance, Asset Protection, High‑school diploma, Must be 18+** — and **zero** of AWS / REST APIs / Go / tgt biz / benefitsforyou_c / "all other duties" / licensure. Role detected as non‑technical, so the tech dictionary is gated off. Locked by `targetRegression.test.mjs` (5 assertions across all three legacy engines) **and** fixture 1 in `engine.test.mjs` (canonical engine).

## 15/16. Cross-industry results — test suite

`node --test lib/resume-intelligence/engine.test.mjs` — **12/12 pass**:

1. Target asset protection — clean, on‑domain, no phantom tech/URL/sentence junk ✓
2. Warehouse — WMS alias resolves; "supervised and trained associates" → team leadership (transferable) ✓
3. Software — tech enabled; **Next.js → React**, **GitHub Actions → CI/CD**, REST recognized, "rest" not confused ✓
4. Sales — **Salesforce → CRM**; pipeline recognized from evidence ✓
5. Healthcare — HIPAA/EMR/patient intake; no tech pollution ✓
6. Missing CDL — `MISSING`, `mustNotInvent`, never matched ✓
7. Generic words — experience/ability/team/work never become requirements ✓
8. Phrase preservation — "project management" stays one concept, "management" alone doesn't ✓
9. Transferable leadership — "trained new hires… led shift meetings" → team leadership with cited evidence ✓
10. Fabrication protection — warehouse experience never implies a forklift cert ✓
11. No external AI (static scan) ✓ · 12. Determinism ✓

Full project suite: **729/729**, `tsc --noEmit` clean.

## 17. Performance

Pure string/regex/dictionary + math. Taxonomy indexes build once per process; matching is cheapest‑tier‑first (stops at the first tier that fires). No model load, no network, single‑digit‑ms per analysis. Vercel‑safe (no heavy dependency, no cold‑start model).

## 18. Deployment

Runs in the existing Vercel Node serverless runtime with no new runtime dependency. The optional neural tier is designed to run on Supabase Edge or the browser (never bundled into the Vercel function). No new env var required; `?debug=1` returns the explainability dump.

## 19. Remaining limitations

- Neural embedding tier is interface‑only (deterministic transferable matching is live).
- Bulk ESCO/O*NET index is not imported (hand‑authored core covers tested domains; `mergeTaxonomy()` is the hook).
- The three legacy engines still run behind the canonical analysis; not yet deleted.
- Only the résumé Deep Dive consumes the canonical analysis; job pages/drawers still use the (de‑garbaged) legacy panels.
- Role‑family detection can mislabel an asset‑protection role as customer_service (the "support" verb collides with the CSR title token) — non‑tech either way, so the fix holds; the ontology weighting is a follow‑up.

## 20. Next steps

1. Register a Supabase Edge `gte-small` backend via `setSemanticBackend()` for long‑tail semantic recall.
2. Build the ESCO/O*NET prune‑and‑index script; load it through `mergeTaxonomy()`.
3. Migrate job pages/drawers to the canonical analysis, then delete the three legacy engines.
4. Sharpen `roleOntology` title weighting (don't let the verb "support" score the CSR title).

## 21. OPEN-SOURCE COMPONENT DECISION TABLE

| Project / source | Component examined | Decision | Why | License | Seen files affected |
|---|---|---|---|---|---|
| **OpenResume** (xitanggg/open-resume) | `parse-resume-from-pdf/*` — pdf.js text items, line grouping, section detection, **feature-scoring** profile/experience extraction | **REJECTED (code) / not adopted** | Its quality relies on PDF **geometry** (x/y/font) that Seen's flat‑text extractor discards; and it is **AGPL‑3.0** — vendoring it into a hosted app forces the whole service to AGPL. The portable idea (competitive feature‑scoring for profile fields) is noted for a future clean‑room port if Seen ever preserves token geometry. | AGPL‑3.0 | none |
| **Resume-Matcher** (srbhr/Resume-Matcher) | `ats.py` composite score, `refiner.py` keyword coverage + `analyze_keyword_gaps` (injectable vs non‑injectable); old tag's TF‑IDF/FastEmbed | **ADAPTED (algorithm)** | Apache‑2.0, permissive. Ported the **ATS composite shape** (re‑weighted for critical coverage), **word‑boundary keyword coverage** with the "0% not 100% on empty" honesty guard, and the **injectable/non‑injectable gap** idea (missing‑but‑evidenced vs would‑be‑fabrication). Rejected its current LLM keyword extraction + résumé rewriting and the FastEmbed/Qdrant Python stack. | Apache‑2.0 | `score.js`, `recommend.js` |
| **SkillNER** (AnasAito/SkillNER) | `skill_extractor_class.py` full/abbrev/ngram matching against a skill DB | **PORTED (methodology, MIT)** | Its method — tokenize → longest‑phrase match against a concept KB → coverage, no spaCy needed — is exactly Seen's `concepts.js` (span‑consuming longest‑alias match + open‑vocab). Clean‑room, own code. | MIT (code) | `concepts.js` |
| **EMSI/Lightcast Open Skills** (SkillNER's data) | `skill_db_relax_20.json` (31k skills) | **REJECTED (data)** | Lightcast Open Skills terms are **non‑sublicensable / non‑transferable** — bundling the JSON into a shipped app is arguably redistribution it doesn't grant. Used ESCO instead. | Lightcast Open Skills | none |
| **ESCO** (European Skills/Competences/Occupations) | `skills_en.csv` (altLabels=aliases), `broaderRelationsSkillPillar`, `skillSkillRelations`, `occupationSkillRelations` | **USED (structure) / ADAPTED (data shape)** | **CC BY 4.0** — redistributable commercially with attribution. The taxonomy is ESCO‑shaped (aliases vs broader/narrower/associated) and `mergeTaxonomy()` loads a pruned ESCO index at build time. Core hand‑authored this session; bulk import is the documented next step. | CC BY 4.0 | `taxonomy.js`, `taxonomyData.js` |
| **ESCOXLM-R** (mainlp/escoxlmr) | XLM‑RoBERTa‑large ESCO model | **REJECTED** | 550M params / 2.24 GB — infeasible on Vercel serverless (over the 250 MB limit even INT8). Off‑Vercel only; not needed for this matcher. | — (model) | none |
| **O*NET** (US DOL) | Alternate Titles (55k title→occupation), Technology Skills (32k occupation→tech) | **USED (structure) / import staged** | **CC BY 4.0** (attribution + "O*NET" as adjective). Complements ESCO: O*NET brings the messy‑title→occupation crosswalk + concrete tech; ESCO brings skill aliases + hierarchy. Same `mergeTaxonomy()` hook; bulk import staged. | CC BY 4.0 | `taxonomy.js` (hook) |
| **pyresparser** (OmkarPathak/pyresparser) | regex email/phone, CSV skill set‑membership, section‑header split, degree+year regex, month‑range experience | **PORTED (techniques only)** | **GPL‑3.0 — code and `skills.csv` NOT copied** (would force Seen to GPL, and Seen ships JS to the browser). Reimplemented the *techniques* independently: structured extractors (education/years/certs/screening) in `structured.js` and cue‑list skill extraction in `concepts.js`. | GPL‑3.0 (avoided) | `structured.js`, `concepts.js` (ideas only) |
| **Local semantic runtime** (Transformers.js / onnxruntime / small embedders) | all‑MiniLM‑L6‑v2, bge‑small, gte‑small; onnxruntime‑node/web | **REJECTED on Vercel function / interface for off‑Vercel** | `onnxruntime-node` (210–258 MB) exceeds the 250 MB function limit. Deterministic indicator lexicon covers the cases at 0 KB. Neural tier is interface‑ready (`setSemanticBackend`) for Supabase Edge `gte-small` (MIT) or browser MiniLM (Apache‑2.0). | Apache‑2.0 / MIT | `semantic.js` (interface) |

## Attribution

This engine's scoring/gap approach is adapted from **srbhr/Resume‑Matcher** (Apache‑2.0); its extraction methodology from **SkillNER** (MIT); and its occupational taxonomy is structured from **ESCO** (© European Union, CC BY 4.0) and **O*NET** (U.S. Department of Labor / ETA, CC BY 4.0, O*NET® is a registered trademark of USDOL/ETA). No AGPL (OpenResume) or GPL (pyresparser) code, and no non‑sublicensable data (Lightcast Open Skills), was incorporated.
