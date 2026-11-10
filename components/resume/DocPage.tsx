'use client'

// A résumé document laid out as a page — the same sections, order, headings and labels the exported file
// prints (lib/resume/render/text.js + model.js labels), so what the person reads here is what they send.
// Used by ResumeView (a stored résumé) and the paid result's Document view, where a changed line carries a
// quiet margin mark and tapping it opens its change (`marks` + `onMark`). Nothing is added or reworded.

import type { ResumeDoc } from '@/lib/resume/types'
import { formatRange, sectionTitle, experienceGroups, companyLabel, earnedDateLabel, gpaLabel, withExpected } from '@/lib/resume/engine-client'
import s from './DocPage.module.css'

export interface DocMarks { summary?: string | null; bullets?: Record<string, string>; skills?: Record<string, string>; certs?: Record<string, string> }

const join = (parts: Array<string | undefined | null>, sep: string) => parts.map((p) => String(p || '').trim()).filter(Boolean).join(sep)
const dateOf = (e: { start: string; end: string; dateText: string }) => (/\b(?:springs?|summers?|falls?|autumns?|winters?|q[1-4])\b/i.test(e.dateText || '') ? e.dateText : e.end || !e.dateText ? (withExpected(e, formatRange(e.start, e.end)) || e.dateText) : e.dateText) || ''

function Line({ mark, onMark, children, as = 'li' }: { mark?: string | null; onMark?: (id: string) => void; children: React.ReactNode; as?: 'li' | 'p' }) {
  const Tag = as
  if (!mark) return <Tag className={as === 'li' ? s.li : s.p}>{children}</Tag>
  return (
    <Tag className={`${as === 'li' ? s.li : s.p} ${s.marked}`} data-mark={mark}>
      {onMark
        ? <button type="button" className={s.markBtn} onClick={() => onMark(mark)} aria-label="Changed for this job — see the change">{children}</button>
        : children}
    </Tag>
  )
}

export default function DocPage({ doc, marks = {}, onMark, testId }: { doc: ResumeDoc; marks?: DocMarks; onMark?: (changeId: string) => void; testId?: string }) {
  const b = doc.basics
  const contact = join([b.location, b.phone, b.email, ...(b.links || []).map((l) => l.url)], ' · ')
  const bm = marks.bullets || {}
  const order = (doc.sectionOrder && doc.sectionOrder.length ? doc.sectionOrder : ['summary', 'experience', 'education', 'skills', 'certifications', 'projects', 'languages'])
  return (
    <article className={s.page} data-testid={testId || 'doc-page'} aria-label="Your résumé for this job">
      {b.name && <p className={s.name}>{b.name}</p>}
      {b.headline && <p className={s.headline}>{b.headline}</p>}
      {contact && <p className={s.contact}>{contact}</p>}
      {order.map((key) => {
        if (key === 'summary' && b.summary) return (
          <section key={key} className={s.sec}>
            <p className={s.h}>{sectionTitle(doc, 'summary')}</p>
            <Line as="p" mark={marks.summary} onMark={onMark}>{b.summary}</Line>
          </section>
        )
        if (key === 'experience' && doc.experience.length) return experienceGroups(doc).map((g, gi) => (
          <section key={`${key}${gi}`} className={s.sec}>
            <p className={s.h}>{g.title}</p>
            {g.roles.map((e) => (
              <div key={e.id} className={s.item}>
                <p className={s.role}><b>{e.title || companyLabel(e)}</b>{e.title && companyLabel(e) ? ` · ${companyLabel(e)}` : ''}</p>
                {(dateOf(e) || e.location) && <p className={s.meta}>{join([e.location, e.employmentType, dateOf(e)], ' · ')}</p>}
                {e.summary && <p className={s.p}>{e.summary}</p>}
                {e.bullets.length > 0 && <ul className={s.ul}>{e.bullets.map((bl) => <Line key={bl.id} mark={bm[bl.id]} onMark={onMark}>{bl.text}</Line>)}</ul>}
              </div>
            ))}
          </section>
        ))
        if (key === 'education' && doc.education.length) return (
          <section key={key} className={s.sec}>
            <p className={s.h}>{sectionTitle(doc, 'education')}</p>
            {doc.education.map((e) => (
              <div key={e.id} className={s.item}>
                <p className={s.role}><b>{join([join([e.degree, e.field], ', '), e.school], ' · ')}</b></p>
                {(dateOf(e) || e.gpa) && <p className={s.meta}>{join([e.location, dateOf(e), gpaLabel(e)], ' · ')}</p>}
                {e.details.length > 0 && <ul className={s.ul}>{e.details.map((d) => <li key={d.id} className={s.li}>{d.text}</li>)}</ul>}
              </div>
            ))}
          </section>
        )
        if (key === 'skills' && doc.skills.length) return (
          <section key={key} className={s.sec}>
            <p className={s.h}>{sectionTitle(doc, 'skills')}</p>
            {doc.skills.map((g) => <Line key={g.id} as="p" mark={(marks.skills || {})[g.id]} onMark={onMark}>{g.label ? <b>{g.label}: </b> : null}{g.items.join(', ')}</Line>)}
          </section>
        )
        if (key === 'certifications' && doc.certifications.length) return (
          <section key={key} className={s.sec}>
            <p className={s.h}>{sectionTitle(doc, 'certifications')}</p>
            <ul className={s.ul}>{doc.certifications.map((c) => <Line key={c.id} mark={(marks.certs || {})[c.id]} onMark={onMark}>{join([join([c.name, c.issuer], ' · ') || c.text, earnedDateLabel(c)], ' · ')}</Line>)}</ul>
          </section>
        )
        if (key === 'projects' && doc.projects.length) return (
          <section key={key} className={s.sec}>
            <p className={s.h}>{sectionTitle(doc, 'projects')}</p>
            {doc.projects.map((p) => (
              <div key={p.id} className={s.item}>
                <p className={s.role}><b>{join([p.name, p.role], ' · ')}</b></p>
                {dateOf(p) && <p className={s.meta}>{dateOf(p)}</p>}
                {p.summary && <p className={s.p}>{p.summary}</p>}
                {p.bullets.length > 0 && <ul className={s.ul}>{p.bullets.map((bl) => <li key={bl.id} className={s.li}>{bl.text}</li>)}</ul>}
              </div>
            ))}
          </section>
        )
        if (key === 'languages' && doc.languages.length) return (
          <section key={key} className={s.sec}>
            <p className={s.h}>{sectionTitle(doc, 'languages')}</p>
            <p className={s.p}>{doc.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ')}</p>
          </section>
        )
        if (key.startsWith('extra:')) {
          const x = doc.extra.find((e) => `extra:${e.id}` === key)
          if (!x) return null
          return (
            <section key={key} className={s.sec}>
              <p className={s.h}>{x.title}</p>
              <ul className={s.ul}>{x.items.map((it) => <li key={it.id} className={s.li}>{it.text}</li>)}</ul>
            </section>
          )
        }
        return null
      })}
    </article>
  )
}
