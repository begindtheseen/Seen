# Seen — The Plain-English Interview Guide

**How to use this:** Every section has three parts.
- 🧸 **Picture it** — the idea explained like you're a kid, with a real-world story.
- 🧠 **What it really is** — the actual technical thing.
- 🎤 **Say this in the interview** — a sentence you can say out loud that sounds like a pro.

Read it top to bottom once. Then re-read only the 🎤 lines the night before. If you can say the 🎤 lines and explain the 🧸 picture behind each one, you can hold your own.

---

## PART 0 — The 30-second story of your whole app

🧸 **Picture it:**
Imagine a giant notebook where job-seekers write down every job they applied to. Most people who apply to jobs get *ignored* — the company never replies (this is called being "ghosted"). Your app quietly collects everyone's stories and turns them into a **report card for companies**: "This company ignores 60% of applicants." Job seekers see the report card *before* they waste time applying. The more people use it, the better the report cards get. That loop is the whole business.

🧠 **What it really is:**
A **hiring-intelligence platform**. The application tracker is the *data-collection engine*. The company "grade cards" are the *viral growth engine*. A trust/confidence system keeps the data honest.

🎤 **Say this in the interview:**
> "Seen is a hiring-intelligence platform. The application tracker is the data-acquisition layer — every tracked application and outcome becomes a data point. We aggregate those into company-level scores that warn job seekers about ghosting before they apply, and the shareable score cards drive growth. The core loop is: track → outcome → report → score → share → more users."

---

## PART 1 — The two halves of your app (Frontend vs Backend)

🧸 **Picture it:**
Your app is like a **restaurant**.
- The **dining room** is what customers see — the menu, the tables, the lights. That's the **frontend** (the website in the browser).
- The **kitchen** is in the back where food actually gets made. Customers never go in there. That's the **backend** (the servers).

The waiter carries messages between them. When you click a button, a "waiter" runs to the kitchen, asks for something, and brings it back.

🧠 **What it really is:**
- **Frontend** = Next.js + React. The 23 pages in the `app/` folder. This is the part that runs in the user's browser.
- **Backend** = 14 small programs in the `api/` folder. Each one is a **serverless function** (more on that word soon). They run on Vercel's computers, not the user's.
- The "waiter" = an HTTP request (`fetch`). The browser sends a message; the server sends an answer.

⚠️ **One honest wrinkle to know:** the frontend is written in **TypeScript** and the backend is written in plain **JavaScript**, and they don't share any code. It works, but it means there's no automatic safety-check that the two halves agree on what data looks like.

🎤 **Say this in the interview:**
> "It's a Next.js React frontend talking to Vercel serverless functions over HTTP. The frontend is TypeScript, the API layer is plain JavaScript — they're decoupled, which is pragmatic but means there are no shared types across the boundary."

---

## PART 2 — "Serverless" (the scariest-sounding word that's actually simple)

🧸 **Picture it:**
Old way: you **rent an apartment** all month even when you're not home. The lights are always on, you always pay rent. That's a normal "always-on server."

Serverless way: you use a **vending machine**. It sits there asleep costing nothing. You put in a coin, it does ONE thing (drops a snack), then goes back to sleep. You only pay per snack.

Your backend functions are vending machines. Someone clicks → the function wakes up → does one job → goes back to sleep.

🧠 **What it really is:**
**Serverless functions** are little programs that spin up on demand, handle one request, and shut down. You don't manage a server. Vercel runs them.

The tradeoff: because they're asleep, the *first* visitor after a quiet period waits a moment while the machine "wakes up." That pause is called a **cold start**.

🎤 **Say this in the interview:**
> "The API is serverless functions on Vercel — they're stateless and scale per-request, so I don't manage infrastructure. The tradeoffs are cold-start latency and that every request is a fresh invocation, which matters for database connection pressure at scale."

---

## PART 3 — Where the data lives (the database) and the "anon" vs "service" keys

🧸 **Picture it:**
The **database** is a giant filing cabinet that remembers everything: who applied where, every company's grades, who paid for Pro.

There are **two keys** to this cabinet:
- A **public key** (the "anon key"). It's like the key to the *lobby* — anyone can have it, it can't open the private drawers. It's fine that it's printed right in the website code.
- A **master key** (the "service key"). This opens **every drawer, for everyone, no questions asked.** This key is *terrifyingly powerful* and must NEVER be in the website code. It only lives in the back kitchen (the servers).

