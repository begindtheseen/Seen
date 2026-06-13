# Visual Parity Audit — Seen
**Audit date:** 2026-06-13  
**Scope:** `origin/main:index.html` (13,354 lines) vs `next-migration` HEAD (`572b886`)  
**Method:** Full CSS/HTML extraction from old SPA, code diff of all 13 pages, Playwright full-page screenshots at 1440×900  

---

## Legend
- 🔴 CRITICAL — breaks the design feel, immediately visible
- 🟡 IMPORTANT — noticeable side-by-side, degrades experience
- 🟢 COSMETIC — pixel-level, acceptable for now

---

## Summary Estimates

| Dimension | Score | Main gap |
|-----------|-------|----------|
| **Functional parity** | **88%** | Admin (12/16 sections missing), resume URL tab |
| **Visual parity** | **65%** | Cosmos background intensity, jobs sidebar, feed element order, inner-page card density |
| **Behavioral parity** | **79%** | Scroll-reveal, surge banner conditionals, page transition feel |

---

## 1. Landing (`/`)

### Present ✅
- `ticker-wrap` / `ticker-track` (28 companies)
- `l-grid` 2-column (hero left, 310px verdict feed right)
- `vfeed-panel` with UTC clock, blinking green dot, company feed rows
- `hstat-strip` (47K+, 124K+, 47%, Free)
- `vtag` buttons with `.vtag-grade` A/F badges
- Full hero rotation animation (`wordInL`/`wordInR`, slot-machine decode, `heroSweep`)
- Company autocomplete (50 companies), location autocomplete (30 cities)
- Ghost surge strip (pulsing red dot + 5 pills)
- 4 below-fold marketing sections

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🔴 CRITICAL | Cosmos background intensity | Blue orb at `rgba(29,78,216,0.55)`, violet at `rgba(124,58,237,0.48)`, indigo at `rgba(99,102,241,0.32)` — rich deep atmospheric glow | Same orb positions but at 0.08–0.10 opacity — 7× too faint. Background reads as nearly flat black; original pops with vivid blue-violet-teal cosmos |
| 🟡 IMPORTANT | Below-fold scroll-reveal | Sections hidden (`display:none`), revealed via IntersectionObserver as user scrolls — sense of discovery | All 4 marketing sections render fully on first paint, no stagger/reveal |
| 🟡 IMPORTANT | Ghost surge strip — conditional | `id="heroSurgeStrip"` hidden by default, shown by JS only when ghost data found | Always rendered regardless of real data |
| 🟡 IMPORTANT | Verdict feed — live data | Populates from `/api/reports` action:feed, pushes new rows every 12s with `vfeedIn` slide animation | Renders static placeholder rows; real-time push not wired |
| 🟢 COSMETIC | Scroll indicator | `float`-animated chevron arrow | ScrollIndicator component — verify exact style matches |

---

## 2. Jobs (`/jobs`)

### Present ✅
- `jpage` / `jpage-hdr` wrapper
- `jlc` rows with risk coloring (safe/warn/danger)
- `jlc-title`, `jlc-co`, `jlc-loc`, `jlc-meta`, `jlc-actions`, `jlc-apply`, `jlc-save`
- `jrc-logo` letter-avatar, sort bar (`jtb`, `jct`, `jss`)
- Availability badges, waste badge, ghost risk badge
- Location autocomplete + GPS button

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🔴 CRITICAL | Sidebar filter panel | `jlay` grid (`220px 1fr`), sticky `filts` panel with job type checkboxes, experience levels, salary range slider (`fh`, `fo`, `fc`, `rng` classes) | No sidebar. Full-width list only. Filter panel missing entirely on desktop |
| 🔴 CRITICAL | Search bar structure | `jsb` flex row with `jsi flex1` query + `jsi` location side-by-side above `jlay` | Different structure and styling — not using `jsb`/`jsi` classes |
| 🟡 IMPORTANT | Score badge format | `jlc-score-badge` with `jlc-s` (1.25rem mono number) + `jlc-sl` label, top-right aligned | Uses `sring` circle — different visual shape and weight |
| 🟡 IMPORTANT | "Check company →" inline link | Each row has a small link to `/company/[slug]` | Not present in current job rows |
| 🟡 IMPORTANT | Instant search | Debounced 350ms, fires on each keystroke | Fires only on explicit "Search →" button press |

