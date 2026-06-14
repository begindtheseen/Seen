# SeenJobs Behavioral Flywheel — Core Product Architecture

> This is not a growth idea. This is the business engine.
> Every feature decision must be measured against this document.
> Last updated: 2026-06-14

---

## 1. Executive Summary

SeenJobs only has long-term value if users do three things repeatedly:

1. Use SeenJobs **before** applying (company intelligence, resume optimization)
2. Apply **through** a SeenJobs-assisted flow (apply checkpoint)
3. **Return** to update what happened (tracking loop)

Without outcome data, SeenJobs is a job board with AI features. With outcome data, it becomes the only verified hiring transparency layer in existence.

The application tracking loop is not a side feature. It is the business engine. The data it collects powers company scores, ghost-risk predictions, percentile rankings, outcome cards, and Pro conversion. Every other product surface is downstream of this loop.

**The flywheel:**
- Users apply smarter → collect better outcome data
- Better data → better company intelligence
- Better company intelligence → more users apply through SeenJobs
- More users → more data → stronger moat

**The viral engine:**
- Outcome cards are the byproduct of data collection
- Cards are shared on Reddit, LinkedIn, Twitter/X
- Shares bring new users into the top of the funnel
- New users apply → generate more data → more cards

---

## 2. Core Flywheel Diagram

```
                    ┌─────────────────────────┐
                    │   USER FINDS A JOB       │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  SEES COMPANY INTEL      │
                    │  Ghost rate, hire speed, │
                    │  response rate, grade    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  SPENDS CREDIT           │
                    │  Optimize resume for     │
                    │  this specific role      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  OPTIMIZED RESUME EMAIL  │◄──────────────┐
                    │  Delivered to inbox      │               │
                    │  CTA: "Apply + Track"    │               │
                    └────────────┬────────────┘               │
                                 │                             │
                    ┌────────────▼────────────┐               │
                    │  APPLY CHECKPOINT        │               │
                    │  "Did you apply?"        │               │
                    │  Yes / Not yet /         │               │
                    │  Changed my mind         │               │
                    └────────────┬────────────┘               │
                                 │                             │
                    ┌────────────▼────────────┐               │
                    │  TRACKING TIMELINE       │               │
                    │  Expected response       │               │
                    │  Ghost-risk timeline     │               │
                    │  Next check-in date      │               │
                    └────────────┬────────────┘               │
                                 │                             │
                    ┌────────────▼────────────┐               │
                    │  CHECK-IN PROMPTS        │               │
                    │  Day 3 / 7 / 14 / 30    │               │
                    │  Each update = insight   │               │
                    └────────────┬────────────┘               │
                                 │                             │
                    ┌────────────▼────────────┐               │
                    │  FINAL OUTCOME           │               │
                    │  Hired / Ghosted /       │               │
                    │  Rejected / Withdrew     │               │
                    └────────────┬────────────┘               │
                                 │                             │
                    ┌────────────▼────────────┐               │
          ┌─────────│  OUTCOME CARD            │               │
          │         │  Shareable artifact      │               │
          │         │  Percentile data         │               │
          │         │  Company accountability  │               │
          │         └────────────┬────────────┘               │
          │                      │                             │
          │         ┌────────────▼────────────┐               │
          │         │  DATA FEEDS BACK INTO    │               │
          │         │  Company scores          │               │
          │         │  Ghost rates             │               │
          │         │  Hire speed              │               │
          │         │  Percentile rankings     │               │
          │         └────────────┬────────────┘               │
          │                      │                             │
          │         ┌────────────▼────────────┐               │
          │         │  BETTER INTEL            │───────────────┘
          │         │  → More useful to next   │
          │         │    user who finds a job  │
          │         └─────────────────────────┘
          │
          │  VIRAL LOOP
          └────────────────────────────────────────────────┐
                                                           │
                    ┌──────────────────────────────────────▼──┐
                    │  CARD SHARED ON REDDIT / LINKEDIN / X    │
                    │  "Ghosted by Meta — 71% of applicants"   │
                    │  seenjobs.io/meta                        │
                    └──────────────────────────────────────┬──┘
                                                           │
                    ┌──────────────────────────────────────▼──┐
                    │  STRANGER CLICKS                          │
                    │  "What is this? Where does this data      │
                    │   come from? I'm applying there..."       │
                    └──────────────────────────────────────┬──┘
                                                           │
                    ┌──────────────────────────────────────▼──┐
                    │  NEW USER ENTERS TOP OF FUNNEL           │
                    │  Finds a job → Company intel →           │
                    │  Optimize → Apply → Track → Card         │
                    └─────────────────────────────────────────┘
```

---

## 3. User Psychology Principles

### 3.1 The Exchange Principle
Every piece of data the user gives must unlock something immediately visible. Not "help us build a better database." Not "fill in this survey." Every input must feel like turning on a feature that benefits the user directly.

