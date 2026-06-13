# Seen — Claude Handoff

> **Read this first. Every session. No exceptions.**
> Then read SEEN_STRATEGY.md. Then `git status`. Then pick up exactly where this doc ends.

Last updated: **2026-06-13 (Session D)**

---

## Current reality

- **seenjobs.io is LIVE** on the Next.js app, deployed from `next-migration` via Vercel
- `main` = old HTML SPA. Source of truth for design parity. **Never touch it.**
- Active branch: `next-migration` — push here, Vercel auto-builds a preview
- Brandon promotes previews to production from the Vercel dashboard
- Mission: **full visual + functional parity** with `origin/main:index.html`

---

## What Session D shipped (latest push `a685441`, branch `next-migration`)

Session D ran 5 parallel agents + direct edits to knock out the entire Tier 1–3 parity list.

| Commit | What shipped |
|--------|-------------|
| `c41d327` | Company detail: 7 tabs + hiring funnel + data quality badge + web reviews + timeline + ghost surge alert + TrackCTA |
| `c41d327` | Dashboard: Settings link + Sign out button |
| `c41d327` | Feed: CTA strip above filters |
| `c41d327` | Resume: `· 1 credit` cost labels on all 3 action buttons |
| `8ffa296` | Jobs list: stale (`⚠ may be closed`) / expired (`✕ likely closed`) badges from `availability_status` |
| `8ffa296` | Jobs list: location autocomplete dropdown (25 US cities) |
| `8ffa296` | Job detail: "Report Your Experience" — 4 outcome quick-links pre-filled with company+role |
| `8ffa296` | Job detail: "Apply & Optimize" modal (optimize resume first vs skip) |
| `bae3e21` | Feed: ghost surge banner above CTA strip with 5 high-risk company pills |
| `bae3e21` | Demand: "Find these jobs →" per-job link to /jobs?q=+loc= |
| `bae3e21` | Demand: "Best companies ↗" link per city card → /companies |
| `bae3e21` | Demand: DI label color-coding (Critical/High/Active/Moderate) |
| `c929287` | Companies: industry label + ghost rate + response rate badges on each tile |
| `c929287` | Report: 2-step progress bar (The listing / What happened) |
| `c929287` | Report: recent community reports section (last 5) at bottom |
| `c929287` | Profile: ← Dashboard back link |
| `c929287` | Resume: drag-and-drop upload (isDragging visual feedback) |
| `c929287` | Dashboard: recently checked companies from localStorage |
| `c929287` | Company detail: share buttons (Reddit + Web Share API), live viewer count, pre-filled CTAs |
| `a685441` | Landing: company autocomplete (50 major companies, shows on 2+ chars without job keywords) |
| `a685441` | Landing: location autocomplete (30 US cities, under location field) |
| `a685441` | Landing: ghost surge strip (pulsing red dot + 5 company pills) |
| `a685441` | Landing: verdict feed rows → navigate to /company/[slug] |
| `a685441` | Landing: 5-layer cosmos radial-gradient overlay |

---

## Remaining parity gaps (not yet done)

Very few significant gaps remain after Session D. These are the known outstanding items:

### Functional
- `handleCheckAnswer` in `app/tracker/page.tsx`: stage updates (Interview/Phone Screen), `showOutcomeCard`, offer `_showRoundsPrompt`, "↩ I withdrew" option (tracker follow-up system)
- T3-2: Report page — unpaid work option labels differ from old HTML
- T3-4: Tracker "Clear dupes" always visible (old) vs conditional (new)
- T3-5: Resume text-paste flow (was separate view, now combined)
- T3-10: Jobs GPS location button (auto-fill from device)
- T3-11: Jobs instant-search as you type (debounced, no explicit button)

### Visual
- T3-6: Landing hero sweep (gradient flash after line 2 locks) — `swept` state is wired; `#rotatingHero.swept::after` CSS exists; just confirm the `heroSweep` keyframe is present
- Company detail: `seen_recent_cos` localStorage write on visit (needed for dashboard "recently checked" to populate) — check if written in company/[slug]/page.tsx

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
- **Worktree agents**: when spawning agents with `isolation:"worktree"`, they sometimes write to /home/user/Seen directly AND the worktree. If cherry-pick fails (add/add conflict), copy files from worktree manually and commit.

---

## Operating mode (Fable principles)

- **Parallelize aggressively.** Independent work → parallel agents. Don't serialize what doesn't need to be.
- **Build first, verify after.** `npm run build` must pass before every push. 19 routes, zero TS errors.
- **Don't ask, ship.** Reasonable calls get made and shipped. Brandon redirects if wrong.
- **CSS**: inline styles for one-offs, `globals.css` for reusable classes. No Tailwind. CSS vars: `--blue, --red, --green, --amber, --white, --sub, --muted, --dim, --mono, --display, --card, --line, --line2, --surface, --ink`.

---

## Build status

✅ PASSING — 19 routes, zero TypeScript errors (last verified: Session D, commit `a685441`)
