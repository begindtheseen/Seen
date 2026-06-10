export const STAGES = ['Applied', 'Viewed', 'Phone Screen', 'Interview', 'Final Round', 'Offer'] as const
export type Stage = typeof STAGES[number]

export const CHECK_SCHEDULE = [
  { type: 'response_check',  day: 7,  label: 'Response check',  q: 'Did they respond to your application?' },
  { type: 'interview_check', day: 14, label: 'Interview check', q: 'Did they schedule any interviews?' },
  { type: 'outcome_check',   day: 30, label: 'Outcome check',   q: "What's the final outcome?" },
] as const

export type CheckType = 'response_check' | 'interview_check' | 'outcome_check'

export const EVENT_TYPES = [
  'application_submitted',
  'response_received',
  'assessment_received',
  'interview_received',
  'interview_completed',
  'offer_received',
  'rejected',
  'ghosted',
  'withdrawn',
] as const

export type EventType = typeof EVENT_TYPES[number]

export const USAGE_LIMITS = {
  scanner: 8,
  hiring_manager: 5,
  insider_intel: 5,
  coach: 4,
  proposal: 3,
} as const

export type UsageLimitKey = keyof typeof USAGE_LIMITS
