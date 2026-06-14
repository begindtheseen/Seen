# Deploy Notes

## 2026-06-14 (Session G)
- adm-wrap now has width:100% to prevent flex intrinsic-width expansion
  (margin:0 auto on a flex item overrides align-self:stretch, so without
  explicit width:100%, adm-wrap could grow wider than the viewport when
  child content is wide, pushing the right KPI column offscreen)
- Admin KPI card sizing matches pre-migration reference (1.8rem numbers)
- Mobile override matches old app proportions, no font-size reduction
