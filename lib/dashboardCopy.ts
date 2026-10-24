// Dashboard sentences that depend on counts — pure, so the arithmetic is pinned by a test
// (user audit 2026-10-23 asked that "Track N more applications" be right at 1 and 2).

/** The job-search health score needs this many tracked applications before it exists. */
export const HEALTH_MIN_APPS = 3

/** How many more applications unlock the health score (never below 1 while it is locked). */
export function appsUntilHealth(tracked: number): number {
  return Math.max(1, HEALTH_MIN_APPS - Math.max(0, Math.floor(tracked)))
}

/** "Track 2 more applications and Seen scores how your search is going." */
export function healthUnlockLine(tracked: number): string {
  const n = appsUntilHealth(tracked)
  return `Track ${n} more application${n === 1 ? '' : 's'} and Seen scores how your search is going.`
}