🧠 **What it really is:**
- The database is **Supabase** (a hosted Postgres database with login/auth and file storage built in).
- **anon key** = a public, limited key shipped in the browser (`lib/supabase.ts`). Safe by design.
- **service_role key** = the admin key that bypasses all security rules. Only used server-side. If it ever leaked, an attacker could read/modify *everyone's* data.

✅ Your code does this correctly: the service key only appears in `api/` and `lib/server/`, never in the browser.

🎤 **Say this in the interview:**
> "Data is in Supabase Postgres. The browser only ever holds the public anon key; the service_role key — which bypasses row-level security — lives exclusively in the serverless layer. That separation is the load-bearing security boundary."

---

## PART 4 — The single most important design decision: the "service-key proxy"

**This is the #1 thing your interviewer will dig into. Learn this one cold.**

🧸 **Picture it:**
Imagine a bank. There are two ways to let customers get their money:

- **Option A:** Give every customer a key to the vault, and put a guard *inside the vault* who checks "is this YOUR box?" before they grab anything. (This is the normal Supabase way — the guard is called "RLS.")

- **Option B:** No customer ever enters the vault. They walk up to a **teller window**. The teller checks your ID, then goes into the vault *for you* using the master key and brings back only your box. (This is what YOU built.)

You chose **Option B**. Every request goes to a teller (a serverless function), the teller checks the customer's ID badge (their login token), and then the teller uses the **master key** to fetch only that person's data.

🧠 **What it really is:**
Your servers act as a **proxy** in front of the database. The flow:
1. Browser sends its login token (a "JWT" — explained next) to `/api/user-sync`.
2. The server **verifies the token** is real (`api/user-sync.js`).
3. The server uses the **service key** to read/write the DB, manually filtering `WHERE user_id = (this person)`.

**Why you did it this way:**
- One single place that checks identity (a "choke point") instead of dozens of database rules.
- You can run business logic and multi-step writes server-side.
- You don't have to write and maintain a security rule on every table.

**The tradeoff you're accepting (say this — it shows maturity):**
- Because the master key ignores the vault guard (RLS), **your only real protection is your own code remembering to filter by `user_id` every single time.** If you forget that filter on one query, there's no backup guard to catch it.
- Every read is a serverless call (costs money, adds a little delay) instead of the browser hitting the database directly.

🎤 **Say this in the interview:**
> "I used a service-key proxy pattern. The client never touches Postgres directly — it sends its JWT to a serverless function, which validates the token and then uses the service_role key to do the DB work, scoping every query by user_id. The win is a single auth choke point and server-side business logic. The cost is that RLS becomes defense-in-depth rather than my primary control — correctness now depends on my query filters, so a missing `user_id` predicate would be a data-leak bug with no safety net."

---

## PART 5 — Logins and the "JWT" (the ID badge)

🧸 **Picture it:**
When you log in, the system gives you a **wristband** like at an amusement park. It proves you paid and it can't be faked, because it has a special stamp only the park can make. Every ride checks your wristband instead of making you re-buy a ticket.

If someone tried to draw a fake wristband, the stamp wouldn't match and they'd be turned away.

🧠 **What it really is:**
A **JWT (JSON Web Token)** is a string the user's browser carries to prove who they are. It has a **signature** — a cryptographic stamp made with a secret only your system knows (`SUPABASE_JWT_SECRET`). Your server re-computes the stamp; if it matches, the token is genuine and not tampered with.

Your code does this check *locally and fast* (`verifyJWTLocal` in `api/user-sync.js`), so it doesn't have to phone Supabase on every request. If the secret isn't configured, it falls back to asking Supabase directly (slower).

🎤 **Say this in the interview:**
> "Auth is JWT-based via Supabase. The serverless functions verify the token's HS256 signature locally using the shared secret, which avoids a network round-trip per request. There's a fallback to the Supabase auth API if the secret isn't set. The token's `sub` claim is the user ID I scope every query to."

(If they ask "what's HS256?": "It's the signing algorithm — a keyed hash. Same secret signs and verifies, so it's symmetric.")

---

## PART 6 — "localStorage-first" (why the app works even before you sign up)

🧸 **Picture it:**
You write your homework in your **personal notebook** first (instant, always works, even with no internet). *Later*, if you have a school account, you photocopy it into the **school's filing cabinet** so you don't lose it and can see it from any computer.

Your app writes to the notebook (the browser) FIRST, then *maybe* copies to the cabinet (the database) if you're logged in.

🧠 **What it really is:**
**localStorage** is a small storage box inside the browser. Your "stores" (`lib/stores/AppStore.ts`, etc.) save there *immediately* (this is called an **optimistic update** — update the screen first, sync later). If the user is logged in, it then syncs to the database in the background.

