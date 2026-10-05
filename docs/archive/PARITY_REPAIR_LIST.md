# Seen — Full Parity Repair List
> Generated: 2026-06-13, Session C. Source: 5 parallel audit agents vs `origin/main:index.html`

---

## TIER 0 — Production-Breaking (Ship nothing else first)

| # | Issue | File | Agent |
|---|-------|------|-------|
| T0-1 | **`api/reports.js` missing `leaderboard` action** — `/companies` page calls `{ action:'leaderboard' }`, `body.company` is undefined → 400 "company required". Companies scoreboard loads zero data. | `api/reports.js` | D |
| T0-2 | **CSS `.oc-*` classes entirely missing from globals.css** — Feed outcome cards reference `.oc-headline`, `.oc-comp`, `.oc-trust-sig`, `.oc-actions`, `.oc-btn`, `.oc-btn-ghost`, `.oc-btn-blue`, `.oc-btn-green`, `.oc-btn-share`, `.oc-stat`, `.oc-benchmark`, `.oc-bar`, `.oc-bar-fill`, `.oc-trust`, `.oc-cta`, `.oc-dist`, `.oc-dist-seg`. No styling = feed cards render as unstyled blobs. | `app/globals.css` | E |
| T0-3 | **CSS `.issue-*` classes missing** — Admin issue reporting modal uses `.issue-ov`, `.issue-box`, `.issue-type-grid`, `.issue-chip`, `.issue-row`, `.issue-badge.*`. No styling = modal unusable. | `app/globals.css` | E |
| T0-4 | **CSS `@keyframes pageExit` + `.page.page-exiting` missing** — Old SPA had page-exit fade/slide animation. Class referenced by JS transition system. Page transitions visually janky (no exit, hard-cut). | `app/globals.css` | E |

---

## TIER 1 — Core Product Features (Major visible regressions)

### Company Detail (`/company/[slug]`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T1-1 | **5 missing tabs**: Process Score, Locations, Open Roles, Reddit, Compare | MISSING | `app/company/[slug]/page.tsx` |
| T1-2 | **"I'm applying here — track it" CTA** — adds company to tracker from company page | MISSING | `app/company/[slug]/page.tsx` |
| T1-3 | **Hiring funnel visualization** ("Where they ghost" — Applied→Viewed→Responded→Ghosted stage breakdown) | MISSING | `app/company/[slug]/page.tsx` |
| T1-4 | **Data quality badge** — 🟢 High / 🟡 Moderate / 🔴 Low with sub-text confidence label | MISSING | `app/company/[slug]/page.tsx` |
| T1-5 | **Web reviews section** — Glassdoor/Reddit/LinkedIn sentiment quotes mixed with reports | MISSING | `app/company/[slug]/page.tsx` |
| T1-6 | **Expected timeline widget** — typical interview timeline for this company | MISSING | `app/company/[slug]/page.tsx` |
| T1-7 | **Ghost surge alert** — "⚡ Ghost surge this week" red banner | MISSING | `app/company/[slug]/page.tsx` |

### Landing Hero (`/`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T1-8 | **Word-slam line 1 entrance** — `_buildWordSpans()`: each word enters with blur + lateral slide, 70ms stagger, `wordInL`/`wordInR` | MISSING | `components/LandingHero.tsx` |
| T1-9 | **Line 2 decode/lock animation** — `_decodeLine2()`: slot-machine character swap, words "lock" staggered, color shift purple→green with glow | MISSING | `components/LandingHero.tsx` |
| T1-10 | **Word exit on rotation** — `_setHeroRotation()`: direction-aware exit via `--exit-dir` CSS var, 40ms stagger per word, `wordOutCont` keyframe | MISSING | `components/LandingHero.tsx` |
| T1-11 | **Company name autocomplete** — `debounceCompanySuggest()` populates dropdown as user types in search | MISSING | `components/LandingHero.tsx` |
| T1-12 | **Location autocomplete** — `debounceLocationSuggest()` populates city/state dropdown | MISSING | `components/LandingHero.tsx` |

### Tracker (`/tracker`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T1-13 | **"+ Track manually" button** — opens form to add application manually | MISSING | `app/tracker/page.tsx` |
| T1-14 | **"Clear all" button** — mass delete all applications | MISSING | `app/tracker/page.tsx` |

### Job Detail (`/jobs/[id]`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T1-15 | **"Report Your Experience" section** — currently "COMING SOON" placeholder; old had interactive outcome form | PLACEHOLDER | `app/jobs/[id]/page.tsx` |
| T1-16 | **"Apply & Optimize" modal** — old had resume optimizer modal on apply; new is just direct external link | MISSING | `app/jobs/[id]/page.tsx` |

---

## TIER 2 — Medium Impact (Noticeable feature gaps)

### Feed (`/feed`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-1 | **Ghost surge banner** — "Companies with ghost surges this week" with company chips | MISSING | `app/feed/page.tsx` |
| T2-2 | **"Your Experience Matters" CTA strip** — green-bordered submit prompt at top of feed | MISSING | `app/feed/page.tsx` |

### Dashboard (`/dashboard`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-3 | **Account settings shortcut** — gear icon → modal with password reset (was in old dashboard header) | MISSING | `app/dashboard/page.tsx` |
| T2-4 | **Sign-out button** — old dashboard had sign-out in header; new requires going to /profile | MISSING | `app/dashboard/page.tsx` |

### Jobs (`/jobs`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-5 | **Ghost rate badge on job cards** — "👻 {X}% ghost" or surge warning with pulse; major UX differentiator | MISSING | `app/jobs/page.tsx` |
| T2-6 | **Job status badges** — "⚠ may be closed" (stale 7d+) / "✕ likely closed" (expired 14d+) | MISSING | `app/jobs/page.tsx` |
| T2-7 | **Location autocomplete** — city/state dropdown as user types in location field | MISSING | `app/jobs/page.tsx` |

