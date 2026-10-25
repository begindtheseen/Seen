-- Funnel steps for the new paid offer (owner decisions 2026-10-25: Interview Prep leads, the 30-day Job
-- Search Pass replaces subscriptions, the trial and the Credit Pack — and every step is measured).
--
-- Adds to public.funnel_events (migration 20261025120000):
--   • the new step names: pricing_view, offer_shown, offer_clicked, prep_preview_shown, checkout_started,
--     checkout_completed (the five original names stay valid);
--   • surface text — where a paid offer sat: tracker_prep, company_page, pricing, upgrade_modal, lock_card,
--     homepage (NULL for steps that have no surface);
--   • sku text — which product a checkout step is about: interview, pass30, credits20 (NULL otherwise).
--
-- Additive only: no row is changed or removed, both columns are nullable, and the constraint is replaced by
-- a wider one. The code (lib/server/funnelEvents.js) works before and after: until this runs, a new step is
-- simply not recorded and the tracker card's offer is still counted under its old name.

ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS surface text;
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS sku text;

-- The original CHECK was declared inline (Postgres names it funnel_events_event_check). Drop whatever CHECK
-- constrains `event`, whatever its name, so a hand-applied copy with another name cannot block the new list.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.funnel_events'::regclass AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%event%'
  LOOP
    EXECUTE format('ALTER TABLE public.funnel_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_check CHECK (event IN (
  'prep_offer_shown', 'prep_offer_clicked', 'prep_built', 'guest_email_shown', 'guest_email_given',
  'pricing_view', 'offer_shown', 'offer_clicked', 'prep_preview_shown', 'checkout_started', 'checkout_completed'
));

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_surface_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_surface_check CHECK (
  surface IS NULL OR surface IN ('tracker_prep', 'company_page', 'pricing', 'upgrade_modal', 'lock_card', 'homepage')
);

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_sku_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_sku_check CHECK (
  sku IS NULL OR sku IN ('interview', 'pass30', 'credits20')
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_event_surface_time ON public.funnel_events (event, surface, created_at DESC);

NOTIFY pgrst, 'reload schema';
