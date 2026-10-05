# Seen

Seen is a job search site I built that tracks your applications and shows which companies tend to ghost applicants, so you can check a company before you apply.

Live site: https://seenjobs.io

## What it does

- **Company pages.** Each company gets a ghost rate, response rate, and typical wait time, built from applicant reports. Companies with little data are labeled low confidence instead of being shown as fact.
- **Application tracker.** After you log an application, Seen checks in at day 7, 14, and 30 ("Did they respond?", "Got an interview?", "What happened?"). Those answers feed back into the company data.
- **Job search.** Listings come from Adzuna and from public company job boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters). They are stored in Postgres so repeat searches are fast, and a scheduled job hides and removes listings that go stale.
- **Résumé tools.** Upload a PDF résumé and compare it against a job description to see which requirements it covers.
- **Compare and rankings.** Side by side company comparison, a company scoreboard, and a Staffing Agency Ghost Index.
- **Public discussion.** Company pages link to related public Reddit threads, labeled as third party discussion.
- **Employer side.** Companies can claim their page and reply to reports. Paying never changes a company's score.
- **Pro plan and admin.** Stripe handles the Pro subscription and one-time purchases. An admin dashboard covers moderation and data quality.

## Tech

- Next.js 15 (App Router), React 19, TypeScript
- Vercel serverless functions in `api/` (plain Node.js), with scheduled jobs defined in `vercel.json`
- Supabase: Postgres, auth, and row level security. Schema changes live in `supabase/migrations/`
- Stripe for payments, Resend for email, PostHog for analytics (optional)
- Node's built-in test runner, plus GitHub Actions for tests, a syntax check of `api/`, the build, CodeQL, and a secret scan

## Run it locally

You need Node 22 (CI uses 22, and the test glob needs Node 21 or newer).

```bash
npm ci
npm run dev      # Next.js dev server on http://localhost:3000
npm run build    # production build
```

`npm run dev` serves the pages. The functions in `api/` are Vercel serverless functions, not Next.js routes, so they need the Vercel CLI (`vercel dev`) to run locally.

The server code reads its settings from environment variables. The main ones are `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_KEY`, `LLM_API_KEY`, `CRON_SECRET`, and `ADMIN_EMAIL`. The full list with notes is in [docs/security/SECURITY_ENVIRONMENT.md](docs/security/SECURITY_ENVIRONMENT.md). Real values are never committed (`.env*` is gitignored). The Supabase anon key in `lib/supabase.ts` is public on purpose; row level security is what protects the data.

## Tests

```bash
npm test
```

This runs every `*.test.mjs` file with `node --test`. The tests cover the scoring math, the job source parsers, the résumé parser, credit rules, Stripe handling, and the API handlers. On 2026-10-05 it ran 930 tests, all passing.

## How this project evolved

- **May 2026.** The first version was a single 13,000 line HTML file with a few serverless functions behind it. It still lives on the `main` branch.
- **June 2026.** I moved the site to Next.js page by page, then spent about two weeks matching the old site screen by screen. The checklists from that work are in `docs/archive/`.
- **June 30.** I added a free trial, patched it, rebuilt it, and removed it, all in one day, because I started coding before I had decided the pricing rule. Since then I settle the business decision first and build once. The trial came back on July 4 after that decision was made.
- **July 1.** An audit of the whole app found about 30 features that looked finished but broke somewhere between the page, the API, and the database. The worst one: the tracker read a database column that did not exist in production, so it failed for every signed-in user. I fixed them in one pull request, added CI a week later, and wrote down the rule I follow now: trace each request from the page to the handler to the table, and check the real schema instead of the one I assume.
- **August 2026.** A merge never reached production while the database had already been migrated ahead of it. Now I confirm a production deployment exists for the merged commit before I judge whether a fix worked, and I deploy code before the schema changes it depends on.
- **September 2026.** Expired listings were supposed to be cleaned up automatically, but 95,505 stale rows (67% of the jobs table) had piled up. All three cleanup paths were silently hitting the database's 8 second statement timeout. I replaced them with one batched Postgres function that the scheduled job and the admin button both call.

## Project docs

Design notes, the scoring method, security notes, and older project records are in [docs/](docs/README.md).

I build Seen with Claude Code as a coding assistant. [CLAUDE.md](CLAUDE.md) holds the working notes and rules it reads at the start of each session.
