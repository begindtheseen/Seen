// Client helper: does this listing take applications on Seen? (lib/server/seenApply.js is the
// server-side source of the same rule.) Only employer-posted listings can; 'both' keeps the
// employer's own site too.
import type { Job } from '@/lib/types'

export function takesSeenApply(job: Pick<Job, 'employer_posted' | 'apply_mode'> | null | undefined): boolean {
  if (!job || !job.employer_posted) return false
  return job.apply_mode === 'seen' || job.apply_mode === 'both'
}
