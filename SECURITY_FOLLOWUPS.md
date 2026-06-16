# Security follow-ups

Status of the Supabase security-advisor items for the Seen project. Updated 2026-06-16.

The actionable issues have been fixed (migrations `020`–`022`, applied to prod). What
remains is **one Pro-plan-gated Auth setting** and a set of **benign INFO** notices.

---

## ✅ Fixed (live in prod)

| Item | Advisor | Fix |
|------|---------|-----|
| `rate_limits` had RLS **disabled** (critical) | `0008` | `020_rate_limits_rls.sql` — enable RLS; pin `search_path` + revoke anon EXECUTE on the rate-limit functions |
| Permissive `WITH CHECK (true)` INSERT policies on `reports`, `jobs`, `search_logs`, `user_issues` let anyone with the anon key write directly to score/corpus tables | `0024` | `021_security_policy_hardening.sql` — drop the permissive policies (writes are service-key only; employers keep their scoped `jobs` insert) |
| Anon/authenticated could EXECUTE internal `SECURITY DEFINER` functions via RPC | `0028/0029` | `021` — `REVOKE EXECUTE` on `handle_new_user`, `recalculate_location_score`, `rls_auto_enable` |
| Mutable `search_path` on functions | `0011` | `020`/`021` — pinned `search_path` |
| `resumes` public bucket allowed **listing all resumes** (PII) | `0025` | `022_resume_bucket_listing.sql` — drop the two broad SELECT policies; owner-scoped read remains |

---

## ⏳ Owner action required

### 1. Leaked-password protection (HaveIBeenPwned) — Pro-plan only

- **Advisor:** `auth_leaked_password_protection` (WARN, not critical).
- **Why it's not showing in the dashboard:** the Supabase org **"Behindtheseen" is on the Free plan**. Per Supabase docs, leaked-password protection is **Pro Plan and above** — the toggle isn't available on Free.
- **Free mitigation (do this now, no cost):** strengthen password *requirements* (available on Free) at
  **Authentication → Providers → Email** (`/dashboard/project/_/auth/providers?provider=Email`):
  - Minimum password length ≥ 8 (12 recommended)
  - Required characters: digits + lowercase + uppercase + symbols
- **To get the actual HaveIBeenPwned check:** upgrade the Supabase org to **Pro (~$25/mo)**, then enable
  "Prevent use of leaked passwords" on that same Email provider page.
- **Decision:** acceptable to defer until on Pro; it's a WARN and the rest of auth/storage is locked down.

---

## 🟦 Benign / accepted (no action)

- **`rls_enabled_no_policy` (INFO)** on `company_scores`, `company_aliases`, `query_expansions`,
  `search_events`, `rate_limits`, `user_issues`. These are RLS-on with **no policy = deny-all to
  anon/authenticated**, while the server reads/writes them with the **service key (bypasses RLS)**.
  That's the intended locked-down state for service-key-only tables, not a vulnerability.

---

## How to re-check

Run the Supabase security advisor (dashboard → Advisors → Security, or the MCP `get_advisors`
tool with `type: security`). After the fixes above, only the leaked-password WARN + the benign
INFO notices should remain.
