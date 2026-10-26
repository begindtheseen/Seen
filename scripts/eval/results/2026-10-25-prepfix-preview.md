# Seen Pro tools — evaluation scorecard (prepfix-preview, 2026-10-25)

Commit `fba2b29` · 15 fixtures · in-process handlers for the deterministic tools · live model calls on `https://seen-md34wxxzz-begindtheseens-projects.vercel.app` for interview_prep, tailor_polish.

## Inventory

| Tool | Model? | Cost | Path |
|---|---|---|---|
| parse | no | free | app/resume/page.tsx upload → api/resume.js action:parse → lib/server/resumeUpload.js → lib/resume/parse/index.js parseResume |
| parse_pdf | no | free | same as parse, from a hanging-indent PDF (lib/resume/extract/pdf.js) |
| fit | no | free | SeenFitPanel / ApplyOptimizeModal / résumé page → api/optimizer.js action:optimize → lib/optimizer/index.js runOptimizer → freeDiagnostic |
| optimize | no | 1 credit (Pro: free) | ApplyOptimizeModal, app/resume/page.tsx runPaid → api/resume.js tool:optimize (handleOptimizeTool) → lib/server/optimizePackage.js buildPaidOptimize |
| scanner | no | 1 credit | (no UI caller found) api/resume.js tool:scanner → lib/server/seenfitCompat.js scannerFromSeenFit |
| ats_check | no | free | components/resume/ExportPanel.tsx → api/resume.js action:ats_check → lib/resume/render/atsCheck.js |
| tailor | no | 1 credit (Pro: free) | components/resume/TailorPanel.tsx → api/resume.js action:tailor → lib/server/resumeStudio.js tailorAction → lib/resume/tailor/tailor.js |
| tailor_polish | YES | Pro only | TailorPanel polish toggle → action:tailor polish:true → lib/resume/tailor/polish.js polishBullets → lib/server/llm.js chat |
| export | no | free (Pro = no Seen line) | ExportPanel → api/resume.js action:export → lib/resume/render (PDF/DOCX); ApplyOptimizeModal → action:download_resume |
| insights | no | 1 credit on a cache miss | JobDetailDrawer / app/jobs/[id] "Reveal AI insights" → api/job-insights.js → lib/server/jobInsights.js buildJobInsights |
| advantage | no | 1 credit | app/resume/page.tsx runAdvantage → api/resume.js tool:advantage → lib/server/resumeAnalysis.js runAdvantage (buildCoach + buildProposal) |
| humanproof | no | Pro only (gateAI proOnly when humanproof_paid_only is on) | app/resume/page.tsx runHumanProof / ApplyOptimizeModal → api/optimizer.js action:humanize → lib/server/humanizePackage.js → lib/humanizer |
| interview_prep | YES | Pro / $9.99 Interview Prep | components/tracker/InterviewPrep.tsx → api/interview-prep.js action:build → lib/server/llm.js chat + lib/server/interviewPrep.js guardPack |
| interview_prep_fallback | no | Pro / $9.99 Interview Prep | api/interview-prep.js action:build when no model / model error → lib/server/interviewPrep.js fallbackPack |
| interview_prep_jobtext | YES | Pro | interview_prep with job_text (the API accepts it; the tracker never sends it) |

## Pass bar

0 invented facts · 0 traps · 0 wrong-field outputs · 0 broken-text outputs · 0 charges for nothing · round-trip 100% · mean expert grade ≥ 4 with no grade below 3.

| Tool | Model? | Ran | Clean records | Invented | Traps | Wrong field | Misread req. | Broken text | Charges | Parse | Round-trip | Mean grade (min) | p50 / max ms | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| interview_prep_fallback | no | 14/14 | 14/14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 2.43 (2) ⚠14 stale | 10 / 62 | FAIL — mean grade 2.43 < 4; a grade of 2 (< 3); 14 stale grade(s) — re-grade |
| interview_prep | YES | 14/14 | 12/14 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | — | 3.64 (3) ⚠14 stale | 14245 / 15496 | FAIL — 1 invented fact(s); 1 broken-text; mean grade 3.64 < 4; 14 stale grade(s) — re-grade |
| interview_prep_jobtext | YES | 14/14 | 9/14 | 5 | 1 | 0 | 0 | 0 | 0 | 0 | — | 3.57 (2) ⚠14 stale | 14586 / 16220 | FAIL — 5 invented fact(s); 1 trap(s); mean grade 3.57 < 4; a grade of 2 (< 3); 14 stale grade(s) — re-grade |

## Pass rate per check

