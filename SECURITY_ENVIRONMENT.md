# SeenJobs — Environment Variables Reference

All environment variables required to run SeenJobs in production.  
Set in Vercel: Project → Settings → Environment Variables.

---

## Server-Only (NEVER expose to browser)

These must NEVER appear in `NEXT_PUBLIC_*` vars, client-side code, or be logged.

| Variable | Required | Used In | Notes |
|---|---|---|---|
| `SUPABASE_SERVICE_KEY` | ✅ | All `api/*.js` | Service-role key — bypasses RLS. Never in browser. |
| `SUPABASE_JWT_SECRET` | ✅ | `api/user-sync.js`, `api/stripe.js`, `api/resume.js`, `api/credits.js`, `api/apply.js`, `api/reports.js` | JWT signing secret — copy from Supabase Dashboard → Settings → API → JWT Secret |
| `STRIPE_SECRET_KEY` | ✅ | `api/stripe.js` | Stripe secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | `api/stripe.js` | Webhook signing secret (`whsec_...`) — **Required**; without it the webhook endpoint returns 503 |
| `STRIPE_PRICE_ID_MONTHLY` | ✅ | `api/stripe.js` | Stripe price ID for monthly plan |
| `STRIPE_PRICE_ID_YEARLY` | ✅ | `api/stripe.js` | Stripe price ID for yearly plan |
| `ANTHROPIC_KEY` | ✅ | `api/resume.js`, `api/jobs.js`, `api/job-insights.js`, `api/reports.js` | Anthropic/Claude API key |
| `RESEND_KEY` | ✅ | `api/apply.js`, `api/resume.js` | Resend email API key |
| `ADZUNA_APP_ID` | ✅ | `api/jobs.js`, `api/refresh-jobs.js` | Adzuna jobs API app ID |
| `ADZUNA_APP_KEY` | ✅ | `api/jobs.js`, `api/refresh-jobs.js` | Adzuna jobs API key |
| `ADMIN_USERNAME` | ✅ | `api/admin-stats.js` | Bootstrap admin username (used only if no admin_accounts rows exist) |
| `ADMIN_PASSWORD` | ✅ | `api/admin-stats.js` | Bootstrap admin password — **change after first login** |
| `ADMIN_EMAIL` | ✅ | `api/demand.js` | Email of the admin user allowed to trigger demand refresh via JWT auth. **Must be set** — demand endpoint fails closed without it. |
| `NOTIFY_EMAIL` | ✅ | `api/apply.js` | Admin notification email for job applications |
| `CRON_SECRET` | 🔶 STRONGLY RECOMMENDED | `api/refresh-jobs.js`, `api/demand.js` | Shared secret for authenticating cron job requests. Set the same value in Vercel cron headers. |
| `BLS_API_KEY` | ⚪ Optional | `api/demand.js` | Bureau of Labor Statistics API key. Defaults to unauthenticated BLS access if absent. |

---

## Public / Browser-Accessible

These are safe to be public. They are embedded in client-side JavaScript.

| Variable | Required | Current State | Notes |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | Hardcoded in `lib/supabase.ts` | Should move to `NEXT_PUBLIC_SUPABASE_URL` for rotation support |
| `SUPABASE_ANON_KEY` | ✅ | Hardcoded in `lib/supabase.ts` | Anon key is intentionally public — Supabase auth uses it. Should move to `NEXT_PUBLIC_SUPABASE_ANON_KEY` for rotation |

**Action**: Move both to `NEXT_PUBLIC_*` env vars in a future deploy to allow rotation without code changes.

---

## Security Checklist for New Deployments

- [ ] `STRIPE_WEBHOOK_SECRET` is set — the webhook endpoint returns 503 without it
- [ ] `SUPABASE_JWT_SECRET` matches the value in Supabase Dashboard → Settings → API
- [ ] `ADMIN_PASSWORD` is a strong random password (not the default from initial setup)
- [ ] `ADMIN_EMAIL` is set — demand endpoint fails open without it (fixed in code)
- [ ] `CRON_SECRET` is set and matches Vercel cron configuration
- [ ] No secret begins with `NEXT_PUBLIC_`
- [ ] Vercel Preview deployments have separate (test) Stripe keys if running payment flows
- [ ] `ANTHROPIC_KEY` has spending limits set in the Anthropic dashboard
- [ ] `RESEND_KEY` has a sending domain verified and rate limits configured

---

## Key Rotation Procedure

### Supabase JWT Secret Rotation
1. Generate new secret in Supabase Dashboard → Settings → API → Rotate JWT Secret
2. Update `SUPABASE_JWT_SECRET` in Vercel environment
3. Redeploy — all existing sessions will be invalidated (users must re-login)

### Stripe Secret Key Rotation
1. Generate new key in Stripe Dashboard → Developers → API Keys
2. Update `STRIPE_SECRET_KEY` in Vercel
3. Update `STRIPE_WEBHOOK_SECRET` if rotating webhook endpoint
4. Redeploy

### Admin Password Reset
If admin credentials are compromised:
1. Connect to Supabase SQL editor
2. `DELETE FROM admin_sessions WHERE admin_id = (SELECT id FROM admin_accounts WHERE username = '...');`
3. `UPDATE admin_accounts SET is_active = false WHERE username = '...';`
4. Set new `ADMIN_USERNAME` and `ADMIN_PASSWORD` env vars
5. Redeploy — the bootstrap flow will create a new account from env vars only if `admin_accounts` is empty. Since it won't be empty, you must manually insert.

### Supabase Anon Key Rotation
1. Rotate in Supabase Dashboard → Settings → API
2. Update hardcoded value in `lib/supabase.ts` (or move to `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
3. Deploy — all client sessions using the old key will fail (users must reload)
