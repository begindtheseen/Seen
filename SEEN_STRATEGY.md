# Seen — Product Strategy & Development North Star

This file is the source of truth for what Seen is building and why.
Every session starts here. Every decision is measured against this.

---

## The Thesis (Non-Negotiable)

**The Hiring Outcome Graph is the core long-term moat.**

Every feature, every design decision, every product choice should maximize the number of high-quality hiring outcome events collected — while making that collection feel valuable to the user, not extractive.

---

## The Core Shift

### Old Thinking
Applications are a feature. Submitting = done.

### New Thinking
**Applications are the primary data acquisition engine.**
Every application begins a hiring timeline.
Every timeline is a data asset.
Every outcome contributes to company intelligence.

---

## Application Lifecycle (The Right Way)

```
Resume Tailored
↓
Application Generated
↓
Application Record Created  ← This is where it starts, not ends
↓
Hiring Timeline Created
↓
Outcome Tracking Begins (automated, one-click only)
```

### When an application is created, automatically create:
- Company
- Role
- Applied Date
- Status = Applied
- Confidence = Pending
- Timeline = Active

### Immediately redirect user to Application Tracking View:
```
Customer Service Representative
Lifetime Solutions

Applied: June 7, 2026
Status: Awaiting Response
Expected Response: 7–14 Days
Industry Average: 9 Days
Next Check-In: June 14
```

---

## Automated Follow-Up System

**One click only. No surveys. No long forms.**

| Day | Question | Actions |
|-----|----------|---------|
| 7 | Did the company respond? | [Yes] [No] |
| 14 | Got an interview? | [Yes] [No] |
| 30 | What was the outcome? | [Offer] [Rejected] [Ghosted] [Still Active] |

If Yes (Day 7) → store `response_received` event  
If No (Day 7) → keep active  
If Yes (Day 14) → store `interview_received` event  

---

## Event System

**Store event history, not just status.**

```
application_submitted
response_received
assessment_received
interview_received
interview_completed
offer_received
rejected
ghosted
withdrawn
```

Every event includes:
- `user_id`
- `application_id`
- `company_name`
- `event_type`
- `event_date`
- `confidence` (self-reported → low, corroborated → higher)
- `trust_weight` (based on user trust score)
- `anomaly_flags`
- `source` (user_reported, inferred, admin_verified)

---

## Outcome Cards — The Viral Engine

Outcome cards are shareable, emotional, data-rich artifacts.
**The data needed to generate the card IS the data needed for the intelligence engine.**
We never ask users for data. We ask them to generate artifacts.

### Example cards:

**HIRED**
```
Tesla | Customer Success
Applied: May 1 → Offer: May 18
Time To Offer: 17 Days | Interviews: 2
Compared to Seen users: 35% Faster
```

**GHOSTED**
```
Amazon | Software Engineer
Applied: March 3 | Last Response: Never
Days Waiting: 74 | Outcome: GHOSTED
Ghosted 2.4x more often than average
```

**REJECTED**
```
Google | Product Manager
Applied: April 7 | Interview: Yes | Offer: No
Outcome: REJECTED
```

Cards are:
- Shareable (Reddit, LinkedIn, Twitter/X, Threads)
- Emotional (users want to share wins and vent losses)
- Useful (benchmark vs. other users)
- Data-rich (exact intel for the intelligence engine)

---

## Badge System

**NO gamification. NO XP. NO levels. NO coins.**

**YES career achievements that feel professional and credible.**

### Safe badges (reward behavior, not just outcomes):
- `Transparency Contributor` — submitted X verified timelines
- `Consistent Tracker` — tracked outcomes for 3+ applications
- `Early Responder` — completed check-ins within 24hrs every time
- `High Interview Rate` — interviews at 40%+ of apps (requires history)
- `Strong Conversion Rate` — offers at X% (requires history)
- `Fast Hire` — offer received in top 25% fastest
- `Offer Streak` — multiple offers
- `First Offer` — first offer received

### Badges to AVOID:
- Any badge that rewards a single unverified self-report
- `Hired at FAANG` style badges (gameable, creates fake prestige)
- Badges that reward submission count without quality

---

## Career Command Center

The tracker is not an organizer. It is the center of the job search.