| Check | Class | Records checked | Failing | Findings | Pass rate |
|---|---|---|---|---|---|
| invented_number | invented_fact | 42 | 1 | 2 | 97.6% |
| invented_org | invented_fact | 42 | 2 | 2 | 95.2% |
| invented_tool | invented_fact | 42 | 0 | 0 | 100% |
| invented_degree | invented_fact | 42 | 1 | 1 | 97.6% |
| invented_years | invented_fact | 42 | 1 | 1 | 97.6% |
| wrong_family | wrong_field | 42 | 0 | 0 | 100% |
| other_field_vocab | wrong_field | 28 | 0 | 0 | 100% |
| trap | trap | 42 | 1 | 1 | 97.6% |
| broken_text | broken_text | 42 | 1 | 1 | 97.6% |
| error | error | 42 | 0 | 0 | 100% |
| latency | latency | 42 | 0 | 0 | 100% |

## Defects, ranked (expert review + automatic checks)

1. **[invented_fact] The tailored summary makes up "N+ years of experience" by counting from the earliest job of any kind, and contradicts the résumé's own number** — tailor, optimize (summary); fixtures: 01, 02, 04, 06, 08, 09, 11, 12, 14, 15
   - `01-retail-manager`: “Customer-facing retail candidate with 12+ years of experience…  (her own summary: "9 years")”
   - `02-warehouse-lead`: “Hands-on warehouse candidate with 10+ years of experience… (his: "6 years"; counts a line-cook job)”
   - `08-marketing-coordinator`: “Dependable marketing candidate with 3+ years of experience (new grad: a 10-week internship plus part-time)”
   - `11-accountant`: “Dependable finance candidate with 10+ years of experience (his: "6 years")”
   - Root cause: lib/resume/tailor/optimizer.js:232 computes years = experienceSpanYears(base) (first start date of any role → today) and prints it at :256; lib/resume/tailor/tailor.js:102 does the same for the fallback summary.
   - Fix: Count only roles in the target family, never exceed a number the résumé states itself, and leave the number out when unsure.
2. **[invented_fact] Interview Prep's spoken intro and answers get tenure and employers wrong, and the guard can't catch it** — interview_prep (model); fixtures: 01, 02, 03, 05, 06, 07, 08
   - `01-retail-manager`: “the last three and a half [years] as an Assistant Store Manager at Desert Sun Apparel (dates: Apr 2021 – present = 5.5)”
   - `05-registered-nurse`: “almost four years of experience at St. Aurelia Medical Center (dates: Aug 2020 – present = 6.2)”
   - `06-backend-engineer`: “I'm a backend engineer with four years of experience (7 years)”
   - `07-data-analyst`: “At Twin Lakes, I was generating this Monday sales report manually… (that work was at North Loop Retail)”
   - `08-marketing-coordinator`: “I've spent the last couple years working in marketing at Coastal Coffee Roasters, where I managed their social media (a 10-week internship)”
   - `02-warehouse-lead`: “before that I worked my way up from Material Handler to Forklift Operator (one combined role)”
   - Root cause: lib/server/interviewPrep.js prepPrompt (:221) gives the model neither today's date nor per-role tenure, so it does date arithmetic itself. guardPack checks only digit tokens (NUM_RE :145, numbersBacked), so number words ("four", "sixty to seventy") pass, and nothing checks that a story is told about the employer of its resume_fact.
   - Fix: Put today's date and the computed tenure of each role in the prompt. Normalise number words before numbersBacked. Reject an answer that names a different employer from its resume_fact's role.
3. **[requirement_misread] False hard gates: degree holders are told "your résumé lists no degree" and an RN is told she has no RN license (score 35, Weak fit)** — fit, optimize, scanner; fixtures: 04, 05, 08, 11, 14
   - `08-marketing-coordinator`: “35 — Requires a Bachelor's degree; your résumé lists no degree (B.A., Communication, SDSU 2024)”
   - `11-accountant`: “35 — Requires a Bachelor's degree; your résumé lists no degree (B.B.A., Accounting)”
   - `05-registered-nurse`: “35 — Requires an RN license; your résumé does not list one ("Rebecca Thornton, BSN, RN"; "Registered Nurse, Colorado (multistate compact)")”
   - `04-customer-service`: “Requires a high school diploma; your résumé lists no degree (B.A., Communication)”
   - Root cause: lib/optimizer/extractResumeFacts.js:41 DEGREE_RE ends "b\.a\." with \b, which never matches before ",", a space or end of line, and it has no B.B.A. lib/optimizer/constraints.js:101 checks a certification with hasStemmed(text, "RN license") — a literal phrase with no synonyms.
   - Fix: End dotted degrees with (?=[\s,;)]|$) and add B.B.A./BSN. Match licenses by acronym and synonym (RN ⇐ "RN", "Registered Nurse"; Food Handler ⇐ "ServSafe Food Handler"; forklift certification ⇐ "Forklift / Reach Truck certification").
