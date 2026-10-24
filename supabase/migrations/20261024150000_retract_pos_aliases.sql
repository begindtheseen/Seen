-- 2026-10-24 (expert ATS audit, D6): "cashier" and "cash handling" are not synonyms of "point of
-- sale". Migration 028 seeded them as aliases, so the optimizer believed a POS bullet proved cash
-- handling and wrote "POS (cash handling) system" into a résumé. The code already ignores these two
-- rows (lib/optimizer/normalizeSkills.js RETRACTED_ALIASES); this removes them from the data.
-- Additive in effect (deletes two seed rows; the related edge cash handling ~ point of sale stays).
DELETE FROM public.skill_aliases
 WHERE skill = 'point of sale'
   AND alias IN ('cashier', 'cash handling');
