# Seen — Claude Handoff

> **Read this first. Every session. No exceptions.**
> Then read SEEN_STRATEGY.md. Then `git status`. Then pick up exactly where this doc ends.

Last updated: **2026-06-13 (Session C)**

---

## Current reality

- **seenjobs.io is LIVE** on the Next.js app, deployed from `next-migration` via Vercel
- `main` = old HTML SPA. Source of truth for design parity. **Never touch it.**
- Active branch: `next-migration` — push here, Vercel auto-builds a preview
- Brandon promotes previews to production from the Vercel dashboard
- Mission: **full visual + functional parity** with `origin/main:index.html`

---

## What Session C shipped (push `4fd3bb4`, branch `next-migration`)

| Fix | File(s) | Notes |
|-----|---------|-------|
| Admin mobile KPI grid 2-column | `app/admin/page.tsx` | JS `window.matchMedia` sets `gridTemplateColumns` inline (CSS media queries unreliable on Next.js deploy) |
| KPI number font clamping | `app/admin/page.tsx` | `clamp(1.3rem, 6vw, 1.8rem)` inline on `.adm-kpi-n` |
| Nav link underlines | `app/globals.css` | `.ntab` → `text-decoration:none` |
| Liquid glass nav pills | `app/globals.css` | `.nav-pills` frosted glass; `.ntab.active` subtle glass pill + spring `tabPop` animation; no shimmer/iridescent |
| Admin removed from nav | `components/Nav.tsx` | Desktop pill + mobile side-menu both removed; `/admin` URL still works |
| Feed company name links | `app/feed/page.tsx` | `<span>` → `<a href="/company/[slug]">` |
| Job search synonym matching | `api/jobs.js` | `buildFallbackFilter`: AND → OR + full phrase; `termRows`: dual-column `or=(search_query,title)`; stale fallback same |
| Query expansion: 8-10 related terms | `lib/server/expand.js` | Better abbreviation pairs (ML↔machine learning, SWE↔software engineer, etc.); max_tokens 200→350; slice 6→10 |
| Hero headline clipping | `components/LandingHero.tsx` | `container-type:inline-size` on left col; font in `cqw` (column-relative) → all 8 phrases fit at all widths; verified with Playwright |

---

## Deployment workflow

```bash
# Claude pushes to next-migration — Vercel auto-builds preview
git push -u origin next-migration

# Brandon promotes the preview in Vercel dashboard → production
# OR trigger via deploy hook:
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_P2SoPxsy9RpdoJfVUqqg6RslWXV5/6kpPtZBS1w"
```

**Never deploy to production without Brandon verifying the preview first.**

---

## Architecture facts (know these cold)

- **API**: `api/*.js` Vercel serverless — NOT `app/api/`. No App Router API routes exist.
- **Serverless cap**: 11 declared + 1 Next.js runtime (dynamic `/company/[slug]`) = 12 (at Vercel Pro limit). Never add a new `api/*.js` without merging one.
- **Merged endpoints**:
  - parse-resume → `POST /api/resume` `{action:'parse', base64, fileName, mimeType}`
  - company-score → `POST /api/reports` (action: company_score | research | resolve | populate)
  - fetch-location-jobs → `POST /api/jobs` `{action:'location'}` or `{location}` without `{query}`
- **Auth**: Supabase. `anon` key is public intentionally. `service_role` key **never** in frontend.
- **Admin auth**: separate username/password → `POST /api/admin-stats {action:'admin_login'}` → `X-Admin-Token`. NOT Supabase.
- **Styling**: CSS variables in `app/globals.css`. No Tailwind.
- **Git**: `main` and `next-migration` have no common ancestor. Never `git merge` between them. Sync files: `git show origin/main:path > path`

---

## Parity checklists

- `SITE_PARITY_CHECKLIST.md` — page-by-page (most pages 🟡 unverified)
- `ADMIN_PARITY_CHECKLIST.md` — admin (all 16 sections ✅ functionally complete as of Session A)

### Visual work remaining (from Session A / VISUAL_PARITY_CHECKLIST.md)

| Item | Status |
|------|--------|
| H5: Word-slam hero animations (JS word-by-word) | ⬜ Low priority |
| J2: Job search suggestion/proposal chips | ⬜ |
| R1: countUp on resume score | ⬜ |
| R2: Colored icons in resume panel | ⬜ |
| A5: Admin card glass further polish | 🟡 |

### Functional gaps (tracker-side)

- `handleCheckAnswer` in `app/tracker/page.tsx`: missing stage updates (Interview/Phone Screen), `showOutcomeCard`, offer `_showRoundsPrompt`, "↩ I withdrew" option
- `availability_status` not surfaced in `/api/jobs` result mapping (stale/expired labels dormant)
- Account settings modal (⚙ openAccountSettings) not yet ported

---

## Operating mode

- **Parallelize aggressively.** Independent work → parallel agents. Don't serialize what doesn't need to be.
- **Build first, then verify.** `npm run build` must pass before every push. Use Playwright for UI verification.
- **Don't ask, ship.** Reasonable calls get made and shipped. Brandon redirects if wrong.
- **CSS on this project**: inline styles for one-offs, `.globals.css` for reusable classes. No Tailwind. CSS variables: `--blue, --red, --green, --amber, --white, --sub, --muted, --dim, --mono, --display, --card, --line, --line2, --surface, --ink`.

---

## Build status

✅ PASSING — 19 routes, zero TypeScript errors (last verified: Session C, commit `4fd3bb4`)