4. **[broken_text] The "filler" rewrite deletes "very" inside "every" and leaves a stray "e" in the person's best bullet** — tailor, optimize (rewrite plan); fixtures: 01, 02, 03, 09, 13, 14, 15
   - `03-cashier-entry`: “Balanced my drawer to within $1 every shift → Balance my drawer to within $1 e shift.”
   - `02-warehouse-lead`: “hit rate every week of the season → hit rate e week of the season.”
   - `09-sdr-sales`: “Keep every touch logged in Salesforce → Keep e touch logged in Salesforce”
   - `14-teacher`: “with every family → with e family”
   - Root cause: lib/resume/rewrite/rules.js:160-162 stripFillers: a filler with a trailing space ("very ") gets a lookahead but no leading word boundary, so it matches the end of "every".
   - Fix: Always prefix the pattern with (?<![A-Za-z-]). Add a regression test with "every".
5. **[broken_text] HumanProof / Human Voice breaks every message it touches and improves nothing** — humanproof; fixtures: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13
   - `01-retail-manager`: “…lines up directly with what the role calls for. → …with what the role calls.”
   - `02-warehouse-lead`: “Warehouse Shift Lead – 2nd Shift → Warehouse Shift Lead – nd Shift”
   - Root cause: lib/humanizer/humanizeBullet.js:57 tidy() strips any clause-final and|with|to|by|for even when nothing was removed. :89-93 stripUnsupportedClaims treats the "2" of the job title's "2nd" as an unsupported metric (the title is not in the evidence) and removes the bare digit with no word boundary. Also: the résumé page only offers HumanProof when the paid package has real bullets (app/resume/page.tsx:612), and 0 of 11 packages had any, so the UI path is mostly unreachable.
   - Fix: Run tidy only at removal sites. Treat the job title and company as evidence. Match metrics with \b…\b.
6. **[wrong_field] The strategy plan centres the job on company-blurb and non-skill words** — advantage (strategy / 30-60-90); fixtures: 01, 03, 06, 07, 08, 09, 10, 14, 15
   - `01-retail-manager`: “Take ownership of work centred on machine learning and assistant. / Deliver a result tied to machine learning”
   - `08-marketing-coordinator`: “Take ownership of work centred on clinics and patients. / The posting also leans on clinics and patients, which your résumé doesn't yet show”
   - `07-data-analyst`: “Take ownership of work centred on clinics and staffing.”
   - `14-teacher`: “The posting also leans on studies and social ("social studies" split in two)”
   - `03-cashier-entry`: “I'd bring my hands-on experience with customer service and hours”
   - `15-no-requirements`: “my hands-on experience with pay and charlotte”
   - Root cause: lib/server/resumeAnalysis.js:446 runAdvantage ranks single frequent words over the whole posting, About-us blurb included (rankKeywords); r1/r2/r3 and the gap list (gapCoach :679) come from that ranking. There are no sections and no skill dictionary.
   - Fix: Rank only the requirement and responsibility sections (reuse parseSections in lib/server/jobInsights.js) and only dictionary skills. Never use the employer's industry words (clinics, patients) as the candidate's work.
7. **[requirement_misread] The Studio tells candidates they are "fatally" missing credentials they hold, or that the posting does not require** — tailor (gaps); fixtures: 02, 05, 11, 12
   - `05-registered-nurse`: “RN license (REQUIRED, fatal); PALS (REQUIRED, fatal) — she is an RN; the posting says PALS is not needed”
   - `12-hvac-technician`: “EPA 608 certification (REQUIRED, fatal) — he holds EPA Section 608 Universal”
   - `11-accountant`: “CPA license (REQUIRED, fatal) — the posting says "CPA preferred"”
   - `02-warehouse-lead`: “CDL (REQUIRED, fatal) — CDL is in a sister company's posting”
   - Root cause: lib/resume/tailor/tailor.js:251-253 coveredByCert drops tokens shorter than 4 characters (RN, EPA, 608, CPA), so these credentials can never match. The level and "fatal" come from lib/application-intelligence/jobParserV2.js, which ignores "preferred", "does not need" and other-company context.
   - Fix: Match credentials by acronym and synonym. Honour preferred and negation. Read only requirement sections.
8. **[trap] Job insights lists requirements the posting rules out or that belong to another posting** — insights, tailor; fixtures: 02, 05
   - `05-registered-nurse`: “What they want: BLS \| ACLS \| PALS … ("Pediatric unit nurses also need PALS; this telemetry role does not.")”
   - `02-warehouse-lead`: “What they want: Excel \| Forklift \| CDL … ("Our sister company … is also hiring CDL-A drivers")”
   - Root cause: lib/server/jobInsights.js:629 extractCertifications(signalText): signalText includes the body/blurb, and there is no negation handling.
   - Fix: Read certifications from requirement sections only. Skip sentences with "does not", "not required" or "separate posting".
