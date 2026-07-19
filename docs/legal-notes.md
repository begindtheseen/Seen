# Legal pages — plain-English notes for the owner and attorney

> **THESE ARE DRAFTS. HAVE A LICENSED ATTORNEY REVIEW THEM BEFORE RELYING ON THEM.**
> Nothing in the drafted pages or this note is legal advice. It was written to reflect how the
> Seen product *actually behaves* today, so a lawyer can start from accurate facts rather than
> guesses. Anywhere the drafts say `[PLACEHOLDER]`, a human must fill it in before publication.

Prepared 2026-07-19. Product repo: `begindtheseen/Seen`, base branch `next-migration`.

## What was added

Three new public pages plus this note. **No existing files were changed** (the current
`app/legal/page.tsx` was left untouched; navigation/footer links are handled separately).

| File | Route | Purpose |
| --- | --- | --- |
| `app/content-policy/page.tsx` | `/content-policy` | The neutral-aggregator / defamation posture |
| `app/privacy/page.tsx` | `/privacy` | What we collect, how account data is accessed, processors, rights |
| `app/terms/page.tsx` | `/terms` | Standard aggregator terms of service |
| `docs/legal-notes.md` | — | This note |

Every page carries a visible **"Draft — pending legal review"** banner and an **Effective date:
[PLACEHOLDER]** line (the draft-prepared date, 2026-07-19, is shown separately).

## The three postures, and why they are worded the way they are

### 1. Content Policy — Seen is a neutral aggregator, not a speaker

This is the defamation-exposure page, and it is written to be *defensible because it is true*, not
because it makes strong legal claims. The drafting is grounded in how the code actually sources
content:

- **Third-party public discussion.** The Reddit ingest (`api/reports.js`, the `reddit_import`
  action) pulls posts/comments from public RSS/archive feeds, uses an AI step to extract structured
  hiring-experience summaries, and stores them tagged as a Reddit source. Every surface that renders
  one of these items labels it **"Sourced from public discussion"** — the exact string
  `PUBLIC_DISCUSSION_LABEL` in `lib/reportSource.ts`, shown in `app/feed`, `app/report`, and
  `app/company/[slug]`. So the drafts say this content is pre-existing public third-party speech,
  surfaced with attribution — not Seen's assertions. These imported items are also **down-weighted**
  relative to first-hand reports in scoring.
- **User-submitted reports are claims, not facts.** Applicants submit first-hand accounts; the AI/DB
  path stores them as reports, and admins can moderate/approve/deny them
  (`approve_report`/`deny_report` in `api/admin-stats.js`). The drafts present these as the
  submitter's own account and perspective, with representations required of the submitter — never as
  something Seen has verified.
- **Aggregate statistics are reported outcomes.** Ghost rate, response rate, wait time, and the
  0–100 Seen Grade are computed *from* those reports. The drafts frame every rate as
  *"X% of N self-reported outcomes"* — a statistical signal on a limited, self-selected sample — and
  explicitly **not** a verdict or accusation. This mirrors language already live on the site
  ("community signals, not verified facts"; "Not a verdict — a heads-up" on `app/reddit`).

The page then names the well-known **principles** the posture rests on — third-party content
(the Section 230 / 47 U.S.C. § 230 framework in the US), opinion, and truth — but it deliberately
**states them as design intent, not legal conclusions**, and says in writing that counsel must
confirm them. This avoids the trap of the current `app/legal` page, which flatly asserts Seen "is
not liable" under § 230; the new draft describes the posture without promising the outcome.

A **dispute/correction process** is included: who to contact, what to include (factual inaccuracy,
personal info, or fabrication — not merely "it's negative"), corrections/official-response options,
and a commitment not to remove genuine protected applicant speech.

### 2. Privacy Policy — the honest account-access wording (please read this)

**The owner previously asked for language saying "we don't access people's accounts." That claim was
NOT written as requested, because it is false as the system is actually built — and a privacy policy
that contains a false statement is worse than no statement at all.**

What the code actually shows (`api/admin-stats.js`): the admin API authenticates administrators
(username/password, scrypt-hashed, session-token protected) and, using the **Supabase service-role
key** and the **auth admin API**, can reach and modify account data. Concretely, admin actions
include:

