// Typed client entry to the pure résumé engine (parse / score / rewrite / serialize / templates).
// Everything here runs in the browser — no network, no credits — because the modules under
// lib/resume/{model,parse,health,rewrite,render/templates,render/text}.js import no Node built-ins.
// Rendering (PDF/DOCX), tailoring and the ATS round-trip stay on the server (/api/resume).
import { normalizeDoc as _normalizeDoc, serializeToText as _serializeToText, docStats as _docStats, docIsEmpty as _docIsEmpty, newId as _newId, splitSkillList as _splitSkillList, emptyDoc as _emptyDoc, titleForKind as _titleForKind } from './model.js'
import { parseResume as _parseResume } from './parse/index.js'
import { findDateRange as _findDateRange, formatRange as _formatRange, parseDateToken as _parseDateToken, toToken as _toToken } from './parse/dates.js'
import { scoreResume as _scoreResume } from './health/score.js'
import { rewriteDoc as _rewriteDoc, rewriteBullet as _rewriteBullet, suggestVerbs as _suggestVerbs } from './rewrite/rules.js'
import { listTemplates as _listTemplates } from './render/templates.js'
import { renderText as _renderText, renderMarkdown as _renderMarkdown } from './render/text.js'
import { applyPlan as _applyPlan, bulletFromAnswer as _bulletFromAnswer } from './tailor/optimizer.js'
import type { ResumeDoc, Health, RewriteLogEntry, TemplateInfo, TailorPlan, TailorOverrides, TailorPrompt } from './types'

export const normalizeDoc = (input: unknown): ResumeDoc => _normalizeDoc(input) as unknown as ResumeDoc
export const emptyDoc = (): ResumeDoc => _emptyDoc() as unknown as ResumeDoc
export const serializeToText = (doc: ResumeDoc): string => _serializeToText(doc)
export const docStats = (doc: ResumeDoc): { words: number; bullets: number; roles: number; education: number; skills: number; sections: number } => _docStats(doc)
export const docIsEmpty = (doc: ResumeDoc): boolean => _docIsEmpty(doc)
export const newId = (prefix?: string): string => _newId(prefix)
export const splitSkillList = (s: string): string[] => _splitSkillList(s)
export const titleForKind = (kind: string): string => _titleForKind(kind)
export const parseResume = (text: string, fileName = ''): ResumeDoc => _parseResume({ text, source: 'text', fileName }) as unknown as ResumeDoc
export const scoreResume = (doc: ResumeDoc): Health => _scoreResume(doc) as unknown as Health
export const rewriteDoc = (doc: ResumeDoc, opts: { tense?: 'past' | 'present' | 'keep' } = {}): { doc: ResumeDoc; log: RewriteLogEntry[] } => _rewriteDoc(doc, { apply: true, ...opts }) as unknown as { doc: ResumeDoc; log: RewriteLogEntry[] }
export const rewriteBullet = (text: string, opts: { tense?: 'past' | 'present' | 'keep' } = {}): { text: string; original: string; changes: Array<{ rule: string; from: string; to: string }>; notes: string[]; unchanged: boolean } => _rewriteBullet(text, opts)
export const suggestVerbs = (lemma: string, text?: string): string[] => _suggestVerbs(lemma, text)
export const listTemplates = (): TemplateInfo[] => _listTemplates() as unknown as TemplateInfo[]
export const renderText = (doc: ResumeDoc): string => _renderText(doc)
export const renderMarkdown = (doc: ResumeDoc): string => _renderMarkdown(doc)
export const findDateRange = (line: string): { start: string; end: string; raw: string } | null => _findDateRange(line)
export const formatRange = (start: string, end: string): string => _formatRange(start, end)
/** "Jun 2021 – Present" / "2019" / "Summer 2017" → { start, end } tokens (end '' for a single date). */
export function parseDateText(text: string): { start: string; end: string } {
  const r = _findDateRange(text)
  if (r) return { start: r.start, end: r.end }
  const single = _parseDateToken(text.trim())
  if (single && single !== 'present') return { start: _toToken(single), end: '' }
  return { start: '', end: '' }
}

/** Re-apply a tailor plan with the user's overrides — pure, instant, no credit. */
export const applyTailorPlan = (base: ResumeDoc, plan: TailorPlan, overrides: TailorOverrides = {}): ResumeDoc => _applyPlan(base, plan, overrides) as unknown as ResumeDoc
export const bulletFromAnswer = (prompt: TailorPrompt, answer: string): string => _bulletFromAnswer(prompt, answer)