9. **[requirement_misread] Alternatives ("A, B, or similar") become separate hard requirements, and "similar" becomes a requirement** — tailor, insights, fit, scanner; fixtures: 02, 04, 06, 07, 08, 09, 11
   - `04-customer-service`: “gaps: freshdesk (REQUIRED, risky); servicenow (REQUIRED, risky) — she uses Zendesk, which the posting lists as one of the choices”
   - `07-data-analyst`: “gaps: power bi (REQUIRED) — she has Tableau ("Tableau or Power BI")”
   - `02-warehouse-lead`: “gaps: blue yonder (REQUIRED); similar (REQUIRED); email (REQUIRED)”
   - `08-marketing-coordinator`: “insights: Adobe Creative Suite ("Canva or Adobe Creative Suite"; she has Canva)”
   - `11-accountant`: “fit: missing sap (required) — "SAP, Oracle, or NetSuite"; he uses NetSuite”
   - Root cause: Tailor reads requirements through lib/application-intelligence/jobParserV2.js, which splits list items. lib/server/jobInsights.js extractSkills groups choices only within one clause. The fit check's anyOf grouping ("anyof:go|java|python") already works and is not reused.
   - Fix: One any-of parser shared by fit, tailor, insights and scanner. Drop "similar" and "etc." as requirement labels.
10. **[requirement_misread] Optimize refuses fully specified trade and teaching postings as "no requirements"** — optimize, fit; fixtures: 12, 14
   - `12-hvac-technician`: “422 no_requirements: "This listing states only 2 requirements" (4+ years, EPA 608 required, license, roofs/75 lbs, own tools)”
   - `14-teacher`: “No score; "missing: upselling (preferred)" for a 5th-grade teacher”
   - Root cause: lib/optimizer requirement extraction reads too few requirements for trades and education. lib/server/optimizePackage.js:45 unoptimizableListing withholds the score under 3 requirements. Certifications, licence, years and physical constraints don't count toward requirement_count.
   - Fix: Count constraints as requirements, and add trades and education vocabulary. Never surface "upselling" for a teacher.
11. **[charge] A credit is charged for nothing on a posting that states no requirements (only Optimize refuses correctly)** — insights, advantage, tailor, scanner; fixtures: 15
   - `15-no-requirements`: “insights: charged 1, what_they_want = [] and boilerplate tips”
   - `15-no-requirements`: “advantage: charged 1, "the priorities their posting repeats — here, pay, membership, university"”
   - `15-no-requirements`: “scanner: charged 1, match_score null”
   - `15-no-requirements`: “tailor: charged 1, and breaks "every shift" → "e shift"”
   - Root cause: api/job-insights.js:104 calls gateAI with no requirement check. api/resume.js:135 (scanner/advantage/coach/proposal) and :622 (Studio tailor) call gateAI before anything like unoptimizableListing.
   - Fix: Run lib/server/optimizePackage.js unoptimizableListing before gateAI on all four, and answer no_requirements, charged:false.
12. **[charge · high] Comped (admin-granted) Pro accounts are treated as free: Interview Prep 402, Studio tailor charged a credit, polish refused** — all credit gates (production); fixtures: eval account
   - `08-marketing-coordinator`: “POST /api/interview-prep build → 402 pro_required; action:tailor polish:true → polish {available:false, reason:"pro_required"} and balance 10 → 9; meanwhile user-sync get_credits answered pro:true”
   - Root cause: supabase/migrations/20261021120000_pacific_days_and_admin_counts.sql:40 `v_pro := v_row.pro OR (v_row.pro_until … > now())` ignores ai_credits.comped, which lib/server/creditRules.js:169 hasProAccess (and so get_credits) counts as Pro.
   - Fix: Add `OR v_row.comped` to consume_credit (the coordinator is fixing this). Verified after a temporary pro_until: 28 live Pro calls left the balance at 9.
13. **[parse] The parser misreads two common role-header formats and wrapped PDF headers** — parse, parse_pdf (feeds every tool); fixtures: 02, 03, 06, 11, 14
   - `06-backend-engineer`: “"Software Engineer II, Fieldline — Austin, TX  Mar 2021 – Present" → title "Software Engineer II, Fieldline", company "" (all three roles)”
   - `11-accountant`: “"Gulf Coast Marine Services — Houston, TX" / "Accounts Payable Specialist, Jun 2018 – Mar 2021" → a 4th role titled "Gulf Coast Marine Services"; AP Specialist has no employer; "Bill.com" read as his website”
   - `02-warehouse-lead`: “PDF: wrapped header → company "Columbus, OH (Mar 2019", no dates, bullet "Dec 2021)"”
   - `03-cashier-entry`: “Volunteer / Hope Street Food Pantry → title "Hope Street Food Pantry", no employer”
   - Root cause: lib/resume/parse (experience header split; mergeWrappedLines) — a "Title, Company" one-liner is not split, a company-only line before a "Title, dates" line is not merged, and a header broken inside "(Mar 2019 –" / "Dec 2021)" is not rejoined. In the PDF path, lib/resume/extract/pdf.js hands the wrapped line over as separate lines.
   - Fix: Split "Title, Company" when the right side is not a city. Merge company line + title line into one role. Rejoin a header that ends inside an open date range.