| User gives | SeenJobs returns immediately |
|---|---|
| Applied date + company | Response prediction, ghost-risk timeline |
| Rejection | Percentile data ("you made further than 97%"), outcome card |
| Interview | "Top X% of applicants reached this stage," updated prediction |
| Offer | Outcome card, comparative speed, badge |
| Ghosted | Company accountability card, "you're not alone" validation |

### 3.2 Identity, Not Data Collection
The user is not filling out a form. They are building a career record. Frame every action as self-beneficial:

- "Start your timeline" not "submit application data"
- "Generate your outcome card" not "log your result"
- "Unlock your hiring report" not "complete the survey"

### 3.3 Behavioral Loops (from SEEN_STRATEGY.md)

1. **Progress loop** — "Your application is 3 days old. Here's where you stand compared to similar applicants at this company."
2. **Benchmark loop** — "You got an interview 2x faster than average at this company."
3. **Outcome card loop** — "Generate your outcome card and share it."
4. **Analytics loop** — "Your interview rate this month is 34%. Top 15% of users."
5. **Streak loop** — "You've tracked 5 applications in a row. Keep your streak."

### 3.4 Emotional States and Product Responses

| Emotional state | SeenJobs response | Example copy |
|---|---|---|
| Pride (hired, interview) | Amplify and make shareable | "Faster than 89% — generate your card" |
| Outrage (ghosted) | Validate and redirect toward company | "Meta ghosts 71% — you're not alone" |
| Anxiety (no response yet) | Ground with data | "You're still inside the usual response window" |
| Shame (rejected) | Reframe with company data | "0.4% offer rate — you made the top 3%" |
| Hope (pending) | Give a concrete next action | "Your next check-in is in 4 days" |

### 3.5 Loss Aversion Triggers
- "This job has a staleness signal — apply before it disappears"
- "2 of your 4 applications are past the response window — update them before they go cold"
- "Your hiring report is 60% complete — finish it to unlock your outcome card"

---

## 4. Apply Checkpoint Flow

### 4.1 When it triggers
- After user clicks "Apply" on any job listing
- After user returns from the optimized resume email CTA
- On the dashboard when showing unconfirmed optimized resumes
- On tracker when a job was saved but never confirmed applied

### 4.2 Modal: "Did You Apply?"

**Title:** Did you apply?

**Subtitle:** Answer once so Seen can start your response timeline and compare what happens next.

**Buttons (in order):**
1. `Yes, I applied` — primary action, green
2. `Not yet` — secondary, neutral
3. `I changed my mind` — tertiary, muted
4. `Remind me in 24 hours` — ghost button

---

### 4.3 Branch: YES, I APPLIED

**Action:** Create tracked application record. Set `applied_at = now()`, `stage = applied`, `next_check_due_at = now() + 3d`.

**Confirmation screen:**

```
✓ Tracked.

[Company] × [Role]
Applied: [Date]

We'll tell you when this company usually responds —
and when silence becomes a signal.

Expected response window: 7–14 days
Next check-in: [Date + 3 days]
Ghost risk if no response by [Date + 21 days]: Moderate

[View your timeline →]
```

**Unlocks:** Expected response range, ghost-risk timeline, follow-up date, company comparison.

---

### 4.4 Branch: NOT YET

**Prompt (one tap, not a form):** What's holding you back?

- I want to edit the resume first
- I'm comparing companies
- I'm not sure this role is right
- I'll apply soon
- Other

**Confirmation screen:**

```
Saved as considering.

We'll remind you before this listing goes stale.
[Company] listings typically stay active 18–24 days.

[Apply when ready →]   [Remind me later]
```

**Unlocks:** Listing freshness warning, scheduled reminder, intent data.

---

### 4.5 Branch: I CHANGED MY MIND

**Prompt (one tap):** What happened?

- Company looks risky
- Salary is unclear
- The job seems fake or outdated
- Too many red flags
- I found a better option
- Other

**Confirmation screen:**

```
Marked as avoided.

This feeds your recommendations. Companies like
[Company] won't rank as high for your next search.

[Find better options →]
```

**Unlocks:** Negative intent data, listing quality signals, personalized job ranking adjustment.

---

### 4.6 Branch: REMIND ME LATER

**Action:** Set reminder for 24 hours. No friction, no required reason.

**Confirmation:**

```
Saved. We'll remind you tomorrow.
This listing has been active for [N] days.
```

---

## 5. Resume Optimization → Application Flow

### 5.1 After optimization completes

Do not just show the result. Show the incomplete journey:

```
┌─────────────────────────────────────────┐
│                                          │
│  Resume optimized ✅                      │
│  Apply to [Company] ⏳                    │
│  Confirm application ⏳                   │
│  Track response ⏳                        │
│  Unlock outcome report ⏳                 │
│                                          │
│  This application is 1 of 5 steps.       │
│  Finish it to unlock your hiring report. │
│                                          │
│  [Apply Now + Start Tracking]            │
│  [Save for later]                        │
│                                          │
└─────────────────────────────────────────┘
```

### 5.2 "Apply Now + Start Tracking" button behavior
1. Opens apply URL in new tab (or shows apply instructions)
2. Immediately shows apply checkpoint modal in current tab
3. Apply checkpoint pre-fills company + role from the optimization context

