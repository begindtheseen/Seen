-- The Stripe cancel/status/portal flow reads & writes ai_credits.stripe_customer_id,
-- but the column never existed — so subscriptions could never be located and cancel was
-- permanently disabled. Add it (nullable; populated on checkout confirm / by email lookup).
alter table public.ai_credits add column if not exists stripe_customer_id text;
create index if not exists ai_credits_stripe_customer_idx on public.ai_credits (stripe_customer_id) where stripe_customer_id is not null;