---

## 3. Job Detail (`/jobs/[id]`)

### Present ✅
- Full header with score ring, type/level/salary chips
- AI insights panel, formatted description
- "Check company →" link, sticky save+apply footer, back nav
- Availability warnings, "Report Your Experience" 4 quick-links
- "Apply & Optimize" modal

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | `jd-grid` stat row | 3-col stat boxes (`jd-stat`, `jd-sn`, `jd-sl`): Hiring Score / Avg Wait / Ghost Rate below the header | Not confirmed present — likely missing |
| 🟢 COSMETIC | Score badge visual | Old job detail page uses a different score display than `sring` | Minor shape difference |

---

## 4. Companies (`/companies`)

### Present ✅
- `ldr-grid` 5-col, `ldr-item`, `ldr-rank`, `ldr-name`, `ldr-score`, `ldr-label`, `ldr-bar`, `ldr-fill`
- Grade letters (A–F) with risk color coding
- Ghost rate + response rate badges, industry label, sort + search controls

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | `leaderboard-sec` wrapper | `border-top/bottom:1px solid var(--line)`, `background:var(--void)`, `padding:4.5rem 2rem`, `::before` radial glow (`rgba(59,130,246,.15)`) at top-center | Plain `div` wrapper — missing the void background, section borders, and radial glow. Grid floats without a grounded container |
| 🟡 IMPORTANT | Eyebrow text | `class="eyebrow"` → "Transparency rankings" (blue mono, .62rem, uppercase) | Inline amber bar + different text — different color system and weight |
| 🟡 IMPORTANT | Container width | `max-width:960px` | `max-width:1100px` — 140px wider, changes grid proportions |

---

## 5. Company Detail (`/company/[slug]`)

### Present ✅
- 7-tab system, score ring, hiring funnel, data quality badge, web reviews
- Ghost surge alert, TrackCTA, share buttons, live viewer count
- Pre-filled CTAs, `seen_recent_cos` localStorage write

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | Company header CSS classes | Old uses `co-header`, `co-hdr-l`, `co-hdr-r` with specific padding and typographic rhythm | May use inline styles — visual rhythm may differ |
| 🟡 IMPORTANT | Tab underline behavior | Old `co-tab` active state: `border-bottom:2px solid var(--blue)`, white text, transitions | Verify current tab active state matches exactly |
| 🟡 IMPORTANT | Report cards | Old `rcard` classes: left-border color-coded by outcome (ghosted=red, hired=green, rejected=amber) | Verify `.rcard` CSS applied correctly |
| 🟢 COSMETIC | Metric bar animation | `mbar-fill` animates `width` on mount | Verify fires on tab switch, not just page load |

---

## 6. Dashboard (`/dashboard`)

### Present ✅
- Greeting, 4-stat row, active apps list, alerts, survey insight, benchmarks, pipeline insight, badges, settings, sign out, recently-checked companies, "Find more jobs" CTA

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | Health score arc | Old renders a percentage arc animation for search health score | Current has simplified panel — arc animation missing |
| 🟡 IMPORTANT | Badges rendering | `BadgeStore` exists but verify badge cards actually render in dashboard | Not confirmed |
| 🟢 COSMETIC | `avgRT` in pipeline | Old shows average response time. Current omits (field not tracked) | Minor omission |

---

## 7. Application Tracker (`/tracker`)