### 5.3 Why this works
The user just spent a credit. They are maximally committed. This is the highest-intent moment in the product. The apply checkpoint at this moment captures nearly 100% of resume-optimization applications instead of losing them to the external apply flow.

---

## 6. Email Return Loop

### 6.1 Optimized Resume Email

**Subject:** Your optimized resume for [Role] at [Company] is ready

**Preview text:** It's tailored. Apply now while the listing is fresh.

**Body:**

```
Your resume was optimized for [Role] at [Company].

We tailored it to match:
• The specific job description
• [Company]'s known hiring signals
• Your experience at [Your Previous Company]

[Download Your Resume]

Next step: Apply with this version so Seen can track what happens.

After you apply, come back and tap "I Applied" to start your timeline.
Seen will tell you:
• When [Company] usually responds
• When silence becomes a signal
• How your timeline compares to other applicants
• What your next move should be

[I Applied — Start My Timeline]

---
Applied and waiting?
[View your application timeline]

Not ready yet?
[Remind me before this listing goes stale]
```

### 6.2 Check-in Emails

**Day 3 email:**

**Subject:** Any update from [Company]?

**Body:**

```
You applied to [Role] at [Company] [N] days ago.

Still inside the usual window for this company.
Most applicants hear back in 7–14 days.

Did anything change?

[Yes — they responded]   [Not yet]   [I withdrew]
```

**Day 7 email (if no update):**

**Subject:** [Company] usually responds by now. Still waiting?

**Body:**

```
It's been 7 days since you applied to [Role] at [Company].

[Company]'s average response time: 8 days
You are: 1 day past average

Ghost probability if no response by day 21: 58%

Any update?

[Yes — heard back]   [No response]   [I withdrew]
```

**Day 21 email (high ghost risk):**

**Subject:** Something to know about your [Company] application

**Body:**

```
It's been 21 days since you applied to [Role] at [Company].

[Company] ghosts 64% of applicants at this stage.

You're not alone — but you deserve to know where you stand.

Mark this application:

[Still waiting]   [They ghosted me]   [I got an interview]   [I withdrew]

Whatever happened, we'll turn it into your hiring report.
```

---

## 7. Update Incentive System

### 7.1 Check-in schedule

| Day | Trigger | Prompt | Value unlocked |
|---|---|---|---|
| 3 | Time-based | "Any response yet?" | Updated ghost probability |
| 7 | Time-based | "Still waiting on [Company]?" | Window comparison, recommendation |
| 14 | Time-based | "Any update?" | Timeline comparison, ghost-risk shift |
| 30 | Time-based | "What happened with this application?" | Final outcome card, badge, credit |
| Whenever | User-initiated | "Update this application" | Same value chain |

### 7.2 Dashboard prompts (value-framed, never shame-framed)

| Situation | Bad copy | Good copy |
|---|---|---|
| 3 apps not updated | "3 overdue updates" | "3 insights waiting — update to unlock" |
| 1 app past window | "Overdue" | "Past the usual response window — what happened?" |
| Resume never confirmed | "Incomplete" | "Your optimized resume was never applied — finish the loop" |
| Final outcomes possible | "4 missing outcomes" | "4 outcome cards ready to generate" |
| 70% of tracker filled | — | "Your hiring timeline is 70% complete" |

### 7.3 Credit rewards for updates

| Action | Credit reward | Trust requirement |
|---|---|---|
| Confirmed application (with resume optimization link) | +0 (baseline behavior) | None |
| Interview update (with stage detail) | +1 | Account ≥ 7 days |
| Final outcome (hired/rejected/ghosted) with timeline | +1 | Account ≥ 14 days, ≥ 1 prior timeline |
| Detailed company report (interview format, rounds) | +2 | Account ≥ 30 days, consistent history |
| Unpaid work report with evidence | +2 | Account ≥ 30 days, admin review |
| Stale listing verification | +1 | Any account |

**Credit reward copy:** "You earned +1 AI credit for completing your hiring timeline. Your data just improved [Company]'s ghost rate score."

---

## 8. Outcome Card System

Cards are the viral product. Cards are not a report — they are the reward for completing the loop. Every final state generates a card. Cards are designed to be shared, not filed.

### 8.1 Hired Card

```
┌─────────────────────────────────────────┐
│  ✓ OFFER ACCEPTED                        │
│                                          │
│  [COMPANY]                               │
│  [Role]                                  │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  OFFER IN [N] DAYS                  │ │
│  │  Faster than [X]% of applicants     │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Applied → Offer: [N] days              │
│  Interviews completed: [N]               │
│  [Company] hires 1 in [N] applicants.    │
│  You were the 1.                         │
│                                          │
│  ◆ Top [X]% fastest hire tracked         │
│                                          │
│  SEEN · seenjobs.io/[slug]               │
└─────────────────────────────────────────┘
```

**Sharing hook:** "You were the 1." is the screenshot-worthy line. The "1 in [N]" stat reframes the hire as beating long odds.

