-- Migration 031: tighten the free tier to drive Pro conversion.
--
-- Strategy: keep the 10-credit welcome bonus (a generous first-day taste), but drop the
-- DAILY reset from 3 → 1. Free users burn through their starter credits, then only trickle
-- 1/day — they feel the wall and upgrade. (Pro stays unlimited; the free company checks,
-- scoreboard, reports, and outcome cards are NOT credit-gated, so growth/virality are
-- unaffected — only the AI résumé tools are gated.)
--
-- This is a CREATE OR REPLACE of consume_credit (migration 025) with the single change of
-- the daily-reset amount. Everything else (welcome bonus, Pro=999, pro-only reject, atomic
-- FOR UPDATE, ledger writes) is identical.

CREATE OR REPLACE FUNCTION public.consume_credit(
  p_uid      uuid,
  p_reason   text    DEFAULT 'ai_tool',
  p_pro_only boolean DEFAULT false
)
RETURNS TABLE(status text, balance integer, pro boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today       date := current_date;
  v_row         public.ai_credits%ROWTYPE;
  v_new_balance integer;
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

  -- Pro: unlimited
  IF v_row.pro THEN
    INSERT INTO public.credit_transactions(user_id, delta, reason) VALUES (p_uid, -1, p_reason);
    RETURN QUERY SELECT 'ok'::text, 999, true; RETURN;
  END IF;

  -- Pro-only feature, caller is not Pro: reject without consuming
  IF p_pro_only THEN
    RETURN QUERY SELECT 'pro_required'::text, COALESCE(v_row.balance, 0), false; RETURN;
  END IF;

  -- Daily reset — 1/day (was 3) to create the upgrade squeeze
  IF v_row.last_reset IS DISTINCT FROM v_today THEN
    UPDATE public.ai_credits SET balance = 1, daily_earned = 0, last_reset = v_today WHERE user_id = p_uid;
    v_row.balance := 1;
  END IF;

  IF v_row.balance <= 0 THEN
    RETURN QUERY SELECT 'no_credits'::text, 0, false; RETURN;
  END IF;

  v_new_balance := v_row.balance - 1;
  UPDATE public.ai_credits SET balance = v_new_balance WHERE user_id = p_uid;
  INSERT INTO public.credit_transactions(user_id, delta, reason) VALUES (p_uid, -1, p_reason);
  RETURN QUERY SELECT 'ok'::text, v_new_balance, false; RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_credit(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_credit(uuid, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit(uuid, text, boolean) TO service_role;
