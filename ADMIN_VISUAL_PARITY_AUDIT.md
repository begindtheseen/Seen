# ADMIN VISUAL PARITY AUDIT
*Compared: `origin/main:index.html` admin vs `app/admin/page.tsx`*
*Session: 2026-06-13*

---

## Summary

The Next.js admin page used custom components (`StatBox`, `Card`, `CardHeader`, `SectionHeader`, `BarChart`) that diverged significantly from the original CSS class system (`adm-kpi`, `adm-panel`, `adm-panel-hdr`, `adm-row`, `adm-bar`). This session restored the original look.

---

## Findings by Category

### 1. KPI Cards — CRITICAL

| Attribute | Original | Before | After |
|---|---|---|---|
| Background | `linear-gradient(160deg, rgba(255,255,255,.055), rgba(255,255,255,.018))` | `var(--card)` solid | Original gradient ✓ |
| Border | `1px solid rgba(255,255,255,.1)` | `1px solid var(--line)` | Original ✓ |
| Backdrop blur | `blur(12px)` | None | Original ✓ |
| Hover | `translateY(-2px) + shadow` | None | Original ✓ |
| Number font size | `1.8rem` | `1.55rem` | `1.8rem` ✓ |
| Color accents | `border-left: 2px solid` on specific cards | Background tint | `border-left` ✓ |
| Number colors | Per-card `style="color:var(--green)"` etc. | All same or tinted bg | Per-card colors ✓ |

### 2. Page Title — CRITICAL

| Attribute | Original | Before | After |
|---|---|---|---|
| Eyebrow label | `Seen Admin` with green horizontal rule | `Admin · Data flywheel` | Original ✓ |
| H1 text | `Data flywheel` | `Platform metrics` | `Data flywheel` ✓ |
| H1 size | `2rem` | `1.75rem` | `2rem` ✓ |
| H1 letter-spacing | `-.04em` | `-.03em` | `-.04em` ✓ |
| Subtitle | `Last updated: [time]` | None | `Last updated just now` ✓ |
| Refresh/Sign out buttons | `.adm-btn` class with hover effect | Custom inline styles | Original classes ✓ |

### 3. Section Labels — IMPORTANT

| Attribute | Original | Before | After |
|---|---|---|---|
| Style | Dim uppercase mono `.5rem` with `.14em` tracking | Blue decorated rule w/ gradient line | Dim uppercase ✓ |
| Color | `var(--dim)` | `var(--blue)` with gradient line | `var(--dim)` ✓ |
| Feeling | Low-key grouping label | Prominent colored section header | Original ✓ |

### 4. Panels (Cards) — IMPORTANT

| Attribute | Original | Before | After |
|---|---|---|---|
| Background | `rgba(255,255,255,.025)` glass | `var(--card)` (more solid) | Original glass ✓ |
| Border | `1px solid rgba(255,255,255,.08)` | `1px solid var(--line)` | Original ✓ |
| Header style | `.adm-panel-hdr` — uppercase mono `.6rem` + border-bottom | Different font/color/no border-bottom | Original ✓ |
| Header color | `var(--sub)` | `var(--dim)` | `var(--sub)` ✓ |

### 5. Charts — IMPORTANT

| Attribute | Original | Before | After |
|---|---|---|---|
| Chart bar class | `.adm-chart-bar` — subtle blue with hover glow | Plain div with opacity | `.adm-chart-bar` ✓ |
| Chart container | `.adm-chart-row` — `height:48px` | `height:80px` | Original ✓ |
| Date labels | Below chart, right of panel | Below chart | Same |
| Chart label | `one bar = one day` in header | Not shown | Restored ✓ |
| Chart order | First visible section | Inside 2-col grid below KPIs | Now first, standalone ✓ |

### 6. Company Lists (BarChart) — IMPORTANT

| Attribute | Original | Before | After |
|---|---|---|---|
| Row class | `.adm-row` — `padding:.6rem 1rem` + hover bg | Custom inline flex | `.adm-row` ✓ |
| Bar wrapper | `.adm-bar-wrap` — subtle bg + `height:4px` | `height:5px` plain div | `.adm-bar-wrap` ✓ |
| Bar fill | `.adm-bar` — gradient blue or `.adm-bar.green` | Solid color prop | Original classes ✓ |

### 7. Layout Order — IMPORTANT

| Section | Original | Before | After |
|---|---|---|---|
| After KPIs | Chart → 2-col companies → outcome breakdown | 2-col (chart + outcome) → 2-col companies | Chart → 2-col companies → outcomes ✓ |
| Jobs KPIs | 2 items (Active + New today) | 4 items (added Stale/Expired, Reported Inactive) | 2 items ✓ |
| Outcome breakdown | Pill badges | Horizontal bar chart | Pill badges ✓ |

### 8. Background Gradient — COSMETIC

| Attribute | Original | Before | After |
|---|---|---|---|
| Page background | `radial-gradient` blue+purple orbs | None | Restored ✓ |

---

## What Was NOT Changed (Intentionally)

- **Feed rows** (ReportRow, IssueRow, InactiveRow, RecentJobsBrowser): Kept current implementation — original was plain JS DOM, not component-based. Current is better structured.
- **MergePanel, FlagsPanel, ClustersPanel, JobRunner**: Core UX unchanged, only visual container styling updated via `Card`/`CardHeader` propagation.
- **API Health section**: Uses `KpiCard` + original panel style but kept in a `var(--surface)` panel (matches original).
- **Mobile layout**: Updated to target `adm-kpi-n`/`adm-kpi` classes. 2-column KPI grid on mobile preserved.

---

## Status

All **CRITICAL** and **IMPORTANT** items restored. Build passes. Ready to commit.