- `delete_user` — permanently remove a user and their data;
- `set_user_password` — reset a user's auth password (via the auth admin API);
- `grant_credits`, `set_pro` — change a user's entitlements;
- `list_subscriptions`, `export_csv`, `export_company` — read subscription data and export records;
- content/company moderation actions.

Administrative actions are recorded in an **`admin_audit_log`**. So administrators demonstrably *can*
access account data — for support, moderation, security, billing, and legal/operational reasons.

Rather than deny that, the Privacy Policy tells the truth and bounds it:

> "We access account data only to operate the service, provide support, ensure security, and comply
> with law. We do **not** sell it, and we do **not** access it for purposes unrelated to running
> Seen. Administrative actions are recorded in an internal audit log, and access is limited to
> authorized personnel."

This resolves the owner's underlying intent (reassure users their data isn't being sold or snooped)
**accurately** — the honest, defensible version of the promise. The top-of-page reassurance banner
was likewise written as *"we do not sell your data, and we do not access account data for purposes
unrelated to running the service"* — not a blanket "we never access accounts."

The page also lists what's collected (account email + auth, optional profile fields, resume text,
tracker/saved jobs, reports, subscription/credits, session tokens; anonymous submitters: report +
company + location + timestamp + hashed session id), how it's used, and the **third-party
processors**, each verified in the codebase:

- **Supabase** — database + auth (`@supabase/supabase-js`, service key in `api/admin-stats.js`).
- **Stripe** — payments/subscriptions (`api/stripe.js`, `api.stripe.com`).
- **Vercel** — hosting/serverless (`vercel.json`; Next.js `api/` functions).
- **Resend** — transactional email (`RESEND_KEY`, `api.resend.com` in `api/apply.js`, `api/resume.js`, `api/outcome-followups.js`).
- **PostHog** — product analytics, when enabled (`lib/analytics.ts`, `NEXT_PUBLIC_POSTHOG_KEY`).
- **Anthropic** — AI processing for public-discussion extraction and resume tools (`api.anthropic.com`).

User rights (access, correction, deletion, export, analytics opt-out; CCPA/CPRA + GDPR references)
are included with placeholders for verification steps and jurisdiction-specific detail.

### 3. Terms of Service — standard aggregator terms

Eligibility/accounts, an **informational / no-warranty-of-accuracy** disclaimer that ties back to the
Content Policy, acceptable use, the content license + submitter representations, the dispute pointer,
**employer/portal terms** (employer features and purchases exist via Stripe; they explicitly do **not**
let a company buy removal of genuine content or manipulate metrics), a **subscriptions/billing**
section (Stripe, auto-renew, cancel-anytime — current prices deliberately deferred to checkout/the
pricing page rather than hard-coded), IP/trademarks, and **limitation-of-liability / indemnity**.

## Placeholders a human MUST fill before publication

- **Legal entity name** and **business address** (used across all three pages). *No company name,
  address, or jurisdiction was invented.*
- **Effective date** on each page.
- **Governing law, venue, and dispute-resolution / arbitration terms** (Terms §12) — left entirely
  blank on purpose.
- **Liability cap** figures and lookback window (Terms §10).
- **Dispute-acknowledgement timeframe** (Content Policy §7).
- **Data-retention periods** and **children's minimum age** (Privacy §7, §9).
- **Content-license scope/duration**, **employer product/refund terms**, **auto-renewal/refund
  disclosures** (Terms §5, §7, §8).
- Confirmation that the **processor list is complete** and that any required **data-processing
  agreements / sub-processor disclosures** are in place (Privacy §5).

## Note on the existing `/legal` page

The repo already has `app/legal/page.tsx`, a single combined Terms/Privacy/Content page. It was left
untouched per scope. Two things for counsel to reconcile: (1) it asserts § 230 non-liability more
strongly than these drafts do, and (2) its privacy section says processors are "Supabase + Anthropic"
and does not mention the admin-access reality. If the new pages go live, the owner and attorney should
decide whether to retire or align `/legal` with them.

---

**Again: these are drafts to give your attorney an accurate starting point. Do not publish or rely on
them until a licensed attorney has reviewed and completed them.**
