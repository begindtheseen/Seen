# Seen — Claude Code Instructions

## ⚡ START HERE EVERY SESSION — memory boot (do this first)
This project uses the shared Chronos brain. **Use it every session so you recall where things
stand instead of re-reading everything — that is the token save.**

**Local vs cloud — how you reach the brain (Chronos):**
- **Local (Mac) session:** use the private, user-owned MCP registration for exact source
  `claude-seenjobs`. The shared project `.mcp.json` is intentionally empty so a checkout can never
  inherit another principal's credential or an ungated legacy server.
- **Cloud / repo-connected session:** there is no checked-in `memory/` directory and no guaranteed
  `memory_*` MCP catalog. The protected environment reaches the always-on online brain through
  `lib/server/brainCloud.js` with `BRAIN_API_URL`, `BRAIN_API_TOKEN`, `BRAIN_CLIENT=claude-seenjobs`,
  and its unique `BRAIN_CLIENT_TOKEN`. Every call is credential-bound and audited as exactly
  **`claude-seenjobs`**; `claude-session` and fallback identities are forbidden and denied. Never
  paste either token into a prompt, log, source file, command argument, or Brain entry.

**Use the `brain` skill (`.claude/skills/brain/SKILL.md`) — every call below is one command via
`node scripts/brain.mjs <status|ping|search|fact|timeline|contradictions>`; no hand-written snippets.**

1. **Orient, don't download the vault.** Run `npm run memory:status`. In cloud mode it calls the
   compact server-side `briefing` op; it does not transfer every note into the container.
2. **Drill down when needed.** Use the authenticated helpers `searchFactsCloud(filters)` and
   `contradictionsCloud()` exported by `lib/server/brainCloud.js`. Search requires at least one of
   `query`, `subject`, or `predicate`; optional `as_of` is an ISO date and `limit` is 1–100.
3. **At session end, write it back.** Use `recordFactCloud(fact,{note})` for durable facts and
   `appendTimelineCloud(date,heading,text)` for the session episode, then run
   `contradictionsCloud()` and report any conflict. These calls preserve supersede-not-overwrite
   history and authoritative credential attribution. If you skip this, the next session pays the
   context cost you just saved.

## OWNER RULE: SQL is always a copy-paste block (2026-11-01)
When the owner needs to run SQL (migrations, fixes, queries), NEVER send a .sql file or point at a file
path. Put the SQL in the chat as a plain fenced code block he can copy straight into the Supabase SQL
Editor — comments stripped, one block per migration, and say which to run first.

## DESIGN SYSTEM — locked 2026-11-02 (owner: "ditch the purple gradient… without sacrificing how good it looks")
**Read `DESIGN.md` before touching any CSS, page or component.** It is the whole system; the short form:
- **Personality: Candid. Calm. Exact.** Reference: an air-traffic control room at night — dark, every reading real, one
  thing lit at a time. Not another SaaS template.
- **Colour 60/30/10, every value a token in `app/globals.css`:** 60 dark field (`--bg`, `--surface-*`), 30 neutral ink
  (`--text-1..4`, `--border-1..3`), 10 signal = ONE flat blue on actions and the current place (`--cta`/`--cta-hover`
  for THE primary button, `--accent` text/icons, `--accent-strong` fills) + semantic good/caution/bad/info WITH a word
  and an icon. Eyebrows/labels/meta are ink (`--text-3`), never the accent. No raw hex/rgb in `*.module.css` or `.tsx`
  (only globals.css, OG/canvas renderers and SVGs may hold literals).
- **Retired for good:** indigo/violet/purple/fuchsia, any gradient mixing two colours, glow shadows, gradient text,
  glass over content, backdrop-filter on full-screen overlays, aurora orbs, a gradient primary button.
- **Type: exactly TWO fonts** — Syne 700/800 (`--display`, H1–H3 only) and Instrument Sans 400/500/600 (`--body`;
  `--mono` now aliases it; DM Mono is gone). Tabular figures are on page-wide. The `--fs-*` scale only; 12px floor.
  **One `<h1>` per screen.**
- **Spacing: 8px grid** for layout (`--sp-2/4/6/8/12/16/24`), 4px steps only inside a component, 1–2px for hairlines;
  the whole codebase was snapped to it (1,140 values). Radii `--r-*`, shadows `--sh-*` (four), widths `--w-*`.
- **Layout: one scroll per page, one filled button per screen**, less density; phone first at 390.
- **Guardrails:** `lib/ui/designRules.test.mjs` (purple, retired tokens, multi-hue gradients, gradient text, font
  count, grid, raw hex) fails the suite; `node scripts/design-audit.mjs` (h1 count, font families, filled CTAs per
  viewport, 60/30/10 pixel share) runs against `next start`; `scripts/overlap-sweep.mjs` for phone overlap.
- **Skill:** `.claude/skills/ui-ux-pro-max/` (UX rules, patterns, charts, WCAG — Python search over local CSVs) is for
  decisions INSIDE this system; never use its `--design-system` output to pick a palette or font.

## Session 2026-11-14: start guides (8, fact-checked) + search that helps you think — PR #401 (same branch)
- **Owner asks:** oilfield/trades entry "the right way, on brand, not too highlighted"; "a company, not a personal project
  … it's additional resources, not sources"; short pages with openable menus; listings with location / position / level
  filters "tailored to the field"; more pages (CDL, healthcare, warehouse, IT help desk, SpaceX, Tesla) "spot tf on";
  NOT sections of the site — reached by link or a card above /jobs results when the search matches (high sensitivity);
  "find more ways" → listing help, explain search + pay, where the jobs are, paid-training chip + filter.
- **Template:** `app/start/[field]` (dynamicParams=false) renders `lib/start/<field>.js` data modules via
  `components/start/GuidePage.tsx`; registry `lib/start/registry.js` + `ready` in `lib/start/guides.js` (tests fail if they
  disagree). Facts are `{ text, src }`; references never printed as citations — only the "Additional resources" row (a
  link repeated across references shows once). `listings: null` = no listings block (Tesla). Filters live in the URL
  (`?pos=&loc=&r=&lvl=`, `lib/start/listingFilters.js`); a position with `orTraining: true` also keeps rows the search
  flags `trains_beginners`. ENTRY_RE reads junior / Tier 1 / Level 1 / L1 / new grad / student as entry.
- **The card:** `lib/start/guideFor.js` keyword tables (strip / veto per guide; company guide beats field; longest keyword
  wins; only live guides answer) → `components/start/GuidePrompt.tsx` right above /jobs results. Look-alikes pinned never
  to open a card (pct, CNA Financial, benefits help desk, wheel loader, rocket mortgage, model y, non-CDL delivery).
