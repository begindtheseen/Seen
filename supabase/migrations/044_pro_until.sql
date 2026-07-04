-- Migration 044: one-time purchases — Pro time window + purchased credits (Operation 50%).
--
-- Owner-approved (2026-07-04) one-time SKUs need DB support:
--   sprint    ($14.99): +30 credits AND 7 days of Pro access
--   credits20 ($4.99):  +20 credits
--
-- 1) pro_until — a Pro-access TIME WINDOW independent of the subscription `pro` boolean.
--    Effective Pro everywhere = (pro = true) OR (pro_until > now()). The Stripe webhook
--    sets pro_until = GREATEST(existing, now() + 7 days) on a sprint purchase. The
--    subscription lifecycle (api/stripe.js setPro) only ever writes `pro`, so a canceled
--    subscription can never clobber a purchased window, and the reconcile sweeps (which
--    filter pro=eq.true) never touch window-only users.
--
-- 2) purchased_credits — purchased credits must SURVIVE the daily reset. `balance` is
--    reset to 1 every calendar day by design (migration 031's conversion squeeze), so
--    crediting a purchase into `balance` would silently destroy it at midnight.
--    purchased_credits never resets and is consumed only after the daily balance is spent.
--
-- consume_credit is CREATE OR REPLACEd (base: migration 031's definition) with exactly two
-- changes: the Pro check includes pro_until, and consumption falls back to
-- purchased_credits once the daily balance is exhausted. The returned `balance` is the
-- user's total spendable credits (daily + purchased).
--
-- Safe to run multiple times.

alter table public.ai_credits add column if not exists pro_until timestamptz;
alter table public.ai_credits add column if not exists purchased_credits integer not null default 0;

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
  v_today date := current_date;
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
$$;

-- Only the server (service_role) may call this. Never expose to anon/authenticated.
REVOKE ALL ON FUNCTION public.consume_credit(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_credit(uuid, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit(uuid, text, boolean) TO service_role;
