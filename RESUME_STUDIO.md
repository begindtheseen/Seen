# Résumé Studio — architecture, contracts, verification

Shipped 2026-10-19 on `claude/resume-handling-optimization-ywotv9`. This is the reference for the
résumé pipeline that replaced the regex-only text handling: **extract → structure → score → fix →
tailor → render → check**. Every stage is deterministic and keyless. No model API is called anywhere
(owner decision 2026-10-26: the optional "AI polish" pass and `lib/server/llm.js` were removed).

## Map

| Stage | Module | What it does |
| --- | --- | --- |
| Model | `lib/resume/model.js` | `ResumeDoc` (JSON-Resume-compatible superset): basics, experience, education, skills groups, certifications, projects, languages, extra sections, `sectionOrder`, `meta` (source, warnings, confidence, layout, tailoredFor, provenance). `normalizeDoc()` coerces any input; `serializeToText()` is the **lossless canonical text** that lives in `profiles.resume_text` (no schema change). |
| Extract | `lib/resume/extract/{pdf,docx,index}.js` | Layout-aware PDF via pdfjs-dist legacy build (runs, baseline line grouping, bold/italic from font names, column gutter detection with left-alignment guard, band reading order, link annotations) with `lib/server/pdfText.js` as fallback; structured DOCX (styles → headings, `numPr` → bullets, tabs, tables, header parts, `mc:Fallback` de-dupe); plain text. Same readability gates as before. |
| Parse | `lib/resume/parse/*` | Rich lines → doc: section vocabulary + typography, date grammar (`YYYY-MM`/`YYYY`/`present` tokens, seasons, quarters, 'YY), role segmentation with non-destructive header folding, document-level orientation vote, packed roles, known-city gazetteer, UK-style trailing-role titles, single-date pieces, parked-unknown slot occupancy. `PARSER_VERSION = resume_parser_v2`. |
| Health | `lib/resume/health/*` | Job-independent score (100 pts: Impact 35 · Language 15 · Structure 15 · Timeline 10 · Length 10 · Parseability 15), bands/grades, every finding anchored `{section,itemId,bulletId}` with a fix: `rewrite` (text), `verbs` (options), `prompt` (text). |
| Rewrite | `lib/resume/rewrite/*` | Rules R1–R9 (pronouns, weak leads, hidden verbs, passive, filler, doublets, tense, hygiene) with per-change provenance and `passesFirewall(original, rewritten, allowed)`: no new numbers, proper nouns or content words (lemma-aware; hyphen compounds license their parts; number words may become digits). |
| Tailor (v2) | `lib/resume/tailor/*` | `tailorResume(doc, job)` → `{ plan, variant }`. **The optimizer** (see the section below): `competencies.js` (what a job *is* — the competency vector a title/employer/posting implies), `relevance.js` (per-role fit), `optimizer.js` (keep / trim / condense / drop decisions, bullet selection inside a page budget, transferable fill flagged for confirmation, prompts for missing facts, targeted summary, layout, objective search; `applyPlan` is the ONE apply path used by the server and the browser). Around it: keyword layer (`extractJobKeywords`: one keyword per taxonomy concept with all aliases as surfaces, containment-merged), skills reorder + **résumé-own-surface** additions as plan data, terminology proposals (applied only on request), honest gaps with `likely_covered` downgrade, before/after scores from `lib/resume-intelligence`. |
| Render | `lib/resume/render/*` | PDF (pdfkit; templates `classic`/`engineering`/`modern`; text "•" bullets; measured keep-together; dates flush right on the same baseline; built-in Times/Helvetica or embedded Liberation Sans (OFL, from pdfjs-dist) — automatic for non-WinAnsi text; links; metadata; page numbers on 2+ pages; **no characterSpacing anywhere**), DOCX (`docx` 9.12: Heading 1 styles, `numPr` bullets, `<w:tab/>` to a right tab stop, hyperlinks, properties), TXT (ASCII, one role header per line, no wrapping), Markdown, JSON Resume (`toJsonResume`/`fromJsonResume`, lossless via `x-seen`). `renderResume()` is the one entry; the free-tier brand line vs Pro-unbranded rule lives there. |
| ATS check | `lib/resume/render/atsCheck.js` | Render → extract → parse → compare: contact, sections, every role's title/company/dates, bullets, skills, education, certifications, word fidelity, letter-spacing, columns, pages. Score 0–100 with weighted checks. |
| Server | `lib/server/resumeStudio.js`, `api/resume.js` | Actions `structure`, `health`, `rewrite`, `ats_check`, `templates` (free, rate key `resume-studio`), `export` (free with brand line / Pro unbranded, `resume-export`), `tailor` (1 credit via `gateAI('resume_tailor')`; deterministic — a `polish` body field is ignored and no `polish` result is returned). `parse` now also returns `doc`, `health`, `coverage`, `layout`, `warnings`. `download_resume` / `email_analysis` render through the structured renderer (legacy Harvard builder kept as the fallback and still exported as `buildResumePDF`). |
| Client | `app/resume/studio/page.tsx`, `components/resume/*`, `lib/resume/engine-client.ts`, `lib/stores/ResumeDocStore.ts` | Parse/score/rewrite run **in the browser** (the pure modules import no Node built-ins); rendering, tailoring and the ATS check call the API. Base résumé autosaves as canonical text through `ResumeStore` (DB for signed-in users); the server's layout-aware doc from an upload is cached per user keyed by text hash; tailored variants are device-local per user and swept on sign-out (`lib/auth.tsx`). |

## Contracts worth knowing

- **Canonical text is the store.** `serializeToText(parseResume(text))` is stable; every fixture
  round-trips through text, JSON Resume, PDF and DOCX with the parser reading back exactly what
  was written (`lib/resume/render/render.test.mjs`, "ats check" case: 100/100 on every fixture ×
  format × template).
- **Tokens:** dates are `'YYYY-MM' | 'YYYY' | 'present' | ''`; `dateText` keeps the author's
  wording ("Summer 2017") and is preferred by renderers when there is no end token.
- **Credits/Pro (locked):** parse = 1 credit (unchanged), tailor = 1 credit, exports
  free with the "Optimized with Seen · seenjobs.io" line and unbranded for Pro; structure / health /
  rewrite / ATS check are free (CPU only, rate-limited).
- **Fabrication firewall** guards every text-producing path: rewrites, the tailored summary, skill
  additions (résumé-own surfaces only).
- **Vercel:** `vercel.json` adds `includeFiles: node_modules/pdfjs-dist/**` to `api/resume.js`
  and `api/apply.js` (the worker, standard fonts and CMaps are loaded by path/URL, not traced).
- **One apply path.** The tailor plan is fully serialisable and self-sufficient: every decision
  carries its ranked bullets and implied competencies, the skills edits are data on the plan, and
  the summary context (replace?, v1 fallback, keywords the old summary carried) rides in `plan.ctx`.
  `applyPlan(base, JSON.parse(JSON.stringify(plan)), overrides)` in the browser reproduces the
  server's variant byte for byte (`optimizer.test.mjs` "wire contract", five cases) — so overrides
  in the Studio are instant and free, and what the user sees is what the server built.

## Tailor v2 — the optimizer (`lib/resume/tailor/optimizer.js`)

The owner's failure case that drove this: tailoring a résumé for a GNC Sales Associate posting kept
*Valet Attendant* and dropped *Membership Specialist – UFC Gym* because the old engine only scored
bullet keywords and that role had no bullets. v2 decides from what each job **is**.

1. **Competency model** (`competencies.js`). A job posting → a demand vector over ~80 labelled
   competencies (sales, customer service, point of sale, vehicle handling, …) from the posting's
   terms (`TERMS` lexicon) plus what its role family implies (`FAMILY_IMPLIED`, built on
   `lib/application-intelligence/roleOntology.js`). A résumé role → a supply vector from its
   bullets (evidenced, weight 1.0) **and** from its title/employer (`TITLE_IMPLIED`,
   `COMPANY_HINTS`: "Membership Specialist" ⇒ membership sales, "Team Member @ Chipotle" ⇒ food
   service; implied, weight 0.8). `coverage(job, role)` = demand-weighted share of the job's
   competencies the role covers; `familyAlignment` = same field 1 / same cluster 0.6 / other 0.15.
2. **Relevance** (`relevance.js`): `0.60·coverage + 0.25·alignment + 0.15·keyword`. Recency and
   tenure are reported separately — they decide whether a role may *leave the page*, never whether
   it is relevant (this is exactly what kept Valet ahead of Membership Specialist before).
3. **Decisions** (`buildPlan`): tiers relative to the best role (core / supporting / context / omit)
   → default decision keep / trim / condense / drop, under constraints (never drop a current role,
   never open a recent gap, keep ≥ 2 roles). Bullets inside a kept role are ranked by competency ×
   keyword × metric and selected into a per-tier budget with a redundancy (Jaccard) check.
4. **Honest fill + prompts.** A core/supporting role with < 2 bullets gets up to two bullets
   written from what that role *inherently* involves (`TRANSFER` templates, specific competency
   before generic, e.g. "Sold and renewed memberships …" before "Handled sales conversations …"),
   each flagged `confirm: true` with a "Not true for me — remove" control — never a number, never
   a claim from the posting. Missing dates and the family's headline metric (quota attainment,
   members signed, …) become prompts; an answer becomes a dated role or a bullet in the user's
   words (`bulletFromAnswer`).
