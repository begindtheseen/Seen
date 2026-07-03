import type { EventType, CheckType } from './constants'

export type AppStatus = 'active' | 'ghosted' | 'hired' | 'rejected'

export interface HiringEvent {
  id: string
  type: EventType | CheckType | string
  date: number
  source: 'user' | 'inferred' | 'admin_verified'
  confidence: number | 'low' | 'medium' | 'high'
  trust_weight?: number
  anomaly_flags?: string[]
  data?: Record<string, unknown>
}

export interface Application {
  id: string
  jobId?: string
  company: string
  role: string
  location?: string
  platform?: string
  jobUrl?: string
  stage: string
  status: AppStatus
  score?: number
  waste?: number
  employerStage?: string
  appliedAt: number
  updatedAt: number
  events: HiringEvent[]
}

export interface UserProfile {
  id?: string
  type?: 'seeker' | 'employer'
  name?: string
  email?: string
  city?: string
  experience?: string
  survey_completed?: boolean
  onboarding_survey?: string | Record<string, unknown>
  resume_text?: string | null
  resume_file_name?: string | null
  resume_word_count?: number | null
  updated_at?: string
  savedAt?: number
}

export interface SavedJob {
  job_id: string
  company: string
  role: string
  location?: string
  score?: number | null
  saved_at: string
  // Deep-link back to the original posting (parity: lets a saved listing reopen
  // to the real job board page even if it has aged out of our cache).
  apply_url?: string | null
  // Full listing captured AT SAVE TIME. This is what makes a saved listing always
  // reopen to the exact thing the user saved — independent of session cache or DB
  // expiry. Defined after Job below (interface order doesn't matter in TS).
  snapshot?: Job
}

// A job listing as normalized from /api/jobs search results.
// Shared by the /jobs search page, JobCache, and the /jobs/[id] detail route.
export interface Job {
  id: string
  title: string
  company: string
  location: string
  // null = UNRATED. We store a score only when it's earned from the listing's own signals;
  // a listing we can't score honestly carries null and renders an explicit "unrated" state
  // rather than a fabricated number. (Owner directive: "score for a reason or no score.")
  score: number | null
  waste: number | null
  level: string
  type: string
  source: string
  description: string
  salary: string | null
  apply_url: string | null
  availability_status?: string
  /** ISO timestamp of when the listing entered our corpus — powers the Posted filter. */
  posted_at?: string | null
}

export interface CheckScheduleItem {
  type: CheckType
  day: number
  label: string
  q: string
}

export interface DueCheck {
  app: Application
  checkType: CheckType
  day: number
  daysElapsed: number
  label: string
  q: string
  overdue: number
}

export interface Badge {
  id: string
  icon: string
  label: string
  desc: string
}

export interface CompanyScore {
  overall_score: number
  risk_level: 'safe' | 'warn' | 'danger'
  response_rate: number
  ghost_rate: number
  unpaid_rate: number
  avg_rounds: number
  report_count: number
  avg_wait_days: number
  source?: string
}

export interface ResumeData {
  text: string
  fileName: string
  wordCount: number
}