### 8.2 Ghosted Card

```
┌─────────────────────────────────────────┐
│  👻 GHOSTED                              │
│                                          │
│  [COMPANY]                               │
│  [Role]                                  │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  [N] DAYS                           │ │
│  │  No response. Ever.                 │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Follow-ups sent: [N]                    │
│  Responses received: 0                   │
│  Stage reached: [Stage]                  │
│                                          │
│  [Company] ghosts [X]% of applicants.    │
│  You're one of [N] this quarter.         │
│                                          │
│  ◈ This is not a reflection of you.      │
│                                          │
│  SEEN · seenjobs.io/[slug]               │
└─────────────────────────────────────────┘
```

**Sharing hook:** Owner shares because the company is the villain, not them. "This is not a reflection of you" gives emotional permission to post.

### 8.3 Rejected Card

```
┌─────────────────────────────────────────┐
│  ✕ REJECTED                              │
│                                          │
│  [COMPANY]                               │
│  [Role]                                  │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  [N] DAYS · [N] INTERVIEWS          │ │
│  │  Stage reached: [Stage]             │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Feedback provided: None / Yes           │
│  [Company]'s offer rate: [X]%            │
│  You made it further than [Y]%.          │
│                                          │
│  ◈ Next time will be different.          │
│                                          │
│  SEEN · seenjobs.io/[slug]               │
└─────────────────────────────────────────┘
```

**Sharing hook:** "You made it further than [Y]%" converts rejection into an achievement framing.

### 8.4 Interview Card (pending)

```
┌─────────────────────────────────────────┐
│  📋 INTERVIEW SECURED                    │
│                                          │
│  [COMPANY]                               │
│  [Role]                                  │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  RESPONSE IN [N] DAYS               │ │
│  │  Top [X]% — faster than average     │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Applied: [Date]                         │
│  Response: [Date]                        │
│  [Company] interviews [X]% of applicants │
│                                          │
│  Timeline in progress. Follow to see     │
│  what happens next.                      │
│                                          │
│  SEEN · seenjobs.io/[slug]               │
└─────────────────────────────────────────┘
```

**Mechanic:** "Follow to see what happens next" — creates a cliffhanger. User may share again after the final outcome.

### 8.5 Long Wait Card (live, updating)

```
┌─────────────────────────────────────────┐
│  ⏳ STILL WAITING                         │
│                                          │
│  [COMPANY]                               │
│  [Role]                                  │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  DAY [N]                            │ │
│  │  [N] days past the usual window     │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  [Company]'s average response: [N] days  │
│  You are [N] days overdue.               │
│                                          │
│  Ghost probability: [X]%                 │
│                                          │
│  Updated live.                           │
│                                          │
│  SEEN · seenjobs.io/[slug]               │
└─────────────────────────────────────────┘
```

**Mechanic:** "Updated live" — user can share this card and it gets worse over time. Two shares: once at day 14 (outrage), once when finally resolved (satisfaction or rage).

### 8.6 Withdrew Card

```
┌─────────────────────────────────────────┐
│  ↩ I WITHDREW                            │
│                                          │
│  [COMPANY]                               │
│  [Role]                                  │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  [N] INTERVIEWS · [N] HOURS         │ │
│  │  I walked away.                     │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Reason: [selected reason]               │
│  [Company]'s average process: [N] rounds │
│  I stopped at [N].                       │
│                                          │
│  ◈ The process is part of the answer.    │
│                                          │
│  SEEN · seenjobs.io/[slug]               │
└─────────────────────────────────────────┘
```

**Sharing hook:** Power move card. Generates controversy and admiration. "The process is part of the answer" becomes a standalone quote.

### 8.7 Fast Hire Card (variant, top 10% speed)

```
┌─────────────────────────────────────────┐
│  ⚡ FAST HIRE                             │
│                                          │
│  [COMPANY]                               │
│  [Role]                                  │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  OFFER IN [N] DAYS                  │ │
│  │  #[N] fastest tracked at [Company]  │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  [Company]'s average: [N] days           │
│  You beat it by [N] days.                │
│                                          │
│  ◆ Top 1% fastest hire ever tracked      │
│                                          │
│  SEEN · seenjobs.io/[slug]               │
└─────────────────────────────────────────┘
```

---

## 9. Credit Reward System

### 9.1 Earning credits

Credits are earned through verified, high-quality data contributions. Not through spam.

| Action | Credit | Trust gate | Cooldown |
|---|---|---|---|
| Interview stage update (with date) | +1 | Account ≥ 7 days | 1 per company per 30d |
| Final outcome (with full timeline) | +1 | Account ≥ 14 days | 1 per application |
| Detailed report (rounds, format, unpaid work) | +2 | Account ≥ 30 days | 1 per company per 90d |
| First tracked application (ever) | +1 | None | Once lifetime |
| First outcome card generated | +1 | None | Once lifetime |
| Outcome card shared (verified click) | +1 | None | Once per card |

### 9.2 Trust gating logic