- **Search support:** `api/jobs.js searchContext` (no new read: rows already in hand) → `also_searched` ("Also showing
  related titles: …" — NOT "the same job"), `pay_summary` (employer-stated only), `elsewhere` (thin place search, from the
  corpus fill's pool); paid-training chip + `training=1`; `components/jobs/BeforeYouApply.tsx`.
- **Fact-check process (reusable):** writer agents work ONLY from a research file and print only VERIFIED claims; then an
  independent checker re-verifies every printed claim against the primary page (eCFR API, BLS/OEWS, OSHA letters, SEC
  filings, the employer's own postings) and fixes the module. Results: Tesla ~110 claims / 22 fixed, IT 98 / 18, SpaceX
  ~100 / ~29, healthcare ~115 / 26, warehouse ~100 / 24, CDL ~112 / 19. Every removed value is pinned per guide in
  `FORBIDDEN` (lib/start/guides.test.mjs). `GUIDE_DRAFT=<field> node --test lib/start/guides.test.mjs` tests a draft alone.
  Lesson: the research files were wrong ~15–25% of the time; never ship a page without the second pass.
- **Owner decisions taken by me (reversible):** Tesla has no listings block (careers site refuses servers, Seen holds 0
  Tesla rows); a taken-down Sysco posting dropped; Prime's terms on BOTH trades and CDL = its current page ("pay nothing
  if you drive 1 year", exit terms not stated; the old $155/$4,475 was a 2021 blog post); unverifiable lease-purchase line
  removed (the FMCSA PDF could not be read — fetching with a spoofed browser user-agent is refused by the session
  classifier; do not retry that way). Program dates written so they do not go stale.
- **Harness:** many writers in one tree → each edits only its own file; checkpoint commits `[skip ci]` replace the PR head
  CI shows, so push a real commit after. Prod search rate-limits the sandbox IP when several agents search at once
  (`db-cooldown` empty answers) — space live checks out. Reply drafts: scratchpad `replies.md` (post only now the pages
  are live; Prime line must use the current terms).

## Session 2026-11-08: the optimizer reads the whole listing (branch claude/kind-noether-8wj48e)
- **Owner:** "most of the time the optimizer can't read the whole listing so it doesn't optimize anything." Measured
  with `scripts/optimizer-corpus.mjs` (+ `optimizer-corpus-pull.mjs`, read-only) on 324 live postings: 58.6% optimizable,
  median 5 requirements read. After: 85.5%, median 12. Fresh second sample (363): 64% → 78.5% before the Adzuna fetch.
- **Fetch never worked:** `fetchFullPosting` read `.description` off `resolveListing`'s `{ fields, rungs, blocked }`
  (the test faked the bare shape) → every teaser went to the paste box. `validateListingUrl` stripped Adzuna's
  `utm_source`; Adzuna answers 405 without it (kept for adzuna hosts only). Adzuna rows read `/details/<id>` first
  (JobPosting JSON-LD); a 404/410 there = reason `gone` → "This listing looks closed" (22 of 25 unreadable Adzuna rows
  in the sample were taken down — about a third of live Adzuna rows are dead listings; NOT acted on, owner's call).
- **Resolver rule:** a description is complete only at ≥700 chars and never from `via:'meta'` (an 805-char Lever meta
  summary had stopped the ladder before the ATS API). EU Lever boards → `api.eu.lever.co`.
- **Ingest kept only the intro for Lever** (`descriptionPlain`; requirements live in `lists`). `lib/jobs/atsText.js`
  builds the whole posting (ingest + importer); SmartRecruiters keeps section titles; Ashby prefers HTML. The dedupe
  trigger never refreshes a stored description, so `previewOnlyOrFetch` re-reads a saved posting that reads as no
  requirements (once per job per instance per 6 h, kept only when ≥300 chars longer). Old Lever rows heal on use.
- **Reader:** `lib/optimizer/postingTerms.js` — requirement objects, example lists (alternatives, linked to the
  requirement they illustrate), acronyms + long form; never benefits/schedule/degree/licence rows, the title, the
  employer, negations, adverbs or run-ons. Facts carry `term` + `normalizedLabel 'term:…'`, matched by stems on one
  résumé line (`matchTerm`), `hard:false`. jobInsights shows them as written, after the recognised skills.
  `ENGINE_VERSION` seenfit-2.2.0. Non-software postings keep a plainly named language (C++, Python, SQL).
- NOT verified live: a production fetch from Vercel (sandbox only), the Optimize sheet's "closed" copy in a browser.
- **Round 2 (owner: "must parse any and every application… state of the art"):** live bench over 14 career-site
  systems → `lib/server/pageText.js` (posting from script data incl. Taleo `api.fillList` URL-encoded HTML, a
  description container, or the body — container/body need real section headings; job lists and sign-in pages
  rejected); Oracle `recruitingCEJobRequisitionDetails` JSON (empty items = closed); Workable api/v2 (unverified:
  sandbox IP rate-limited); iCIMS `?in_iframe=1`; closed = ATS API 404/410, redirect to `?error=404` (Jobvite), or a
  "no longer available" page. Any paste box takes a LINK (`postingLink`/`readPostingLink`, 30-min cache).
  `lib/optimizer/pastedText.js` strips copy artefacts (quotes, email headers, markdown, board UI lines, odd bullets,
  hard wraps, inline bullets) — `scripts/optimizer-paste-stress.mjs`: 0 loss on 6 of 7 formats. Sparse postings
  (<5 stated) read duty objects (`extractDutyTerms`). 682 postings: 83% optimizable, the rest mostly closed Adzuna ads.
  Not handled: LinkedIn/Indeed/SAP-jobs pages (datacenter walls; the r.jina.ai rung is untestable from the sandbox),
  Workday tenants answering 403, non-English postings.

## Session 2026-11-12 B: "make everything lightning fast" — PRs #394, #395 (same branch)
- **Owner:** settings save slow then fails; location needs an auto-filler with one fixed format; matched jobs take
  forever; "make everything lightning fast"; Optimize "Download this version" must save the .docx (View it below),
  offer re-optimize, and say why each job stays.
- **#394 (dc0836d, live):** `components/ui/LocationInput` + `GET /api/places?q=|resolve=` (local Census places, no DB;
  verified live: "phoe" → "Phoenix, AZ", "boise id" → "Boise, ID") on job search, homepage, Settings city, alerts.
  Optimizer: prefetched one-tap .docx, View it / PDF links, re-optimize ≤3 variants (free for a paid build, guarded
  by `verifyPaidExport` against the SERVER-computed key — a client-sent key in the guard was CodeQL "user-controlled
  bypass"; the token is now verified on every optimize request before branching), per-role reasons (roleReasons.js).
- **#395 (84e42bd, live, 0 runtime errors after deploy):** search pool reads never select `description` (exactTop
  fetches postings by id only for rows that can reach the page); radius ORs split at 15 patterns; search reads have
  their own 16-in-flight limiter + 6 s timeout; user-sync/job-insights 6 s deadlines + 503 "took too long";
  `sessionStillValidCached` (30 s per token — "Sign out of all devices" reaches other devices within 30 s, owner
  told); load_profile names its columns (never job_keys); Settings save 8 s + Retry; `lib/sync.ts` 12 s client
  deadline; GPS place → "City, ST".
- **The slow search was ONE read, found on production data** (handler run locally against prod with every write
  refused + per-call timing; the CPU profile was idle): `buildFallbackFilter`'s "phrase OR any one word" matches most
  of `jobs` on a common word and ran past its limit on every "software engineer" search (results then depended on
  whether it finished). Now `{ every: and=(all words), any: or=(…) }` — `every` beside the other reads, `any` only
  when the ranked pool is thin (`kept.length < TARGET`). 7 prod searches vs the old code with that read allowed to
  finish: 6 identical, 1.1–5× faster. Live after deploy: remote "software engineer" 11.9 s → 5.9 s cold / 1.1 s warm.
  Rule: a PostgREST OR over single common words, ordered by score, is a table scan — never on a request path.
- **Still slow, owner's call:** cold reads of `jobs` (3–5 s for a title read that takes 0.3 s warm) — heavy dead
  space when last measured (Oct); `VACUUM` not run. Matched-jobs instant cache needs the `matched_jobs_cache` SQL.
- **Harness:** CodeQL ConditionalBypass did NOT reproduce locally (bundle 2.27.4) — fix by structure, push, read the
  check; FileAccessToHttp did (source: bundled `us-zip-places.json` → the jobs fetch wrapper; left for the owner).

## Session 2026-11-12: production incident — one signed-in page load stalled the database (PR #393, same branch)
- **Seen in production logs (Vercel, after #392 deployed):** two episodes (2026-11-11 09:33 and 15:46 UTC), one user each
  time: every `/api/jobs` call timed out at 60 s and that user's `/api/user-sync` calls at 15 s; even the rate-limit
  call to Supabase was aborted. Nothing else ran in those windows — the user's own `/jobs` load caused it.
- **Cause 1, the matched-jobs rail's read (`lib/server/resumeMatches.js`):** it sent 14–30 reads AT ONCE per load, each
  OR-ing up to 77 `ilike` terms (the planner drops the trigram index past ~12 — measured in areaSearch.js) and pulling
  `description` for up to 1,000 rows, with no timeout. A few reloads ≈ 100 such queries. Now `readRailCandidates`:
  the area through `readAreaRows` (the place search's reader: ≤4 reads in flight per instance via the shared
  `queuedRead` limiter, ≤15 terms a read, light columns, 5-minute per-instance cache — the rail can lag new listings by
  up to 5 min), the person's own city word, one US-remote read, title words judged IN MEMORY, then full rows by id
  (`id=in.(…)`, 200 at a time). `serviceDb` calls time out at 12 s. Rule: no read of `jobs` from a request path may OR
  more than ~15 patterns, select `description` outside a by-id fetch, or skip the shared limiter.
- **Cause 2, CPU:** one rail request cost ~35–43 s of CPU (profiled with `node --cpu-prof`): `matchListing` ran the
  WHOLE posting reader (`statedMinimums` → `extractJobFacts`) on nearly every listing in the radius, just to test for
  "retail or restaurant experience". Now gated by the same phrase on the raw text (`ALT_FIELDS_RE`) and by a unit of
  time (`DURATION_RE`); `aliasEntriesFor` (lib/optimizer/lineProof.js) re-normalised every alias name per call — now an
  index built once + memo. The rail also stops matching at 18 s (email 60 s) and says `partial`. Result: 3.5–5× less
  CPU, ≤4 reads in flight; the fit check itself is 1.9× faster for every tool.
- **Proof of no behaviour change:** matcher 0 differences over 30,688 answers (16 résumés × 959 postings × 2 modes);
  `statedMinimums` 0 differences over 1,280 postings; `runOptimizer` byte-identical over 960 pairs; matched-jobs scores
  identical to the merged tree on all five people sets; `resumeMatches.readFinds.test.mjs` (every listing the rule
  accepts is read) passes — its fake now uses uuid ids and understands `in.` and id ranges like PostgREST.
- **Found on the way — place search bug from #392:** `areaTextPatterns` read places by their OFFICIAL Census name only,
  so "Boise City", "Nashville-Davidson", "Indianapolis city", "Louisville/Jefferson County", "Urban Honolulu" and the
  Massachusetts "… Town" names never matched listings written "Boise, ID", "Nashville, TN"… without coordinates. Now
  each place carries `alt` (the data's aliases + `everydayBare`), each name judged for ambiguity on its own; names the
  kind word belongs to ("Jersey City", "Carson City", "Charles Town", "Oklahoma City") are never shortened.
- **Harness:** the Supabase Management API token in the cloud env answers 401, so `pg_stat_statements` is unreadable —
  the cause was found from Vercel runtime logs + a CPU profile of the real code against a fake PostgREST
  (`scratchpad/bench-rail.mjs`). A worktree of the merged tree (`git worktree add … origin/next-migration`) is the
  baseline for every before/after comparison.

## Session 2026-11-10/11: the tools program — one fit engine, claims, matched jobs, admin rebuilt (PR #392, same branch)
- **Owner mandate:** "focus purely on our tools like the optimizer… undeniably blown away"; matched-job emails must be
  "spot on" (a security listing asking 3 years went to someone who never worked security); search by place alone; admin
  "from ground up… It must just work". Built by Opus agents under one director; every number below is on data NOBODY
  tuned against unless it says otherwise.
- **THE LESSON (cost most of two days):** a set an engineer can see reads 97–98% and means nothing. Reader 97.3% right
  on the tuned set vs 84.8–92.1% on untouched postings; matcher rail 98.3%/82.6% tuned vs 80.0%/21.8% untouched; the
  judge credits ~42–57% of what a recruiter credits everywhere. A hidden set you steer by is spent after one look —
  keep a fresh one for acceptance, show builders principles and aggregates only. Two independently built judges, a
  clean-room second matcher (`lib/server/match2/`, its field stage kept for rail recall) and a paraphrase-knowledge
  round all hit the same ceiling: recall on new language is not reachable by more rules.
- **The product answer to that ceiling — claims** (`lib/optimizer/confirmations.js`): on any line read not shown /
  partly (never a years ask) the person taps "I've done this" / "I hold this". `confirmed:[{statementId, answer, claim:
  true}]` → status shown, `by:'you'`, `claimed`, evidence carries NO résumé line ("You said you have done this — it is
  not on your résumé yet."). The headline counts claims apart ("…you said you've done 2 more that aren't on your résumé
  yet — add them"); the paid build asks the claimed lines first and adds a line only from the person's own words. No
  answers → the reading is byte-identical; the cache key carries claims.
- **One reading, one verdict:** `runOptimizer` (lib/optimizer/index.js) → statements `{id, text, status
  shown|partly|not_shown|cannot_tell, evidence[{line,why}], missing, kind, importance}`; every tool (free check, paid
  Optimize, Studio, Prep, Insights, matched jobs) reads THAT. Reader = `statements.js` + `extractJobFacts.js` +
  `statementGate.js`; gates = `constraints.js` (`isHardGateFailed` / `refusingGates` is the ONE definition of a failed
  hard requirement: years in the right kind of work — `NEAR_YEARS_SHARE` 0.7 is "partly" —, degree by subject, licence
  current + state + rung, clearance, language, eligibility, recency, title-only conditions); `explainScore.js` holds
  the band invariant (the headline agrees with its own lines: `AGREE_GOOD` 0.70 / `AGREE_STRONG` 0.85).
  `rolesFromText` (extractResumeFacts.js) is the ONE résumé role reader — jobKeys' own parser dropped the first/current
  role in all twelve header layouts (pinned in g5.test.mjs), which three matcher rule rounds failed to find because
  they patched rules instead of checking what the layer below handed them.
- **ENGINE_VERSION history** (`lib/optimizer/types.js`, now `seenfit-2.11.0`; it keys every cached output): 2.3 one
  reading; 2.4 statements judged on résumé lines; 2.5 display gate; 2.6–2.7 list handling; 2.8 a list judged as a list,
  refusal on foreign/shapeless postings; 2.9 list lead-ins, Part markers, credential cues; 2.10 a shape/confidence gate
  that HID lines — reverted in 2.11: on untouched postings it hid ~70 real lines to remove ~15 bad ones. Repairs stay,
  hiding is gone; a one-block posting is a fact with a note (`structure:'flat'`, `posting_note`).
- **Matched jobs:** `profiles.job_keys` (+ `job_keys_updated_at`; migration `20261110120000_profiles_job_keys.sql`, NOT
  applied — the code rebuilds per request without it), `lib/server/jobKeys.js` (`JOB_KEYS_VERSION` 10), rebuilt on a
  résumé save and on applications. An email headline needs POSITIVE evidence at every point (latest role is the basis,
  every stated requirement shown, a positive match on any stated schedule/place want, fit Good+ on the full text) —
  else no email (`no_positive_match` in the cron's diagnostics). Unseen people: rail 80.0% precise / 21.8% recall vs
  the live matcher's 30.8% / 7.3%; wrong headlines 1 of 5 vs 3 of 5; 0 false facts. Honest label: better than live,
  not at target (thin rail, quiet email for occupations it has not met). Search by place alone works; radius is
  measured from town coordinates.
- **Shared knowledge with trust contracts:** `lib/occupations` (O*NET-derived; exact → fact, close → use unless
  contradicted, guess → tie-break, null → unknown NOT different), `lib/text/{tradeTalk,sameAct,workFamilies,synonyms}`
  + `lib/text/data/**` (in vercel.json includeFiles; `lib/occupations/shipping.test.mjs`);
  `GET /api/optimizer?health=1` says whether a deployment can read them.
- **Admin is rebuilt:** `/admin` = `components/admin2/{core,sections,ui}` on `api/admin-stats.js` +
  `lib/server/admin/*` (contract in `SHAPES.md`). No reloads; a result shows where the person is and in a dock with
  Undo; history per section (no dead ends). Bulk actions are idempotent JOBS (`request_id` + `round`; a lost answer is
  re-asked via `job_status`, never reported as failed). "Approve all positive (N)" shows N only once the duplicate
  check is complete (`counts` / `checked` from the server, `dupCache.js`) and N never changes after; a 1,040-report
  Undo is one grouped PATCH round (was 182–401 s). A follow-up job the app starts itself is `quiet` (never opens the
  Jobs sheet). Migrations `20261111100000_admin_core`, `…110000_admin_rpcs`, `…120000_admin_health`,
  `…130000_admin_dup_checks` NOT applied; verified ONLY on the rig (fake PostgREST with the 1,000-row cap and 8 s
  statement budget), never on real Postgres.
- **Admin acceptance (independent judge, build 4b7dc58, rig only):** "it just works — yes, with two conditions". Approve
  all right at 140 / 340 / 1,240; every sheet leaves by ✕ / Esc / outside tap / phone Back (52 combinations); no
  reload after any action; forced 500 / 504 / empty / 401 answers end in the truth, once. Condition 1 fixed after
  (58c7f0e): a job a reload interrupted read the server ONCE, while its last round was still running there, and then
  said "0 deleted, 1,300 left" beside an empty table — it now re-reads every 5 s (15 times, `RELOAD_RECHECK*` in
  core/jobs.ts) until it settles. Condition 2 OPEN: a 1,240-report approve shows no count while the write runs (43 s at
  250 ms per DB call; 16 s at 60 ms). Also open: on the phone a result shows inline AND in the dock.
- **Rules that came out of it:** a tool states nothing the résumé does not state — a near-miss is "the closest I have
  done", never proof; a role header never proves a duty; a different-field posting is not charged
  (`questionsNote` / `DIFFERENT_FIELD_NOTE`); the Insights tip reads the signed-in person's résumé for their answer
  only and the shared cache row never holds a person's words; a detail question is asked only with a reason and always
  ends in a line or one sentence saying what is needed.
- **Harness:** a stop hook demands a push per turn → `[skip ci]` checkpoints between full runs (GitHub's default squash
  message lists every subject — hand-write the merge message or CI is skipped on the merge commit); sign checkpoint
  commits (`commit-tree -S`); an `env -i` build of a COPY needs its own `node_modules` or npx tries the registry;
  stamp logs from `date -u`, never a guessed time; after a container restart resume agents by id and check for one
  that stalled silently.
- **Not verified live:** anything on real Postgres or production (admin, the matched-jobs cron, a signed-in Insights
  call, a paid export, a prep write), a real iPhone.

## Session 2026-11-02: design system locked + persona acceptance rounds (PR #389, branch claude/alerts-radius-security)
- **Owner asks, in order:** ditch the purple gradient ("vibecode slop") → do it with the ui-ux-pro-max skill and the five
  anti-slop rules without losing the look → "run the whole layout through the skill… test with agents until they approve
  and perceive a legitimate company; every feature must be tested." The design system is `DESIGN.md` (section above).
- **Acceptance rounds** (reusable pattern): four personas — Maria (retail lead, phone 390), Dev (backend engineer,
  desktop 1280), Tasha (newcomer, fresh signup, phone), Jules (senior designer, both widths) — each with a brief in the
  session scratchpad `roundN/BRIEF.md`, a real account (`<name>.r1@seenjobs.io`, password in `round1/.password`, never in
  chat/files), real résumés in `lib/fixtures/personas/`, Playwright against the PR's Vercel PREVIEW via
  `get_access_to_vercel_url` share link (visit it once per context), outcomes only on "Northwind Test Labs", no payments.
  Score table (legitimate company? trust? taste? come back? APPROVE?) + feature table + ranked top 10 + bugs. **ONE
  browser context per persona, signed in once** — several contexts sharing one Supabase refresh token rotate each other
  out and read as "session expired".
- **Round 1 (dpl_3toMfD9m): 4× NO, legitimacy 6/10 each.** What cost trust (all fixed in 10858e0…41610a7): counts that
  disagreed page to page (home / data / ghost-report totals; Amazon 26/49/43), any string rendering a full company page,
  emoji icons, blue eyebrows on ~16 pages, 7 filled buttons on /employers, a 9-target jobs card, lime swipe deck,
  three-brand auth emails, Remote search with non-remote/non-US rows, Adzuna estimate shown as pay, Tailor charging for
  70→70, "Aaa"/"Group On" casing, a share-card popup after a rejection, day-one upsell crowding, guest saves vanishing at
  sign-in. Fixers ran in parallel on disjoint file sets; every rule they enforced became a test
  (`lib/ui/designRules.test.mjs`, 13 tests) or an audit check (`npm run design:audit`, 24 pages × 2 widths).
- **Durable product rules added:** every count on a page says what it counts; unknown companies get an empty state with no
  CTAs and are not remembered; the homepage total is the open dataset's (same as /data); a Tailor that cannot raise the
  score is free and says so (`no_gain`); guest device data is offered (Keep/Discard), never auto-imported; nothing opens
  itself after an outcome; Interview Prep is collapsed to one line until tapped; `honestSalary()` hides pre-2026-10-20
  Adzuna rows' pay and sub-wage lines; Remote = location/type or a plain statement near the top of the text;
  `adaptive_pricing[enabled]=false` on every Checkout session; the fixed nav is solid when scrolled.
- **Rounds 2–3 (2026-11-03, previews 41610a7 → 708afbd):** R2 Jules 8 "yes after 3 fixes", Dev 7, Tasha "no — close",
  Maria 7, all NO; R3 Dev 7/7/8/6, Tasha 7/8/7/6, Maria 7/6/7/5, Jules 8/7/8/6, all NO — the deciding items were the SAME
  across testers: three graded counts (345 / 401 / 384), the drawer's one filled button clipping to "Ap…", the swipe
  deck under the phone tab bar, Settings dirty on load, and Optimize printing word stems ("knowledg / navigat").
- **Round-3 root causes (fixed in 216b15d, 5e2b4c7, f1c2e0b):** the leaderboard's graded total selected no mention
  column AND read one capped PostgREST page (1,000 rows whatever `limit` says) — every "count everything" read must
  keyset-page (`order=id.asc&id=gt.`) and use the one gate from `lib/server/openDataRead.ts`; Apply and Optimize shared
  one flex class (`.grow`) so the filled button had no priority — the filled button is `.main { flex:1 1 auto;
  min-width:max-content }`; the swipe deck's CSS height assumed a fixed deck top — it now measures itself (`deckH`);
  the résumé city was typed INTO the Settings field (dirty form) — a suggestion is a button under the field, never a
  value; `domainOfYearsSentence` returned stems that constraints.js printed — matching uses stems, copy uses
  `domainWordsOfYearsSentence`; the jobs pool read was unordered + capped, so widening the radius changed WHICH rows
  filled the cap (10 mi had Tempe Walmart, 25 did not) — every pool read is ordered and the title read is separate
  from the `search_query` stamp read (`api/jobs.pool.test.mjs`); DashMart "$2/hr" was the CLIENT parsing "$2/hour
  premium" from the description (`isAddOn` in lib/jobs/pay.js; MIN_HOURLY is the one floor); a second report by the
  same user on the same company within 30 days is HELD (`duplicate_user_company`) — quick_submit now answers `held`
  and the toast says it will not change the grade (three personas "saved" Northwind reports that never appeared);
  Pro-days `too_new` judges `applications.created_at` (added to the tracker), never the applied date — the copy says so.
- **Durable rules added in round 3:** one `possessive()` (lib/companyNames.js) — never "Fry's's"; a legal suffix glued
  to one slug word is the name (Labcorp, not "Lab"); the homepage LIVE strip shows graded companies only (feed rows carry
  `graded`); micro-survey never over an editor (/resume/studio, /profile); the prep panel is collapsed on EVERY load;
  "Not yet" promises nothing ("nothing recorded"); an unknown company page offers `name_suggest` prefix matches
  ("Did you mean Fry's Food Stores?"); Odometer prints thousands separators; /data caps at 60 rows + Show all; the
  tracker's current stage is a tint (one --cta fill per screen); Verdict/Optimize panels carry no green tint.
- **Round 4 (f1c2e0b, dpl_CTWkRdSkRoDcWibwMH4GdoNvXyF1): ALL FOUR APPROVED.** Tasha 8/8/8/7 YES (both clipped controls
  fixed); Jules 9/8/8/6 YES (every count agrees, system holds on 62 captures); Maria 8/7/8/6 YES (paid Optimize reads as
  words and says what the credit bought); Dev 8/7/8/6 yes-conditional (counts agree everywhere; condition = the blank-title
  Tailor summary stating "most recently at H-E-B Digital", a 2018–2020 role). Regressions my fixes introduced, fixed in
  4c299a2: the Optimize button clipped once Apply kept max-content (`.grow` basis 0 → `1 1 auto`); the swipe deck's
  self-fit floor was 150px and the excerpt ran over the footer (floor 212/260); Settings "Save changes" sent nothing when
  the name was blank (the email-prefix name is shown as none, and saveProfile refused a blank name — the name is now
  optional in the save); the Optimize sheet opened on a cached pre-fix result (CACHE_VERSION = ENGINE_VERSION — bump
  `lib/optimizer/types.js` whenever requirement wording changes); the flat-text splitter glued "Key Responsibilities CRM
  Platform & Database Management Keep…" (heading / Title-Case sub-heading / imperative duty line are three blocks). Round
  5 (4c299a2) is a confirmation round.
- **Rules from round 4:** a company page with listings but no accounts shows "Did you mean …" (`name_suggest`) and NO
  Track / prep CTAs (`nothingFound`); the Tailor summary's "most recently at" is the latest-ending role, never the
  best-ranked; a blank Tailor title is inferred from the posting (`inferJobTitle`) before the family is decided; the
  tracker shows both the held-report line and the Pro-days line; /report shows a `?company=` slug as a name.
- **Round 5 (4c299a2, confirmation): Jules YES (9/8/8/7); Tasha NO on one item; Dev and Maria YES on one condition.**
  Both were regressions from my round-4 fixes, found by the testers, not the audits: (1) the swipe deck's phone floor
  equalled its cap, so the self-fit was a no-op and ✕ ↑ ♡ sat under the tab bar whenever the sort select pushed the deck
  down — the deck now scrolls the page once on mount when the room above it is short (`window.scrollBy`), probe at 390:
  actions end 728 < tab bar 777; (2) the drawer's Optimize tap called `onClose()` AND the page's `onApply` closed the
  `?job=` place again — two `history.back()` in one tap, the page left /jobs with no sheet; now ONE close and the sheet
  opens via `afterPendingBack` (lib/nav/urlState.ts). Rule: a handler that closes a URL place must be the only close in
  the tap, and anything pushed after it waits for `afterPendingBack`. Fixed in 2521834; round 6 = two-item re-check.
- **Also round 5:** prep "Why site reliability engineering now?" (several qualifiers before the role noun); a company page
  with no score row shows Track / prep only once it has accounts (the CTA flashed during the reports read and fired
  `offer_shown` on empty pages); flat posting text also splits a Title-Case sub-heading sitting mid-block after a
  sentence (`MID_SUBHEAD_RE`); completed tracker stage steps carry a ✓ (semantic colour always with a glyph).
- **Round 6 (2521834, two-item re-check): ALL FOUR APPROVE, no conditions.** Tasha 8/8/8/7 yes (deck scrolls to 95 on
  mount, buttons 676–728 above the 777 tab bar, a real tap advances the card; drawer Optimize: URL stays, sheet opens);
  Dev 8/8/8/7 yes unconditional (drawer Optimize 129 ms, one Back returns to the list, from a fresh `&job=` load too);
  Maria 8/9/9/6 yes (same, plus the credit prompt "Use 1 credit / Not now" spends nothing on Not now). Jules approved in
  round 5. Follow-ups from their nits in 43aa697: an unseeded company page shows Track / prep only after the live read
  (the CTA was in the server HTML under a skeleton hero for ~350 ms); the cached Optimize note names "the earlier credit".
  Still open, reported not fixed: "team lead" Phoenix ranks Oscar Health / Jencap above Walmart for a retail résumé whose
  `profiles.industry` is unset (the fit boost reads resume_skills / profiles.industry); the Optimize summary "9+ years"
  beside the fit line's "10.7 years"; health rises after a rejection (a rejection counts as a reply); /feed rows that read
  scraped and the owner-side companies (Backend, Lab, AAA, Northwind test rows).
- **Harness (round 3):** the container restarted mid-pass — resume stopped agents with SendMessage to their ids (the
  working tree persists; fixers that had not written yet lost nothing). A checkpoint commit may exclude a fixer's
  in-progress files; never commit a tree with that fixer's own pins red. CodeQL alert annotations are readable via the
  PR's review threads (`pull_request_read get_review_comments`), not the check-run text.
- **Round-1 items still owner-side:** Supabase auth email templates (`supabase/email-templates/` + README; the Management
  API token in the cloud env answers 401); confirm-email landing on prod; Stripe currency verified only by code.
- **CodeQL:** the design commit touched 100+ files, so scanning surfaced 51 old alerts. Every data-driven link now goes
  through `httpHref`/`pathSegment`; the EmployerGradeChip sink was the TITLE text (found only by running CodeQL locally:
  bundle in the scratchpad + a `{"type":"commonjs"}` package.json beside it when the scratchpad has an ESM package.json).
- **Harness:** `git add -A` swept the testers' scripts into a commit → `scripts/_*` is git-ignored; `pgrep -f "next start"`
  matches your own shell (exit 144) — use `pgrep -f "^next-server"`; killing the npx wrapper leaves next-server alive on
  the port and a stale server serves HTML whose CSS hashes 400 (check every CSS bundle is 200 before trusting a run).

## North Star
Read SEEN_STRATEGY.md at the start of every session. That document is the product strategy.
Every code change must serve the strategy. When in doubt, re-read it.

## Core Mission
Build Seen as a hiring intelligence platform where the application tracker is the primary data acquisition engine, outcome cards drive virality, and trust/confidence systems keep data quality high.

## Active Development Branch
- Migration work is on: `next-migration`
- `main` is the OLD production HTML app — now the SOURCE OF TRUTH for design/functionality parity. DO NOT merge into main, DO NOT push to main, DO NOT delete it.
- **seenjobs.io now serves the Next.js app from next-migration** (deployed via Vercel CLI from owner's Mac)

## MISSION HISTORY: parity restoration is DONE — feature/growth era since 2026-06-30
The "full parity restoration" mission (2026-06-12 → ~06-23) is complete. Since 2026-06-30
the work has been feature, growth, monetization, and reliability development on
`next-migration` — 50 PRs (#75–#124) landed 2026-06-30 → 07-02. The landing page (PR #77)
and dashboard (PRs #122/#123) were intentionally REDESIGNED beyond the old site; do NOT
"restore" them back to `origin/main` parity. `origin/main` remains useful history but is no
longer the design source of truth for redesigned pages. `SITE_PARITY_CHECKLIST.md` /
`ADMIN_PARITY_CHECKLIST.md` are frozen pre-06-30 records, not an active work queue.

## Session 2026-11-01 B: job alerts, free radius data, upload + security hardening (PR #389, stacked on #388)
- **Radius:** `lib/geo/usPlaces.js` (+ `lib/geo/data/us-places.json`, `us-zips.json`; public-domain Census 2024
  Gazetteer + USGS GNIS, rebuilt by `scripts/geo/build-us-places.mjs`) places location TEXT locally; api/jobs.js
  measures every row (own coords, else its text) and reads nearby towns from the DB; `upsertJobs` fills missing
  lat/lng. Old rows: `scripts/geo/backfill-job-coords.mjs --write` (not run). vercel.json `includeFiles` carries
  `lib/geo/data/**` for every function that reaches it. Not yet using it: resumeJobMatch `jobNearCity`,
  resumeMatches `geoScopeClause`, demand.js.
- **Job alerts:** Settings → résumé matches / only my alerts (≤5: keywords + place + 10/25/50/100 mi) / off.
  `lib/server/jobAlerts.js`, user-sync `job_alerts_get|save`, cron-job-matches alert mode. Migration
  `20261101120000_job_alerts.sql` NOT applied (section hidden until it is).
- **Uploads:** `lib/server/archiveGuard.js` (DOCX: 10 MB unpacked, 1,000 entries, 100:1, 5 s, CRC, no nested zips);
  PDF pre-scan + pdf.js in a worker killed at 5 s (`lib/resume/extract/pdfWorker.js`). Python deliverable in
  `security/zip_guard/`.
- **Security (audit, partly cut off by a safeguard; finished as a fix-only pass):** employer claims never auto-approve
  (verified auth email shown to the admin); submit_answer only takes questions the account was asked;
  `save_profile` no longer takes email/type; migration `20261101130000_profiles_server_write_only.sql` (profiles
  writes service-only — NOT applied); `lib/server/pgrest.js` for every user value in a PostgREST filter
  (`orLiteral` inside or=()); `lib/server/safeFetch.js` for user-supplied URLs (connect-time IP check, redirects
  re-checked, size/time caps); `lib/server/escapeHtml.js` for email HTML; legacy apply mails only the verified
  account email, per-user limit; next 15.5.28.
- **Résumé export:** qualified experience headings ("Relevant … Experience") + two experience sections kept
  (`role.group`, `experienceGroups`); optimizer notes never printed in a résumé (no `appendix`); built-in font text
  always sanitized.
- **Data fact (owner decision pending):** live scored reports = ~79% `web_search_public_review` paraphrases of
  public review pages (≈3,200 Glassdoor, 466 Blind, 90 Indeed — Glassdoor/Indeed are EXCLUDED sources since
  2026-10-20 but these older rows still count), ~20% Reddit, ~0.5% Seen users. Meta description now says "public
  applicant accounts and reports from Seen users".
- Verified: suite 2470/2470, tsc, next build, nav smoke 28/28, overlap sweep clean, job-page buttons 320–390px.
- **Fonts ship with the site** (`app/fonts/*.woff2` via `next/font/local`, OFL): on Vercel, Next 15.5.28's
  `next/font/google` loader threw on a Google font link with no file extension and failed the build twice. Never
  go back to build-time Google font downloads.
- **Black screen after Apply (iPhone):** Apply opens the employer's site AND the "Did you apply?" popup; its full-screen
  backdrop-filter + an entrance animation started while hidden left a dark overlay with nothing on it. Rules: NO
  backdrop-filter on any full-screen overlay (solid dim); `html.tab-hidden` (NavMemory) finishes animations while hidden.
- **Saved résumés (owner 2026-11-01):** `public.resumes` (migration `20261101140000_resumes.sql`, NOT applied; server-only,
  backfills one default per profile). Free 1 / Pro 5 (`MAX_RESUMES_FREE/PRO`); Pro = any active `ai_credits.pro_until`
  (Interview Prep 14 d, Pass 30 d — there is no monthly Pro any more). Lapsed Pro: nothing deleted, only the default usable.
  The default is MIRRORED into `profiles.resume_text` so every old reader is unchanged. `lib/server/resumes.js`
  (`handleResumeAction`, `resumeForApply`), user-sync `resumes_list|resume_get|resume_create|resume_rename|resume_delete|
  resume_set_default`; UI `components/resume/{ResumeLibraryPanel,ResumePicker,ResumeView}.tsx`; picker in the Optimize sheet,
  /resume and Apply-on-Seen (`resume_id`, checked server-side).

## Session 2026-11-01: "be more like Indeed" — navigation that remembers where you came from (branch claude/like-indeed-nav)
- **Owner bug:** the Day 7/14/30 check-in email ("Did X get back to you?") opened `/report?company=…`, not the
  application. Now `trackerAppUrl(SITE, app.id)` → `/tracker?app=<id>` (`lib/server/outcomeEmails.js`); the tracker
  reveals + EXPANDS that card. Signed out with a uuid `?app=`/`?prep=` → `/login?return=/tracker?app=<id>` (the
  login's `safeNextPath` drops `#hash`, so return paths use query params, never `#app_`). Apply-on-Seen applicant
  emails also link `/tracker?app=<id>`; employer emails `/employers/dashboard?tab=listings`.
- **ONE navigation toolkit, `lib/nav/`:**
  - `urlState.ts` — `useUrlPlace(name)`: an open item is a query param with a PUSHED entry (Back closes it; Back from
    another page reopens it; close goes Back when this page pushed it, else clears in place). `replaceParam` for
    tabs/filters/the tracker's open card. `replaceSearchKeepingPlaces` (useJobSearch.writeUrl) keeps `?job=`.
    `useScrollMemory(ready)` saves scroll per URL (place params ignored) and restores once rows render; it does not
    save before the restore (the router's scroll-to-top would overwrite it). `useBackDismiss(open, onClose)` /
    `ModalPortal onBack=` / `Dialog` (dismissable) — a popup owns one same-URL entry so phone Back closes it.
  - Closing a popup from inside NEVER calls history.back() (it raced a router.push made in the same tap): the entry
    is marked `__seen_dead`, and `installBackOverClosedPopups` (NavMemory) steps Back over dead / orphaned popup
    entries; the next popup or place reuses a dead entry. `closeParam` (drawer ✕) does go Back, and pushes made
    meanwhile wait via `afterPendingBack`.
  - Next 15's patched pushState only syncs its router when the state passed in has NO `__NA` — pass our own object
    (`ourState()` copies only `__seen_*` keys), never `history.state`.
  - `backTrail.ts` + `components/shell/NavMemory.tsx`: a per-tab trail of visited URLs → `useBack(fallback, label)`
    ("Back to results", goes Back only when the previous page is Seen's — replaces `history.length > 1` /
    `document.referrer`), `lastJobsHref()` (Nav/TabBar Jobs link brings back the last search).
- **/jobs:** the open listing is `?job=<id>`; the last 3 searches (results, pages, labels) live in sessionStorage
  `seen_search_cache_v1`, and a search restored from the URL is shown as it was for 30 min with no refetch;
  `JobCache.setMany` merges (cap 300). Sign-out clears `SESSION_TAB_KEYS` (job cache, search cache, trail, last
  search, scroll) from sessionStorage.
- **Sign-in links carry the page** (Nav, TabBar, palette, drawer, job page, ApplyOptimize, GuestTracker, employer
  listings, forgot-password → /reset?return=).
- **Verified:** `scripts/nav-memory-smoke.mjs` (Playwright, 390px, every /api stubbed) 22/22 on `next start`:
  open/Back/scroll, listing page → Back reopens over the same list with 0 new searches, full-page-load Back, popup
  Back, ✕ then one Back leaves, drawer → company preview → Back, signed-out email link → sign-in with return.
  NOT verified live: a signed-in tracker deep link (no session in the harness), a real email tap.

## Session 2026-10-27 E: round 7 — 4/4 yes again, but #383 shipped two regressions; PRs #384, #385
- **Round 7 (live, after #383/#384):** Maria 7/7 prep YES, Dev 7/5 Pass YES, Tasha 7/7 prep YES, Ray 8/6 prep YES. Worth-it
  fell for Dev and Ray because all four hit the same two breaks, and three of them traced the cause themselves:
  1. **A rebuild that parked a note was never saved.** `givenKey` used a NUL (`\u0000`) as the blank marker and #383
     stored it in `pack.noteKeys`; Postgres jsonb refuses NUL (22P05); the build's upsert was `.catch(() => null)`, so the
     API answered `cached:false` with a pack no device would ever see again (Tasha's row: `updated_at` = her last fill,
     the rebuild's `built_at` never landed; Ray: the rebuild BACK to the original, with no notes, persisted). Fixed in
     #385: marker `␣` (U+2423), write checked + one retry + `console.error('[interview-prep] prep write failed …')`, the
     answer carries `saved`, the card says so. **Rule: never `.catch(() => null)` a write the user is told succeeded; and
     any string that goes into jsonb must be NUL-free.**
  2. **The save on leaving still took the async path.** Chromium fires `pagehide` BEFORE `visibilitychange` on a reload
     or back tap (Dev measured: beforeunload → pagehide (visible) → hidden), so the round-6 "page is hidden" check sent the
     save to the queue (`await aiHeaders()` → page gone). The `urgent` flag added for that was then DROPPED by the
     editors' `onSave={vals => onFill(q, vals)}` lambdas — verified on the #385 preview (reload at 300 ms and back at
     150 ms: 0 requests). Fixed: `onSave={(vals, urgent) => onFill(q, vals, urgent)}`, `saveFill(q, values, urgent)`
     sends one keepalive request with cached headers, and the editor flushes on unmount (an in-app tab tap is a
     client-side navigation with no pagehide — Ray).
- **Also fixed in #385:** email marketing / testing / deliverability rows deduped into one (sameThing needs 2 shared
  stems); the duty "Lead, train and develop associates" shown when training/leadership rows cover it; a years-requirement
  row from `ctx.constraints` ("You show 5.6 years of supervisory experience (asks 2+)"); customer-service proof = the
  complaints/refunds line (every distinct alias counts, SAME_THING += complaint/escalat/refund/resolv/satisfaction); hints
  need a shared word or an outcome line with a number; résumé-fact evidence prefers the doing bullet over a trained-
  others bullet (`extractResumeFacts`); a fraud/privacy footer is EEO text (`EEO_RE`), never "LinkedIn"/"sales"
  requirements; `availabilityLine` drops on-call/travel/rotation; `OPTIMIZER_VERSION = 'optimizer_v4'` (round-5 cached
  packages never served first); the composed summary keeps at most ONE old sentence; Strategy `postingReqs` uses the
  anchors; `api/resume.js _seenIntel` and the Strategy timing note omit "average wait 0 days"; pay band parse strips a
  trailing full stop; `impliedChecks(stage)` keeps "did they schedule any interviews?" and the ghost chip off interviewing
  cards; dashboard pipeline leads with interviewing cards and the next-move card gets `.leadMove` (order −1 on phones)
  when it names an interview; Studio gaps need the whole requirement to be "likely covered".
- **#384 (merged 9ec46db, prod dpl_ju1UCRqf7SGHeBFHKar4QkvDrbVy):** engineering roles never credited with front-line
  competencies (`HOURLY_ONLY` cap in relevance + jobCompetencies); a bounded title-match term (0.05) breaks near-ties so
  Ledgerline leads; `ANCHOR_SKIP` += algorithms/data structures/problem solving/coding; "start with the parts that
  touch X".
- **Still open after round 7:** Stripe Adaptive Pricing (owner dashboard); Optimize "campaign management (related
  experience)" shown with ✓; "scheduling · shows it" via a content calendar for email scheduling; "distributed systems"
  cited to the transactions/day line; one Stripe line serving three answers; Studio "Make it stronger" prompts with no
  question text; "Java · not on your résumé" when the posting says "one of Java, Scala, C++ or similar"; "machine
  learning" read from an example sentence; guest-carry time shown stale on the card until reload; Studio Export before
  "Use this version" downloads the base silently; greeting "Still up, Wtp." (persona profile name).
- **Harness:** `pkill -f "next start"` matches the shell running it (exit 144) — kill by PID; a preview deployment is
  reachable to Playwright after one visit to the `get_access_to_vercel_url` share link in the same context.

## Session 2026-10-27 D: round 6 — 4/4 "would have paid"; PR #383 (branch claude/wip-round9)
- **Round 6 (same 4 personas, live, after #382):** Maria 7/8 prep YES, Dev 7/7 Pass YES, Tasha 6/7 prep YES, Ray 7/7 prep
  YES — the first round every persona said yes. What sold it: the dashboard's first move names the interview with date and
  time; the thank-you email is sendable as copied; the posting is editable after a build; typed words survive devices and
  rebuilds; nothing invented. Reports: session scratchpad `wtp/<persona>/round6/`.
- **Fixed in #383 (every item reproduced locally from the personas' real résumés/postings first):**
  - Studio: the Tailor result persists per user (`ResumeDocStore.putTailor/getTailor`, key `seen_resume_tailor_<uid>`, 7-day
    TTL, swept by the `seen_resume_` prefix); `pageBudget` = the résumé's own length (1 page ≤ 46 lines); `tailorResume` runs
    the targeted summary, and when it scores below the base re-runs with `replaceSummary:false` and marks `plan.summaryKept`
    (the paid package shows the person's summary with a why line); `planSkillEdits` reads the summary + bullets only, with
    `INDUSTRY_WORD` and title words in `NOT_A_SKILL`; `plan.gaps` = `fitAfter.unsupported_requirements` (non-soft) + unmet
    constraints (first clause) + held-or-not credential gaps (fatal) — never the sentence splitter; education parser:
    "Coursework toward A.A.S. Business Management" → degree "Coursework toward A.A.S.", field "Business Management".
  - Prep card: `AnswerEditor` flushes on `pagehide` / `visibilitychange` (saveFill sends one `keepalive` request with cached
    headers when the page is hidden), 600 ms pause; the editor resets its boxes when `a.answer` (the sentence) changes;
    `pack.noteKeys` remembers the sentence a note was typed into so `carryFills` restores it when a rebuild brings it back.
  - prepLocal: row cap = 16 requirement rows, duty rows are the extra (payroll/receiving/bilingual were cut by 12); the
    requirement word list drops stop words (`that` matched "SLOs that took…"); `teaches(x)`/`TEACH_LINE` — a trained/certified
    line never proves or tells a non-training requirement (forklift ← the operator line; a SKILL_Q story with only a teaching
    line is skipped); the must-have story's `tell()` weighs the label's own words (LOW6 half); `QSYN` adds know/measure/track →
    insights/analytics/report/numbers (+0.75 `measured` bonus), post → instagram/reel/content, retur ↔ refun/excha;
    GENERIC_Q adds wrote/write/owned/own; `KNOWN_VERBS` adds pull/gather/tabulate/photograph/stage/slot/scan/wrap/palletize;
    cert sentence names the certification not the issuer ("I hold a Social Media Marketing certification from HubSpot
    Academy."); "Walk me through one thing you did well at X" is removed from a guided card even as a story; hints: one line
    per question, none for availability; ask_them dedupes "90 days"; frame copy drops "by the end of the shift".
  - postingSections: a STRONG_CUE sentence inside the EEO block is a requirement (Tasha's appended Google Analytics line).
  - Vocabulary: hourly `payroll` (+ `shrink control` alias), professional `security` (sensitive data, SOC 2, row-level
    security, encryption…), `performance optimization` += p99/p95/latency/throughput.
  - Optimize: `extractResumeFacts` adds a `leadership` fact from a led/supervised/managed-team bullet (LEAD_RE); `scoreFit`
    marks a match whose evidence is a schooling line (education/certification/minor/degree) `inferred` (counted, never shown
    as proof); `alreadyAnswered` checks every noun, the same per-unit rate ("200+ transactions per shift") and quality scores.
  - Strategy: `ANCHOR_SKIP` (language, schedule, physical, retail/hospitality…) filters plan anchors and `matchedStrengths`.
  - Dashboard pipeline row: an interviewing stage shows `Stage · whenLabel(at)` instead of "Day N · ghost rate".
- **Verified:** suite 2372/2372, tsc, next build, Playwright Studio-reload smoke on the production build (restored result,
  "fits on 1 page", summary-kept line, overrule survives reload, fresh guest sees nothing). Harness: kill servers by PID —
  `pkill -f "next start"` killed the shell itself (exit 144) and a leftover next-server made the smoke fail for the wrong reason.
- **Not fixed / owner:** Stripe Checkout "Choose currency" (Adaptive Pricing — dashboard setting; a code param was not tried
  without a key to test against); Studio role ranking (H-E-B above Ledgerline, "sales ✓" on backend roles); Strategy filler
  wording ("average wait near 0 days"); "distributed systems" row cited to the transactions/day line; one line serving three
  Stripe answers; guest-carry time shown stale on the card until reload.

## Session 2026-10-27 C: round 5 verdicts (first "would have paid") → round 6 (branch claude/wip-round6)
- **#379 merged** (b5898e9, prod dpl_H37iJifgjSXafww4VZhdn2J31psa). Round-4 preps backed up (`wtp/preps-backup-r4.json`)
  and deleted; Pro reset; round 5 ran live. Tasha 6/6 no; Maria 6/7 **YES** (Dev, Ray pending at the time of writing).
  Both: the posting now survives checkout and a storage-less device auto-builds with it; stories sit on lines that
  say the thing; nothing invented; words persist. What still cost the sale: the finished EMAIL read "Hi Ms.
  Okafor., … year.," on one line (composeAnswer added a stop and a capital to every fill and collapsed newlines);
  the time typed in round 4 (ms .000) was hidden by the legacy rule (prod has ONLY test-account
  interview_scheduled rows — no real user affected; left as is); no way to edit the posting after a build; the
  Ross freight scenario still built on a scheduling line (through "hours"); "Why do you want to work at X" showed a
  Built-on line it did not use; Optimize listed "attention to detail (related experience) — Serve 200+ customers"
  and "CRM ← HubSpot Academy certification"; the dashboard said nothing about the interview.
- **Round 6 rules (keep):** `composeAnswer` keeps newlines, capitalises and adds a stop only when the blank starts /
  ends a sentence (a blank inside "Hi [name]," takes neither). `SCENARIO_Q` questions need TWO real words to take a
  line; GENERIC_Q adds hours/associate/employee/coworker/friend. `QUESTION_PROMPTS` has a method prompt for "how do
  you decide/measure/know". `haveVerb` keeps a brand word ("Google Slides"). Scheduling alias adds calendar/
  Hootsuite/Buffer/Sprout/Later. `lib/interviewTime.ts` is THE time helper (card + dashboard); the dashboard's first
  move is "Interview at X · Thu, Oct 29 at 3:00 PM → open your prep". PackView: "Edit the posting and rebuild" after
  a build; posting pay line lives in the job-match block. Optimizer v3 `scoreFit`: a related match is `inferred`
  when the requirement is soft (counted for the score, never shown as proof — Verdict and the application message
  skip it) and is NOT a match when the evidence is a certification/course/education line.
- **Dev round 5: 7/6 YES (Pass).** Round 7 (branch claude/wip-round7, after #380): a cited evidence line in section 1
  must NAME the requirement or an alias ("experience with machine learning" ← a FastAPI line the reader cited for
  Python); jobMatch ranks the proof line by SPECIFIC words (LOW_W: systems/data/handle… count ½) and a SAME_THING
  alias hit (+2), with 'security' / 'sensitive data' aliases (PCI, SOC 2, row-level, encrypt, audit log); the bank
  loop scores EVERY (question, line) pair and assigns best-first, a line serving a second field question once at
  n ≥ 2 (incident ← the on-call line); STORY_RE adds resolved/fixed/shipped/designed/owned/migrated/automated/
  delivered and counts +0.5 in the fit score; `pastWindow` is never "past" for Phone Screen / Interview / Final
  Round / Offer (dashboard said "Stripe has been quiet for 23 days" beside a phone screen); the preview counts
  questions and practice items apart.
- **Ray round 5: 6/5 no ("one more round of this and I'd pay").** Round 8 (branch claude/wip-round8): AnswerEditor
  never lets a stale prop overwrite a box being typed in (`seen`/`saved` refs; account values replace local ones
  only when NEW and never over typed text), and saves on a 900 ms pause as well as on blur (a first box typed in a
  row of three came back empty; a pay answer never saved); `loadBundle` returns `this.loadSync()` after a guest
  carry (the page kept the pre-carry row and re-sent the legacy date); jobMatch's "one entry per proof line" now
  drops a row only when it shares the proof AND a non-generic label word, and never a duty row (forklift,
  inventory management, basic computer skills and the "Monitor rate, quality and inventory accuracy" duty all
  vanished behind the WMS / order-picking rows); a duty is shown by TWO specific shared stems; a certification the
  posting names gets a row when the reader surfaced nothing and the intro says "I hold an OSHA forklift
  certification."; the why-now draft for a title equal to the one applied for reads "I've been a Warehouse Lead at
  X since 2017, and I'm looking for the same role at a bigger operation"; company frames carry a `hint` (the line
  most likely to hold the story, shown as a suggestion under the boxes, never built in). Cap 12 rows.
- **Still open from round 5:** loss prevention / payroll rows missing from job match (requirement extraction);
  Studio tailor result lost on reload + "(2 pages)" header; Strategy filler; "Walk me through one thing you did
  well at <old employer>"; Stripe "Choose currency MX$" (Stripe Adaptive Pricing — dashboard setting, owner).

## Session 2026-10-27 B: round 4 verdicts → round 5 fixes (PR #378 merged; branch claude/wip-round5)
- **#378 merged** (b478367, prod dpl_GMXqbnhS9c5KuMXkYTsWF844PDZn): the résumé tools fetch an Adzuna teaser's full
  posting through the listing importer before asking anyone to paste it; Optimize is back on teaser rows (card,
  drawer, detail page). Unverified from the sandbox: a real reader fetch through Adzuna's redirect.
- **Round 4 (same 4 personas, live, after #377):** pay-now/worth-it Tasha 5/5 no, Dev 6/4 no (Pass), Ray 5/4 no,
  Maria 5/6 YES. The free company section is what they value now. Paid prep lost trust at the same seams for all
  four: the posting pasted before checkout was thrown away (localStorage only; `cached:true` on the buyer's return
  dropped it); a rebuild re-matched a question to another résumé line and KEPT the typed fill (an invented
  "✓ finished" story), or redrafted the sentence a fill continued (self-contradicting pay answer), or cut the
  "why now" question; a principle cue alone (+2) carried any line (Dive Deep ← a training line; "ingest large data"
  ← mentoring; "machine learning" ← FastAPI); a time of day nobody typed (date-only rows saved at noon by round-3
  code); WMS/logistics/computer-skills "not on your résumé"; "ended in June 2026" from a year-only end; pay from
  other employers drafted into the person's mouth; "Google slides · listed" from "Google Analytics".
- **Round 5 rules (keep):** `lib/server/prepFills.js` — a fill belongs to the GIVEN text of its answer (`givenKey`):
  `carryFills` keeps it only when the rebuilt answer has the same given text and blank count, else it moves to
  `pack.notes[q]` (shown as "your words from before the rebuild", never finished). `action:'stash'` stores the
  posting pasted before checkout as `interview_preps.pack = {pending:true, job_text}`; `readCached` ignores
  pending rows; `mine` returns `pending_job_text`; the card auto-builds with it once Pro is on, and a `cached`
  answer to a build that carried a posting is rebuilt with `refresh`. Fills on `__intro__` / `__thankyou__` /
  `__followup__`. Matching: a line must share a real word with the question (`words >= 1`); principle bonus only
  on behavioral questions; "experience with X" needs X's words; mistake/disagreement/conflict questions and
  present-tense scenarios are always frames; `isExercise` guide questions get a practice note; a used line may
  serve a field question again at n ≥ 2.5; GENERIC_Q adds team/shift/crew/store/customer/guest. Company questions
  come right after the openers; KEEP staples (why now, pay, start, know) are never cut; cap 20 with a guide.
  Pay: only the posting's own band is spoken (em dash parsed); Seen's range from other listings is a
  `reference` beside the blank. `prepClaims`: a year-only end equal to the current year is `current`.
  Time field: ms 500 = no time, ms 1 = typed, anything else = legacy date-only (field empty). Fill saves are
  queued in order. Guest date carried when NEWER than the account row's. `CompanySuggest` uses `gradeLetter`.
  `OPTIMIZER_VERSION` optimizer_v3 (old cached "Dependable … candidate" summaries never served).
- **Verified:** suite green, tsc + next build clean, Playwright on `next start` (prep API stubbed, prod writes
  blocked, Ray's account): intro/email editors, notes, exercise item, posting pay line, legacy time hidden, boxes
  ≥56px, 0 overflow at 390, ordered saves, auto-build from the stash with the posting.
- **Not fixed:** dashboard never mentions the interview; "N accounts mention interviewing" vs company-page counts;
  Strategy tab filler ("average wait 0 days"); Studio tailor result lost on reload; Strategy/Insights boilerplate.

## Session 2026-10-27: round 4 — the prep knows the company, and the person finishes every answer (branch claude/wip-round4)
- **Owner (after round 3, Fable 5.1 switched on): "genuinely solve these. We have been at this for months."** Four fixes, all without
  a model API:
  1. **Company interview guides** — `lib/server/interviewGuides.js` + `lib/server/guides/{retail,services,tech}.js` (generated
     from the hand-written JSON in the session scratchpad `guides/` by `scripts/guides-to-js.mjs`; edit the JSON). 106
     employers (Amazon with LPs + STAR + the Loop; Walmart's four values; Google's four attributes; Stripe's loop; Big Four,
     MBB, airlines, banks, staffing agencies, hospitals…), each hedged ("usually", "many applicants report"), no pay figures /
     statistics / dates / guarantees (`interviewGuides.test.mjs` enforces it on every guide). `guideFor(company, role)` picks the
     track (hourly / corporate / tech) by `prepFamily`; a shared name ("Apple") resolves by track. The guide's format replaces
     the field's; its questions come right after the openers (flagged `company:true`, with `principle`), get a résumé story
     when a line fits (`PRINCIPLE_CUES`), and its tips / watch / ask-them ride on the pack. The FREE record and preview carry
     the guide headline + one company question — that was the thing all four testers said would make them pay.
  2. **Finished answers** — every [blank] is a field on the card (`components/tracker/prepAnswer.ts` splitAnswer /
     composeAnswer); typed words are saved per question with the prep (`POST /api/interview-prep {action:'fill'}` →
     `pack.fills`, every device), and the composed answer shows with Copy. Every question now has an answer: a résumé story
     (one prompt, chosen for the QUESTION — `promptForQuestion`), a drafted recruiter script, or a 3-blank STAR/how-to frame
     (`frameFor`). Prompts match the question (incident → cause/fix; system → trade-off).
  3. **The posting survives checkout** — stashed in `localStorage seen_prep_posting_<appId>` (swept on sign-out) before
     Stripe and used on the auto-build; `pack.job_text` is saved so "Add the posting and rebuild" (refresh) works on any
     device and keeps `fills`.
  4. **Small but real:** `processSignals()` reads Seen's own accounts for HireVue / assessment / panel / rounds / drug test
     ("Applicants to X mention…"); the guest card's interview stage + date reach the account (AppStore.loadBundle merges
     them onto the matching row; `pending_applications` carries `stage` + `interview_at`); a time-of-day field (a date-only
     pick is stored at noon local with a 500 ms marker); the card says "N applicant accounts mention interviewing" (what it
     counts); the phone's floating button hides while a prep is open (`seen:prep-toggle`); no "still in the normal window"
     line at interview stages; Studio keeps certifications from a "SKILLS & CERTIFICATIONS" heading (`splitSkillList` allowed
     a 60-char item max — Ray's OSHA line was 66) and moves cert-looking skills to certifications; the tailor summary leads
     with the person's OWN title ("Backend Engineer with 6+ years…, most recently at…"), never "Dependable … candidate"; an
     engineering posting's "customer experience" is not a customer-service demand.
- Verified: suite 2346/2346 (+ guides, prepAnswer, fill/rebuild API, round-4 pack tests); tsc clean; `next build` clean; the
  four personas' packs rebuilt locally from their real résumés/postings. NOT yet verified: round 4 with the personas on prod.

## Session 2026-10-26: PR #375 merged (no model API) + willingness-to-pay round 3
- **#375 merged** (merge 8f9ecce); prod deployment dpl_HvqFsmsWSN8NmNVupsW7SJzqNTAn served on seenjobs.io within ~1 min, 0
  runtime errors. Migrations 20261025140000 + 20261025160000 still unapplied (code is backward-compatible: interview_preps /
  funnel_events writes are best-effort; `comped` exists since 051).
- **Round 3** (same 4 personas, live Prep $9.99 / Pass $19.99 funnel; brief `scratchpad/wtp/BRIEF3.md`): pay-now / worth-it
  Tasha 3/2, Dev 5/3 (Pass), Ray 3/2, Maria 3/2 (neither). Nobody pays. Praised: one-time honest prices, interview date,
  prep on every device, zero invented facts. Rejected: the prep is a worksheet (résumé line + [blanks]), recruiter
  questions had no drafted answer, nothing company-specific (Amazon LPs), pay null, false job-match rows.
- **Fixed on claude/wip-round3:** passive-verb reading ("I was promoted seasonal launches"); résumé casing + plural verbs +
  the line's second half in from→to stories; one prompt per answer; generic words no longer match a story to a question;
  intro from dates/field/education ("I just finished…", "I also work as…", never "Before that" for a job still held);
  "(nonprofit)" dropped from spoken names; move question ignores a comma's team name and counts a degree; phone-screen
  format note; salaried roles not asked their hours; drafted recruiter answers (why <company> from a line naming it, why
  now from the latest job's dates, pay, level + years on a professional phone screen); pay falls back to the same title
  at other employers (labelled `scope:'market'`, salaried fields yearly only); job-match needs the specific word
  ("process" alone never proves "shipment processing"), "listed" only when the résumé says it, CS fundamentals never
  denied, posting meta-sentences ("…a bonus, not a requirement") are not requirements; "your workday" ≠ Workday;
  "Target" the employer and a job's own date range are never "a plan that has passed"; a capitalised name inside a line
  keeps its tense ("Drive Up"). Thank-you email no longer says "today".
- **Not fixed (reported):** Amazon Leadership Principles / company-specific formats; posting pasted before paying is lost
  (checkout sends no job_text); guest interview date lost at sign-in; Studio drops a SKILLS & CERTIFICATIONS cert (Ray's
  OSHA forklift); tailor lowers scores / ranks the senior role lowest; optimizer summary "Dependable … candidate" under
  "every word is in your résumé"; card "N accounts of interviewing" vs company page counts; no time-of-day field.
- Test accounts: round-3 Pro windows cleared, balances restored (7/7/6/10); 18 old test preps deleted after a backup
  (`scratchpad/wtp/preps-backup-r3.json`).

## Session 2026-10-24: SEO/AI visibility, cron auth, conversion, scoring weight (PRs #359–#366, all merged)
- **Owner direction:** share cards are retired as a growth lever ("No one is sharing that shit"); the funnel card
  branch `claude/wip-fix3-funnel` is shelved. Marketing plan = Claude Doc artifact Duen9PchrgV5smKKFBnbku. Supabase
  is now on Pro (daily backups). SEO/AI tactics stay legitimate only (no fake reviews, doorway pages, bought links,
  hidden text for AI).
- **SEO/AI (#359, #362, #363):** sitemap pages every company row (`lib/server/sitemapCompanies.js`, 1,000-row
  pages); only graded company pages are indexed (`companyRobots`); titles "<Company> application status: who
  hears back (N reports)"; /methods, /data (CC BY dataset + CSV), /lists, dynamic llms.txt / llms-full.txt;
  IndexNow key file; daily `api/cron-search-data.js` (13:20 UTC) stores Search Console / Bing queries in
  `search_daily` and merges real searched intents into the company FAQ; signup attribution
  (`seen_first_touch_v1` → `record_attribution` → `signup_attribution`, admin "Where signups come from").
  Search Console / Bing need owner env keys (GSC_SITE_URL, GSC_SERVICE_ACCOUNT_JSON, BING_WEBMASTER_API_KEY).
- **Cron auth (#364) — the reason outcome emails never sent:** Vercel crons send `Authorization: Bearer
  <CRON_SECRET>` and NO `x-vercel-cron` header (which anyone can spoof). Seven crons trusted only that header, so
  every real Vercel call was refused: `outcome_email_log` had 0 rows ever and /api/demand was stale since August.
  ONE helper now: `lib/server/cronAuth.js` (`isVercelCron` = bearer only; `hasCronSecret`; `hasAdminSession`).
  Never test `x-vercel-cron` again. Expect the first real day-30 emails (2, user db74a562) at the next 15:00 UTC
  outcome-followups run — confirm rows in `outcome_email_log`.
- **Conversion (#365):** company page "Applied to {Company}? Track it" card under the grade (role + WHEN applied →
  check-in clock at the real date) → guest email ask via `signInWithOtp` carrying `pending_applications` in
  user_metadata, created on first sign-in (`lib/pendingApplicationClient.ts`); one-screen sign-up with
  `intent=track|trial|alert|invite` (`lib/signupIntent.js`); `/trial?plan=`; guest /tracker; confidence word
  capped at Moderate until 5 Seen-user reports (`capDisplayConfidence`); `CompanySeed` SSR grade (LCP / 4.7→1.1 s,
  /company/walmart 4.2→1.9 s). Verified on the Vercel preview at iPhone size with writes blocked.
- **Scoring (#366):** `classifyPlatform(platform, trustReason)` — a first-party report (direct_submission /
  anonymous_unverified / duplicate_user_company) that names LinkedIn/Indeed/Glassdoor/Blind as where the person
  applied is `direct` (1.0), not `ingest` (0.55). Every scoring read must select `trust_reason` and pass it.
  Recomputed after the prod deploy (2026-10-24 07:15 UTC): SpaceX 93→94, Tesla 77→76, Hilton 84→80 (its affected
  row is an admin-approved "ghosted" via Indeed).
- **Local smoke lesson:** `next start` serves no `/api/*` (Vercel functions), so data-gated UI (company page
  TrackCta, badges) renders the error state — proxy API GETs to seenjobs.io in Playwright, or test the preview.
- **Owner actions outstanding:** storage guard `update public.jobs_storage_guard set max_mb = 6000 …` (classifier
  refused it); PostHog key; Search Console / Bing keys; NEXT_PUBLIC_SAME_AS; delete demo reports + test accounts
  (incl. conv.audit.1450@seenjobs.io); pricing claims not backed by code ("Ghost risk alerts", "AI company
  deep-dive"); Walmart report 651d5f93 reject?; Supabase email templates "Confirm email & continue →".

## Session 2026-10-23 B: PR #351 merged + second audit (desktop + phone, same method) — verdict: public beta ready
- **Merged** PR #351 as squash a8cfb08 at the owner's word ("Merging now"); Vercel production deployment fired from the
  merge and seenjobs.io served it within ~45 s (verified: /contact 200, FAQ names the founder). Draft PR #352 carries one
  follow-up (verify screen detects confirmation from another device).
- **Second audit** ran against the PR preview (Vercel Authentication: `get_access_to_vercel_url` share link, cookie set by
  one visit, valid ~23 h — a push redeploys the branch alias and the share no longer applies, so NEVER push the audited
  branch mid-audit; back up commits to a `claude/wip-*` branch instead). New account `jordan.avery.audit2@seenjobs.io`
  (seenjobs.io addresses are readable via Resend receiving — that is how confirmation/reset emails are read).
  Report: session scratchpad `audit2/REPORT-v2.md`. Desktop 26 pass / 7 partial / 0 fail; phone 30 / 5 / 0 (morning:
  24 / 4 / 8). Blockers: credits, search, tracker, phone minimums, credibility, sessions FIXED; deck, company pages,
  optimize, signup PARTLY. Remaining (reported, not fixed): company-page counts from two denominators (header =
  first-party applicant reports, section = every community row), Reddit threads/quotes that read scraped + stored
  "Reddit r/r/" platforms, ATS slugs as company names ("plscareers"), Studio button "Upload a file · 1 credit"
  (`app/resume/studio/page.tsx:257`), résumé rail reads only `profiles.city`, Optimize output quality, thin/foreign
  Phoenix inventory, micro-survey after withdraw/on 404, résumé keys left in localStorage after sign-out
  (`seen_resume_<uid>`, `seen_resume_meta_<uid>`, `seen_profile_v2_<uid>` are not in the auth.tsx sweep).
- **Supabase auth facts verified with real emails:** a redirect path on the Site URL's own origin IS honoured
  (reset link kept `/reset`), so `/dashboard` works in prod with the EMPTY `uri_allow_list`; any other origin (a
  preview) is replaced by the Site URL root. The "Forgot password" page's 8-digit code is real: the magic-link
  template carries `{{ .Token }}` (otp length 8, 1 h); Settings' reset uses the recovery LINK template. Writing
  `uri_allow_list` via the Management API was refused by the session's classifier — owner's dashboard action if a
  preview ever needs it.
- **Verify-screen lesson:** `getUser()` polling sees a confirmation only in the browser that opened the link; a link
  tapped on another device never moves the waiting tab on → retry `signInWithPassword` with the typed credentials
  (PR #352).

## Session 2026-10-23: launch-readiness audit → the ten blockers fixed (PR #351, branch claude/friendly-sagan-47rfat)
- **The audit** (two agents as a new job seeker, desktop + iPhone, real account `jordan.avery.audit@seenjobs.io`,
  real résumé, 39-point research rubric; report in the session scratchpad `audit/REPORT.md`) found 10 trust
  breakers: silent credit spend + contradicting credit copy; search ranked by transparency score, not the query, and
  a fallback banner that fired whenever the server widened; résumé deck matching Dallas sales roles to a Phoenix
  cashier; company pages showing non-hiring Reddit threads (the word "target") and disagreeing counts/grades;
  "Apply & Optimize" with no plain Apply; tracker with no edit/delete and 8px phone pipeline; verify link landing on
  the homepage; sub-12px text and sub-44px controls; thin credibility (no founder, /contact 404); global sign-out.
- **How it was fixed:** six agents on worktrees pinned to a6ae053 (`claude/wip-fix-{auth,company,search,tracker,
  credits,mobile}`), merged into the integration branch, 5 conflicts resolved, then an integrated re-audit.
- **Durable rules learned (keep):**
  - `lib/pricing.ts`, `app/pricing`, `components/UpgradeModal`, `app/profile` all read `PRO_PRICING` /
    `CREDIT_RESET_LABEL` / `JOB_INSIGHTS_COST` from `lib/server/creditRules.js`; `lib/pricing.test.mjs` fails on
    any hand-typed price. Résumé parse is FREE (rule-based, no model) — never re-add `gateAI('parse_resume')`.
  - Job search: relevance (`api/_utils/jobRelevance.js`) ranks, transparency breaks ties; the API returns
    `in_radius`; location = geo OR city text (509/846 Phoenix rows have NULL coords). Recommendations need a
    title-family AND city/remote match; the rail hides when a query is typed.
  - ONE grade scale: `lib/companyDisplay.ts gradeLetter` (hero, share card, OG, homepage preview). "Last updated"
    = `scoreUpdatedAt` (company_scores has NO updated_at; derived from expires_at − 365d).
  - Reddit threads need sentence-level hiring context; common-word brands need the company named with it
    (`api/_utils/companyReddit.js`); section hidden under 2 threads. Feed rows re-checked by the strict rules.
  - `signOut({ scope: 'local' })` everywhere; "Sign out of all devices" in Settings is the only global one.
    A 401 on sync → `lib/sessionExpired.ts` toast + /login?return=.
  - Verify email redirect is /dashboard; the login page polls `getUser` every 5 s (≤60) after signup. The Supabase
    confirmation template + subject ("Confirm your Seen account") were applied in prod via the Management API;
    the old template is saved in the session scratchpad for rollback.
  - **Phone floors:** `--fs-NN` tokens in globals.css jump to .75rem ≤768px; every CSS module ends with a GENERATED
    "PHONE FLOOR" block (scratchpad `floor-modules.mjs`: every selector under 12px at every width → .75rem,
    `!important` carried; selectors a module already floors or that are ≥12px at some width are left alone).
    Unclassed in-prose anchors get a 44px tap box by vertical padding (`.site-main a:not([class])`). Deliberate
    exceptions: `.sring-l` 11px, nav tabs, tracker stage steps. The CHECK is per element at 360/390
    (scratchpad `broad-measure.mjs`: overflow / <40px controls / <11.5px text) — a `document.scrollWidth` or
    desktop-only check misses all of it.
- **Verification:** tsc clean; suite 1633/1633; `next build` clean; Playwright on `next start` with the merged
  `api/*.js` served by a read-only shim (refuses Supabase writes, Reddit, model calls); phone sweep over 25 pages ×
  2 widths: 0 overflow (decorative orb excepted), 0 tiny text, 0 small controls. **Harness lesson:** a `next start`
  left running across a rebuild serves HTML for CSS hashes that no longer exist (400s) and every page measures
  "clean" with no styles — kill by port (`ss -ltnp`) and confirm every CSS bundle is 200 before trusting a sweep.
- **CodeQL lesson (PR #351 went red twice before this):** the repo's security-and-quality scan flagged plain hrefs
  built from the tracker's own store as XSS / open redirect. Running the same queries LOCALLY (CodeQL bundle in
  the session scratchpad: `codeql database create … --codescanning-config` then `database analyze` on
  `Security/CWE-079/XssThroughDom.ql`, `Xss.ql`, `CWE-601/ClientSideUrlRedirect.ql`) showed every path crossing
  `lib/stores/AppStore.test.mjs`: its Map-backed localStorage fake joins every storage write in the app to every
  storage read. Code scanning now scans shipped code only (`.github/codeql/codeql-config.yml` excludes
  `**/*.test.*`, wired via `config-file:` in codeql.yml). Links built from browser storage still go through
  `lib/safeHref.js` (`pathSegment` / `slugSegment` / `httpHref`) — keep using it; a `.test()` regex guard is not a
  sanitizer CodeQL recognises, `encodeURIComponent` and a `new URL()` round-trip are. When CodeQL is red, get the
  path locally first; the alerts API needs `security_events` the session token lacks, and the annotations alone
  mislead (they showed `key={app.id}` as the sink).
- **NOT verified live:** the confirmation email on a real signup; a real credit spend against prod.
- **Owner decisions outstanding:** delete the test account (0 public reports, 2 saved jobs); Inbox Autopilot
  migration (pinned); "Connect Gmail" design (pinned — Google restricted scope, 100-user cap unverified,
  ~$540/yr CASA past it); USAJOBS keys in Vercel; Indeed collector root cause (task #35).

## Session 2026-10-21 D: Inbox Autopilot — forwarded job emails keep the tracker up to date (owner: "if it doesn't cost us any money that's genius")
- **Why:** prod had 8 accounts / 15 tracked applications / 2 sign-ups in 30 days — the tracker (the strategy's data
  engine) is barely used because people stop logging by hand. Now each user gets `track-<12 chars>@seenjobs.io`
  (`lib/server/inbox/address.js`) and forwards job emails to it (Gmail filter, or one by one).
- **Free, verified 2026-10-21:** Resend receiving is ALREADY enabled for seenjobs.io (root MX ->
  inbound-smtp.us-east-1.amazonaws.com; Resend domain "Receiving: enabled"), so no DNS change. Received mail counts
  toward the free 3,000/month + 100/day shared with sent mail (28 used this month) — fine for ~20–30 active users;
  past that, Cloudflare Email Routing is free + unlimited (needs the DNS moved off Namecheap), and only the fetch in
  `store.js resendClient` would change.
- **Path:** Resend webhook `email.received` (a POKE — body untrusted) or the hourly catch-up (`GET /api/inbox-email`,
  cron :50) -> `GET api.resend.com/emails/receiving/{id}` with RESEND_KEY -> token from received_for/to/Delivered-To
  (a Gmail filter-forward keeps the user's own To:) -> `classify.js` (rules only: rejection > offer > interview >
  assessment > received; a conditional sentence — "if selected we'll schedule an interview" — never counts; job
  boards/ATS are never the company; hand-forwards are unwrapped; Gmail's forwarding confirmation code is pulled out
  for the setup screen) -> `apply.js planChange` (stage only rises, hired/withdrawn never reopened, interview reopens a
  ghosted card, same email event within 3 days once, events `source:'email'`) -> applications row.
- **Privacy (owner-approved default):** only facts are stored (`inbox_events`: kind, company, role, vendor, sender
  name/domain, confidence, date) — never text/subject/attachments. Outcomes reach a company's grade ONLY when the user
  taps Yes (the panel calls the existing `quick_submit`). Turning it off deletes the address + all facts.
- **UI:** `components/tracker/InboxAutopilot.tsx` at the top of /tracker (hidden until the migration is applied),
  "From email" chip on cards, dashboard tile (shown only when live), FAQ + privacy sections. Server actions
  `inbox_status|enable|new_address|pause|disable|assign|share` in api/user-sync.js.
- **Verification:** classify 19, apply 10, handler e2e 8 (fake PostgREST + fake Resend: webhook, replay, catch-up,
  not-ours mail, Gmail code, send-only key, paused), user-sync 4; full suite 1559/1559; tsc + next build clean;
  Playwright on `next start` with every call stubbed: enable -> setup steps, live Gmail code, Yes -> quick_submit,
  no overflow at 390/360, panel hidden before the migration. NOT verified live: whether prod RESEND_KEY can READ
  received mail (`GET /api/inbox-email?check=1` answers `resend_read: ok|forbidden`), a real forwarded email.
- **Pending owner actions:** apply migration `20261022120000_inbox_autopilot.sql` (additive); then the Resend webhook
  (`https://seenjobs.io/api/inbox-email`, event email.received) can be added — the hourly catch-up works without it.

## Session 2026-10-21 C: why the cloud applicant-report cron found 0 (branch fix-archive-yield)
- **Prod (read-only):** collector_runs 1–3 (16:35/17:35/18:35 UTC) each did 2 companies, `found 0`, `stopped_by time`,
  ~232 s. The logged summary DROPPED per-company `searches`/`failed_searches`/`search_errors`, so it looked clean.
- **Reproduced locally** with the cron's exact path (real Arctic Shift, writes stubbed) for Natera + Brex: 0/0 — 52
  archive requests, **35 were HTTP 422 "Timeout. Maybe slow down a bit"** (~0.5–1.5 s each), 2 were 429; at any pace
  (1 s / 6 s / 12 s gaps → 1/8, 1/8, 3/8 answered), so not Vercel-specific. Plain subreddit LISTINGS (no text filter)
  answered every time in 0.9–2.5 s. Even with every post of r/natera (5), r/Brex (23), r/verkada (111) read: 0
  accounts — the queue's head (most listings) is ATS-board tech with no first-hand footprint. Same budget, companies
  with ≥1 report: Verizon 8, TopGolf 3, Kohl's 1, Instacart 1.
- **Fix:** company subs are LISTED page by page and matched locally (title: any applicant word; body: hiring words;
  plus a job-context gate — r/verizon "Was offered 25% discount" passed the old title=offer path AND the rules as an
  `offer`); a busy-archive breaker (4 refused full-text searches in a row → skip the rest, `archive_busy`); the shared
  fetcher takes a per-call `deadlineAt` (no 5 s retry / 10–60 s 429 back-off past it); the fill queue (`below=K`) puts
  companies with a report or mention first and goes to 1,000; the cron offers 8 candidates (clock decides), logs
  searches/refusals/reasons, `failed` when every search was refused / `partial` when ≥ half; rotation by outcome
  (dry+read to end 30 d, read to end 14 d, goal 7 d, time 7 d / 2 d still finding / 1 d barely read, busy 1 d); a
  company started with no time for one search is `not_reached`, never "tried".
- **Rules gap NOT fixed (follow-up):** `storableAccount('Was offered 25% discount…', {inCompanySub:true})` → offer.
  The harvest gate keeps it out of the archive collectors; the ingest re-check alone would still accept it.

## Session 2026-10-21 B: career sites like a person, always-on reports, storage guard, verified backup
- **Career-site navigator** (`lib/server/careerAgent.js` in-page agent + `scripts/collect-career-site.mjs`): no
  start page needed; finds the list (landing pages followed deeper), uses the SITE'S OWN search + United States
  filter whatever the layout (search box + Enter / its button / its form; dropdown, type-ahead suggestion, or a
  checkbox in a collapsed filter panel — a US filter that empties the list is undone), lists every job (Tesla/
  Workday feeds; the page's own listing request incl. POST bodies captured by a fetch/XHR spy, replayed page by
  page; Next / numbered / Load more / infinite scroll; merged when a feed is short of the site total). One job =
  one identity across pages/keywords/passes; 2 passes, then it names what is missing. Pages 1,000 (max 5,000).
  Verified: `npm run test:career-e2e` — real Chromium, 8 fixture sites, real collector + agent + Seen's
  rowFromPosting: 11/11 complete, 0 dupes, 0 abroad. NOT verified on real sites from the owner's Chrome.
- **Bug class fixed:** `opencliBrowser.js` judged the echoed command (`--session`) as a usage error, so every
  real failure was retried in the other form and its reason hidden.
- **Always-on applicant reports:** `api/cron-archive-reports.js` (Vercel hourly :35) runs the Reddit-archive
  collector in-process (shared source `lib/reports/archiveSource.js`, same ingest handler), 2 real-name companies
  per run (the archive answers ~1 search/9 s when busy, measured), 7-day rotation via `public.collector_runs`
  (migration 20261021150000); `GET ?runs=1` (local intel token) feeds Seen Command. Live dry run against prod
  targets + the real archive worked; nothing written. Company pull now reads up to 10 Adzuna pages.
- **Storage guard** (migration 20261021130000, NOT applied — the session's classifier refused a prod schema
  write; owner to approve): past `jobs_storage_guard.max_mb` (470) new aggregated listings are skipped (existing
  ones still refresh, employer posts allowed); size read once per transaction (2.5 ms measured). Admin shows DB
  size + alert. Migration 20261021140000 drops 4 unused jobs indexes (~23 MB). DB 425 MB at 13:00 UTC; jobs'
  size is mostly descriptions (194 MB compressed, Greenhouse avg 5.4k chars); the project is almost certainly
  Free (no backups listed, grace-period wording).
- **Backup verified:** keyset-paged export finished `complete: true` (78 tables, 219,359 rows, 135 MB); restored
  into a scratch Postgres 16: every count equal, 71 policies, 2 triggers, 236 indexes = prod. Delivered to the
  owner as a tar. `npm run backup:supabase <dir>`.
- **Pending owner actions:** merge PR #345; then apply migrations 20261021120000 (PT credits + admin counts),
  20261021130000 (guard), 20261021140000 (index drop), 20261021150000 (collector_runs); decide the Supabase plan.

## Session 2026-10-21 A: California time everywhere + truthful admin counts + a full backup tool
- **OWNER DECISION 2026-10-21: no UTC anywhere — "we are in California".** Every day/week/month bucket and
  every displayed date is America/Los_Angeles via ONE helper, `lib/time/pacific.js` (pacificDate,
  pacificDayStart, pacificWeekStart, formatPacific, …; DST-tested). Never use `toISOString().slice(0, 10)`,
  `new Date(y, m, d)` (the server's day) or `getUTC*` for a calendar day; every `toLocale(Date|Time)String` and
  `new Date(…).toLocaleString` carries `timeZone: 'America/Los_Angeles'`. The daily AI-credit reset is the
  California day in JS (credits.js, user-sync.js) AND in SQL (migration 20261021120000 → consume_credit).
- **Admin "Added today" (22,511) was right for midnight UTC = 5 PM PT the day before**; now midnight PT. Active
  (72,392) and Stale (3,390) were right — they are `availability_status`, not `status`.
- **"All job listings — 1,000 total" was the PostgREST 1,000-row cap**, grouped as if it were every job. Now
  `admin_jobs_by_company()` (same migration) counts in SQL and returns ONE jsonb value (max-rows also caps a
  function's rows); before the migration the handler keyset-pages every row. Same cap class still exists in
  reads asking `limit=2000+` (reportWrite.js per-company reports, demand.js, search_logs, email_prefs) —
  harmless at today's sizes, wrong past 1,000 rows; fix when touched.
- **Backups: prod has none** (`pitr_enabled:false`, empty list). `scripts/backup/export-supabase.mjs <dir>` makes
  a full logical backup over the Management API (SUPABASE_ACCESS_TOKEN, read-only SQL, paced for its 429
  throttle): schema in two parts (before/after data), every public row + auth users/identities + storage rows
  + migration history as `jsonb_populate_recordset` inserts, Storage files, Vault secret NAMES, manifest with
  per-table counts, RESTORE.md. Postgres 17.6 in prod.
- **Data volume (prod, 2026-10-21):** 76,135 jobs (+41k in 24h, ~1–2k/hour steady, 38.7k from Greenhouse boards);
  DB 421 MB, jobs 361 MB (262 MB heap, 99 MB across 21 indexes, avg description 2.6 KB). Plan not readable
  with this token (org endpoint 403) — owner to confirm Free vs Pro (Free = 500 MB cap).

## Session 2026-10-20 I: first production import — rule false positives fixed + cleaned (owner: "yes do both")
- **First real runs from Seen Command (owner's Mac):** ~90 reports for Home Depot, Starbucks, Robert Half, Snowflake,
  Quantinuum, US Foods. Read back from prod, 9 were wrong, all at seams of `lib/reports/applicantRules.js`:
  a company name used as a word ("am I being a snowflake" — also in the thread TITLE), a company listed as a tool
  ("(Snowflake, etc") carrying scope to the next sentence, a second person between speaker and event ("why YOU
  didn't get the job"), questions ending "?." (the old check was `endsWith('?')`), an event inside quotes, and the
  later event losing ("hired me … just to reject me" → offer; "completely ghosted" → interview).
- **Fixes:** `mentions()` (no predicate "a <name>"), `weakMention()` (lists/parentheses/examples don't carry scope;
  also applied to titles), SECOND_PERSON in the speaker check, `askedAbout()` (a statement followed by a question
  still counts), `insideQuotes()`, negation judged on the clause after the last `but`. Each pinned by the real
  sentence in applicantRules.test.mjs. Old-vs-new diff over all 83 prod `reddit_rule_match` rows: exactly the bad
  ones change; one good row ("never worked at Home Depot but I have an interview") was caught and fixed.
- **One report per Reddit post/comment:** `redditPermalinkKey`/`canonicalSourceUrl` drop the title slug (OpenCLI
  links have it, archive links don't), and the ingest refuses an account when ANY report for that company already
  cites the same permalink (any pipeline, any state). The OpenCLI collector's subreddit already carries "r/", so
  its source was "Reddit r/r/Quantinuum" → platform "Reddit r/r"; both ends fixed.
- **Prod cleanup (audited, `username: claude-seenjobs (owner request 2026-10-20)`):** 6 rejected via
  `moderationPlan(…,'reject')`, 1 marked `duplicate_import`, 2 outcomes corrected (`correct_report_outcome`), 1
  platform corrected; 5 companies recomputed (Snowflake 69→62, Home Depot 91, Robert Half 56→58, Quantinuum
  87→85, Starbucks 87→85). Left as is (ambiguous, owner's call): RH "strong first interview with a recruiter",
  "in-person interview at the company", "got offered to work as a staff Accountant".

## Session 2026-10-20 H: "Approving these does nothing" — Admin → Recent hiring reports buttons (same branch)
- **Verified on prod (read-only):**
  - Every row in the last-25 list was already LIVE (needs_review=false). The owner approved 188 held rows
    02:00–06:00 UTC via the review queue (admin_audit_log `approve_held_report`).
  - ✓ (`approve_report`, routed through review_reports) only touches HELD rows → "ok, 0 changed", no feedback.
  - ✕ (`deny_hiring_report`) only set `outcome_weight 0`, which fusion IGNORES (it tiers by platform), so a
    "denied" report kept counting.
  - ? set needs_review=true, but held `external_import` rows still count (`SCORE_COUNTED_TRUST_REASONS`).
  - Net: no button on that list changed a grade.
- **Now** (`lib/server/reportModeration.js` + `moderate_report` in `api/admin-stats.js`; the old action names
  map to it):
  - approve = held → public;
  - reject = ANY row → `needs_review true, trust_reason admin_rejected, weight 0` (hidden, never scored);
  - hold = live → queue;
  - restore = a rejected row → its prior values from the audit log.
  - Every PATCH repeats its condition, each decision is audited with the prior values, and the company is
    recomputed. The answer always carries a message.
- **The list shows each row's state** (Live / Held / Rejected / Duplicate; "counts in grade") and
  `rules: passes|fails` (strict rules, run as comment and as post). Only meaningful buttons are enabled.
  Errors (including 401) are shown.
- **Data, not acted on (owner's call, row by row):** 17 of the last 25 rows fail the strict rules. Overall,
  28 of the 35 live Reddit-sourced imported rows fail, but without thread context some failures are real
  accounts — so nothing was auto-rejected. The site nav's "Sign in" on /admin is normal: the admin uses its
  own token, not a site session.

## Session 2026-10-20 G: every free report source + "Listing signals" for every company with posts
- **Sources (all free):**
  - `scripts/collect-archive-reports.mjs` runs the Reddit archive (`ARCHIVE_REPORTS_SOURCES`, now `reddit` only).
  - `scripts/collect-web-reports.mjs` (`WEB_REPORTS_*`) runs Google, searched and read in the owner's
    Chrome via OpenCLI. Google gives servers a JS wall and datacenter browsers its CAPTCHA (both verified
    2026-10-20). A CAPTCHA stops Google for the run and is never solved.
  - One loop for all of them: `lib/reports/collectorRun.js`. The ingest re-checks ANY host with context;
    non-Reddit passes → `Public review · <host>`, `web_rule_match`, weight 0.3.
- **OWNER DECISION 2026-10-20: NO HACKER NEWS, EVER** ("filled with vibecoders trying to sneak fake reviews
  that are self advertisements"). The HN collector (`hnHarvest.js`) is deleted. ONE list of excluded sources,
  `lib/reports/excludedSources.js` (HN + Glassdoor/Indeed/LinkedIn/Facebook/Instagram/X/TikTok/Threads), is
  enforced three times: the Google collector never opens them, the ingest refuses them ("excluded source: …
  (owner decision)"), and the paid web-search script passes HN as `blocked_domains`. Prod has 2 older
  HN-sourced rows from the Oct 17 paid pipeline (Stripe, Grafana Labs — `web_search_public_review`); not
  touched without the owner's OK. OpenCLI on the owner's Mac is 2.0.1 (the `--session` flag form).
- **OWNER DECISION 2026-10-20:** Glassdoor + Indeed review/interview pages stay SKIPPED (`webHarvest.js
  SKIP_HOSTS`, with LinkedIn/Facebook/X/TikTok). They are what Google mostly returns for applicant stories
  (Indeed: 15,413 interview reports for Home Depot). Do not relitigate. The sandbox safety check also
  blocked loading them.
- `lib/server/opencliBrowser.js`: OpenCLI browser commands in either argument form (2.x `--session` flag,
  1.8 positional session), retried once on a usage error. The career-site collector uses it.
- **Bug fixed at the source:** Adzuna fills `salary_min/max` with its OWN estimate
  (`salary_is_predicted="1"`). Seen showed it as the listing's pay and the scorer gave +12 "compensation
  disclosed" (−8 waste). `adzunaPay()` in `jobSources.js` drops estimates (also used by `api/jobs.js
  _fetchAdzuna`). Stored rows keep theirs until they expire (≤14 d): a re-seen row only bumps
  `last_seen_at`. Not measured: the predicted share (no Adzuna keys in the cloud env). Prod showed 102/102
  Walmart and 10/10 Chipotle Adzuna rows with a salary.
- **Listing signals** (`lib/server/listingSignals.js`, `POST /api/jobs {action:'listing_signals', company}`,
  `components/ListingSignals.tsx` under the grade on `/company/[slug]`):
  - Score = 30% pay shown + 30% avg listing transparency score + 25% apply-with-the-employer + 15% not
    open 30+ days. A missing part is dropped and the weights rescaled. Needs ≥3 open posts.
  - Labelled "from its job posts · not applicant reports". It NEVER touches company_scores or the grade.
  - Prod, read-only: SpaceX 66 (pay 6%, direct 93%, n=2,922); Walmart 63 (pay 100%, direct 0%); Amazon 58.
  - Name match = the page's own `company_jobs` key, so "Chipotle Mexican Grill" posts rate that page, not
    /company/chipotle.

## Session 2026-10-20 F: free, deep applicant reports from the Reddit archive (owner: "10 per company minimum… no cap", budget FREE ONLY)
- **Prod coverage before this work (read-only, 2026-10-20):**
  - 8,654 hiring companies, 8,243 of them with 0 reports; 4,111 scorable reports over 1,126 companies.
  - Only 28 companies have ≥10 reports.
  - The paid pipelines (web-reports.mjs Claude web_search; reddit-backfill.mjs Sonnet+Opus) are off the table
    by owner decision.
- **Rules:** `lib/reports/applicantRules.js` is a strict, rule-based first-hand classifier (no LLM).
  - The old `classifyRawRedditExcerpt` was mostly wrong on real archive text: other employers, advice,
    "maybe I'm way off base" counted as an offer.
  - Every rule is pinned by a real sentence in `applicantRules.test.mjs`.
  - `storableAccount` picks the stored words so Seen's server re-check passes on them alone.
  - `reports_outcome_check` has no 'assessment' → `REPORT_OUTCOME` maps assessment→interviewing and
    responded→human.
- **Harvester:** `lib/reports/archiveHarvest.js`.
  - Per company: its own subreddits (`pickCompanySubs`) + `JOB_SUBREDDITS`, year windows.
  - It ALTERNATES company-sub and job-sub searches. Company subs are mostly "got hired", job subs mostly
    ghosted/rejected (survivorship skew).
  - One account per voice; cross-posts are deduped.
  - The goal counts NEW reports Seen accepts (the collector's `onAccounts` returns `imported_reports`), so a
    re-run walks past what Seen already has.
- **Collector:** `scripts/collect-archive-reports.mjs` (`npm run ingest:archive-reports`).
  - Env: `ARCHIVE_REPORTS_{COMPANIES_JSON,COMPANY_LIMIT,BELOW,GOAL(0=no cap),YEARS,MINUTES_PER_COMPANY,TOTAL_MINUTES}`.
  - `GET /api/local-company-intel-targets?below=K` returns companies with open listings and fewer than K
    applicant reports, most listings first.
  - Seen Command's "✦ Applicant Reports" tab drives it (seen-command#227).
- **Ingest:** `api/ingest-local-company-intel.js` re-runs the rules on every Reddit account that carries a
  `context` (title, is_op, company_sub).
  - Pass → published like reddit_import: platform `Reddit r/<sub>`, source reddit, weight 0.3,
    `trust_reason 'reddit_rule_match'` (bulk-removable), needs_review false.
  - Fail → commentary (`downgraded`).
  - No context → the old held path.
  - The OpenCLI Reddit collector now sends context and uses the same rules.
- **Live yield (writes to a fake DB, real archive + real handler):**
  - Chipotle goal 5 ×2 runs → 10 distinct; Home Depot ~60 in 6 min via r/HomeDepot.
  - Chipotle 11 / Sheetz 6 in a 4-minute budget.
  - Small local companies have few real accounts; we never invent them.
- **Lessons:**
  - Node's fetch error is just "fetch failed"; the archive fetcher now appends `e.cause.code`, and a run's
    `search_errors` names it.
  - A sandbox/managed network needs `NODE_EXTRA_CA_CERTS`/proxy passed to child collectors (seen-command
    `NETWORK_ENV`).
- **NOT done:** a production import. Nothing was written to prod. The first real run should be a Preview,
  then an Import of the 25 thinnest.

## Session 2026-10-20 E: company-first job pull ("search Tesla → try every source") — PR #340 + seen-command #224
- **`POST /api/local-company-jobs`** (Bearer LOCAL_INDEED_INGEST_SECRET, 1–10 companies, 270s budget) runs
  `lib/jobs/companyJobs.js pullCompanyJobs` per company:
  1. **Boards**: registered `company_sources`, else `lib/jobs/boardFinder.js findBoards` probes 6 ATS by name slugs
     and registers hits (`discoveredVia:'company_search'`). A 200 is NOT proof: Workable answers 200 + 0 jobs and
     SmartRecruiters answers 200 for any slug, so a hit needs ≥1 job and, when the board names itself, the same name.
  2. **Career site**: `lib/jobs/careerSite.js` (robots → job sitemap → schema.org JobPosting).
  3. **Adzuna**, filtered by `sameCompanyName`.
  Every saved row is US/remote only.
- **Live 2026-10-20 (writes stubbed):** SpaceX: 2,760 from Greenhouse. Home Depot: 15/15 from its career site.
  Tesla: robots.txt itself is Akamai 403 → `needs_browser`. Walmart: JS-rendered → `needs_browser`.
- **Sites that refuse servers** go to the Mac: `scripts/collect-career-site.mjs` (OpenCLI browser open/eval/close —
  EXPERIMENTAL, argument form unverified) → `POST /api/ingest-local-career-jobs`, which re-runs `rowFromPosting`.
  Seen Command drives it as a third collector `career_site` and runs Indeed for the same names (its Company jobs tab).
- CodeQL rule hit twice this day: test fakes must route by `new URL(u).hostname ===`, never `/host\.com/.test(url)`.
- **Tesla / SpaceX test pages (owner, same day):** SpaceX's careers page is a front end for Greenhouse
  boards `spacex` + `spacexglobal` (+ `xai`, xAI's own) — the board sync already covers it (2,760 US/remote).
  Tesla blocks every server, even a datacenter headless Chrome; the Chrome collector now HARVESTS inside the
  open page (`harvestInPage`: Tesla's careers feed → scroll fallback; job JSON-LD → Tesla per-job feed),
  streams batches of 50, `CAREER_SITE_MAX_JOBS` default 3000. Tesla's real feed shape is unverified (only a
  real visitor's browser can read it) — the scroll path does not depend on it. JOB_INGESTION_ENGINE.md §29.1.

## Session 2026-10-20 D: job-writer request economy (same branch) — facts from prod edge logs 2026-10-19
- **The Supabase "Logs Ingest over quota" alert (org billing, restriction from 2026-10-28) was NOT Seen**:
  it was the separate Dispatch project (begindtheseen/Dispatch, Supabase ref gsxmncxvfmigjggjbzqb), whose
  always-on Railway worker polls `claim_task` every 3s from 4 runners (~115k gateway log lines/day). Owner
  decision 2026-10-20: retire Dispatch entirely; the owner DELETED its Supabase project the same day (alert
  resolved). Seen ≈ 20k edge log lines/day (~2.5 KB each).
- **Seen bug found in passing:** 1,384 of 1,620 `POST /rest/v1/jobs` on 10-19 were 400
  `invalid input syntax for type integer` — Adzuna salaries are decimals (41683.01) and `jobs.salary_min`
  is integer (written by api/jobs.js `_fetchAdzuna`, the location-jobs path). One decimal sank the multi-row
  INSERT, postShape's halving re-sent it ~2×log2(n) times, and the listing was still lost. Fixed at the class
  in `upsertJobs`: `coerceIntegerColumns` rounds every integer jobs column (salary_min/max, score,
  waste_score, availability_report_count) before posting.
- **Company ids are resolved in batches** (`resolveCompanyIds` in jobSources.js: one `name=in.(…)` lookup per
  ≤40 names / ≤6,000 encoded chars, one insert for the missing names, per-name fallback on any failed round).
  Replaces one GET per company (4,658/day) in upsertJobs and both refresh-jobs call sites.
- **Data facts, not acted on:** `companies` has 101,744 rows but 55,642 distinct names (no unique index on
  name; concurrent creates race) — a dedupe + unique index is a separate change. Seen's DB is 684 MB, of
  which `jobs` is 625 MB for 54 MB of live rows (dead space from 1.08M deletes / 1.17M updates);
  `VACUUM (FULL, ANALYZE) public.jobs` would reclaim it — not run (needs owner OK; DB size is not the red line).
- Tests: `lib/server/jobSources.requests.test.mjs` (6).

## Session 2026-10-20 C: SpaceX "16 applicant reports" — duplicates + employee reviews (same branch)
- **The Oct 18 SpaceX/Tesla import ran twice.** Every imported row exists exactly twice (same company,
  outcome, platform, role, text; invented timestamps up to a year apart): 150 extra copies = 13 hiring
  accounts + 137 employee reviews. SpaceX's "16 applicant reports" were 11 accounts (5 Glassdoor counted
  twice in the rates); its 90 Indeed employee reviews are 45. Tesla: 23 → 15 accounts, 184 → 92 reviews.
- **Duplicates** (`lib/server/reportDupes.js`, key = company+outcome+platform+role+text ≥40 chars): a copy is
  MARKED, never deleted — `{needs_review:true, trust_reason:'duplicate_import'}` (in
  NEVER_SCORED_TRUST_REASONS; needs_review keeps it out under the old filter too, so deploy order is safe;
  excluded from HELD_PENDING_FILTER). Keeper = oldest copy an admin has not rejected. Admin → Community →
  "Duplicate reports" (`scan_report_dupes` / `dedupe_reports`, audited `mark_duplicate_report` with prior
  values + `duplicate_of`, recomputes touched companies). The external `ingest` action now skips an account
  already held (or repeated in the batch).
- **Employee reviews now move the grade by their letter grade, never as hiring outcomes**
  (`lib/server/employeeReviews.js` parses `[B+]` on a 4-point scale; `employeeReviewAdjustment` in
  companyScore.js: ±5 max, C = neutral, nothing under 5 reviews, full strength at 30). They never touch
  response/ghost rates or the applicant count, and never create a grade on their own. Wired into the stored
  recompute, `_fuseWithReports`, and the audit bundle. Stored count `company_scores.employee_review_count`
  (migration 20261020120000, additive; probed by `hasEmployeeReviewCount`); the score cache recomputes when
  the live employee-review count differs. Badge: "11 applicant reports · 45 employee reviews · 20 online mentions".
- Dry run on prod data after marking: SpaceX 90 → 88 (82% response, 45 reviews avg 2.2 → +0), Tesla 87 → 78
  (92 reviews avg 2.4 → +1). Tests: employeeReviews 4, reportDupes 4, handler 2; suite 1359/1367 (the 8 = brain).

## Session 2026-10-20 B: "one press clears everything" — dupes, stale, company merge (same branch)
- **Admin job "Remove dupes" was deleting REAL listings.** Its key was title|company|`city`, and `city` is
  blank on every jobs row in prod (27,668 / 27,668), so it grouped the same title at the same company in
  different places (one Lever "Chief Officer" in Constanta, Rijeka, St Petersburg) — 4,247 rows queued. It also
  read one capped PostgREST page (1,000 rows), so each press found more, and it had no employer/user protection
  (seen_applications CASCADES from jobs). No audit row was ever written, so past deletions cannot be counted.
- **Now** (`lib/server/jobDedupe.js`): a duplicate = DB identity (lower title + lower company +
  `job_location_key(location)`, same as trigger jobs_dedupe_refresh) OR same source+external_id OR same apply URL
  (tracking params dropped) + same title. Prod 2026-10-20: exactly 4 duplicates, all one Adzuna /details/<id>
  ad stored twice with drifted company/location text. Employer-posted and user-held rows (saved_jobs,
  applications, seen_applications) are never deleted and are preferred as keeper. The scan reads every row by
  keyset pages (~6s); a failed reference read refuses the delete; DELETE repeats `is_employer_posted=eq.false`
  and `select=id` counts real deletions; each press is audited (`dedupe_jobs`, up to 300 row snapshots).
- **ONE client loop for every "press until done" admin action:** `components/admin/drain.ts drainAdminAction`
  (retries 502/503/504/empty/thrown rounds ≤2 in a row, stops on no progress, 40 rounds / 240s). Used by
  `clearStale.ts`, `dedupeJobs.ts` and the company Auto-merge. Do not hand-roll another loop.
- **Company dupes** (`lib/server/companyDupes.js`): scan read only the top 500 of 1,718 companies (said "none"
  while 3 groups existed). Now all. Auto-merge merges ONLY names differing by a legal suffix (Inc/LLC/Corp/Ltd/
  Co/PLC); "Compass Group" vs "Compass" (different companies) is listed as a look-alike for a human.
- **Clear stale panel:** the button + its result message unmounted the moment the reload showed 0, so a full
  clear looked like nothing happened; the message now stays. Stale on prod was 129 (all clearable) — the #333
  fix had not yet been pressed post-deploy.
- **Tracker "Clear dupes"** fired the deletes un-awaited and reloaded at once → the reload resurrected them.
  Now awaited (prod has 13 applications, 0 duplicates — latent).
- Verification: new tests (jobDedupe 8, companyDupes 2, dedupeJobs 4, handler 4 incl. 3,800-row paging);
  suite 1349/1357 (the 8 = brain timeline); tsc + next build clean; Playwright on `next start` with mocked
  writes: one press each — stale 9,000 in 4 calls incl. a 504, dupes 2,600 in 3 rounds, auto-merge 2 rounds;
  read-only dry run of the new rules on prod data = 4 groups / 4 deletes / 0 protected.

## Session 2026-10-20: held-report review queue (claude/friendly-sagan-47rfat) — facts verified on prod
- **Why SpaceX "lost" its reports:** nothing was deleted. The Oct 18 bulk import writes every row
  `needs_review:true`, and d6c9933 (PR #328, 10-19) made the company page hide ALL held rows. So 101 SpaceX
  rows (90 Indeed employee reviews, ~10 hiring accounts, 1 anonymous) vanished from the page while the
  hiring ones still counted in the grade. Across all companies, 302 rows are held.
- **Admin → Community → "Reports awaiting review"** (`components/admin/ReviewQueuePanel.tsx`; rules in
  `lib/server/reportReview.js`; actions `list_held_reports` / `review_reports` in api/admin-stats.js):
  - The default sort puts "needs your eyes" first: anything that isn't a clear positive outcome, plus
    anti-gaming holds. Then positives, then employee reviews.
  - "Approve all positive" skips possible duplicates.
  - **Approve NEVER touches outcome_weight.** The old `approve_report` forced 1.0. It had already done
    that to 25 rows, harmless to grades (fusion tiers by platform) but wrong data; it is now routed
    through the same path.
  - Approving an employee review sets trust_reason `external_employee_review`.
  - Reject keeps the row: needs_review stays true, trust_reason `admin_rejected`, weight 0.
  - Every decision goes to `admin_audit_log` with the prior values, PATCHes repeat the pending filter,
    and touched companies are recomputed.
- **SCORABLE_REPORTS_FILTER is now `and=(…)`** and excludes `external_employee_review` and
  `admin_rejected` regardless of hold. `trust_reason.is.null` is explicit because SQL `<>` drops NULLs.
  Prod count is identical to the old filter for every other row (4,088), minus 4 Tesla
  "Reddit firsthand employee DISCUSSION" rows that `EMPLOYEE_REVIEW_RE` now also catches (4,084).
- **Data facts, verified on prod, not acted on:**
  - 153 of the 302 held rows are verbatim duplicates (15 are hiring accounts, double-counted).
  - The 270 imported "employee reviews" are templated paraphrase with no source link.
  - The demo rows to delete (Hilton ×2, Advatix, Goodwill, "Seen Jobs") were APPROVED via the old
    button on 10-17–10-19.
  - Prod has NO database backups (`pitr_enabled:false`, empty backup list).

## Session 2026-10-19 D: Tailor v2 — the autonomous résumé optimizer (same branch / PR #329)
- **Why:** the owner tailored their résumé for a GNC Sales Associate posting and the v1 engine kept *Valet
  Attendant* while dropping *Membership Specialist – UFC Gym* (no bullets → no keyword score). The
  requirement is an optimizer that decides from what each job IS and works autonomously.
- **What:** `lib/resume/tailor/{competencies,relevance,optimizer}.js` — competency vectors implied by
  titles/employers/postings (built on `lib/application-intelligence/roleOntology.js`), relevance =
  0.6·coverage + 0.25·family alignment + 0.15·keywords (recency/tenure reported separately, never in
  relevance), tiers relative to the best role → keep/trim/condense/drop with constraints (current roles
  never dropped, no recent gap, ≥2 roles), bullet selection in a page budget, transferable fill flagged
  `confirm:true` + prompts (dates, family metric), targeted summary through the firewall, relevance layout
  ("Relevant Experience" + "Additional Experience" lines via `meta.sectionTitles` / extra `style:'lines'`),
  objective search (two seeds + hill-climb ≤60 evaluations, ~200 ms, deterministic). Full write-up:
  `RESUME_STUDIO.md` "Tailor v2 — the optimizer".
- **ONE apply path (contract):** `applyPlan(base, plan, overrides)` is used by the server (`tailorResume`)
  and the browser (`lib/resume/engine-client.ts applyTailorPlan`). The plan is self-sufficient JSON:
  decisions carry `ranked` + `implied`, skills edits are plan DATA (`planSkillEdits` in tailor.js →
  `applySkillEdits`), the summary context (`summary`, `summaryFallback`, `summaryKeywords`) rides in
  `plan.ctx`, terminology swaps apply only with `applyTerminology`. Caught by a probe before shipping: the
  browser re-apply picked a different fill bullet than the server because `implied` lived only on the
  internal `plan.roles` — the five-case "wire contract" test in `optimizer.test.mjs` now pins server ==
  client. Never add server-only post-processing on the variant again; put it on the plan.
- **Studio Tailor panel** (`components/resume/TailorPanel.tsx`): decision table (tier chip, relevance bar,
  reasons, competency chips, per-role keep/trim/condense/drop select — drop disabled for current roles),
  layout toggle, prompts, composed bullets with "Not true for me — remove", summary + skills toggles,
  polish accept/reject, gaps, strengths; everything re-applies locally (no credit). Button label is
  "Optimize for this job →" (the smoke script selects on it).
- **CodeQL (PR #329 head f87f42f) flagged 16 alerts in touched code — fixed at the class:** `newId` uses the
  platform CSPRNG (`globalThis.crypto.getRandomValues`, counter fallback; NO `Math.random` in lib/resume),
  one-pass XML entity decoding (`decodeXml` in extract/docx.js; `decodeEntities` in resumeUpload.js — the
  old chained `.replace(/&amp;/…)` first was a double-unescape), link kinds by HOST (`urlHost`/`hostIs` in
  model.js — never `url.includes('linkedin.com')`), credential-suffix regex made linear (disjoint tokens +
  mandatory separator), Markdown `esc` escapes `\`, rate-limiter logs use constant format strings + `logSafe`
  (newline-free, printable, ≤120 chars), smoke harness compares `new URL(url).host`. Same entity-decode
  pattern still exists in `lib/server/listingImport.js:157` and `api/reports.js:883` (not touched here).
  Round 2 (head 1d4806e, 9 alerts): the legacy `.docx` reader now takes each `<w:t>` run's CAPTURED text
  (`matchAll` group 1) instead of "stripping tags" from the match (CodeQL: incomplete multi-character
  sanitization); `logSafe` removes newlines as the plain alternation `/\n|\r/g` — the only form CodeQL's
  log-injection query recognises as a sanitizer (a `[\r\n]+` class is NOT); the optimizer's search loop no
  longer keeps a dead `variant` variable (only scores are compared; the final variant is rebuilt once);
  unused imports dropped. Reading alert annotations: `gh api repos/<o>/<r>/check-runs/<id>/annotations`.
- **Verification:** optimizer 9/9 + tailor 13/13; full suite 1302/1310 (the 8 = brain timeline, pre-existing);
  tsc clean; `next build` clean; server→JSON→client probe equal; smoke result recorded in RESUME_STUDIO.md.
- **/jobs "Matched to your résumé" rail — owner screenshot: "Upload your resume" card shown to an account WITH a
  résumé.** Root cause (two classes): `api/jobs.js handleRecommended` read ONLY the derived cache table
  `resume_skills` (filled best-effort by the upload path's `storeCareerSignals`, which returned early for any
  résumé with zero dictionary skills — i.e. most non-tech résumés — and is never run by a Studio/profile save),
  and the page treated "0 recommendations" as "no résumé". Now: the rail reads the CANONICAL résumé
  (`profiles.resume_text`, same `isReadableResume` predicate as the save gate) alongside the cache; when the row
  is missing / signal-less / older than `profiles.resume_updated_at` it derives the signal NOW
  (`deriveResumeSignal` in `lib/server/resumeJobMatch.js` = `extractEmployment` + `extractCareerSignal`, titles
  count as signal) and self-heals the row (PostgREST upsert `on_conflict=user_id`, awaited before returning).
  Response carries `has_resume: true|false|null` (null = profile read failed — never claim "no résumé" without
  evidence) and `reason: null|'no_resume'|'no_matches'|'no_signal'|'unavailable'`. `useJobSearch` exposes
  `recHasResume`; the upload card renders only on `has_resume === false`, and a résumé with no matches gets an
  honest one-liner instead. `storeCareerSignals` now writes the per-user row whenever titles OR skills exist
  (anonymized layers still need skills). Tests: `api/jobs.recommended.test.mjs` (5 handler cases, stubbed
  PostgREST + auth), `lib/server/resumeJobMatch.test.mjs` (+2). Schema note: `profiles.resume_text /
  resume_file_name / resume_word_count / resume_updated_at` exist in prod (every `save_resume` writes them) but
  are in NO checked-in migration — hand-applied drift to codify when the next schema PR lands.

## Session 2026-10-19 C: Résumé Studio (claude/resume-handling-optimization-ywotv9) — facts verified
- **The résumé pipeline is now structured end to end**: `lib/resume/{model,extract,parse,health,rewrite,tailor,render}`
  (see `RESUME_STUDIO.md` — the reference). `ResumeDoc` lives as LOSSLESS canonical text in
  `profiles.resume_text` (`serializeToText`), so there is **no schema change**; `parseResume(serializeToText(doc))`
  is stable and every text fixture round-trips through text, JSON Resume, PDF and DOCX at ATS score 100.
- **Extraction is layout-aware** (`lib/resume/extract/pdf.js`, pdfjs-dist 6.4 legacy build: columns, bold/italic,
  links; DOCX styles/numPr/tabs). `lib/server/resumeUpload.js extractUploadText` delegates to it; the old
  `pdfText.js` is the fallback. `vercel.json` now has `includeFiles: node_modules/pdfjs-dist/**` on
  `api/resume.js` + `api/apply.js` — **verify the first prod PDF parse after deploy reports `layout.method: 'pdfjs'`**.
- **`/api/resume` Studio actions** (`lib/server/resumeStudio.js`): `structure`/`health`/`rewrite`/`ats_check`/
  `templates` free (rate key `resume-studio` 120/h), `export` free-branded / Pro-unbranded (`resume-export` 60/h),
  `tailor` 1 credit via `gateAI('resume_tailor')` with `polish` Pro-only + `llmAvailable()`. `parse` also returns
  `doc`/`health`/`coverage`/`layout`/`warnings`. `download_resume`/`email_analysis` render through the new PDF
  renderer (`template` body field; legacy Harvard builder kept as fallback). Contract tests: `api/resume.studio.test.mjs`.
- **Renderer rules learned the hard way (verified with the real extractor):** never use pdfkit `characterSpacing`
  (pdf.js/pdfminer read "S U M M A R Y" — the LEGACY builder had this bug in production); pdfkit `text()` with a
  `link` needs an explicit `width` or the annotation rect is NaN; DOCX right-aligned dates must be a real
  `<w:tab/>` (`new Tab()`), not a literal tab in `<w:t>`; built-in Times/Helvetica garble non-WinAnsi glyphs →
  the renderer auto-switches to the embedded Liberation Sans TTFs that ship inside `pdfjs-dist/standard_fonts`.
- **Parser class fixes from the ATS round-trip:** packed-roles split must ignore pieces with a date range
  ("Title — Company | 2020 – Present" was two roles); bare known cities (`KNOWN_CITIES` in lexicon) are
  locations; "Audit Senior"-style trailing-role titles; a header piece that is ONE date is the role's date;
  a parked unknown header line occupies a title/company slot (stacked dateless headers no longer shift by one).
  Engine class fix: `extractTaxonomyConcepts` matches plurals of 4+ letter aliases ("forklifts").
- **UI:** `/resume/studio` (editor + Health/Tailor/Export panels; parse/score/rewrite run in the browser via
  `lib/resume/engine-client.ts`), entry points on `/resume` (header pill + card + Export-tab template picker +
  "tailor in Studio" hand-off via `sessionStorage.seen_studio_job`) and `/profile`. Device-local per-user caches
  (`seen_resume_doc_*`, `seen_resume_variants_*`) are swept on sign-out in `lib/auth.tsx`.
- **Verification:** full suite 1293/1301 (the 8 = brain timeline, pre-existing), `tsc` clean, `next build` clean,
  `node scripts/resume-studio-smoke.mjs` (Playwright against `next start`; uses `/opt/pw-browsers/chromium-1194`
  via `executablePath` because the installed playwright expects 1223) — all steps green. NOT verified live:
  signed-in tailoring against prod Supabase, LLM polish with a real key, Vercel includeFiles on a real deploy.
- Decision recorded: no `resume_documents` migration in this PR (device-local variants); revisit only if
  cross-device tailored versions are requested.

## Session 2026-10-19: Motion v2 — the "crisp" kit (claude/motion-graphics-update-yw7ei4)
- **All motion lives in `app/motion.css`** (imported after globals.css in app/layout.tsx, so it wins the
  cascade) + `components/motion/` (`MotionLayer` = the ONE pointer listener for `.spot` spotlight /
  `.tilt` + the `.grain` layer; `KineticText` = per-word clip reveal; `Odometer` = rolling digits).
  Transform/opacity/clip-path only, fine-pointer-only cursor effects, everything neutralized under
  `prefers-reduced-motion` (block at the end of motion.css). The 2026-10-17 phone-performance rules and
  the no-backdrop-filter-on-overlays rule (PR #322) are untouched.
- **There is NO blocking intro splash any more** (owner call 2026-10-19). `IntroSplash.tsx`, the
  `#intro-guard` cover and the `intro-seen` script are deleted. The opening is in the page: on the FIRST
  load of a session `app/layout.tsx` marks `html.seen-first` before first paint (sessionStorage
  `seen_opened`), and pure CSS rises the nav wordmark letter by letter + draws a hairline under the nav
  while the hero choreography runs. `useIntroGate()` now just flips once the display font is ready
  (≤300ms) — the API is unchanged for HomeHero. Rationale: the cover played on EVERY page's first
  load, including Google landings on company pages, and hid readable content for 1.4–3s.
- **Floating menus/panels over content are SOLID (#0e111c), never translucent glass.** The nav
  account/More menu used `--glass-strong` (72% alpha) + backdrop-filter nested inside the blurred
  nav; iOS Safari does not composite nested backdrop-filters, so the hero showed straight through and
  the menu was unreadable (owner screenshot 2026-10-19). Same rule already held for `.co-sticky` and
  CompanyScoreModal. Glass stays only on surfaces that sit over the static background.
- **Homepage v3** (owner asked for the "future concept" direction, not its colors or features): centered
  hero (`components/HomeHero.tsx`, same search routing + proof refresh) → `components/home/WorkspacePreview`
  — a window with Dashboard / Tracker / Company intel / Résumé AI tabs that each MIRROR A REAL SCREEN.
  Dashboard/Tracker/Résumé use labeled EXAMPLE data (fictional companies); Company intel shows REAL live
  Amazon data (the old proof card). Never add visitor/community counts — Seen has none (brain
  seen:growth). `LandingMarketingSections` = 4 feature cards (grades, tracker check-ins, SeenFit,
  Agency Ghost Index) + final CTA. Gotcha hit here: never use `<nav>` inside page content —
  globals.css styles every `nav` element as the fixed site bar.
- **Dashboard v2** (owner's second reference: "less clutter, less noise", look capable of 10k MRR):
  `app/dashboard/page.tsx` render rewritten on `dashboard.module.css` — intro (hello + one primary
  "+ Track application" → `/tracker?add=1`, which opens the add form) → row [health card with a
  one-sentence verdict + 4 Odometer pills | next best move] → row [active pipeline | signals] →
  benchmarks (only when enough data) → toolkit tiles (résumé status lives on its tile) → quiet
  recently-checked/badges rows. All data logic unchanged. Settings/sign-out left the hero (the nav
  account menu has them). Nav on ≤480px shows "★ PRO" (the long pill pushed logo + avatar off-screen).
- **Tracker check-ins live on the application card** (owner request 2026-10-19). `EventStore.dueChecks`
  returns ONE check per application — the earliest unanswered in schedule order; a snoozed one holds
  the app back rather than letting a later check jump it. The old full-card stack above the list (and
  its duplicate response+interview questions per old app) is gone; a one-line counter jumps to the first.
- **Jobs filters** (`components/jobs/JobFilters.tsx` + `.module.css`): one "Filters" button with a
  count badge opens a panel with the four selects; active filters show as self-clearing chips next to
  the button. Filter state/behaviour in `useJobSearch` is untouched.
- **Shared keyframe `fadeUp` was reshaped** (snap-in + settle) in motion.css — all 21 inline
  `animation: fadeUp …` call sites got crisper without edits. Nav active underline is ONE sliding
  indicator (`Nav.module.css .ind`, measured in Nav.tsx). Toasts carry `--dur`/`--acc` + `.timed`
  (draining hairline).
- **Fixed in passing (pre-existing):** `lib/hooks/useCountUp.ts` initialised from the reduced-motion
  media query inside `useState`, so the client's first render differed from the server HTML → React
  #418 hydration error on every hero figure under reduced motion; and the first rAF timestamp could
  precede the setTimeout start, flashing "-1%" in the hero gauge. Both verified with Playwright
  against the production build (`next start` + API calls proxied to prod).
- Company page: the page-local rAF score count-up is gone — `Odometer` renders the grade score and
  the integer metric tiles. Dashboard stat pills are Odometers too.
- Test suite: 1223/1231 pass; the 8 failures are `api/brain.timeline.test.mjs` (need the live brain)
  and fail identically on the untouched base commit.
- **Phone overflow rule (owner iPhone screenshot: "my toolkit gets cut off"):** a `1fr` grid track has
  `min-width:auto`, so one nowrap child (a résumé file name, "Report an outcome →") widens the whole
  column past the viewport and `.page-full{overflow-x:hidden}` just clips it. Every grid track in
  `dashboard.module.css`, `WorkspacePreview.module.css` and `LandingMarketingSections.module.css` is now
  `minmax(0, …)` and tiles carry `min-width:0`; the tracker's `.stage-step` flex items got the same
  (`min-width:0` + ellipsis, tighter at ≤400px — "Phone Screen"/"Final Round" clipped the last step at 360px).
  `document.scrollWidth` does NOT catch this class of bug; check per element (any non-fixed, non-decorative
  element with `getBoundingClientRect().right > clientWidth`) at 360/390/430 — verified clean on
  /dashboard, /, /tracker, /jobs, /companies, /company/amazon, /pricing.
- **The connected shell (owner: "the whole site needs to feel connected… like one product"):** `components/shell/`.
  `PageHeader` is THE header for every inner page (crumbs → eyebrow → title → sub → actions; `Crumbs` alone
  on the company page above its hero) — the root crumb is Dashboard for signed-in seekers, Home otherwise,
  so "back to the dashboard" is the same tap on every page. Used on tracker, companies, company, jobs,
  résumé, report, saved, profile, feed, demand, agencies, faq; do NOT hand-roll a new page header.
  `TabBar` = phone (≤768px) bottom tabs (Dashboard/Jobs/Track/Companies/Résumé; guests get
  Home/Jobs/Companies/Pricing/Sign in), solid #0e111c, hidden on /employers /login /reset /admin, ducks while
  a field is focused (`html.kb`), and sets `html.tabbar` which pads `.site-main`/`footer` and lifts the
  legacy bottom `.toast` (globals.css next to `.site-main`). `CommandPalette` = ⌘K / Ctrl+K (pages, actions,
  "Check “X”" → /company/slug, "Find “X” jobs", the user's tracked applications from `AppStore.loadSync()`,
  recently checked companies from `seen_recent_cos`) + `g` then d/j/t/c/r/s/h jumps; opened by the nav's
  "Jump to…" pill (desktop only) and the footer via `window.dispatchEvent(new Event('seen:palette'))`.
  `RouteProgress` = 2px top hairline on internal link clicks that change the pathname (and on
  `seen:nav-start`), completed by the pathname effect. Nav wordmark → /dashboard for signed-in seekers.
  Footer is a real site map (Product / Intel / Company / Legal). Verified with Playwright
  (`scratchpad/shell.mjs`: crumb click, g-t, Ctrl+K search/route, tab bar tap/duck, guest tabs, footer
  clearance) + the per-element overflow check on 15 pages at 360/390/430.

## Session 2026-10-19 B: logic fact-check of every non-résumé surface (owner: "fact check logics… bring the site to life")
Four read-only audits (dashboard+tracker, company page+scoring, explore/homepage/pricing, jobs) traced every
frontend→API→DB contract and probed prod. ~50 verified defects fixed in ONE pass (PR #328). Ground truth now:
- **Leaderboard** (`api/reports.js` + `lib/growth.ts`): the 150-row cap ran BEFORE the grade gate, ordered by the
  FUSED count, so web-claim rows filled the slots — /companies showed 66 while ≥150 were gradeable. Now
  `first_party_report_count=gte.1`, ordered by first-party. `order:'first_party'` is the only ordering.
- **Company reports list** was a first-word wildcard (`*general*` → Dollar General, Mass General under General
  Motors) with no post-filter; now wildcard-between-tokens + exact `sameCompany` key, and `needs_review` rows
  (anti-gaming holds) are never public. `company_jobs` (api/jobs.js) same class (Amazon Flex under Amazon).
- **Fusion** reads `wait_days,rounds` so `avg_wait_days`/`avg_rounds` are real (were null for every reports-
  derived score; the share PNG printed "0d"). Volume bonus + confidence use `effN` (trust-weighted), not raw row
  count — 8 Reddit rows ≠ "Moderate confidence · 8 reports". Stored rows only pick this up on the next recompute
  (new report, or the admin rescore). Fresh/populate saves now write `mention_count`, so the view-time
  self-repair no longer rewrites a web-researched row into `data_source:'reports', web_report_count:0`.
- **No invented numbers:** the company page "N Seen users checked this week" (a hash) is gone; the "Viewed"
  funnel bar (response×1.8) is gone — "Where they ghost" is built from reports' `ghost_stage` or hidden;
  tracker never says "their 21-day average" without `avg_wait_days`; HiringProbability no longer defaults a
  real 0% to 55% (`||`→ real values; it is the response rate, labeled "company-wide estimate");
  dashboard benchmark references come from GET `/api/reports?type=industry` (one server constant set, labeled
  "reference estimates"), never a second local table; the health verdict waits for ≥2 real outcomes and never
  says "beating the average". Dashboard ghost surges are served by `action:'ghost_surges'` (the browser's
  reports SELECT is DENIED in prod — the anon grant was revoked by hand; record in a migration if touched).
- **Tracker semantics:** "I withdrew" → `status:'withdrawn'` (was recorded as REJECTED and filed against the
  company). ONE community report per terminal outcome via `quick_submit` (hired now included; the day-30
  EventStore duplicate is gone). `dueChecks` asks only `active` apps. `AppStore.update/remove` await the sync
  (the un-awaited PATCH raced the reload and reverted clicks). Funnel "Screened" excludes ghosted/withdrawn;
  stats row has Withdrawn; "Clear dupes" is active-only, newest kept, confirmed.
- **Outcome follow-up cron** (`api/outcome-followups.js`) selected `applications.company` — the column is
  `company_name` — so it 400'd on every run since it shipped. Fixed; needs ONE fire with `?secret=` to confirm
  `sent>0` (not done from this session — no CRON_SECRET here). Env var is `RESEND_KEY` (not RESEND_API_KEY).
- **Feed:** SCORABLE filter + `count=exact`; the "ghost surges this week" banner (any 2 companies with a ghosted
  row on page 1) is gone; raw platform chip hidden when a provenance badge exists.
- **Demand:** `/api/demand` had been stale since 2026-08-14 (monthly cron silent for Sep + Oct — NOT verified
  why; Vercel log retention too short). The page now shows a stale banner, "~" on modeled totals, and the
  eyebrow drops "+ live Seen listings" unless a live city exists. The refresh log is read with the service key
  (it is service_role-only; the anon read returned null forever).
- **Jobs:** Remote = only listings that say remote (page fills from corpus and says `remote_thin`); the API
  returns `fallback: 'outside_radius'|'remote_thin'|'unrelated'` and the hook words each honestly ("No matches
  for X — showing N other openings"); a search requires a title (location-only ran an unfiltered Adzuna path);
  "Most recent" sorts by `posted_at`; zero-filter matches show an empty state, not every row; "Contract" option
  removed (no source emits it); the Posted filter is labeled "Added to Seen" (it is `created_at`); the listing
  scorer no longer carries hand-written KNOWN_GOOD/KNOWN_BAD company lists; the deck uses `Score.risk` thresholds;
  JobCard passes `isLoggedIn` to save/unsave (was hard-coded false → unsave resurrected); "Applied" badge keys
  on jobId/apply_url, not company; 60-row pages read "60+ results".
- **Copy:** FAQ rewritten to what the code does (no 47k companies, no surge emails, no per-location scoring, no
  hashed session id); grade bar wording = "enough evidence (≥1 report to Seen, 5 pieces; mentions ½)" via
  `notEnoughReviewsLabel`; "helps thousands" → "warns the next applicant"; landing names ranked agencies
  (Insight Global, Randstad, Addison Group); credits chip says "available" (balance includes purchased).
- **Homepage LivePulse** (`components/home/LivePulse.tsx`): real feed rows gliding by, worded "compiled
  applicant accounts" (brain seen:growth); dashboard greets by local hour (set after mount — SSR is UTC).
- **Prod data to clean (owner):** this session's demo wrote 4 `rejected` reports (Hilton ×2, Advatix, Goodwill
  SoCal, 2026-10-19 06:21–06:30 UTC, platform Seen) via the anonymous submit path, plus owner test rows
  ("Seen Jobs"/"test2"/"Test run"). Delete them and rescore those companies. The demo harness
  (`scratchpad/mockuser.mjs`) must stub `action:'submit'` and `quick_submit` — never proxy writes to prod.
- Deferred (larger product changes, listed in PR #328): capture source post dates as `posted_at`; level as a
  badge instead of a hard filter; a scored-company ghost badge on listings; pagination past 60; per-report
  `needs_review` badge for the submitter's own held reports; `profiles.onboarding_survey` has no writer.

## Session 2026-10-17: self-filling company pages read the Arctic Shift archive when Reddit refuses
- Verified on prod: the first enrichment cron run (Sheetz) got `reddit_429` from www.reddit.com on
  Vercel; cloud runners get 403. `ENRICH_SOURCE` (default `auto`) now switches the rest of a run to the
  Arctic Shift archive (`api/_utils/arcticShift.js`) after Reddit's first refusal. Reports keep the
  Reddit shape and permalink (the content is Reddit's). `reddit` / `arctic` pin one source.
- Archive facts (live 2026-10-17): posts/search needs `subreddit`; full-text search in big subs needs
  a time window; overload = HTTP 422 `{"error":"Timeout. Maybe slow down a bit"}` (fall back
  `query`→`title`); rate limit = "Too many requests" + `x-ratelimit-reset` seconds.

## Session 2026-09-29: stale-job protocol (one batched DB sweep) — facts verified on prod

- **Stale backlog was 95,505 rows (67% of `jobs`)** because all three stale paths silently died on
  the 8s `statement_timeout` service_role inherits: `deleteExpired()` (one unbounded, unchecked
  DELETE), admin `purge_stale_jobs` (one unbounded PATCH — button said "cleared N", wrote nothing),
  and `markStaleJobs()` (correct but 2 REST round trips / 200 rows). All replaced.
- **The protocol now lives in ONE place: `public.sweep_stale_jobs(p_mode, p_batch)`** (migration
  `20260929120000_stale_job_protocol.sql`, applied to prod), driven by `lib/server/staleSweep.js`
  from both the refresh-jobs cron (`'scheduled'`: active unseen 7d → stale+hidden; stale unseen 14d
  or `expired` → DELETE) and the admin "Clear stale" button (`'all'`: delete every unreferenced
  stale row now). Rows referenced by saved_jobs/applications are kept as hidden `expired`;
  employer-posted rows are never touched. Every candidate query is a partial-index range scan —
  OR-predicates made the planner seq-scan (8.4s/page), so keep the UNION ALL branches.
- Prod after the clear-out: 0 stale, 1 expired (referenced), ~49k active. A no-op sweep is 79–151ms.
- Admin: "Clear stale" no longer waits on a full `refresh-jobs?all=1` re-ingest (up to 300s); only
  the crisis banner re-ingests, with the clear in parallel. `jobs(created_at)` index took the admin
  "added today" count from 6,852ms → 8ms.
- Behaviour change: expired EMPLOYER-posted rows are no longer hard-deleted by the cron (the old
  unbounded delete did not exclude them); they stay hidden and visible in the employer's manager.

## Session 2026-07-04 (OPERATION 50%): growth plan approved — business decisions LOCKED

The owner approved the "Operation 50%" growth plan (target: ≥50% probability of $1–5k MRR
in 24–36 months via FOUR parallel revenue engines + weekly cadence + kill-gates). The full
plan and evidence live in the probability-assessment report + `playbook/` (weekly routine,
outreach scripts, content engine, 90-day calendar). **Locked owner decisions (rule 6 —
do NOT relitigate or unwind):** 7-day NO-CARD trial (rebuild approved) · one-time SKUs
(Interview Sprint $14.99 = +30 credits + 7-day Pro via `ai_credits.pro_until`; Credit Pack
$4.99 = +20 credits) · PostHog analytics (`NEXT_PUBLIC_POSTHOG_KEY`, no-op without key) ·
Resend outcome emails (`RESEND_API_KEY`) · beachhead niche = staffing-agency-ghosted /
r/recruitinghell audience with the Staffing Agency Ghost Index (/agencies) as hero asset ·
employer-side revenue (featured listings, sponsorships, Transparency Verified badge —
money NEVER changes a score). Prior context: 2026-07-03 shipped listing-score integrity
(#144), legal-audit source inventory (#145), Application Intelligence V2 (#146, industry-
agnostic), admin rescore endpoint (#147), V2 UI (#148), reported-listings admin (#149,
delete fixed in #150), admin jump fix (#151), instant autocomplete (#152).

## Session 2026-07-02 C (PR #127): conversion pass + jobs-page extraction (all facts verified)

Owner decisions taken this session (rule 6 — decided BEFORE building):
- **Free tier = 3 AI credits/day.** ⚠ SUPERSEDED — the CURRENT owner decision is **1/day**
  (see `lib/server/creditRules.js` FREE_DAILY_CREDITS = 1 and `app/pricing/page.tsx`'s
  "owner decision 2026-07-02" comment; all copy renders from the constant, and migration
  031/044's RPC resets to 1). Do NOT "restore" 3/day from this stale note.
  <s>Original note: code had reset to 1 while copy promised 3; baselines were set to 3.</s>
- **"Stealth Mode" is renamed "Human Voice" in ALL UI strings** (authenticity framing —
  never use evade/bypass/detection language). The `stealth` API field, code identifiers,
  and the separate HumanProof feature keep their names. Do not reintroduce "Stealth" copy.
- Paywall hero: "You already know who ghosts. Now get through to the ones who don't."
  Pro features are ordered intel-first (ghost alerts, company analysis) before Human Voice.
- Post-win upsell: non-Pro users see a dismissible "1 of your 3 daily credits" strip on
  optimize RESULTS (ApplyOptimizeModal review step + resume page) — tri-state pro gating.

Structure: **app/jobs/page.tsx is extracted** (1,608 → 347 lines): search state machine
lives in `lib/hooks/useJobSearch.ts`; UI in `components/jobs/` (JobCard, JobDetailDrawer,
SwipeJobDeck, JobFilters, CoPreviewModal). Effect ORDER inside useJobSearch is
load-bearing (URL-params effect claims autoSearchedRef before GPS/recent-search) — do not
reorder. The radius select (incl. Remote value="0") stays in the page's search bar.

Delegation lesson (recorded after a caught failure): **worktree subagents start on the
repo's DEFAULT branch (`main` = old HTML app), NOT your working branch.** An extraction
agent silently built on a 22-PR-stale tree and would have reverted the #124/#125 jobs
fixes — green build + 44/44 tests did NOT catch it. When delegating: pin the EXACT base
sha, and give the agent marker strings that must exist in the source before it starts and
in its output when done. Verify the markers yourself in the merged result.

Doc corrections: MONETIZATION_TODO.md item 1 falsely said the 7-day trial was "✅ BUILT" —
it was deleted in #93 (verified: no trial_period_days in api/stripe.js, no trial copy).
Corrected. Grep before trusting any feature-status claim in docs.

## Session 2026-07-02 B (claude/codebase-review-o344hb): review + merge of PR #124

- Full independent review of PR #124 (all 31 files read, build + 44/44 tests re-run
  locally, claims traced to code). Verdict: solid; merged as squash `7e2b274`.
- **Discovery: production had been running the PR #124 preview build since ~03:46 UTC
  (promoted via Vercel) while the PR sat unmerged** — merging closed the git/prod
  divergence. Lesson recorded: if a preview is promoted to production, merge the PR
  immediately, or the next unrelated merge to next-migration will silently roll prod back.
- Live-site audit of seenjobs.io: all 19 routes 200 with correct SSR titles;
  /company/coca-cola resolves (hyphenated-slug fix verified live); /api/jobs,
  batch_scores, demand, leaderboard, feed, sitemap, llms.txt all healthy.
- Added migration 037: codifies the 2026-07-02 hand-applied prod schema repairs
  (applications.events jsonb; job_id uuid→text + FK drop) idempotently — prod already
  matches; this is for fresh/restored environments.
- Fixed a follow-up gap in the PR #124 permalink fix: freshly-aggregated search results
  and nearestListings fallbacks still returned id:null (verified live — 49/49 results).
  aggregateForQuery now stitches upsert-returned DB ids/created_at back onto results;
  nearestListings selects id,created_at and maps posted_at.
- Restored the \x00 (NUL) strip in pdfText.js cleanupText (Postgres text columns reject
  NULs) alongside the newer \xa0→space normalize.

## Session 2026-07-02 A (PR #124): full-app audit — corrects older notes below

Six parallel audits swept every frontend→API contract, data round-trip, page flow, cron,
and import graph; 30 confirmed breaks fixed. Ground truth established this session:

- **`applications` schema (prod, verified by SQL)**: has `events jsonb` (added 2026-07-02 —
  its absence had been 400ing the tracker `load` for every signed-in user), `job_id` is
  **text** (was uuid + unusable FK), `applied_at` exists. `add_application` persists
  job_id/applied_at/events; the `load` select returns them.
- **Credits gate lives at `lib/server/credits.js`** — the `api/_utils/credits.js` path in
  the Session B notes below does NOT exist. `api/_utils/` holds companyIntel/companyScore/
  reportWrite/resumeSurvey/opportunityEngine.
- **Auth pattern**: `useAuth()` exposes `ready`. Any page that redirects on `!isLoggedIn`
  MUST wait for `ready` first, or it bounces signed-in deep-links while the session loads.
- **Sign-out data isolation**: `lib/auth.tsx` clears SESSION_LOCAL_KEYS (applications,
  saved, events, recent-cos, …) on SIGNED_OUT. Never re-introduce auto-import of
  device-local data into a signed-in account — that was the cross-user bleed vector.
- **Company slugs**: ONE scheme everywhere — `encodeURIComponent(name.toLowerCase()
  .replace(/\s+/g,'-'))`, decoded by /company/[slug] as decodeURIComponent + hyphens→spaces.
  Server name lookups in api/reports.js have a token-wildcard fallback for hyphenated names.
  Do not add punctuation-stripping slug functions.
- **Scoring weights** (api/_utils/companyIntel.js SOURCE_TRUST): direct 1.0 · survey
  (seen_intel) 1.0 · ingest 0.55 · reddit 0.3 · web prior 0.5. Fusion classifies by
  `platform` string, not the stored `source` column. Survey/report writes trigger
  recomputeCompanyScoreFromReports (reportWrite.js) so the company page updates instantly.
- **Vercel crons fire as GET** — any cron handler must route GET (x-vercel-cron header)
  into its refresh logic (see api/demand.js and api/reports.js patterns).
- **Stripe**: api/stripe.js disables the body parser and reads the raw stream (webhook
  HMAC needs the exact signed bytes); subscription reads must NOT use expand[]=items
  (invalid — 502'd all subscription management until 2026-07-02).
- **PDF extraction** (lib/server/pdfText.js): parses ToUnicode CMaps for subset fonts;
  looksLikeGarbledText() gates unreadable extractions with an honest 422.
- **Résumé employment parser** (lib/server/resumeAnalysis.js): COMMON_TITLE_WORDS must
  stay \b-anchored; company = single segment, cleaned by cleanCompany(). Tests:
  `node --test lib/server/*.test.mjs api/_utils/*.test.mjs` (44 tests — keep green).
- Remaining manual dashboard item: enable Auth leaked-password protection (HaveIBeenPwned).
- Deferred (known, acceptable): EventStore check-in ledger is device-local only (re-prompts
  on a new device); RLS-no-policy INFO lints are intentional (server-only tables).

## Migration Status (as of 2026-06-14 — HISTORICAL; see sessions above for current state)

### What was fixed in Session G (claude/index-file-stability-LrIfU):
- **HiringProbability component**: new `components/HiringProbability.tsx` — compact/full modes, calculates 3–70% probability from ghost/response rates + level match multiplier
- **SurveyModal component**: new `components/SurveyModal.tsx` — 4-phase survey (loading→intro→question→done/no-surveys), Zeigarnik effect, credit pop animation, dispatches `seen:credits-updated` event
- **Nav.tsx**: credit balance auto-refreshes on `seen:credits-updated` event via `useCallback` + `window.addEventListener`
- **company/[slug]/page.tsx**: Locations tab shows real city breakdown, Compare tab is functional, viewer count is stable hash (not random)
- **apply/page.tsx**: handleNotYetReason shows company risk intel when reason is comparing/unsure
- **admin/page.tsx**: 2-column KPI grid, colored left borders on cards, large numbers, section labels, build SHA stamp, DeployPanel
- **vercel.json**: Cache-Control no-store on /admin and /admin/(.*) to prevent stale CDN caching
- **DeployPanel in admin**: paste Vercel Deploy Hook URL once → deploy from admin UI going forward

### What was fixed in Session B (claude/seenjobs-migration-audit-pgszu3):
- **Next.js version**: upgraded 15.3.7 → 15.3.9 on next-migration (15.3.7 was flagged vulnerable by npm and blocked by Vercel)
- **package-lock.json**: restored on next-migration (was deleted by Session A, needed for deterministic Vercel builds)
- **api/_utils/credits.js, errlog.js**: added to next-migration (were missing, required by production API files)
- **All api/ files**: synced from main to next-migration (50 commits of production fixes)
- **Supabase migrations 004–012**: added to next-migration (were missing)
- **vercel.json**: updated on next-migration to match production (Reddit crons, reports.js maxDuration 300s)
- **parse-resume history**: `api/parse-resume.js` was merged into `api/resume.js` as `action:'parse'` branch — this was done under an incorrect assumption of Vercel Hobby 12-function limit. We are on **Vercel Pro (500 functions)**. Can be split back out any time.
  - `app/resume/page.tsx` currently calls `/api/resume` with `{action:'parse', base64, fileName, mimeType}`
- **Build verified**: `npm run build` succeeds — `✓ Compiled successfully`, all 19 pages build, zero TypeScript errors

### Critical Architecture Facts:
- `main` and `next-migration` have NO common git ancestor — they are unrelated histories
- Do NOT run `git merge origin/main` on next-migration — it requires `--allow-unrelated-histories` and will create mass conflicts
- To sync specific changes from main → next-migration: copy individual files with `git show origin/main:path > path`
- Production API files live in `api/*.js` (Vercel serverless), NOT `app/api/` (there are no Next.js App Router API routes yet)
- **Vercel Pro — 500 serverless function limit. No constraint on adding new api/*.js files.**
- Currently 9 declared api/*.js functions. Add new ones freely as needed.

### Vercel deploy: auto-deploy USUALLY works but is NOT guaranteed (updated 2026-08-13):
- Vercel is connected to the GitHub repo and normally every PR gets a preview and merging to
  `next-migration` deploys production (seenjobs.io) within ~2 minutes. **But it silently
  fails.** On 2026-08-13 the merge of #274 produced NO production deployment at all: commit
  `58c02f6` carried **zero GitHub statuses** — the integration never fired — and production
  served five-hour-old code while the database had already been migrated ahead of it. The
  previous wording here ("do NOT tell the owner to manually trigger deploys — merging the PR
  is the deploy") is what made that invisible, so it is now retracted.
- **VERIFY, then conclude. A merge that never deployed is indistinguishable from a fix that
  did not work** — you will misread it as "my change didn't help". After merging anything you
  intend to observe in production, confirm a **production** deployment exists for the merged
  sha before drawing any conclusion:
  `gh api repos/begindtheseen/Seen/commits/<sha>/status` (0 statuses = never fired), or check
  Vercel for `target: production` on that sha. **A green Vercel check on a PR is a PREVIEW,
  not production** — that exact confusion cost hours.
- If it did not fire, create the deployment for the merged sha (Vercel API `POST /v13/deployments`
  with `target: production` and a `gitSource` ref, or `vercel --prod`). The command-os repo now
  checks this automatically every hour (`scripts/deploy-drift.mjs`) and records the verdict as a
  brain fact, so drift is visible in Chronos → Brain rather than depending on memory.
- **Ordering rule, learned the hard way the same day: deploy code BEFORE schema**, or make the
  schema change backward-compatible so both the old and new build work against it. Migration 069
  was applied ahead of its code and every `append_timeline` failed — worse than the bug it fixed.
  Schema-first also has no cheap rollback: the old unique index could no longer be recreated once
  a row exceeded its size limit.
- Evidence: in the 2026-06-30 session, PRs #82–#87 each produced a green Vercel preview
  ("Ready/DEPLOYED" status checks) and the owner confirmed merged changes were live on the site.
- `"type": "module"` is set in package.json (fixes Vercel's ESM→CJS compile warning)
- Only genuinely-manual items left are dashboard settings, not deploys: e.g. confirming the
  Stripe webhook endpoint subscribes to the events the code handles
  (`customer.subscription.updated` for the trial flow), and Supabase migrations applied via
  the Supabase MCP `apply_migration`.

## Architecture
- **Framework**: Next.js 15.3.9 with React 19, App Router — MIGRATION IN PROGRESS
- **Current production**: Still running from `main` (HTML/JS single-page app with Vercel serverless)
- **API**: Vercel serverless functions in `api/*.js` — NOT `app/api/` (no App Router API routes exist yet)
- **Auth & DB**: Supabase (anon key is public, service key is server-only — NEVER in frontend)
- **Styling**: Custom CSS variables in app/globals.css — no Tailwind
- **State**: React Context (auth), localStorage stores (apps, saved jobs)
- **Deploy**: Vercel

## Code Principles
- Don't make rushed changes. Do it correctly the first time.
- No half-finished implementations.
- No backwards-compatibility hacks.
- Security: service_role key NEVER in frontend. anon key is intentionally public.
- `ADMIN_EMAIL` env var controls /api/admin-stats access.

## MANDATORY THOUGHT PROCESS (added 2026-07-02 after auditing PRs #75–#123)

A post-hoc audit found ~30 features that "looked built but had never once worked" —
every one failed at a seam this checklist would have caught. These are not suggestions;
run them on EVERY change. The root cause was always the same: reasoning about code in
isolation instead of verifying the whole path it lives on.

**1. Trace the full contract before writing OR trusting any code.**
For any frontend→API→DB path you touch, open BOTH sides and verify with file:line
evidence: exact field names in the request body vs what the handler destructures; auth
header sent vs auth the handler requires; HTTP method vs methods the handler routes
(Vercel crons fire GET); response fields vs what the client reads. Bugs shipped by
skipping this: tracker quick_submit sent no Bearer token (401'd silently for weeks),
company-page Track CTA sent a flat body the handler couldn't read (never worked once),
demand cron was POST-only, Stripe used an invalid expand[] param (502 on every call).

**2. Verify the actual DB schema, not the schema you assume.**
Before selecting/inserting a column, confirm it exists with the right type — read the
migrations AND, when in doubt, probe prod. The single worst bug (tracker dead for every
signed-in user) was a select on a column (`events`) that didn't exist in prod; another
was job_id being uuid in prod despite migration 016 saying text. Migrations with
`IF NOT EXISTS` silently no-op over pre-existing drift.

**3. Exercise the runtime path once, honestly, before calling it done.**
"The code reads correctly" is not verification. curl the endpoint / click the flow /
run the cron handler locally. A filter that was rendered but never applied (Posted
filter), a "Remote" option that silently ran a 25-mile local search, and a credit
response that reported a different balance than it persisted all pass code-reading and
fail one real invocation. State explicitly what you did NOT verify live.

**4. When you find a bug, hunt the CLASS, not the instance.**
Grep for the same pattern everywhere before closing the issue. The cross-user cache
bleed was fixed twice in two days (#118 résumé, #121 profile) because the first fix
patched one key instead of auditing every localStorage/cache key for user-scoping. Slug
generation existed in 3 divergent copies. One bug found = one pattern search owed.

**5. Never ship a known approximation.**
If you catch yourself writing a comment like "no created_at filter, assume recent" —
STOP. That exact comment shipped the lifetime-vs-daily credit cap bug that permanently
killed the earn incentive after 3 uses. Do it right or surface the blocker; an honest
TODO-and-ask beats silently-wrong logic every time.

**6. Decide once, then build once.**
The free-trial feature was built (#86), patched (#89), rebuilt key-only (#90), and
deleted (#93) in a single day because building started before the business decision was
settled. If a change hinges on an owner decision (pricing, trial policy, email infra),
ask first or put it behind MONETIZATION_TODO.md — don't iterate product strategy in code.

**7. Fixes ride with proof.**
Every fix PR names how it was verified (test added/re-run, live probe, build). If a fix
chain on the same file reaches attempt #3 (#78→#81 résumé exports), stop patching:
re-derive the requirement end-to-end, then make ONE correct change.

**8. Leave ground truth better than you found it.**
Update CLAUDE_HANDOFF.md + this file's session notes with FACTS you verified (paths you
opened, commands you ran) — never from memory. A prior session recorded a credits path
that didn't exist and later sessions built on the error. If prod state diverges from git
(promoted previews, hand-applied SQL), record it immediately and reconcile (merge the PR,
codify the migration) before anything else lands.

## Application Data Model
Every application must have:
- `id`, `company`, `role`, `city`, `platform`
- `status` (active/ghosted/hired/rejected)
- `stage` (Applied/Screening/Interview/Offer/Rejected/Ghosted)
- `addedAt`, `updatedAt`
- `events[]` — array of hiring events (see Event System in SEEN_STRATEGY.md)

## Event System (Critical)
Store event history, NOT just status changes:
```
application_submitted, response_received, assessment_received,
interview_received, interview_completed, offer_received,
rejected, ghosted, withdrawn
```

## Follow-Up System
- Day 7: "Did they respond?" [Yes/No]
- Day 14: "Got an interview?" [Yes/No]
- Day 30: "What happened?" [Offer/Rejected/Ghosted/Still Active]

## Anti-Gaming
- Treat submissions as CLAIMS, not facts
- Every event needs: source, confidence, trust_weight, timestamp, anomaly_flags
- Never present weak data as fact — use confidence labels

## Session Continuity
Before starting any session:
1. Read the memory vault: `memory/protocol.md` → `memory/HOME.md` → the newest
   note in `memory/timeline/` (the fast-recall layer; see below)
2. Run `git status` to see current state
3. Read SEEN_STRATEGY.md
4. Pick up exactly where previous session left off

At session END: append what happened to `memory/timeline/YYYY-MM-DD.md` and edit
any knowledge note whose facts changed (`memory/protocol.md` has the full loop).

## Memory Vault (`memory/`)
An Obsidian-compatible vault is the persistent, structured memory for this
project — an upgrade over relying on model context + this file alone. It splits
**temporal memory** (`memory/timeline/`, append-only dated session notes) from
**knowledge** (`memory/knowledge/`, `memory/decisions/`, `memory/people/` —
wiki-linked entity notes). Start at `memory/protocol.md`. The root docs
(this file, CLAUDE_HANDOFF.md, SEEN_STRATEGY.md, SEENJOBS_BEHAVIORAL_FLYWHEEL.md,
…) remain the deep reference the vault links back to.