### Present ✅
- `app-card`, stage pips, status pills, `handleCheckAnswer` (all branches), `check-card` prompts, "+ Track manually", "Clear all", "Clear dupes" always visible

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | Outcome card visual | Old `outcome-card` glass card with gradient border, company name at 1.4rem, Web Share API button | Outcome card may be present — verify `outcome-card` CSS class applied |
| 🟡 IMPORTANT | Status tab filter row | Old has `trk-tabs` (All / Active / Ghosted / Hired) above the list | Current may lack the tab-filter row |
| 🟢 COSMETIC | Card border-radius | Old `app-card`: `border-radius:14px`, `padding:1.1rem 1.25rem` | Verify matches |

---

## 8. Community Feed (`/feed`)

### Present ✅
- `rcard` outcome cards, company links, ghost surge banner, CTA strip, filter buttons (All/Interviewing/Ghosted/Rejected/Hired), load more

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | Element order | Old: CTA strip first → surge banner below (hidden by default) | Current: surge banner ABOVE CTA strip — order reversed from original |
| 🟡 IMPORTANT | Surge banner — conditional | Old hidden, populated only when ghost data found from API | Current always shows 5 hardcoded companies regardless of real data |
| 🟡 IMPORTANT | Feed header style | Old uses `class="eyebrow"` + `.section-h` heading | Current uses inline styles — different typographic system |
| 🟡 IMPORTANT | Filter button CSS | Old uses `feed-filter-btn` / `feed-filter-btn active` CSS class system | Current uses inline style objects |

---

## 9. Resume AI (`/resume`)

### Present ✅
- `resume-layout` 2-col, `rpanel` / `rpanel-title`, form classes (`fg`, `fl`, `fi`, `fs`, `rta`), `analyze-btn`, credit labels, drag-and-drop, score hero, strengths/gaps/tips sections

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | Upload vs Paste URL tabs | Old has two tabs: "Upload PDF" and "Paste URL / Link" — separate flows with tab switcher | No URL/link tab; combined textarea+drag-drop in one view |
| 🟡 IMPORTANT | `r-empty` empty state | Old: `float`-animated icon (2.5rem, 35% opacity) + `r-empty-txt` mono text | Verify current empty state matches |

---

## 10. Market Demand (`/demand`)

### Present ✅
- `demand-page`, `demand-hdr`, `demand-filters`, `demand-stat-row` (`dsr-n`/`dsr-l`), `demand-grid`, `dcity`/`dc-hdr`/`dc-body`/`dc-row`, DI color labels, per-job and per-city links

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟢 COSMETIC | Filter input widths | Old `jsi` class on inputs with `min-width:200px` | Verify matches |
| 🟢 COSMETIC | Urgency dot animation | `dc-urg::before` pulsing dot | CSS exists, should work |

---

## 11. Report Submission (`/report`)

### Present ✅
- All fields, outcome selector, 2-step progress bar, recent reports section, corrected unpaid work labels

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | Auth gate | Old shows "Sign in to submit" card when logged out | Verify auth gate renders |
| 🟡 IMPORTANT | Success state | Old transitions to a success card with share CTA | Verify success card renders after submit |
| 🟢 COSMETIC | Platform select options | Old has 12+ platforms (LinkedIn, Indeed, Glassdoor, Handshake, ZipRecruiter, AngelList, etc.) | Verify full list present |

---

## 12. Profile (`/profile`)

### Present ✅
- Name/email, ← Dashboard back link, change password flow

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | All profile fields | Old: City, onboarding survey display, account type toggle | Verify all fields present in the 204-line file |
| 🟡 IMPORTANT | Delete account | Old has delete account confirmation flow | Verify present |

---

## 13. Admin (`/admin`)

**12/16 sections missing.** See `ADMIN_PARITY_CHECKLIST.md` for detail.