14. **[broken_text] Completed, dated results are rewritten in the present tense** — tailor, optimize, tailor_polish; fixtures: 01, 02, 05, 06, 09, 12, 13, 14
   - `01-retail-manager`: “Grew store sales 9% … in 2023 → Grow store sales 9% year over year in 2023”
   - `06-backend-engineer`: “Built the shipment-tracking event service → Build the shipment-tracking event service”
   - `12-hvac-technician`: “Sold $180K … in 2023 → Sell $180K … in 2023”
   - Root cause: lib/resume/tailor/optimizer.js:410 sets tense = 'present' for every bullet of a current role; the tense rule in lib/resume/rewrite/rules.js (≈:208) applies it to finished results.
   - Fix: Keep past tense when a bullet reports a completed result (a year, "from X to Y", "in N months", a total).
15. **[invented_fact] Generic bullets the person never wrote are added to their roles** — tailor (transferable fill) → export, tailor_polish; fixtures: 01, 02, 03, 05, 06, 10, 11, 14
   - `06-backend-engineer`: “Resolved day-to-day problems on the spot and escalated only when needed. (engineering intern)”
   - `14-teacher`: “Trained new teammates on procedures and standards. (student teacher)”
   - `10-admin-assistant`: “Ran day-to-day office administration: phones, scheduling, records and correspondence. (then polished by the model into "Managed office administration…")”
   - Root cause: lib/resume/tailor/optimizer.js:505-515 transferable fill writes bullets from a title's implied competencies into the variant (flagged confirm:true, but they are in the doc that is exported and polished).
   - Fix: Show them as suggestions outside the variant, and never export or polish one the person has not accepted.
16. **[requirement_misread] "What they want" misses the core requirement and leads with nice-to-haves** — insights; fixtures: 01, 02, 04, 06, 08, 10, 14
   - `06-backend-engineer`: “Terraform \| PostgreSQL \| SQL \| Kafka \| Reconciliation (no Go/Java/Python; Terraform is a nice-to-have)”
   - `01-retail-manager`: “Payroll \| Bilingual (Spanish) \| 3+ years \| Bachelor's degree \| Proven Record Hiring (no P&L; Bilingual and Bachelor's are preferred)”
   - `14-teacher`: “Master's degree \| Carolina Teaching License \| Teaching Upper Elementary \| North Carolina Teaching \| Valid North Carolina”
   - Root cause: lib/server/jobInsights.js buildJobInsights: dictionary skills are pushed first whatever their section, preferred items are not demoted, and minePhrases emits overlapping fragments.
   - Fix: Required section first, preferred last and labelled, fragments deduplicated, and the language requirement read as one any-of.
17. **[broken_text] Template grammar errors in fixed copy** — fit, interview_prep_fallback; fixtures: 01, 02, 03, 06, 10, 11
   - `01-retail-manager`: “Your an Associate's degree meets the education requirement.”
   - `03-cashier-entry`: “How would you handle handling a busy register line and a difficult return?”
   - `06-backend-engineer`: “Give me an example of when you showed shipping.”
   - Root cause: lib/optimizer/constraints.js:78 `Your ${DEGREE_LABEL[deg]}` where the label starts with "a/an". lib/server/interviewPrep.js:199 wraps an "Expect questions on handling …" sentence in "How would you handle …". familyQuestions turns noun priorities into "showed shipping".
   - Fix: Strip the article. Rephrase from the risk object. Use a question template per priority.
18. **[charge] The paid Optimize package is often near-empty: no rewrites, a template message with lowercased skills** — optimize; fixtures: 03, 04, 05, 07, 08, 10, 11, 13
   - `08-marketing-coordinator`: “My experience with bilingual spanish lines up directly with what the role calls for.”
   - `11-accountant`: “charged 1 credit: no rewrite, no reorder, no question — a summary ("10+ years") and a one-skill message”
   - `06-backend-engineer`: “My experience with python, go, and sql lines up…”
   - Root cause: lib/optimizer/generateApplicationMessage.js:37 joins normalised (lowercased) labels. lib/server/optimizePackage.js rewrite_plan keeps only tense/filler rewrites that pass the grounding guard.
   - Fix: Use the résumé's own casing. Charge only when the package has at least one rewrite, reorder or question.
19. **[invented_fact] The tailored summary replaces the candidate's own and drops their strongest credential** — tailor; fixtures: 11
   - `11-accountant`: “"Passed FAR and AUD sections of the CPA exam in 2024; sitting for REG in 2025" is gone from the tailored résumé for a "CPA preferred" job”
   - Root cause: lib/server/resumeStudio.js:116 replaceSummary defaults to true; the composed summary (lib/resume/tailor/optimizer.js:256) has no slot for licences or exams.
   - Fix: Keep the candidate's credential sentence, or default to appending.
