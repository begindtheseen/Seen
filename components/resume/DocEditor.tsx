'use client'

// Structured résumé editor — every section of a ResumeDoc as editable blocks. Pure UI: it calls
// onChange with a NEW doc on every edit (the page owns the doc, the autosave and the health
// score). Bullets are addressable by id so Health findings can jump to and highlight them.

import { useEffect, useMemo, useRef, useState } from 'react'
import s from './studio.module.css'
import type { ResumeDoc, ResumeBullet, ResumeExperience, ResumeEducation, ResumeProject, ResumeSkillGroup, ResumeExtra } from '@/lib/resume/types'
import { newId, splitSkillList, formatRange, parseDateText, rewriteBullet, titleForKind } from '@/lib/resume/engine-client'

type Props = { doc: ResumeDoc; onChange: (next: ResumeDoc) => void; highlightId: string | null }

const SECTION_LABEL: Record<string, string> = { summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', certifications: 'Certifications', projects: 'Projects', languages: 'Languages' }
const EXTRA_KINDS = ['awards', 'publications', 'volunteer', 'interests', 'affiliations', 'custom'] as const

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T }
function lowerFirst(t: string): string { return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t }

function AutoArea({ value, onChange, className, placeholder, id, onBlur, rows = 1 }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; id?: string; onBlur?: () => void; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }, [value])
  return <textarea autoComplete="off" ref={ref} id={id} rows={rows} value={value} placeholder={placeholder} className={className} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
}

function Field({ label, value, onChange, placeholder, onBlur, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; onBlur?: () => void; type?: string }) {
  return (
    <div>
      <span className={s.label}>{label}</span>
      <input autoComplete="off" type={type} className={s.input} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  )
}

function DateField({ item, onChange }: { item: { start: string; end: string; dateText: string }; onChange: (p: { start: string; end: string; dateText: string }) => void }) {
  const [text, setText] = useState(item.dateText || formatRange(item.start, item.end))
  useEffect(() => { setText(item.dateText || formatRange(item.start, item.end)) }, [item.start, item.end, item.dateText])
  return (
    <div>
      <span className={s.label}>Dates</span>
      <input autoComplete="off" className={s.input} value={text} placeholder="Jun 2021 – Present" onChange={(e) => setText(e.target.value)} onBlur={() => { const t = text.trim(); const p = parseDateText(t); onChange({ start: p.start, end: p.end, dateText: t }) }} />
    </div>
  )
}

function BulletList({ bullets, onChange, highlightId, placeholder }: { bullets: ResumeBullet[]; onChange: (b: ResumeBullet[]) => void; highlightId: string | null; placeholder: string }) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (!highlightId) return
    const el = refs.current[highlightId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId])
  const set = (i: number, text: string) => onChange(bullets.map((b, j) => (j === i ? { ...b, text } : b)))
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= bullets.length) return; const next = [...bullets]; const [x] = next.splice(i, 1); next.splice(j, 0, x); onChange(next) }
  const remove = (i: number) => onChange(bullets.filter((_, j) => j !== i))
  return (
    <div className={s.bullets}>
      {bullets.map((b, i) => {
        const fix = b.text.trim() ? rewriteBullet(b.text, { tense: 'keep' }) : null
        const canFix = !!fix && !fix.unchanged && fix.changes.some((c) => c.rule !== 'hygiene')
        return (
          <div key={b.id} ref={(el) => { refs.current[b.id] = el }} className={`${s.bullet}${highlightId === b.id ? ` ${s.bulletHl}` : ''}`} data-bullet-id={b.id}>
            <span className={s.bulletDot}>•</span>
            <AutoArea value={b.text} onChange={(v) => set(i, v)} className={s.bulletArea} placeholder={placeholder} />
            <div className={s.bulletTools}>
              {canFix && fix && <button type="button" className={s.fixBtn} title={`→ ${fix.text}`} onClick={() => set(i, fix.text)}>✦ fix</button>}
              <div style={{ display: 'flex', gap: '.15rem' }}>
                <button type="button" className={s.tiny} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" className={s.tiny} onClick={() => move(i, 1)} disabled={i === bullets.length - 1} aria-label="Move down">↓</button>
                <button type="button" className={s.tiny} onClick={() => remove(i)} aria-label="Remove">✕</button>
              </div>
            </div>
          </div>
        )
      })}
      <div className={s.addRow}><button type="button" className={s.tiny} onClick={() => onChange([...bullets, { id: newId('b'), text: '' }])}>+ bullet</button></div>
    </div>
  )
}