5. **Targeted summary** (`composeTargetedSummary`): lead phrase for the job's cluster + the two
   top kept roles + three strengths the kept roles imply + one real metric clause, passed through
   the fabrication firewall; falls back to the v1 fact composer; sentences of the old summary that
   alone carried a posting keyword are kept verbatim.
6. **Layout.** When the most relevant role is not the most recent, the page becomes *Relevant
   Experience* (core/supporting roles, relevance order) + *Additional Experience* (every other
   kept role as one line, so continuity stays visible); otherwise reverse-chronological. Section
   titles live in `meta.sectionTitles`; the ATS round-trip reads them back.
7. **Objective search.** `total = 0.40·match + 0.15·keywordCoverage + 0.15·health +
   0.15·relevanceDensity + 0.10·lengthFit + 0.05·completeness − penalty` (a current role missing
   from the page costs 0.3). Two seeds (tiered defaults, keep-everything) → page-budget pass →
   hill-climb promoting/demoting one role at a time, ≤ 60 evaluations, deterministic, ~200 ms.
8. **Everything is explained and overridable.** Each decision carries its tier, relevance,
   reasons, shared competencies (✓ when evidenced) and ranked bullets; the Studio re-applies the
   plan locally with the user's overrides (decisions, layout, fill, summary, skills, answers).

