'use client'

// A stored résumé, shown readably: parsed in the browser by the same engine as Résumé Studio
// (lib/resume parseResume) and laid out by section. Nothing is added or reworded. When the parser finds
// no structure, the text is shown as written.
import { useMemo } from 'react'
import { parseResume, docIsEmpty } from '@/lib/resume/engine-client'
import type { ResumeDoc } from '@/lib/resume/types'

const h3: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', margin: '1rem 0 .5rem', borderBottom: '1px solid var(--line)', paddingBottom: '.25rem' }
const body: React.CSSProperties = { fontSize: 'var(--fs-ui)', color: 'var(--sub)', lineHeight: 1.6, overflowWrap: 'anywhere' }
const strong: React.CSSProperties = { color: 'var(--white)', fontWeight: 700 }
const meta: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--muted)', overflowWrap: 'anywhere' }

function Bullets({ items }: { items: Array<{ id: string; text: string }> }) {
  if (!items.length) return null
  return <ul style={{ margin: '.25rem 0 0', paddingLeft: '1rem', ...body }}>{items.map(b => <li key={b.id} style={{ marginBottom: '.25rem' }}>{b.text}</li>)}</ul>
}

const when = (dateText: string, start: string, end: string) => dateText || [start, end].filter(Boolean).join(' – ')

function Sections({ doc }: { doc: ResumeDoc }) {
  const b = doc.basics
  const contact = [b.email, b.phone, b.location, ...b.links.map(l => l.url)].filter(Boolean)
  return (
    <div>
      {b.name && <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-lead)', color: 'var(--white)', overflowWrap: 'anywhere' }}>{b.name}</div>}
      {b.headline && <div style={{ ...body, color: 'var(--white)' }}>{b.headline}</div>}
      {contact.length > 0 && <div style={{ ...meta, marginTop: '.25rem' }}>{contact.join(' · ')}</div>}
      {b.summary && <><div style={h3}>Summary</div><p style={{ ...body, margin: 0 }}>{b.summary}</p></>}

      {doc.experience.length > 0 && <div style={h3}>Experience</div>}
      {doc.experience.map(x => (
        <div key={x.id} style={{ marginBottom: '.75rem' }}>
          <div style={body}><span style={strong}>{x.title || x.company}</span>{x.title && x.company ? ` — ${x.company}` : ''}</div>
          {(when(x.dateText, x.start, x.end) || x.location) && <div style={meta}>{[when(x.dateText, x.start, x.end), x.location].filter(Boolean).join(' · ')}</div>}
          {x.summary && <p style={{ ...body, margin: '.25rem 0 0' }}>{x.summary}</p>}
          <Bullets items={x.bullets} />
        </div>
      ))}

      {doc.projects.length > 0 && <div style={h3}>Projects</div>}
      {doc.projects.map(p => (
        <div key={p.id} style={{ marginBottom: '.5rem' }}>
          <div style={body}><span style={strong}>{p.name}</span>{p.role ? ` — ${p.role}` : ''}</div>
          {when(p.dateText, p.start, p.end) && <div style={meta}>{when(p.dateText, p.start, p.end)}</div>}
          {p.summary && <p style={{ ...body, margin: '.25rem 0 0' }}>{p.summary}</p>}
          <Bullets items={p.bullets} />
        </div>
      ))}

      {doc.education.length > 0 && <div style={h3}>Education</div>}
      {doc.education.map(e => (
        <div key={e.id} style={{ marginBottom: '.5rem' }}>
          <div style={body}><span style={strong}>{e.school || e.degree}</span>{e.school && (e.degree || e.field) ? ` — ${[e.degree, e.field].filter(Boolean).join(', ')}` : ''}</div>
          {(when(e.dateText, e.start, e.end) || e.gpa) && <div style={meta}>{[when(e.dateText, e.start, e.end), e.gpa ? `GPA ${e.gpa}` : ''].filter(Boolean).join(' · ')}</div>}
          <Bullets items={e.details} />
        </div>
      ))}

      {doc.skills.length > 0 && <div style={h3}>Skills</div>}
      {doc.skills.map(g => <div key={g.id} style={body}>{g.label ? <span style={strong}>{g.label}: </span> : null}{g.items.join(', ')}</div>)}

      {doc.certifications.length > 0 && <div style={h3}>Certifications</div>}
      {doc.certifications.map(c => <div key={c.id} style={body}>{c.text || [c.name, c.issuer, c.date].filter(Boolean).join(' · ')}</div>)}

      {doc.languages.length > 0 && <div style={h3}>Languages</div>}
      {doc.languages.length > 0 && <div style={body}>{doc.languages.map(l => l.level ? `${l.name} (${l.level})` : l.name).join(', ')}</div>}

      {doc.extra.map(x => (
        <div key={x.id}>
          <div style={h3}>{x.title}</div>
          <Bullets items={x.items} />
        </div>
      ))}
    </div>
  )
}

export default function ResumeView({ text, fileName = '' }: { text: string; fileName?: string }) {
  const doc = useMemo(() => { try { return parseResume(text, fileName) } catch { return null } }, [text, fileName])
  if (!doc || docIsEmpty(doc)) return <div style={{ ...body, whiteSpace: 'pre-wrap' }}>{text}</div>
  return <Sections doc={doc} />
}
