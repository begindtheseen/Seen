// Shared types for the admin command center (extracted from app/admin/page.tsx).
export interface RecentReport {
  id: string; company_name: string; outcome: string; role: string; city: string
  platform: string; created_at: string; report_text: string
  outcome_weight: number; trust_reason: string; needs_review: boolean
}
export interface RecentApp {
  id: string; company_name: string; role: string; city: string
  status: string; stage: string; platform: string; created_at: string
}
export interface AdminStats {
  monetization?: {
    stripe_connected: boolean
    total_accounts: number
    pro_users: number
    free_users: number
    conversion_pct: number
    trialing: number | null
    active_paid: number | null
    canceling: number | null
    past_due: number | null
    canceled: number | null
    mrr: number | null
    mrr_annualized: number | null
    outcome_card_shares: number
    shares_by_channel: Record<string, number>
  }
  users: { total: number; new_today: number; new_this_week: number; dau: number }
  companies: { with_scores: number }
  reports: {
    total: number; today: number; this_week: number
    chart: { date: string; count: number }[]
    top_companies: { company: string; count: number }[]
    outcome_breakdown: { ghosted: number; rejected: number; interview: number; offer: number; waiting: number }
    recent: RecentReport[]
  }
  applications: { total: number; ghosted_30d: number; hired_30d: number; ghost_rate_pct: number | null; recent: RecentApp[] }
  company_lookups?: { ready: boolean; today: number; top: { company: string; count: number }[] }
  jobs: { total?: number; active: number; new_today: number; added_today: number; stale_or_expired: number; inactive_reports: InactiveReport[] }
  job_health?: { active: number; total: number; stale: number; active_pct: number; crisis: boolean }
  errors: { today: number; this_week: number; by_route: Record<string, number>; recent: { endpoint: string; error_msg: string; created_at: string }[] }
  issues: { open: number; items: Issue[] }
  duplicate_clusters: { suspected: number; items: DupCluster[] }
  feature_flags: FeatureFlag[]
  credits: { total_users: number; pro_users: number; total_balance?: number; earned?: number; spent?: number }
  flywheel?: { job_searches_30d: number; resume_scans_30d: number }
}
export interface Issue {
  id: string; type: string; target_name: string; notes: string; created_at: string; status: string
}
export interface InactiveReport {
  job_id: string; report_count: number; latest_reported_at: string
  reasons?: Record<string, number>
  job: { id: string; company: string; title: string; city: string; apply_url: string; availability_status: string } | null
  // Client-sent snapshot of the listing at report time — present for ephemeral (non-DB) listings
  // so the admin still sees what was flagged even when there is no jobs-table row.
  snapshot?: { company: string | null; title: string | null; city: string | null; apply_url: string | null } | null
}
export interface DupCluster {
  id: string; risk_score: number; status: string; signals: string[]; user_ids: string[]
}
export interface RecentJob {
  id: string; company: string; title: string; city: string
  apply_url: string; created_at: string; availability_status: string; source: string
}
export interface JobGroup { company: string; total: number; active: number }
export interface DupCompany { id: string; name: string; report_count: number; overall_score: number }
export interface DupGroup { key: string; companies: DupCompany[] }
export interface MergePrefill { primary: string; secondary: string; nonce: number }
export interface MergeLog { id: string; created_at: string; primary_name: string; secondary_name: string; moved_reports: number; undone_at: string | null }
export interface FeatureFlag {
  flag_name: string; status: string; percentage: number | null; description: string
}
export interface Sub {
  id: string; status: string; cancel_at_period_end: boolean
  trial_end: number | null; current_period_end: number | null
  customer: string | null; email: string | null
}

// Command-center presentational tone tokens (map to .ac-tone-* CSS classes).
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'white' | 'dim' | 'sub'

export interface AttnItem {
  key: string
  title: string
  detail: string
  sev: 'red' | 'amber' | 'blue' | 'green'
  action?: { label: string; onClick: () => void; busy?: boolean }
}
