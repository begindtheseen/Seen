-- Migration 025: atomic credit consumption.
--
-- Replaces the read-modify-write in lib/server/credits.js (gateAI) and api/user-sync.js
-- (consume_credit action), where two concurrent requests could read the same balance and each
-- deduct from it — spending one credit twice. SELECT ... FOR UPDATE serializes concurrent calls
-- for the same user, so a balance can never go below zero or be double-spent.
--
-- Returns one row: status in ('ok','no_credits','pro_required'), the resulting balance, and pro.
-- Mirrors the existing JS logic exactly: welcome bonus (10 credits, first use -> 9), Pro =
-- unlimited (999 sentinel), daily reset to 3, decrement by 1, plus the credit_transactions ledger.

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

  -- New user
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

  -- Daily reset
  IF v_row.last_reset IS DISTINCT FROM v_today THEN
    UPDATE public.ai_credits SET balance = 3, daily_earned = 0, last_reset = v_today WHERE user_id = p_uid;
    v_row.balance := 3;
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

-- Only the server (service_role) may call this. Never expose to anon/authenticated.
REVOKE ALL ON FUNCTION public.consume_credit(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_credit(uuid, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit(uuid, text, boolean) TO service_role;
