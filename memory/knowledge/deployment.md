---
title: Deployment
tags: [deploy]
updated: 2026-07-06
---

# Deployment

## The model
- Vercel is connected to GitHub. **Every PR gets a preview.** **Merging a PR to
  `next-migration` auto-deploys production (seenjobs.io).** There is NO manual
  promote step in the normal path.
- The old "Vercel won't build claude-authored commits" problem (June) is
  **resolved** — do not tell the owner to manually trigger deploys; merging is
  the deploy.

## The promoted-preview rule (load-bearing)
If a PR *preview* gets promoted to production from the Vercel dashboard,
**merge that PR immediately.** Otherwise the next unrelated merge to
`next-migration` silently **rolls production back**. Symptom: a preview shows
`previewUrl: seenjobs.io` while the PR is unmerged → merge it now.
(Learned [[timeline/2026-07-02]]; reaffirmed as an institutional rule.)

## Branches
- `next-migration` — the production branch. All work branches from it.
- `main` — old static HTML app, **unrelated history, never touch / never merge**.
  See [[architecture]].

## Before every push
- `npm run build` must pass (dual `--experimental-build-mode` compile+generate;
  see [[testing]]). Small commits. No merging/deploying without owner approval
  on anything risky.

## Config
- `vercel.json`: `"framework": "nextjs"`, serverless functions, cron schedules.
  Crons fire as **GET** — handlers route the `x-vercel-cron` header into refresh
  logic (see `api/demand.js`, `api/reports.js`, `api/outcome-followups.js`).
- Deploy hook (fallback, rarely needed):
  `https://api.vercel.com/v1/integrations/deploy/prj_P2SoPxsy9RpdoJfVUqqg6RslWXV5/6kpPtZBS1w`

## Source docs
`CLAUDE_HANDOFF.md` (Deployment workflow), `CLAUDE.md` (Vercel deploy section),
`PREVIEW_DEPLOY_CHECKLIST.md`, `MASTER_PROJECT_STATE.md`.
