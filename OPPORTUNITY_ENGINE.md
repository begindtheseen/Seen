# Seen — Opportunity Engine (Conversion + Data Layer)

> Status: design + v1 implementation. Read alongside `SEEN_STRATEGY.md` (the
> Hiring Outcome Graph thesis). This system is how we *acquire* the graph's data
> and convert users — continuously, behind the scenes.

## Thesis

Conversion and data are the same goal. Every interaction should move a user toward
**giving us a high-value data point** and/or **becoming paid**. The Opportunity
Engine is the always-on, invisible layer that finds the next best thing to ask each
user and trades it for a credit.

```
User's footprint  ──►  Opportunity Engine  ──►  ranked questions  ──►  Earn-credit survey
(resume, apps,         (finds the gaps                                  │
 outcomes, profile)     worth filling)                                  ▼
        ▲                                                    answer = insight (data)
        │                                                          + 1 credit
        └──────────────  credits fund resume optimization & AI  ◄──────┘
```

The user only ever sees a short survey asking suspiciously relevant questions. The
engine is never surfaced.

## The value exchange

- We **ask** for a specific insight the graph is missing (or that personalizes them).
- They **answer** → we store the data point → they **earn 1 credit**.
- Credits are **spent** on resume optimization, AI insights, stealth rewrites.
- Credit scarcity (daily cap) is the **upgrade pressure** toward Pro.

So: insight ↔ credit ↔ AI value, with paid conversion as the pressure-release valve.

## How it plugs into what already exists (no new plumbing)

The earn-credit survey already generates questions server-side and records answers:

- **Serve questions:** `POST /api/user-sync { action: 'company_survey' }` → returns
  `{ questions[], credits_left, balance }`. Question shape:
  `{ key, company, prompt, text, options, credit_value, source }`.
- **Record answer:** `POST /api/user-sync { action: 'submit_answer', question_key, answer }`
  → writes `answered_questions`, awards +1 (daily cap 5) in `ai_credits`, logs
  `credit_transactions`, and conditionally feeds `reports` (company intelligence).
- **UI:** `components/SurveyModal.tsx` renders whatever `questions[]` the server returns
  and dispatches `seen:credits-updated` after each answer.

**The engine is an evolution of the question generator.** Instead of 5 templated
questions per company, it mines the user's *whole* footprint and returns a ranked,
personalized, deduplicated queue. Answers flow through the unchanged `submit_answer`.

New server action: `get_opportunities` → runs the engine → returns questions in the
exact shape the survey already renders (`source: 'engine'`). Zero UI rework required;
the modal just receives richer questions.

## Inputs the engine mines (already in our data)

| Input | Where it lives |
|-------|----------------|
| Applications (company, role, stage, status, dates) | `applications` table / `AppStore` |
| Hiring events (applied, response, interview, offer, rejected, ghosted) | `application_events` / `Application.events[]` |
| Resume signals (skills, seniority, function, years, titles) | `resume_skills` / `career_signals` (`013_*`) |
| Profile (city, experience level, prefs) | `profile` / `UserProfile` |
| Already-answered questions (dedup) | `answered_questions` |
| Credits (daily cap remaining) | `ai_credits` |
| Behavior (recent companies, saved jobs) | `user_recent_cos`, `saved_jobs` |

## Opportunity catalog (the rule set)

Each opportunity = a question tagged with the **data point** it captures, a
**category**, and a **priority** (lower tier = ask sooner). Deduped by `key`.

### Tier 1 — ask early, highest signal
- **How did you apply?** (referral / recruiter / direct / job board) — `apply_channel`
  *(referrals shift outcomes 10–40%)*
- **Interview type** once a response lands (phone / video / technical / on-site / take-home) — `interview_type`
- **Interview count so far** — `interview_count`
- **Current employment status** (employed / looking / unemployed) — `employment_status`

### Tier 2 — at/near outcome
- **Rejected → at which stage?** (applied / screen / phone / on-site / final) + optional reason — `rejection_stage`
- **Offer → accepted? base salary? negotiated?** — `offer_terms`
- **Ghosted → when did they say you'd hear back?** (expected vs. actual) — `ghost_expectation`
- **Would you apply here again?** (any terminal outcome) — `would_reapply`

### Tier 3 — profile completion (global, not per-app)
- Visa sponsorship needed? — `visa_sponsorship`
- Salary expectations — `salary_target`
- Search urgency — `search_urgency`
- Company-size / industry preference — `company_size_pref`, `industry_pref`
- Geographic flexibility / relocation — `relocation`

### Tier 4 — post-hire follow-up
- First-30-days onboarding — `onboarding_experience`
- Offer competitiveness vs. market — `offer_competitiveness`

## Ranking & pacing

1. Filter out anything in `answered_questions` (dedup by key).
2. Score each candidate: `priority(tier)` + recency/urgency boosts (e.g., an app that
   just hit a terminal status outranks a stale profile gap).
3. Cap the returned set to the user's **remaining daily earn** (so we never dangle
   questions they can't be paid for) plus a small lookahead for the "almost there" nudge.
4. Always keep at least one easy/global question available so the survey is never empty.

## Where answers land (data capture)

- Always: `answered_questions` (+ credit, + `credit_transactions` with engine metadata).
- Company-experience answers (interview/ghost/rejection/outcome): also feed `reports`
  (existing path in `submit_answer`) so they improve company scores.
- Profile-gap answers (visa, salary, urgency, prefs): enrich the user profile so the
  engine and matching get smarter over time. *(v1 stores them in `answered_questions`;
  profile write-through is a fast follow.)*

## v1 scope (this PR)

- `api/_utils/opportunityEngine.js` — pure, unit-tested engine: takes a user's
  apps/events/profile/resume-signals/answered-keys/credit state → returns a ranked,
  deduped, capped list of opportunities. **This is the IP and is fully testable.**
- `get_opportunities` action in `api/user-sync.js` — loads the user's data, runs the
  engine, returns survey-shaped questions.
- Survey wiring so the earn-credit flow can pull the personalized queue.
- Answers recorded via the existing `submit_answer` pipeline.

## Later (fast follows)

- Profile write-through for profile-gap answers.
- LLM-assisted question phrasing for resume-derived opportunities.
- Per-user cost/value tracking; A/B which questions convert.
- Surface "almost there" credit nudges (Zeigarnik) tied to the engine queue.

## Success metric

Not "surveys shown" — **`data_points_captured` per active user** and the resulting
lift in `outcome_rate` (applications with ≥1 post-submit event) and paid conversion.