New accounts cannot earn credits through outcome reporting. This blocks:
- Mass fake outcome submissions from new accounts
- Coordinated company score manipulation
- Bot farming of the credit system

Trust accumulates via:
- Account age
- Email verified
- Realistic timeline spacing (not same-day apply → offer)
- Historical consistency (no contradictory prior reports)
- Multiple application timelines that close naturally

### 9.3 Credit copy

**Earning notification:**
> "+1 AI credit — thanks for completing your hiring timeline. Your outcome just improved [Company]'s ghost rate data for future applicants."

**Free tier balance:**
> "3 optimizations/month · Earn more by tracking outcomes"

**Out of credits:**
> "You've used your 3 free optimizations this month. Track an outcome to earn more, or upgrade to optimize without limits."

---

## 10. Pro Conversion Moments

### 10.1 Upgrade trigger hierarchy (highest to lowest intent)

1. **After first strong free result** — "Your resume score jumped 34 points. Upgrade to optimize 10 more applications this month."
2. **After credits run out** — "You've used all 3 optimizations. Upgrade to apply smarter, without limits."
3. **After outcome card generated** — "Your hiring report is ready. Upgrade to unlock your full analytics dashboard."
4. **After 3+ tracked applications** — "You're tracking [N] applications. Upgrade to get ghost-risk alerts and response predictions."
5. **After company risk insight** — "This company ghosts 71% of applicants. Upgrade to see which companies are worth your time before you apply."
6. **After response prediction displays** — "We predicted [Company] would respond by [Date]. Upgrade to get this for every application."
7. **After multiple pending apps** — "You have [N] applications in progress. Upgrade to get a unified intelligence dashboard."

### 10.2 Pro framing (never sell credits)

| Weak | Strong |
|---|---|
| "Buy more AI credits" | "Optimize 10 more applications this month" |
| "Upgrade to Pro" | "Stop applying blind" |
| "Unlock premium" | "Know which companies are worth your time before you apply" |
| "Get more features" | "Get a response prediction before every application" |

### 10.3 What free users see
- Company ghost rate (limited — last 30d, capped at 3 lookups/day)
- Basic job search and filtering
- 3 resume optimizations/month
- Apply checkpoint (unlimited)
- Basic tracking timeline
- Outcome cards (unlimited — these are viral, never gate them)
- Credit earning through outcomes

### 10.4 What Pro users get
- Unlimited company intelligence
- Unlimited optimizations
- Full response prediction model
- Ghost-risk alerts (push/email when an app goes silent)
- Full analytics dashboard (interview rate, offer rate, response rate)
- Company comparison ("Is Google or Microsoft more likely to respond?")
- Advanced outcome cards (salary benchmarks, negotiation intel)
- Priority AI processing

---

## 11. Data Model Implications

### 11.1 New tables needed

**`applications`**
```sql
CREATE TABLE applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users,
  company         text        NOT NULL,
  role            text        NOT NULL,
  job_id          text,                     -- refs jobs table if originated there
  applied_at      timestamptz,              -- null until confirmed
  source          text        DEFAULT 'seen', -- 'seen', 'email_cta', 'manual'
  resume_optimized boolean    DEFAULT false,
  optimization_id text,
  stage           text        DEFAULT 'considering',
  -- stages: considering | applied | responded | screening | interview | offer | rejected | ghosted | withdrew
  status          text        DEFAULT 'active',
  -- statuses: active | closed
  next_check_due_at timestamptz,
  closed_at       timestamptz,
  final_outcome   text,
  -- outcomes: hired | rejected | ghosted | withdrew
  outcome_card_id text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
```

**`application_events`**
```sql
CREATE TABLE application_events (
  id              bigserial   PRIMARY KEY,
  application_id  uuid        NOT NULL REFERENCES applications,
  user_id         uuid        NOT NULL,
  event_type      text        NOT NULL,
  -- types: application_submitted | response_received | assessment_received |
  --        interview_received | interview_completed | offer_received |
  --        rejected | ghosted | withdrew | check_in | note
  event_date      timestamptz NOT NULL DEFAULT now(),
  stage_before    text,
  stage_after     text,
  confidence      text        DEFAULT 'low',
  -- low | medium | high
  source          text        DEFAULT 'user_reported',
  -- user_reported | inferred | admin_verified
  trust_weight    float       DEFAULT 0.3,
  metadata        jsonb       DEFAULT '{}',
  -- e.g. {"rounds": 2, "format": "panel", "unpaid_work": false}
  anomaly_flags   text[]      DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);
```

**`outcome_cards`**
```sql
CREATE TABLE outcome_cards (
  id              text        PRIMARY KEY, -- nanoid, used in share URL
  application_id  uuid        NOT NULL REFERENCES applications,
  user_id         uuid        NOT NULL,
  card_type       text        NOT NULL,
  -- hired | ghosted | rejected | interview | offer | withdrew | long_wait
  company         text        NOT NULL,
  role            text,
  data            jsonb       NOT NULL,
  -- all computed stats at time of generation
  shared_at       timestamptz,
  share_count     integer     DEFAULT 0,
  click_count     integer     DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);
```