| Section | Status |
|---------|--------|
| Auth (login/logout) | 🟡 |
| Header + KPI boxes | 🟡 |
| Jobs KPI | 🔴 Missing |
| Reports chart + outcomes | 🟡 API gap |
| Recent hiring reports + moderation | 🔴 Missing |
| Recent tracker apps | 🔴 Missing |
| Recent jobs browser | 🔴 Missing |
| Reported inactive listings | 🔴 Missing |
| Data quality issues queue | 🔴 Missing |
| Company deduplication | 🔴 Missing |
| Feature flags | 🔴 Missing |
| Duplicate account clusters | 🔴 Missing |
| API Health | 🔴 Missing |
| Background job runner | 🔴 Missing |

---

## Nav (`components/Nav.tsx`)

### Present ✅
- `nav-scrolled` on scroll, `logo-pulse`, `nav-pills` glass container, active tab pop animation, `btn-ghost`/`btn-solid`, mobile `side-menu`, ⚙ account modal, sign out

### Gaps

| Severity | Element | Old | Current |
|----------|---------|-----|---------|
| 🟡 IMPORTANT | Credit balance display | Old shows `<span id="navCreditsDisplay">` with remaining AI credits in nav-right when logged in | Not present |
| 🟡 IMPORTANT | Employer mode nav | Old shows different tabs when `userType === 'employer'` (Reports, Team, Billing) | Only seeker-mode tabs |
| 🟢 NOTE | Nav-pills styling | Old (index.html): bare flex wrapper, `background:none`, mask-gradient fade | Current globals.css: glass container, `background:rgba(255,255,255,.05)`, border, padding. **Current is more polished than original** |

---

## Cross-Cutting Issues

| Severity | Issue | Detail |
|----------|-------|--------|
| 🔴 CRITICAL | Landing cosmos background 7× too faint | Fix: update 5 radial-gradient opacity values in `app/page.tsx` cosmos div to `0.55, 0.48, 0.22, 0.32, 0.20` |
| 🟡 IMPORTANT | Jobs sidebar filter panel missing | Most-visited inner page missing a structural layout element on desktop |
| 🟡 IMPORTANT | `glow-card` / `glass` underused | Old uses these extensively on company, tracker, and dashboard cards. Current mixes with plain inline-style divs, losing the aurora-fill gradient on many surfaces |
| 🟡 IMPORTANT | Below-fold scroll-reveal (landing) | Old fires IntersectionObserver with staggered `fadeUp` per section. Next.js SSR renders everything on first paint — reveal effect gone |
| 🟡 IMPORTANT | Hardcoded ghost surge data | Feed and landing surge strips use hardcoded companies instead of real API ghost data |
| 🟢 COSMETIC | Page enter timing | Old: `pageEnter .32s, translateY(11px)`. Current: `pageIn 0.25s, translateY(8px)` — slightly faster/shorter |

---

## Shortest Path to Visual Indistinguishability

Ranked by impact-per-hour:

**Hour 1 — Maximum impact, surgical changes**
1. **Fix landing cosmos opacity** — 5 inline style values, ~10 min. Change `0.08→0.55` (blue), `0.07→0.48` (violet), `0.04→0.22` (teal), `0.06→0.32` (indigo), `0.05→0.20` (purple). Eliminates the #1 visual gap.

2. **Wrap companies in `leaderboard-sec`** — Add `border-top/bottom`, `background:var(--void)`, `padding:4.5rem 2rem`, `::before` glow pseudo. ~20 min.

3. **Fix feed element order + surge conditional** — Move CTA strip above surge banner; hide surge banner by default until data loads. ~30 min.

**Hours 2–4 — Layout and structure**
4. **Add jobs sidebar filter panel** — `jlay` grid, sticky `filts` panel with 4 filter sections using globals.css classes. ~2 hours.

5. **Add `jd-grid` stat row to job detail** — 3-col stat boxes (Score / Avg Response / Ghost Rate) below header. ~30 min.

6. **Add below-fold scroll-reveal on landing** — IntersectionObserver in `LandingMarketingSections` with staggered `fadeUp`. ~30 min.

