# Résumé Studio — architecture, contracts, verification

Shipped 2026-10-19 on `claude/resume-handling-optimization-ywotv9`. This is the reference for the
résumé pipeline that replaced the regex-only text handling: **extract → structure → score → fix →
tailor → render → check**. Every stage is deterministic and keyless unless stated; the one optional
LLM step runs behind `lib/server/llm.js` and the fabrication firewall.

## Map

| Stage | Module | What it does |
| --- | --- | --- |
| Model | `lib/resume/model.js` | `ResumeDoc` (JSON-Resume-compatible superset): basics, experience, education, skills groups, certifications, projects, languages, extra sections, `sectionOrder`, `meta` (source, warnings, confidence, layout, tailoredFor, provenance). `normalizeDoc()` coerces any input; `serializeToText()` is the **lossless canonical text** that lives in `profiles.resume_text` (no schema change). |
| Extract | `lib/resume/extract/{pdf,docx,index}.js` | Layout-aware PDF via pdfjs-dist legacy build (runs, baseline line grouping, bold/italic from font names, column gutter detection with left-alignment guard, band reading order, link annotations) with `lib/server/pdfText.js` as fallback; structured DOCX (styles → headings, `numPr` → bullets, tabs, tables, header parts, `mc:Fallback` de-dupe); plain text. Same readability gates as before. |
| Parse | `lib/resume/parse/*` | Rich lines → doc: section vocabulary + typography, date grammar (`YYYY-MM`/`YYYY`/`present` tokens, seasons, quarters, 'YY), role segmentation with non-destructive header folding, document-level orientation vote, packed roles, known-city gazetteer, UK-style trailing-role titles, single-date pieces, parked-unknown slot occupancy. `PARSER_VERSION = resume_parser_v2`. |
| Health | `lib/resume/health/*` | Job-independent score (100 pts: Impact 35 · Language 15 · Structure 15 · Timeline 10 · Length 10 · Parseability 15), bands/grades, every finding anchored `{section,itemId,bulletId}` with a fix: `rewrite` (text), `verbs` (options), `prompt` (text). |
| Rewrite | `lib/resume/rewrite/*` | Rules R1–R9 (pronouns, weak leads, hidden verbs, passive, filler, doublets, tense, hygiene) with per-change provenance and `passesFirewall(original, rewritten, allowed)`: no new numbers, proper nouns or content words (lemma-aware; hyphen compounds license their parts; number words may become digits). |
| Tailor | `lib/resume/tailor/*` | `tailorResume(doc, job)` → `{ plan, variant }`: keyword layer (`extractJobKeywords`: one keyword per taxonomy concept with all aliases as surfaces + listed skills + ranked terms, containment-merged), bullet relevance + stable reorder, skills reorder + **résumé-own-surface** additions (deduped by containment), terminology proposals (applied only on request), fact-only summary (title + date-derived years + strengths in the résumé's own casing + strongest metric clause; never loses a keyword only the old summary carried), honest gaps with `likely_covered` downgrade, before/after scores from `lib/resume-intelligence`. `polish.js` = optional LLM pass, strict JSON patch, firewall + style gate, `{available:false}` without a provider. |
| Render | `lib/resume/render/*` | PDF (pdfkit; templates `classic`/`engineering`/`modern`; text "•" bullets; measured keep-together; dates flush right on the same baseline; built-in Times/Helvetica or embedded Liberation Sans (OFL, from pdfjs-dist) — automatic for non-WinAnsi text; links; metadata; page numbers on 2+ pages; **no characterSpacing anywhere**), DOCX (`docx` 9.12: Heading 1 styles, `numPr` bullets, `<w:tab/>` to a right tab stop, hyperlinks, properties), TXT (ASCII, one role header per line, no wrapping), Markdown, JSON Resume (`toJsonResume`/`fromJsonResume`, lossless via `x-seen`). `renderResume()` is the one entry; the free-tier brand line vs Pro-unbranded rule lives there. |
| ATS check | `lib/resume/render/atsCheck.js` | Render → extract → parse → compare: contact, sections, every role's title/company/dates, bullets, skills, education, certifications, word fidelity, letter-spacing, columns, pages. Score 0–100 with weighted checks. |
| Server | `lib/server/resumeStudio.js`, `api/resume.js` | Actions `structure`, `health`, `rewrite`, `ats_check`, `templates` (free, rate key `resume-studio`), `export` (free with brand line / Pro unbranded, `resume-export`), `tailor` (1 credit via `gateAI('resume_tailor')`; `polish` only for Pro and only when `llmAvailable()`). `parse` now also returns `doc`, `health`, `coverage`, `layout`, `warnings`. `download_resume` / `email_analysis` render through the structured renderer (legacy Harvard builder kept as the fallback and still exported as `buildResumePDF`). |
| Client | `app/resume/studio/page.tsx`, `components/resume/*`, `lib/resume/engine-client.ts`, `lib/stores/ResumeDocStore.ts` | Parse/score/rewrite run **in the browser** (the pure modules import no Node built-ins); rendering, tailoring and the ATS check call the API. Base résumé autosaves as canonical text through `ResumeStore` (DB for signed-in users); the server's layout-aware doc from an upload is cached per user keyed by text hash; tailored variants are device-local per user and swept on sign-out (`lib/auth.tsx`). |

## Contracts worth knowing

- **Canonical text is the store.** `serializeToText(parseResume(text))` is stable; every fixture
  round-trips through text, JSON Resume, PDF and DOCX with the parser reading back exactly what
  was written (`lib/resume/render/render.test.mjs`, "ats check" case: 100/100 on every fixture ×
  format × template).
- **Tokens:** dates are `'YYYY-MM' | 'YYYY' | 'present' | ''`; `dateText` keeps the author's
  wording ("Summer 2017") and is preferred by renderers when there is no end token.
- **Credits/Pro (locked):** parse = 1 credit (unchanged), tailor = 1 credit, polish = Pro, exports
  free with the "Optimized with Seen · seenjobs.io" line and unbranded for Pro; structure / health /
  rewrite / ATS check are free (CPU only, rate-limited).
- **Fabrication firewall** guards every text-producing path: rewrites, the tailored summary, skill
  additions (résumé-own surfaces only), and LLM polish (per-bullet, against the résumé + the
  evidenced keyword list).
- **Vercel:** `vercel.json` adds `includeFiles: node_modules/pdfjs-dist/**` to `api/resume.js`
  and `api/apply.js` (the worker, standard fonts and CMaps are loaded by path/URL, not traced).

## Verification record (2026-10-19)

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