**`application_reminders`**
```sql
CREATE TABLE application_reminders (
  id              bigserial   PRIMARY KEY,
  application_id  uuid        NOT NULL REFERENCES applications,
  user_id         uuid        NOT NULL,
  due_at          timestamptz NOT NULL,
  reminder_type   text        NOT NULL,
  -- day_3 | day_7 | day_14 | day_30 | listing_stale | custom
  sent_at         timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);
```

### 11.2 Existing tables to update

**`jobs`** — add fields:
- `staleness_signal` boolean
- `listing_quality_score` float

**`company_scores`** — add fields:
- `ghost_rate_pct` float
- `avg_response_days` float
- `avg_offer_days` float
- `interview_rate_pct` float
- `offer_rate_pct` float
- `hire_rate_1_in_n` integer (e.g., 31 means 1 in 31)

---

## 12. Event Tracking Plan

### 12.1 Events to track (analytics, not application events)

| Event name | Trigger | Properties |
|---|---|---|
| `apply_checkpoint_shown` | Modal appears | job_id, company, has_optimization |
| `apply_confirmed` | "Yes, I applied" tapped | job_id, company, optimized |
| `apply_not_yet` | "Not yet" tapped | job_id, company, reason |
| `apply_declined` | "Changed my mind" tapped | job_id, company, reason |
| `checkin_shown` | Check-in prompt displayed | app_id, day, channel (email/dashboard/push) |
| `checkin_completed` | User submits update | app_id, day, outcome |
| `checkin_dismissed` | User dismisses | app_id, day |
| `outcome_card_generated` | Card created | card_id, card_type, company |
| `outcome_card_shared` | Share tapped | card_id, platform |
| `outcome_card_clicked` | Card URL visited | card_id, referrer |
| `upgrade_prompt_shown` | Pro CTA displayed | trigger_moment, user_credits |
| `upgrade_clicked` | Pro CTA tapped | trigger_moment |
| `credit_earned` | Credit rewarded | reason, trust_level |
| `resume_optimized` | Optimization completes | company, job_id |
| `resume_applied` | Apply confirmed post-optimization | optimization_id, time_to_apply |

### 12.2 Key metrics to watch

- **Loop completion rate** — (applications with final outcomes) / (total confirmed applications)
- **Check-in response rate** — (check-ins completed) / (check-ins shown), by day and channel
- **Card generation rate** — (cards generated) / (applications with final outcomes)
- **Card share rate** — (cards shared) / (cards generated)
- **Viral coefficient** — (new signups from card clicks) / (cards shared)
- **Resume→apply rate** — (applications confirmed) / (resume optimizations completed)
- **Outcome quality rate** — (outcomes with full timeline) / (total outcomes)

---

## 13. Abuse / Fraud Controls

### 13.1 Fake application submissions
**Risk:** User submits fake applications to farm credits or inflate company scores.

**Controls:**
- New accounts (< 7 days) cannot earn credits from reports
- Applications with same-day apply + same-day outcome are auto-flagged
- Same user submitting > 5 applications to same company in 30 days → review queue
- Offer received < 2 days after apply → anomaly flag, weight = 0

### 13.2 Coordinated company score manipulation
**Risk:** Company pays users or bots to submit positive reports.

**Controls:**
- Cluster detection: > 5 similar positive reports from new accounts within 24h → quarantine
- IP/device deduplication on report submission
- Trust weight model: new account reports weighted 0.3, high-trust account reports weighted 0.8–0.9
- Admin abuse queue for flagged clusters (already exists in admin dashboard)

### 13.3 Ghost rate gaming
**Risk:** Competitor submits many ghost reports against a target company.

**Controls:**
- Ghost reports require plausible timeline (applied at least 14 days ago)
- Single user can only contribute one ghost report per company per 90 days
- Suspicious ghost clusters trigger admin review

### 13.4 Outcome card spam
**Risk:** Shared cards contain false data to embarrass a company.

**Controls:**
- Cards only generate from verified applications (confirmed applied_at exists)
- Company name and role data come from the jobs table, not free-text user input
- Cards include a dispute mechanism ("Company: this is inaccurate → [contact]")
- High-traffic cards (> 100 clicks) trigger admin notification

### 13.5 Credit farming bots
**Risk:** Automated accounts create fake timelines to harvest credits.

**Controls:**
- Trust gates on all credit-earning actions
- Device fingerprinting on checkout/credit-use (not on data submission)
- Rate limit: max 3 credit-earning events per user per 7 days
- Admin visibility: users with unusually high credit earnings flagged

---

## 14. Ethical Guardrails

### 14.1 What we never do

- **No fake urgency.** "This job expires in 2 hours" when it doesn't.
- **No fake scarcity.** "Only 3 people saw this today" as a dark pattern.
- **No shame framing.** "You've fallen behind" or "Your competitors are applying."
- **No weaponized anxiety.** "Without Pro, you're applying blind" framing that makes users feel unsafe.
- **No hidden costs.** Every credit cost shown before action.
- **No impossible promises.** "Guaranteed to get you hired" is never written anywhere.
- **No hard cancellation.** Pro cancellation is one tap.
- **No employer influence.** Company scores cannot be purchased or suppressed.