**Hours 4–6 — Nav and cards**
7. **Add credit balance to nav** — Fetch from user context, display in nav-right. ~45 min.

8. **Audit `glow-card` / `glass` usage across inner pages** — Company detail, tracker cards, dashboard panels. ~2 hours.

9. **Connect surge banners to real API data** — Feed and landing strip pull from `/api/reports` ghost surge action. ~45 min.

**Hours 6–14 — Admin (highest effort)**
10. **Admin parity** — 12 missing sections, ~8–12 hours. Priority: Recent reports + moderation, Jobs KPI, Data quality queue.

---

*Last updated: 2026-06-13. Do not implement from this doc — audit only.*


## ROOT CAUSE

All design system CSS exists in `app/globals.css` but pages use inline styles instead of the CSS classes.
Fix = swap inline styles for the correct CSS classes + add missing structural elements.

---

## GLOBAL FIXES (affect every page)

| # | Fix | CSS/Location | Status |
|---|---|---|---|
| G1 | Add `<div className="aurora"><div className="aurora-3" /></div>` to root layout | `app/layout.tsx` | ✅ |
| G2 | Nav scroll handler: add `nav-scrolled` class on scroll >10px | `components/Nav.tsx` | ✅ |
| G3 | Nav-pills mask gradient on horizontal scroll | `components/Nav.tsx` | ✅ |

---

## HOMEPAGE (`/`) — `app/page.tsx`, `components/LandingHero.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| H1 | Replace inline cosmos bg with `className="aurora"` | globals.css:57 | ✅ |
| H2 | Add `.vfeed-panel` with corner tick marks | globals.css:664-682 | ✅ |
| H3 | Add `.vfeed-live` pulsing indicator | globals.css:680 | ✅ |
| H4 | Apply `grad-text` to hero headline words | globals.css:83 | ✅ |
| H5 | Word-slam animations on hero text (`.hw.in-l`, `.hw.in-r`) | index.html hero JS | ⬜ |
| H6 | Right column glass panel (vfeed-panel — already used) | globals.css:225 | ✅ |
| H7 | Entrance animations: `fadeUp` with stagger on sections | globals.css:43 | ✅ |

---

## JOBS (`/jobs`) — `app/jobs/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| J1 | Job card entrance stagger: `animation: fadeUp .4s ${i*0.06}s ease both` | globals.css:43 | ✅ |
| J2 | Suggestion/proposal chips visual styling | globals.css | ⬜ |

---

## JOB DETAIL (`/jobs/[id]`) — `app/jobs/[id]/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| JD1 | Apply `hero-terminal` class to job header card | globals.css:225 | ✅ |
| JD2 | Waste score panel with `.rdim` red tint | globals.css | ✅ |
| JD3 | Status bar with pulsing blue indicator | index.html ~L5900 | ✅ |

---

## COMPANIES (`/companies`) — `app/companies/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| C1 | Grid: 5-col → 3-col → 2-col (`.ldr-grid`) responsive | globals.css | ✅ |
| C2 | Waste badge (`.ldr-waste`) below company name | globals.css | ✅ |
| C3 | Live "updated" indicator | index.html | ✅ |

---

## COMPANY DETAIL (`/company/[slug]`) — `app/company/[slug]/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| CD1 | Grade bar full glow shadow (`.co-grade-bar.safe/warn/danger`) | globals.css:461 | ✅ |
| CD2 | Header bottom gradient overlay (`::after` pseudo) | globals.css | ✅ |
| CD3 | Feed card outcome border width: 3px not 1px | globals.css | ✅ |

---

