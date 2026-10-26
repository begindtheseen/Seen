-- consume_credit treats admin-comped accounts as Pro (found 2026-10-25 by the Pro-tools eval harness).
--
-- lib/server/creditRules.js hasProAccess() — "the ONE definition of Pro" — counts ai_credits.comped, but the SQL
-- that gateAI actually calls did not: a comped account with pro=false was refused every Pro-only tool
-- (Interview Prep build → 402 pro_required) and was CHARGED a credit for the rest (Studio tailor: balance 10 → 9).
-- This is the live definition from 20261021120000 with only the v_pro line changed. Safe to run more than once.

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

  -- Effective Pro — the same rule as lib/server/creditRules.js hasProAccess: subscription flag OR
  -- admin-comped OR an unexpired purchased / earned Pro window.
  v_pro := v_row.pro OR COALESCE(v_row.comped, false) OR (v_row.pro_until IS NOT NULL AND v_row.pro_until > now());

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

NOTIFY pgrst, 'reload schema';
