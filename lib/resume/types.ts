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
export interface TailorPlan {
  version: string
  job: { title: string; company: string; roleFamily: string; requirementCount: number }
  score: { before: number; after: number; criticalCoverage: number; keywordCoverage: { before: number; after: number } }
  roles: Array<{ itemId: string; title: string; company: string; relevance: number; titleOverlap: number; bullets: Array<{ bulletId: string; score: number; hits: string[] }> }>
  summary: { text: string; replaced: string; sources: { title: string; years: number | null; companies: string[]; strengths: string[]; keptSentences?: string[] } } | null
  skills: { reordered: boolean; added: Array<{ term: string; evidence: string; why: string }> }
  terminology: Array<{ bulletId: string; itemId: string; from: string; to: string; alias: string; term: string }>
  gaps: TailorGap[]
  keywords: { matched: Array<{ term: string; weight: number; span: string }>; missing: Array<{ term: string; weight: number; source: string }>; coverage: number }
  strengths: Array<{ requirement: string; evidence: string }>
  transferable: Array<{ requirement: string; evidence: string; explanation: string }>
  provenance: Array<Record<string, unknown> & { kind: string }>
}
export interface PolishResult { available: boolean; reason?: string; applied?: number; changes: Array<{ id: string; from: string; text: string; reason: string }>; rejected: Array<{ id: string; reason: string }> }
export interface TailorResponse { ok: boolean; plan: TailorPlan; variant: ResumeDoc; health: Health; polish: PolishResult | null; balance?: number; pro?: boolean; error?: string; credits_required?: boolean; pro_required?: boolean }

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