**Why:** instant feel, works offline, and — crucially — lets **anonymous, not-signed-up people track applications.** That's the whole funnel: let them get value first, collect data, ask them to sign up later.

**The tradeoffs (say these):**
- The browser is the "source of truth" until it syncs. If two devices disagree, the rule is **last-write-wins** (newest timestamp beats older).
- If the background sync fails, the current code **swallows the error** — the user thinks it saved but it didn't reach the database. That's a real weak spot.
- If someone clears their browser before signing up, that data is gone.

🎤 **Say this in the interview:**
> "State is localStorage-first with optimistic updates — writes hit local storage synchronously, then sync to the DB for logged-in users. This enables anonymous tracking, which is core to the acquisition model. The tradeoffs are last-write-wins conflict resolution and that sync failures are currently swallowed, so there's a silent-data-loss risk I'd want to harden with a retry queue and surfaced errors."

---

## PART 7 — The data model (how the filing cabinet is organized)

🧸 **Picture it:**
Think of separate labeled boxes:
- **Applications box** — every job a person applied to (private to that person).
- **Events box** — the *story* of each application over time: "applied → they replied → got an interview → got ghosted." You don't just keep the latest status; you keep the **whole history**.
- **Reports box** — the big public pile of "here's what happened to me at Company X" from everyone. This is the gold.
- **Company Scores box** — the calculated report cards, built from the Reports pile.
- **Credits box** — how many AI uses each person has left (like arcade tokens).

🧠 **What it really is:**
Tables in Postgres: `applications`, `application_events`, `reports`, `companies` / `company_locations`, `company_scores`, `ai_credits` + `credit_transactions`, plus support tables (feature flags, rate limits, Stripe records).

Two important details:
1. **Event-sourcing**: you store the *history of events*, not just the current state. That's richer and lets you detect lies (e.g., "got an offer 1 hour after applying" is impossible).
2. **Companies are linked by name text**, not a strict ID link in the applications. That's simpler to write but causes "Google" vs "Google LLC" matching headaches — a known weak spot.

🎤 **Say this in the interview:**
> "The model is event-sourced at the application level — I store the full event history, not just current status, which powers anomaly detection. The aggregate corpus is the reports table, which rolls up into per-company scores. One known weakness is that company linkage is by normalized name rather than a hard foreign key, so entity resolution is fuzzy."

---

## PART 8 — The "trust system" (treating every report as a *claim*, not a *fact*)

🧸 **Picture it:**
If a kid says "I scored 100 goals yesterday," you don't write it in the record book as fact. You note *who said it, how sure they seem, and whether it's even possible.* If someone claims they applied and got hired the same hour, that's a red flag — you mark it as suspicious and don't let it count.

🧠 **What it really is:**
Every event carries `source`, `confidence`, `trust_weight`, and `anomaly_flags`. The app flags **impossible timelines** (offer/rejection in under 2 days) and **spam bursts** (too many events per hour) and sets their trust weight to 0 so they don't poison the scores.

**Be honest about the gap:** right now most of this checking is **client-side** (in the browser), which a determined person could bypass. And one server endpoint that accepts reports (`api/reports.js`, the `submit` action) currently has **no login required and no rate limit** — so the trust system has a hole. For a company built on data integrity, that's the most important thing to fix.

🎤 **Say this in the interview:**
> "We treat submissions as claims, not facts — every event has a source, confidence, trust weight, and anomaly flags, and impossible timelines or burst submissions get zero weight. I'll be candid that today most of that enforcement is client-side, and one report-ingestion path is unauthenticated and unthrottled — so server-side trust scoring and auth on that endpoint is my top integrity fix."

---

## PART 9 — Scoring (turning piles of reports into a grade)

🧸 **Picture it:**
To grade a company you start at 50 (a C). Then:
- Lots of people got replies? **Add points.**
- Lots of people got ghosted? **Subtract points.**
- Takes forever to hear back? **Subtract a little.**
- Only 2 people reported? Don't trust it much — show it as a "weak signal," not a confident grade.

🧠 **What it really is:**
A pure math function (`api/_utils/companyScore.js`): `50 + response*40 − ghost*30 − slowness*15 + a small volume bonus`. It also computes a **confidence** (0 to 1) based on how many reports back it. Thin data = low confidence = shown as tentative. The function is "pure" (same input always gives same output), which makes it easy to test.

🎤 **Say this in the interview:**
> "Scoring is a pure, unit-testable function: a baseline adjusted by response rate, ghost rate, and wait time, with a capped volume bonus so high report counts can't bury a bad ghost rate. Every score carries a confidence derived from sample size and freshness, so thin data is surfaced as a weak signal instead of a falsely precise number."