Users return because Seen becomes the command center for:
- Applications & timelines
- Company intelligence
- Benchmarks (how do I compare?)
- Analytics (what's my response rate?)
- Outcome cards
- Badges
- Career milestones

**This is the retention engine.**

---

## Data Collection Psychology

### Don't ask:
> "Help us improve our database"

### Ask:
> "Generate your outcome card"

The user is creating an artifact for themselves.  
Data collection happens as a byproduct.

### Behavioral loops that work:
1. **Progress loop** — "Your application is 3 days old. Check in to see where you stand."
2. **Benchmark loop** — "You got an interview 2x faster than average at this company."
3. **Outcome card loop** — "Generate your outcome card and share it."
4. **Analytics loop** — "Your interview rate this month is 34%. Top 15% of users."
5. **Streak loop** — "You've tracked 5 applications in a row. Keep your streak."

---

## Anti-Gaming Architecture

**Assume: If a system can be gamed, it eventually will be.**

### Core Principle
SeenJobs treats user submissions as **CLAIMS**, not facts.

```
User says: "Offer received"
Stored as: { type: "offer_received", confidence: "low", verified: false }
NOT: { verified_offer: true }
```

### User Trust Score
| Level | Triggers |
|-------|----------|
| New (low trust) | New account, < 3 events |
| Established (medium) | 30+ days, 3+ consistent timelines |
| High Trust | 90+ days, consistent realistic timelines, corroborated events |
| Penalized | Impossible timelines, suspicious patterns, flagged |

### Trust grows via:
- Account age
- Timeline consistency
- Realistic event timing
- Multiple corroborating events in the same timeline

### Trust decays via:
- Impossible timelines (offer in 1 day)
- Conflicting events
- Suspicious patterns (submitting 50 reports in 1 hour)
- IP/device anomalies

### Event Confidence Model
| Signal | Confidence |
|--------|-----------|
| Single self-report | Very Low (0.3) |
| Timeline with 3+ corroborating events | Medium (0.6) |
| Long account history, realistic timing | High (0.8) |
| Corroborated by multiple independent users | Very High (0.9) |

### Company Confidence Model
| Reports | Confidence Display |
|---------|-------------------|
| < 5 | "Not enough data" |
| 5–20 | "Low confidence — [N] reports" |
| 20–100 | "Moderate confidence" |
| 100–1000 | "Good confidence" |
| 1000+ | "High confidence" |

### Statistical Defenses
- Impossible timelines (offer in < 2 days) → auto-flagged, weight = 0
- Duplicate company attacks (same user, same company, same outcome within 7 days) → deduped
- Mass fake submissions (> 5 reports/hour from same IP) → auto-blocked
- Coordinated manipulation (10+ similar reports from new accounts in 24hr) → quarantine queue
- Badge farming (submitting without realistic event sequences) → badge withheld

---

## Platform Hardening (Priority Order)

### Before ANY traffic:
1. Supabase RLS on all user tables
2. Rate limiting on all AI endpoints
3. Input validation and sanitization
4. Auth middleware protecting all dashboard routes
5. CORS locked to seenjobs.io
6. Environment secrets verified (no service keys in frontend)

### Before Reddit launch:
1. Cloudflare free tier (WAF, bot protection, DDoS)
2. AI call caching (same company score = serve from cache, don't re-run)
3. Supabase indexes on hot tables (companies, reports, jobs)
4. Error tracking via Sentry free tier
5. Admin dashboard with abuse flags
6. Rate limits per user (not just per IP)

### Before paid subscriptions scale:
1. Per-user AI cost tracking
2. Daily AI spending caps with kill-switch
3. Payment failure handling
4. Subscription state in DB (not just Stripe webhooks)
5. Dunning logic

### Before outcome cards go viral:
1. Confidence labels on all public-facing scores
2. Methodology page ("How we calculate")
3. Company takedown/correction workflow
4. Privacy-safe aggregation (no individual data exposed)
5. Share card generation caching
6. CDN for share card images

---

## Cost Controls (AI)

- **Cache all company scores** — 30-day TTL, never re-run for same company within window
- **Cache resume analysis** — per-resume hash, don't re-analyze unchanged resumes
- **Queue expensive jobs** — don't block on AI calls in the request path
- **Rate limit free users** — 5 company lookups/day, 3 resume analyses/day
- **Kill-switch** — admin toggle to disable AI features instantly
- **Daily cap** — hard stop at $X/day Anthropic spend
- **Track per-user cost** — log AI calls with user_id to identify abusers

---

## Admin Dashboard (Must Have)

Single page showing:
- Total/Active/Paying users
- AI spend today/this month
- API errors (last 100)
- Top searched companies
- Top shared outcome cards
- Most reported companies
- Suspicious users (flagged queue)
- Low-confidence scores needing review
- Applications tracked today
- Outcome cards generated today
- Conversion funnel (signup → app → outcome)

---

## Public Trust Language

Never present weak data as fact. Use:
- "Based on [N] candidate reports"
- "Low confidence — add more data to improve this"
- "Candidate-reported, not employer-verified"
- "Public-signal estimate"

Always show the confidence level with the score.

---

## Features to Build (Priority)

### Must build now:
1. Application timeline (apply → track → outcome)
2. One-click follow-up check-ins (7d, 14d, 30d)
3. Event system (application_submitted, response_received, etc.)
4. Outcome card generation
5. Company score confidence labels

### Build before launch:
6. User trust score (basic version)
7. Anti-gaming: impossible timeline detection
8. Admin abuse queue
9. AI cost tracking
10. Cloudflare setup

### Build after traction:
11. Badge system
12. Career analytics dashboard
13. Benchmark comparisons
14. Full trust score system
15. Company confidence model

---

## Features to AVOID

- Gamification (XP, coins, levels, leaderboards)
- Long forms for outcome collection
- Asking users to "help improve data"
- Presenting low-confidence data as fact
- Public individual application data
- Over-engineered real-time systems before 10k users
- Complex payment tiers before product-market fit

---

## The Success Metric

**Not:** Applications Submitted  
**Yes:** Applications With Outcomes

Design everything to maximize `outcome_rate` = (applications with at least one post-submit event) / (total applications).

---

*Last updated: June 2026*
*This is the north star. All work flows from here.*
