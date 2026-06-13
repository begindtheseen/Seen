# VISUAL PARITY CHECKLIST
*Created: 2026-06-13 — Claude A visual restoration session*
*Source of truth: origin/main:index.html + origin/main:employer.html*

---

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
