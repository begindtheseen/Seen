# Deploy Notes

## 2026-06-14 (Session G)
- adm-wrap width:100% fixes 2-col grid
- get_recent_jobs: removed invalid 'url' column → fixes Query failed
- Added scan_job_dupes + dedupe_jobs API actions
- Added JobDedupePanel component in admin page
- Added 014_job_dedup.sql migration (run after deduping)
