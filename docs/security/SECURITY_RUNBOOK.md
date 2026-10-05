# SeenJobs Security Runbook

Incident response procedures for production security events.

---

## Playbook Index

1. [Bot Attack / Traffic Spike](#1-bot-attack--traffic-spike)
2. [Stripe Webhook Failure](#2-stripe-webhook-failure)
3. [AI Cost Spike](#3-ai-cost-spike)
4. [Supabase Limit Spike](#4-supabase-limit-spike)
5. [User Data Exposure Suspected](#5-user-data-exposure-suspected)
6. [Admin Account Compromise](#6-admin-account-compromise)
7. [Company Score Data Poisoning](#7-company-score-data-poisoning)
8. [Payment Fraud / Fake Pro Accounts](#8-payment-fraud--fake-pro-accounts)

---

## Emergency Feature Flags

Go to `/admin` → Feature Flags to flip these:

| Flag | Effect |
|---|---|
| `ai_credit_system_enabled: off` | Makes all AI free — removes the credit gate. Use to unblock users during incidents. |
| `job_refresh_enabled: off` | Stops Adzuna job refresh crons. Reduces DB write load. |
| `reddit_import_enabled: off` | Stops Reddit scraping crons. |

To kill an entire endpoint in an emergency, add it to Vercel Firewall:
- Vercel Dashboard → Firewall → Rules → Block `/api/jobs` (all methods)

---

## 1. Bot Attack / Traffic Spike

**Symptoms**: Vercel function invocations spike, Claude API costs spike, DB write rate spikes, unusual IP patterns in Vercel Analytics.

**Immediate Actions**:

1. **Check rate limit hits** — Supabase SQL Editor:
   ```sql
   SELECT key, count_val FROM rate_limits 
   WHERE expires_at > now() 
   ORDER BY count_val DESC 
   LIMIT 20;
   ```
   This shows the IPs/endpoints being hammered.

2. **Block attacking IPs in Vercel Firewall**:
   - Vercel Dashboard → Firewall → Rules → IP Block
   - Block individual IPs or CIDR ranges

3. **Add emergency rate limits in Vercel Firewall**:
   - `/api/jobs` → 10 req/min per IP
   - `/api/resume` → 5 req/min per IP
   - `/api/reports` (POST) → 20 req/min per IP

4. **Kill expensive endpoints** if attack is sustained:
   - Vercel Firewall → Block `/api/jobs` temporarily
   - Or set Claude budget alert at Anthropic dashboard

5. **For Claude API cost control**:
   - Log in to console.anthropic.com
   - Set a hard spending limit for the day

**Recovery**: 
- Monitor for 30 minutes after blocking
- Remove blocks gradually after attack subsides
- Consider permanent Vercel Firewall rules for your worst offenders

---

## 2. Stripe Webhook Failure

**Symptoms**: Users report payments going through but not getting Pro access. Stripe Dashboard shows webhook delivery failures.

**Diagnosis**:
```sql
-- Check if the event was processed
SELECT * FROM stripe_events_processed 
WHERE event_id = 'evt_YOUR_EVENT_ID';

-- Check ai_credits for the user
SELECT * FROM ai_credits WHERE user_id = 'USER_UUID';
```

**Stripe Dashboard Checks**:
1. Stripe → Developers → Webhooks → your endpoint
2. Check "Recent deliveries" — look at the response code
3. If 503: `STRIPE_WEBHOOK_SECRET` env var is not set in Vercel
4. If 400 "Invalid signature": webhook secret mismatch — regenerate and update env var
5. If 200 but user not Pro: event may already be in `stripe_events_processed` from a retry

**Manual Pro Grant** (admin console):
```
POST /api/admin-stats
Headers: X-Admin-Token: <your-admin-token>
Body: {"action": "set_pro", "user_id": "USER_UUID", "pro": true}
```

**Retry Webhook Manually**:
- Stripe Dashboard → Webhooks → endpoint → Recent deliveries → Resend

**Root Cause Prevention**:
- Ensure `STRIPE_WEBHOOK_SECRET` is always set before deploying
- The endpoint now returns 503 (not 200) if the secret is missing, which causes Stripe to retry

---

## 3. AI Cost Spike

**Symptoms**: Anthropic monthly bill is unusually high. Claude API usage in console.anthropic.com spikes.

**Immediate Actions**:

1. **Check which endpoints are calling Claude**:
   ```sql
   SELECT endpoint, count(*) 
   FROM api_errors 
   WHERE created_at > now() - interval '1 hour'
   GROUP BY endpoint 
   ORDER BY count DESC;
   ```

2. **Set a hard Claude spending limit**:
   - console.anthropic.com → Billing → Usage Limits
   - Set daily/monthly hard limit

3. **Check for credit system bypass**:
   ```sql
   -- Are all AI calls gated?
   SELECT * FROM feature_flags WHERE flag_name = 'ai_credit_system_enabled';
   -- If status = 'off', AI is unlimited for everyone — fix it:
   -- UPDATE feature_flags SET status = 'fully_on' WHERE flag_name = 'ai_credit_system_enabled';
   ```

4. **Check for Pro abuse** (someone granted pro status fraudulently):
   ```sql
   SELECT user_id, pro, balance FROM ai_credits WHERE pro = true;
   -- Cross-reference with Stripe for legitimate subscribers
   SELECT user_id, stripe_customer_id FROM ai_credits WHERE pro = true AND stripe_customer_id IS NULL;
   -- Users with pro=true but no Stripe customer ID are suspicious
   ```

5. **Kill AI endpoints temporarily**:
   - Vercel Firewall → Block `/api/resume`, `/api/job-insights`
   - Or: Set `ai_credit_system_enabled: off` then set all credit balances to 0 via SQL

---

## 4. Supabase Limit Spike

**Symptoms**: Supabase Dashboard shows high row reads, DB CPU spike, approaching plan limits.

**Immediate Actions**:

1. **Check most expensive queries** (Supabase Dashboard → Reports → Query Performance)

2. **Check rate_limits table size**:
   ```sql
   SELECT COUNT(*) FROM rate_limits;
   SELECT COUNT(*) FROM rate_limits WHERE expires_at < now(); -- expired rows
   -- Clean up:
   DELETE FROM rate_limits WHERE expires_at < now() - interval '1 hour';
   ```

3. **Check for full-table scan queries**:
   ```sql
   SELECT COUNT(*) FROM reports; -- should be indexed
   SELECT COUNT(*) FROM jobs; -- should be indexed
   ```

4. **Add missing indexes if needed**:
   ```sql
   -- Jobs by availability status
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_availability ON jobs(availability_status);
   -- Reports full-text search (if doing ILIKE queries)
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_company_lower ON reports(lower(company_name));
   ```

5. **Pause non-critical crons**:
   - `job_refresh_enabled: off` — stops 6 daily job refresh runs

---

## 5. User Data Exposure Suspected

**Symptoms**: User reports seeing another user's data. Reports of leaked emails/applications. Unusual queries in Supabase logs.

**Immediate Actions**:

1. **Check Supabase auth logs** (Supabase Dashboard → Auth → Logs)

2. **Verify RLS is enabled** on all sensitive tables:
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public' AND tablename IN ('profiles','applications','ai_credits','reports')
   ORDER BY tablename;
   -- rowsecurity must be TRUE for all
   ```

3. **Check for recent policy changes**:
   ```sql
   SELECT schemaname, tablename, policyname, cmd, qual 
   FROM pg_policies 
   WHERE schemaname = 'public' 
   ORDER BY tablename;
   ```

4. **Check admin audit log** for unexpected data access:
   ```sql
   SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 50;
   ```

5. **If exposure confirmed**:
   - Identify affected user IDs
   - Notify affected users per your privacy policy / GDPR requirements
   - Document the exposure scope, timing, and cause
   - Rotate JWT secret to invalidate all sessions if auth bypass is suspected

6. **Temporarily restrict API access**:
   - Vercel Firewall → Block `/api/user-sync`
   - This will prevent all user data reads/writes until the breach is contained

---

## 6. Admin Account Compromise

**Symptoms**: Unauthorized changes in admin audit log. Unknown admin sessions active.

**Immediate Actions**:

1. **Invalidate all admin sessions**:
   ```sql
   DELETE FROM admin_sessions;
   ```

2. **Lock compromised account**:
   ```sql
   UPDATE admin_accounts 
   SET is_active = false, locked_until = now() + interval '24 hours'
   WHERE username = 'compromised_username';
   ```

3. **Check audit log for damage**:
   ```sql
   SELECT * FROM admin_audit_log 
   WHERE created_at > now() - interval '24 hours'
   ORDER BY created_at DESC;
   ```

4. **Rotate admin credentials**:
   - Update `ADMIN_PASSWORD` env var in Vercel
   - Clear `admin_accounts` table (only if starting fresh is safe)
   - The bootstrap flow creates a new account from env vars if the table is empty

5. **Check for unauthorized Pro grants**:
   ```sql
   SELECT user_id, pro, balance FROM ai_credits 
   WHERE pro = true 
   ORDER BY user_id;
   ```
   Cross-reference with Stripe subscription list.

---

## 7. Company Score Data Poisoning

**Symptoms**: A company's ghost rate suddenly jumps to 100% or drops to 0%. Reports of fake outcomes being submitted. Admin panel shows suspicious report patterns.

**Diagnosis**:
```sql
-- Check recent reports for a company
SELECT id, outcome, trust_reason, outcome_weight, user_id, created_at
FROM reports 
WHERE company_name ILIKE '%CompanyName%'
ORDER BY created_at DESC
LIMIT 50;
```

**Immediate Actions**:

1. **Downweight suspicious reports**:
   ```sql
   -- Set outcome_weight to 0 for suspicious batch
   UPDATE reports 
   SET outcome_weight = 0, needs_review = true
   WHERE user_id = 'SUSPICIOUS_USER_UUID'
     AND created_at > 'ATTACK_START_TIME';
   ```

2. **In admin panel**: Reports section → "Investigate" button on suspicious entries

3. **Block the user**:
   ```sql
   UPDATE ai_credits SET balance = 0, pro = false WHERE user_id = 'SUSPICIOUS_USER_UUID';
   ```

4. **Recalculate company score** (the score is recalculated on next reports API call using weighted avg of all reports with outcome_weight > 0)

5. **Check for coordinated attack** (multiple users):
   ```sql
   SELECT user_id, count(*) 
   FROM reports 
   WHERE company_name ILIKE '%CompanyName%'
     AND created_at > now() - interval '24 hours'
   GROUP BY user_id 
   HAVING count(*) > 3;
   ```

---

## 8. Payment Fraud / Fake Pro Accounts

**Symptoms**: Users with Pro access who haven't paid. Stripe shows no subscription for a user who has `pro = true`.

**Diagnosis**:
```sql
-- Find Pro users with no Stripe customer ID (potential fraud)
SELECT user_id, pro, balance, stripe_customer_id, created_at
FROM ai_credits 
WHERE pro = true AND (stripe_customer_id IS NULL OR stripe_customer_id = '');
```

**Actions**:

1. **Verify in Stripe**: Check if the user has a valid subscription at their customer ID

2. **Revoke fraudulent Pro access**:
   ```sql
   UPDATE ai_credits 
   SET pro = false, balance = 3
   WHERE user_id = 'FRAUDULENT_USER_UUID';
   ```

3. **Check if webhook was replayed**:
   ```sql
   -- Was this event ID processed more than once?
   SELECT * FROM stripe_events_processed WHERE event_id = 'evt_...';
   -- Should only have ONE row per event ID now (migration 017)
   ```

4. **Check for the attack vector**:
   - If the user got Pro before the webhook fix (C1 fix), they exploited the unverified fallback
   - If after the fix: check Stripe for actual payment, check admin audit log for `set_pro` action

---

## Vercel Firewall — Recommended Rules

Add these in Vercel Dashboard → Firewall:

| Rule | Action | Priority |
|---|---|---|
| IP in known bot ASNs | Block | HIGH |
| Request rate > 50/min per IP | Rate limit | HIGH |
| `/api/jobs` POST > 15/min per IP | Block 429 | HIGH |
| `/api/resume` POST > 8/min per IP | Block 429 | HIGH |
| `Content-Length > 5000000` | Block | MEDIUM |
| User-Agent = empty/bot patterns | Block | MEDIUM |
| `/api/admin-stats` not from known admin IPs | Log + MFA | MEDIUM |

---

## Logs to Check First in Any Incident

```sql
-- 1. Recent API errors
SELECT endpoint, error_msg, created_at FROM api_errors ORDER BY created_at DESC LIMIT 50;

-- 2. Admin actions
SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 50;

-- 3. Rate limit hotspots  
SELECT key, count_val FROM rate_limits WHERE expires_at > now() ORDER BY count_val DESC LIMIT 20;

-- 4. Stripe events processed
SELECT * FROM stripe_events_processed ORDER BY processed_at DESC LIMIT 20;

-- 5. Recent reports (potential poisoning)
SELECT company_name, outcome, user_id, created_at FROM reports ORDER BY created_at DESC LIMIT 50;
```