### 14.2 Data handling commitments

- Outcome card data uses percentiles from real tracked applications only
- When sample size < 5 for a company, show "Not enough data" instead of fabricated stats
- Individual application data is never publicly exposed — only aggregated company-level stats
- Users can delete their full application history at any time
- Outcome cards can be unpublished by the user at any time

### 14.3 The correct emotional result

The user should feel: **"I know what to do next."**

Never: "I'm scared and need to pay."
Never: "I'm doing this wrong without Pro."
Never: "I'm being judged."

Every check-in, every insight, every card should increase the user's sense of control, not anxiety.

---

## 15. Implementation Phases

### Phase 1 — Spec + Audit (current phase — no code)
- [ ] This document written ✅
- [ ] Audit each product surface against the flywheel (Section 17)
- [ ] Review CLAUDE_HANDOFF.md and MASTER_PROJECT_STATE.md updates ✅
- [ ] Identify gaps vs. current implementation

### Phase 2 — Apply Checkpoint MVP
- [ ] Apply checkpoint modal (`ApplyCheckpoint.tsx`)
- [ ] "Did you apply?" flow with 4 branches
- [ ] Tracked application creation (new `applications` table)
- [ ] Supabase migration for `applications` + `application_events`
- [ ] Basic dashboard reminder card ("1 application needs confirmation")
- [ ] Post-optimization journey display on resume page

### Phase 3 — Update Loop
- [ ] Check-in prompts in dashboard (Day 3, 7, 14, 30)
- [ ] Timeline prediction display ("Expected response: 7–14 days")
- [ ] Ghost-risk indicator (updates as days pass)
- [ ] "Insights waiting" dashboard copy
- [ ] Email check-in system (requires transactional email setup)

### Phase 4 — Outcome Cards
- [ ] Outcome card generation (all 7 types)
- [ ] Company stats computation (ghost rate, hire rate, avg days)
- [ ] Card share flow (Web Share API + copy link + platform-specific)
- [ ] Public card URL (`/card/[id]` — og:image, meta tags for social)
- [ ] Card click tracking + share count

### Phase 5 — Credit Rewards + Pro Conversion
- [ ] Credit earning for verified updates (with trust gates)
- [ ] Pro upgrade prompts at correct moments
- [ ] Pro conversion flow
- [ ] Fraud controls implementation
- [ ] Admin visibility for abuse flags

---

## 16. Exact UI Copy

### Apply Checkpoint Modal
```
Title:     "Did you apply?"
Subtitle:  "Answer once so Seen can start your response timeline
            and compare what happens next."
Button 1:  "Yes, I applied"          [green, primary]
Button 2:  "Not yet"                 [neutral, secondary]
Button 3:  "I changed my mind"       [muted, tertiary]
Button 4:  "Remind me in 24 hours"   [ghost]
```

### After "Yes, I applied"
```
Headline:  "Tracked."
Body:      "We'll tell you when [Company] usually responds —
            and when silence becomes a signal."
Stat 1:    "Expected response window: 7–14 days"
Stat 2:    "Next check-in: [Date]"
Stat 3:    "Ghost risk if no response by [Date]: Moderate"
CTA:       "View your timeline →"
```

### Dashboard reminder cards
```
Variant A: "[N] insights waiting — update your applications to unlock"
Variant B: "[Company] is past the usual response window. What happened?"
Variant C: "Your optimized resume was never marked applied. Finish the loop."
Variant D: "4 outcome cards ready to generate."
Variant E: "Your hiring timeline is 70% complete."
```

### Check-in prompts (inline, dashboard)
```
Day 3:   "Any response yet from [Company]?"
         [Yes — they responded] [Not yet] [I withdrew]

Day 7:   "Still waiting on [Company]?"
         [Yes — heard back] [Still nothing] [I withdrew]

Day 14:  "Any update from [Company]?"
         [Yes] [No response — start ghosted countdown] [I withdrew]

Day 30:  "What happened with your [Company] application?"
         [Hired] [Rejected] [Ghosted] [Withdrew] [Still active]
```

### Outcome unlocked
```
Headline: "Your outcome card is ready."
Body:     "You tracked this application through the full timeline.
           [N] future applicants to [Company] will benefit from your data."
CTA 1:    "View your card"
CTA 2:    "Share to [Reddit / LinkedIn / X]"
CTA 3:    "Save for later"
```

### Credit earned
```
"+1 AI credit — you completed your hiring timeline.
Your outcome just improved [Company]'s ghost rate score."
```

### Pro upgrade (post-credit exhaustion)
```
Headline: "Stop applying blind."
Body:     "You've used your 3 free optimizations this month.
           With Pro, you can optimize every application,
           get response predictions, and see which companies
           are actually worth your time."
CTA:      "Upgrade — [price]/month"
Secondary: "Earn more free credits by tracking outcomes →"
```

---

