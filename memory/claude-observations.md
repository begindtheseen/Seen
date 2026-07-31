---
title: Claude — Observations
tags: [observations, claude]
aliases: [Claude Observations]
updated: 2026-07-31
facts:
  - id: claude-brain-connection
    subject: Claude
    predicate: brain_connection
    object: confirmed live 2026-07-07 (this session, writing to the shared Chronos vault)
    valid_from: 2026-07-07
    valid_to: null
    confidence: high
    source: "[[claude-observations]]"
    recorded: 2026-07-07
    invalidated: null
  - id: chronos-brain-online-storage-20260708-1
    subject: Chronos brain
    predicate: online_storage
    object: "Supabase brain_notes/brain_facts/brain_timeline (RLS, service-key only); auto-push each board meeting; restore via npm run brain:restore"
    valid_from: 2026-07-08
    valid_to: null
    confidence: high
    source: brain/lib/cloud.mjs
    recorded: 2026-07-08
    invalidated: null
  - id: seen-resume-pdf-export-watermark-policy-20260729-2
    subject: Seen resume PDF export
    predicate: watermark_policy
    object: "The \"Optimized with Seen · seenjobs.io\" PDF footer renders ONLY for free/anonymous users; Pro users get a clean unbranded résumé. Gated by meta.pro in buildResumePDF (api/resume.js) — footer band stays reserved so pagination is identical. Both entry points (download_resume, email_analysis) resolve effective Pro via new resolveProAccess(req) in lib/server/credits.js (reads ai_credits → hasProAccess, no credit charged, fails safe to non-Pro). Client download_resume fetches now send aiHeaders()."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: "PR #239"
    recorded: 2026-07-29
    invalidated: null
  - id: pr-239-status-20260729-3
    subject: "PR #239"
    predicate: status
    object: "Draft — résumé watermark Pro-gating. head branch claude/verify-environment-setup-x78w1f → base next-migration. Local: 487/487 tests pass, tsc --noEmit clean. Vercel preview deployed green; verify/CodeQL/TruffleHog checks were still running at push. Self check-in scheduled ~1h out to confirm CI green + drive to merge."
    valid_from: 2026-07-29
    valid_to: 2026-07-29
    confidence: high
    source: "https://github.com/begindtheseen/Seen/pull/239"
    recorded: 2026-07-29
    invalidated: 2026-07-29
  - id: seen-cloud-setup-setup-script-20260729-4
    subject: Seen cloud setup
    predicate: setup_script
    object: "scripts/cloud-setup.sh (added PR #238, merged) is wired as the web-env Setup script. It checks memory/CHRONOS_BRIDGE.md + lib/server/brainCloud.js exist, curls BRAIN_API_URL with BRAIN_API_TOKEN (200 = brain reachable), then runs npm ci when package-lock.json is present. Not set -e — brain check is informational, never fails setup. Verified working 2026-07-29 (200, deps installed, exit 0)."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: "PR #238"
    recorded: 2026-07-29
    invalidated: null
  - id: seen-sessionstart-hook-memory-boot-enforcement-20260729-5
    subject: Seen SessionStart hook
    predicate: memory_boot_enforcement
    object: ".claude/hooks/session-start.sh (registered in .claude/settings.json) injects a memory-boot directive as SessionStart additionalContext every session — call memory_status to orient + write back (memory_record_fact/memory_append_timeline/threads) before ending. Deterministic backstop for CLAUDE.md rule 1 after a 2026-07-29 session shipped work without booting the brain. Runs in all envs (not gated on CLAUDE_CODE_REMOTE); pure context injector (deps handled by cloud-setup.sh); tells agent to call the chronos MCP tool, not npm run memory:status (that reads the stale local vault in cloud). Added on PR #239."
    valid_from: 2026-07-29
    valid_to: 2026-07-29
    confidence: high
    source: "PR #239"
    recorded: 2026-07-29
    invalidated: 2026-07-29
  - id: seen-sessionstart-hook-memory-boot-enforcement-20260729-6
    subject: Seen SessionStart hook
    predicate: memory_boot_enforcement
    object: "Upgraded on PR #239: .claude/hooks/session-start.sh now injects the LIVE Chronos briefing (not just a reminder) as SessionStart additionalContext, so a session starts oriented with ZERO tool calls. It runs the cloud-aware scripts/memory-status.mjs and falls back to a boot directive if the briefing cannot be fetched; bounded with timeout so session start never hangs. Registered in .claude/settings.json; runs in all envs; dependency-free."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: "PR #239"
    recorded: 2026-07-29
    invalidated: null
  - id: seen-memory-status-script-cloud-aware-20260729-7
    subject: "Seen memory:status script"
    predicate: cloud_aware
    object: "scripts/memory-status.mjs now fetches the online brain via brainCloud.fetchNotes (token-gated gateway) in a cloud session and reads the local vault on a Mac, mirroring the chronos MCP resolveCloud() (CHRONOS_SOURCE forces it, else auto to cloud when brain creds present). Fixes the prior bug where npm run memory:status read the stale/absent local vault in cloud. Chain is dependency-free (memoryGraph/brainCloud/brainStore). PR #239."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: "PR #239"
    recorded: 2026-07-29
    invalidated: null
  - id: pr-239-status-20260729-8
    subject: "PR #239"
    predicate: status
    object: "MERGED to next-migration on 2026-07-29 by begindtheseen (auto-deploys to prod/seenjobs.io). All CI green at merge (verify, CodeQL, TruffleHog, Vercel). 3 commits, +134/-13 across 8 files. Contents: (1) résumé watermark Pro-gating — seenjobs.io PDF footer only for free/anonymous, Pro users get clean résumé; (2) SessionStart memory-boot hook that injects the LIVE Chronos briefing at session start; (3) cloud-aware scripts/memory-status.mjs."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: "https://github.com/begindtheseen/Seen/pull/239"
    recorded: 2026-07-29
    invalidated: null
  - id: chronos-brain-serializer-bug-20260729-9
    subject: Chronos brain
    predicate: serializer_bug
    object: "OPEN: brain fact serializer over-escapes quotes — each re-derive compounds backslashes (see the watermark_policy fact, now hundreds of backslashes). Root cause likely in the applyFact/frontmatter writer (lib/server/writeFact.js path). Deferred from the 2026-07-29 UI session deliberately (rule 5: no rushed change to the memory writer). Fix by writing quotes safely once + a one-time cleanup of corrupted facts. Until fixed: avoid double quotes inside fact objects."
    valid_from: 2026-07-29
    valid_to: 2026-07-29
    confidence: high
    source: timeline/2026-07-29.md
    recorded: 2026-07-29
    invalidated: 2026-07-29
  - id: seen-ui-redesign-direction-20260729-10
    subject: Seen UI
    predicate: redesign_direction
    object: "Owner decided 2026-07-29: wants a BOLDER VISUAL REDESIGN, not just polish — the shipped finish pass (PR #240) kept the existing identity and owner found it insufficient. Three mockup directions produced (rule 6: decide before building) and sent as images: A Terminal Intelligence (dark radar/instrument, mono, grid), B Editorial Light (paper bg, Fraunces serif, exposé tone — biggest visible change), C Neo-Brutal Signal (loud flat blocks, sticker grades, outcome ticker — viral/r-recruitinghell energy). Mockup HTML files in session scratchpad (dir-a/b/c.html). AWAITING owner pick; implementation must not start until direction is chosen."
    valid_from: 2026-07-29
    valid_to: 2026-07-29
    confidence: high
    source: session 2026-07-29
    recorded: 2026-07-29
    invalidated: 2026-07-29
  - id: seen-ui-redesign-direction-20260729-11
    subject: Seen UI
    predicate: redesign_direction
    object: "Owner stance 2026-07-29: wants OPTIONS, explicitly NOT committing yet — do not start implementing any redesign. FIVE coded directions produced + current baseline, published as private artifact gallery https://claude.ai/code/artifact/ebbc0efa-0b31-41cb-8fa5-caa8a2112898 (mockup HTML: scratchpad dir-a..e.html; screenshots embedded). A Terminal Intelligence (radar/instrument) · B Editorial Light (paper exposé, biggest visible change) · C Neo-Brutal Signal (loud/viral) · D Aurora Glass (premium evolution of current, lowest risk) · E Swiss Data (stat-as-hero poster + index table). Mixes explicitly invited. Amazon figures real; E index rows for other companies illustrative. Next step belongs to owner: pick/mix/reject; PR #240 (motion+fixes) stands independently and carries into any direction."
    valid_from: 2026-07-29
    valid_to: 2026-07-29
    confidence: high
    source: "https://claude.ai/code/artifact/ebbc0efa-0b31-41cb-8fa5-caa8a2112898"
    recorded: 2026-07-29
    invalidated: 2026-07-29
  - id: seen-ui-design-bar-20260729-12
    subject: Seen UI
    predicate: design_bar
    object: "OWNER RULE (2026-07-29, permanent): NEVER pitch template/genre designs. Owner is design-literate, has used Claude extensively, and instantly recognizes the AI-default looks (cream+serif editorial, black+acid-green terminal, neo-brutalism kit, broadsheet hairlines, indigo-glass SaaS) — all five 2026-07-29 direction mockups were rejected as exactly these. Quality = design derived from SEEN'S OWN SUBJECT MATERIAL, not from a genre: the brand name IS a read receipt (seen, no reply); the product's materials are message threads, ✓✓ ticks, typing indicators that vanish, day counters, waiting, receipts/evidence, the applicant-employer surveillance asymmetry. Any future visual direction must be born from that world and be something no other product could wear. Also: do not spend tokens on unrequested parallel mockups — concepts in words first, build only on explicit owner approval."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: owner feedback, session 2026-07-29
    recorded: 2026-07-29
    invalidated: null
  - id: seen-ui-redesign-direction-20260729-13
    subject: Seen UI
    predicate: redesign_direction
    object: "OWNER PICKED 2026-07-29: Aurora Glass (direction D) is the redesign direction — the premium evolution of the existing dark identity: richer aurora light, frosted-glass surfaces (backdrop-blur + inset top highlight + translucent bg), gradient-ring hero card, pill CTAs with glow, larger radii (16/24). Owner's one condition: LAYOUT MUST BE PERFECT — spacing scale discipline, no orphan wraps at any width (320/390/768/1024/1440), no overflow, aligned rows, deliberate rhythm. Supersedes the rejected-templates state; read-receipt concept remains available as a future brand-language idea but D is the visual direction. Implement via glass tokens in globals + shared surfaces so it propagates; include @supports no-backdrop-filter fallback."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: owner decision, session 2026-07-29
    recorded: 2026-07-29
    invalidated: null
  - id: chronos-brain-serializer-bug-20260729-14
    subject: Chronos brain
    predicate: serializer_bug
    object: "FIXED in code 2026-07-29 (commit 598cf4a, Opus agent, verified + pushed on PR #240 branch). Root cause: writeFact.js emitVal used JSON.stringify (escapes quotes/backslashes) while memoryGraph.js parseScalar only stripped outer quotes without unescaping — parse(write(x)) never equaled x, and applyFact re-emits the WHOLE facts block each write, compounding n→2n+1 backslashes per session. Now exact inverses; bare emission only when provably lossless; 545/545 tests incl. 5-cycle idempotence + real 1022-backslash regression. REMAINING ONE-TIME STEP: run node scripts/brain-repair.mjs --apply from the Mac/service-key env (dry-run verified in cloud: 48 notes, exactly 1 corrupted fact — watermark_policy, 4094 backslashes → clean 497-char value; 0 ambiguous). Runbook: memory/CHRONOS_BRIDGE.md §11. Until applied, that one fact stays corrupted but can no longer degrade further."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: commit 598cf4a
    recorded: 2026-07-29
    invalidated: null
  - id: seen-command-audit-findings-20260729-15
    subject: seen-command
    predicate: audit_findings
    object: "Audit 2026-07-29 (repo cloned read-only, evidence file:line): (1) CRITICAL — the serializer bug class fixed in seen (598cf4a) EXISTS in seen-command too: brain/lib/memory-write.mjs:37 writes with JSON.stringify while brain/lib/chronos/memoryGraph.mjs:52 parses with bare slice(1,-1), same lossy asymmetric pair — the Mac board meeting will re-corrupt facts AND now disagrees with seen's fixed quoting format; port the fix or unify the duplicated chronos lib. (2) pushBrain (brain/lib/cloud.mjs:67) is a full-vault upsert with no freshness guard — cloud writes landing between syncDown and push get clobbered. (3) org/focus.mjs:69 slices focus to 80 chars — live current_focus fact is truncated mid-word. (4) Focus thrash: board meetings re-record current_focus every run (5+ same-day supersedes 07-10) — needs record-only-on-change + stickiness. Root disease: chronos lib duplicated across repos with drift."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: /workspace/seen-command @ 370b46f
    recorded: 2026-07-29
    invalidated: null
  - id: seen-command-brain-integrity-pr-20260729-16
    subject: seen-command
    predicate: brain_integrity_pr
    object: "Draft PR https://github.com/begindtheseen/seen-command/pull/122 (branch claude/brain-integrity-fixes, 4 commits fee66b7..0522c43, verified locally: +820/−37, 10 files, tests 291→366). Ships: serializer parity with seen 598cf4a + 52-test drift guard; pushBrain clobber guard (skip-newer, --force override); focus title 280-char word-boundary clamp. KEY INSIGHT: the focus THRASH was the serializer bug — parse(write(x))≠x defeated the existing unchanged→no-op check (6 meetings = 6 supersedes pre-fix; 1 fact + 5 no-ops post-fix); coercion holes (\"42\"→42) caused the same. OWNER DECISIONS pending in PR body: pick a focus-stickiness option (agent correctly did not override the Board Room directive); merge PR; do NOT run a board meeting before merging + pulling on the Mac; then run seen's brain-repair --apply for the one-off cleanup. Two pre-existing issues documented, untouched: lib/brain.mjs writeOne() duplicates recordFact contract; findFactsBlock() misses empty facts:[] lines."
    valid_from: 2026-07-29
    valid_to: 2026-07-29
    confidence: high
    source: "https://github.com/begindtheseen/seen-command/pull/122"
    recorded: 2026-07-29
    invalidated: 2026-07-29
  - id: seen-command-brain-integrity-pr-20260729-17
    subject: seen-command
    predicate: brain_integrity_pr
    object: "MERGED to main 2026-07-29 15:53 UTC by owner (merge of claude/brain-integrity-fixes, head 0522c43, CI test green, 366/366). Both repos now share the exact-inverse serializer invariant with drift-guard tests. Remaining owner steps: git pull seen-command on the Mac BEFORE the next board meeting; run seen's scripts/brain-repair.mjs --apply once (one corrupted fact); eyeball the FIRST real pushBrain run's conflict warnings (updated_at semantics unverified live); pick a focus-stickiness option from PR #122 body (warn / marker / board-room-only). Follow-ups documented in PR: writeOne() dedup onto shared writer, findFactsBlock facts:[] gap, Electron UI look at 280-char focus title. Next big item if owner wants reliability work: engine/ task-pipeline failure audit (data/ run history, pr-rescue triggers)."
    valid_from: 2026-07-29
    valid_to: null
    confidence: high
    source: "https://github.com/begindtheseen/seen-command/pull/122"
    recorded: 2026-07-29
    invalidated: null
  - id: seen-company-scores-backfill-status-20260730-18
    subject: Seen company scores
    predicate: backfill_status
    object: "FOUND 2026-07-30 while staging the 9,352-company score backfill: ANTHROPIC_KEY on Vercel has been failing with a client error (401/400/403-class, non-retryable, <1.5s) since ~2026-07-03 — last data_source=web_search row in company_scores. Every new-company lookup since then 502'd (\"Score service temporarily unavailable\") because api/reports.js swallowed the upstream status. Flag anthropic_enabled=fully_on the whole time. PR #241 (draft, branch claude/verify-environment-setup-x78w1f, commit df3c577) ships: status logging, 502 only for transient statuses, client-error degrade to honest no_data 200, llm.js chat() fallback to LLM_API_KEY backend on Anthropic client errors. 545/545 tests. OWNER MUST fix the key (Vercel env ANTHROPIC_KEY + Anthropic console billing) before the backfill can run. Backfill staged: 9,352 unscored job-companies (of 9,616 distinct; 26,023 companies total; 642 scored), priority = job count DESC, runner = seed-companies pattern (company_score action, conc 3, checkpointed, idempotent via cache-skip). Est. $0.015-0.035/company ≈ $150-350 for all."
    valid_from: 2026-07-30
    valid_to: 2026-07-30
    confidence: high
    source: "PR #241 + live probes 2026-07-30"
    recorded: 2026-07-30
    invalidated: 2026-07-30
  - id: seen-backfill-skiplist-20260730-19
    subject: Seen backfill
    predicate: skiplist
    object: taxtalente.de · sourcepro search · bright vision technologies · travelnursesource · expert technology services · k-tronik gmbh · leap · pace · qureos — researched, permanently skipped (job boards / not identifiable single employers / zero credible chatter / promo-pattern reviews). Nightly backfill Routine must exclude these AND append its own new skips by superseding this fact (same subject+predicate, full updated list).
    valid_from: 2026-07-30
    valid_to: 2026-07-30
    confidence: high
    source: backfill waves 2026-07-30
    recorded: 2026-07-30
    invalidated: 2026-07-30
  - id: seen-backfill-protocol-20260730-20
    subject: Seen backfill
    predicate: protocol
    object: "CONTRACT for nightly waves (validated by pilot+wave1: 48 rows, 19 aliases, 0 suspect): select top ~60 unscored job-companies by job count (exclude company_scores matches, company_aliases matches, skiplist fact, junk regex confidential/unknown/n-a/various/private-employer, len≥3); fan out ≤4 parallel agents ×15 names. Per company → inserted|alias|skipped. Research via WebSearch (Blind/Glassdoor/Indeed/Fishbowl/Vivian; reddit UNREACHABLE); numbers grounded in accounts actually read (report_count=accounts read, cap 500, aggregates inform quality/summary only); reviews 3-6 real quotes w/ true source+year; data_quality stingy (high=many accounts 2+ platforms, medium=handful 1-2, low=fragments); skip job boards/ambiguous names/zero chatter/astroturf; staffing agencies ARE employers; alias only unambiguous same-employer to EXISTING company_scores row (verify first; source backfill_nightly). Scoring: overall=clamp100(50+rr*40-gr*30-min(wait/60,1)*15+min(10,ln(cnt+1)*5)); waste=clamp100(gr*60+unpaid*25+(rounds>4?15:0)). INSERT INTO company_scores (…17 cols…) with company_name=listing name lowercase trim, first_party_report_count=0, data_source=web_search, expires now()+365d, web_reviews jsonb, dollar-quoted $q$…$q$, ON CONFLICT (company_name) DO NOTHING, SELECT-back verify. Touch ONLY company_scores+company_aliases, INSERT-only. After: audit suspect-row query (must be 0), supersede skiplist+progress facts, append timeline. Project tmngmmofrplsldvlobfx."
    valid_from: 2026-07-30
    valid_to: null
    confidence: high
    source: session 2026-07-30
    recorded: 2026-07-30
    invalidated: null
  - id: seen-backfill-progress-20260730-21
    subject: Seen backfill
    predicate: progress
    object: "As of 2026-07-30 ~05:00 UTC: pilot + wave 1 complete (48 rows inserted, 19 aliases, 12 skips, 0 suspect rows on audit; coverage 642→690 scored; ~9,229 job-companies still unscored). Wave 2 running (4 agents × 16, ranks 65-128: Thermo Fisher, Staples, Axon, Warby Parker, Guidehouse, Anduril, Stryker, BNY, Northwestern Medicine…). Nightly self-bind Routine armed (trig_01WuLXrxPTmUiChUC2gxUnkQ, 09:00 UTC daily, fires into the campaign session; protocol/skiplist/progress facts in brain are its source of truth). Verified live: TD Bank + Gopuff serve real scores on seenjobs.io from the new cache. PR #241 (dead-key honest degradation) all-green, awaiting owner merge. Follow-ups parked: duplicate row jpmorgan chase & co. vs jpmorgan chase (owner company_merges flow); predatory-scheme formula gap (SynergisticIT 67, GIA 83 despite pay-to-play — warnings live in waste/unpaid/reviews; owner product decision); ANTHROPIC_KEY still dead (owner: Vercel env + console.anthropic.com) — needed only for live per-visitor research, not this backfill."
    valid_from: 2026-07-30
    valid_to: 2026-07-30
    confidence: high
    source: session 2026-07-30
    recorded: 2026-07-30
    invalidated: 2026-07-30
  - id: seen-backfill-progress-20260730-22
    subject: Seen backfill
    predicate: progress
    object: "As of 2026-07-30 ~05:05 UTC: pilot + wave 1 COMPLETE (48 rows, 19 aliases, 12 skips, 0 suspect; coverage 642→690). Wave 2 (ranks 65-128) FAILED CLEANLY on session usage limit (resets 08:10 UTC) — all 4 agents died before any insert; no partial data; the idempotent selection re-picks the same names. Nightly self-bind Routine (trig_01WuLXrxPTmUiChUC2gxUnkQ) fires 09:00 UTC — 50min after reset — and will effectively re-run wave 2 from the protocol/skiplist facts. No manual action required. PR #241 all-green awaiting owner merge; TD Bank + Gopuff verified live on prod."
    valid_from: 2026-07-30
    valid_to: 2026-07-30
    confidence: high
    source: session 2026-07-30
    recorded: 2026-07-30
    invalidated: 2026-07-30
  - id: seen-backfill-skiplist-20260730-23
    subject: Seen backfill
    predicate: skiplist
    object: taxtalente.de · sourcepro search · bright vision technologies · travelnursesource · expert technology services · k-tronik gmbh · leap · pace · qureos · qureos inc · ceres group · central business solutions · moodreact · towne · stratford davis — researched, permanently skipped (job boards / not identifiable single employers / zero credible chatter / astroturf-pattern-only profiles). Nightly backfill Routine must exclude these AND append its own new skips by superseding this fact (same subject+predicate, full updated list).
    valid_from: 2026-07-30
    valid_to: 2026-07-31
    confidence: high
    source: "backfill waves through 2026-07-30 nightly #1"
    recorded: 2026-07-30
    invalidated: 2026-07-31
  - id: seen-backfill-progress-20260730-24
    subject: Seen backfill
    predicate: progress
    object: "Through nightly wave #1 (2026-07-30 ~09:45 UTC): 93 companies scored total by campaign (pilot 10 + wave1 38 + nightly1 45), 27 aliases, 17 skips; audits 0 suspect rows every wave. Coverage 642→735 scored; 9,164 job-companies still unscored (head keeps shrinking by ~60/night). Nightly Routine (trig_01WuLXrxPTmUiChUC2gxUnkQ, 09:00 UTC, self-bind) is proven: first firing ran full wave incl. usage-limit recovery from the aborted wave 2. Notable rows: certified mobile notary service 29 (pay-to-play, BBB out-of-business), axon 57 (publicly acknowledged gaps), anduril 59, amplitude 54, warby parker 80. Judgment traps passed: maxim healthcare kept DISTINCT from amergis; KAISER aliased to kaiser permanente only after listing-context verification; teksystems aliased to pre-existing 'teksystems c/o allegis group'. PR #241 still awaiting owner merge; ANTHROPIC_KEY still dead (live per-visitor research only)."
    valid_from: 2026-07-30
    valid_to: 2026-07-31
    confidence: high
    source: nightly wave 2026-07-30
    recorded: 2026-07-30
    invalidated: 2026-07-31
  - id: seen-company-scores-backfill-status-20260730-25
    subject: Seen company scores
    predicate: backfill_status
    object: "PR #241 MERGED to next-migration 2026-07-30 (5ca89fb) and VERIFIED LIVE: unscored-company lookups now return 200 no_data + degraded:research_unavailable + honest be-the-first message instead of the 27-day 502 (probe: Serco). Anthropic failures now logged with status; llm.js falls back to LLM_API_KEY backend on client errors. The silent-outage class is closed. Remaining owner items: ANTHROPIC_KEY revive (live visitor research only), jpmorgan duplicate-row merge, predatory-flag product decision. Local branch reset onto merged base."
    valid_from: 2026-07-30
    valid_to: null
    confidence: high
    source: prod probe 2026-07-30
    recorded: 2026-07-30
    invalidated: null
  - id: seen-backfill-skiplist-20260731-26
    subject: Seen backfill
    predicate: skiplist
    object: taxtalente.de · sourcepro search · bright vision technologies · travelnursesource · expert technology services · k-tronik gmbh · leap · pace · qureos · qureos inc · ceres group · central business solutions · moodreact · towne · stratford davis · cyrus digital gmbh · career launch · greenlife healthcare staffing · military spouse corporate career network · projektron gmbh · eorbit gmbh · job.com · vivian health · healthforce — researched, permanently skipped (job boards/marketplaces / not identifiable single employers / zero credible chatter / astroturf-only). Nightly Routine must exclude these AND supersede this fact with its own additions.
    valid_from: 2026-07-31
    valid_to: null
    confidence: high
    source: "backfill waves through 2026-07-31 nightly #2"
    recorded: 2026-07-31
    invalidated: null
  - id: seen-backfill-progress-20260731-27
    subject: Seen backfill
    predicate: progress
    object: "Through nightly wave #2 (2026-07-31): 138 companies scored by campaign (pilot 10 + w1 38 + n1 45 + n2 45), 36 aliases, 26 skips; every wave audit 0 suspect rows. Coverage 642→780 scored. KEY METRIC SHIFT: raw still-unscored ROSE to 9,666 (+502 overnight) because job ingest adds ~500 new company names/day — raw total is the wrong measure. Head coverage is the real one: only 20 unscored companies with ≥10 jobs and 331 with ≥5 jobs remain → visible head done in ~6 nights at 60/night, then the stop condition (top jc<3) triggers naturally. PROTOCOL AMENDMENTS for future waves: (1) compose raw_summary ≤460 chars to leave margin — if a landed row exceeds 500, LEAVE IT; never UPDATE, even own-session rows (one agent ran a scoped own-rows UPDATE tonight — benign+disclosed, but the rule is now explicit); (2) the jobs table itself is a legitimate disambiguation source (CNA→CNA Financial and Prima→Prima Assicurazioni were pinned via listing context; job.com/vivian health skipped with 0 searches). Notable rows: amtrak 49, northern trust 59, nbcuniversal 54, mta 49, allied universal 83, american traveler 87."
    valid_from: 2026-07-31
    valid_to: null
    confidence: high
    source: "nightly wave #2, 2026-07-31"
    recorded: 2026-07-31
    invalidated: null
---

# Claude — live observations

Bi-temporal facts Claude records during sessions via the `memory_record_fact` MCP tool
(supersede-not-overwrite). This is Claude's own write surface into the shared brain — separate from
the human-curated `knowledge/` notes and from Seen Command's `seen-command-observations.md`. Recall
with `memory_search_facts` / `memory_status`.