---

## PART 10 — The AI part (how Claude is used)

🧸 **Picture it:**
You hand a very smart but sometimes-messy assistant a resume and say "score this against the job." It hands back an answer, but sometimes wraps it in extra chatter. So you have to *fish out* the clean part. And if the assistant is busy, you politely ask again a few times before giving up.

🧠 **What it really is:**
You call **Claude (Haiku model)** over HTTP. Pattern: build a prompt → send it → **retry** if the API is rate-limited/overloaded → strip code fences → **pull the JSON out with a regex** → parse it. Uses are paid for with "credits."

**Weak spots to name:** fishing JSON out with a regex is fragile (better: use the model's structured-output/tool features). And user text (resumes, company names) goes straight into prompts, which is a **prompt-injection** surface.

🎤 **Say this in the interview:**
> "AI features call Claude Haiku with a retry/backoff loop on 429/529. I currently extract JSON from the response text via regex, which is fragile — the upgrade is structured outputs or tool-use for guaranteed-parseable responses. User-controlled text flows into prompts, so prompt-injection hardening is on the list. Every call is credit-gated server-side."

---

## PART 11 — How it breaks (failure modes — interviewers LOVE this)

🧸 **Picture it:**
Every helper your app depends on can have a bad day. The smart question isn't "does it work?" — it's "what happens when the AI is down? when the database is slow? when 10,000 people show up at once?"

🧠 **What it really is — the honest list:**
- **Rate limiter fails *open*:** if the database hiccups, the thing that stops abuse turns OFF instead of ON. Convenient, but risky during an outage.
- **Credit check on DB failure:** if it can't read your balance, it may treat you as a brand-new user and hand out the welcome bonus again.
- **Silent sync loss:** failed background syncs are swallowed; user thinks data saved when it didn't.
- **First thing to break at 10k users:** the rate-limit table is written on *every single request* (a hot spot), plus AI cost/limits, plus database connection pressure from all those serverless calls.

🎤 **Say this in the interview:**
> "My rate limiter fails open — during a DB outage, throttling disappears, which is a deliberate availability-over-safety tradeoff I'd revisit. At ~10k users the first pressure points are the rate-limit table write path, which is hit on every request, Anthropic rate limits and cost, and connection pooling, since each serverless invocation opens a DB connection. I'd add caching, a durable sync queue, and atomic credit operations."

---

## PART 12 — The things you did RIGHT (say these with confidence)

🧸 **Picture it:** Not everything is a weakness — a few parts are genuinely solid, and you should say so plainly.

🧠 / 🎤 **What they are, and how to say it:**
- **Service key never leaks to the browser.** → *"The privileged key is server-only; the client is anon-key only."*
- **Stripe payments are secure.** → *"The Stripe webhook verifies the signature, enforces a replay window, and is idempotent via a unique event-id table, so a forged or duplicated webhook can't grant Pro."*
- **Scoring is pure and testable.** → *"The scoring engine is side-effect-free, so it's fully unit-testable and deterministic."*
- **Confidence-gated data.** → *"Thin data is never shown as a confident fact."*

---

## THE CHEAT SHEET (memorize these 8 lines)

1. **What it is:** "A hiring-intelligence platform; the tracker is the data engine, the score cards are the growth engine."
2. **Shape:** "Next.js/React frontend, Vercel serverless backend, Supabase Postgres."
3. **Key decision:** "Service-key proxy — client sends a JWT, the server validates it and uses the admin key to do scoped DB work."
4. **The tradeoff:** "So RLS is defense-in-depth; correctness depends on my own `user_id` filters."
5. **State:** "localStorage-first with optimistic updates, enabling anonymous tracking; conflicts are last-write-wins."
6. **Data:** "Event-sourced applications roll up into a public reports corpus, which rolls up into confidence-gated company scores."
7. **Trust:** "Submissions are claims, not facts — weighted by confidence and anomaly flags."
8. **Biggest fix:** "The unauthenticated report-ingestion path and client-side-only trust checks are my top data-integrity work."

---

## A WORD ON HONESTY IN THE INTERVIEW

The strongest thing you can do is **name your own weaknesses before they find them.** Senior engineers don't expect a perfect app — they expect you to *understand the tradeoffs you made.* When you say "I chose X; the cost is Y; if I had more time I'd do Z," you sound senior even when the code isn't perfect. That sentence pattern — **choice → cost → next step** — is your best friend. Use it on everything.

> "I made this choice. Here's what it buys me. Here's what it costs me. Here's what I'd do next."