20. **[wrong_field] Interview Prep never receives the posting from the tracker, and RN roles fall back to the "general" family** — interview_prep; fixtures: 05, all
   - `05-registered-nurse`: “family: general (both the model and the fallback pack); the fallback asks "Give me an example of when you showed reliability" for a telemetry RN”
   - Root cause: components/tracker/InterviewPrep.tsx:119 posts {action:'build', company, role, application_id, interview_at} with no job_text, although api/interview-prep.js accepts it. lib/application-intelligence/roleOntology.js detectRoleFamily has no clinical family.
   - Fix: Send the tracked application's posting text, and add a clinical family (or reuse resumeAnalysis CLINICAL_TITLE_RE).
21. **[broken_text] "Stories" and "proof" are built on non-accomplishment lines** — interview_prep_fallback, advantage; fixtures: 01, 02, 04, 05, 07, 08, 10, 11
   - `08-marketing-coordinator`: “Tell this one from your résumé: "Social Media Assistant (part-time) — SDSU Associated Students (Sep 2022 – May 2024)"”
   - `05-registered-nurse`: “Tell this one from your résumé: "Registered Nurse, Colorado (multistate compact) — exp. 2026"”
   - `01-retail-manager`: “Use your real result: "Retail leader with 9 years on the sales floor…". Lead with that number.”
   - Root cause: lib/server/interviewPrep.js:161 storyBullets accepts any line of 35+ characters with an -ed word (role headers, licence lines). lib/server/resumeAnalysis.js:509-512 picks the longest quantified line anywhere, including the summary.
   - Fix: Use experience bullets from the parsed doc only.
22. **[charge] The legacy ATS scanner (1 credit, no UI caller) gives nonsense fixes and a mismatched score** — scanner; fixtures: 01, 07, 13, 12, 14, 15
   - `07-data-analyst`: “Sql work that produced 4 years — confirm this figure applies here before using.”
   - `13-line-cook`: “Food safety work that produced 600 guests — confirm this figure applies here before using.”
   - `01-retail-manager`: “match_score 98 vs score_summary "100 — …"”
   - Root cause: lib/server/seenfitCompat.js scannerFromSeenFit + lib/optimizer/generateSafeBullets.js:103 build fixes from any number near a skill word.
   - Fix: Retire tool:scanner (no caller), or stop it charging and reuse the Studio ats_check.
23. **[broken_text] Pro polish is trivial and sometimes harmful: it drops posting keywords, flips tense, and changed nothing for the teacher** — tailor_polish (model, Pro); fixtures: 02, 05, 06, 09, 13, 14
   - `02-warehouse-lead`: “Assign pick waves and labor in Manhattan WMS → Assigned pick waves and labor in WMS (the posting names Manhattan)”
   - `13-line-cook`: “Trained 3 new line cooks → Train 3 new line cooks”
   - `14-teacher`: “applied: 0 — every proposal rejected”
   - Root cause: lib/resume/tailor/polish.js: the firewall (passesFirewall) rejects almost every real verb upgrade (new_word: managed, reduced, improved…), so only cosmetic cuts survive, and nothing re-checks posting keywords or tense after the edit.
   - Fix: Allow verb swaps from STRONG_VERBS, reject an edit that removes a posting keyword or flips a dated result's tense, and say so when nothing changed.

## Automatic findings by check × tool

Every finding is in the JSON file next to this one; root cause and fix per group.

### invented_number · interview_prep_jobtext — 2 finding(s) [invented_fact]

