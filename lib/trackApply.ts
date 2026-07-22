// Fire-and-forget apply-click beacon. The common apply path is a redirect to the employer's
// page — this records the observed click (apply_events, migration 058) so the employer's
// "applies" surface reflects reality. keepalive survives the navigation; failures are silent
// because tracking must NEVER break an apply.
export function trackApplyClick(job: { id?: string; company?: string; title?: string; location?: string; apply_url?: string | null }) {
  try {
    fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'track_click',
        jobId: job.id || null,
        company: job.company || null,
        role: job.title || null,
        location: job.location || null,
        applyUrl: job.apply_url || null,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* never break the apply */ }
}
