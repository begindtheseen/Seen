# Seen docs

These are the notes I keep while building Seen. The top level holds documents that still describe how the app works today. Older records are kept in `archive/` for history.

## Product and design

- [SEEN_STRATEGY.md](SEEN_STRATEGY.md): what Seen is trying to do and the rules features are measured against (application tracking as the main data source, follow-up check-ins, anti-gaming).
- [SEENJOBS_BEHAVIORAL_FLYWHEEL.md](SEENJOBS_BEHAVIORAL_FLYWHEEL.md): the product loop in detail: the apply checkpoint, update prompts, outcome cards, and credit rewards.
- [SCORING.md](SCORING.md): how a company score is calculated from reports, and how much each source is trusted.
- [OPPORTUNITY_ENGINE.md](OPPORTUNITY_ENGINE.md): how the app picks the next useful question to ask a user.
- [JOB_INGESTION_ENGINE.md](JOB_INGESTION_ENGINE.md): where job listings come from and how they are merged and stored.
- [RESUME_INTELLIGENCE_ENGINE.md](RESUME_INTELLIGENCE_ENGINE.md): how the résumé tools parse a résumé and match it to a job.
- [MONETIZATION_TODO.md](MONETIZATION_TODO.md): pricing decisions and paid features, including which ones are built.
- [legal-notes.md](legal-notes.md): notes on the legal pages (terms, privacy, content policy) and how they match what the app actually does.
- [INTERVIEW_GUIDE.md](INTERVIEW_GUIDE.md): my plain-English notes for explaining how Seen works.

## Working notes

- [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md): session handoff notes for picking work back up. The root [CLAUDE.md](../CLAUDE.md) has the current rules and recent session notes.

## Security

- [security/SECURITY.md](security/SECURITY.md): how I test Seen against itself (scans, authorization checks, CI) and what the last self-audit found.
- [security/SECURITY_ENVIRONMENT.md](security/SECURITY_ENVIRONMENT.md): every environment variable and whether it is server-only.
- [security/SECURITY_RUNBOOK.md](security/SECURITY_RUNBOOK.md): what to do during incidents like a traffic spike or a failed payment webhook.
- [security/SECURITY_AUDIT.md](security/SECURITY_AUDIT.md): the June 2026 security audit and its fixes.
- [security/SECURITY_FOLLOWUPS.md](security/SECURITY_FOLLOWUPS.md): status of the Supabase security advisor items.

## Archive

Frozen records from earlier phases. They describe the state of the project when they were written, not today.

- Migration to Next.js (June 2026): [RECOVERY_ROADMAP.md](archive/RECOVERY_ROADMAP.md), [SITE_PARITY_CHECKLIST.md](archive/SITE_PARITY_CHECKLIST.md), [ADMIN_PARITY_CHECKLIST.md](archive/ADMIN_PARITY_CHECKLIST.md), [VISUAL_PARITY_CHECKLIST.md](archive/VISUAL_PARITY_CHECKLIST.md), [ADMIN_VISUAL_PARITY_AUDIT.md](archive/ADMIN_VISUAL_PARITY_AUDIT.md), [PARITY_REPAIR_LIST.md](archive/PARITY_REPAIR_LIST.md), [JOBS_AI_PARITY_REPORT.md](archive/JOBS_AI_PARITY_REPORT.md)
- Project state and launch checks: [MASTER_PROJECT_STATE.md](archive/MASTER_PROJECT_STATE.md), [LAUNCH_READINESS.md](archive/LAUNCH_READINESS.md), [PREVIEW_DEPLOY_CHECKLIST.md](archive/PREVIEW_DEPLOY_CHECKLIST.md), [SMOKE_TEST_RUNBOOK.md](archive/SMOKE_TEST_RUNBOOK.md)
