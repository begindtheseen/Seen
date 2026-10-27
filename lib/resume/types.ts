// TypeScript view of the plain-JS résumé engine (lib/resume/*.js). The JS modules are the source
// of truth (they run unchanged in the Vercel api/*.js functions); these types let the Studio UI
// use them with type safety. Keep in step with model.js normalizeDoc().

export interface ResumeLink { kind: 'linkedin' | 'github' | 'portfolio' | 'other'; url: string; label: string }
export interface ResumeBasics { name: string; headline: string; email: string; phone: string; location: string; links: ResumeLink[]; summary: string }
export interface ResumeBullet { id: string; text: string }
export interface ResumeExperience { id: string; title: string; company: string; location: string; employmentType: string; start: string; end: string; dateText: string; summary: string; bullets: ResumeBullet[] }
export interface ResumeEducation { id: string; school: string; degree: string; field: string; location: string; start: string; end: string; dateText: string; gpa: string; details: ResumeBullet[] }
export interface ResumeSkillGroup { id: string; label: string; items: string[] }
export interface ResumeCertification { id: string; name: string; issuer: string; date: string; text: string }
export interface ResumeProject { id: string; name: string; role: string; url: string; start: string; end: string; dateText: string; summary: string; bullets: ResumeBullet[] }
export interface ResumeLanguage { id: string; name: string; level: string }
export interface ResumeExtra { id: string; kind: 'awards' | 'publications' | 'volunteer' | 'interests' | 'affiliations' | 'custom'; title: string; items: ResumeBullet[] }
export interface ResumeMeta {
  source: string; fileName: string; parsedAt: string; parserVersion: string
  warnings: Array<{ code: string; message?: string }>; confidence: Record<string, number>
  layout: { method?: string; columns?: number; pages?: number | null } | null
  tailoredFor: { company: string; role: string; jobId?: string } | null
  provenance: Array<Record<string, unknown> & { kind: string }>
  baseDocId: string | null
}
export interface ResumeDoc {
  schema: string; id: string; kind: 'base' | 'variant'
  basics: ResumeBasics
  experience: ResumeExperience[]; education: ResumeEducation[]; skills: ResumeSkillGroup[]
  certifications: ResumeCertification[]; projects: ResumeProject[]; languages: ResumeLanguage[]; extra: ResumeExtra[]
  sectionOrder: string[]
  meta: ResumeMeta
}

export interface HealthAnchor { section: string; itemId?: string; bulletId?: string }
export interface HealthFix { kind: 'rewrite' | 'verbs' | 'prompt' | string; text?: string; options?: string[]; verbs?: string[]; changes?: Array<{ rule: string; from: string; to: string }> }
export interface HealthFinding { dimension: string; code: string; severity: 'error' | 'warn' | 'info'; message: string; anchor: HealthAnchor; fix: HealthFix | null }
export interface HealthDimension { label: string; score: number; weight: number; findings: HealthFinding[] }
export interface Health {
  version: string; score: number; grade: string; band: string; years: number | null; words: number
  dimensions: Record<string, HealthDimension>
  findings: HealthFinding[]; topFixes: HealthFinding[]
  bullets: Array<{ bulletId: string; itemId: string; section: string; impact: number; metrics: string[]; issues: string[]; lead: { token: string; kind: string } }>
  summary: string
}

export interface RewriteLogEntry { section: string; itemId: string; bulletId: string; from: string; to: string; changes: Array<{ rule: string; from: string; to: string }>; notes: string[] }