## TRACKER (`/tracker`) — `app/tracker/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| T1 | Funnel visualization — apply `.funnel`, `.funnel-stage`, `.funnel-bar-fill` | globals.css:167 | ✅ |
| T2 | Funnel bar color-coding (blue/amber/red/green per stage) | globals.css:171 | ✅ |
| T3 | Ghost-note `.funnel-ghost-note` in red italic | globals.css:173 | ✅ |
| T4 | "I withdrew" option in outcome_check answers | `app/tracker/page.tsx` | ✅ |
| T5 | Stage transitions in `handleCheckAnswer` (Interview, Phone Screen, Withdrew) | `app/tracker/page.tsx` | ✅ |
| T6 | Wire `OutcomeCard` component after terminal outcomes | `components/OutcomeCard.tsx` | ✅ |
| T7 | `RoundsPrompt` bottom sheet after offer | to be created | ✅ |

---

## FEED (`/feed`) — `app/feed/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| F1 | Feed card border width: 3px (currently likely 1px) | globals.css | ✅ |
| F2 | Outcome-specific emoji verification | index.html | ✅ |

---

## RESUME (`/resume`) — `app/resume/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| R1 | `countUp` animation on score display | globals.css:49 | ⬜ |
| R2 | Colored icons: green (strengths), red (gaps), amber (tips) | index.html | ⬜ |

---

## ADMIN (`/admin`) — `app/admin/page.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| A1 | Background gradient (blue/purple radial) | index.html | ✅ |
| A2 | KPI cards: colored borders + glow shadows per type | index.html | ✅ |
| A3 | Report cards: outcome-based left border 3px | globals.css | ✅ |
| A4 | Section separators: stronger visual grouping | index.html | ✅ |
| A5 | Full admin visual redo — premium control center feel | index.html | 🟡 |

---

## NAV — `components/Nav.tsx`

| # | Fix | Source | Status |
|---|---|---|---|
| N1 | Scroll handler: add `nav-scrolled` class at scroll >10px | globals.css:88 | ✅ |
| N2 | Nav-pills horizontal scroll mask gradient | globals.css | ✅ |

---

## PRIORITY ORDER FOR RESTORATION

### Phase 1 — Global (highest ROI, affects every page)
1. G1: Aurora orbs in layout
2. G2/N1: Nav scroll handler
3. H1: Homepage cosmos bg cleanup

### Phase 2 — High severity pages
4. H2-H7: Homepage hero terminal + vfeed panel
5. JD1-JD3: Job detail hero terminal
6. T1-T3: Tracker funnel visualization

### Phase 3 — Medium severity
7. C1-C3: Companies grid density + waste badges
8. CD1-CD3: Company detail glow shadows
9. A1-A5: Admin visual redo
10. J1-J2: Job card animations

### Phase 4 — Low severity + functional tracker gaps
11. F1-F2: Feed border width
12. R1-R2: Resume animations
13. T4-T7: Tracker functional gaps (withdrew, stage transitions, OutcomeCard, RoundsPrompt)

---

## DESIGN RULES (port these exactly)

### Card glass effect (`.glow-card`)
```css
background: rgba(255,255,255,0.026);
border: 1px solid rgba(255,255,255,0.1);
border-radius: 18px;
box-shadow: 0 16px 56px rgba(0,0,0,0.55), 0 0 60px rgba(59,130,246,0.12),
            inset 0 1px 0 rgba(255,255,255,0.07);
backdrop-filter: blur(16px);
```

### Grade bar glows
```css
.safe:  box-shadow: 0 0 40px rgba(16,185,129,0.2),  0 0 80px rgba(16,185,129,0.08)
.warn:  box-shadow: 0 0 40px rgba(245,158,11,0.2),  0 0 80px rgba(245,158,11,0.08)
.danger: box-shadow: 0 0 40px rgba(239,68,68,0.2),  0 0 80px rgba(239,68,68,0.08)
```

### Aurora orbs (div.aurora > div.aurora-3)
Already in globals.css:57-63. Just needs to be rendered in layout.tsx.

### Entrance stagger pattern
```tsx
style={{ animation: `fadeUp .4s ${index * 0.06}s ease both` }}
```