- `13-line-cook` answers.answer: "7" is not in the résumé — “Over the past 4 years and 7 months at Magnolia Bistro, I've run both stations during busy dinner service. [Which station do you prefer, and what's your reason—speed, technique, control over the plate?] [Your preference and what that tells you about how you wor”
- `13-line-cook` intro: "7" is not in the résumé — “I'm a line cook with 4 years and 7 months at Magnolia Bistro, where I work sauté and grill on 250-cover Friday and Saturday nights. I keep ticket times under 14 minutes, prep and break down my station to standard every shift, and I've passed every health inspe”

### invented_org · interview_prep_jobtext — 1 finding(s) [invented_fact]

- `04-customer-service` intro: "Lumen Ridge's" is not in the résumé — “I'm a customer care representative with 5 years of experience on phones, chat and email in insurance and telecom. I handle 60–70 inbound calls a day on billing and account questions, and I keep a 94% customer satisfaction score, which is consistently above my ”

### invented_years · interview_prep_jobtext — 1 finding(s) [invented_fact]

- `11-accountant` intro: says 6 years at Gulf Coast Marine Services; the résumé's dates give 2.8 years there — “I'm a Staff Accountant with 6 years of close and reconciliation experience at Bayou Industrial Supply and Gulf Coast Marine Services.”

### invented_org · interview_prep — 1 finding(s) [invented_fact]

- `13-line-cook` intro: "Fridays and Saturdays" is not in the résumé — “I've been a line cook at Magnolia Bistro since 2022, running sauté and grill on our busiest nights—250-cover Fridays and Saturdays—and keeping ticket times under 14 minutes. Before that I was a prep cook at Crescent Catering, working with everything from small”

### invented_degree · interview_prep_jobtext — 1 finding(s) [invented_fact]

- `14-teacher` intro: "bachelor's" is not in the résumé — “I'm a 4th-grade teacher at Oak Grove Elementary in Raleigh, and I've been teaching since 2019. I hold a North Carolina Elementary Education license and a bachelor's degree in Elementary Education. I'm skilled at using data—especially i-Ready—to group students ”

### trap · interview_prep_jobtext — 1 finding(s) [trap]

- `12-hvac-technician` intro: Building automation: not in the résumé — “I'm an HVAC service technician with 9 years of experience installing and servicing residential systems in the Phoenix heat. Since 2020, I've been at Desert Air Comfort running 5–7 service calls a day, diagnosing and repairing equipment like split systems, heat”

### broken_text · interview_prep — 1 finding(s) [broken_text]
Root cause: resume_fact points at a header/meta line.  
Fix: Require resume_fact to be an experience bullet.

- `05-registered-nurse` answers.resume_fact: a "story" built on a role header line, not an accomplishment — “Registered Nurse, Medical-Surgical Unit — St. Aurelia Medical Center, Denver, CO — Aug 2020 to Present”

## Expert grades

| Fixture | interview_prep_fallback | interview_prep | interview_prep_jobtext |
|---|---|---|---|
| 01-retail-manager | 2⚠ | 4⚠ | 2⚠ |
| 02-warehouse-lead | 2⚠ | 4⚠ | 4⚠ |
| 03-cashier-entry | 2⚠ | 4⚠ | 4⚠ |
| 04-customer-service | 3⚠ | 4⚠ | 4⚠ |
| 05-registered-nurse | 2⚠ | 3⚠ | 3⚠ |
| 06-backend-engineer | 2⚠ | 4⚠ | 4⚠ |
| 07-data-analyst | 3⚠ | 3⚠ | 3⚠ |
| 08-marketing-coordinator | 2⚠ | 3⚠ | 4⚠ |
| 09-sdr-sales | 3⚠ | 4⚠ | 4⚠ |
| 10-admin-assistant | 2⚠ | 3⚠ | 4⚠ |
| 11-accountant | 2⚠ | 4⚠ | 3⚠ |
| 12-hvac-technician | 3⚠ | 3⚠ | 4⚠ |
| 13-line-cook | 3⚠ | 4⚠ | 3⚠ |
| 14-teacher | 3⚠ | 4⚠ | 4⚠ |
| 15-no-requirements |  |  |  |

Grade notes (1 = harmful · 3 = usable, no better than free ChatGPT · 5 = worth paying for alone):

- `01-retail-manager` · interview_prep_fallback — **2**: Generic cashier-level questions for a Store Manager ("accuracy at the register"); broken "How would you handle handling a busy register line…". Stories are real bullets.
- `01-retail-manager` · interview_prep — **4**: Strong, role-specific questions built on her real numbers; answers usable. Defects: intro says "the last three and a half [years] as an Assistant Store Manager" (dates say 5.5); answers add practices not in the résumé ("I also pair them with supervisors…").
- `01-retail-manager` · interview_prep_jobtext — **2**: Given the posting, the intro claims a requirement she does not have: "I've already been running the day-to-day operations—the schedules, the hiring, the P&L piece". Answers add "I trained all 18 associates and my 3 supervisors on loss prevention basics".
- `02-warehouse-lead` · interview_prep_fallback — **2**: "Give me an example of when you showed safety." First story is his summary line, not an accomplishment.
- `02-warehouse-lead` · interview_prep — **4**: Excellent lead-level questions (safety huddle, shorts reconciliation). Intro invents a promotion path: "worked my way up from Material Handler to Forklift Operator" (one combined role).
- `02-warehouse-lead` · interview_prep_jobtext — **4**: Questions now track the posting (WMS monitoring, 15–25 crew, safety incidents). Intro dropped by the guard.
- `03-cashier-entry` · interview_prep_fallback — **2**: "How would you handle handling a busy register line…" broken; otherwise generic.
- `03-cashier-entry` · interview_prep — **4**: Natural, entry-level questions and answers. Defects: "since June of this year" (June 2024), "What drew you back to grocery retail?" (she never worked grocery).
- `03-cashier-entry` · interview_prep_jobtext — **4**: Good, posting-aware entry-level pack.
- `04-customer-service` · interview_prep_fallback — **3**: Generic but correct for the field.
- `04-customer-service` · interview_prep — **4**: Very good, specific to her numbers. Numbers are written as words ("sixty to seventy", "ninety-four percent"), which escapes the digit-only guard.
- `04-customer-service` · interview_prep_jobtext — **4**: Good; one awkward question ("What does your typical Monday morning look like between 10 AM and 7 PM Eastern?").
- `05-registered-nurse` · interview_prep_fallback — **2**: Family "general": generic questions for a telemetry RN; two "stories" are her license line and a role header.
- `05-registered-nurse` · interview_prep — **3**: Questions are genuinely clinical and good (rhythm changes, nights, charge priorities). Intro states "almost four years of experience at St. Aurelia" (dates: 6.2); charge-nurse answer garbles "assignments for five to six patients per nurse". Family field still "general".
- `05-registered-nurse` · interview_prep_jobtext — **3**: Clinical, posting-aware questions (4–5 tele patients, nights); family still "general"; a header line used as a story.
- `06-backend-engineer` · interview_prep_fallback — **2**: "Give me an example of when you showed shipping."
- `06-backend-engineer` · interview_prep — **4**: Strong payments-relevant questions grounded in his bullets. Intro "four years of experience" (7); answers embellish ("I analyzed the queries…").
- `06-backend-engineer` · interview_prep_jobtext — **4**: Strong posting-aware questions (queues, on-call, compliance); intro dropped.
- `07-data-analyst` · interview_prep_fallback — **3**: Generic but stories are her strongest bullets.
- `07-data-analyst` · interview_prep — **3**: Very good questions on her real projects; but an answer moves the Monday-report automation to the wrong employer ("At Twin Lakes, I was generating this Monday sales report…" — it was North Loop).
- `07-data-analyst` · interview_prep_jobtext — **3**: False premise: "You've worked with Tableau and Power BI. What's your experience…" (no Power BI on her résumé); 2 of 4 answers dropped by the guard.
- `08-marketing-coordinator` · interview_prep_fallback — **2**: A "story" is a role header ("Social Media Assistant (part-time) — SDSU … (Sep 2022 – May 2024)"); "showed channel fluency".
- `08-marketing-coordinator` · interview_prep — **3**: Good questions; intro overclaims: "I've spent the last couple years working in marketing at Coastal Coffee Roasters, where I managed their social media" (a 10-week internship); answers add practices not on the résumé.
- `08-marketing-coordinator` · interview_prep_jobtext — **4**: Good; the intro is accurate now ("the last few months as a marketing intern").
- `09-sdr-sales` · interview_prep_fallback — **3**: Reasonable sales questions.
- `09-sdr-sales` · interview_prep — **4**: Sharp SDR questions (volume vs personalisation, inbound vs outbound). Answers embellish method ("I know my conversion rate from call to meeting…").
- `09-sdr-sales` · interview_prep_jobtext — **4**: Strong.
- `10-admin-assistant` · interview_prep_fallback — **2**: "How would you handle accuracy, tools used, and handling confidential records?" broken.
- `10-admin-assistant` · interview_prep — **3**: Only three role questions and none on supporting three executives, travel or board meetings; intro dropped; an answer claims "I've never had a double-booking… I color-code" (not on the résumé).
- `10-admin-assistant` · interview_prep_jobtext — **4**: Now covers travel, expenses and confidentiality (the posting's asks); one invented practice ("I look ahead two weeks").
- `11-accountant` · interview_prep_fallback — **2**: "How would you handle reconciliation, accuracy, and any system you list?"; first story is the summary.
- `11-accountant` · interview_prep — **4**: Strong, honest about the CPA exam; senior-level questions on close, flux, audit and REG timing.
- `11-accountant` · interview_prep_jobtext — **3**: Good questions but a wrong fact in one: "You've used NetSuite for 3 years now" (since 2018).
- `12-hvac-technician` · interview_prep_fallback — **3**: Field-correct, generic.
- `12-hvac-technician` · interview_prep — **3**: Good residential→commercial questions, but the guard dropped 2 of 4 answers and the intro, so the pack is thin.
- `12-hvac-technician` · interview_prep_jobtext — **4**: Good residential→commercial framing; honest about chillers/RTUs.
- `13-line-cook` · interview_prep_fallback — **3**: Field-correct, generic.
- `13-line-cook` · interview_prep — **4**: Natural kitchen questions and answers grounded in his numbers.
- `13-line-cook` · interview_prep_jobtext — **3**: A question contradicts the résumé: "Tell me about the last time you didn't pass a health inspection" (he passed every one).
- `14-teacher` · interview_prep_fallback — **3**: Field-correct, generic.
- `14-teacher` · interview_prep — **4**: Excellent: data-driven reading, IEPs, PLC, 4th→5th transition; answers stay on her facts.
- `14-teacher` · interview_prep_jobtext — **4**: Excellent.

## Deferred live calls

None.