### Companies list (`/companies`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-8 | **Ghost rate + Response rate** on leaderboard tiles (hidden on mobile but present on desktop) | MISSING | `app/companies/page.tsx` |
| T2-9 | **Industry label** under company name | MISSING | `app/companies/page.tsx` |
| T2-10 | **Rank number** (#1, #2…) on each tile | MISSING | `app/companies/page.tsx` |

### Resume AI (`/resume`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-11 | **Credit cost display** — "· 1 credit" label on analyze/coach/proposal buttons so users know cost | MISSING | `app/resume/page.tsx` |
| T2-12 | **Drag-and-drop upload** — `ondragover`/`ondrop` with visual border feedback; new is file input only | MISSING | `app/resume/page.tsx` |

### Report (`/report`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-13 | **Recent community reports** at bottom of report page (last 25, social proof) | MISSING | `app/report/page.tsx` |
| T2-14 | **Step progress indicator** — visual 2-step bar (The listing / What happened) | MISSING | `app/report/page.tsx` |

### Profile (`/profile`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-15 | **City/location field** — "Your city" for auto-loading nearby jobs on Jobs page | MISSING | `app/profile/page.tsx` |

### Demand (`/demand`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-16 | **"Find these jobs →" button** — navigates to /jobs filtered by role + city | MISSING | `app/demand/page.tsx` |
| T2-17 | **"Best companies ↗" button** — opens /companies filtered by location + niche | MISSING | `app/demand/page.tsx` |
| T2-18 | **DI label color-coding** — "Critical"/"High"/"Active"/"Moderate" text label alongside bar | MISSING | `app/demand/page.tsx` |

### Landing (`/`)
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-19 | **Ghost surge strip** — live surge alert below search on landing page | MISSING | `components/LandingHero.tsx` |
| T2-20 | **Verdict feed row → company click** — clicking a company in feed navigates to `/company/[slug]` | MISSING | `components/LandingHero.tsx` |
| T2-21 | **Cosmos background** — landing-specific 5-layer radial gradient background (not the global aurora) | MISSING | `app/page.tsx` |

### CSS/Visual
| # | Feature | Status | File |
|---|---------|--------|------|
| T2-22 | **`.glow-card:hover` duplicate rule** — defined twice, causes CSS cascade issues | BUG | `app/globals.css` |
| T2-23 | **`.adm-btn` / `.adm-btn-danger` hover styles** missing | MISSING | `app/globals.css` |
| T2-24 | **`.qs-row` / `.qs-btn`** — quick-switch filter buttons in feed modal | MISSING | `app/globals.css` |

---

## TIER 3 — Polish (Low impact, do last)

| # | Feature | File |
|---|---------|------|
| T3-1 | Report: company/location autocomplete hints | `app/report/page.tsx` |
| T3-2 | Report: Unpaid work option labels differ from old (old: "Yes—unpaid test / Yes—but paid") | `app/report/page.tsx` |
| T3-3 | Profile: back button to dashboard | `app/profile/page.tsx` |
| T3-4 | Tracker: "Clear dupes" always visible (old) vs conditional (new) | `app/tracker/page.tsx` |
| T3-5 | Resume: text-paste flow changed (was separate view, now combined with upload status) | `app/resume/page.tsx` |
| T3-6 | Landing: hero sweep effect (gradient flash after line 2 locks) | `components/LandingHero.tsx` |
| T3-7 | Dashboard: recently checked companies section | `app/dashboard/page.tsx` |
| T3-8 | Company detail: shareability buttons (↗ Share, 🔴 Reddit, 🧵 Threads) | `app/company/[slug]/page.tsx` |
| T3-9 | Company detail: live viewer count ("X checked this week") | `app/company/[slug]/page.tsx` |
| T3-10 | Jobs: GPS location button (auto-fill from device) | `app/jobs/page.tsx` |
| T3-11 | Jobs: instant-search as you type (debounced) vs explicit Search button | `app/jobs/page.tsx` |
| T3-12 | Companies: report count on score bar | `app/companies/page.tsx` |
| T3-13 | Company detail: "Analyze resume" + "Report experience" pre-filled CTAs | `app/company/[slug]/page.tsx` |
| T3-14 | Company detail: report platform source badges (via Seen / via Reddit) | `app/company/[slug]/page.tsx` |
| T3-15 | Feed: "Your Experience Matters" CTA positioned correctly | `app/feed/page.tsx` |

---

## Fix Order (execution sequence)

```
WEEK 1 — Stop the bleeding
  T0-1  api/reports.js: add leaderboard action
  T0-2  globals.css: add all .oc-* classes
  T0-3  globals.css: add .issue-* classes  
  T0-4  globals.css: add pageExit keyframe + .page-exiting
  T2-5  jobs: ghost rate badge
  T2-8  companies: ghost/response rate, industry, rank

WEEK 2 — Core product restore
  T1-1 through T1-7   company detail: tabs + all missing sections
  T1-13/14  tracker: track manually + clear all
  T2-3/4    dashboard: settings + sign-out

WEEK 3 — Hero + delight
  T1-8 through T1-10  word-slam animations
  T1-11/12  autocomplete (company + location)
  T2-1/2    feed: surge banner + CTA strip
  T2-19     landing: ghost surge strip

WEEK 4 — Polish sweep
  All T3 items in one sprint
```

---

## Build status at time of audit
✅ `npm run build` passes — 19 routes, zero TypeScript errors (commit `87b5fe8`)
