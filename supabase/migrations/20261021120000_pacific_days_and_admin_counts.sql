-- California time + truthful admin counts (owner, 2026-10-21: "get rid of UTC anywhere and everywhere —
-- we are in California"; "admin is giving me false numbers").
--
-- 1. The daily AI-credit reset happens at midnight in California, not at midnight UTC (5 PM the day
--    before). consume_credit is the live definition with only v_today changed; the JS fallback
--    (lib/server/credits.js) uses the same day (lib/time/pacific.js pacificDate).
-- 2. admin_jobs_by_company(): the admin "All job listings" panel grouped one capped PostgREST page
--    (1,000 of 76,000+ rows) and called it the total. The database counts every row instead.
-- Additive and backward compatible: the old code ignores the new function; the new code falls back
-- when it is missing.

alter table public.ai_credits alter column last_reset set default ((now() at time zone 'America/Los_Angeles')::date);

CREATE OR REPLACE FUNCTION public.consume_credit(p_uid uuid, p_reason text DEFAULT 'ai_tool'::text, p_pro_only boolean DEFAULT false)
 RETURNS TABLE(status text, balance integer, pro boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() at time zone 'America/Los_Angeles')::date;  -- the California day
  v_row   public.ai_credits%ROWTYPE;
  v_pro   boolean;
BEGIN
  SELECT * INTO v_row FROM public.ai_credits WHERE user_id = p_uid FOR UPDATE;

  -- New user — welcome bonus of 10 (first use -> 9)
  IF NOT FOUND THEN
    IF p_pro_only THEN
      RETURN QUERY SELECT 'pro_required'::text, 0, false; RETURN;
    END IF;
    INSERT INTO public.ai_credits(user_id, balance, daily_earned, last_reset, pro)
      VALUES (p_uid, 9, 0, v_today, false);
    INSERT INTO public.credit_transactions(user_id, delta, reason) VALUES (p_uid, 10, 'welcome_bonus');
    INSERT INTO public.credit_transactions(user_id, delta, reason) VALUES (p_uid, -1, p_reason);
    RETURN QUERY SELECT 'ok'::text, 9, false; RETURN;
  END IF;

  -- Effective Pro: subscription flag OR an unexpired purchased Pro window (sprint SKU).
  v_pro := v_row.pro OR (v_row.pro_until IS NOT NULL AND v_row.pro_until > now());

  -- Pro: unlimited
  IF v_pro THEN
    INSERT INTO public.credit_transactions(user_id, delta, reason) VALUES (p_uid, -1, p_reason);
    RETURN QUERY SELECT 'ok'::text, 999, true; RETURN;
  END IF;

  -- Pro-only feature, caller is not Pro: reject without consuming
  IF p_pro_only THEN
    RETURN QUERY SELECT 'pro_required'::text,
      COALESCE(v_row.balance, 0) + COALESCE(v_row.purchased_credits, 0), false; RETURN;
  END IF;

  -- Daily reset — 1/day (migration 031's squeeze). purchased_credits is NOT reset.
  IF v_row.last_reset IS DISTINCT FROM v_today THEN
    UPDATE public.ai_credits SET balance = 1, daily_earned = 0, last_reset = v_today WHERE user_id = p_uid;
    v_row.balance := 1;
  END IF;

  -- Spend the daily balance first, then purchased credits.
  IF COALESCE(v_row.balance, 0) > 0 THEN
    UPDATE public.ai_credits SET balance = v_row.balance - 1 WHERE user_id = p_uid;
    v_row.balance := v_row.balance - 1;
  ELSIF COALESCE(v_row.purchased_credits, 0) > 0 THEN
    UPDATE public.ai_credits SET purchased_credits = v_row.purchased_credits - 1 WHERE user_id = p_uid;
    v_row.purchased_credits := v_row.purchased_credits - 1;
  ELSE
    RETURN QUERY SELECT 'no_credits'::text, 0, false; RETURN;
  END IF;

  INSERT INTO public.credit_transactions(user_id, delta, reason) VALUES (p_uid, -1, p_reason);
  RETURN QUERY SELECT 'ok'::text,
    COALESCE(v_row.balance, 0) + COALESCE(v_row.purchased_credits, 0), false; RETURN;
END;
$function$;

-- One jsonb value, not rows: PostgREST caps a function's ROWS at max-rows (1,000) too.
create or replace function public.admin_jobs_by_company()
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('company', company, 'total', total, 'active', active) order by total desc, company), '[]'::jsonb)
  from (select coalesce(nullif(trim(company), ''), 'Unknown') as company, count(*) as total,
               count(*) filter (where availability_status = 'active') as active
        from public.jobs group by 1) g;
$$;
revoke all on function public.admin_jobs_by_company() from public, anon, authenticated;
grant execute on function public.admin_jobs_by_company() to service_role;
