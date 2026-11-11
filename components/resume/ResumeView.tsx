'use client'

// A stored résumé, shown readably: parsed in the browser by the same engine as Résumé Studio
// (lib/resume parseResume) and laid out by DocPage — the same page the paid result's Document view shows.
// Nothing is added or reworded. When the parser finds no structure, the text is shown as written.
import { useMemo } from 'react'
import { parseResume, docIsEmpty } from '@/lib/resume/engine-client'
import DocPage from './DocPage'
import s from './DocPage.module.css'

export default function ResumeView({ text, fileName = '' }: { text: string; fileName?: string }) {
  const doc = useMemo(() => { try { return parseResume(text, fileName) } catch { return null } }, [text, fileName])
  if (!doc || docIsEmpty(doc)) return <div className={s.page}><p className={s.p} style={{ whiteSpace: 'pre-wrap' }}>{text}</p></div>
  return <DocPage doc={doc} testId="resume-view" />
}