## 17. Files Likely Affected

### Phase 2 (Apply Checkpoint MVP)

| File | Change |
|---|---|
| `components/ApplyCheckpoint.tsx` | New — the modal |
| `app/jobs/page.tsx` | Trigger checkpoint after apply click |
| `app/jobs/[id]/page.tsx` | Trigger checkpoint after apply click |
| `app/resume/page.tsx` | Show journey progress after optimization |
| `app/dashboard/page.tsx` | Add "insights waiting" reminder cards |
| `app/tracker/page.tsx` | Show confirmation state for applied apps |
| `lib/stores/ApplicationStore.ts` | New — local state for in-progress applications |
| `api/user-sync.js` | Add: create_application, update_application actions |
| `supabase/migrations/016_applications.sql` | New — applications + application_events tables |

### Phase 4 (Outcome Cards)

| File | Change |
|---|---|
| `components/OutcomeCard.tsx` | New — renders all 7 card types |
| `app/card/[id]/page.tsx` | New — public card URL with OG meta |
| `api/outcome-cards.js` | New — generate, share, track |
| `api/admin-stats.js` | Add card metrics to KPI dashboard |
| `supabase/migrations/017_outcome_cards.sql` | New |

### Phase 3 (Update Loop / Email)

| File | Change |
|---|---|
| `api/notifications.js` | New (or extend user-sync) — check-in scheduling |
| `app/dashboard/page.tsx` | Check-in prompts, timeline display |
| Email templates | New — 3 check-in email templates |

---

## 18. MVP Plan (Phase 2)

The minimum viable flywheel is the apply checkpoint.

Everything else in the system depends on this moment. Without it, we have no outcome data. Without outcome data, there are no cards, no company scores, no predictions, no moat.

**MVP scope:**
1. `ApplyCheckpoint.tsx` modal — 4 buttons, 2 branches (Yes / Not yet)
2. On "Yes": create row in `applications` table, show confirmed state
3. On "Not yet": show "saved" state, schedule no emails yet
4. Dashboard: one card per unconfirmed application ("Did you apply to [Company]?")
5. Tracker: show application stage next to each tracked app

**Not in MVP:**
- Email check-ins (requires transactional email setup)
- Ghost-risk calculations (requires company baseline data)
- Outcome cards (Phase 4)
- Credit rewards for updates (Phase 5)

**Definition of done for Phase 2:**
A user can click Apply on any job, confirm they applied, see the confirmation in their dashboard, and see their application in their tracker with a stage. That data exists in Supabase. The loop is open.

---

## 19. Phase 2 Plan

After the apply checkpoint is live, the loop is open but not closed. Phase 2 closes it.

**Scope:**
1. Check-in prompts in dashboard — Day 3, 7, 14, 30 (visual only, no email yet)
2. Timeline display: "Expected response: 7–14 days at [Company]"
3. Ghost risk text: "Silence becomes a signal after [Date]"
4. "Update this application" flow with 5 outcome options
5. Stage update → company baseline data flows back into company_scores
6. Dashboard "insights waiting" framing (not "overdue")

**Stretch:**
- Email check-ins (Day 7, Day 21) — requires transactional email infrastructure
- Ghost-risk probability calculation from company baseline data

**Definition of done for Phase 3:**
A user with a tracked application sees meaningful check-in prompts at the right times, can update their status in one tap, and sees a timeline comparison with other applicants at that company. Application stage data flows back into company scores.

---

## 20. Open Questions

1. **Email infrastructure:** Do we have transactional email set up (SendGrid, Resend, etc.)? The email return loop is critical for Phase 3 but requires email sending capability.

2. **Company baseline data:** Ghost rates, average response times, and hire rates need enough data to be credible. What's the minimum sample size before we show these stats? (Suggested: n=5 minimum, show "limited data" label for n<20.)

3. **Outcome card OG images:** Social sharing works best with real images (not text rendered in a browser). Do we generate static PNG cards server-side (e.g., via @vercel/og or Satori)? This is important for Twitter/X and LinkedIn embeds.

4. **Serverless function cap:** We're at 12/12 functions. Adding `outcome-cards.js` and `notifications.js` would push us over. These need to be merged into existing endpoints (`user-sync.js` or `admin-stats.js`) or we need to upgrade the Vercel plan.

5. **Privacy:** Outcome cards show company name + role + timeline. Is the company-level data alone enough or do we risk individual identification from niche roles? Probably fine but worth reviewing before public card URLs go live.

6. **Tracker vs. Applications table:** Currently `app/tracker/page.tsx` uses localStorage. The new `applications` table is server-side Supabase. How do we handle the migration — import localStorage data into Supabase, or run both in parallel?

7. **Pro tier pricing:** What is the Pro price point? Monthly/annual? This affects how the upgrade prompts are written.

8. **Android/iOS push notifications:** For Phase 3 check-ins, push > email for return visits. Is this in scope?

---

*This document is living architecture. Update it when implementation decisions change.*
*Implementation begins with Phase 2 (Apply Checkpoint) — approved before any code ships.*