export interface TailorGap { requirement: string; level: string; category?: string; severity: string; mustNotInvent: boolean; explanation: string; evidence: string | null }
export interface TailorDecision {
  itemId: string; title: string; company: string
  tier: 'core' | 'supporting' | 'context' | 'omit'
  decision: 'keep' | 'trim' | 'condense' | 'drop'
  relevance: number; recency?: number; tenure?: number; current: boolean; dateless: boolean; bullets: number
  family: string; familyLabel: string
  shared: Array<{ competency: string; group: string; demand: number; have: number; evidenced: boolean; bulletIds: string[] }>
  keptBullets: string[]; droppedBullets: string[]
  ranked: Array<{ bulletId: string; score: number; competencies: string[]; keywords: string[] }>
  implied?: string[]
  reasons: string[]; overridable: boolean
}
export interface TailorPrompt { id: string; itemId: string; roleTitle: string; company: string; kind: 'dates' | 'metric'; question: string; unit: string | null; why: string }
export interface TailorAdded { kind: 'transferable_bullet' | 'transferable_suggestion'; itemId: string; key?: string; bulletId: string | null; text: string; competency: string; basis: string; confirm: boolean; confirmed?: boolean; reason: string }
export interface TailorObjective { total: number; match: number; keywordCoverage: number; health: number; relevanceDensity: number; lengthFit: number; completeness: number; lines: number; penalty: number }
export interface TailorRewrite { bulletId: string; itemId: string; from: string; to: string; rules: string[]; tense?: 'past' | 'present' }
/** rewrites: true = accept every wording proposal, string[] = accepted bulletIds, absent = plan.applyRewrites (false). */
export interface TailorOverrides { decisions?: Record<string, TailorDecision['decision']>; transferable?: boolean; excludeAdded?: string[]; includeAdded?: string[]; summary?: boolean; skills?: boolean; terminology?: boolean; rewrites?: boolean | string[]; layout?: 'chronological' | 'relevance'; prompts?: TailorPrompt[]; answers?: Record<string, string> }
export interface TailorPlan {
  version: string
  optimizer?: string
  job: { title: string; company: string; jobId?: string; roleFamily: string; family?: string; familyLabel?: string; requirementCount: number }
  objective?: { before: TailorObjective; after: TailorObjective; evaluations: number }
  strategy?: { layout: 'chronological' | 'relevance'; pages: number; estimatedLines: number; linesBudget: number; order: string[]; summaryMode: string }
  /** the person's own summary scored higher than the rewritten one, so it stayed */
  summaryKept?: boolean
  decisions?: TailorDecision[]
  prompts?: TailorPrompt[]
  added?: TailorAdded[]
  rewrites?: TailorRewrite[]
  applyRewrites?: boolean
  ctx?: { jobTitle: string; company: string; jobId: string; pages: number; jobFamily: string; jobFamilyLabel: string; jobVec?: Record<string, number>; summary?: boolean; summaryFallback?: string; summaryKeywords?: Array<{ term: string; display: string; weight: number; surfaces: string[] }> }
  // SeenFit verdict before/after (the same scale as the Optimize modal and /resume); null when the
  // posting states fewer than three requirements (the verdict sentence says why).
  score: { before: number | null; after: number | null; verdict?: { score: number | null; band: string | null; sentence: string; gate: string | null; withheld: string | null }; requirementCount?: number; criticalCoverage: number | null; keywordCoverage: { before: number; after: number } }
  roles: Array<{ itemId: string; title: string; company: string; relevance: number; titleOverlap: number; tier?: string; family?: string; familyLabel?: string; bullets: Array<{ bulletId: string; score: number; hits: string[] }> }>
  summary: { text: string; replaced: string; sources: Record<string, unknown> | null; targeted?: boolean } | null
  skills: { reordered: boolean; reorders?: Array<{ kind: 'reorder_skills'; groupId: string; from: string[]; to: string[] }>; additions?: Array<{ groupId: string | null; term: string; listed: string; evidence: string; why: string }>; added: Array<{ term: string; evidence: string; why: string }> }
  terminology: Array<{ bulletId: string; itemId: string; from: string; to: string; alias: string; term: string }>
  applyTerminology?: boolean
  gaps: TailorGap[]
  keywords: { matched: Array<{ term: string; weight: number; span: string }>; missing: Array<{ term: string; weight: number; source: string }>; coverage: number }
  strengths: Array<{ requirement: string; evidence: string }>
  transferable: Array<{ requirement: string; evidence: string; explanation: string }>
  provenance: Array<Record<string, unknown> & { kind: string }>
}
export interface TailorResponse { ok: boolean; plan: TailorPlan; variant: ResumeDoc; health: Health; balance?: number; pro?: boolean; error?: string; credits_required?: boolean; pro_required?: boolean }

export interface AtsCheck {
  version: string; format: string; template: string | null; score: number; grade: string
  pages: number | null; columns: number | null; font: string | null; bytes: number; ms: number
  checks: Array<{ code: string; label: string; ok: boolean; weight: number; detail: string }>
  failed: string[]
  recovered: { name: string; email: string; phone: string; roles: Array<{ title: string; company: string; ok: boolean; readAs: { title: string; company: string; dates: string } | null; bullets: { found: number; total: number } }>; sections: string[]; lostWords: string[] } | null
  warnings: string[]; extractedText: string; summary: string
}

export interface TemplateInfo { id: string; label: string; tagline: string; description: string; accent: string; header: string; roleLayout: string }
export interface FormatInfo { id: 'pdf' | 'docx' | 'txt' | 'md' | 'json'; label: string; extension: string; templated: boolean; description: string }