Acceptance (owner's résumé shape vs GNC, `optimizer.test.mjs`): Membership Specialist leads as
core/keep with membership-sales + customer-service lines to confirm, Chipotle is core with a POS
line, Valet is trimmed to 3 bullets (supporting), the current Automotive Technician role is a line
under Additional Experience (never dropped), the summary names Membership Specialist at UFC Gym
and not GNC, objective 0.646 → 0.700 in 10 evaluations; the same-field electrician case stays
chronological with nothing dropped and nothing added.

## Verification record (2026-10-19, Tailor v2 + CodeQL pass)

- `node --test`: tailor 13 · **optimizer 9** (competencies, relevance, GNC acceptance, overrides,
  electrician regression, determinism/speed, ATS round-trip of the tailored variant ≥ 90,
  no-experience case, five-case wire contract) · parse 16 · extract 7 · render 10 · rewrite 10 ·
  resumeUpload 11 · resume.studio 6 · ratelimit 6. Full `npm test`: 1302/1310 — the 8 failures are
  `api/brain.timeline.test.mjs` (need the live brain; identical on the base commit).
- Server→wire→browser probe (`tailorAction` → JSON → `applyPlan`): no `Map` on the wire, 50 kB
  plan, client re-apply equals the server variant, overrides apply after the round trip.
- CodeQL on the PR head flagged 16 alerts in code this PR touched; all fixed at the class:
  ids from the platform CSPRNG (`newId`, no `Math.random` in the résumé code), one-pass XML entity
  decoding (docx extractor + legacy `.docx` reader), host-based link classification
  (`urlHost`/`hostIs`, no URL substring checks), a linear credential-suffix regex, Markdown escaping
  of backslashes, constant format strings + newline-free values in the rate-limiter logs, URL host
  comparison in the smoke harness, and three unused symbols removed. Pre-existing same-pattern
  entity decoding in `lib/server/listingImport.js` and `api/reports.js` is left for its own PR.
  Second CodeQL round on the pushed head (9 alerts): the legacy `.docx` reader takes each `<w:t>`
  run's captured text instead of stripping tags, the rate-limiter sanitizer removes newlines as
  the `/\n|\r/g` alternation CodeQL recognises, the optimizer's search loop keeps no dead
  `variant` variable, and three more unused imports are gone.
- `npx tsc --noEmit` clean; `npm run build` clean (`/resume/studio` 84.9 kB, 258 kB first load).
- Runtime: `scripts/resume-studio-smoke.mjs` against the final production build in headless Chromium —
  paste → structure (70) → fix-all (73) → live metric edit (79) → ATS check A → PDF (4564 B,
  `application/pdf`) and DOCX downloads → signed-out "Optimize for this job" redirects to
  `/login?next=/resume/studio?tab=tailor` → 390 px without horizontal overflow → zero page errors,
  every API call 200.
- Not verified live: a signed-in `tailor` call against production Supabase, Vercel's `includeFiles`
  tracing on an actual deployment (see the first-landing record).

## Verification record (2026-10-19, first landing)

- Unit/contract tests: `node --test` on `lib/resume/**/*.test.mjs` (extract 7, parse 16, rewrite
  10, health 7, tailor 13, render 10), `lib/resume-intelligence/engine.test.mjs` (13),
  `lib/server/resumeAnalysis.test.mjs` (306 legacy assertions), `lib/server/resumeUpload.test.mjs`
  (11), `api/resume.pdf.test.mjs` (4), `api/resume.studio.test.mjs` (6). Full `npm test`:
  1293/1301 — the 8 failures are `api/brain.timeline.test.mjs` (need the live brain; identical on
  the base commit).
- `npx tsc --noEmit` clean; `npm run build` clean (`/resume/studio` 63.8 kB, 237 kB first load).
- Runtime: `scripts/resume-studio-smoke.mjs` against the production build in headless Chromium —
  paste → structure (70) → fix-all (73) → live metric edit (79) → ATS check A → PDF (`%PDF-`,
  `application/pdf`, RFC 5987 filename) and DOCX downloads → signed-out tailoring redirects to
  `/login?next=` → 390 px layout without horizontal overflow; zero page errors.
- Not verified live: a signed-in `tailor` call against production Supabase (credit deduction path
  exercised only through `gateAI` unit paths), the LLM polish with a real provider (no key in the
  build container), Vercel's `includeFiles` tracing on an actual deployment (verify the first
  production parse of a PDF after deploy: `layout.method` should be `pdfjs`, not `legacy`).

## Dev helpers

- `node lib/resume/fixtures/dumpParse.mjs <file>` — extract + parse any PDF/DOCX/TXT and print the doc.
- `node lib/resume/fixtures/dumpPdf.mjs <file.pdf>` — print the extractor's rich lines with geometry.
- `node lib/resume/fixtures/makePdfFixtures.mjs` — regenerate the checked-in PDF fixtures.
- `node scripts/resume-studio-smoke.mjs` — the end-to-end browser smoke test (needs `next start`).

## Follow-ups (not in this PR)

- Server-side variant persistence (a `resume_documents` table) if cross-device tailored versions
  are wanted; today variants are device-local by design (no schema change, deploy-order-safe).
- A fourth template with a subtle two-tone header, once the ATS round-trip proves it.
- Ask the owner whether the `/resume` Export tab should default to the Studio flow entirely.