export default function DocEditor({ doc, onChange, highlightId }: Props) {
  const update = (fn: (d: ResumeDoc) => void) => { const d = clone(doc); fn(d); onChange(d) }
  const b = doc.basics

  const orderKeys = doc.sectionOrder
  const present = new Set(orderKeys)
  const missing = useMemo(() => ['summary', 'experience', 'education', 'skills', 'certifications', 'projects', 'languages'].filter((k) => !present.has(k)), [orderKeys]) // eslint-disable-line react-hooks/exhaustive-deps

  const moveSection = (key: string, d: number) => update((x) => { const i = x.sectionOrder.indexOf(key); const j = i + d; if (i < 0 || j < 0 || j >= x.sectionOrder.length) return; const [k] = x.sectionOrder.splice(i, 1); x.sectionOrder.splice(j, 0, k) })
  const removeSection = (key: string) => update((x) => {
    x.sectionOrder = x.sectionOrder.filter((k) => k !== key)
    if (key === 'summary') x.basics.summary = ''
    else if (key.startsWith('extra:')) x.extra = x.extra.filter((e) => `extra:${e.id}` !== key)
    else if (key in x) (x as unknown as Record<string, unknown[]>)[key] = []
  })
  const addSection = (key: string) => update((x) => {
    if (key.startsWith('extra:')) {
      const kind = key.slice(6) as ResumeExtra['kind']
      const ex: ResumeExtra = { id: newId('z'), kind, title: titleForKind(kind), items: [{ id: newId('b'), text: '' }] }
      x.extra.push(ex); x.sectionOrder.push(`extra:${ex.id}`); return
    }
    if (key === 'summary') x.basics.summary = x.basics.summary || ' '
    if (key === 'experience' && !x.experience.length) x.experience.push(blankRole())
    if (key === 'education' && !x.education.length) x.education.push(blankEdu())
    if (key === 'skills' && !x.skills.length) x.skills.push({ id: newId('s'), label: '', items: [] })
    if (key === 'certifications' && !x.certifications.length) x.certifications.push({ id: newId('c'), name: '', issuer: '', date: '', text: '' })
    if (key === 'projects' && !x.projects.length) x.projects.push(blankProject())
    if (key === 'languages' && !x.languages.length) x.languages.push({ id: newId('l'), name: '', level: '' })
    if (!x.sectionOrder.includes(key)) x.sectionOrder.push(key)
  })

  const SectionHead = ({ title, k }: { title: string; k: string }) => {
    const i = orderKeys.indexOf(k)
    return (
      <div className={s.secHead}>
        <span className={s.secTitle}>{title}</span>
        <div className={s.secTools}>
          <button type="button" className={s.tiny} onClick={() => moveSection(k, -1)} disabled={i <= 0} aria-label="Move section up">↑</button>
          <button type="button" className={s.tiny} onClick={() => moveSection(k, 1)} disabled={i >= orderKeys.length - 1} aria-label="Move section down">↓</button>
          <button type="button" className={s.tiny} onClick={() => removeSection(k)} aria-label="Remove section">✕</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ── Basics ── */}
      <div className={s.sec}>
        <div className={s.secHead}><span className={s.secTitle}>Contact</span></div>
        <div className={s.row}>
          <Field label="Full name" value={b.name} onChange={(v) => update((x) => { x.basics.name = v })} placeholder="Your name" />
          <Field label="Headline (optional)" value={b.headline} onChange={(v) => update((x) => { x.basics.headline = v })} placeholder="Journeyman Electrician" />
        </div>
        <div className={s.row}>
          <Field label="Email" type="email" value={b.email} onChange={(v) => update((x) => { x.basics.email = v })} placeholder="you@example.com" />
          <Field label="Phone" value={b.phone} onChange={(v) => update((x) => { x.basics.phone = v })} placeholder="(555) 010-2030" />
          <Field label="Location" value={b.location} onChange={(v) => update((x) => { x.basics.location = v })} placeholder="Phoenix, AZ" />
        </div>
        {b.links.map((l, i) => (
          <div key={i} className={s.row} style={{ gridTemplateColumns: '110px 1fr auto' }}>
            <div>
              <span className={s.label}>Link</span>
              <select className={s.input} value={l.kind} onChange={(e) => update((x) => { x.basics.links[i].kind = e.target.value as typeof l.kind })}>
                <option value="linkedin">LinkedIn</option><option value="github">GitHub</option><option value="portfolio">Portfolio</option><option value="other">Other</option>
              </select>
            </div>
            <Field label="URL" value={l.url} onChange={(v) => update((x) => { x.basics.links[i].url = v })} placeholder="linkedin.com/in/you" />
            <button type="button" className={s.tiny} style={{ alignSelf: 'end', marginBottom: '.2rem' }} onClick={() => update((x) => { x.basics.links.splice(i, 1) })} aria-label="Remove link">✕</button>
          </div>
        ))}
        <div className={s.addRow}><button type="button" className={s.tiny} onClick={() => update((x) => { x.basics.links.push({ kind: 'linkedin', url: '', label: '' }) })}>+ link</button></div>
      </div>

      {orderKeys.map((key) => {
        if (key === 'summary') return (
          <div key={key} className={s.sec}>
            <SectionHead title="Summary" k={key} />
            <AutoArea value={b.summary} onChange={(v) => update((x) => { x.basics.summary = v })} className={`${s.input} ${s.area}`} placeholder="Two or three lines: who you are, what you are strongest at, one real result." rows={2} />
          </div>
        )
        if (key === 'experience') return (
          <div key={key} className={s.sec}>
            <SectionHead title="Experience" k={key} />
            {doc.experience.map((e, i) => (
              <RoleEditor key={e.id} role={e} index={i} count={doc.experience.length} highlightId={highlightId}
                onChange={(r) => update((x) => { x.experience[i] = r })}
                onMove={(d) => update((x) => { const j = i + d; if (j < 0 || j >= x.experience.length) return; const [r] = x.experience.splice(i, 1); x.experience.splice(j, 0, r) })}
                onRemove={() => update((x) => { x.experience.splice(i, 1) })} />
            ))}
            <div className={s.addRow}><button type="button" className={s.btn} onClick={() => update((x) => { x.experience.push(blankRole()) })}>+ Add role</button></div>
          </div>
        )
        if (key === 'education') return (
          <div key={key} className={s.sec}>
            <SectionHead title="Education" k={key} />
            {doc.education.map((e, i) => (
              <div key={e.id} className={s.item}>
                <div className={s.itemHead}><span className={s.itemName}>{e.school || e.degree || 'New entry'}</span><div className={s.secTools}><button type="button" className={s.tiny} onClick={() => update((x) => { x.education.splice(i, 1) })} aria-label="Remove">✕</button></div></div>
                <div className={s.row}>
                  <Field label="School" value={e.school} onChange={(v) => update((x) => { x.education[i].school = v })} placeholder="University of Washington" />
                  <Field label="Degree" value={e.degree} onChange={(v) => update((x) => { x.education[i].degree = v })} placeholder="B.S." />
                  <Field label="Field" value={e.field} onChange={(v) => update((x) => { x.education[i].field = v })} placeholder="Computer Science" />
                </div>
                <div className={s.row}>
                  <Field label="Location" value={e.location} onChange={(v) => update((x) => { x.education[i].location = v })} placeholder="Seattle, WA" />
                  <DateField item={e} onChange={(p) => update((x) => { Object.assign(x.education[i], p) })} />
                  <Field label="GPA (optional)" value={e.gpa} onChange={(v) => update((x) => { x.education[i].gpa = v })} placeholder="3.8" />
                </div>
                <BulletList bullets={e.details} onChange={(d) => update((x) => { x.education[i].details = d })} highlightId={highlightId} placeholder="Honors, coursework, thesis…" />
              </div>
            ))}
            <div className={s.addRow}><button type="button" className={s.btn} onClick={() => update((x) => { x.education.push(blankEdu()) })}>+ Add education</button></div>
          </div>
        )
        if (key === 'skills') return (
          <div key={key} className={s.sec}>
            <SectionHead title="Skills" k={key} />
            {doc.skills.map((g, i) => <SkillGroupEditor key={g.id} group={g} onChange={(ng) => update((x) => { x.skills[i] = ng })} onRemove={() => update((x) => { x.skills.splice(i, 1) })} />)}
            <div className={s.addRow}><button type="button" className={s.btn} onClick={() => update((x) => { x.skills.push({ id: newId('s'), label: '', items: [] }) })}>+ Add skill group</button></div>
          </div>
        )
        if (key === 'certifications') return (
          <div key={key} className={s.sec}>
            <SectionHead title="Certifications" k={key} />
            {doc.certifications.map((c, i) => (
              <div key={c.id} className={s.row} style={{ gridTemplateColumns: '1.4fr 1fr .7fr auto' }}>
                <Field label="Certification" value={c.name || c.text} onChange={(v) => update((x) => { x.certifications[i].name = v; x.certifications[i].text = v })} placeholder="OSHA 30" />
                <Field label="Issuer" value={c.issuer} onChange={(v) => update((x) => { x.certifications[i].issuer = v })} placeholder="OSHA" />
                <Field label="Date" value={c.date} onChange={(v) => update((x) => { x.certifications[i].date = parseDateText(v).start || v })} placeholder="2022" />
                <button type="button" className={s.tiny} style={{ alignSelf: 'end', marginBottom: '.2rem' }} onClick={() => update((x) => { x.certifications.splice(i, 1) })} aria-label="Remove">✕</button>
              </div>
            ))}
            <div className={s.addRow}><button type="button" className={s.btn} onClick={() => update((x) => { x.certifications.push({ id: newId('c'), name: '', issuer: '', date: '', text: '' }) })}>+ Add certification</button></div>
          </div>
        )
        if (key === 'projects') return (
          <div key={key} className={s.sec}>
            <SectionHead title="Projects" k={key} />
            {doc.projects.map((p, i) => (
              <div key={p.id} className={s.item}>
                <div className={s.itemHead}><span className={s.itemName}>{p.name || 'New project'}</span><div className={s.secTools}><button type="button" className={s.tiny} onClick={() => update((x) => { x.projects.splice(i, 1) })} aria-label="Remove">✕</button></div></div>
                <div className={s.row}>
                  <Field label="Project" value={p.name} onChange={(v) => update((x) => { x.projects[i].name = v })} placeholder="Latencyscope" />
                  <Field label="Role" value={p.role} onChange={(v) => update((x) => { x.projects[i].role = v })} placeholder="Creator" />
                  <Field label="URL" value={p.url} onChange={(v) => update((x) => { x.projects[i].url = v })} placeholder="github.com/you/project" />
                  <DateField item={p} onChange={(pp) => update((x) => { Object.assign(x.projects[i], pp) })} />
                </div>
                <AutoArea value={p.summary} onChange={(v) => update((x) => { x.projects[i].summary = v })} className={`${s.input} ${s.area}`} placeholder="One line on what it is (optional)" />
                <BulletList bullets={p.bullets} onChange={(bl) => update((x) => { x.projects[i].bullets = bl })} highlightId={highlightId} placeholder="What you built and the result" />
              </div>
            ))}
            <div className={s.addRow}><button type="button" className={s.btn} onClick={() => update((x) => { x.projects.push(blankProject()) })}>+ Add project</button></div>
          </div>
        )
        if (key === 'languages') return (
          <div key={key} className={s.sec}>
            <SectionHead title="Languages" k={key} />
            {doc.languages.map((l, i) => (
              <div key={l.id} className={s.row} style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                <Field label="Language" value={l.name} onChange={(v) => update((x) => { x.languages[i].name = v })} placeholder="Spanish" />
                <Field label="Level" value={l.level} onChange={(v) => update((x) => { x.languages[i].level = v })} placeholder="Fluent" />
                <button type="button" className={s.tiny} style={{ alignSelf: 'end', marginBottom: '.2rem' }} onClick={() => update((x) => { x.languages.splice(i, 1) })} aria-label="Remove">✕</button>
              </div>
            ))}
            <div className={s.addRow}><button type="button" className={s.btn} onClick={() => update((x) => { x.languages.push({ id: newId('l'), name: '', level: '' }) })}>+ Add language</button></div>
          </div>
        )
        if (key.startsWith('extra:')) {
          const xi = doc.extra.findIndex((e) => `extra:${e.id}` === key)
          if (xi < 0) return null
          const ex = doc.extra[xi]
          return (
            <div key={key} className={s.sec}>
              <div className={s.secHead}>
                <input autoComplete="off" className={s.input} style={{ maxWidth: 260, fontFamily: 'var(--mono)', fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--green)' }} value={ex.title} onChange={(e) => update((x) => { x.extra[xi].title = e.target.value })} />
                <div className={s.secTools}>
                  <button type="button" className={s.tiny} onClick={() => moveSection(key, -1)} aria-label="Move up">↑</button>
                  <button type="button" className={s.tiny} onClick={() => moveSection(key, 1)} aria-label="Move down">↓</button>
                  <button type="button" className={s.tiny} onClick={() => removeSection(key)} aria-label="Remove">✕</button>
                </div>
              </div>
              <BulletList bullets={ex.items} onChange={(items) => update((x) => { x.extra[xi].items = items })} highlightId={highlightId} placeholder="Item" />
            </div>
          )
        }
        return null
      })}

      <div className={s.addSec}>
        <span className={s.label} style={{ margin: 0 }}>Add section</span>
        {missing.map((k) => <button key={k} type="button" className={s.tiny} onClick={() => addSection(k)}>+ {SECTION_LABEL[k]}</button>)}
        {EXTRA_KINDS.map((k) => <button key={k} type="button" className={s.tiny} onClick={() => addSection(`extra:${k}`)}>+ {titleForKind(k)}</button>)}
      </div>
    </div>
  )
}

function blankRole(): ResumeExperience { return { id: newId('x'), title: '', company: '', location: '', employmentType: '', start: '', end: '', dateText: '', summary: '', bullets: [{ id: newId('b'), text: '' }] } }
function blankEdu(): ResumeEducation { return { id: newId('e'), school: '', degree: '', field: '', location: '', start: '', end: '', dateText: '', gpa: '', details: [] } }
function blankProject(): ResumeProject { return { id: newId('p'), name: '', role: '', url: '', start: '', end: '', dateText: '', summary: '', bullets: [{ id: newId('b'), text: '' }] } }

function RoleEditor({ role, index, count, highlightId, onChange, onMove, onRemove }: { role: ResumeExperience; index: number; count: number; highlightId: string | null; onChange: (r: ResumeExperience) => void; onMove: (d: number) => void; onRemove: () => void }) {
  const set = (patch: Partial<ResumeExperience>) => onChange({ ...role, ...patch })
  const current = role.end === 'present'
  return (
    <div className={s.item}>
      <div className={s.itemHead}>
        <span className={s.itemName}>{[role.title, role.company].filter(Boolean).join(' — ') || 'New role'}</span>
        <div className={s.secTools}>
          <button type="button" className={s.tiny} onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move role up">↑</button>
          <button type="button" className={s.tiny} onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move role down">↓</button>
          <button type="button" className={s.tiny} onClick={onRemove} aria-label="Remove role">✕</button>
        </div>
      </div>
      <div className={s.row}>
        <Field label="Title" value={role.title} onChange={(v) => set({ title: v })} placeholder="Journeyman Electrician" />
        <Field label="Company" value={role.company} onChange={(v) => set({ company: v })} placeholder="Desert Power Solutions" />
      </div>
      <div className={s.row}>
        <Field label="Location" value={role.location} onChange={(v) => set({ location: v })} placeholder="Phoenix, AZ" />
        <DateField item={role} onChange={(p) => set(p)} />
        <Field label="Type (optional)" value={role.employmentType} onChange={(v) => set({ employmentType: v })} placeholder="Full-time · Contract" />
      </div>
      {role.summary && <AutoArea value={role.summary} onChange={(v) => set({ summary: v })} className={`${s.input} ${s.area}`} placeholder="One line on the scope of the role (optional)" />}
      <BulletList bullets={role.bullets} onChange={(bullets) => set({ bullets })} highlightId={highlightId} placeholder={current ? 'What you do — start with a verb, end with a number' : 'What you did — start with a verb, end with a number'} />
      {!role.summary && <div className={s.addRow}><button type="button" className={s.tiny} onClick={() => set({ summary: ' ' })}>+ scope line</button></div>}
    </div>
  )
}

function SkillGroupEditor({ group, onChange, onRemove }: { group: ResumeSkillGroup; onChange: (g: ResumeSkillGroup) => void; onRemove: () => void }) {
  const [text, setText] = useState(group.items.join(', '))
  useEffect(() => { setText(group.items.join(', ')) }, [group.items])
  return (
    <div className={s.item}>
      <div className={s.row} style={{ gridTemplateColumns: '180px 1fr auto', marginBottom: 0 }}>
        <Field label="Group (optional)" value={group.label} onChange={(v) => onChange({ ...group, label: v })} placeholder="Languages" />
        <div>
          <span className={s.label}>Skills — comma separated</span>
          <input autoComplete="off" className={s.input} value={text} placeholder="Go, Python, SQL" onChange={(e) => setText(e.target.value)} onBlur={() => onChange({ ...group, items: splitSkillList(text) })} />
        </div>
        <button type="button" className={s.tiny} style={{ alignSelf: 'end', marginBottom: '.2rem' }} onClick={onRemove} aria-label="Remove group">✕</button>
      </div>
      {group.items.length > 0 && <div className={s.chips} style={{ marginTop: '.5rem' }}>{group.items.map((it, i) => <span key={`${it}${i}`} className={s.chip}>{it}</span>)}</div>}
    </div>
  )
}

export { lowerFirst }
