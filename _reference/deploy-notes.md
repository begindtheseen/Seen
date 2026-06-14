# Deploy Notes

## 2026-06-14 (Session G)
- Job dedup key fixed: now uses title+company+city (not apply_url)
- Adzuna tracking params made apply_url differ per search — that's why scan found 0
- Limit raised to 100k, no status filter — catches all dupes regardless of state
